import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, requireManager } from "./operator.middleware";

const serverId = z.string().uuid();
const origin = z.string().url();

export const tunnelState = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ serverId }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Tunnel } = await import("./tunnel/index.server");
    return {
      tunnel: await Tunnel.status(data.serverId),
      available: Tunnel.available(),
      missing: Tunnel.missing(),
    };
  });

export const provisionTunnel = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) => z.object({ serverId, origin }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Tunnel } = await import("./tunnel/index.server");
    return Tunnel.provision(data.serverId, data.origin);
  });

export const teardownTunnel = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) => z.object({ serverId }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Tunnel } = await import("./tunnel/index.server");
    return Tunnel.teardown(data.serverId);
  });

export const reconcileTunnel = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) => z.object({ serverId, origin }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Tunnel } = await import("./tunnel/index.server");
    return Tunnel.reconcile(data.serverId, data.origin);
  });

/** One-time reveal of the connector token so `cloudflared` can be brought up. */
export const revealConnector = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) => z.object({ serverId }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Tunnel } = await import("./tunnel/index.server");
    return Tunnel.connectorToken(data.serverId);
  });

/** Is the account's Zero Trust estate built at all? */
export const zeroTrustState = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async () => {
    const { ZeroTrust } = await import("./tunnel/zerotrust.server");
    return ZeroTrust.inspect();
  });

/** Build the private network end to end: org, login, Gateway, WARP enrollment. */
export const bootstrapZeroTrust = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) =>
    z.object({ teamName: z.string().trim().min(1).max(60).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { ZeroTrust } = await import("./tunnel/zerotrust.server");
    return ZeroTrust.bootstrap(data.teamName ? { teamName: data.teamName } : {});
  });
