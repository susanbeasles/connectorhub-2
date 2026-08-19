import { Secret } from "./secret/index.server";
import { logEvent } from "./proxy.server";
import { Custody } from "./secret/ledger.server";
import { authorityFor, postToken, type GrantRow, type UpstreamConfigRow } from "./upstream/exchange.server";
import type { Authority, OutboundRequest } from "./secret/authority";


/**
 * Provider-side (upstream) authority. The broker holds a durable grant; it
 * does not hold provider access. Access is produced for one outbound request
 * and ceases to exist when that request is sent.
 *
 * No access token is stored, cached, or returned across this boundary. An MCP
 * client only ever presents its own broker-issued, sender-constrained token.
 */

export type UpstreamConfig = {
  serverId: string;
  provider: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string | undefined;
  scopes: string[];
  audience?: string | undefined;
  headerName: string;
  valueTemplate: string;
};

export type UpstreamStatus = {
  configured: boolean;
  provider: string | null;
  clientId: string | null;
  authorizeUrl: string | null;
  tokenUrl: string | null;
  scopes: string[];
  connected: boolean;
  grantKind: string | null;
  scope: string;
  expiresAt: string | null;
  rotatedAt: string | null;
  rotations: number;
  /** True when the grant carries its own durable authority. */
  refreshable: boolean;
};

const HANDSHAKE_TTL_MS = 10 * 60_000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function random(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function callbackUrl(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("Callback origin must be https");
  }
  return `${url.origin}/api/public/oauth/upstream-callback`;
}

async function configOf(serverId: string): Promise<UpstreamConfigRow | null> {
  const db = await admin();
  const { data } = await db.from("upstream_oauth").select("*").eq("server_id", serverId).maybeSingle();
  return (data as UpstreamConfigRow | null) ?? null;
}

async function grantOf(serverId: string, subject: string): Promise<GrantRow | null> {
  const db = await admin();
  const { data } = await db
    .from("upstream_grants")
    .select("*")
    .eq("server_id", serverId)
    .eq("subject", subject)
    .maybeSingle();
  return (data as GrantRow | null) ?? null;
}

export async function saveUpstream(userId: string, input: UpstreamConfig) {
  const db = await admin();
  // The provider client secret is app-level and low cardinality: it is filed
  // in the host's secret store and the row keeps only the reference.
  const secret = input.clientSecret
    ? await Secret.put(`upstream/${input.serverId}/client-secret`, input.clientSecret)
    : undefined;
  const existing = await db
    .from("upstream_oauth")
    .select("id")
    .eq("server_id", input.serverId)
    .maybeSingle();

  const payload = {
    server_id: input.serverId,
    user_id: userId,
    provider: input.provider,
    authorize_url: input.authorizeUrl,
    token_url: input.tokenUrl,
    client_id: input.clientId,
    scopes: input.scopes,
    audience: input.audience ?? null,
    header_name: input.headerName,
    value_template: input.valueTemplate,
    updated_at: new Date().toISOString(),
    ...(secret ? { encrypted_client_secret: secret } : {}),
  };

  const { error } = existing.data
    ? await db.from("upstream_oauth").update(payload).eq("id", existing.data.id)
    : await db.from("upstream_oauth").insert(payload);
  if (error) throw new Error(error.message);

  await logEvent({
    user_id: userId,
    server_id: input.serverId,
    event: "upstream.configured",
    message: `Provider OAuth app saved for ${input.provider}`,
    meta: { scopes: input.scopes },
  });
  return { ok: true };
}

/** Starts the provider handshake; returns the URL the operator must visit. */
export async function beginUpstream(
  userId: string,
  serverId: string,
  origin: string,
  /** Whose grant this handshake will produce. Empty means the app's own identity. */
  subject = "",
) {
  const db = await admin();
  const cfg = await configOf(serverId);
  if (!cfg) throw new Error("Configure the provider OAuth app first");

  const state = random();
  const verifier = random(48);
  const redirectUri = callbackUrl(origin);
  await db.from("upstream_sessions").insert({
    server_id: serverId,
    subject,
    state,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    expires_at: new Date(Date.now() + HANDSHAKE_TTL_MS).toISOString(),
  });

  const url = new URL((cfg as unknown as { authorize_url: string }).authorize_url);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (cfg.scopes?.length) url.searchParams.set("scope", cfg.scopes.join(" "));
  if (cfg.audience) url.searchParams.set("audience", cfg.audience);

  await logEvent({
    user_id: userId,
    server_id: serverId,
    event: "upstream.authorize_started",
    message: `Provider consent requested from ${url.host}`,
  });
  return { authorizeUrl: url.toString(), expiresInSec: HANDSHAKE_TTL_MS / 1000 };
}

/**
 * Persist only what must outlive the request: the refresh authority, sealed.
 * The access token that came back with it is deliberately dropped on the
 * floor — a stored access token is a reusable credential with no owner
 * present, which is exactly what this design refuses to keep.
 */
async function storeGrant(
  serverId: string,
  subject: string,
  refreshToken: string | null,
  scope: string,
  rotations: number,
) {
  const db = await admin();
  const payload = {
    server_id: serverId,
    subject,
    sealed_grant: refreshToken ? await Secret.seal(refreshToken) : null,
    grant_kind: "refresh",
    scope,
    expires_at: null,
    rotated_at: new Date().toISOString(),
    rotations,
  };
  const existing = await db
    .from("upstream_grants")
    .select("id")
    .eq("server_id", serverId)
    .eq("subject", subject)
    .maybeSingle();
  const { error } = existing.data
    ? await db.from("upstream_grants").update(payload).eq("id", existing.data.id)
    : await db.from("upstream_grants").insert(payload);
  if (error) throw new Error(error.message);
}

