import { sha256Hex } from "../crypto.server";
import { rateHit } from "../ratelimit.server";
import { batchSchema, type TelemetryEvent } from "./schema";
import { normalizeEvent, redact, type CanonicalSpan } from "./normalize.server";
import { priceUsage } from "./price.server";
import { archiveBatch } from "./archive.server";

/**
 * The one door telemetry comes through. Accept first, understand second: the
 * raw batch is archived before anything is interpreted, so a parsing gap can
 * never become data loss.
 */

export type Source = {
  id: string;
  name: string;
  server_id: string | null;
  redact_keys: string[];
  disabled: boolean;
};

export type CaptureResult = {
  accepted: number;
  traceIds: string[];
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function resolveSource(key: string | null): Promise<Source | null> {
  if (!key) return null;
  const db = await admin();
  const { data } = await db
    .from("ingest_sources")
    .select("id, name, server_id, redact_keys, disabled")
    .eq("key_hash", await sha256Hex(key))
    .maybeSingle();
  if (!data || data.disabled) return null;
  return data as Source;
}

async function upsertTrace(source: Source, event: TelemetryEvent) {
  const db = await admin();
  const meta = event.trace ?? {};
  const { data: existing } = await db
    .from("traces")
    .select("id")
    .eq("source_id", source.id)
    .eq("external_id", event.traceId)
    .maybeSingle();

  if (existing) {
    const patch: Record<string, unknown> = {};
    if (meta.name) patch["name"] = meta.name;
    if (meta.intent) patch["intent"] = meta.intent;
    if (meta.actor) patch["actor"] = meta.actor;
    if (meta.client) patch["client"] = meta.client;
    if (meta.environment) patch["environment"] = meta.environment;
    if (meta.status) patch["status"] = meta.status;
    if (meta.endedAt) patch["ended_at"] = meta.endedAt;
    if (Object.keys(patch).length) await db.from("traces").update(patch as never).eq("id", existing.id);
    return existing.id as string;
  }

  const { data, error } = await db
    .from("traces")
    .insert({
      source_id: source.id,
      external_id: event.traceId,
      name: meta.name ?? event.traceId,
      intent: meta.intent ?? "",
      actor: meta.actor ?? "",
      client: meta.client ?? "",
      environment: meta.environment ?? "",
      status: meta.status ?? "open",
      started_at: event.startedAt ?? new Date().toISOString(),
      ended_at: meta.endedAt ?? null,
      attributes: (meta.attributes ?? {}) as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function persistSpan(source: Source, traceId: string, span: CanonicalSpan) {
  const db = await admin();
  const { data, error } = await db
    .from("spans")
    .upsert(
      {
        trace_id: traceId,
        source_id: source.id,
        external_id: span.externalId,
        parent_external_id: span.parentExternalId,
        kind: span.kind,
        name: span.name,
        provider: span.provider,
        model: span.model,
        tool_name: span.toolName,
        skill: span.skill,
        status: span.status,
        status_code: span.statusCode,
        error: span.error,
        started_at: span.startedAt,
        duration_ms: span.durationMs,
        attributes: span.attributes as never,
        raw: span.raw as never,
        normalized: true,
      },
      { onConflict: "source_id,external_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const spanId = data.id as string;

  const payload = span.payload;
  const bytes = JSON.stringify(payload).length;
  if (payload.system_prompt || payload.input || payload.output || payload.context_window || payload.args || payload.result) {
    await db.from("span_payloads").upsert(
      {
        span_id: spanId,
        system_prompt: payload.system_prompt,
        input: payload.input,
        output: payload.output,
        context_window: payload.context_window as never,
        args: payload.args as never,
        result: payload.result as never,
        bytes,
      },
      { onConflict: "span_id" },
    );
  }

  const priced = await priceUsage(span.provider, span.model, span.usage, span.costUsd);
  const tokens = span.usage.input + span.usage.output + span.usage.reasoning;
  if (tokens > 0 || priced.cost_usd > 0) {
    await db.from("span_costs").upsert(
      {
        span_id: spanId,
        trace_id: traceId,
        provider: span.provider,
        model: span.model,
        input_tokens: span.usage.input,
        output_tokens: span.usage.output,
        cached_tokens: span.usage.cached,
        reasoning_tokens: span.usage.reasoning,
        input_price: priced.input_per_mtok,
        output_price: priced.output_per_mtok,
        cached_price: priced.cached_per_mtok,
        cost_usd: priced.cost_usd,
        occurred_at: span.startedAt,
      },
      { onConflict: "span_id" },
    );
  }
  return { cost: priced.cost_usd, tokens, error: span.status === "error" };
}

async function rollTrace(traceId: string, delta: { cost: number; tokens: number; errors: number; spans: number }) {
  const db = await admin();
  const { data } = await db
    .from("traces")
    .select("span_count, error_count, total_cost_usd, total_tokens")
    .eq("id", traceId)
    .maybeSingle();
  if (!data) return;
  await db
    .from("traces")
    .update({
      span_count: Number(data.span_count) + delta.spans,
      error_count: Number(data.error_count) + delta.errors,
      total_cost_usd: Number(data.total_cost_usd) + delta.cost,
      total_tokens: Number(data.total_tokens) + delta.tokens,
    })
    .eq("id", traceId);
}

/** Capture a single event or a batch. Returns how much was accepted. */
export async function capture(source: Source, body: unknown): Promise<CaptureResult> {
  const parsed = batchSchema.parse(body);
  const events = Array.isArray(parsed) ? parsed : [parsed];

  await archiveBatch({ sourceId: source.id, events });

  const totals = new Map<string, { cost: number; tokens: number; errors: number; spans: number }>();
  const traceIds: string[] = [];

  for (const [index, event] of events.entries()) {
    const traceId = await upsertTrace(source, event);
    if (!traceIds.includes(traceId)) traceIds.push(traceId);
    const span = redact(
      normalizeEvent(event, `${event.traceId}:${Date.now()}:${index}`),
      source.redact_keys ?? [],
    );
    const outcome = await persistSpan(source, traceId, span);
    const bucket = totals.get(traceId) ?? { cost: 0, tokens: 0, errors: 0, spans: 0 };
    bucket.cost += outcome.cost;
    bucket.tokens += outcome.tokens;
    bucket.errors += outcome.error ? 1 : 0;
    bucket.spans += 1;
    totals.set(traceId, bucket);
  }

  for (const [traceId, delta] of totals) await rollTrace(traceId, delta);

  const db = await admin();
  await db
    .from("ingest_sources")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", source.id);

  return { accepted: events.length, traceIds };
}

export async function ingestBudget(sourceId: string) {
  return rateHit(`telemetry:${sourceId}`, 600, 60);
}
