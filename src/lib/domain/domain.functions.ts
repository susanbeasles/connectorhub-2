import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperator } from "../operator.middleware";

const domain = z.string().min(4).max(253);
const id = z.string().uuid();

/**
 * A domain claim is bound to the account that opened it. Zone proof establishes
 * who speaks for the zone; it never stands in for an identity assertion, so no
 * function here mints a session.
 */
export const openClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ domain }).parse(input))
  .handler(async ({ data, context }) => {
    const { openDomainClaim } = await import("./domain.server");
    return openDomainClaim(data.domain, context.userId);
  });

export const checkClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id }).parse(input))
  .handler(async ({ data, context }) => {
    const { checkDomainClaim } = await import("./domain.server");
    return checkDomainClaim(data.id, {
      userId: context.userId,
      email: (context.claims as { email?: string }).email,
    });
  });

export const bindSso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id, kind: z.enum(["saml", "oidc"]), metadataUrl: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { bindDomainSso } = await import("./domain.server");
    return bindDomainSso(data, {
      userId: context.userId,
      email: (context.claims as { email?: string }).email,
    });
  });

export const rotateSso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id }).parse(input))
  .handler(async ({ data, context }) => {
    const { rotateDomainSso } = await import("./domain.server");
    return rotateDomainSso(data.id, {
      userId: context.userId,
      email: (context.claims as { email?: string }).email,
    });
  });

export const listClaims = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async () => {
    const { listDomainClaims } = await import("./domain.server");
    return listDomainClaims();
  });
