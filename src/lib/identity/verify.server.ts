import { sha256Hex } from "../crypto.server";
import { authClient, sessionForEmail, type SessionTokens } from "./authclient.server";

/**
 * Address verification without clickable links.
 *
 * A code is issued against a ticket that is bound to the browser session that
 * asked for it: the requester holds a one-time key, the broker holds only its
 * hash, and redemption requires both. A code read out of someone else's mailbox
 * is worthless in any other session, which is the whole point of never emailing
 * a link that completes the handshake by itself.
 */

const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

export type VerifyTicket = { ticket: string; sessionKey: string; expiresAt: string };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function nonce(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split("@")[1] ?? "";
}

/** Issue a session-bound ticket and have the identity provider deliver the code. */
export async function requestEmailCode(rawEmail: string): Promise<VerifyTicket> {
  const email = normalizeEmail(rawEmail);
  const sessionKey = nonce();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  const db = await admin();
  const { data, error } = await db
    .from("identity_verifications")
    .insert({
      email,
      method: "email_code",
      session_hash: await sha256Hex(sessionKey),
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const sent = await authClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (sent.error) throw new Error(sent.error.message);

  return { ticket: data.id as string, sessionKey, expiresAt };
}

/**
 * Redeem the code in the session that asked for it. Success both proves the
 * address and produces the session — there is no second credential prompt.
 */
export async function redeemEmailCode(input: {
  ticket: string;
  sessionKey: string;
  code: string;
}): Promise<SessionTokens & { email: string }> {
  const db = await admin();
  const { data: row } = await db
    .from("identity_verifications")
    .select("*")
    .eq("id", input.ticket)
    .maybeSingle();
  if (!row || row.consumed_at) throw new Error("This verification is no longer open");
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("The code expired");
  if (row.attempts >= MAX_ATTEMPTS) throw new Error("Too many attempts — start over");
  if (row.session_hash !== (await sha256Hex(input.sessionKey))) {
    throw new Error("This code can only be entered in the session that requested it");
  }

  await db
    .from("identity_verifications")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id);

  const verified = await authClient().auth.verifyOtp({
    email: row.email as string,
    token: input.code.replace(/\D/g, ""),
    type: "email",
  });
  if (verified.error || !verified.data.session) {
    throw new Error(verified.error?.message ?? "That code is not valid");
  }

  await db
    .from("identity_verifications")
    .update({
      consumed_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      user_id: verified.data.session.user.id,
    })
    .eq("id", row.id);

  return {
    email: row.email as string,
    accessToken: verified.data.session.access_token,
    refreshToken: verified.data.session.refresh_token,
  };
}

/**
 * GitHub as an address oracle, nothing more. The grant is read-only on the
 * account's email list, the token is used once and dropped, and the only fact
 * kept is "this person holds a verified address".
 */
export function githubConfigured(): boolean {
  return !!process.env["GITHUB_CLIENT_ID"] && !!process.env["GITHUB_CLIENT_SECRET"];
}

export async function githubAuthorizeUrl(redirectUri: string): Promise<{ url: string; state: string }> {
  if (!githubConfigured()) throw new Error("GitHub verification is not configured on this broker");
  const state = nonce(16);
  const db = await admin();
  await db.from("identity_verifications").insert({
    email: "",
    method: "github",
    session_hash: await sha256Hex(state),
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
  });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env["GITHUB_CLIENT_ID"]!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  return { url: url.toString(), state };
}

export async function githubVerify(input: {
  code: string;
  state: string;
  redirectUri: string;
}): Promise<SessionTokens & { email: string }> {
  if (!githubConfigured()) throw new Error("GitHub verification is not configured on this broker");
  const db = await admin();
  const stateHash = await sha256Hex(input.state);
  const { data: row } = await db
    .from("identity_verifications")
    .select("*")
    .eq("method", "github")
    .eq("session_hash", stateHash)
    .is("consumed_at", null)
    .maybeSingle();
  if (!row) throw new Error("This GitHub verification is no longer open");
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error("The verification expired");

  const token = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: process.env["GITHUB_CLIENT_ID"],
      client_secret: process.env["GITHUB_CLIENT_SECRET"],
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  }).then((r) => r.json() as Promise<{ access_token?: string; error_description?: string }>);
  if (!token.access_token) throw new Error(token.error_description ?? "GitHub rejected the grant");

  const emails = (await fetch("https://api.github.com/user/emails", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json" },
  }).then((r) => r.json())) as Array<{ email: string; verified: boolean; primary: boolean }>;
  const chosen = emails.find((e) => e.verified && e.primary) ?? emails.find((e) => e.verified);
  if (!chosen) throw new Error("That GitHub account has no verified email");

  const email = normalizeEmail(chosen.email);
  await db
    .from("identity_verifications")
    .update({ consumed_at: new Date().toISOString(), verified_at: new Date().toISOString(), email })
    .eq("id", row.id);

  return { email, ...(await sessionForEmail(email)) };
}
