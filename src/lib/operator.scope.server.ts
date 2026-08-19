/**
 * Server-side scope checks. The service-role client bypasses RLS, so every
 * server-fn that acts on a `serverId` must prove the target belongs to this
 * broker's operator estate before touching it.
 */
export async function assertServerScope(serverId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: server } = await supabaseAdmin
    .from("servers")
    .select("user_id")
    .eq("id", serverId)
    .maybeSingle();
  if (!server) throw new Error("Forbidden: unknown server");

  const { data: seat } = await supabaseAdmin
    .from("operators")
    .select("user_id")
    .eq("user_id", server.user_id)
    .maybeSingle();
  if (!seat) throw new Error("Forbidden: that server is outside this broker");
}
