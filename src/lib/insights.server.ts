import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Root-cause view over the audit trail: the same rows the Logs tab shows,
 * folded into per-tool reliability and latency so an operator can see which
 * tool is failing before reading a single line.
 */

type DB = SupabaseClient<any, any, any>;

export type ToolInsight = {
  tool: string;
  calls: number;
  errors: number;
  errorRate: number;
  p50: number;
  p95: number;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type LogEntry = {
  id: string;
  created_at: string;
  level: string;
  event: string;
  tool_name: string | null;
  status_code: number | null;
  duration_ms: number | null;
  message: string;
};

export type InsightsFilter = {
  serverId: string;
  windowHours: number;
  level?: string | null;
  tool?: string | null;
  search?: string | null;
};

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;

export async function insightsLogic(supabase: DB, input: InsightsFilter) {
  const since = new Date(Date.now() - input.windowHours * 3600_000).toISOString();
  let query = supabase
    .from("audit_logs")
    .select("id, created_at, level, event, tool_name, status_code, duration_ms, message")
    .eq("server_id", input.serverId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  if (input.level) query = query.eq("level", input.level);
  if (input.tool) query = query.eq("tool_name", input.tool);
  if (input.search) query = query.ilike("message", `%${input.search}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const logs = (data ?? []) as LogEntry[];

  const byTool = new Map<string, LogEntry[]>();
  for (const row of logs) {
    if (!row.tool_name) continue;
    const bucket = byTool.get(row.tool_name) ?? [];
    bucket.push(row);
    byTool.set(row.tool_name, bucket);
  }

  const tools: ToolInsight[] = [...byTool.entries()]
    .map(([tool, rows]) => {
      const failures = rows.filter((r) => r.level === "error" || (r.status_code ?? 0) >= 400);
      const durations = rows
        .map((r) => r.duration_ms ?? 0)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      const last = failures[0] ?? null;
      return {
        tool,
        calls: rows.length,
        errors: failures.length,
        errorRate: rows.length === 0 ? 0 : failures.length / rows.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        lastError: last?.message ?? null,
        lastErrorAt: last?.created_at ?? null,
      };
    })
    .sort((a, b) => b.errorRate - a.errorRate || b.calls - a.calls);

  return {
    logs,
    tools,
    totals: {
      calls: logs.length,
      errors: logs.filter((l) => l.level === "error").length,
      warnings: logs.filter((l) => l.level === "warn").length,
    },
  };
}
