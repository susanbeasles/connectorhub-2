import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOperator } from "./operator.middleware";

/**
 * Console surface for the edge gate. Reads are configuration only, never the
 * assertion itself; writes are owner-only and always leave an audit record.
 */

const ModeInput = z.object({
  mode: z.enum(["public", "zero_trust"]),
  reason: z.string().trim().max(200).optional(),
});

const WindowInput = z.object({
  minutes: z.number().int().min(5).max(240),
  reason: z.string().trim().max(200).optional(),
});

const LabelInput = z.object({ label: z.string().trim().max(60).default("recovery") });
const IdInput = z.object({ id: z.string().uuid() });

type Context = { operator: { role: string; email: string | null }; userId: string };

function actorOf(context: Context) {
  if (context.operator.role !== "owner") {
    throw new Error("Only the owner can change the network gate");
  }
  return { userId: context.userId, email: context.operator.email };
}

export const accessGate = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async () => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { accessStatus, verifyAccess } = await import("./access/index.server");
    const { accessHistory } = await import("./access/policy.server");
    const { codeList } = await import("./access/breakglass.server");
    const verdict = await verifyAccess(getRequest(), "console");
    return {
      ...(await accessStatus()),
      allowed: verdict.allowed,
      reason: verdict.reason,
      identityEmail: verdict.identity?.email ?? null,
      history: await accessHistory(),
      codes: await codeList(),
    };
  });

export const setAccessMode = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => ModeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { policySet } = await import("./access/policy.server");
    return policySet(data.mode, actorOf(context as Context), data.reason);
  });

export const openBreakglass = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => WindowInput.parse(input))
  .handler(async ({ data, context }) => {
    const { breakglassOpen } = await import("./access/policy.server");
    return breakglassOpen(data.minutes, actorOf(context as Context), data.reason);
  });

export const closeBreakglass = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .handler(async ({ context }) => {
    const { breakglassClose } = await import("./access/policy.server");
    return breakglassClose(actorOf(context as Context));
  });

export const issueBreakglassCode = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => LabelInput.parse(input))
  .handler(async ({ data, context }) => {
    const { codeIssue } = await import("./access/breakglass.server");
    return codeIssue(data.label, actorOf(context as Context));
  });

export const revokeBreakglassCode = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { codeRevoke } = await import("./access/breakglass.server");
    await codeRevoke(data.id, actorOf(context as Context));
    return { revoked: true };
  });
