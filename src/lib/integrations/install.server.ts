import { spec, specs, tierSpec, tiersOf } from "./registry.server";
import { reference, storeSecret, vaultFor } from "./vault.server";
import type { Custody, IntegrationState, Tier, TierState } from "./types";

/**
 * The universal install pipeline. Every provider and every path — click,
 * script paste-back, manual paste — converges here, so classification, custody
 * and the audit trail are written exactly once.
 */

const HANDSHAKE_TTL_MS = 10 * 60_000;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function record(input: {
  provider: string;
  tier?: Tier | null;
  step: string;
  message: string;
  level?: "info" | "warn" | "error";
  actor?: string | null;
  meta?: Record<string, unknown>;
}) {
  const client = await db();
  await client.from("integration_events").insert({
    provider: input.provider,
    tier: input.tier ?? null,
    step: input.step,
    level: input.level ?? "info",
    message: input.message,
    actor: input.actor ?? null,
    meta: (input.meta ?? {}) as never,
  });
}

/** The shape the tiers column holds; one entry per tier plus the custody marker. */
export type StoredTier = {
  itemId?: string;
  expiresAt?: string | null;
  via?: string;
  identity?: string | null;
  mintedAt?: string | null;
  rotatedAt?: string | null;
};

/** Reserved key inside the tiers column recording that the seed was handed back. */
export const CUSTODY_KEY = "_custody";

/**
 * The app is self-custodial once every credential it holds is one it minted
 * itself. Until then the operator's seed is still load-bearing.
 */
function custodyOf(tiers: TierState[]): Custody {
  const present = tiers.filter((t) => t.present);
  if (!present.length) return "none";
  return present.every((t) => !!t.identity) ? "self" : "seed";
}

function statusFor(tiers: TierState[]): IntegrationState["status"] {
  const present = new Set(tiers.filter((t) => t.present).map((t) => t.tier));
  if (!present.size) return "not_connected";
  if (present.has("destructive")) return "full";
  if (present.has("write")) return "read_write";
  return "read";
}

export async function state(provider: string): Promise<IntegrationState> {
  const client = await db();
  const { data } = await client
    .from("integrations")
    .select("account_label, last_verified_at, revoked_at, tiers")
    .eq("provider", provider)
    .maybeSingle();
  const stored = (data?.tiers as Record<string, StoredTier> | null) ?? {};

  const tiers: TierState[] = tiersOf(provider).map((tier) => {
    const entry = stored[tier];
    return {
      tier,
      present: !!entry,
      vaultItem: entry?.itemId ?? null,
      expiresAt: entry?.expiresAt ?? null,
      installedVia: (entry?.via as TierState["installedVia"]) ?? null,
      identity: entry?.identity ?? null,
      mintedAt: entry?.mintedAt ?? null,
      rotatedAt: entry?.rotatedAt ?? null,
    };
  });

  return {
    provider,
    status: data?.revoked_at ? "revoked" : statusFor(tiers),
    tiers,
    accountLabel: data?.account_label ?? null,
    lastVerifiedAt: data?.last_verified_at ?? null,
    custody: custodyOf(tiers),
    seedDisownedAt: (stored[CUSTODY_KEY] as { seedDisownedAt?: string } | undefined)?.seedDisownedAt ?? null,
  };
}

export async function states(): Promise<IntegrationState[]> {
  return Promise.all(specs().map((s) => state(s.id)));
}

/**
 * Accept a minted credential. The value goes straight to custody; the database
 * only ever learns that a reference exists.
 */
export async function acceptCredential(input: {
  provider: string;
  tier: Tier;
  value: string;
  via: "click" | "script" | "manual";
  accountLabel?: string | null;
  actor?: string | null;
  /** Set when the app minted this credential itself and can revoke it later. */
  identity?: string | null;
  /** Provider-declared expiry, preferred over the tier's nominal lifetime. */
  expiresAt?: string | null;
  /** The credential already exists as this vault item; adopt it in place. */
  adopt?: { vault: import("./types").Vault; itemId: string };
}) {
  const t = tierSpec(input.provider, input.tier);
  if (input.tier === "destructive" && !input.value) {
    throw new Error("A destructive credential cannot be empty");
  }

  const expiresAt =
    input.expiresAt !== undefined
      ? input.expiresAt
      : t.lifetime === "annual"
        ? new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString()
        : t.lifetime === "single-use" || t.lifetime === "short-lived"
          ? null
          : new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString();

  const ref = await storeSecret({
    provider: input.provider,
    tier: input.tier,
    value: input.value,
    expiresAt,
    ...(input.adopt ? { adopt: input.adopt } : {}),
  });

  const client = await db();
  const { data } = await client
    .from("integrations")
    .select("tiers")
    .eq("provider", input.provider)
    .maybeSingle();
  const tiers = ((data?.tiers as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const previous = (tiers[input.tier] as StoredTier | undefined) ?? {};
  tiers[input.tier] = {
    ...previous,
    vault: ref.vault,
    itemId: ref.itemId,
    digest: ref.digest,
    expiresAt,
    via: input.via,
    identity: input.identity ?? input.adopt?.itemId ?? null,
    mintedAt: previous.mintedAt ?? new Date().toISOString(),
    rotatedAt: previous.mintedAt ? new Date().toISOString() : null,
  };

  await client.from("integrations").upsert(
    {
      provider: input.provider,
      tiers: tiers as never,
      status: "connected",
      installed_via: input.via,
      revoked_at: null,
      account_label: input.accountLabel ?? null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );

  await record({
    provider: input.provider,
    tier: input.tier,
    step: "store",
    message: `${spec(input.provider).label} ${input.tier} credential filed in ${vaultFor(input.provider, input.tier)} via ${input.via}`,
    actor: input.actor ?? null,
    meta: { digest: ref.digest, lifetime: t.lifetime, scopes: t.scopes.map((s) => s.name) },
  });

  return state(input.provider);
}

/** Begin the admin OAuth handshake used by the one-click path. */
export async function beginInstall(input: {
  provider: string;
  tier: Tier;
  origin: string;
  actor: string;
}) {
  const s = spec(input.provider);
  if (!s.oauth) throw new Error(`${s.label} has no OAuth bootstrap — use the script or manual path`);
  const clientId = process.env[s.oauth.clientIdEnv];
  if (!clientId) {
    throw new Error(
      `${s.label} one-click install needs ${s.oauth.clientIdEnv} configured. The script and manual paths work today.`,
    );
  }

  const t = tierSpec(input.provider, input.tier);
  const random = (bytes: number) =>
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const state_ = random(32);
  const verifier = random(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const redirectUri = `${new URL(input.origin).origin}/api/public/oauth/integration-callback`;

  const client = await db();
  await client.from("integration_sessions").insert({
    provider: input.provider,
    tier: input.tier,
    state: state_,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    actor: input.actor,
    expires_at: new Date(Date.now() + HANDSHAKE_TTL_MS).toISOString(),
  });

  const url = new URL(s.oauth.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state_);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (t.bootstrapScopes.length) url.searchParams.set("scope", t.bootstrapScopes.join(" "));

  await record({
    provider: input.provider,
    tier: input.tier,
    step: "consent",
    message: `Bootstrap consent requested with ${t.bootstrapScopes.length} admin scope(s); it is revoked as soon as minting finishes`,
    actor: input.actor,
    meta: { scopes: t.bootstrapScopes },
  });

  return { authorizeUrl: url.toString(), expiresInSec: HANDSHAKE_TTL_MS / 1000 };
}

export async function verified(provider: string, tier: Tier): Promise<boolean> {
  return (await reference(provider, tier)) !== null;
}
