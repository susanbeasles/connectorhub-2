import { createFileRoute } from "@tanstack/react-router";

/** Scheduled infrastructure reconciliation. Callable only with the broker's cron secret. */
function authorized(request: Request): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected) return false;
  const presented =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1)
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sweep(request: Request) {
  if (!authorized(request)) return json({ error: "unauthorized" }, 401);
  const origin = new URL(request.url).origin;
  const [{ Deploy }, { Tunnel }, { rotateDue }] = await Promise.all([
    import("@/lib/deploy/index.server"),
    import("@/lib/tunnel/index.server"),
    import("@/lib/integrations/rotate.server"),
  ]);
  const [runtime, tunnels, credentials] = await Promise.all([
    Deploy.reconcileAll(origin),
    Tunnel.reconcileAll(origin),
    rotateDue(),
  ]);
  return json({ runtime, tunnels, credentials });
}

export const Route = createFileRoute("/api/public/cron/runtime")({
  server: {
    handlers: {
      POST: async ({ request }) => sweep(request),
      GET: async ({ request }) => sweep(request),
    },
  },
});
