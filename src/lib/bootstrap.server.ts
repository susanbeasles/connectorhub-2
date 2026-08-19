import { sha256Hex } from "./crypto.server";
import { signer } from "./signing/index.server";

/**
 * Ownership ceremony. An unclaimed instance has no operators and no console
 * access at all; the seat is taken once, deliberately, against the deployment
 * secret — never by whoever happens to sign in first.
 */

export type ClaimState = {
  claimed: boolean;
  claimedEmail: string | null;
  claimedAt: string | null;
  requiresSecret: boolean;
};

const CLAIM_ID = true;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function bootstrapSecret(): string | null {
  return process.env["BOOTSTRAP_SECRET"] || null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function recoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function claimState(): Promise<ClaimState> {
  const db = await admin();
  const { data } = await db.from("instance_claim").select("*").eq("id", CLAIM_ID).maybeSingle();
  const { count } = await db.from("operators").select("user_id", { count: "exact", head: true });
  return {
    claimed: !!data?.claimed_at || (count ?? 0) > 0,
    claimedEmail: data?.claimed_email ?? null,
    claimedAt: data?.claimed_at ?? null,
    requiresSecret: !!bootstrapSecret(),
  };
}

/**
 * Take the owner seat. Ownership is never "whoever signed in first": the
 * deployment secret must exist and match, and the identity must already carry
 * a verified second factor. Returns the recovery code exactly once — it is
 * stored only as a hash, so a lost code is unrecoverable by design.
 */
export async function claimInstance(input: {
  userId: string;
  email: string;
  secret: string;
}): Promise<{ recoveryCode: string }> {
  const state = await claimState();
  if (state.claimed) throw new Error("This instance is already claimed.");

  const expected = bootstrapSecret();
  if (!expected) {
    throw new Error(
      "This deployment has no BOOTSTRAP_SECRET, so no identity can be seated. Set one, then claim.",
    );
  }
  if (!constantTimeEqual(input.secret.trim(), expected)) {
    throw new Error("Bootstrap secret rejected.");
  }

  const { mfaState } = await import("@/lib/mfa/factors.server");
  const mfa = await mfaState(input.userId);
  if (!mfa.enrolled) throw new Error("Enroll a verified second factor before claiming.");


  const db = await admin();
  const code = recoveryCode();

  const seat = await db
    .from("operators")
    .insert({ user_id: input.userId, email: input.email, role: "owner" })
    .select("user_id")
    .maybeSingle();
  if (!seat.data) throw new Error("Could not seat the owner.");

  await db.from("instance_claim").upsert({
    id: CLAIM_ID,
    claimed_at: new Date().toISOString(),
    claimed_by: input.userId,
    claimed_email: input.email,
    recovery_hash: await sha256Hex(code),
    updated_at: new Date().toISOString(),
  });

  await attest(`instance claimed by ${input.email}`);
  return { recoveryCode: code };
}

/**
 * Pin the broker's signing identity to an append-only chain. A thumbprint that
 * changes without a deliberate rotation means the instance is not the one the
 * owner claimed.
 */
export async function attest(note: string) {
  const db = await admin();
  const thumbprint = await signer().keyId();
  const { data: first } = await db
    .from("attestations")
    .select("key_thumbprint")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const trusted = !first || first.key_thumbprint === thumbprint;
  await db.from("attestations").insert({ key_thumbprint: thumbprint, note, trusted });
  return { thumbprint, trusted };
}

export async function attestationChain(limit = 25) {
  const db = await admin();
  const { data } = await db
    .from("attestations")
    .select("id, created_at, key_thumbprint, note, trusted")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
