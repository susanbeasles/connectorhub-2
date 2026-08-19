import { sha256Hex } from "../crypto.server";
import type { DeploySpec, Deployment, Provider } from "./types";

/**
 * The broker's own worker serving `/api/public/mcp/:serverId`. Always available,
 * nothing to provision — it is a real target so every consumer takes one path.
 */
export const inlineProvider: Provider = {
  target: "inline",
  available: () => true,

  async launch(spec: DeploySpec) {
    return {
      workerName: null,
      routeUrl: `${spec.origin}/api/public/mcp/${spec.serverId}`,
      specDigest: await sha256Hex(`inline:${spec.serverId}:${spec.slug}`),
    };
  },

  async teardown() {
    /* nothing is provisioned, so nothing is reclaimed */
  },

  async probe(_spec: DeploySpec, deployment: Deployment) {
    return deployment.routeUrl ? "live" : "degraded";
  },
};
