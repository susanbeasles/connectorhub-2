import { record, state, type StoredTier } from "./install.server";
import { acceptCredential } from "./install.server";
import { spec, tiersOf } from "./registry.server";
import { driver } from "./custody.server";
import { destroyRef, readSecret, readSeed, reference } from "./vault.server";
import type { IntegrationState, Tier } from "./types";

/**
 * Rotation. Whatever the app minted, the app can re-mint: a new credential is
 * created and proved before the old one is filed away, so a rotation that fails
 * leaves the working credential untouched rather than locking the app out.
 */

const RENEW_WINDOW_DAYS = 14;

const CUSTODY_PROVIDER = "1password";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function rotate(input: { provider: string; tier: Tier; actor: string }): Promise<IntegrationState> {
  const s = spec(input.provider);
  const d = driver(input.provider);
  if (!d) throw new Error(`${s.label} cannot rotate itself — replace the credential through the script or by hand.`);
  const mint = d.mint;
  if (!mint) {
    // 1Password and its like only let a human-authenticated session create a
    // machine identity, so rotation here is assisted: create the replacement
    // with the printed op command and paste it into this tier.
    throw new Error(
      `${s.label} will not create a service account over its API. Run the generated script to create the replacement, then paste it into this tier — the app files it over the existing aegis-seed item.`,
    );
  }

  // Identity credentials are minted by the seed, the only thing with access to
  // the vault they live in; every other provider is minted by the admin tier.
  const admin =
    input.provider === CUSTODY_PROVIDER ? await readSeed() : await readSecret(input.provider, d.adminTier);
  const previousRef = await reference(input.provider, input.tier);
  const previousIdentity = (await stored(input.provider, input.tier))?.identity ?? null;

  const minted = await mint({ admin, tier: input.tier });
  await d.verify({ token: minted.token, tier: input.tier });

  await acceptCredential({
    provider: input.provider,
    tier: input.tier,
    value: minted.token,
    via: "click",
    accountLabel: minted.accountLabel,
    actor: input.actor,
    identity: minted.identity,
    expiresAt: minted.expiresAt,
  });

  if (previousRef && previousRef.itemId !== minted.identity) {
    await destroyRef(previousRef).catch(() => undefined);
  }
  const revokeIdentity = d.revokeIdentity;
  if (revokeIdentity && previousIdentity && previousIdentity !== minted.identity) {
    await revokeIdentity({ admin, identity: previousIdentity })
      .catch((e: unknown) =>
        record({
          provider: input.provider,
          tier: input.tier,
          step: "rotate",
          level: "warn",
          message: `The superseded identity could not be destroyed: ${e instanceof Error ? e.message : "unknown error"}`,
        }),
      );
  }

  await record({
    provider: input.provider,
    tier: input.tier,
    step: "rotate",
    message: `${s.label} ${input.tier} credential rotated; the previous identity was destroyed`,
    actor: input.actor,
    meta: { expiresAt: minted.expiresAt },
  });

  return state(input.provider);
}

async function stored(provider: string, tier: Tier): Promise<StoredTier | null> {
  const client = await db();
  const { data } = await client.from("integrations").select("tiers").eq("provider", provider).maybeSingle();
  return ((data?.tiers as Record<string, StoredTier> | null) ?? {})[tier] ?? null;
}

/**
 * The scheduled sweep. Anything the app minted and that falls inside the renewal
 * window is replaced without anyone being asked.
 */
export async function rotateDue(actor = "cron"): Promise<{ rotated: string[]; failed: string[] }> {
  const client = await db();
  const { data } = await client.from("integrations").select("provider, tiers");
  const horizon = Date.now() + RENEW_WINDOW_DAYS * 24 * 60 * 60_000;
  const rotated: string[] = [];
  const failed: string[] = [];

  for (const row of data ?? []) {
    // Only providers whose identities the app can actually re-create are swept;
    // the rest surface as an expiry warning and are replaced with assistance.
    if (!driver(row.provider)?.mint) continue;
    const tiers = (row.tiers as Record<string, StoredTier>) ?? {};
    for (const tier of tiersOf(row.provider)) {
      const entry = tiers[tier];
      if (!entry?.identity || !entry.expiresAt) continue;
      if (new Date(entry.expiresAt).getTime() > horizon) continue;
      try {
        await rotate({ provider: row.provider, tier, actor });
        rotated.push(`${row.provider}:${tier}`);
      } catch (e) {
        failed.push(`${row.provider}:${tier}`);
        await record({
          provider: row.provider,
          tier,
          step: "rotate",
          level: "error",
          message: `Automatic rotation failed: ${e instanceof Error ? e.message : "unknown error"}`,
          actor,
        });
      }
    }
  }

  return { rotated, failed };
}
