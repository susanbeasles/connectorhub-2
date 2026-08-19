import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./operator.middleware";

const windowInput = z.object({ windowHours: z.number().int().min(1).max(8760).default(24) });

export const telemetrySpend = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => windowInput.parse(input))
  .handler(async ({ data, context }) => {
    const { spendReport } = await import("./telemetry/query.server");
    return spendReport(context.supabase as never, data);
  });

export const telemetryPatterns = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => windowInput.parse(input))
  .handler(async ({ data, context }) => {
    const { patternReport } = await import("./telemetry/query.server");
    return patternReport(context.supabase as never, data);
  });

export const telemetryTraces = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    windowInput
      .extend({
        search: z.string().max(200).nullable().default(null),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { listTraces } = await import("./telemetry/query.server");
    return listTraces(context.supabase as never, data);
  });

export const telemetryTrace = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ traceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { traceDetail } = await import("./telemetry/query.server");
    return traceDetail(context.supabase as never, data.traceId);
  });

export const telemetrySources = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async ({ context }) => {
    const { listSources } = await import("./telemetry/sources.server");
    return listSources(context.supabase as never);
  });

export const createIngestSource = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(80),
        serverId: z.string().uuid().nullable().default(null),
        redactKeys: z.array(z.string().min(1).max(80)).max(50).default([]),
        mode: z.enum(["asymmetric", "key"]).default("asymmetric"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { createSource } = await import("./telemetry/sources.server");
    return createSource(context.supabase as never, context.userId, data);
  });

export const rotateIngestEnrollment = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ sourceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { rotateEnrollment } = await import("./telemetry/sources.server");
    return rotateEnrollment(context.supabase as never, data.sourceId);
  });


export const setIngestSourceState = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z.object({ sourceId: z.string().uuid(), disabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { setSourceState } = await import("./telemetry/sources.server");
    return setSourceState(context.supabase as never, data);
  });

export const askTelemetryQuestion = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    windowInput.extend({ question: z.string().min(3).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { askTelemetry } = await import("./telemetry/ask.server");
    return askTelemetry(context.supabase as never, data);
  });
