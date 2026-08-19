import type { TunnelConfig } from "./types";

/**
 * A thin, typed seam over the only Cloudflare endpoints the tunnel domain
 * needs. Every call in this app goes through `call`, so retries, error shape
 * and credential handling stay in exactly one place.
 */

const API = "https://api.cloudflare.com/client/v4";

export class TunnelError extends Error {}

export function tunnelConfig(): TunnelConfig | null {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const zoneId = process.env["CLOUDFLARE_ZONE_ID"];
  const domain = process.env["CLOUDFLARE_TUNNEL_DOMAIN"];
  if (!accountId || !token || !zoneId || !domain) return null;
  const team = process.env["CF_ACCESS_TEAM_DOMAIN"]?.trim();
  return {
    accountId,
    token,
    zoneId,
    domain: domain.replace(/^\.+|\.+$/g, ""),
    teamDomain: team ? `https://${team.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : null,
  };
}

/** The Zero Trust plane only needs an account and a token — no zone, no domain. */
export function zeroTrustConfig(): { accountId: string; token: string } | null {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  return accountId && token ? { accountId, token } : null;
}

export function missingZeroTrust(): string[] {
  return ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"].filter((name) => !process.env[name]);
}

export function missingConfig(): string[] {
  return ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CLOUDFLARE_TUNNEL_DOMAIN"].filter(
    (name) => !process.env[name],
  );
}

export async function call<T>(
  cfg: { accountId: string; token: string },
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    result?: T;
    errors?: { message: string }[];
  };
  if (!res.ok || body.success === false) {
    throw new TunnelError(
      `Cloudflare: ${body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`,
    );
  }
  return body.result as T;
}

type Named = { id: string };

export const CloudflareTunnels = {
  async create(cfg: TunnelConfig, name: string) {
    return call<Named & { name: string }>(cfg, `/accounts/${cfg.accountId}/cfd_tunnel`, {
      method: "POST",
      body: JSON.stringify({ name, config_src: "cloudflare" }),
    });
  },

  async token(cfg: TunnelConfig, tunnelId: string) {
    return call<string>(cfg, `/accounts/${cfg.accountId}/cfd_tunnel/${tunnelId}/token`);
  },

  /** Ingress is closed by default: one hostname to one path, everything else 404s. */
  async configure(cfg: TunnelConfig, tunnelId: string, hostname: string, service: string) {
    return call(cfg, `/accounts/${cfg.accountId}/cfd_tunnel/${tunnelId}/configurations`, {
      method: "PUT",
      body: JSON.stringify({
        config: {
          ingress: [
            { hostname, service, originRequest: { noTLSVerify: false, httpHostHeader: new URL(service).host } },
            { service: "http_status:404" },
          ],
        },
      }),
    });
  },

  async connections(cfg: TunnelConfig, tunnelId: string) {
    const result = await call<{ conns?: unknown[] }[]>(
      cfg,
      `/accounts/${cfg.accountId}/cfd_tunnel/${tunnelId}/connections`,
    );
    return Array.isArray(result) ? result.length : 0;
  },

  async remove(cfg: TunnelConfig, tunnelId: string) {
    await call(cfg, `/accounts/${cfg.accountId}/cfd_tunnel/${tunnelId}?cascade=true`, {
      method: "DELETE",
    });
  },
};

export const CloudflareDns = {
  async upsert(cfg: TunnelConfig, hostname: string, tunnelId: string) {
    return call<Named>(cfg, `/zones/${cfg.zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: "CNAME",
        name: hostname,
        content: `${tunnelId}.cfargotunnel.com`,
        proxied: true,
        comment: "Aegis managed tunnel",
      }),
    });
  },

  async remove(cfg: TunnelConfig, recordId: string) {
    await call(cfg, `/zones/${cfg.zoneId}/dns_records/${recordId}`, { method: "DELETE" });
  },
};

export const CloudflareAccess = {
  /** A self-hosted application in front of the hostname, plus an allow policy. */
  async createApp(cfg: TunnelConfig, name: string, hostname: string) {
    return call<{ id: string; aud: string }>(cfg, `/accounts/${cfg.accountId}/access/apps`, {
      method: "POST",
      body: JSON.stringify({
        name,
        domain: hostname,
        type: "self_hosted",
        session_duration: "30m",
        http_only_cookie_attribute: true,
        skip_interstitial: true,
      }),
    });
  },

  async allow(cfg: TunnelConfig, appId: string, emails: string[]) {
    return call<Named>(cfg, `/accounts/${cfg.accountId}/access/apps/${appId}/policies`, {
      method: "POST",
      body: JSON.stringify({
        name: "Aegis operators",
        decision: "allow",
        precedence: 1,
        include: emails.length ? emails.map((email) => ({ email: { email } })) : [{ everyone: {} }],
      }),
    });
  },

  async removeApp(cfg: TunnelConfig, appId: string) {
    await call(cfg, `/accounts/${cfg.accountId}/access/apps/${appId}`, { method: "DELETE" });
  },
};
