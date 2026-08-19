import { z } from "zod";

/**
 * The wire contract for anything that wants to be seen. Deliberately forgiving:
 * every field but the trace id is optional and unknown keys survive into `raw`,
 * so a caller can never be rejected for telling us too much.
 */

export const SPAN_KINDS = [
  "llm_call",
  "tool_call",
  "skill",
  "retrieval",
  "human_approval",
  "event",
] as const;

export type SpanKind = (typeof SPAN_KINDS)[number];

export const usageSchema = z
  .object({
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    cached: z.number().nonnegative().optional(),
    reasoning: z.number().nonnegative().optional(),
    prompt_tokens: z.number().nonnegative().optional(),
    completion_tokens: z.number().nonnegative().optional(),
    input_tokens: z.number().nonnegative().optional(),
    output_tokens: z.number().nonnegative().optional(),
    cache_read_input_tokens: z.number().nonnegative().optional(),
    cached_tokens: z.number().nonnegative().optional(),
    reasoning_tokens: z.number().nonnegative().optional(),
  })
  .passthrough();

export const eventSchema = z
  .object({
    v: z.string().default("1"),
    traceId: z.string().min(1).max(200),
    spanId: z.string().min(1).max(200).optional(),
    parentSpanId: z.string().min(1).max(200).optional(),
    kind: z.enum(SPAN_KINDS).optional(),
    name: z.string().max(200).optional(),
    provider: z.string().max(80).optional(),
    model: z.string().max(160).optional(),
    tool: z.string().max(160).optional(),
    skill: z.string().max(160).optional(),
    status: z.enum(["ok", "error", "cancelled"]).optional(),
    statusCode: z.number().int().optional(),
    error: z.string().max(4000).optional(),
    startedAt: z.string().datetime().optional(),
    durationMs: z.number().nonnegative().optional(),
    usage: usageSchema.optional(),
    costUsd: z.number().nonnegative().optional(),
    systemPrompt: z.string().optional(),
    input: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional(),
    output: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional(),
    contextWindow: z.unknown().optional(),
    args: z.record(z.unknown()).optional(),
    result: z.unknown().optional(),
    attributes: z.record(z.unknown()).optional(),
    trace: z
      .object({
        name: z.string().max(200).optional(),
        intent: z.string().max(500).optional(),
        actor: z.string().max(200).optional(),
        client: z.string().max(200).optional(),
        environment: z.string().max(80).optional(),
        status: z.string().max(40).optional(),
        endedAt: z.string().datetime().optional(),
        attributes: z.record(z.unknown()).optional(),
      })
      .optional(),
  })
  .passthrough();

export const batchSchema = z.union([eventSchema, z.array(eventSchema).max(500)]);

export type TelemetryEvent = z.infer<typeof eventSchema>;
