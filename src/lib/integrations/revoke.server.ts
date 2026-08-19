import { record, state } from "./install.server";
import { spec } from "./registry.server";
import { destroySecret } from "./vault.server";
import type { Tier } from "./types";

/**
 * Two kinds of destruction, kept apart on purpose: the bootstrap grant is
 * always destroyed the moment minting finishes, while a stored credential is
 * only destroyed on an explicit operator action.
 */

/** Hand the bootstrap token back to the provider so it stops existing. */
export async function revokeBootstrap(provider: string, tier: Tier, token: string) {
  const s = spec(provider);
  if (!s.oauth?.revokeUrl) {
    await record({
      provider,
      tier,
      step: "revoke",
      level: "warn",
      message: `${s.label} exposes no revocation endpoint — the bootstrap token was discarded locally and expires on its own`,
    });
    return;
  }
  try {
    await fetch(s.oauth.revokeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    await record({
      provider,
      tier,
      step: "revoke",
      message: `Bootstrap grant revoked at ${s.label}; the app no longer holds admin access`,
    });
  } catch (e) {
    await record({
      provider,
      tier,
      step: "revoke",
      level: "error",
      message: `Could not revoke the bootstrap grant at ${s.label}: ${e instanceof Error ? e.message : "unknown error"}`,
    });
  }
}

/** Remove a stored credential. Read tiers can go without ceremony. */
export async function revokeTier(input: { provider: string; tier: Tier; actor: string }) {
  await destroySecret(input.provider, input.tier);
  await record({
    provider: input.provider,
    tier: input.tier,
    step: "revoke",
    level: "warn",
    message: `${spec(input.provider).label} ${input.tier} credential destroyed`,
    actor: input.actor,
  });
  return state(input.provider);
}

/** Anything expiring inside the window, so the console can warn before it lapses. */
export async function expiring(days = 30) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("integrations").select("provider, tiers");
  const horizon = Date.now() + days * 24 * 60 * 60_000;
  const soon: { provider: string; tier: string; expiresAt: string }[] = [];
  for (const row of data ?? []) {
    const tiers = (row.tiers as Record<string, { expiresAt?: string }>) ?? {};
    for (const [tier, entry] of Object.entries(tiers)) {
      if (entry?.expiresAt && new Date(entry.expiresAt).getTime() < horizon) {
        soon.push({ provider: row.provider, tier, expiresAt: entry.expiresAt });
      }
    }
  }
  return soon;
}
