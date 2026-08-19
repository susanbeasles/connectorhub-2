import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { logEvent } from "./proxy.server";

/**
 * Hardware-key enforcement. A grant can be made to require a physical touch
 * from an authenticator the operator registered, at whatever strictness the
 * broker is configured for.
 */

export type KeyPolicy = "always" | "delete" | "write" | "disabled";
export type AuthenticatorPolicy = "cross_platform" | "platform" | "any";
export const RP_NAME = "Aegis Broker";

const CHALLENGE_TTL_MS = 5 * 60_000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  const source = new TextEncoder().encode(value);
  const bytes = new Uint8Array(new ArrayBuffer(source.length));
  bytes.set(source);
  return bytes;
}

export function rpFromOrigin(origin: string) {
  return { rpID: new URL(origin).hostname, origin };
}

/** Does this set of scopes trip the broker's hardware-key policy? */
export function policyRequiresKey(
  policy: KeyPolicy,
  scopes: Array<{ scope: string; method: string }>,
  granted: string[],
): boolean {
  if (policy === "disabled") return false;
  if (policy === "always") return true;
  const selected = scopes.filter((s) => granted.includes(s.scope));
  const methods = selected.map((s) => s.method.toUpperCase());
  if (policy === "delete") return methods.includes("DELETE");
  return methods.some((m) => m !== "GET" && m !== "HEAD");
}

function authenticatorAllowed(policy: AuthenticatorPolicy, attachment: string, backedUp: boolean) {
  if (policy === "any") return true;
  if (policy === "cross_platform") return attachment === "cross-platform" && !backedUp;
  return !backedUp;
}

export function authenticatorRequirement(policy: AuthenticatorPolicy) {
  return policy === "cross_platform"
    ? "a physical security key"
    : policy === "platform"
      ? "a hardware-backed device key"
      : "any registered authenticator";
}

async function storeChallenge(input: {
  userId: string;
  challenge: string;
  purpose: string;
  requestId?: string | null;
}) {
  const db = await admin();
  await db.from("webauthn_challenges").insert({
    user_id: input.userId,
    challenge: input.challenge,
    purpose: input.purpose,
    request_id: input.requestId ?? null,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
}

async function consumeChallenge(userId: string, purpose: string): Promise<string> {
  const db = await admin();
  const { data } = await db
    .from("webauthn_challenges")
    .select("id, challenge, expires_at")
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("No pending hardware-key challenge — start again");
  if (new Date(data.expires_at).getTime() < Date.now()) throw new Error("Challenge expired");
  await db
    .from("webauthn_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id);
  return data.challenge as string;
}

export async function listKeys(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("webauthn_credentials")
    .select("id, label, attachment, backed_up, transports, last_used_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function registrationOptions(input: {
  userId: string;
  userName: string;
  origin: string;
  policy: AuthenticatorPolicy;
}) {
  const db = await admin();
  const { rpID } = rpFromOrigin(input.origin);
  const { data: existing } = await db
    .from("webauthn_credentials")
    .select("credential_id, transports")
    .eq("user_id", input.userId);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: utf8(input.userId),
    userName: input.userName,
    attestationType: "none",
    excludeCredentials: (existing ?? []).map((c) => ({ id: c.credential_id as string })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
      ...(input.policy === "cross_platform"
        ? { authenticatorAttachment: "cross-platform" as const }
        : input.policy === "platform"
          ? { authenticatorAttachment: "platform" as const }
          : {}),
    },
  });
  await storeChallenge({ userId: input.userId, challenge: options.challenge, purpose: "register" });
  return options;
}

export async function verifyRegistration(input: {
  userId: string;
  origin: string;
  label: string;
  policy: AuthenticatorPolicy;
  response: RegistrationResponseJSON;
}) {
  const { rpID, origin } = rpFromOrigin(input.origin);
  const expectedChallenge = await consumeChallenge(input.userId, "register");
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Hardware key could not be verified");
  }
  const info = verification.registrationInfo;
  const attachment =
    input.response.authenticatorAttachment ??
    (info.credentialDeviceType === "multiDevice" ? "platform" : "cross-platform");
  if (!authenticatorAllowed(input.policy, attachment, info.credentialBackedUp)) {
    throw new Error(
      `This broker requires ${authenticatorRequirement(input.policy)}; that authenticator does not qualify.`,
    );
  }

  const db = await admin();
  const { error } = await db.from("webauthn_credentials").insert({
    user_id: input.userId,
    credential_id: info.credential.id,
    public_key: b64url(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    attachment,
    aaguid: info.aaguid,
    backed_up: info.credentialBackedUp,
    label: input.label || "Security key",
  });
  if (error) throw new Error(error.message);

  await logEvent({
    user_id: input.userId,
    event: "webauthn.key_registered",
    message: `Hardware key "${input.label}" registered (${attachment}${info.credentialBackedUp ? ", synced" : ""})`,
  });
  return { ok: true };
}

export async function assertionOptions(input: {
  userId: string;
  origin: string;
  requestId: string;
  policy: AuthenticatorPolicy;
}) {
  const db = await admin();
  const { rpID } = rpFromOrigin(input.origin);
  const { data: creds } = await db
    .from("webauthn_credentials")
    .select("credential_id, transports, attachment, backed_up")
    .eq("user_id", input.userId);
  const usable = (creds ?? []).filter((c) =>
    authenticatorAllowed(input.policy, c.attachment as string, c.backed_up as boolean),
  );
  if (!usable.length) {
    throw new Error(`No registered authenticator qualifies — this broker requires ${authenticatorRequirement(input.policy)}.`);
  }
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: usable.map((c) => ({ id: c.credential_id as string })),
  });
  await storeChallenge({
    userId: input.userId,
    challenge: options.challenge,
    purpose: "authorize",
    requestId: input.requestId,
  });
  return options;
}

/** Verify a touch and return the credential row id that signed the approval. */
export async function verifyAssertion(input: {
  userId: string;
  origin: string;
  response: AuthenticationResponseJSON;
}): Promise<string> {
  const db = await admin();
  const { rpID, origin } = rpFromOrigin(input.origin);
  const expectedChallenge = await consumeChallenge(input.userId, "authorize");
  const { data: cred } = await db
    .from("webauthn_credentials")
    .select("*")
    .eq("user_id", input.userId)
    .eq("credential_id", input.response.id)
    .maybeSingle();
  if (!cred) throw new Error("Unknown hardware key");

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
  if (!verification.verified) throw new Error("Hardware key assertion failed");

  await db
    .from("webauthn_credentials")
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", cred.id);
  return cred.id as string;
}
