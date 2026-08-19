import { Secret } from "../secret/index.server";
import {
  CloudflareAccess,
  CloudflareDns,
  CloudflareTunnels,
  missingConfig,
  tunnelConfig,
} from "./api.server";
import type { Tunnel as TunnelRow, TunnelSpec, TunnelStatus } from "./types";

/**
 * The single entrypoint for Cloudflare Zero Trust tunnels. Provisioning a
 * broker's private ingress — tunnel, DNS, Access application and policy — is
 * one call, and tearing it back down is one call, so no caller ever has to
 * know the order those resources depend on each other.
 */

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function toTunnel(row: Record<string, unknown>): TunnelRow {
  return {
    serverId: row["server_id"] as string,
    tunnelId: row["tunnel_id"] as string,
    tunnelName: row["tunnel_name"] as string,
    hostname: row["hostname"] as string,
    accessAppId: (row["access_app_id"] as string) ?? null,
    accessAud: (row["access_aud"] as string) ?? null,
    dnsRecordId: (row["dns_record_id"] as string) ?? null,
    status: (row["status"] as TunnelStatus) ?? "pending",
    connectors: (row["connectors"] as number) ?? 0,
    lastError: (row["last_error"] as string) ?? null,
    lastCheckedAt: (row["last_checked_at"] as string) ?? null,
  };
}

async function record(event: {
  userId: string;
  serverId: string;
  action: string;
  status: string;
  detail?: string;
}) {
  const admin = await db();
  await admin.from("deploy_events").insert({
    user_id: event.userId,
    server_id: event.serverId,
    action: event.action,
    status: event.status,
    detail: event.detail ?? "",
  });
}

async function loadSpec(serverId: string, origin: string): Promise<TunnelSpec> {
  const admin = await db();
  const { data } = await admin
    .from("servers")
    .select("id, user_id, slug")
    .eq("id", serverId)
    .maybeSingle();
  if (!data) throw new Error("Broker not found");
  return { serverId: data.id, userId: data.user_id, slug: data.slug, origin };
}

async function operatorEmails(): Promise<string[]> {
  const admin = await db();
  const { data } = await admin.from("operators").select("email");
  return (data ?? []).map((r) => r.email as string).filter(Boolean);
}

