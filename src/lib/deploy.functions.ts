import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator, requireManager } from "./operator.middleware";

const serverId = z.string().uuid();
const origin = z.string().url();

export const runtimeState = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => z.object({ serverId }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Deploy } = await import("./deploy/index.server");
    const [deployment, events] = await Promise.all([
      Deploy.status(data.serverId),
      Deploy.events(data.serverId),
    ]);
    return { deployment, events, targets: await Deploy.targets() };
  });

export const launchRuntime = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) =>
    z.object({ serverId, origin, target: z.enum(["inline", "cloudflare", "lambda"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Deploy } = await import("./deploy/index.server");
    return Deploy.launch(data.serverId, data.target, data.origin);
  });

export const teardownRuntime = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) => z.object({ serverId, origin }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Deploy } = await import("./deploy/index.server");
    return Deploy.teardown(data.serverId, data.origin);
  });

export const reconcileRuntime = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) => z.object({ serverId, origin }).parse(input))
  .handler(async ({ data }) => {
    await (await import("./operator.scope.server")).assertServerScope(data.serverId);
    const { Deploy } = await import("./deploy/index.server");
    return Deploy.reconcile(data.serverId, data.origin);
  });

/** Fleet-wide infrastructure inventory: every broker and where it runs. */
export const runtimeFleet = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async () => {
    const { Deploy } = await import("./deploy/index.server");
    return { fleet: await Deploy.fleet(), targets: await Deploy.targets() };
  });

/** Probe and repair every deployment in one sweep. */
export const reconcileFleet = createServerFn({ method: "POST" })
  .middleware([requireManager])
  .inputValidator((input: unknown) => z.object({ origin }).parse(input))
  .handler(async ({ data }) => {
    const { Deploy } = await import("./deploy/index.server");
    return Deploy.reconcileAll(data.origin);
  });
