import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Emergency recovery. Deliberately outside every gate it can reopen: no
 * session, no Access assertion, no identity provider. A single-use code that
 * only the operator holds buys a short, self-expiring window in which the
 * private-network requirement is suspended. Attempts are rate limited and both
 * success and failure are auditable.
 */

const Input = z.object({
  code: z.string().trim().min(8).max(64),
  minutes: z.number().int().min(5).max(240).default(30),
  reason: z.string().trim().max(200).default("Recovery code redeemed"),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const Route = createFileRoute("/api/public/breakglass")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Input.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "invalid request" }, 400);
        const source =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        try {
          const { codeRedeem } = await import("@/lib/access/breakglass.server");
          const { until } = await codeRedeem({ ...parsed.data, source });
          return json({ opened: true, until });
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "failed" }, 400);
        }
      },
    },
  },
});
