import { decryptSecret, encryptSecret, sha256Hex } from "@/lib/crypto.server";
import type { Tier, Vault } from "./types";

/**
 * The only writer of secret material in the application. Everything else holds
 * a reference. Three vaults with three service accounts keep read, write and
 * destructive custody physically apart: the read token cannot see the write
 * vault, and the write and destructive tokens stay sealed until the owner's
 * security key has been used.
 */

const VAULT_FOR: Record<Tier, Vault> = {
  read: "aegis-read",
  write: "aegis-write",
  destructive: "aegis-admin",
};

/**
 * The custody provider's own credentials are identity secrets: they are what
 * the app authenticates to the vault as, so they live apart from everything
 * they are used to fetch, in a vault only the seed can touch.
 */
const CUSTODY_PROVIDER = "1password";
const IDENTITY_VAULT: Vault = "aegis-seed";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Which identity may touch a vault, and for what. Capability follows the vault,
 * never the caller. The runtime read and write tokens are pure consumers of one
 * vault each; the admin token is the only writer of provider credentials; and
 * the seed is the only identity with any access at all to the vault holding the
 * three service accounts, so no identity can ever overwrite itself.
 */
type Custodian = Tier | "seed";
type Mode = "read" | "write";

const CUSTODIANS: Record<Vault, Record<Mode, Custodian>> = {
  "aegis-seed": { read: "seed", write: "seed" },
  "aegis-read": { read: "read", write: "destructive" },
  "aegis-write": { read: "write", write: "destructive" },
  // The admin identity holds read on its own vault only, so it can never
  // overwrite the credentials it authenticates with. The seed writes here.
  "aegis-admin": { read: "destructive", write: "seed" },
};

function custodian(vault: Vault, mode: Mode): Custodian {
  return CUSTODIANS[vault][mode];
}

/** Service-account tokens live sealed at rest; only this module unseals them. */
async function serviceToken(who: Custodian): Promise<string> {
  const client = await db();
  const { data } = await client
    .from("integrations")
    .select("tiers")
    .eq("provider", "1password")
    .maybeSingle();
  const tiers = (data?.tiers as Record<string, { sealed?: string }> | null) ?? {};
  // The seed is the sole custodian of aegis-seed; before it is filed the
  // destructive token stands in so bootstrap can still complete.
  const sealed = tiers[who]?.sealed ?? (who === "seed" ? tiers["destructive"]?.sealed : undefined);
  if (!sealed) throw new Error(`1Password ${who} service account is not configured`);
  return decryptSecret(sealed);
}

export type VaultRef = { vault: Vault; itemId: string; digest: string; expiresAt: string | null };

/**
 * File a credential. Called identically whether it arrived from the one-click
 * install, a script paste-back or a manual paste — one door into custody.
 */
export async function storeSecret(input: {
  provider: string;
  tier: Tier;
  value: string;
  expiresAt?: string | null;
  /**
   * The credential already lives in the vault as this item — adopt it rather
   * than writing a duplicate. The value is still sealed locally so the app can
   * authenticate without first needing a credential to fetch a credential.
   */
  adopt?: { vault: Vault; itemId: string };
}): Promise<VaultRef> {
  const vault = input.adopt?.vault ?? vaultFor(input.provider, input.tier);
  const digest = (await sha256Hex(input.value)).slice(0, 16);
  const title = `aegis-${input.provider}-${input.tier}`;

  if (input.adopt) {
    await seal(input.provider, input.tier, input.value, digest);
    return { vault, itemId: input.adopt.itemId, digest, expiresAt: input.expiresAt ?? null };
  }

  if (await writable()) {
    const { itemCreate } = await import("./onepassword.server");
    const item = await itemCreate(await serviceToken(custodian(vault, "write")), vault, {
      title,
      value: input.value,
      provider: input.provider,
      tier: input.tier,
    });
    return { vault, itemId: item.id, digest, expiresAt: input.expiresAt ?? null };
  }

  // No vault connected yet: the value is sealed with the broker key so bootstrap
  // can complete, and the console reports the weaker custody honestly.
  await seal(input.provider, input.tier, input.value, digest);
  return { vault, itemId: `sealed:${title}`, digest, expiresAt: input.expiresAt ?? null };
}

