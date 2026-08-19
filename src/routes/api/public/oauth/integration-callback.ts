import { createFileRoute } from "@tanstack/react-router";

/**
 * The bootstrap handshake lands here. It exchanges the code for an admin token,
 * mints the narrowly scoped credential with it, files that credential in the
 * vault and then hands the admin token straight back to the provider for
 * revocation. Elevated access exists only for the width of this handler.
 */

function page(title: string, body: string, ok: boolean) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:15px system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#f6f8fa;color:#0f172a">` +
      `<div style="max-width:34rem;padding:2rem;border-radius:12px;background:#fff;border:1px solid #e2e8f0">` +
      `<h1 style="font-size:1.05rem;margin:0 0 .5rem">${ok ? "Integration connected" : "Integration failed"}</h1>` +
      `<p style="margin:0;color:#475569">${body}</p>` +
      `<p style="margin:1rem 0 0;color:#94a3b8;font-size:.85rem">You can close this window.</p>` +
      `<script>window.opener&&window.opener.postMessage({source:"aegis-integration",ok:${ok}},"*")</script>` +
      `</div></body>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/oauth/integration-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return page("Aegis", "The provider did not return an authorization code.", false);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: session } = await supabaseAdmin
          .from("integration_sessions")
          .select("*")
          .eq("state", state)
          .maybeSingle();
        if (!session || new Date(session.expires_at as string).getTime() < Date.now()) {
          return page("Aegis", "This authorization link has expired. Start the install again.", false);
        }
        // The handshake is single-use: the row goes before the code is spent, so a
        // replayed callback finds nothing to exchange.
        await supabaseAdmin.from("integration_sessions").delete().eq("id", session.id);

        const provider = session.provider as string;
        const tier = session.tier as "read" | "write" | "destructive";
        const { spec } = await import("@/lib/integrations/registry.server");
        const { record, acceptCredential } = await import("@/lib/integrations/install.server");
        const { revokeBootstrap } = await import("@/lib/integrations/revoke.server");
        const { mint } = await import("@/lib/integrations/mint.server");
        const s = spec(provider);

        let bootstrapToken: string | null = null;
        try {
          const res = await fetch(s.oauth!.tokenUrl, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: session.redirect_uri as string,
              code_verifier: session.code_verifier as string,
              client_id: process.env[s.oauth!.clientIdEnv] ?? "",
              client_secret: process.env[s.oauth!.clientSecretEnv] ?? "",
            }).toString(),
            signal: AbortSignal.timeout(15_000),
          });
          const payload = (await res.json()) as { access_token?: string; error_description?: string };
          if (!res.ok || !payload.access_token) {
            throw new Error(payload.error_description ?? `Token exchange failed (${res.status})`);
          }
          bootstrapToken = payload.access_token;

          const minted = await mint({ provider, tier, bootstrapToken });
          await acceptCredential({
            provider,
            tier,
            value: minted.value,
            via: "click",
            accountLabel: minted.accountLabel,
            actor: session.actor as string,
          });
          return page("Aegis", `${s.label} ${tier} access is filed in the vault and the admin grant was revoked.`, true);
        } catch (e) {
          await record({
            provider,
            tier,
            step: "mint",
            level: "error",
            message: e instanceof Error ? e.message : "Bootstrap failed",
            actor: session.actor as string,
          });
          return page("Aegis", e instanceof Error ? e.message : "Bootstrap failed.", false);
        } finally {
          if (bootstrapToken) await revokeBootstrap(provider, tier, bootstrapToken);
        }
      },
    },
  },
});
