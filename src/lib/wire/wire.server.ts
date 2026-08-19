import { clientIp, redactHeaders, redactValue, truncate } from "./redact";
import { countTokens, splitTokens } from "./tokens";

/**
 * The wire ledger: one row per inbound MCP exchange, holding the request as it
 * arrived, the upstream call it caused, and what the whole round trip cost the
 * model in tokens. Every proxy path funnels through `Wire.open` → `record`, so
 * there is exactly one place that decides what an exchange looks like.
 */

export type UpstreamLeg = {
  method: string;
  url: string;
  request: unknown;
  response: string;
  status: number;
  durationMs: number;
};

export type WireExchange = {
  userId: string;
  serverId: string;
  grantId?: string | null;
  clientName?: string;
  sessionKind?: string;
  rpcMethod: string;
  toolName?: string | null;
  statusCode?: number;
  outcome?: "ok" | "denied" | "error";
  responseText: string;
  upstream?: UpstreamLeg | null;
};

export type WireProbe = {
  ip: string;
  country: string;
  userAgent: string;
  headers: Record<string, string>;
  body: unknown;
  bytes: number;
  startedAt: number;
};

/** Capture everything about the request the moment it lands, before any parsing. */
export function openExchange(request: Request, rawBody: string, parsed: unknown): WireProbe {
  return {
    ip: clientIp(request.headers),
    country: request.headers.get("cf-ipcountry") ?? "",
    userAgent: request.headers.get("user-agent") ?? "",
    headers: redactHeaders(request.headers),
    body: redactValue(parsed),
    bytes: rawBody.length,
    startedAt: Date.now(),
  };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Write one exchange. Logging never breaks a call: failures are swallowed. */
export async function recordExchange(probe: WireProbe, exchange: WireExchange): Promise<void> {
  try {
    const tokens = splitTokens({
      inbound: probe.body,
      outbound: exchange.responseText,
      upstream: exchange.upstream?.response,
    });
    const db = await admin();
    await db.from("wire_logs").insert({
      user_id: exchange.userId,
      server_id: exchange.serverId,
      grant_id: exchange.grantId ?? null,
      client_name: exchange.clientName ?? "",
      session_kind: exchange.sessionKind ?? "anonymous",
      rpc_method: exchange.rpcMethod,
      tool_name: exchange.toolName ?? null,
      ip: probe.ip,
      country: probe.country,
      user_agent: probe.userAgent,
      request_headers: probe.headers as never,
      request_body: (probe.body ?? {}) as never,
      request_bytes: probe.bytes,
      response_body: truncate(exchange.responseText),
      response_bytes: exchange.responseText.length,
      status_code: exchange.statusCode ?? 200,
      outcome: exchange.outcome ?? "ok",
      duration_ms: Date.now() - probe.startedAt,
      upstream_method: exchange.upstream?.method ?? null,
      upstream_url: exchange.upstream?.url ?? null,
      upstream_request: (redactValue(exchange.upstream?.request ?? null) ?? null) as never,
      upstream_response: exchange.upstream ? truncate(exchange.upstream.response) : null,
      upstream_status: exchange.upstream?.status ?? null,
      upstream_duration_ms: exchange.upstream?.durationMs ?? null,
      inbound_tokens: tokens.inbound,
      outbound_tokens: tokens.outbound,
      upstream_tokens: countTokens(exchange.upstream?.response),
      total_tokens: tokens.total,
    });
  } catch {
    // The ledger is observability, never a gate on the call itself.
  }
}
