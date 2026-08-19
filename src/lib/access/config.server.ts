import type { AccessConfig, AccessMode, AccessSurface } from "./types";

/**
 * Access is configured entirely from deployment environment: the broker never
 * stores the tunnel's trust anchors in its own database, so a compromised
 * database cannot loosen the edge gate.
 */

const MODES: AccessMode[] = ["off", "monitor", "enforce"];

function list(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function teamDomain(): string | null {
  const raw = process.env["CF_ACCESS_TEAM_DOMAIN"]?.trim();
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}`;
}

export function accessConfig(): AccessConfig {
  const declared = process.env["CF_ACCESS_MODE"]?.trim() as AccessMode | undefined;
  const console_ = list(process.env["CF_ACCESS_AUD"]);
  const proxy = list(process.env["CF_ACCESS_PROXY_AUD"]);
  const domain = teamDomain();
  const mode: AccessMode =
    declared && MODES.includes(declared) ? declared : domain && console_.length ? "enforce" : "off";
  return { mode, teamDomain: domain, audiences: { console: console_, proxy } };
}

export function audienceFor(config: AccessConfig, surface: AccessSurface): string[] {
  const own = config.audiences[surface];
  return own.length ? own : config.audiences.console;
}
