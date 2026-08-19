import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Authentication proves who the caller is; this proves they hold a seat on this
 * broker. Every console server function goes through here, so a valid account
 * that was never invited can reach nothing.
 */
export const requireOperator = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { guardAccess } = await import("./access/index.server");
    await guardAccess(getRequest(), "console");
    const { resolveOperator } = await import("./operator.server");
    const email = (context.claims as { email?: string }).email;
    const operator = await resolveOperator(context.userId, email);
    if (!operator) throw new Error("Forbidden: this account is not an operator of this broker");
    return next({ context: { operator } });
  });

/**
 * Anything that changes infrastructure or reveals credential material. A seat
 * alone is read-only; only owner/admin may mutate or unseal.
 */
export const requireManager = createMiddleware({ type: "function" })
  .middleware([requireOperator])
  .server(async ({ next, context }) => {
    if (context.operator.role === "viewer") {
      throw new Error("Forbidden: viewers cannot change infrastructure or reveal secrets");
    }
    return next();
  });

