import { createFileRoute } from "@tanstack/react-router";

/**
 * Provider redirect target. It is public only because the provider's browser
 * redirect lands here unauthenticated — the single-use `state` row is the
 * capability, and no secret is ever echoed back to the caller.
 */
export const Route = createFileRoute("/api/public/oauth/upstream-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const denied = url.searchParams.get("error");

        const back = (path: string) =>
          new Response(null, { status: 302, headers: { location: path } });

        if (denied) return back(`/?upstream=${encodeURIComponent(denied)}`);
        if (!state || !code) return back("/?upstream=invalid_request");

        try {
          const { completeUpstream } = await import("@/lib/upstream.server");
          const { serverId } = await completeUpstream(state, code);
          return back(`/servers/${serverId}?upstream=connected`);
        } catch (e) {
          const reason = e instanceof Error ? e.message : "exchange_failed";
          return back(`/?upstream=${encodeURIComponent(reason)}`);
        }
      },
    },
  },
});
