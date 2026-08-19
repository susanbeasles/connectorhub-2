/** Cloudflare Access (Zero Trust) edge identity, as the broker understands it. */

export type AccessMode = "off" | "monitor" | "enforce";

export type AccessSurface = "console" | "proxy";

export type AccessIdentity = {
  subject: string;
  email: string | null;
  issuer: string;
  audience: string[];
  deviceId: string | null;
  expiresAt: string;
};

export type AccessConfig = {
  mode: AccessMode;
  teamDomain: string | null;
  audiences: Record<AccessSurface, string[]>;
};

export type AccessVerdict = {
  configured: boolean;
  mode: AccessMode;
  surface: AccessSurface;
  allowed: boolean;
  identity: AccessIdentity | null;
  reason: string | null;
};
