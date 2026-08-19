import { createServerFn } from "@tanstack/react-start";
import { requireOperator } from "../operator.middleware";

/** Read-only posture snapshot for the console. */
export const posture = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async ({ context }) => {
    const { postureReport } = await import("./posture.server");
    return postureReport({ db: context.supabase as never, now: new Date() });
  });
