import { createFileRoute } from "@tanstack/react-router";

/**
 * Enrollment door. An agent trades a one-time ticket for a binding between the
 * source and a keypair it generated itself. No secret is ever issued back.
 */

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/telemetry/v1/enroll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: { ticket?: string; publicJwk?: JsonWebKey };
        try {
          payload = (await request.json()) as typeof payload;
        } catch {
          return json({ error: "invalid_payload" }, 400);
        }
        if (!payload.ticket || !payload.publicJwk) {
          return json({ error: "ticket_and_public_jwk_required" }, 400);
        }

        try {
          const { redeemEnrollment } = await import("@/lib/telemetry/enroll.server");
          const result = await redeemEnrollment({
            ticket: payload.ticket,
            publicJwk: payload.publicJwk,
          });
          return json({ ok: true, sourceId: result.sourceId, jkt: result.jkt }, 201);
        } catch (e) {
          return json({ error: "enrollment_rejected", detail: e instanceof Error ? e.message : "" }, 400);
        }
      },
      GET: async () =>
        json(
          {
            ok: true,
            contract: "telemetry/v1 enrollment",
            algs: ["ES256", "ES384", "RS256", "PS256"],
            proofHeader: "DPoP",
            proofClaims: ["htm", "htu", "iat", "jti", "bdh"],
          },
          200,
        ),
    },
  },
});
