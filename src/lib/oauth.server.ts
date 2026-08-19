import { sha256Hex } from "./crypto.server";
import { logEvent } from "./proxy.server";

export type ScopeDescriptor = {
  scope: string;
  tool: string;
  description: string;
  method: string;
  path: string;
  destructive: boolean;
};

export const SCOPE_TOOL_PREFIX = "tool:";
export const SCOPE_DISCOVERY = "mcp:discover";

const CODE_TTL_MS = 10 * 60_000;
const ACCESS_TTL_MS = 10 * 60_000;

function randomToken(prefix: string, bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return `${prefix}_${btoa(s).replace(/[+/=]/g, "").slice(0, 43)}`;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export function toolScope(name: string): string {
  return `${SCOPE_TOOL_PREFIX}${name}`;
}

export function scopeTool(scope: string): string | null {
  return scope.startsWith(SCOPE_TOOL_PREFIX) ? scope.slice(SCOPE_TOOL_PREFIX.length) : null;
}

/** Every scope a broker can offer, derived from its enabled tools. */
export async function serverScopes(serverId: string): Promise<ScopeDescriptor[]> {
  const db = await admin();
  const { data } = await db
    .from("tools")
    .select("name, description, method, path, enabled")
    .eq("server_id", serverId)
    .eq("enabled", true)
    .order("name");
  return (data ?? []).map((t) => ({
    scope: toolScope(t.name as string),
    tool: t.name as string,
    description: (t.description as string) || "",
    method: String(t.method).toUpperCase(),
    path: t.path as string,
    destructive: !["GET", "HEAD"].includes(String(t.method).toUpperCase()),
  }));
}

export async function findClient(clientId: string) {
  const db = await admin();
  const { data } = await db
    .from("oauth_clients")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  return data;
}

export async function registerClient(input: {
  serverId: string;
  name: string;
  redirectUris: string[];
  confidential: boolean;
}) {
  const db = await admin();
  const clientId = randomToken("ztc", 18);
  const secret = input.confidential ? randomToken("zts", 32) : null;
  const { data: server } = await db
    .from("servers")
    .select("id, user_id")
    .eq("id", input.serverId)
    .maybeSingle();
  if (!server) throw new Error("Unknown broker");

  const { error } = await db.from("oauth_clients").insert({
    user_id: server.user_id,
    server_id: server.id,
    client_id: clientId,
    client_secret_hash: secret ? await sha256Hex(secret) : null,
    name: input.name,
    redirect_uris: input.redirectUris,
    registration_kind: "dynamic",
  });
  if (error) throw new Error(error.message);

  await logEvent({
    user_id: server.user_id,
    server_id: server.id,
    event: "oauth.client_registered",
    message: `Client "${input.name}" registered (${input.confidential ? "confidential" : "public"})`,
    meta: { client_id: clientId, redirect_uris: input.redirectUris },
  });
  return { clientId, clientSecret: secret };
}

/** Create a pending authorization request. Returns its id for the consent screen. */
export async function createAuthorizationRequest(input: {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | null;
  resource: string | null;
}) {
  const client = await findClient(input.clientId);
  if (!client || client.disabled) throw new Error("Unknown or disabled client");
  if (input.codeChallengeMethod !== "S256") throw new Error("Only PKCE S256 is supported");
  if (!client.redirect_uris.includes(input.redirectUri)) throw new Error("redirect_uri mismatch");

  const available = await serverScopes(client.server_id);
  const requested = (input.scope ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((s) => s === SCOPE_DISCOVERY || available.some((a) => a.scope === s));

  const db = await admin();
  const { data, error } = await db
    .from("oauth_requests")
    .insert({
      server_id: client.server_id,
      client_id: client.client_id,
      redirect_uri: input.redirectUri,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      resource: input.resource,
      requested_scopes: requested,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function authorizationDetails(requestId: string) {
  const db = await admin();
  const { data: req } = await db
    .from("oauth_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!req) throw new Error("Authorization request not found");
  if (new Date(req.expires_at).getTime() < Date.now()) throw new Error("Authorization request expired");
  const client = await findClient(req.client_id);
  const { data: server } = await db
    .from("servers")
    .select("id, name, slug, base_url, user_id, dpop_mode, webauthn_policy, webauthn_authenticator, webauthn_sso_fallback")
    .eq("id", req.server_id)
    .maybeSingle();
  return {
    id: req.id as string,
    status: req.status as string,
    clientName: client?.name ?? req.client_id,
    clientId: req.client_id as string,
    redirectUri: req.redirect_uri as string,
    requestedScopes: (req.requested_scopes ?? []) as string[],
    server: server as {
      id: string;
      name: string;
      slug: string;
      base_url: string;
      user_id: string;
      dpop_mode: string;
      webauthn_policy: string;
      webauthn_authenticator: string;
      webauthn_sso_fallback: boolean;
    },
    scopes: await serverScopes(req.server_id),
  };
}

function redirectWith(base: string, params: Record<string, string | null>) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

export async function approveAuthorization(input: {
  requestId: string;
  userId: string;
  scopes: string[];
  ttlMinutes: number;
  maxCalls: number | null;
  origin: string;
  assertion?: unknown;
}) {
  const db = await admin();
  const details = await authorizationDetails(input.requestId);
  if (details.server.user_id !== input.userId) throw new Error("Not your broker");
  if (details.status !== "pending") throw new Error("Authorization already decided");

  const allowed = new Set([SCOPE_DISCOVERY, ...details.scopes.map((s) => s.scope)]);
  const granted = input.scopes.filter((s) => allowed.has(s));

  // A grant that hands out write power can be made to cost a physical touch.
  const webauthn = await import("./webauthn.server");
  let credentialId: string | null = null;
  if (
    webauthn.policyRequiresKey(
      details.server.webauthn_policy as never,
      details.scopes,
      granted,
    )
  ) {
    if (input.assertion) {
      credentialId = await webauthn.verifyAssertion({
        userId: input.userId,
        origin: input.origin,
        response: input.assertion as never,
      });
    } else {
      const keys = await webauthn.listKeys(input.userId);
      if (keys.length || !details.server.webauthn_sso_fallback) {
        throw new Error("This grant requires a hardware key touch");
      }
      await logEvent({
        user_id: input.userId,
        server_id: details.server.id,
        level: "warn",
        event: "webauthn.fallback_used",
        message: "Grant approved on SSO alone — no hardware key registered",
      });
    }
  }
  const code = randomToken("ztx", 32);

  const { error } = await db
    .from("oauth_requests")
    .update({
      status: "approved",
      user_id: input.userId,
      granted_scopes: granted,
      grant_ttl_minutes: input.ttlMinutes,
      max_calls: input.maxCalls,
      code_hash: await sha256Hex(code),
      webauthn_credential_id: credentialId,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    })
    .eq("id", input.requestId);
  if (error) throw new Error(error.message);

  await logEvent({
    user_id: input.userId,
    server_id: details.server.id,
    event: "oauth.authorization_approved",
    message: `${details.clientName} granted ${granted.length} scope(s) for ${input.ttlMinutes} min`,
    meta: {
      scopes: granted,
      max_calls: input.maxCalls,
      client_id: details.clientId,
      hardware_key: credentialId ? "verified" : "not_required",
    },
  });

  const { data: req } = await db
    .from("oauth_requests")
    .select("state")
    .eq("id", input.requestId)
    .single();
  return {
    redirectUrl: redirectWith(details.redirectUri, { code, state: req?.state ?? null }),
  };
}

export async function denyAuthorization(requestId: string, userId: string) {
  const db = await admin();
  const details = await authorizationDetails(requestId);
  if (details.server.user_id !== userId) throw new Error("Not your broker");
  await db.from("oauth_requests").update({ status: "denied", user_id: userId }).eq("id", requestId);
  const { data: req } = await db
    .from("oauth_requests")
    .select("state")
    .eq("id", requestId)
    .single();
  await logEvent({
    user_id: userId,
    server_id: details.server.id,
    level: "warn",
    event: "oauth.authorization_denied",
    message: `${details.clientName} was denied access`,
  });
  return {
    redirectUrl: redirectWith(details.redirectUri, {
      error: "access_denied",
      state: req?.state ?? null,
    }),
  };
}

async function verifyPkce(challenge: string, verifier: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const b64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64url === challenge;
}

type TokenBundle = {
  access_token: string;
  refresh_token: string | null;
  token_type: "Bearer" | "DPoP";
  expires_in: number;
  scope: string;
};

/** Broker default plus per-client override, resolved once per token request. */
export async function grantDpopMode(serverId: string, clientId: string) {
  const db = await admin();
  const [{ data: server }, { data: client }] = await Promise.all([
    db.from("servers").select("dpop_mode").eq("id", serverId).maybeSingle(),
    db.from("oauth_clients").select("dpop_mode").eq("client_id", clientId).maybeSingle(),
  ]);
  const { effectiveMode } = await import("./dpop.server");
  return effectiveMode(String(server?.dpop_mode ?? "preferred"), (client?.dpop_mode as string) ?? null);
}

async function issueBundle(
  grantRow: {
    id: string;
    scopes: string[];
    grant_expires_at: string;
    refresh_token_hash?: string | null;
    refresh_generation?: number | null;
  },
  jkt: string | null,
): Promise<TokenBundle> {
  const db = await admin();
  const access = randomToken("zta", 32);
  const refresh = randomToken("ztr", 32);
  const accessExpiry = Math.min(
    Date.now() + ACCESS_TTL_MS,
    new Date(grantRow.grant_expires_at).getTime(),
  );
  await db
    .from("oauth_grants")
    .update({
      access_token_hash: await sha256Hex(access),
      refresh_token_hash: await sha256Hex(refresh),
      retired_refresh_hash: grantRow.refresh_token_hash ?? null,
      refresh_generation: (grantRow.refresh_generation ?? 0) + 1,
      access_expires_at: new Date(accessExpiry).toISOString(),
      ...(jkt ? { cnf_jkt: jkt } : {}),
    })
    .eq("id", grantRow.id);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: jkt ? "DPoP" : "Bearer",
    expires_in: Math.max(1, Math.floor((accessExpiry - Date.now()) / 1000)),
    scope: grantRow.scopes.join(" "),
  };
}

export async function exchangeCode(input: {
  code: string;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
  codeVerifier: string;
  jkt: string | null;
}): Promise<TokenBundle> {
  const db = await admin();
  const hash = await sha256Hex(input.code);
  const { data: req } = await db.from("oauth_requests").select("*").eq("code_hash", hash).maybeSingle();
  if (!req || req.status !== "approved") throw new Error("invalid_grant");
  if (req.consumed_at) throw new Error("invalid_grant");
  if (new Date(req.expires_at).getTime() < Date.now()) throw new Error("invalid_grant");
  if (req.client_id !== input.clientId) throw new Error("invalid_client");
  if (req.redirect_uri !== input.redirectUri) throw new Error("invalid_grant");
  if (!(await verifyPkce(req.code_challenge, input.codeVerifier))) throw new Error("invalid_grant");

  const client = await findClient(input.clientId);
  if (!client || client.disabled) throw new Error("invalid_client");
  if (client.client_secret_hash) {
    if (!input.clientSecret || (await sha256Hex(input.clientSecret)) !== client.client_secret_hash) {
      throw new Error("invalid_client");
    }
  }

  const operatorId = req.user_id as string | null;
  if (!operatorId) throw new Error("invalid_grant");

  const mode = await grantDpopMode(req.server_id as string, input.clientId);
  if (mode === "required" && !input.jkt) throw new Error("dpop_required");
  const jkt = mode === "disabled" ? null : input.jkt;
  if (jkt) {
    await db.from("oauth_clients").update({ dpop_observed: true }).eq("client_id", input.clientId);
  }

  await db.from("oauth_requests").update({ consumed_at: new Date().toISOString() }).eq("id", req.id);

  const grantExpiry = new Date(Date.now() + req.grant_ttl_minutes * 60_000).toISOString();
  const { data: grant, error } = await db
    .from("oauth_grants")
    .insert({
      user_id: operatorId,
      server_id: req.server_id,
      client_id: req.client_id,
      client_name: client.name,
      scopes: req.granted_scopes,
      webauthn_credential_id: req.webauthn_credential_id,
      access_token_hash: "pending",
      access_expires_at: new Date().toISOString(),
      grant_expires_at: grantExpiry,
      max_calls: req.max_calls,
      cnf_jkt: jkt,
    })
    .select("id, scopes, grant_expires_at, refresh_token_hash, refresh_generation")
    .single();
  if (error) throw new Error(error.message);

  await db
    .from("oauth_clients")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("client_id", input.clientId);

  await logEvent({
    user_id: operatorId,
    server_id: req.server_id,
    event: "oauth.grant_issued",
    message: `Access granted to ${client.name} until ${grantExpiry}`,
    meta: { scopes: req.granted_scopes, max_calls: req.max_calls, sender_constrained: Boolean(jkt) },
  });

  return issueBundle(grant as never, jkt);
}

export async function refreshGrant(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string | null;
  jkt: string | null;
}): Promise<TokenBundle> {
  const db = await admin();
  const hash = await sha256Hex(input.refreshToken);
  const { data: grant } = await db
    .from("oauth_grants")
    .select("*")
    .eq("refresh_token_hash", hash)
    .maybeSingle();

  if (!grant) {
    // A retired refresh token coming back means it was captured: burn the chain.
    const { data: stolen } = await db
      .from("oauth_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("retired_refresh_hash", hash)
      .is("revoked_at", null)
      .select("id, user_id, server_id, client_name")
      .maybeSingle();
    if (stolen) {
      await logEvent({
        user_id: stolen.user_id,
        server_id: stolen.server_id,
        level: "error",
        event: "oauth.refresh_reuse_detected",
        message: `Retired refresh token replayed for ${stolen.client_name} — entire grant revoked`,
      });
    }
    throw new Error("invalid_grant");
  }
  if (grant.revoked_at) throw new Error("invalid_grant");
  if (grant.client_id !== input.clientId) throw new Error("invalid_client");
  if (new Date(grant.grant_expires_at).getTime() < Date.now()) throw new Error("invalid_grant");
  const client = await findClient(input.clientId);
  if (!client || client.disabled) throw new Error("invalid_client");
  if (client.client_secret_hash) {
    if (!input.clientSecret || (await sha256Hex(input.clientSecret)) !== client.client_secret_hash) {
      throw new Error("invalid_client");
    }
  }
  const mode = await grantDpopMode(grant.server_id as string, input.clientId);
  if ((mode === "required" || grant.cnf_jkt) && !input.jkt) throw new Error("dpop_required");
  if (grant.cnf_jkt && input.jkt && grant.cnf_jkt !== input.jkt) throw new Error("invalid_grant");

  return issueBundle(grant as never, grant.cnf_jkt ?? input.jkt);
}

export type AuthorizedSession = {
  kind: "oauth" | "legacy";
  userId: string;
  serverId: string;
  scopes: string[] | null;
  grantId: string | null;
  clientName: string;
  expiresAt: string;
  boundJkt: string | null;
  /** Calls per minute this session may make; null falls back to the broker default. */
  rateLimitPerMin: number | null;
};

/** Resolve a bearer token to a session. OAuth grants carry scopes; legacy tokens are unscoped. */
export async function authorizeBearer(
  serverId: string,
  token: string | null,
  proofJkt?: string | null,
): Promise<AuthorizedSession | null> {
  if (!token) return null;
  const db = await admin();
  const hash = await sha256Hex(token);

  if (token.startsWith("zta_")) {
    const { data } = await db
      .from("oauth_grants")
      .select("*")
      .eq("access_token_hash", hash)
      .eq("server_id", serverId)
      .maybeSingle();
    if (!data || data.revoked_at) return null;
    if (new Date(data.access_expires_at).getTime() < Date.now()) return null;
    if (new Date(data.grant_expires_at).getTime() < Date.now()) return null;
    if (data.max_calls !== null && data.call_count >= data.max_calls) return null;
    // A sender-constrained token is worthless without its key.
    if (data.cnf_jkt && data.cnf_jkt !== proofJkt) return null;
    await db
      .from("oauth_grants")
      .update({ last_used_at: new Date().toISOString(), call_count: data.call_count + 1 })
      .eq("id", data.id);
    return {
      kind: "oauth",
      userId: data.user_id,
      serverId: data.server_id,
      scopes: data.scopes ?? [],
      grantId: data.id,
      clientName: data.client_name,
      expiresAt: data.grant_expires_at,
      boundJkt: data.cnf_jkt ?? null,
      rateLimitPerMin: data.rate_limit_per_min ?? null,
    };
  }

  const { authenticateToken } = await import("./proxy.server");
  const legacy = await authenticateToken(serverId, token);
  if (!legacy) return null;
  return {
    kind: "legacy",
    userId: legacy.user_id,
    serverId: legacy.server_id,
    scopes: null,
    grantId: null,
    clientName: "Legacy bearer client",
    expiresAt: legacy.expires_at,
    boundJkt: null,
    rateLimitPerMin: null,
  };
}

export function sessionAllows(session: AuthorizedSession, toolName: string): boolean {
  if (session.scopes === null) return true;
  return session.scopes.includes(toolScope(toolName));
}

export async function revokeGrantById(userId: string, grantId: string) {
  const db = await admin();
  const { data } = await db
    .from("oauth_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", grantId)
    .eq("user_id", userId)
    .select("server_id, client_name")
    .maybeSingle();
  if (data) {
    await logEvent({
      user_id: userId,
      server_id: data.server_id,
      level: "warn",
      event: "oauth.grant_revoked",
      message: `Grant for ${data.client_name} revoked`,
    });
  }
  return { ok: true };
}

export async function revokeByToken(token: string) {
  const db = await admin();
  const hash = await sha256Hex(token);
  await db
    .from("oauth_grants")
    .update({ revoked_at: new Date().toISOString() })
    .or(`access_token_hash.eq.${hash},refresh_token_hash.eq.${hash}`);
  return { ok: true };
}
