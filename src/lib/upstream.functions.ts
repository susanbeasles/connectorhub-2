import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, requireManager } from "./operator.middleware";

const httpsUrl = z.string().url().startsWith("https://");

export const upstreamState = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ serverId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { upstreamStatus } = await import("./upstream.server");
    return upstreamStatus(data.serverId);
  });

export const configureUpstream = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) =>
    z
      .object({
        serverId: z.string().uuid(),
        provider: z.string().min(1).max(64),
        authorizeUrl: httpsUrl,
        tokenUrl: httpsUrl,
        clientId: z.string().min(1).max(256),
        clientSecret: z.string().max(4096).optional(),
        scopes: z.array(z.string().min(1).max(128)).max(64),
        audience: z.string().max(256).optional(),
        headerName: z.string().min(1).max(64).default("authorization"),
        valueTemplate: z.string().min(1).max(256).default("Bearer {{secret}}"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { saveUpstream } = await import("./upstream.server");
    return saveUpstream(context.userId, data);
  });

export const startUpstream = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) =>
    z.object({ serverId: z.string().uuid(), origin: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { beginUpstream } = await import("./upstream.server");
    return beginUpstream(context.userId, data.serverId, data.origin);
  });

export const revokeUpstream = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) => z.object({ serverId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { disconnectUpstream } = await import("./upstream.server");
    return disconnectUpstream(context.userId, data.serverId);
  });
