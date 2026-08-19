import { spec } from "./registry.server";
import { record, acceptCredential, state, CUSTODY_KEY } from "./install.server";
import { driver } from "./custody.server";
import { bridgeEnsure, itemList, itemRead, vaultList } from "./onepassword.server";
import type { IntegrationState, Tier, Vault } from "./types";

/**
 * Adoption, not creation. A provider that offers no admin OAuth grant, and no
 * way for a machine identity to create another machine identity, still has an
 * estate the operator built by hand. The operator hands over one seed; the app
 * discovers that estate, adopts the identities already filed inside it, proves
 * each one works, and holds custody from then on.
 */

const REQUIRED_VAULTS: Vault[] = ["aegis-seed", "aegis-read", "aegis-write", "aegis-admin"];
const IDENTITY_VAULT: Vault = "aegis-seed";

/** Which tier an item inside the identity vault belongs to. Most specific first. */
const IDENTITY_TITLES: { tier: Tier; match: RegExp }[] = [
  { tier: "destructive", match: /admin|destructive/i },
  { tier: "write", match: /write/i },
  { tier: "read", match: /read/i },
];

export function identityItems(items: { id: string; title: string }[]): { tier: Tier; itemId: string }[] {
  const found: { tier: Tier; itemId: string }[] = [];
  for (const { tier, match } of IDENTITY_TITLES) {
    const item = items.find((candidate) => match.test(candidate.title) && !found.some((entry) => entry.itemId === candidate.id));
    if (!item) throw new Error(`aegis-seed has no item for the ${tier} service account`);
    found.push({ tier, itemId: item.id });
  }
  return found;
}

/** Prove the seed authenticates, and that every vault the app relies on exists. */
async function discover(seed: string): Promise<Map<string, string>> {
  const vaults = await vaultList(seed);
  const byName = new Map(vaults.map((v) => [v.name, v.id]));
  const missing = REQUIRED_VAULTS.filter((name) => !byName.has(name));
  if (missing.length) {
    throw new Error(
      `The seed can see ${vaults.length} vault(s) but not ${missing.join(", ")}. Create them, or grant the seed access, then try again.`,
    );
  }
  return byName;
}

/** Pull one service account token out of the identity vault. */
async function credentialOf(seed: string, vaultId: string, itemId: string): Promise<string> {
  return (await itemRead(seed, vaultId, itemId)).value;
}

/**
 * Adopt the three service accounts the operator already filed in aegis-seed.
 * Every token is proved against the vault it is supposed to reach before any
 * of them is filed, so a mismatched item fails loudly instead of half-arming
 * the app.
 */
async function adoptIdentities(input: {
  provider: string;
  seed: string;
  actor: string;
  vaults: Map<string, string>;
}): Promise<Tier[]> {
  const d = driver(input.provider);
  const seedVaultId = input.vaults.get(IDENTITY_VAULT);
  if (!seedVaultId) throw new Error("The seed cannot see aegis-seed");
  const items = await itemList(input.seed, seedVaultId);

  const found: { tier: Tier; itemId: string; token: string }[] = [];
  for (const item of identityItems(items)) {
    const token = await credentialOf(input.seed, seedVaultId, item.itemId);
    const tier = item.tier;
    if (d) await d.verify({ token, tier });
    found.push({ tier, itemId: item.itemId, token });
  }

  for (const f of found) {
    await acceptCredential({
      provider: input.provider,
      tier: f.tier,
      value: f.token,
      via: "click",
      accountLabel: process.env["OP_ACCOUNT"] ?? null,
      actor: input.actor,
      adopt: { vault: IDENTITY_VAULT, itemId: f.itemId },
    });
  }

  return found.map((f) => f.tier);
}

/**
 * The seed stays, sealed, as the sole custodian of aegis-seed — the vault the
 * app's three service accounts live in. Nothing else can read or replace them,
 * so no rotation can ever lock the app out of its own identity.
 */
async function retainSeed(provider: string, actor: string, seed: string) {
  const { encryptSecret } = await import("@/lib/crypto.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("integrations").select("tiers").eq("provider", provider).maybeSingle();
  const tiers = ((data?.tiers as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  tiers["seed"] = { sealed: await encryptSecret(seed), retainedAt: new Date().toISOString() };
  tiers[CUSTODY_KEY] = { seedDisownedAt: new Date().toISOString() };
  await supabaseAdmin
    .from("integrations")
    .update({ tiers: tiers as never, updated_at: new Date().toISOString() })
    .eq("provider", provider);

  await record({
    provider,
    step: "seed.retained",
    message:
      "The three service accounts were adopted and verified. The seed is sealed and kept as the sole custodian of aegis-seed, where those accounts live; it is used for nothing else.",
    actor,
  });
}

export async function provision(input: {
  provider: string;
  seed: string;
  actor: string;
}): Promise<IntegrationState> {
  const s = spec(input.provider);
  if (!s.selfProvision) {
    throw new Error(`${s.label} cannot be adopted this way — use the one-click grant, the script, or the manual steps.`);
  }

  await bridgeEnsure();
  const vaults = await discover(input.seed);
  await record({
    provider: input.provider,
    step: "provision",
    message: `Seed accepted; ${REQUIRED_VAULTS.join(", ")} all present`,
    actor: input.actor,
    meta: { vaults: REQUIRED_VAULTS },
  });

  const tiers = await adoptIdentities({
    provider: input.provider,
    seed: input.seed,
    actor: input.actor,
    vaults,
  });

  await record({
    provider: input.provider,
    step: "adopt",
    message: `Adopted and verified the ${tiers.join(", ")} service accounts from aegis-seed`,
    actor: input.actor,
    meta: { tiers },
  });

  await retainSeed(input.provider, input.actor, input.seed);
  return state(input.provider);
}
