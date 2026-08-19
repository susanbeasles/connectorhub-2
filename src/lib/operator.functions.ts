import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperator } from "./operator.middleware";

/** Null means "authenticated but not seated" — the console renders a denial. */
export const currentOperator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOperator } = await import("./operator.server");
    const email = (context.claims as { email?: string }).email;
    return resolveOperator(context.userId, email);
  });

export const roster = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async () => {
    const { operatorRoster } = await import("./operator.server");
    return operatorRoster();
  });

export const invite = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({ email: z.string().email().max(200), role: z.enum(["admin", "viewer"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { inviteOperator } = await import("./operator.server");
    return inviteOperator(context.operator, data);
  });

export const cancelInvite = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { revokeInvite } = await import("./operator.server");
    return revokeInvite(context.operator, data.id);
  });

export const removeOperator = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { revokeOperator } = await import("./operator.server");
    return revokeOperator(context.operator, data.userId);
  });
