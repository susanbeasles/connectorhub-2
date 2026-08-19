import type { StageActor } from "./stage.server";

/** Console-side plumbing for the rollout surface, kept out of the server-fn module. */

type OperatorContext = { operator: { role: string; email: string | null }; userId: string };

export function actorOf(context: OperatorContext): StageActor {
  if (context.operator.role !== "owner") throw new Error("Only the owner can change the rollout stage");
  return { userId: context.userId, email: context.operator.email };
}

export async function originOf(): Promise<string> {
  const { getRequest } = await import("@tanstack/react-start/server");
  return new URL(getRequest().url).origin;
}
