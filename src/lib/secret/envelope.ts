/**
 * Envelope encryption, written once and shared by every host adapter.
 *
 * High-cardinality secrets — one refresh token per user per server — do not
 * belong in a secret manager: the cost, quota and rotation model of those
 * services is built for tens of values, not tens of thousands. They are sealed
 * here instead, under a data key the host mints and only the host can unwrap.
 * The record holds the wrapped key beside the ciphertext, so a database dump
 * is inert without a call the host's own access control governs and logs.
 */

const enc = new TextEncoder();

export type DataKey = {
  /** Live only for this operation; the caller must zeroize it. */
  plaintext: Uint8Array;
  /** Opaque to the application; only the host that minted it can unwrap it. */
  wrapped: Uint8Array;
};

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

async function aesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw.slice().buffer as ArrayBuffer, { name: "AES-GCM" }, false, usage);
}

/** A sealed record: e1.<wrapped key>.<iv>.<ciphertext>. Safe at rest, useless alone. */
export async function sealWith(dataKey: DataKey, plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(dataKey.plaintext, ["encrypt"]),
    enc.encode(plaintext),
  );
  return `e1.${b64(dataKey.wrapped)}.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export type SealedParts = { wrapped: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array };

export function sealedParse(record: string): SealedParts {
  const [version, wrapped, iv, ct] = record.split(".");
  if (version !== "e1" || !wrapped || !iv || !ct) throw new Error("Unsupported sealed record");
  return { wrapped: unb64(wrapped), iv: unb64(iv), ciphertext: unb64(ct) };
}

export function isSealed(value: string): boolean {
  return value.startsWith("e1.");
}

/** Open a record with an already-unwrapped data key. The key is zeroized here. */
export async function openWith(key: Uint8Array, parts: SealedParts): Promise<Uint8Array> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: parts.iv.slice().buffer as ArrayBuffer },
      await aesKey(key, ["decrypt"]),
      parts.ciphertext.slice().buffer as ArrayBuffer,
    );
    return new Uint8Array(pt);
  } finally {
    key.fill(0);
  }
}

/** Wrap and unwrap a data key with a locally held key-encryption key. */
export const LocalKek = {
  async wrap(kek: Uint8Array, dek: Uint8Array): Promise<Uint8Array> {
    const iv = randomBytes(12);
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey(kek, ["encrypt"]),
      dek.slice().buffer as ArrayBuffer,
    );
    const out = new Uint8Array(iv.length + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), iv.length);
    return out;
  },

  async unwrap(kek: Uint8Array, wrapped: Uint8Array): Promise<Uint8Array> {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrapped.slice(0, 12).buffer as ArrayBuffer },
      await aesKey(kek, ["decrypt"]),
      wrapped.slice(12).buffer as ArrayBuffer,
    );
    return new Uint8Array(pt);
  },
};

/** Derive a 32-byte key from a passphrase-shaped configuration value. */
export async function keyFromSecret(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}
