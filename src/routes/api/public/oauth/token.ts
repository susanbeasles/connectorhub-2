import { createFileRoute } from "@tanstack/react-router";
import { jsonHeaders } from "@/lib/oauth-metadata";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, "cache-control": "no-store" },
  });
}

async function params(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v ?? "")]));
  }
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

export const Route = createFileRoute("/api/public/oauth/token")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: jsonHeaders }),
      POST: async ({ request }) => {
        const { exchangeCode, refreshGrant } = await import("@/lib/oauth.server");
        const { verifyProof, mintNonce, DpopError } = await import("@/lib/dpop.server");

        // The proof at the token endpoint binds the whole grant to the client key.
        const proofHeader = request.headers.get("dpop");
        let jkt: string | null = null;
        if (proofHeader) {
          try {
            ({ jkt } = await verifyProof({
              proof: proofHeader,
              method: "POST",
              url: request.url,
            }));
          } catch (e) {
            const err = e as InstanceType<typeof DpopError>;
            return new Response(
              JSON.stringify({ error: err.code ?? "invalid_dpop_proof", error_description: err.message }),
              {
                status: 400,
                headers: { ...jsonHeaders, "cache-control": "no-store", "DPoP-Nonce": await mintNonce() },
              },
            );
          }
        }

        let p: Record<string, string>;
        try {
          p = await params(request);
        } catch {
          return json({ error: "invalid_request" }, 400);
        }
        const secret = p["client_secret"] ?? null;

        try {
          if (p["grant_type"] === "authorization_code") {
            if (!p["code"] || !p["code_verifier"] || !p["client_id"] || !p["redirect_uri"]) {
              return json({ error: "invalid_request" }, 400);
            }
            return json(
              await exchangeCode({
                code: p["code"],
                clientId: p["client_id"],
                clientSecret: secret,
                redirectUri: p["redirect_uri"],
                codeVerifier: p["code_verifier"],
                jkt,
              }),
            );
          }
          if (p["grant_type"] === "refresh_token") {
            if (!p["refresh_token"] || !p["client_id"]) return json({ error: "invalid_request" }, 400);
            return json(
              await refreshGrant({
                refreshToken: p["refresh_token"],
                clientId: p["client_id"],
                clientSecret: secret,
                jkt,
              }),
            );
          }
          return json({ error: "unsupported_grant_type" }, 400);
        } catch (e) {
          const message = (e as Error).message;
          if (message === "dpop_required") {
            return new Response(
              JSON.stringify({
                error: "invalid_dpop_proof",
                error_description:
                  "This broker requires sender-constrained (DPoP) tokens. Send a DPoP proof with the token request.",
              }),
              {
                status: 400,
                headers: { ...jsonHeaders, "cache-control": "no-store", "DPoP-Nonce": await mintNonce() },
              },
            );
          }
          const code = message === "invalid_client" ? "invalid_client" : "invalid_grant";
          return json({ error: code }, 400);
        }
      },
    },
  },
});
