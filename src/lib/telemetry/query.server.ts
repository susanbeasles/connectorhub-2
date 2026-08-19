import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read side of the telemetry plane. Everything the console shows — spend
 * breakdowns, trace lists, provenance chains — is folded here so no component
 * ever writes its own query.
 */

type DB = SupabaseClient<any, any, any>;

export type SpendSlice = { key: string; calls: number; tokens: number; cost: number; errors: number };

export type SpendReport = {
  totals: { calls: number; cost: number; inputTokens: number; outputTokens: number; cachedTokens: number; errors: number };
  byModel: SpendSlice[];
  byTool: SpendSlice[];
  bySkill: SpendSlice[];
  bySource: SpendSlice[];
  byDay: Array<{ day: string; cost: number; calls: number }>;
};

type SpanRow = {
  id: string;
  trace_id: string;
  source_id: string;
  kind: string;
  name: string;
  model: string;
  tool_name: string | null;
  skill: string | null;
  status: string;
  duration_ms: number;
  started_at: string;
};

type CostRow = {
  span_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;
};

const slice = (
  rows: SpanRow[],
  costs: Map<string, CostRow>,
  keyOf: (row: SpanRow) => string | null,
): SpendSlice[] => {
  const acc = new Map<string, SpendSlice>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const cost = costs.get(row.id);
    const entry = acc.get(key) ?? { key, calls: 0, tokens: 0, cost: 0, errors: 0 };
    entry.calls += 1;
    entry.errors += row.status === "error" ? 1 : 0;
    entry.tokens += cost ? Number(cost.input_tokens) + Number(cost.output_tokens) : 0;
    entry.cost += cost ? Number(cost.cost_usd) : 0;
    acc.set(key, entry);
  }
  return [...acc.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls);
};

export async function spendReport(supabase: DB, input: { windowHours: number }): Promise<SpendReport> {
  const since = new Date(Date.now() - input.windowHours * 3_600_000).toISOString();
  const { data: spanData, error } = await supabase
    .from("spans")
    .select("id, trace_id, source_id, kind, name, model, tool_name, skill, status, duration_ms, started_at")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  const spans = (spanData ?? []) as SpanRow[];

  const { data: costData } = await supabase
    .from("span_costs")
    .select("span_id, model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd")
    .gte("occurred_at", since)
    .limit(5000);
  const costs = new Map<string, CostRow>();
  for (const row of (costData ?? []) as CostRow[]) costs.set(row.span_id, row);

  const { data: sourceData } = await supabase.from("ingest_sources").select("id, name");
  const sourceNames = new Map<string, string>(
    (sourceData ?? []).map((s: { id: string; name: string }) => [s.id, s.name]),
  );

  const byDayMap = new Map<string, { day: string; cost: number; calls: number }>();
  for (const span of spans) {
    const day = span.started_at.slice(0, 10);
    const entry = byDayMap.get(day) ?? { day, cost: 0, calls: 0 };
    entry.calls += 1;
    entry.cost += Number(costs.get(span.id)?.cost_usd ?? 0);
    byDayMap.set(day, entry);
  }

  const totals = spans.reduce(
    (acc, span) => {
      const cost = costs.get(span.id);
      acc.calls += 1;
      acc.errors += span.status === "error" ? 1 : 0;
      acc.cost += Number(cost?.cost_usd ?? 0);
      acc.inputTokens += Number(cost?.input_tokens ?? 0);
      acc.outputTokens += Number(cost?.output_tokens ?? 0);
      acc.cachedTokens += Number(cost?.cached_tokens ?? 0);
      return acc;
    },
    { calls: 0, cost: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, errors: 0 },
  );

  return {
    totals,
    byModel: slice(spans, costs, (r) => r.model || null),
    byTool: slice(spans, costs, (r) => r.tool_name),
    bySkill: slice(spans, costs, (r) => r.skill),
    bySource: slice(spans, costs, (r) => sourceNames.get(r.source_id) ?? null),
    byDay: [...byDayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export async function listTraces(
  supabase: DB,
  input: { windowHours: number; search?: string | null; limit: number },
) {
  const since = new Date(Date.now() - input.windowHours * 3_600_000).toISOString();
  let query = supabase
    .from("traces")
    .select(
      "id, external_id, name, intent, actor, client, environment, status, started_at, ended_at, span_count, error_count, total_cost_usd, total_tokens",
    )
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(input.limit);
  if (input.search) query = query.or(`name.ilike.%${input.search}%,intent.ilike.%${input.search}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** One trace, fully expanded: the provenance chain plus every payload and cost. */
export async function traceDetail(supabase: DB, traceId: string) {
  const { data: trace, error } = await supabase.from("traces").select("*").eq("id", traceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!trace) throw new Error("Trace not found");

  const { data: spans } = await supabase
    .from("spans")
    .select("*")
    .eq("trace_id", traceId)
    .order("started_at", { ascending: true });
  const ids = (spans ?? []).map((s: { id: string }) => s.id);

  const { data: payloads } = ids.length
    ? await supabase.from("span_payloads").select("*").in("span_id", ids)
    : { data: [] };
  const { data: costs } = ids.length
    ? await supabase.from("span_costs").select("*").in("span_id", ids)
    : { data: [] };

  const payloadBy = new Map((payloads ?? []).map((p: { span_id: string }) => [p.span_id, p]));
  const costBy = new Map((costs ?? []).map((c: { span_id: string }) => [c.span_id, c]));

  return {
    trace,
    spans: (spans ?? []).map((span: { id: string }) => ({
      ...span,
      payload: payloadBy.get(span.id) ?? null,
      cost: costBy.get(span.id) ?? null,
    })),
  };
}

/** Repeated prompts, context bloat, and the tools that dominate the bill. */
export async function patternReport(supabase: DB, input: { windowHours: number }) {
  const report = await spendReport(supabase, input);
  const since = new Date(Date.now() - input.windowHours * 3_600_000).toISOString();
  const { data } = await supabase
    .from("spans")
    .select("id, name, kind, status, duration_ms, started_at")
    .gte("started_at", since)
    .limit(5000);

  const repeats = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ name: string }>) {
    repeats.set(row.name, (repeats.get(row.name) ?? 0) + 1);
  }

  return {
    costliest: report.byTool.slice(0, 10),
    models: report.byModel.slice(0, 10),
    repeats: [...repeats.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    cacheRatio:
      report.totals.inputTokens === 0
        ? 0
        : report.totals.cachedTokens / (report.totals.inputTokens + report.totals.cachedTokens),
  };
}
