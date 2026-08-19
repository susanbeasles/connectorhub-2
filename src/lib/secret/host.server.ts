import type { Host } from "./broker";

/**
 * Which host this deployment runs on. There are three, they are mutually
 * exclusive, and the choice is inferred from what has actually been connected
 * rather than declared twice and left to drift.
 *
 * In sandbox the answer is always `lovable`: the point of that stage is that
 * nobody else's infrastructure is touched.
 */

const CACHE_MS = 10_000;
let cached: { value: Host; at: number } | null = null;

export async function hostRead(): Promise<Host> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await detect();
  cached = { value, at: Date.now() };
  return value;
}

export function hostReset(): void {
  cached = null;
}

async function detect(): Promise<Host> {
  try {
    const { allows } = await import("@/lib/stage/stage.server");
    if (!(await allows("custody:vault"))) return "lovable";

    const { federationLoad } = await import("@/lib/deploy/aws/federation.server");
    const federation = await federationLoad();
    if (federation?.kmsKeyArn) return "aws";

    if (process.env["CLOUDFLARE_SECRETS_STORE_ID"] && process.env["CLOUDFLARE_API_TOKEN"]) {
      return "cloudflare";
    }
  } catch {
    // An outage in the store that holds the answer must never silently promote
    // custody; the safe default is the host that needs nothing external.
  }
  return "lovable";
}
