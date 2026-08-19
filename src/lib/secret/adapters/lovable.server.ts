import type { Custody, SecretBroker } from "../broker";
import { LocalKek, keyFromSecret, randomBytes, unb64, b64, type DataKey } from "../envelope";
import { Lease, type LeaseTerms } from "../lease";
import { refOf, refParse, type SecretRef } from "../ref";

/**
 * The default host. There is no external secret store, so a filed secret is
 * its own reference: the value is sealed with the deployment key and the
 * ciphertext travels inside the `sealed://` URI, in the same column any other
 * reference would occupy. Moving to AWS or Cloudflare later changes the scheme
 * of new references and nothing else.
 *
 * This is the weakest of the three custodies — the key-encryption key is
 * process configuration rather than hardware — and `custody()` says so, so the
 * console can report it honestly instead of implying parity.
 */

async function kek(): Promise<Uint8Array> {
  const secret = process.env["VAULT_ENCRYPTION_KEY"];
  if (!secret) throw new Error("VAULT_ENCRYPTION_KEY is not configured");
  return keyFromSecret(secret);
}

export function lovableBroker(): SecretBroker {
  return {
    host: "lovable",

    async resolve(ref: SecretRef, terms?: LeaseTerms) {
      const { locator } = refParse(ref);
      const key = await kek();
      const raw = unb64(locator);
      const plaintext = await LocalKek.unwrap(key, raw);
      key.fill(0);
      return Lease.of(plaintext, terms);
    },

    async put(_name: string, value: string) {
      const key = await kek();
      const sealed = await LocalKek.wrap(key, new TextEncoder().encode(value));
      key.fill(0);
      return refOf("sealed", b64(sealed));
    },

    async destroy() {
      // The value lives inside the reference; deleting the row destroys it.
    },

    async sign(input: string) {
      // No external key service here, so the deployment's own sealed ES256 key
      // signs. It is the weakest custody of the three and `custody()` says so.
      const { vaultSigner } = await import("@/lib/signing/vault.server");
      const s = vaultSigner();
      return { signature: await s.sign(input), keyId: await s.keyId(), alg: "ES256" as const };
    },

    async deriveDataKey(): Promise<DataKey> {
      const key = await kek();
      const plaintext = randomBytes(32);
      const wrapped = await LocalKek.wrap(key, plaintext);
      key.fill(0);
      return { plaintext, wrapped };
    },

    async unwrap(wrapped: Uint8Array) {
      const key = await kek();
      const dek = await LocalKek.unwrap(key, wrapped);
      key.fill(0);
      return dek;
    },

    custody(): Custody {
      return {
        host: "lovable",
        store: "Sealed in this deployment's database",
        kek: "Deployment key held in process configuration",
        signing: "ES256 key sealed in the database, unsealed only to sign",
        hardware: false,
      };
    },
  };
}
