import type { AccessIdentity } from "./types";

/**
 * Minimal, dependency-free verification of a Cloudflare Access assertion.
 * Keys are pulled from the team's certificate endpoint and cached briefly, so
 * a rotation at the edge propagates without a redeploy.
 */

type Jwk = JsonWebKey & { kid?: string; alg?: string; kty?: string };

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

export class AccessError extends Error {}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment))) as T;
}

async function certs(teamDomain: string, force = false): Promise<Jwk[]> {
  const hit = cache.get(teamDomain);
  if (!force && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.keys;
  const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AccessError(`Access certificates unreachable (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  cache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

function algorithm(alg: string) {
  if (alg === "RS256") return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
  if (alg === "ES256") return { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" } as const;
  throw new AccessError(`Unsupported Access signature algorithm: ${alg}`);
}

async function verifySignature(token: string, jwk: Jwk, alg: string): Promise<boolean> {
  const [head = "", body = "", signature = ""] = token.split(".");
  const params = algorithm(alg);
  const key = await crypto.subtle.importKey("jwk", jwk, params, false, ["verify"]);
  const verifyParams =
    params.name === "ECDSA" ? { name: "ECDSA", hash: "SHA-256" } : { name: params.name };
  return crypto.subtle.verify(
    verifyParams,
    key,
    b64urlToBytes(signature),
    new TextEncoder().encode(`${head}.${body}`),
  );
}

/** Throws on any failure; a returned identity is fully verified. */
export async function verifyAccessToken(input: {
  token: string;
  teamDomain: string;
  audiences: string[];
}): Promise<AccessIdentity> {
  const parts = input.token.split(".");
  if (parts.length !== 3) throw new AccessError("Malformed Access assertion");
  const [rawHeader = "", rawClaims = ""] = parts;

  const header = decodeJson<{ kid?: string; alg?: string }>(rawHeader);
  const alg = header.alg ?? "RS256";

  let keys = await certs(input.teamDomain);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await certs(input.teamDomain, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new AccessError("Access assertion signed by an unknown key");
  if (!(await verifySignature(input.token, jwk, alg))) {
    throw new AccessError("Access assertion signature failed");
  }

  const claims = decodeJson<{
    sub?: string;
    email?: string;
    iss?: string;
    aud?: string | string[];
    exp?: number;
    nbf?: number;
    common_name?: string;
    device_id?: string;
  }>(rawClaims);

  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) throw new AccessError("Access assertion expired");
  if (claims.nbf && claims.nbf > now + 60) throw new AccessError("Access assertion not yet valid");
  if (claims.iss !== input.teamDomain) throw new AccessError("Access assertion issued elsewhere");

  const audience = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (input.audiences.length && !audience.some((a) => input.audiences.includes(a))) {
    throw new AccessError("Access assertion is for a different application");
  }

  return {
    subject: claims.sub ?? claims.common_name ?? "unknown",
    email: claims.email ?? null,
    issuer: claims.iss,
    audience,
    deviceId: claims.device_id ?? null,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}
