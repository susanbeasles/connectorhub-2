import { decryptSecret, encryptSecret } from "@/lib/crypto.server";
import type { Signer } from "./types";

/**
 * Software signer with a durable identity: the ES256 private key is generated
 * once, sealed with the vault key, and stored server-side. No user, browser or
 * console path can read it — only privileged server code can unseal it.
 *
 * Weaker custody than an HSM (the key material exists in memory while signing),
 * but the broker's public identity survives restarts and scales across
 * instances without any external key service.
 */

type Material = { keyId: string; publicJwk: JsonWebKey; privateKey: CryptoKey };

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function thumbprint(jwk: JsonWebKey): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return b64url(digest).slice(0, 16);
}

async function importPrivate(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function load(): Promise<Material | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("signing_keys")
    .select("kid, public_jwk, private_jwk_encrypted")
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  const privateJwk = JSON.parse(await decryptSecret(data.private_jwk_encrypted)) as JsonWebKey;
  return {
    keyId: data.kid,
    publicJwk: data.public_jwk as JsonWebKey,
    privateKey: await importPrivate(privateJwk),
  };
}

async function create(): Promise<Material> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const kid = await thumbprint(publicJwk);
  const { error } = await supabaseAdmin.from("signing_keys").insert({
    kid,
    public_jwk: JSON.parse(JSON.stringify(publicJwk)),
    private_jwk_encrypted: await encryptSecret(JSON.stringify(privateJwk)),
  });
  // A concurrent instance may have won the race; its key is the one that counts.
  if (error) {
    const existing = await load();
    if (existing) return existing;
    throw new Error(`Unable to establish a broker signing key: ${error.message}`);
  }
  return { keyId: kid, publicJwk, privateKey: await importPrivate(privateJwk) };
}

let material: Promise<Material> | null = null;

function resolve(): Promise<Material> {
  material ??= load().then((found) => found ?? create());
  return material;
}

export function vaultSigner(): Signer {
  return {
    custody: () => "vault",
    keyId: async () => (await resolve()).keyId,
    publicJwk: async () => (await resolve()).publicJwk,
    async sign(input: string) {
      const { privateKey } = await resolve();
      return b64url(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          privateKey,
          new TextEncoder().encode(input),
        ),
      );
    },
  };
}
