import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./operator.middleware";

/** Operator-only read of a broker's wire ledger and token economics. */
export const serverWire = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        serverId: z.string().uuid(),
        windowHours: z.number().int().min(1).max(720).default(24),
        tool: z.string().max(128).nullable().default(null),
        search: z.string().max(200).nullable().default(null),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { wireLogic } = await import("./wire/query.server");
    return wireLogic(context.supabase as never, data);
  });
