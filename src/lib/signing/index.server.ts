import { vaultSigner } from "./vault.server";
import type { Signer } from "./types";

/**
 * Two keys, two jobs, one boundary.
 *
 * `bootstrapSigner` is the federation identity. Its private half is sealed with
 * the deployment's vault key and stored server-side, so possession of the
 * database alone is not enough to forge it. It signs exactly one thing — the
 * web-identity assertion AWS trusts — and nothing else, which keeps its blast
 * radius equal to the tiny control role it can assume.
 *
 * `brokerSigner` signs everything the broker issues to the outside world. Once
 * an AWS account is federated with a KMS key, that key is generated in and
 * never leaves the HSM, so no amount of access to Aegis's own storage yields
 * the ability to forge a broker signature. Until then it falls back to the
 * sealed key, and the console reports which custody is actually in force.
 */

let bootstrap: Signer | null = null;
let broker: Signer | null = null;

export function bootstrapSigner(): Signer {
  if (!bootstrap) bootstrap = vaultSigner();
  return bootstrap;
}

export async function brokerSigner(): Promise<Signer> {
  if (broker) return broker;
  try {
    const { allows } = await import("@/lib/stage/stage.server");
    const { federationLoad, credentials } = await import("@/lib/deploy/aws/federation.server");
    const config = (await allows("signing:kms")) ? await federationLoad() : null;
    if (config?.kmsKeyArn) {
      const { kmsSigner } = await import("./kms.server");
      broker = kmsSigner({
        keyId: config.kmsKeyArn,
        resolve: async () => {
          const creds = await credentials();
          if (!creds) throw new Error("AWS federation is not available for KMS signing");
          return creds;
        },
      });
      return broker;
    }
  } catch {
    // A federation outage must not take the broker's signing capability with it.
  }
  broker = bootstrapSigner();
  return broker;
}

/** Discard memoised custody after a federation change so the next sign re-resolves. */
export function resetBrokerSigner() {
  broker = null;
}

export function encodeSegment(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Compact JWS over a JSON payload, signed by whichever key is in custody. */
export async function signJws(payload: Record<string, unknown>, using?: Signer): Promise<string> {
  const s = using ?? (await brokerSigner());
  const input = `${encodeSegment({ alg: "ES256", typ: "JWT", kid: await s.keyId() })}.${encodeSegment(payload)}`;
  return `${input}.${await s.sign(input)}`;
}

/** Back-compat alias: consumers that just want "the broker's public identity". */
export function signer(): Signer {
  return bootstrapSigner();
}

export type { Signer } from "./types";
