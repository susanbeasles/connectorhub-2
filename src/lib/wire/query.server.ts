import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read side of the wire ledger: the raw exchanges plus the token economics an
 * operator actually asks about — what this broker costs the model per tool,
 * inbound versus outbound, and in aggregate.
 */

type DB = SupabaseClient<any, any, any>;

export type WireEntry = {
  id: string;
  created_at: string;
  client_name: string;
  session_kind: string;
  rpc_method: string;
  tool_name: string | null;
  ip: string;
  country: string;
  user_agent: string;
  request_headers: Record<string, string>;
  request_body: any;
  request_bytes: number;
  response_body: string;
  response_bytes: number;
  status_code: number;
  outcome: string;
  duration_ms: number;
  upstream_method: string | null;
  upstream_url: string | null;
  upstream_request: any;
  upstream_response: string | null;
  upstream_status: number | null;
  upstream_duration_ms: number | null;
  inbound_tokens: number;
  outbound_tokens: number;
  upstream_tokens: number;
  total_tokens: number;
};

export type ToolSpend = {
  tool: string;
  calls: number;
  inbound: number;
  outbound: number;
  upstream: number;
  total: number;
  avgTotal: number;
};

export type WireFilter = {
  serverId: string;
  windowHours: number;
  tool?: string | null;
  search?: string | null;
};

export async function wireLogic(supabase: DB, input: WireFilter) {
  const since = new Date(Date.now() - input.windowHours * 3600_000).toISOString();
  let query = supabase
    .from("wire_logs")
    .select("*")
    .eq("server_id", input.serverId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);

  if (input.tool) query = query.eq("tool_name", input.tool);
  if (input.search) query = query.or(
    `client_name.ilike.%${input.search}%,ip.ilike.%${input.search}%,rpc_method.ilike.%${input.search}%`,
  );

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const entries = (data ?? []) as WireEntry[];

  const buckets = new Map<string, WireEntry[]>();
  for (const entry of entries) {
    const key = entry.tool_name ?? entry.rpc_method ?? "(protocol)";
    buckets.set(key, [...(buckets.get(key) ?? []), entry]);
  }

  const tools: ToolSpend[] = [...buckets.entries()]
    .map(([tool, rows]) => {
      const sum = (pick: (r: WireEntry) => number) => rows.reduce((a, r) => a + pick(r), 0);
      const total = sum((r) => r.total_tokens);
      return {
        tool,
        calls: rows.length,
        inbound: sum((r) => r.inbound_tokens),
        outbound: sum((r) => r.outbound_tokens),
        upstream: sum((r) => r.upstream_tokens),
        total,
        avgTotal: rows.length === 0 ? 0 : Math.round(total / rows.length),
      };
    })
    .sort((a, b) => b.total - a.total);

  const totals = tools.reduce(
    (acc, t) => ({
      calls: acc.calls + t.calls,
      inbound: acc.inbound + t.inbound,
      outbound: acc.outbound + t.outbound,
      upstream: acc.upstream + t.upstream,
      total: acc.total + t.total,
    }),
    { calls: 0, inbound: 0, outbound: 0, upstream: 0, total: 0 },
  );

  return { entries, tools, totals };
}
