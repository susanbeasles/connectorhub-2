import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const origin = z.string().url();

export const startPasskeySignIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ origin }).parse(input))
  .handler(async ({ data }) => {
    const { signInOptions } = await import("./passkey.server");
    return signInOptions(data.origin);
  });

export const finishPasskeySignIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ origin, ticket: z.string().uuid(), response: z.unknown() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { signInVerify } = await import("./passkey.server");
    return signInVerify({
      ticket: data.ticket,
      origin: data.origin,
      response: data.response as never,
    });
  });
