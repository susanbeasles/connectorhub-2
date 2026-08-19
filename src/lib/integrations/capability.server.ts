import { record, state } from "./install.server";
import { tierSpec, tiersOf } from "./registry.server";
import type { Tier } from "./types";

/**
 * Features are gated on capability, never on configuration. A provider with
 * only its read tier installed keeps every inspection surface working; the
 * mutating ones render as unavailable with a reason instead of failing part
 * way through a call.
 */

export type Capability = {
  tier: Tier;
  granted: boolean;
  reason: string;
  unlocks: string[];
};

export async function capabilities(provider: string): Promise<Capability[]> {
  const current = await state(provider);
  return tiersOf(provider).map((tier) => {
    const present = current.tiers.find((t) => t.tier === tier)?.present ?? false;
    const t = tierSpec(provider, tier);
    return {
      tier,
      granted: present,
      reason: present
        ? `${tier} credential is in ${t.vault}`
        : `No ${tier} credential — install it to enable these actions`,
      unlocks: t.capabilities,
    };
  });
}

export async function allows(provider: string, tier: Tier): Promise<boolean> {
  const current = await state(provider);
  return current.tiers.some((t) => t.tier === tier && t.present);
}

/**
 * The single check every mutating call makes before it starts. Failing here is
 * a clean refusal; failing halfway through a provisioning run is not.
 */
export async function requireCapability(provider: string, tier: Tier, action: string) {
  if (await allows(provider, tier)) return;
  await record({
    provider,
    tier,
    step: "capability",
    level: "warn",
    message: `"${action}" was refused: no ${tier} credential is installed`,
  });
  throw new Error(
    `${action} needs the ${tier} tier of ${provider}. Install it from the integrations page; everything read-only keeps working without it.`,
  );
}
