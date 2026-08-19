import { sha256Hex } from "./crypto.server";
import { Secret } from "./secret/index.server";

export type ToolRow = {
  id: string;
  name: string;
  description: string;
  method: string;
  path: string;
  input_schema: Record<string, unknown>;
  header_template: Record<string, string>;
  body_template: Record<string, unknown> | null;
  scopes: string[];
  approval: "always_ask" | "always_allow";
  enabled: boolean;
};

export type ServerRow = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  base_url: string;
  description: string;
  instructions: string;
  enabled: boolean;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function logEvent(entry: {
  user_id: string;
  server_id?: string | null;
  level?: string;
  event: string;
  tool_name?: string | null;
  status_code?: number | null;
  duration_ms?: number | null;
  message?: string;
  meta?: Record<string, unknown>;
}) {
  const db = await admin();
  const { redactValue } = await import("./wire/redact");
  await db.from("audit_logs").insert({
    user_id: entry.user_id,
    server_id: entry.server_id ?? null,
    level: entry.level ?? "info",
    event: entry.event,
    tool_name: entry.tool_name ?? null,
    status_code: entry.status_code ?? null,
    duration_ms: entry.duration_ms ?? null,
    message: entry.message ?? "",
    // Every audit line passes the same sweep as the wire ledger. A caller
    // cannot log a secret by accident, whatever it puts in `meta`.
    meta: redactValue(entry.meta ?? {}) as never,
  });

}

/** Validate an opaque client token against a server. Returns null when invalid/expired/revoked. */
export async function authenticateToken(serverId: string, token: string | null) {
  if (!token) return null;
  const db = await admin();
  const hash = await sha256Hex(token);
  const { data } = await db
    .from("access_tokens")
    .select("id, user_id, server_id, expires_at, revoked_at")
    .eq("token_hash", hash)
    .eq("server_id", serverId)
    .maybeSingle();
  if (!data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  await db
    .from("access_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return data;
}

function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => {
    const v = args[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Headers that authorize exactly one outbound request. Nothing is returned
 * that could authorize a second one: the provider authority is created,
 * applied to this request, and disposed inside this call.
 */
export async function credentialHeaders(
  serverId: string,
  request: { method: string; url: string; body?: string | undefined },
): Promise<Record<string, string>> {
  const { upstreamHeaders } = await import("./upstream.server");
  const upstream = await upstreamHeaders(serverId, request);
  if (upstream) return upstream;


  const db = await admin();
  const { data } = await db
    .from("credentials")
    .select("header_name, value_template, encrypted_value, expires_at")
    .eq("server_id", serverId)
    .order("rotated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return {};
  const { Custody } = await import("./secret/ledger.server");
  const { data: owner } = await db
    .from("servers")
    .select("user_id")
    .eq("id", serverId)
    .maybeSingle();
  const entry = {
    userId: owner?.user_id ?? "",
    serverId,
    operation: "credential.used" as const,
    kind: "stored",
    detail: { method: request.method, host: new URL(request.url).host },
  };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    await Custody.record({ ...entry, outcome: "denied", detail: { reason: "expired" } });
    throw new Error("Stored credential has expired — rotate it in the console.");
  }
  // Borrowed for one header and gone. The column holds a reference or a sealed
  // record, never the credential itself.
  return Custody.with(entry, async () => ({
    [data.header_name]: await Secret.use(data.encrypted_value, (secret) =>
      interpolate(data.value_template, { secret }),
    ),
  }));
}


/** Execute one tool against the upstream provider. Credentials never leave the server. */
export async function executeTool(
  server: ServerRow,
  tool: ToolRow,
  args: Record<string, unknown>,
): Promise<{
  status: number;
  body: string;
  durationMs: number;
  /** The exact leg we put on the wire, for the ledger. */
  wire: { method: string; url: string; request: unknown };
}> {
  const started = Date.now();
  const base = server.base_url.replace(/\/+$/, "");
  let path = interpolate(tool.path, args);
  const method = tool.method.toUpperCase();

  const used = new Set(
    Array.from(tool.path.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)).map((m) => m[1] as string),
  );
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (!used.has(k)) rest[k] = v;

  let body: string | undefined;
  if (method === "GET" || method === "DELETE") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(rest)) qs.set(k, String(v));
    if (Array.from(qs.keys()).length) path += (path.includes("?") ? "&" : "?") + qs.toString();
  } else {
    body = JSON.stringify(tool.body_template ? { ...tool.body_template, ...rest } : rest);
  }

  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const wire = { method, url, request: body === undefined ? null : safeJson(body) };

  // Authorization is computed against the finished request, so signature
  // schemes can cover the method, URL and body actually being sent.
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    ...(await credentialHeaders(server.id, { method, url, body })),
  };
  for (const [k, v] of Object.entries(tool.header_template ?? {})) {
    headers[k] = interpolate(String(v), args);
  }


  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text.slice(0, 40_000),
      durationMs: Date.now() - started,
      wire,
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function toolToMcpSchema(tool: ToolRow) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema ?? { type: "object", properties: {} },
    annotations: {
      readOnlyHint: tool.method.toUpperCase() === "GET",
      destructiveHint: ["DELETE", "PUT", "PATCH"].includes(tool.method.toUpperCase()),
    },
  };
}