export const Tunnel = {
  available: () => tunnelConfig() !== null,
  missing: () => missingConfig(),

  async status(serverId: string): Promise<TunnelRow | null> {
    const admin = await db();
    const { data } = await admin.from("tunnels").select("*").eq("server_id", serverId).maybeSingle();
    return data && data.status !== "removed" ? toTunnel(data as Record<string, unknown>) : null;
  },

  /** Every Access audience this broker provisioned — the proxy gate trusts these. */
  async audiences(): Promise<string[]> {
    const admin = await db();
    const { data } = await admin.from("tunnels").select("access_aud").eq("status", "live");
    return (data ?? []).map((r) => r.access_aud as string).filter(Boolean);
  },

  async fleet() {
    const admin = await db();
    const { data } = await admin.from("tunnels").select("*").neq("status", "removed");
    return (data ?? []).map((row) => toTunnel(row as Record<string, unknown>));
  },

  /** Idempotent: an existing tunnel is torn down and replaced, never duplicated. */
  async provision(serverId: string, origin: string): Promise<TunnelRow> {
    const cfg = tunnelConfig();
    if (!cfg) throw new Error(`Cloudflare tunnels need ${missingConfig().join(", ")}`);
    const spec = await loadSpec(serverId, origin);
    const admin = await db();
    await Tunnel.teardown(serverId).catch(() => undefined);

    const name = `aegis-${spec.slug}-${spec.serverId.slice(0, 8)}`;
    const hostname = `${spec.slug}.${cfg.domain}`;
    const service = `${origin.replace(/\/+$/, "")}`;

    try {
      const tunnel = await CloudflareTunnels.create(cfg, name);
      await CloudflareTunnels.configure(cfg, tunnel.id, hostname, service);
      const dns = await CloudflareDns.upsert(cfg, hostname, tunnel.id);
      const app = await CloudflareAccess.createApp(cfg, `Aegis · ${spec.slug}`, hostname);
      await CloudflareAccess.allow(cfg, app.id, await operatorEmails());
      const token = await CloudflareTunnels.token(cfg, tunnel.id);

      const { data } = await admin
        .from("tunnels")
        .upsert(
          {
            user_id: spec.userId,
            server_id: serverId,
            tunnel_id: tunnel.id,
            tunnel_name: name,
            hostname,
            dns_record_id: dns.id,
            access_app_id: app.id,
            access_aud: app.aud,
            connector_token: await Secret.put(`tunnel/${name}/connector`, token),
            status: "live",
            connectors: 0,
            last_error: null,
            last_checked_at: new Date().toISOString(),
          },
          { onConflict: "server_id" },
        )
        .select("*")
        .maybeSingle();

      await record({ userId: spec.userId, serverId, action: "tunnel.provision", status: "live", detail: hostname });
      return toTunnel(data as Record<string, unknown>);
    } catch (e) {
      const detail = (e as Error).message;
      await admin.from("tunnels").upsert(
        {
          user_id: spec.userId,
          server_id: serverId,
          tunnel_id: "",
          tunnel_name: name,
          hostname,
          status: "failed",
          last_error: detail,
        },
        { onConflict: "server_id" },
      );
      await record({ userId: spec.userId, serverId, action: "tunnel.provision", status: "failed", detail });
      throw e;
    }
  },

  /** The connector token, decrypted on demand and never persisted in plaintext. */
  async connectorToken(serverId: string): Promise<{ hostname: string; token: string }> {
    const admin = await db();
    const { data } = await admin
      .from("tunnels")
      .select("hostname, connector_token")
      .eq("server_id", serverId)
      .maybeSingle();
    if (!data?.connector_token) throw new Error("This broker has no provisioned tunnel");
    return {
      hostname: data.hostname as string,
      token: await Secret.use(data.connector_token as string, (value) => value),
    };
  },

  async teardown(serverId: string) {
    const cfg = tunnelConfig();
    const current = await Tunnel.status(serverId);
    if (!cfg || !current) return { ok: true };
    if (current.accessAppId) await CloudflareAccess.removeApp(cfg, current.accessAppId).catch(() => undefined);
    if (current.dnsRecordId) await CloudflareDns.remove(cfg, current.dnsRecordId).catch(() => undefined);
    if (current.tunnelId) await CloudflareTunnels.remove(cfg, current.tunnelId).catch(() => undefined);
    const admin = await db();
    await admin
      .from("tunnels")
      .update({ status: "removed", connector_token: null, connectors: 0 })
      .eq("server_id", serverId);
    return { ok: true };
  },

  /** Probe the edge: a tunnel with no connector is up but unreachable. */
  async reconcile(serverId: string, origin: string) {
    const cfg = tunnelConfig();
    const current = await Tunnel.status(serverId);
    if (!cfg || !current) return { status: "absent" as const };
    const admin = await db();
    try {
      const connectors = await CloudflareTunnels.connections(cfg, current.tunnelId);
      const status: TunnelStatus = connectors > 0 ? "live" : "degraded";
      await admin
        .from("tunnels")
        .update({ connectors, status, last_error: null, last_checked_at: new Date().toISOString() })
        .eq("server_id", serverId);
      return { status, connectors };
    } catch (e) {
      await admin
        .from("tunnels")
        .update({ status: "failed", last_error: (e as Error).message })
        .eq("server_id", serverId);
      void origin;
      return { status: "failed" as const, connectors: 0 };
    }
  },

  async reconcileAll(origin: string) {
    const fleet = await Tunnel.fleet();
    const results = await Promise.all(
      fleet.map(async (t) => ({ serverId: t.serverId, ...(await Tunnel.reconcile(t.serverId, origin)) })),
    );
    return { checked: results.length, results };
  },
};

export type { Tunnel as TunnelRecord } from "./types";

