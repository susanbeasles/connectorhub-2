import { createFileRoute } from "@tanstack/react-router";
import { jsonHeaders } from "@/lib/oauth-metadata";

function fail(redirectUri: string | null, state: string | null, error: string, description: string) {
  if (redirectUri) {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { location: url.toString() } });
  }
  return new Response(JSON.stringify({ error, error_description: description }), {
    status: 400,
    headers: jsonHeaders,
  });
}

export const Route = createFileRoute("/api/public/oauth/authorize")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: jsonHeaders }),
      GET: async ({ request }) => {
        const { createAuthorizationRequest } = await import("@/lib/oauth.server");
        const url = new URL(request.url);
        const q = (k: string) => url.searchParams.get(k);
        const redirectUri = q("redirect_uri");
        const state = q("state");

        if (q("response_type") !== "code") {
          return fail(redirectUri, state, "unsupported_response_type", "Only response_type=code");
        }
        const clientId = q("client_id");
        const challenge = q("code_challenge");
        if (!clientId || !redirectUri || !challenge) {
          return fail(redirectUri, state, "invalid_request", "client_id, redirect_uri and code_challenge are required");
        }

        try {
          const id = await createAuthorizationRequest({
            clientId,
            redirectUri,
            state,
            codeChallenge: challenge,
            codeChallengeMethod: q("code_challenge_method") ?? "S256",
            scope: q("scope"),
            resource: q("resource"),
          });
          return new Response(null, {
            status: 302,
            headers: { location: `${url.origin}/oauth/consent?authorization_id=${id}` },
          });
        } catch (e) {
          return fail(redirectUri, state, "invalid_request", (e as Error).message);
        }
      },
    },
  },
});
