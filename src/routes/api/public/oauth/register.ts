import { createFileRoute } from "@tanstack/react-router";
import { jsonHeaders } from "@/lib/oauth-metadata";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export const Route = createFileRoute("/api/public/oauth/register")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: jsonHeaders }),
      POST: async ({ request }) => {
        const { registerClient } = await import("@/lib/oauth.server");
        const url = new URL(request.url);
        const serverId = url.searchParams.get("server_id");
        if (!serverId) return json({ error: "invalid_request", error_description: "server_id query param required" }, 400);

        let body: {
          client_name?: string;
          redirect_uris?: string[];
          token_endpoint_auth_method?: string;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "invalid_request" }, 400);
        }
        const redirectUris = (body.redirect_uris ?? []).filter(
          (u) => typeof u === "string" && u.length < 2048,
        );
        if (!redirectUris.length) return json({ error: "invalid_redirect_uri" }, 400);

        try {
          const confidential = body.token_endpoint_auth_method === "client_secret_post";
          const { clientId, clientSecret } = await registerClient({
            serverId,
            name: (body.client_name ?? "Unnamed client").slice(0, 120),
            redirectUris,
            confidential,
          });
          return json(
            {
              client_id: clientId,
              ...(clientSecret ? { client_secret: clientSecret } : {}),
              client_name: body.client_name ?? "Unnamed client",
              redirect_uris: redirectUris,
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: confidential ? "client_secret_post" : "none",
            },
            201,
          );
        } catch (e) {
          return json(
            { error: "invalid_client_metadata", error_description: (e as Error).message },
            400,
          );
        }
      },
    },
  },
});
