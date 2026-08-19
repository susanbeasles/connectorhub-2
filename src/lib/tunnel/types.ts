/** The vocabulary of a fully managed Cloudflare Zero Trust tunnel. */

export type TunnelStatus = "pending" | "live" | "degraded" | "failed" | "removed";

export type TunnelSpec = {
  serverId: string;
  userId: string;
  slug: string;
  origin: string;
};

export type Tunnel = {
  serverId: string;
  tunnelId: string;
  tunnelName: string;
  hostname: string;
  accessAppId: string | null;
  accessAud: string | null;
  dnsRecordId: string | null;
  status: TunnelStatus;
  connectors: number;
  lastError: string | null;
  lastCheckedAt: string | null;
};

export type TunnelConfig = {
  accountId: string;
  token: string;
  zoneId: string;
  domain: string;
  teamDomain: string | null;
};
