import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { fromB64url, rpFromOrigin } from "./webauthn.server";
import { logEvent } from "./proxy.server";
import { recordFactor } from "./mfa/factors.server";
import { sessionForEmail, type SessionTokens } from "./identity/authclient.server";

/**
 * Passwordless sign-in and enrollment with a registered hardware key or
 * passkey. The assertion proves possession of a credential this broker already
 * trusts; the authenticator's own user-verification step is the second
 * challenge, and it is required, not preferred.
 */

const CHALLENGE_TTL_MS = 2 * 60_000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function signInOptions(origin: string) {
  const { rpID } = rpFromOrigin(origin);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
  });
  const db = await admin();
  const { data, error } = await db
    .from("webauthn_challenges")
    .insert({
      user_id: null,
      challenge: options.challenge,
      purpose: "signin",
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { ticket: data.id as string, options };
}

async function consumeTicket(ticket: string): Promise<string> {
  const db = await admin();
  const { data } = await db
    .from("webauthn_challenges")
    .select("id, challenge, expires_at, consumed_at")
    .eq("id", ticket)
    .eq("purpose", "signin")
    .maybeSingle();
  if (!data || data.consumed_at) throw new Error("Sign-in challenge is no longer valid");
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Error("Sign-in challenge expired");
  await db
    .from("webauthn_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id);
  return data.challenge as string;
}

/**
 * Verified assertion -> a session. Two challenges have to land: the credential
 * this broker registered, and the authenticator's user verification. A passkey
 * that answers only the first is possession alone and does not stand in for MFA.
 */
export async function signInVerify(input: {
  ticket: string;
  origin: string;
  response: AuthenticationResponseJSON;
}): Promise<SessionTokens & { email: string; userVerified: boolean }> {
  const db = await admin();
  const { rpID, origin } = rpFromOrigin(input.origin);
  const expectedChallenge = await consumeTicket(input.ticket);

  const { data: cred } = await db
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", input.response.id)
    .maybeSingle();
  if (!cred) throw new Error("This passkey is not registered with the broker");

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: cred.credential_id as string,
      publicKey: fromB64url(cred.public_key as string),
      counter: Number(cred.counter),
      transports: (cred.transports ?? []) as never,
    },
  });
  if (!verification.verified) throw new Error("Passkey assertion failed");
  const userVerified = verification.authenticationInfo.userVerified === true;
  if (!userVerified) {
    throw new Error("That authenticator did not perform user verification — a second factor is required");
  }

  await db
    .from("webauthn_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", cred.id);

  const userId = cred.user_id as string;
  const { data: account } = await db.auth.admin.getUserById(userId);
  const email = account?.user?.email;
  if (!email) throw new Error("This passkey has no addressable identity");

  await recordFactor({
    userId,
    kind: "passkey",
    reference: cred.credential_id as string,
    label: (cred.label as string) ?? "Passkey",
  });

  await logEvent({
    user_id: userId,
    event: "webauthn.signin",
    message: `Passkey sign-in with "${cred.label ?? "security key"}" (user verified)`,
  });

  return { email, userVerified, ...(await sessionForEmail(email)) };
}
