import { createFileRoute } from "@tanstack/react-router";
import { jsonHeaders } from "@/lib/oauth-metadata";

/** Public half of the broker's signing key, so anyone can verify grant receipts. */
export const Route = createFileRoute("/.well-known/jwks.json")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: jsonHeaders }),
      GET: async () => {
        const { bootstrapSigner, brokerSigner } = await import("@/lib/signing/index.server");
        // Both halves are published so verification survives a custody move
        // from the sealed key to the HSM without a flag day.
        const signers = [await brokerSigner(), bootstrapSigner()];
        const seen = new Set<string>();
        const keys = [];
        for (const s of signers) {
          const kid = await s.keyId();
          if (seen.has(kid)) continue;
          seen.add(kid);
          keys.push({ ...(await s.publicJwk()), kid, use: "sig", alg: "ES256", key_ops: undefined });
        }
        return new Response(JSON.stringify({ keys }), { headers: jsonHeaders });
      },
    },
  },
});