/** Seal a value at rest under the broker key, beside its tier entry. */
async function seal(provider: string, tier: Tier, value: string, digest: string) {
  const client = await db();
  const { data } = await client.from("integrations").select("tiers").eq("provider", provider).maybeSingle();
  const tiers = ((data?.tiers as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  tiers[tier] = { ...(tiers[tier] as object), sealed: await encryptSecret(value), digest };
  await client
    .from("integrations")
    .upsert({ provider, tiers: tiers as never, updated_at: new Date().toISOString() }, { onConflict: "provider" });
}

/** Read a credential back for use. Never returned to any client surface. */
export async function readSecret(provider: string, tier: Tier): Promise<string> {
  const ref = await reference(provider, tier);
  if (!ref) throw new Error(`${provider} has no ${tier} credential`);
  if (ref.itemId.startsWith("sealed:")) {
    const client = await db();
    const { data } = await client.from("integrations").select("tiers").eq("provider", provider).maybeSingle();
    const sealed = (data?.tiers as Record<string, { sealed?: string }> | null)?.[tier]?.sealed;
    if (!sealed) throw new Error(`${provider} ${tier} credential is missing`);
    return decryptSecret(sealed);
  }
  const { itemRead } = await import("./onepassword.server");
  return (await itemRead(await serviceToken(custodian(ref.vault, "read")), ref.vault, ref.itemId)).value;
}

export async function destroySecret(provider: string, tier: Tier): Promise<void> {
  const ref = await reference(provider, tier);
  if (!ref) return;
  if (!ref.itemId.startsWith("sealed:") && (await available())) {
    const { itemDelete } = await import("./onepassword.server");
    await itemDelete(await serviceToken(custodian(ref.vault, "write")), ref.vault, ref.itemId);
  }
  const client = await db();
  const { data } = await client.from("integrations").select("tiers").eq("provider", provider).maybeSingle();
  const tiers = ((data?.tiers as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  delete tiers[tier];
  await client
    .from("integrations")
    .update({ tiers: tiers as never, updated_at: new Date().toISOString() })
    .eq("provider", provider);
}

/**
 * Destroy one specific item, named by a reference captured earlier. Rotation
 * uses this to remove the superseded item after the successor is filed.
 */
export async function destroyRef(ref: VaultRef): Promise<void> {
  if (ref.itemId.startsWith("sealed:") || !(await available())) return;
  const { itemDelete } = await import("./onepassword.server");
  await itemDelete(await serviceToken(custodian(ref.vault, "write")), ref.vault, ref.itemId);
}

export async function reference(provider: string, tier: Tier): Promise<VaultRef | null> {
  const client = await db();
  const { data } = await client.from("integrations").select("tiers").eq("provider", provider).maybeSingle();
  const entry = (data?.tiers as Record<string, VaultRef & { sealed?: string }> | null)?.[tier];
  if (!entry) return null;
  return {
    vault: entry.vault ?? vaultFor(provider, tier),
    itemId: entry.itemId ?? `sealed:aegis-${provider}-${tier}`,
    digest: entry.digest ?? "",
    expiresAt: entry.expiresAt ?? null,
  };
}

/**
 * The seed: the one credential the operator supplied, and the only identity
 * with access to the vault holding the app's own service accounts. Rotation of
 * those accounts is the only thing that ever asks for it.
 */
export async function readSeed(): Promise<string> {
  return serviceToken("seed");
}

export async function available(): Promise<boolean> {
  try {
    await serviceToken("seed");
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether new secrets may be filed into the vaults. Custody is reachable and
 * the rollout stage permits using it — in sandbox the estate is left untouched
 * and values are sealed locally instead, which is why demotion never has to
 * pull anything back out of the operator's vaults.
 */
export async function writable(): Promise<boolean> {
  const { allows } = await import("@/lib/stage/stage.server");
  return (await allows("custody:vault")) && available();
}

/**
 * Where a credential belongs. Identity secrets — the app's own service
 * accounts — go to the seed vault; everything else goes to its tier vault.
 */
export function vaultFor(provider: string, tier: Tier): Vault {
  return provider === CUSTODY_PROVIDER ? IDENTITY_VAULT : VAULT_FOR[tier];
}
