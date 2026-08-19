/**
 * DPoP (RFC 9449) — sender-constrained, single-use request proofs.
 *
 * Every request carries a freshly signed proof JWT bound to the method, URL,
 * access token and a server-issued nonce. Proof IDs are persisted for their
 * whole validity window, so a captured proof can never be replayed.
 */

const PROOF_SKEW_MS = 60_000;
const NONCE_TTL_MS = 5 * 60_000;
const ALLOWED_ALGS = new Set(["ES256", "ES384", "RS256", "PS256"]);

export type DpopMode = "required" | "preferred" | "disabled";
export type DpopProof = { jkt: string; jti: string };

export class DpopError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_dpop_proof" | "use_dpop_nonce" = "invalid_dpop_proof",
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(input: string | Uint8Array): Promise<ArrayBuffer> {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  return crypto.subtle.digest("SHA-256", data as BufferSource);
}

/** RFC 7638 JWK thumbprint — the stable identity of a client key. */
export async function jwkThumbprint(jwk: JsonWebKey): Promise<string> {
  const canonical =
    jwk.kty === "EC"
      ? JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
      : JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return bytesToB64url(await sha256(canonical));
}

/** Hash of the access token, bound into every proof so proofs can't be moved between tokens. */
export async function accessTokenHash(token: string): Promise<string> {
  return bytesToB64url(await sha256(token));
}

function nonceSecret(): Uint8Array {
  const secret = process.env["VAULT_ENCRYPTION_KEY"];
  if (!secret) throw new DpopError("Proof-of-possession is not configured on this broker");
  return encoder.encode(`dpop-nonce:${secret}`);
}

async function nonceMac(stamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    nonceSecret() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToB64url(await crypto.subtle.sign("HMAC", key, encoder.encode(stamp)));
}

/** Stateless, self-verifying nonce — no storage, no cross-instance coordination. */
export async function mintNonce(): Promise<string> {
  const stamp = Date.now().toString(36);
  return `${stamp}.${await nonceMac(stamp)}`;
}

async function nonceValid(nonce: string | undefined): Promise<boolean> {
  if (!nonce) return false;
  const [stamp, mac] = nonce.split(".");
  if (!stamp || !mac) return false;
  const issued = parseInt(stamp, 36);
  if (!Number.isFinite(issued) || Date.now() - issued > NONCE_TTL_MS) return false;
  return (await nonceMac(stamp)) === mac;
}

async function importKey(jwk: JsonWebKey, alg: string): Promise<CryptoKey> {
  const params: EcKeyImportParams | RsaHashedImportParams = alg.startsWith("ES")
    ? { name: "ECDSA", namedCurve: jwk.crv ?? "P-256" }
    : { name: alg === "PS256" ? "RSA-PSS" : "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  return crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["verify"], ext: true }, params, false, [
    "verify",
  ]);
}

function verifyParams(alg: string) {
  if (alg.startsWith("ES")) return { name: "ECDSA", hash: alg === "ES384" ? "SHA-384" : "SHA-256" };
  if (alg === "PS256") return { name: "RSA-PSS", saltLength: 32 };
  return { name: "RSASSA-PKCS1-v1_5" };
}

/** Persist the proof id for its lifetime; a second sighting is a replay. */
async function claimProofId(jti: string, jkt: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const expires = new Date(Date.now() + PROOF_SKEW_MS * 2).toISOString();
  const { error } = await supabaseAdmin.from("dpop_proofs").insert({ jti, jkt, expires_at: expires });
  if (!error) {
    if (Math.random() < 0.02) {
      await supabaseAdmin.from("dpop_proofs").delete().lt("expires_at", new Date().toISOString());
    }
    return true;
  }
  return false;
}

/**
 * Verify one DPoP proof against the request it claims to authorize.
 * Throws DpopError with `use_dpop_nonce` when the caller must retry with a fresh nonce.
 */
export async function verifyProof(input: {
  proof: string | null;
  method: string;
  url: string;
  accessToken?: string | null;
  /** Base64url SHA-256 of the request body, bound into the proof as `bdh`. */
  bodyHash?: string | null;
  requireNonce?: boolean;
}): Promise<DpopProof> {

  if (!input.proof) throw new DpopError("Missing DPoP proof");
  const parts = input.proof.split(".");
  if (parts.length !== 3) throw new DpopError("Malformed DPoP proof");
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

  let header: { typ?: string; alg?: string; jwk?: JsonWebKey };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(rawHeader)));
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(rawPayload)));
  } catch {
    throw new DpopError("Unreadable DPoP proof");
  }

  if (header.typ !== "dpop+jwt") throw new DpopError("Proof typ must be dpop+jwt");
  if (!header.alg || !ALLOWED_ALGS.has(header.alg)) throw new DpopError("Unsupported proof algorithm");
  const jwk = header.jwk;
  if (!jwk || !jwk.kty) throw new DpopError("Proof is missing its public key");
  if ("d" in jwk || "p" in jwk) throw new DpopError("Proof key must be public");

  const key = await importKey(jwk, header.alg);
  const ok = await crypto.subtle.verify(
    verifyParams(header.alg),
    key,
    b64urlToBytes(rawSignature) as BufferSource,
    encoder.encode(`${rawHeader}.${rawPayload}`),
  );
  if (!ok) throw new DpopError("Proof signature does not verify");

  if (String(claims["htm"]).toUpperCase() !== input.method.toUpperCase()) {
    throw new DpopError("Proof is bound to a different method");
  }
  const target = new URL(input.url);
  const htu = String(claims["htu"] ?? "");
  if (htu !== `${target.origin}${target.pathname}`) {
    throw new DpopError("Proof is bound to a different URL");
  }

  const iat = Number(claims["iat"]) * 1000;
  if (!Number.isFinite(iat) || Math.abs(Date.now() - iat) > PROOF_SKEW_MS) {
    throw new DpopError("Proof timestamp is outside the accepted window");
  }

  if (input.accessToken) {
    if (claims["ath"] !== (await accessTokenHash(input.accessToken))) {
      throw new DpopError("Proof is bound to a different access token");
    }
  }

  if (input.bodyHash && claims["bdh"] !== input.bodyHash) {
    throw new DpopError("Proof is bound to a different payload");
  }


  if (input.requireNonce && !(await nonceValid(claims["nonce"] as string | undefined))) {
    throw new DpopError("A fresh server nonce is required", "use_dpop_nonce");
  }

  const jti = String(claims["jti"] ?? "");
  if (jti.length < 8) throw new DpopError("Proof id is missing or too short");
  const jkt = await jwkThumbprint(jwk);
  if (!(await claimProofId(jti, jkt))) throw new DpopError("Proof has already been used");

  return { jkt, jti };
}

/** Resolve the effective mode from the broker default and any per-client override. */
export function effectiveMode(serverMode: string, clientMode: string | null): DpopMode {
  if (clientMode === "required" || clientMode === "disabled") return clientMode;
  return (["required", "preferred", "disabled"].includes(serverMode) ? serverMode : "preferred") as DpopMode;
}

/** Base64url SHA-256 of a request body — the value a client puts in `bdh`. */
export async function bodyDigest(body: string): Promise<string> {
  return bytesToB64url(await sha256(body));
}
