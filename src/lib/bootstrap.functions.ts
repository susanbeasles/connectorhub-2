import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperator } from "./operator.middleware";

/** Public: the console needs to know whether an owner exists before anyone signs in. */
export const instanceClaim = createServerFn({ method: "POST" }).handler(async () => {
  const { claimState } = await import("./bootstrap.server");
  return claimState();
});

export const claimInstanceSeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ secret: z.string().max(400) }).parse(input))
  .handler(async ({ data, context }) => {
    const { claimInstance } = await import("./bootstrap.server");
    const email = (context.claims as { email?: string }).email;
    if (!email) throw new Error("Identity has no verified email.");
    return claimInstance({ userId: context.userId, email, secret: data.secret });
  });

export const attestations = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async () => {
    const { attestationChain } = await import("./bootstrap.server");
    return attestationChain();
  });
