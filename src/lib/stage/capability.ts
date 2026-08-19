/**
 * The rollout matrix: which infrastructure each stage is allowed to touch.
 *
 * This file is pure and has no imports on purpose. It is the single statement
 * of what "sandbox" and "production" mean, so every boundary — runtimes,
 * signing custody, secret custody, archival, the edge gate — asks the same
 * question and cannot drift apart. Adding a concern is one row here.
 */

export type Stage = "sandbox" | "production";

export const STAGES: Stage[] = ["sandbox", "production"];

export type Capability =
  /** Run brokers inside this application's own worker. */
  | "runtime:inline"
  /** Run brokers on Cloudflare Workers for Platforms. */
  | "runtime:cloudflare"
  /** Run brokers on a dedicated AWS Lambda per broker. */
  | "runtime:lambda"
  /** Let the network gate actually block, rather than verify and report. */
  | "gate:enforce"
  /** Sign broker-issued tokens with the HSM key in the operator's AWS account. */
  | "signing:kms"
  /** File new provider secrets into the 1Password tier vaults. */
  | "custody:vault"
  /** Offload the wire ledger to the operator's S3 bucket. */
  | "archive:s3";

const MATRIX: Record<Stage, Record<Capability, boolean>> = {
  sandbox: {
    "runtime:inline": true,
    "runtime:cloudflare": false,
    "runtime:lambda": false,
    "gate:enforce": false,
    "signing:kms": false,
    "custody:vault": false,
    "archive:s3": false,
  },
  production: {
    "runtime:inline": false,
    "runtime:cloudflare": true,
    "runtime:lambda": true,
    "gate:enforce": true,
    "signing:kms": true,
    "custody:vault": true,
    "archive:s3": true,
  },
};

export function permits(stage: Stage, capability: Capability): boolean {
  return MATRIX[stage][capability];
}

/** Everything a stage permits, for the console to render without guessing. */
export function capabilities(stage: Stage): Capability[] {
  return (Object.keys(MATRIX[stage]) as Capability[]).filter((c) => MATRIX[stage][c]);
}

export const CAPABILITY_LABEL: Record<Capability, string> = {
  "runtime:inline": "Brokers run in this app",
  "runtime:cloudflare": "Brokers run on Cloudflare Workers",
  "runtime:lambda": "Brokers run on your AWS Lambda",
  "gate:enforce": "Private network required",
  "signing:kms": "Signing key held in your KMS HSM",
  "custody:vault": "Secrets filed in your 1Password vaults",
  "archive:s3": "Wire ledger archived to your S3 bucket",
};
