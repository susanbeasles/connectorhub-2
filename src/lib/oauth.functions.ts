import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./operator.middleware";

export const getAuthorization = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { authorizationDetails } = await import("./oauth.server");
    const details = await authorizationDetails(data.requestId);
    if (details.server.user_id !== context.userId) throw new Error("Not your broker");
    return details;
  });

export const approveAuthorizationRequest = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        scopes: z.array(z.string().max(200)).max(200),
        ttlMinutes: z.number().int().min(5).max(43200),
        maxCalls: z.number().int().min(1).max(10000).nullable(),
        origin: z.string().url(),
        assertion: z.unknown().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { approveAuthorization } = await import("./oauth.server");
    return approveAuthorization({ ...data, userId: context.userId });
  });

export const denyAuthorizationRequest = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { denyAuthorization } = await import("./oauth.server");
    return denyAuthorization(data.requestId, context.userId);
  });

export const revokeGrant = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ grantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { revokeGrantById } = await import("./oauth.server");
    return revokeGrantById(context.userId, data.grantId);
  });

const originInput = z.object({ requestId: z.string().uuid(), origin: z.string().url() });

/** Challenge for the hardware touch that authorizes one grant. */
export const grantAssertionOptions = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => originInput.parse(input))
  .handler(async ({ data, context }) => {
    const { authorizationDetails } = await import("./oauth.server");
    const { assertionOptions } = await import("./webauthn.server");
    const details = await authorizationDetails(data.requestId);
    if (details.server.user_id !== context.userId) throw new Error("Not your broker");
    return assertionOptions({
      userId: context.userId,
      origin: data.origin,
      requestId: data.requestId,
      policy: details.server.webauthn_authenticator as never,
    });
  });
