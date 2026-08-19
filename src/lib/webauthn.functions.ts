import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./operator.middleware";

const origin = z.string().url();

export const listSecurityKeys = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async ({ context }) => {
    const { listKeys } = await import("./webauthn.server");
    return listKeys(context.userId);
  });

export const startKeyRegistration = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        origin,
        authenticator: z.enum(["cross_platform", "platform", "any"]).default("any"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { registrationOptions } = await import("./webauthn.server");
    return registrationOptions({
      userId: context.userId,
      userName: context.claims.email ?? context.userId,
      origin: data.origin,
      policy: data.authenticator,
    });
  });

export const finishKeyRegistration = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        origin,
        label: z.string().min(1).max(80),
        authenticator: z.enum(["cross_platform", "platform", "any"]).default("any"),
        response: z.unknown(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { verifyRegistration } = await import("./webauthn.server");
    return verifyRegistration({
      userId: context.userId,
      origin: data.origin,
      label: data.label,
      policy: data.authenticator,
      response: data.response as never,
    });
  });

export const deleteSecurityKey = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ keyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("webauthn_credentials")
      .delete()
      .eq("id", data.keyId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateBrokerPolicy = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        serverId: z.string().uuid(),
        dpop_mode: z.enum(["disabled", "preferred", "required"]),
        webauthn_policy: z.enum(["disabled", "write", "delete", "always"]),
        webauthn_authenticator: z.enum(["cross_platform", "platform", "any"]),
        webauthn_sso_fallback: z.boolean(),
        rate_limit_per_min: z.number().int().min(1).max(6000),
        retention_days: z.number().int().min(1).max(3650),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { serverId, ...patch } = data;
    const { error } = await supabaseAdmin
      .from("servers")
      .update(patch)
      .eq("id", serverId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
