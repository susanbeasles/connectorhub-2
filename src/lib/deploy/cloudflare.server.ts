import { sha256Hex } from "../crypto.server";
import type { DeploySpec, Deployment, Provider } from "./types";

/**
 * Workers for Platforms: every broker gets its own isolated script inside a
 * dispatch namespace, so a compromise of one broker cannot reach another.
 * The script itself is deliberately thin — all policy stays in the broker.
 */

const API = "https://api.cloudflare.com/client/v4";

type Config = { accountId: string; token: string; namespace: string; hostname: string | null };

function config(): Config | null {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const namespace = process.env["CLOUDFLARE_DISPATCH_NAMESPACE"];
  if (!accountId || !token || !namespace) return null;
  return { accountId, token, namespace, hostname: process.env["CLOUDFLARE_WORKERS_HOST"] ?? null };
}

function workerName(spec: DeploySpec) {
  return `aegis-${spec.slug}-${spec.serverId.slice(0, 8)}`;
}

/** Forwards MCP traffic to the broker origin; holds no credentials of its own. */
function script(spec: DeploySpec) {
  return `const ORIGIN = ${JSON.stringify(spec.origin)};
const SERVER_ID = ${JSON.stringify(spec.serverId)};
export default {
  async fetch(request) {
    const upstream = new URL(ORIGIN + "/api/public/mcp/" + SERVER_ID);
    const forwarded = new Request(upstream, request);
    forwarded.headers.set("x-aegis-edge", SERVER_ID);
    return fetch(forwarded);
  },
};
`;
}

async function call(cfg: Config, path: string, init: RequestInit) {
  const res = await fetch(`${API}/accounts/${cfg.accountId}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: { message: string }[];
  };
  if (!res.ok || body.success === false) {
    const reason = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare: ${reason}`);
  }
  return body;
}

export const cloudflareProvider: Provider = {
  target: "cloudflare",
  available: () => config() !== null,

  async launch(spec: DeploySpec) {
    const cfg = config();
    if (!cfg) throw new Error("Cloudflare is not configured — add the account, token and namespace.");
    const name = workerName(spec);
    const source = script(spec);

    const form = new FormData();
    form.set(
      "metadata",
      new Blob(
        [JSON.stringify({ main_module: "index.mjs", compatibility_date: "2025-01-01", bindings: [] })],
        { type: "application/json" },
      ),
    );
    form.set("index.mjs", new Blob([source], { type: "application/javascript+module" }), "index.mjs");

    await call(cfg, `/workers/dispatch/namespaces/${cfg.namespace}/scripts/${name}`, {
      method: "PUT",
      body: form,
    });

    return {
      workerName: name,
      routeUrl: cfg.hostname ? `https://${name}.${cfg.hostname}` : null,
      specDigest: await sha256Hex(source),
    };
  },

  async teardown(spec: DeploySpec) {
    const cfg = config();
    if (!cfg) return;
    await call(cfg, `/workers/dispatch/namespaces/${cfg.namespace}/scripts/${workerName(spec)}`, {
      method: "DELETE",
    }).catch(() => undefined);
  },

  async probe(spec: DeploySpec, deployment: Deployment) {
    const expected = await sha256Hex(script(spec));
    if (expected !== deployment.specDigest) return "degraded";
    const cfg = config();
    if (!cfg) return "failed";
    try {
      await call(cfg, `/workers/dispatch/namespaces/${cfg.namespace}/scripts/${workerName(spec)}`, {
        method: "GET",
      });
      return "live";
    } catch {
      return "failed";
    }
  },
};
