import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./operator.middleware";
import { insightsLogic } from "./insights.server";

export const serverInsights = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        serverId: z.string().uuid(),
        windowHours: z.number().int().min(1).max(720).default(24),
        level: z.enum(["info", "warn", "error"]).nullable().default(null),
        tool: z.string().max(128).nullable().default(null),
        search: z.string().max(200).nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => insightsLogic(context.supabase as never, data));

/** Permanent history: per-day rollups that outlive the hot log window. */
export const serverHistory = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({ serverId: z.string().uuid(), days: z.number().int().min(1).max(3650).default(90) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { historyLogic } = await import("./retention.server");
    return historyLogic(context.supabase as never, data);
  });
