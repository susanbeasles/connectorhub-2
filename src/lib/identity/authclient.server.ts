import { createClient } from "@supabase/supabase-js";

/**
 * A sessionless publishable-key client. Auth flows that must be adjudicated by
 * the broker (code redemption, ticket exchange) run through here so the browser
 * never drives the handshake on its own terms.
 */
export function authClient() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export type SessionTokens = { accessToken: string; refreshToken: string };

/** Turn a server-minted one-time link token into a session for the browser. */
export async function sessionFromTokenHash(tokenHash: string): Promise<SessionTokens> {
  const { data, error } = await authClient().auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (error || !data.session) throw new Error(error?.message ?? "Could not establish a session");
  return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
}

/** Mint a session for an existing identity the broker has already vouched for. */
export async function sessionForEmail(email: string): Promise<SessionTokens> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const hash = data?.properties?.hashed_token;
  if (error || !hash) throw new Error(error?.message ?? "Could not mint a session");
  return sessionFromTokenHash(hash);
}
