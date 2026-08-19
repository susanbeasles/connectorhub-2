import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * The whole enrollment/sign-in surface. Every path here ends in a session, so
 * proving who you are and getting in are never two separate errands.
 */

const email = z.string().email().max(200);
const origin = z.string().url();

export const requestEmailCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ email }).parse(input))
  .handler(async ({ data }) => {
    const { requestEmailCode: request } = await import("./verify.server");
    return request(data.email);
  });

export const redeemEmailCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        ticket: z.string().uuid(),
        sessionKey: z.string().min(16).max(200),
        code: z.string().min(4).max(12),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { redeemEmailCode: redeem } = await import("./verify.server");
    return redeem(data);
  });

export const githubVerifyStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { githubConfigured } = await import("./verify.server");
  return { configured: githubConfigured() };
});

export const startGithubVerify = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ redirectUri: origin }).parse(input))
  .handler(async ({ data }) => {
    const { githubAuthorizeUrl } = await import("./verify.server");
    return githubAuthorizeUrl(data.redirectUri);
  });

export const finishGithubVerify = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ code: z.string().max(400), state: z.string().max(200), redirectUri: origin })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { githubVerify } = await import("./verify.server");
    return githubVerify(data);
  });
