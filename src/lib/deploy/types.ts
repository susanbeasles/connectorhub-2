/** The runtime vocabulary every deployment provider speaks. */

export type Target = "inline" | "cloudflare" | "lambda";

export type DeploySpec = {
  serverId: string;
  userId: string;
  slug: string;
  origin: string;
};

export type Deployment = {
  serverId: string;
  target: Target;
  status: "pending" | "live" | "degraded" | "failed" | "removed";
  version: number;
  workerName: string | null;
  routeUrl: string | null;
  specDigest: string | null;
  lastError: string | null;
  lastReconciledAt: string | null;
};

export type DeployResult = {
  workerName: string | null;
  routeUrl: string | null;
  specDigest: string;
};

/** A provider is anything that can put a broker somewhere and take it back down. */
export type Provider = {
  target: Target;
  available: () => boolean;
  launch: (spec: DeploySpec) => Promise<DeployResult>;
  teardown: (spec: DeploySpec) => Promise<void>;
  probe: (spec: DeploySpec, deployment: Deployment) => Promise<"live" | "degraded" | "failed">;
};
