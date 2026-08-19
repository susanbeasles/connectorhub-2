import type { DataKey } from "./envelope";
import type { Lease, LeaseTerms } from "./lease";
import type { SecretRef } from "./ref";

/**
 * The one interface every host adapter implements, and the only shape the rest
 * of the application ever sees. Choosing AWS over Cloudflare over Lovable swaps
 * exactly one file behind this type: no call site, stored reference, MCP
 * handler, OAuth path or configuration changes with it.
 *
 * The surface is capability-first by design. `sign` and `deriveDataKey` perform
 * the cryptographic operation inside the host boundary and return an artefact
 * that is not a credential. `resolve` — the only method that hands back usable
 * plaintext — is the documented fallback, reserved for values a protocol
 * genuinely requires in the clear, such as an OAuth client secret at a token
 * endpoint.
 */

export type Host = "lovable" | "aws" | "cloudflare";

export type Custody = {
  host: Host;
  /** Where low-cardinality secrets are filed, in plain language. */
  store: string;
  /** What holds the key-encryption key for sealed records. */
  kek: string;
  /** Where the signing private key lives and whether it can be read back. */
  signing: string;
  /** True only when the KEK lives in hardware the application cannot export. */
  hardware: boolean;
};

/** A signature produced without the private key ever entering this process. */
export type Signature = { signature: string; keyId: string; alg: "ES256" };

export type SecretBroker = {
  readonly host: Host;

  /**
   * Sign inside the host boundary. `keyRef` names a key the broker may use and
   * may never read; where the host supports it, the key is non-exportable by
   * construction. Callers get a signature, never key material.
   */
  sign(input: string, keyRef?: string | null): Promise<Signature>;

  /** Mint a data key for one sealing operation. */
  deriveDataKey(): Promise<DataKey>;

  /** Recover a data key from its wrapped form. */
  unwrap(wrapped: Uint8Array): Promise<Uint8Array>;

  /** File a new value and return the reference that names it. */
  put(name: string, value: string): Promise<SecretRef>;

  /** Destroy the value this reference names, where the store allows it. */
  destroy(ref: SecretRef): Promise<void>;

  /** Fallback: fetch a value by reference, leased and zeroized. */
  resolve(ref: SecretRef, terms?: LeaseTerms): Promise<Lease>;

  custody(): Custody;
};
