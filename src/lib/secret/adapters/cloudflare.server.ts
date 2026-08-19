import type { Custody, SecretBroker } from "../broker";
import { LocalKek, randomBytes, type DataKey } from "../envelope";
import { Lease, type LeaseTerms } from "../lease";
import { refOf, refParse, type SecretRef } from "../ref";

/**
 * Cloudflare custody. Secrets Store holds the app-level secrets; the
 * key-encryption key that seals per-user grants is one of them, fetched at use
 * and zeroized immediately.
 *
 * Cloudflare offers no HSM, so the KEK is software-held and `custody()` reports
 * `hardware: false`. That is a real difference from AWS and the console states
 * it rather than papering over it. Workers KV is deliberately not used for any
 * of this: it is eventually consistent and its values are plaintext to the
 * platform, which disqualifies it for secret material.
 */

type Config = { accountId: string; token: string; storeId: string };

function config(): Config {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const storeId = process.env["CLOUDFLARE_SECRETS_STORE_ID"];
  if (!accountId || !token || !storeId) throw new Error("Cloudflare secret store is not configured");
  return { accountId, token, storeId };
}

async function store<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = config();
  const { call } = await import("@/lib/tunnel/api.server");
  return call<T>(
    { accountId: cfg.accountId, token: cfg.token },
    `/accounts/${cfg.accountId}/secrets_store/stores/${cfg.storeId}${path}`,
    init,
  );
}

const KEK_NAME = "AEGIS_KEK";

async function read(name: string): Promise<string> {
  const out = await store<{ value?: string }>(`/secrets/${encodeURIComponent(name)}/value`);
  if (!out?.value) throw new Error(`Cloudflare secret ${name} is empty or unreadable`);
  return out.value;
}

async function kek(): Promise<Uint8Array> {
  const { keyFromSecret } = await import("../envelope");
  return keyFromSecret(await read(KEK_NAME));
}

export function cloudflareBroker(): SecretBroker {
  return {
    host: "cloudflare",

    async resolve(ref: SecretRef, terms?: LeaseTerms) {
      const { locator } = refParse(ref);
      return Lease.ofText(await read(locator), terms);
    },

    async put(name: string, value: string) {
      const key = `AEGIS_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
      await store("/secrets", {
        method: "POST",
        body: JSON.stringify([{ name: key, value, scopes: ["workers"] }]),
      });
      return refOf("cf-secrets", key);
    },

    async destroy(ref: SecretRef) {
      const { locator } = refParse(ref);
      await store(`/secrets/${encodeURIComponent(locator)}`, { method: "DELETE" });
    },

    async sign(input: string) {
      // Cloudflare exposes no signing service, so the deployment's sealed
      // ES256 key signs and `custody()` reports the software boundary.
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
        host: "cloudflare",
        store: "Cloudflare Secrets Store in your account",
        kek: "Key-encryption key held in Secrets Store (software)",
        signing: "ES256 key sealed in the database, unsealed only to sign",
        hardware: false,
      };
    },
  };
}
