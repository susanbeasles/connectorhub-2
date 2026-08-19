import { createFileRoute } from "@tanstack/react-router";
import { jsonHeaders, protectedResourceMetadata } from "@/lib/oauth-metadata";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: jsonHeaders }),
      GET: async ({ request, params }) => {
        const origin = new URL(request.url).origin;
        const suffix = (params as { _splat?: string })._splat ?? "";
        return new Response(
          JSON.stringify(protectedResourceMetadata(origin, suffix ? `/${suffix}` : "")),
          { headers: jsonHeaders },
        );
      },
    },
  },
});
