import type { Custody, Host, SecretBroker, Signature } from "./broker";
import { isSealed, sealWith, sealedParse, openWith } from "./envelope";
import { Lease, type LeaseTerms } from "./lease";
import { hostRead } from "./host.server";
import { isRef, refParse, type SecretRef } from "./ref";

/**
 * The single door to secret material. Every consumer in the application —
 * MCP handlers, the OAuth server, the outbound proxy, tunnels, integrations —
 * goes through `Secret` and never learns which host is underneath.
 *
 * The interface is deliberately ordered by custody strength. `sign` and
 * `seal` are capability operations: the caller gets a signature or a sealed
 * record and no reusable credential ever enters its scope. `decryptForUse`
 * bounds plaintext to one callback. `resolve` — plaintext handed back on a
 * lease — is the fallback, used only where a protocol requires the value
 * itself, and it is never used for an upstream access token.
 *
 * Two rules hold everywhere:
 *
 *   Resolution follows the reference. A `SecretRef` names its own scheme, so a
 *   value filed under one host stays readable after the deployment moves, and
 *   optional 1Password custody works identically on all three.
 *
 *   Filing follows the host. New secrets go to whatever store the configured
 *   host owns, which is the only decision that changes when the host changes.
 */

async function broker(): Promise<SecretBroker> {
  switch (await hostRead()) {
    case "aws": {
      const { awsBroker } = await import("./adapters/aws.server");
      return awsBroker();
    }
    case "cloudflare": {
      const { cloudflareBroker } = await import("./adapters/cloudflare.server");
      return cloudflareBroker();
    }
    default: {
      const { lovableBroker } = await import("./adapters/lovable.server");
      return lovableBroker();
    }
  }
}

export const Secret = {
  /**
   * Sign inside the host boundary. Preferred over every form of secret
   * retrieval: the upstream receives a signature and the private key never
   * exists as bytes this process could leak.
   */
  async sign(input: string, keyRef?: string | null): Promise<Signature> {
    return (await broker()).sign(input, keyRef ?? null);
  },

  /**
   * Seal a high-cardinality value — a per-user grant — under a host data key.
   * The record is safe to store beside the row it belongs to and is inert
   * without the host's unwrap call.
   */
  async seal(plaintext: string): Promise<string> {
    const key = await (await broker()).deriveDataKey();
    try {
      return await sealWith(key, plaintext);
    } finally {
      key.plaintext.fill(0);
    }
  },

  /**
   * Open a sealed record for exactly one scope. The data key is unwrapped per
   * call and the plaintext is overwritten however the scope ends — including
   * on a throw. Nothing the callback returns may contain the value.
   */
  async decryptForUse<T>(record: string, use: (value: string) => T | Promise<T>): Promise<T> {
    if (!isSealed(record)) throw new Error("Not a sealed record");
    const parts = sealedParse(record);
    const dek = await (await broker()).unwrap(parts.wrapped);
    const lease = Lease.of(await openWith(dek, parts));
    try {
      return await lease.use(use);
    } finally {
      lease.dispose();
    }
  },

  /**
   * Fallback. Plaintext on a lease, for protocol values that cannot be
   * replaced by a signature — an OAuth client secret at a token endpoint, a
   * provider API key an upstream insists on. Never for an access token.
   */
  async resolve(ref: SecretRef | string, terms?: LeaseTerms): Promise<Lease> {
    // Rows written before custody moved to the broker hold raw ciphertext from
    // the sealed bootstrap key. They resolve unchanged and re-file themselves
    // the next time their owner rotates them; nothing needs a data migration.
    if (!isRef(ref)) {
      if (isSealed(ref)) {
        const parts = sealedParse(ref);
        const dek = await (await broker()).unwrap(parts.wrapped);
        return Lease.of(await openWith(dek, parts), terms);
      }
      const { decryptSecret } = await import("@/lib/crypto.server");
      return Lease.ofText(await decryptSecret(ref), terms);
    }
    const parsed = refParse(ref);
    if (parsed.scheme === "op") {
      const { opResolve } = await import("./adapters/onepassword.server");
      return opResolve(ref as SecretRef, terms);
    }
    return (await broker()).resolve(ref as SecretRef, terms);
  },

  /** Borrow a referenced value for exactly one scope. */
  async use<T>(ref: SecretRef | string, consume: (value: string) => T | Promise<T>): Promise<T> {
    const lease = await Secret.resolve(ref);
    try {
      return await lease.use(consume);
    } finally {
      lease.dispose();
    }
  },

  put(name: string, value: string): Promise<SecretRef> {
    return broker().then((b) => b.put(name, value));
  },

  destroy(ref: SecretRef | string): Promise<void> {
    return broker().then((b) => b.destroy(ref as SecretRef));
  },

  async custody(): Promise<Custody> {
    return (await broker()).custody();
  },

  host(): Promise<Host> {
    return hostRead();
  },
};

export type { Custody, Host, Signature } from "./broker";
export type { SecretRef } from "./ref";
export { Lease } from "./lease";
