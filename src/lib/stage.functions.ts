import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./operator.middleware";

/**
 * Console surface for the phased rollout. Reads describe the stage and its
 * prerequisites; writes are owner-only, always previewable first, and always
 * leave a step record behind.
 */

const StageInput = z.object({
  stage: z.enum(["sandbox", "production"]),
  acknowledge: z.array(z.string().max(60)).max(10).default([]),
});

type Context = { operator: { role: string; email: string | null }; userId: string };

export const stageStatus = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async () => {
    const { stageRead, stageHistory } = await import("./stage/stage.server");
    const { readiness } = await import("./stage/readiness.server");
    const { capabilities, CAPABILITY_LABEL } = await import("./stage/capability");
    const state = await stageRead();
    return {
      ...state,
      capabilities: capabilities(state.stage).map((c) => ({ id: c, label: CAPABILITY_LABEL[c] })),
      readiness: await readiness(),
      history: await stageHistory(),
    };
  });

export const previewStage = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => StageInput.parse(input))
  .handler(async ({ data, context }) => {
    const { actorOf, originOf } = await import("./stage/console.server");
    const { stagePlan } = await import("./stage/promote.server");
    return stagePlan(data.stage, {
      origin: await originOf(),
      actor: actorOf(context as Context),
    });
  });

export const applyStage = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => StageInput.parse(input))
  .handler(async ({ data, context }) => {
    const { actorOf, originOf } = await import("./stage/console.server");
    const actor = actorOf(context as Context);
    if (data.stage === "production") {
      const { readiness, unmet } = await import("./stage/readiness.server");
      const blocking = unmet(await readiness()).filter((c) => !data.acknowledge.includes(c.id));
      if (blocking.length)
        throw new Error(
          `Not ready for production: ${blocking
            .map((c) => c.title)
            .join(", ")}. Acknowledge each one to proceed anyway.`,
        );
    }
    const { stageRun } = await import("./stage/promote.server");
    return stageRun(data.stage, { origin: await originOf(), actor }, data.acknowledge);
  });
