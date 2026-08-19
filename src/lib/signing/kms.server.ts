import { AwsClient } from "aws4fetch";
import type { Signer } from "./types";

/**
 * AWS KMS asymmetric signer. The private key is generated in, and never leaves,
 * the HSM — the broker can only ask KMS to sign, never to export.
 */

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesFromB64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

/** KMS returns DER-encoded ECDSA signatures; JWS wants fixed-width r||s. */
function derToRaw(der: Uint8Array, size = 32): Uint8Array {
  let offset = 2;
  if (der[1]! & 0x80) offset += der[1]! & 0x7f;
  const read = () => {
    offset += 1;
    const length = der[offset]!;
    offset += 1;
    let value = der.subarray(offset, offset + length);
    offset += length;
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    const padded = new Uint8Array(size);
    padded.set(value, size - value.length);
    return padded;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(size * 2);
  raw.set(r, 0);
  raw.set(s, size);
  return raw;
}

function b64FromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export type KmsCredentials = {
  region: string;
  access: string;
  secret: string;
  session?: string;
};

/**
 * Credentials are resolved per call rather than captured, so short-lived
 * federated sessions can expire without stranding the signer.
 */
export function kmsSigner(config: {
  keyId: string;
  resolve: () => Promise<KmsCredentials>;
}): Signer {
  let cachedJwk: JsonWebKey | null = null;

  const call = async (target: string, body: Record<string, unknown>) => {
    const creds = await config.resolve();
    const client = new AwsClient({
      accessKeyId: creds.access,
      secretAccessKey: creds.secret,
      ...(creds.session ? { sessionToken: creds.session } : {}),
      region: creds.region,
      service: "kms",
    });
    const endpoint = `https://kms.${creds.region}.amazonaws.com/`;
    const res = await client.fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `TrentService.${target}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`KMS ${target} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, string>;
  };

  return {
    custody: () => "kms",
    keyId: async () => config.keyId.split("/").pop() ?? config.keyId,
    async publicJwk() {
      if (cachedJwk) return cachedJwk;
      const { PublicKey } = await call("GetPublicKey", { KeyId: config.keyId });
      const key = await crypto.subtle.importKey(
        "spki",
        bytesFromB64(PublicKey!) as BufferSource,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      );
      cachedJwk = await crypto.subtle.exportKey("jwk", key);
      return cachedJwk;
    },
    async sign(input: string) {
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
      );
      const { Signature } = await call("Sign", {
        KeyId: config.keyId,
        Message: b64FromBytes(digest),
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      });
      return b64urlFromBytes(derToRaw(bytesFromB64(Signature!)));
    },
  };
}
