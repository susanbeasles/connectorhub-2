import type { TelemetryEvent } from "./schema";

/**
 * Vendor payload -> canonical span. Nothing here touches the database; it only
 * decides what a message *means* so every downstream reader sees one shape.
 */

export type Usage = {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
};

export type CanonicalSpan = {
  externalId: string;
  parentExternalId: string | null;
  kind: string;
  name: string;
  provider: string;
  model: string;
  toolName: string | null;
  skill: string | null;
  status: string;
  statusCode: number | null;
  error: string | null;
  startedAt: string;
  durationMs: number;
  usage: Usage;
  costUsd: number | null;
  attributes: Record<string, unknown>;
  raw: Record<string, unknown>;
  payload: {
    system_prompt: string | null;
    input: string | null;
    output: string | null;
    context_window: unknown;
    args: unknown;
    result: unknown;
  };
};

const KNOWN_KEYS = new Set([
  "v",
  "traceId",
  "spanId",
  "parentSpanId",
  "kind",
  "name",
  "provider",
  "model",
  "tool",
  "skill",
  "status",
  "statusCode",
  "error",
  "startedAt",
  "durationMs",
  "usage",
  "costUsd",
  "systemPrompt",
  "input",
  "output",
  "contextWindow",
  "args",
  "result",
  "attributes",
  "trace",
]);

const text = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
};

const num = (...values: Array<number | undefined>) => values.find((v) => typeof v === "number") ?? 0;

function readUsage(event: TelemetryEvent): Usage {
  const u = (event.usage ?? {}) as Record<string, number | undefined>;
  return {
    input: num(u["input"], u["input_tokens"], u["prompt_tokens"]),
    output: num(u["output"], u["output_tokens"], u["completion_tokens"]),
    cached: num(u["cached"], u["cached_tokens"], u["cache_read_input_tokens"]),
    reasoning: num(u["reasoning"], u["reasoning_tokens"]),
  };
}

function inferKind(event: TelemetryEvent): string {
  if (event.kind) return event.kind;
  if (event.tool) return "tool_call";
  if (event.skill) return "skill";
  if (event.model) return "llm_call";
  return "event";
}

function inferProvider(event: TelemetryEvent): string {
  if (event.provider) return event.provider;
  const model = (event.model ?? "").toLowerCase();
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gemini")) return "google";
  return "";
}

/** Anything we did not model explicitly is preserved verbatim under `raw`. */
function residue(event: TelemetryEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) if (!KNOWN_KEYS.has(k)) out[k] = v;
  return out;
}

export function normalizeEvent(event: TelemetryEvent, fallbackId: string): CanonicalSpan {
  const usage = readUsage(event);
  return {
    externalId: event.spanId ?? fallbackId,
    parentExternalId: event.parentSpanId ?? null,
    kind: inferKind(event),
    name: event.name ?? event.tool ?? event.skill ?? event.model ?? "event",
    provider: inferProvider(event),
    model: event.model ?? "",
    toolName: event.tool ?? null,
    skill: event.skill ?? null,
    status: event.status ?? ((event.statusCode ?? 0) >= 400 || event.error ? "error" : "ok"),
    statusCode: event.statusCode ?? null,
    error: event.error ?? null,
    startedAt: event.startedAt ?? new Date().toISOString(),
    durationMs: Math.round(event.durationMs ?? 0),
    usage,
    costUsd: event.costUsd ?? null,
    attributes: event.attributes ?? {},
    raw: residue(event),
    payload: {
      system_prompt: event.systemPrompt ?? null,
      input: text(event.input),
      output: text(event.output),
      context_window: event.contextWindow ?? null,
      args: event.args ?? null,
      result: event.result ?? null,
    },
  };
}

/** Redaction is a source-level policy, applied before anything is persisted. */
export function redact(span: CanonicalSpan, keys: string[]): CanonicalSpan {
  if (keys.length === 0) return span;
  const pattern = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  const scrub = (value: string | null) => (value ? value.replace(pattern, "[redacted]") : value);
  return {
    ...span,
    payload: {
      ...span.payload,
      system_prompt: scrub(span.payload.system_prompt),
      input: scrub(span.payload.input),
      output: scrub(span.payload.output),
    },
  };
}
