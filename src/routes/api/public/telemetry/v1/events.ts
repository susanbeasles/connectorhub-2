import { createFileRoute } from "@tanstack/react-router";

/**
 * The public ingest door. One route, one contract: bearer ingest key, JSON or
 * NDJSON body, always answers fast. Auth is checked here because /api/public/*
 * bypasses the console gate by design.
 */

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return request.headers.get("x-ingest-key");
}

function parseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through to NDJSON */
    }
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export const Route = createFileRoute("/api/public/telemetry/v1/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { resolveSource, capture, ingestBudget } = await import("@/lib/telemetry/ingest.server");
        const body = await request.text();
        const proof = request.headers.get("dpop");

        let source = null;
        if (proof) {
          const { resolveByProof } = await import("@/lib/telemetry/enroll.server");
          try {
            source = await resolveByProof({ proof, method: "POST", url: request.url, body });
          } catch (e) {
            return json({ error: "invalid_proof", detail: e instanceof Error ? e.message : "" }, 401);
          }
        } else {
          source = await resolveSource(bearer(request));
        }
        if (!source) return json({ error: "unauthenticated_source" }, 401);

        const verdict = await ingestBudget(source.id);
        if (!verdict.allowed) {
          return json({ error: "rate_limited", resetAt: verdict.resetAt }, 429, {
            "retry-after": String(verdict.retryAfterSec),
          });
        }

        try {
          const result = await capture(source, parseBody(body));
          return json({ ok: true, accepted: result.accepted }, 202);
        } catch (e) {
          return json({ error: "invalid_payload", detail: e instanceof Error ? e.message : "" }, 400);
        }
      },
      GET: async () =>
        json(
          {
            ok: true,
            contract: "telemetry/v1",
            accepts: ["json", "ndjson"],
            auth: ["dpop-proof", "bearer-key"],
          },
          200,
        ),

    },
  },
});
