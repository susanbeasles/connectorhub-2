import type { SupabaseClient } from "@supabase/supabase-js";
import { mintToken, sha256Hex } from "../crypto.server";

/**
 * Two provisioning shapes, one table. `asymmetric` is the default path: the
 * agent holds its own key and the broker only ever stores a public JWK. `key`
 * remains as an explicit, never-silent fallback for callers that cannot sign.
 */

type DB = SupabaseClient<any, any, any>;

export type SourceMode = "asymmetric" | "key";

export async function listSources(supabase: DB) {
  const { data, error } = await supabase
    .from("ingest_sources")
    .select(
      "id, name, server_id, key_prefix, auth_mode, jkt, enrolled_at, enroll_expires_at, redact_keys, disabled, last_seen_at, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createSource(
  supabase: DB,
  userId: string,
  input: { name: string; serverId: string | null; redactKeys: string[]; mode: SourceMode },
) {
  const asymmetric = input.mode !== "key";
  const key = asymmetric ? null : mintToken();

  const { data, error } = await supabase
    .from("ingest_sources")
    .insert({
      user_id: userId,
      name: input.name,
      server_id: input.serverId,
      auth_mode: asymmetric ? "asymmetric" : "key",
      key_hash: key ? await sha256Hex(key) : null,
      key_prefix: key ? key.slice(0, 10) : null,
      redact_keys: input.redactKeys,
    })
    .select("id, name, auth_mode, key_prefix")
    .single();
  if (error) throw new Error(error.message);

  if (!asymmetric) return { ...data, key, enrollment: null };

  const { issueEnrollment } = await import("./enroll.server");
  return { ...data, key: null, enrollment: await issueEnrollment(data.id as string) };
}

/** Re-issue an enrollment ticket — rotation is re-provisioning, not key handling. */
export async function rotateEnrollment(supabase: DB, sourceId: string) {
  const { data, error } = await supabase
    .from("ingest_sources")
    .select("id")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Source not found");
  const { issueEnrollment } = await import("./enroll.server");
  return issueEnrollment(sourceId);
}

export async function setSourceState(supabase: DB, input: { sourceId: string; disabled: boolean }) {
  const { error } = await supabase
    .from("ingest_sources")
    .update({ disabled: input.disabled })
    .eq("id", input.sourceId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
