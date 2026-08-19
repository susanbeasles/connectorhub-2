import { sha256Hex } from "../crypto.server";

/**
 * Second factors, tracked by the broker rather than inferred from a session.
 *
 * A passkey only counts once the authenticator actually performed user
 * verification — possession alone is one challenge, not two. Until an identity
 * holds a verified factor the console shows enrollment and nothing else.
 */

export type FactorKind = "passkey" | "totp" | "sso";

export type Factor = {
  id: string;
  kind: FactorKind;
  label: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export type MfaState = { factors: Factor[]; enrolled: boolean };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function mfaState(userId: string): Promise<MfaState> {
  const db = await admin();
  const { data } = await db
    .from("mfa_factors")
    .select("id, kind, label, verified_at, created_at")
    .eq("user_id", userId)
    .order("created_at");
  const factors = (data ?? []).map((f) => ({
    id: f.id as string,
    kind: f.kind as FactorKind,
    label: f.label as string | null,
    verifiedAt: f.verified_at as string | null,
    createdAt: f.created_at as string,
  }));
  return { factors, enrolled: factors.some((f) => !!f.verifiedAt) };
}

export async function recordFactor(input: {
  userId: string;
  kind: FactorKind;
  reference: string;
  label?: string | undefined;
  verified?: boolean | undefined;
}) {

  const db = await admin();
  const { error } = await db.from("mfa_factors").upsert(
    {
      user_id: input.userId,
      kind: input.kind,
      reference: input.reference,
      label: input.label ?? null,
      verified_at: input.verified === false ? null : new Date().toISOString(),
    },
    { onConflict: "user_id,kind,reference" },
  );
  if (error) throw new Error(error.message);
  return mfaState(input.userId);
}

/**
 * Proof, not assertion. A client saying "I enrolled" is worth nothing: the
 * broker re-reads the factor from the authority that actually witnessed the
 * ceremony — its own WebAuthn credential store, or the identity provider's
 * TOTP factor state — before any factor counts toward the gate.
 */
export async function enrollProvenFactor(input: {
  userId: string;
  kind: FactorKind;
  reference: string;
  label?: string | undefined;
}): Promise<MfaState> {
  if (input.kind === "passkey") {
    const db = await admin();
    const { data } = await db
      .from("webauthn_credentials")
      .select("id")
      .eq("user_id", input.userId)
      .eq("credential_id", input.reference)
      .maybeSingle();
    if (!data) throw new Error("No verified hardware key matches that credential");
  } else if (input.kind === "totp") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.mfa.listFactors({
      userId: input.userId,
    });
    if (error) throw new Error(error.message);
    const factor = (data?.factors ?? []).find((f) => f.id === input.reference);
    if (!factor || factor.status !== "verified") {
      throw new Error("That authenticator has not completed verification");
    }
  } else {
    throw new Error("That factor kind cannot be self-enrolled");
  }
  return recordFactor({ ...input, verified: true });
}

export async function dropFactor(userId: string, id: string) {
  const db = await admin();
  await db.from("mfa_factors").delete().eq("id", id).eq("user_id", userId);
  return mfaState(userId);
}

function code(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .slice(0, 10);
}

/** Issued once at enrollment; kept only as hashes, like every other break-glass secret here. */
export async function issueRecoveryCodes(userId: string, count = 8): Promise<string[]> {
  const db = await admin();
  await db.from("mfa_recovery_codes").delete().eq("user_id", userId);
  const codes = Array.from({ length: count }, code);
  const rows = await Promise.all(
    codes.map(async (c) => ({ user_id: userId, code_hash: await sha256Hex(c) })),
  );
  const { error } = await db.from("mfa_recovery_codes").insert(rows);
  if (error) throw new Error(error.message);
  return codes;
}

export async function redeemRecoveryCode(userId: string, raw: string): Promise<boolean> {
  const db = await admin();
  const hash = await sha256Hex(raw.trim().toUpperCase());
  const { data } = await db
    .from("mfa_recovery_codes")
    .select("id")
    .eq("user_id", userId)
    .eq("code_hash", hash)
    .is("used_at", null)
    .maybeSingle();
  if (!data) return false;
  await db
    .from("mfa_recovery_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id);
  return true;
}
