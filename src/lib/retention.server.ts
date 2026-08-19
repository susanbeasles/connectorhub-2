/**
 * History is part of the product: hot rows stay fast, everything older is folded
 * into permanent per-day rollups and archived verbatim before it is pruned.
 */

type Row = {
  id: string;
  server_id: string;
  user_id: string;
  created_at: string;
  level: string;
  event: string;
  tool_name: string | null;
  status_code: number | null;
  duration_ms: number | null;
  message: string;
};

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number);

const dayOf = (iso: string) => iso.slice(0, 10);

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function summarise(rows: Row[]) {
  const durations = rows
    .map((r) => r.duration_ms ?? 0)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  return {
    calls: rows.length,
    errors: rows.filter((r) => r.level === "error" || (r.status_code ?? 0) >= 400).length,
    warnings: rows.filter((r) => r.level === "warn").length,
    p50_ms: percentile(durations, 50),
    p95_ms: percentile(durations, 95),
  };
}

/** Roll up + archive + prune everything past a broker's retention window. */
export async function compactHistory() {
  const db = await admin();
  const { data: servers } = await db.from("servers").select("id, user_id, retention_days");
  let archived = 0;
  let pruned = 0;

  for (const server of servers ?? []) {
    const days = (server.retention_days as number) ?? 30;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data } = await db
      .from("audit_logs")
      .select("id, server_id, user_id, created_at, level, event, tool_name, status_code, duration_ms, message")
      .eq("server_id", server.id as string)
      .lt("created_at", cutoff)
      .order("created_at")
      .limit(5000);

    const rows = (data ?? []) as Row[];
    if (rows.length === 0) continue;

    const byDay = new Map<string, Row[]>();
    for (const row of rows) {
      const bucket = byDay.get(dayOf(row.created_at)) ?? [];
      bucket.push(row);
      byDay.set(dayOf(row.created_at), bucket);
    }

    for (const [day, dayRows] of byDay) {
      const byTool = new Map<string, Row[]>();
      for (const row of dayRows) {
        const key = row.tool_name ?? "";
        const bucket = byTool.get(key) ?? [];
        bucket.push(row);
        byTool.set(key, bucket);
      }

      await db.from("audit_rollups").upsert(
        [...byTool.entries()].map(([tool, toolRows]) => ({
          user_id: server.user_id as string,
          server_id: server.id as string,
          day,
          tool_name: tool,
          ...summarise(toolRows),
        })),
        { onConflict: "server_id,day,tool_name" },
      );

      await db.from("audit_archive").upsert(
        {
          user_id: server.user_id as string,
          server_id: server.id as string,
          day,
          event_count: dayRows.length,
          batch: dayRows as never,
        },
        { onConflict: "server_id,day" },
      );
      archived += dayRows.length;
    }

    await db
      .from("audit_logs")
      .delete()
      .in("id", rows.map((r) => r.id));
    pruned += rows.length;
  }

  return { archived, pruned };
}

/** Long-window history straight from the permanent rollups. */
export async function historyLogic(
  supabase: { from: (t: string) => any },
  input: { serverId: string; days: number },
) {
  const since = new Date(Date.now() - input.days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("audit_rollups")
    .select("day, tool_name, calls, errors, warnings, p50_ms, p95_ms")
    .eq("server_id", input.serverId)
    .gte("day", since)
    .order("day", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    day: string;
    tool_name: string;
    calls: number;
    errors: number;
    warnings: number;
    p50_ms: number;
    p95_ms: number;
  }[];
}
