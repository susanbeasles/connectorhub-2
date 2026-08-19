import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, dpop, mcp-protocol-version",
  "Access-Control-Expose-Headers": "DPoP-Nonce, WWW-Authenticate",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function rpc(id: unknown, result: unknown, nonce?: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: {
      ...cors,
      "content-type": "application/json",
      ...(nonce ? { "DPoP-Nonce": nonce } : {}),
    },
  });
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function textResult(id: unknown, text: string, isError = false, nonce?: string) {
  return rpc(id, { content: [{ type: "text", text }], isError }, nonce);
}

export const Route = createFileRoute("/api/public/mcp/$serverId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () =>
        new Response(
          JSON.stringify({
            transport: "streamable-http",
            note: "POST JSON-RPC with a short-lived bearer token issued from the console.",
          }),
          { headers: { ...cors, "content-type": "application/json" } },
        ),
      POST: async ({ request, params }) => {
        const { executeTool, logEvent, toolToMcpSchema } = await import("@/lib/proxy.server");
        const { authorizeBearer, sessionAllows } = await import("@/lib/oauth.server");
        const { verifyProof, mintNonce, effectiveMode, DpopError } = await import("@/lib/dpop.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verifyAccess } = await import("@/lib/access/index.server");
        const { openExchange, recordExchange } = await import("@/lib/wire/wire.server");

        // Edge gate first: a request that never passed the tunnel is not worth parsing.
        const edge = await verifyAccess(request, "proxy");
        if (!edge.allowed && edge.mode === "enforce") {
          const { data: owner } = await supabaseAdmin
            .from("servers")
            .select("user_id")
            .eq("id", params.serverId)
            .maybeSingle();
          if (owner) await logEvent({
            user_id: owner.user_id,
            server_id: params.serverId,
            event: "access.denied",
            level: "warn",
            message: `Cloudflare Access rejected a proxy call: ${edge.reason}`,
          });
          return rpcError(null, -32001, `Cloudflare Access: ${edge.reason}`, 403);
        }

        const raw = await request.text();
        let payload: { id?: unknown; method?: string; params?: any };
        try {
          payload = JSON.parse(raw) as typeof payload;
        } catch {
          return rpcError(null, -32700, "Parse error");
        }
        // Full-fidelity capture of the request exactly as it arrived.
        const probe = openExchange(request, raw, payload);
        const id = payload.id ?? null;
        const method = payload.method ?? "";

        if (method.startsWith("notifications/")) return new Response(null, { status: 202, headers: cors });

        const origin = new URL(request.url).origin;
        const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/api/public/mcp/${params.serverId}`;
        const token = request.headers.get("authorization")?.replace(/^(Bearer|DPoP)\s+/i, "") ?? null;

        const { data: brokerPolicy } = await supabaseAdmin
          .from("servers")
          .select("dpop_mode")
          .eq("id", params.serverId)
          .maybeSingle();
        const mode = effectiveMode(String(brokerPolicy?.dpop_mode ?? "preferred"), null);
        const proofHeader = request.headers.get("dpop");

        // Every proof is single-use: bound to this method, URL, token and nonce.
        let proofJkt: string | null = null;
        if (proofHeader && mode !== "disabled") {
          try {
            ({ jkt: proofJkt } = await verifyProof({
              proof: proofHeader,
              method: "POST",
              url: request.url,
              accessToken: token,
              requireNonce: true,
            }));
          } catch (e) {
            const err = e as InstanceType<typeof DpopError>;
            return new Response(
              JSON.stringify({
                jsonrpc: "2.0",
                id,
                error: { code: -32001, message: `DPoP rejected: ${err.message}` },
              }),
              {
                status: 401,
                headers: {
                  ...cors,
                  "content-type": "application/json",
                  "DPoP-Nonce": await mintNonce(),
                  "WWW-Authenticate": `DPoP error="${err.code}", error_description="${err.message}"`,
                },
              },
            );
          }
        }

        if (mode === "required" && !proofJkt) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32001,
                message:
                  "This broker only accepts sender-constrained requests. Sign each call with a DPoP proof carrying the supplied nonce.",
              },
            }),
            {
              status: 401,
              headers: {
                ...cors,
                "content-type": "application/json",
                "DPoP-Nonce": await mintNonce(),
                "WWW-Authenticate": `DPoP realm="aegis", resource_metadata="${resourceMetadata}"`,
              },
            },
          );
        }

        const session = await authorizeBearer(params.serverId, token, proofJkt);
        if (!session) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32001,
                message:
                  "Unauthorized: no valid OAuth grant. Start the authorization flow at " +
                  `${origin}/api/public/oauth/authorize`,
              },
            }),
            {
              status: 401,
              headers: {
                ...cors,
                "content-type": "application/json",
                "WWW-Authenticate": `Bearer realm="aegis", resource_metadata="${resourceMetadata}"`,
              },
            },
          );
        }

        const { data: server } = await supabaseAdmin
          .from("servers")
          .select("*")
          .eq("id", params.serverId)
          .maybeSingle();
        if (!server) return rpcError(id, -32002, "Server not found", 404);
        if (!server.enabled) return rpcError(id, -32003, "This server is disabled", 403);

        /** One exit point for the ledger: every answer we hand the model is priced. */
        const seal = (
          text: string,
          extra: {
            tool?: string | null;
            statusCode?: number;
            outcome?: "ok" | "denied" | "error";
            upstream?: {
              method: string;
              url: string;
              request: unknown;
              response: string;
              status: number;
              durationMs: number;
            } | null;
          } = {},
        ) =>
          recordExchange(probe, {
            userId: session.userId,
            serverId: server.id,
            grantId: session.grantId ?? null,
            clientName: session.clientName ?? "",
            sessionKind: session.kind,
            rpcMethod: method,
            toolName: extra.tool ?? null,
            statusCode: extra.statusCode ?? 200,
            outcome: extra.outcome ?? "ok",
            responseText: text,
            upstream: extra.upstream ?? null,
          });

        // Hand out the next nonce so the client's following proof is already valid.
        const nextNonce = proofJkt ? await mintNonce() : undefined;

        if (method === "ping") {
          await seal("{}");
          return rpc(id, {}, nextNonce);
        }

        const legacyNotice =
          session.kind === "legacy"
            ? " WARNING: this session uses an unscoped legacy bearer token with full access to every enabled tool. Ask the operator to switch this client to OAuth 2.1 for per-tool, expiring grants."
            : "";

        if (session.kind === "legacy" && method === "initialize") {
          await logEvent({
            user_id: session.userId,
            server_id: session.serverId,
            level: "warn",
            event: "auth.legacy_bearer_used",
            message: "Legacy unscoped bearer token used — no per-tool scoping applied",
          });
        }

        if (method === "initialize") {
          const instructions = (server.instructions || server.description) + legacyNotice;
          await seal(instructions);
          return rpc(id, {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: server.slug, title: server.name, version: "1.0.0" },
            instructions,
          }, nextNonce);
        }

        const { data: allTools } = await supabaseAdmin
          .from("tools")
          .select("*")
          .eq("server_id", server.id)
          .eq("enabled", true)
          .order("name");

        // A grant can only ever see the tools its scopes cover.
        const tools = (allTools ?? []).filter((t) => sessionAllows(session, t.name as string));

        if (method === "tools/list") {
          const listed = tools.map((t) => toolToMcpSchema(t as never));
          // The catalogue itself is a real token cost the model pays every session.
          await seal(JSON.stringify(listed));
          return rpc(id, { tools: listed }, nextNonce);
        }

        if (method === "tools/call") {
          const name = String(payload.params?.name ?? "");
          const args = (payload.params?.arguments ?? {}) as Record<string, unknown>;

          // Every grant gets its own budget; a runaway agent throttles itself, not the fleet.
          const { rateHit } = await import("@/lib/ratelimit.server");
          const limit = Number(session.rateLimitPerMin ?? server.rate_limit_per_min ?? 60);
          const verdict = await rateHit(`grant:${session.grantId ?? session.serverId}`, limit);
          if (!verdict.allowed) {
            await logEvent({
              user_id: session.userId,
              server_id: session.serverId,
              level: "warn",
              event: "rate.limited",
              tool_name: name,
              message: `${session.clientName} exceeded ${limit} calls/min`,
            });
            const text = `Rate limited: this grant allows ${limit} calls per minute. Retry in ${verdict.retryAfterSec}s.`;
            await seal(text, { tool: name, statusCode: 429, outcome: "denied" });
            return textResult(id, text, true, nextNonce);
          }

          const tool = tools.find((t) => t.name === name);
          if (!tool) {
            const known = (allTools ?? []).some((t) => t.name === name);
            if (known) {
              await logEvent({
                user_id: session.userId,
                server_id: session.serverId,
                level: "warn",
                event: "oauth.scope_denied",
                tool_name: name,
                message: `${session.clientName} called ${name} without the tool:${name} scope`,
              });
              const text = `Out of scope: this grant does not include "${name}". Ask the operator to authorize it — the current grant expires ${session.expiresAt}.`;
              await seal(text, { tool: name, statusCode: 403, outcome: "denied" });
              return textResult(id, text, true, nextNonce);
            }
            const text = `Tool "${name}" is not enabled on this server.`;
            await seal(text, { tool: name, statusCode: 404, outcome: "denied" });
            return textResult(id, text, true, nextNonce);
          }

          if (tool.approval === "always_ask") {
            const { data: approved } = await supabaseAdmin
              .from("approvals")
              .select("id")
              .eq("server_id", server.id)
              .eq("tool_name", name)
              .eq("status", "approved")
              .gt("expires_at", new Date().toISOString())
              .limit(1)
              .maybeSingle();

            if (!approved) {
              await supabaseAdmin.from("approvals").insert({
                user_id: server.user_id,
                server_id: server.id,
                tool_name: name,
                args: args as never,
                status: "pending",
              });
              await logEvent({
                user_id: server.user_id,
                server_id: server.id,
                level: "warn",
                event: "tool.approval_required",
                tool_name: name,
                message: `Call to ${name} is awaiting human approval`,
                meta: { args },
              });
              const text = `Approval required. A request to run "${name}" was sent to the operator console. Ask the user to approve it, then retry this call.`;
              await seal(text, { tool: name, statusCode: 202, outcome: "denied" });
              return textResult(id, text, true, nextNonce);
            }
            await supabaseAdmin
              .from("approvals")
              .update({ status: "consumed", decided_at: new Date().toISOString() })
              .eq("id", approved.id);
          }

          try {
            const out = await executeTool(server as never, tool as never, args);
            await logEvent({
              user_id: server.user_id,
              server_id: server.id,
              level: out.status < 400 ? "info" : "error",
              event: "tool.call",
              tool_name: name,
              status_code: out.status,
              duration_ms: out.durationMs,
              message: `Proxied ${tool.method} ${tool.path}`,
            });
            const text = out.body || `(empty ${out.status} response)`;
            await seal(text, {
              tool: name,
              statusCode: out.status,
              outcome: out.status >= 400 ? "error" : "ok",
              upstream: {
                ...out.wire,
                response: out.body,
                status: out.status,
                durationMs: out.durationMs,
              },
            });
            return textResult(id, text, out.status >= 400, nextNonce);
          } catch (e) {
            const message = e instanceof Error ? e.message : "Upstream call failed";
            await logEvent({
              user_id: server.user_id,
              server_id: server.id,
              level: "error",
              event: "tool.call_failed",
              tool_name: name,
              message,
            });
            await seal(message, { tool: name, statusCode: 502, outcome: "error" });
            return textResult(id, message, true, nextNonce);
          }
        }

        return rpcError(id, -32601, `Method not found: ${method}`);
      },
    },
  },
});
