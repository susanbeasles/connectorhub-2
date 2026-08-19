import type { AccessMode } from "./types";

/**
 * The operator-owned half of the edge gate. The environment still supplies the
 * trust anchors — team domain and audiences — so a compromised database can
 * never point the broker at someone else's identity provider. What the database
 * does own is a single question the operator must be able to answer at 3am:
 * is the private network required right now, or not?
 *
 * Every consumer of the gate reads the effective mode from here, so the toggle
 * and the breakglass window can never disagree with what is actually enforced.
 */

export type PolicyMode = "public" | "zero_trust";

export type AccessPolicy = {
  mode: PolicyMode;
  breakglassUntil: string | null;
  breakglassActive: boolean;
  updatedAt: string;
  updatedBy: string | null;
};

export type AccessActor = { userId: string | null; email: string | null };

const CACHE_MS = 5_000;
const FALLBACK: AccessPolicy = {
  mode: "public",
  breakglassUntil: null,
  breakglassActive: false,
  updatedAt: new Date(0).toISOString(),
  updatedBy: null,
};

let cached: { value: AccessPolicy; at: number } | null = null;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function toPolicy(row: {
  mode: string;
  breakglass_until: string | null;
  updated_at: string;
  updated_by: string | null;
}): AccessPolicy {
  const until = row.breakglass_until;
  return {
    mode: row.mode === "zero_trust" ? "zero_trust" : "public",
    breakglassUntil: until,
    breakglassActive: !!until && new Date(until).getTime() > Date.now(),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/**
 * Reads fail open to `public`. A database outage must never become a lockout:
 * the gate exists to keep strangers out, not to strand the operator outside
 * their own control plane when the store that holds the answer is unreachable.
 */
export async function policyRead(): Promise<AccessPolicy> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const db = await admin();
    const { data } = await db
      .from("access_policy")
      .select("mode, breakglass_until, updated_at, updated_by")
      .eq("id", "singleton")
      .maybeSingle();
    const value = data ? toPolicy(data) : FALLBACK;
    cached = { value, at: Date.now() };
    return value;
  } catch {
    return FALLBACK;
  }
}

async function write(
  patch: Record<string, unknown>,
  event: { action: string; actor: AccessActor; reason?: string; expiresAt?: string | null },
): Promise<AccessPolicy> {
  const db = await admin();
  const { data } = await db
    .from("access_policy")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: event.actor.userId })
    .eq("id", "singleton")
    .select("mode, breakglass_until, updated_at, updated_by")
    .maybeSingle();
  cached = null;
  const policy = data ? toPolicy(data) : FALLBACK;
  await db.from("access_events").insert({
    action: event.action,
    mode: policy.mode,
    actor: event.actor.userId,
    actor_email: event.actor.email,
    reason: event.reason ?? null,
    expires_at: event.expiresAt ?? null,
  });
  return policy;
}

export function policySet(mode: PolicyMode, actor: AccessActor, reason?: string) {
  return write(
    { mode, ...(mode === "public" ? { breakglass_until: null } : {}) },
    { action: "mode.change", actor, ...(reason ? { reason } : {}) },
  );
}

/** A time-boxed suspension of enforcement. It expires on its own — nothing to undo. */
export function breakglassOpen(minutes: number, actor: AccessActor, reason?: string) {
  const window = Math.min(240, Math.max(5, Math.round(minutes)));
  const until = new Date(Date.now() + window * 60_000).toISOString();
  return write(
    { breakglass_until: until },
    { action: "breakglass.open", actor, expiresAt: until, ...(reason ? { reason } : {}) },
  );
}

export function breakglassClose(actor: AccessActor) {
  return write({ breakglass_until: null }, { action: "breakglass.close", actor });
}

export async function accessHistory(limit = 20) {
  try {
    const db = await admin();
    const { data } = await db
      .from("access_events")
      .select("id, action, mode, actor_email, reason, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      action: row.action as string,
      mode: (row.mode as string) ?? null,
      actorEmail: (row.actor_email as string) ?? null,
      reason: (row.reason as string) ?? null,
      expiresAt: (row.expires_at as string) ?? null,
      createdAt: row.created_at as string,
    }));
  } catch {
    return [];
  }
}

/**
 * The one place enforcement is decided. `monitor` still verifies and reports,
 * it just never blocks — which is exactly what an open policy or an active
 * breakglass window means.
 */
export async function effectiveMode(declared: AccessMode, configured: boolean): Promise<AccessMode> {
  if (!configured) return "off";
  const policy = await policyRead();
  if (policy.mode === "public" || policy.breakglassActive) return "monitor";
  return declared === "monitor" ? "monitor" : "enforce";
}
