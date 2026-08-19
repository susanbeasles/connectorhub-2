import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Factor state is owned by the broker, never inferred from the client session. */

export const mfaStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { mfaState } = await import("./factors.server");
    return mfaState(context.userId);
  });

/** Enrollment is accepted only after the server re-verifies the ceremony itself. */
export const enrollFactor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["passkey", "totp", "sso"]),
        reference: z.string().min(1).max(200),
        label: z.string().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { enrollProvenFactor } = await import("./factors.server");
    return enrollProvenFactor({ userId: context.userId, ...data });
  });

export const removeFactor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { dropFactor } = await import("./factors.server");
    return dropFactor(context.userId, data.id);
  });

export const mintRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { issueRecoveryCodes } = await import("./factors.server");
    return { codes: await issueRecoveryCodes(context.userId) };
  });

/**
 * Passkey enrollment for the second-factor gate. Seat-gated registration lives
 * in webauthn.functions; the factor an identity must hold *before* it can be
 * seated cannot itself require a seat.
 */

const origin = z.string().url();

export const startFactorKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ origin }).parse(input))
  .handler(async ({ data, context }) => {
    const { registrationOptions } = await import("@/lib/webauthn.server");
    return registrationOptions({
      userId: context.userId,
      userName: (context.claims as { email?: string }).email ?? context.userId,
      origin: data.origin,
      policy: "any",
    });
  });

export const finishFactorKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ origin, label: z.string().min(1).max(80), response: z.unknown() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { verifyRegistration } = await import("@/lib/webauthn.server");
    return verifyRegistration({
      userId: context.userId,
      origin: data.origin,
      label: data.label,
      policy: "any",
      response: data.response as never,
    });
  });
