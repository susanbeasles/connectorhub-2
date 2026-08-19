import { createFileRoute } from "@tanstack/react-router";

/** Scheduled fleet sweep. Callable only with the broker's cron secret. */
function authorized(request: Request): boolean {
  const expected = process.env["CRON_SECRET"];
  if (!expected) return false;
  const presented =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const Route = createFileRoute("/api/public/cron/health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return json({ error: "unauthorized" }, 401);
        const { sweepFleet } = await import("@/lib/maintenance.server");
        return json(await sweepFleet(new URL(request.url).origin));
      },
      GET: async ({ request }) => {
        if (!authorized(request)) return json({ error: "unauthorized" }, 401);
        const { sweepFleet } = await import("@/lib/maintenance.server");
        return json(await sweepFleet(new URL(request.url).origin));
      },
    },
  },
});
