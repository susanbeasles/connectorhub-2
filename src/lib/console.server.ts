import type { SupabaseClient } from "@supabase/supabase-js";
import { mintToken, sha256Hex } from "./crypto.server";
import { Secret } from "./secret/index.server";
import { executeTool, logEvent, type ServerRow, type ToolRow } from "./proxy.server";

type DB = SupabaseClient<any, any, any>;

async function ownedServer(supabase: DB, serverId: string): Promise<ServerRow> {
  const { data, error } = await supabase
    .from("servers")
    .select("*")
    .eq("id", serverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Server not found");
  return data as ServerRow;
}

export async function saveCredentialLogic(
  supabase: DB,
  userId: string,
  input: {
    serverId: string;
    label: string;
    kind: string;
    headerName: string;
    valueTemplate: string;
    secret: string;
    ttlHours: number | null;
  },
) {
  const server = await ownedServer(supabase, input.serverId);
  // Filed in the host's secret store; the row keeps only the reference.
  const encrypted = await Secret.put(`credential/${input.serverId}/${input.label}`, input.secret);
  const expires_at =
    input.ttlHours && input.ttlHours > 0
      ? new Date(Date.now() + input.ttlHours * 3600_000).toISOString()
      : null;

  const { data: existing } = await supabase
    .from("credentials")
    .select("id")
    .eq("server_id", server.id)
    .eq("label", input.label)
    .maybeSingle();

  const payload = {
    user_id: userId,
    server_id: server.id,
    label: input.label,
    kind: input.kind,
    header_name: input.headerName,
    value_template: input.valueTemplate,
    encrypted_value: encrypted,
    rotated_at: new Date().toISOString(),
    expires_at,
  };

  const { error } = existing
    ? await supabase.from("credentials").update(payload).eq("id", existing.id)
    : await supabase.from("credentials").insert(payload);
  if (error) throw new Error(error.message);

  await logEvent({
    user_id: userId,
    server_id: server.id,
    event: existing ? "credential.rotated" : "credential.created",
    message: `Credential "${input.label}" ${existing ? "rotated" : "stored"} (encrypted at rest)`,
    meta: { expires_at },
  });
  return { ok: true, expires_at };
}

export async function issueTokenLogic(
  supabase: DB,
  userId: string,
  input: { serverId: string; label: string; ttlHours: number },
) {
  const server = await ownedServer(supabase, input.serverId);
  const token = mintToken();
  const hash = await sha256Hex(token);
  const expires_at = new Date(Date.now() + input.ttlHours * 3600_000).toISOString();
  const { error } = await supabase.from("access_tokens").insert({
    user_id: userId,
    server_id: server.id,
    label: input.label,
    token_hash: hash,
    token_prefix: token.slice(0, 10),
    expires_at,
  });
  if (error) throw new Error(error.message);
  await logEvent({
    user_id: userId,
    server_id: server.id,
    event: "token.issued",
    message: `Short-lived client token issued (${input.ttlHours}h)`,
    meta: { label: input.label, expires_at },
  });
  return { token, expires_at };
}

export async function healthCheckLogic(supabase: DB, userId: string, serverId: string) {
  const server = await ownedServer(supabase, serverId);
  const started = Date.now();
  let health: "healthy" | "degraded" | "down" = "down";
  let status = 0;
  let message = "";
  try {
    const res = await fetch(server.base_url, {
      method: "GET",
      headers: { accept: "*/*" },
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    health = res.ok ? "healthy" : res.status < 500 ? "degraded" : "down";
    message = `Upstream responded ${res.status}`;
  } catch (e) {
    message = e instanceof Error ? e.message : "Unreachable";
  }
  const duration = Date.now() - started;
  await supabase
    .from("servers")
    .update({ health, last_health_check: new Date().toISOString() })
    .eq("id", server.id);
  await logEvent({
    user_id: userId,
    server_id: server.id,
    level: health === "healthy" ? "info" : "warn",
    event: "health.check",
    status_code: status || null,
    duration_ms: duration,
    message,
  });
  return { health, status, durationMs: duration, message };
}

export async function introspectMcpLogic(url: string) {
  const call = async (method: string, params: Record<string, unknown>, id: number) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const line = text
      .split("\n")
      .map((l) => l.replace(/^data:\s*/, "").trim())
      .filter((l) => l.startsWith("{"))
      .pop();
    if (!line) throw new Error(`Upstream returned ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(line) as { result?: any; error?: { message: string } };
  };

  await call(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "zero-trust-broker", version: "1.0.0" },
    },
    1,
  ).catch(() => null);

  const listed = await call("tools/list", {}, 2);
  if (listed.error) throw new Error(listed.error.message);
  const tools = (listed.result?.tools ?? []) as Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchemaJson: JSON.stringify(t.inputSchema ?? { type: "object", properties: {} }),
  }));
}

export async function testToolLogic(
  supabase: DB,
  userId: string,
  input: { toolId: string; args: Record<string, unknown> },
) {
  const { data: tool } = await supabase.from("tools").select("*").eq("id", input.toolId).maybeSingle();
  if (!tool) throw new Error("Tool not found");
  const server = await ownedServer(supabase, tool.server_id as string);
  const result = await executeTool(server, tool as ToolRow, input.args);
  await logEvent({
    user_id: userId,
    server_id: server.id,
    level: result.status < 400 ? "info" : "error",
    event: "tool.test",
    tool_name: tool.name as string,
    status_code: result.status,
    duration_ms: result.durationMs,
    message: `Manual test of ${tool.name}`,
  });
  const { wire: _wire, ...dto } = result;
  return dto;
}
