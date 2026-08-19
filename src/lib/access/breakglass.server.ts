import { sha256Hex } from "@/lib/crypto.server";
import { breakglassOpen, type AccessActor } from "./policy.server";

/**
 * Recovery that does not depend on the thing it recovers. A breakglass code is
 * verifiable without Cloudflare, without the identity provider and without a
 * session, because those are precisely the things that may be down when it is
 * needed. Codes are single-use, stored only as digests, and every redemption
 * writes an audit record and opens a window that closes by itself.
 */

export type BreakglassCode = {
  id: string;
  label: string;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function generate(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return (chars.match(/.{1,5}/g) ?? []).join("-");
}

function toCode(row: Record<string, unknown>): BreakglassCode {
  return {
    id: row["id"] as string,
    label: row["label"] as string,
    createdAt: row["created_at"] as string,
    usedAt: (row["used_at"] as string) ?? null,
    revokedAt: (row["revoked_at"] as string) ?? null,
  };
}

/** Returned in full exactly once; only the digest is ever persisted. */
export async function codeIssue(label: string, actor: AccessActor) {
  const code = generate();
  const db = await admin();
  const { data, error } = await db
    .from("breakglass_codes")
    .insert({ label: label.slice(0, 60) || "recovery", code_hash: await sha256Hex(code), created_by: actor.userId })
    .select("id, label, created_at, used_at, revoked_at")
    .maybeSingle();
  if (error || !data) throw new Error("Could not issue a recovery code");
  await db.from("access_events").insert({
    action: "breakglass.issue",
    actor: actor.userId,
    actor_email: actor.email,
    reason: label,
  });
  return { code, record: toCode(data) };
}

export async function codeRevoke(id: string, actor: AccessActor) {
  const db = await admin();
  await db.from("breakglass_codes").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  await db.from("access_events").insert({
    action: "breakglass.revoke",
    actor: actor.userId,
    actor_email: actor.email,
  });
}

export async function codeList(): Promise<BreakglassCode[]> {
  const db = await admin();
  const { data } = await db
    .from("breakglass_codes")
    .select("id, label, created_at, used_at, revoked_at")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map(toCode);
}

/**
 * Redeem a code. Rate limited by the shared counter so the endpoint cannot be
 * ground down, and deliberately vague on failure — a caller learns only that
 * it did not work.
 */
export async function codeRedeem(input: {
  code: string;
  minutes: number;
  reason: string;
  source: string;
}): Promise<{ until: string }> {
  const { rateHit } = await import("@/lib/ratelimit.server");
  const verdict = await rateHit(`breakglass:${input.source}`, 5, 300);
  if (!verdict.allowed) throw new Error("Too many attempts — wait and try again");

  const db = await admin();
  const hash = await sha256Hex(input.code.trim().toUpperCase());
  const { data } = await db
    .from("breakglass_codes")
    .select("id, used_at, revoked_at")
    .eq("code_hash", hash)
    .maybeSingle();
  if (!data || data.used_at || data.revoked_at) throw new Error("That recovery code is not usable");

  await db.from("breakglass_codes").update({ used_at: new Date().toISOString() }).eq("id", data.id);
  const policy = await breakglassOpen(
    input.minutes,
    { userId: null, email: `breakglass:${data.id.slice(0, 8)}` },
    input.reason.slice(0, 200) || "Recovery code redeemed",
  );
  return { until: policy.breakglassUntil ?? new Date().toISOString() };
}