/** Redeems the provider's authorization code. Handshake state is single-use. */
export async function completeUpstream(state: string, code: string) {
  const db = await admin();
  const { data: session } = await db
    .from("upstream_sessions")
    .select("*")
    .eq("state", state)
    .maybeSingle();
  if (!session) throw new Error("Unknown or already-used authorization state");
  await db.from("upstream_sessions").delete().eq("id", session.id);
  if (new Date(session.expires_at).getTime() < Date.now()) throw new Error("Handshake expired");

  const cfg = await configOf(session.server_id);
  if (!cfg) throw new Error("Provider OAuth app is no longer configured");

  const token = await postToken(
    cfg,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: session.redirect_uri,
      code_verifier: session.code_verifier,
    }),
  );
  await storeGrant(session.server_id, session.subject ?? "", token.refresh_token ?? null, token.scope ?? "", 0);
  token.access_token = "";
  await logEvent({
    user_id: cfg.user_id,
    server_id: session.server_id,
    event: "upstream.connected",
    message: `Provider grant stored for ${cfg.provider}`,
    meta: { scope: token.scope ?? "", refreshable: !!token.refresh_token },
  });
  await Custody.record({
    userId: cfg.user_id,
    serverId: session.server_id,
    operation: "grant.issued",
    kind: "refresh",
    outcome: "ok",
    subject: session.subject ?? "",
    provider: cfg.provider,
    detail: { scope: token.scope ?? "", refreshable: !!token.refresh_token },
  });

  return { serverId: session.server_id as string };
}

/**
 * Permission to make one outbound call as `subject`. Null when this server
 * has no provider configured at all; an error when it has one and the caller
 * has no grant of their own — never somebody else's access.
 */
export async function upstreamAuthority(serverId: string, subject = ""): Promise<Authority | null> {
  const cfg = await configOf(serverId);
  if (!cfg) return null;
  const grant = await grantOf(serverId, subject);
  if (!grant) {
    await Custody.record({
      userId: cfg.user_id,
      serverId,
      operation: "token.minted",
      kind: "unknown",
      outcome: "denied",
      subject,
      provider: cfg.provider,
      detail: { reason: "no grant for this subject" },
    });
    throw new Error("Provider is configured but not connected — authorize it in the console");
  }

  const authority = await authorityFor(cfg, grant, async (issued, previousRefresh) => {
    const rotations = (grant.rotations ?? 0) + 1;
    await storeGrant(
      serverId,
      subject,
      issued.refresh_token ?? previousRefresh,
      issued.scope ?? "",
      rotations,
    );
    await logEvent({
      user_id: cfg.user_id,
      server_id: serverId,
      event: "upstream.exchanged",
      message: "Provider access minted just in time and discarded after use",
      meta: { rotations, kind: grant.grant_kind },
    });
    await Custody.record({
      userId: cfg.user_id,
      serverId,
      operation: "grant.rotated",
      kind: grant.grant_kind,
      outcome: "ok",
      subject,
      provider: cfg.provider,
      detail: { rotations, rotatedAuthority: !!issued.refresh_token },
    });
  });

  // The ledger observes the moment access exists and the moment it is spent;
  // it never sees, and cannot see, the material that passed between them.
  return {
    kind: authority.kind,
    authorize: (request) =>
      Custody.with(
        {
          userId: cfg.user_id,
          serverId,
          operation: "token.spent",
          kind: authority.kind,
          subject,
          provider: cfg.provider,
          detail: { method: request.method, host: new URL(request.url).host },
        },
        () => authority.authorize(request),
      ),
    dispose: () => authority.dispose(),
  };
}


/** Headers authorizing exactly this request, or none when no provider is set. */
export async function upstreamHeaders(
  serverId: string,
  request: OutboundRequest,
  subject = "",
): Promise<Record<string, string> | null> {
  const authority = await upstreamAuthority(serverId, subject);
  if (!authority) return null;
  try {
    return await authority.authorize(request);
  } finally {
    authority.dispose();
  }
}

export async function upstreamStatus(serverId: string, subject = ""): Promise<UpstreamStatus> {
  const [cfg, row] = await Promise.all([configOf(serverId), grantOf(serverId, subject)]);
  const record = row as (GrantRow & { scope?: string; expires_at?: string | null; rotated_at?: string | null }) | null;
  return {
    configured: !!cfg,
    provider: cfg?.provider ?? null,
    clientId: cfg?.client_id ?? null,
    authorizeUrl: (cfg as unknown as { authorize_url?: string } | null)?.authorize_url ?? null,
    tokenUrl: cfg?.token_url ?? null,
    scopes: cfg?.scopes ?? [],
    connected: !!record,
    grantKind: record?.grant_kind ?? null,
    scope: record?.scope ?? "",
    expiresAt: record?.expires_at ?? null,
    rotatedAt: record?.rotated_at ?? null,
    rotations: record?.rotations ?? 0,
    refreshable: !!record && (record.grant_kind !== "refresh" || !!record.sealed_grant),
  };
}

export async function disconnectUpstream(userId: string, serverId: string) {
  const db = await admin();
  await db.from("upstream_grants").delete().eq("server_id", serverId);
  await db.from("upstream_sessions").delete().eq("server_id", serverId);
  await logEvent({
    user_id: userId,
    server_id: serverId,
    level: "warn",
    event: "upstream.disconnected",
    message: "Provider grant deleted — outbound calls will fail until reconnected",
  });
  await Custody.record({
    userId,
    serverId,
    operation: "grant.revoked",
    kind: "refresh",
    outcome: "ok",
    detail: { scope: "all subjects" },
  });
  return { ok: true };

}
