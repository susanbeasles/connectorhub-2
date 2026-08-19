import { createFileRoute } from "@tanstack/react-router";
import { authorizationServerMetadata, jsonHeaders } from "@/lib/oauth-metadata";

export const Route = createFileRoute("/.well-known/oauth-authorization-server")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: jsonHeaders }),
      GET: async ({ request }) =>
        new Response(JSON.stringify(authorizationServerMetadata(new URL(request.url).origin)), {
          headers: jsonHeaders,
        }),
    },
  },
});
