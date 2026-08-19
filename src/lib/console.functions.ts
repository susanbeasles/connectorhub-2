import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./operator.middleware";
import {
  healthCheckLogic,
  introspectMcpLogic,
  issueTokenLogic,
  saveCredentialLogic,
  testToolLogic,
} from "./console.server";

export const saveCredential = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        serverId: z.string().uuid(),
        label: z.string().min(1).max(64),
        kind: z.enum(["none", "api_key", "bearer", "basic", "oauth2"]),
        headerName: z.string().min(1).max(64),
        valueTemplate: z.string().min(1).max(256),
        secret: z.string().min(1).max(8192),
        ttlHours: z.number().int().min(0).max(8760).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    saveCredentialLogic(context.supabase as never, context.userId, data),
  );

export const issueToken = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({
        serverId: z.string().uuid(),
        label: z.string().min(1).max(64),
        ttlHours: z.number().int().min(1).max(720),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    issueTokenLogic(context.supabase as never, context.userId, data),
  );

export const runHealthCheck = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ serverId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) =>
    healthCheckLogic(context.supabase as never, context.userId, data.serverId),
  );

export const introspectMcp = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z.object({ url: z.string().url().startsWith("https://") }).parse(input),
  )
  .handler(async ({ data }) => introspectMcpLogic(data.url));

export const testTool = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) =>
    z
      .object({ toolId: z.string().uuid(), args: z.record(z.unknown()).default({}) })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    testToolLogic(context.supabase as never, context.userId, {
      toolId: data.toolId,
      args: data.args as Record<string, unknown>,
    }),
  );
