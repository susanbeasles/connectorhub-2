const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(): Promise<CryptoKey> {
  const secret = process.env["VAULT_ENCRYPTION_KEY"];
  if (!secret) throw new Error("VAULT_ENCRYPTION_KEY is not configured");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Envelope-encrypt a secret value. Output: v1.<iv>.<ciphertext> */
export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    enc.encode(plaintext),
  );
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(envelope: string): Promise<string> {
  const [version, iv, ct] = envelope.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Unsupported secret envelope");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await key(),
    unb64(ct),
  );
  return dec.decode(pt);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Short-lived opaque client token. */
export function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = b64(bytes).replace(/[+/=]/g, "").slice(0, 40);
  return `zt_${raw}`;
}
