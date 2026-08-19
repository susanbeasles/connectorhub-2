import { createFileRoute } from "@tanstack/react-router";
import { jsonHeaders } from "@/lib/oauth-metadata";

export const Route = createFileRoute("/api/public/oauth/revoke")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: jsonHeaders }),
      POST: async ({ request }) => {
        const { revokeByToken } = await import("@/lib/oauth.server");
        const body = Object.fromEntries(new URLSearchParams(await request.text()));
        const token = body["token"];
        if (token) await revokeByToken(token);
        return new Response(null, { status: 200, headers: jsonHeaders });
      },
    },
  },
});
