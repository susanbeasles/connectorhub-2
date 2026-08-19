import type { Tier } from "./types";

/**
 * Custody drivers: how a provider proves and destroys the identities the app
 * runs on. One driver per provider, all the same shape, so provisioning and
 * rotation are written once and never branch on who the provider is.
 *
 * `mint` is optional on purpose. Some providers — 1Password among them — only
 * allow a human-authenticated session to create a machine identity, so the app
 * adopts identities that already exist rather than pretending it can create
 * them.
 */

export type Minted = {
  /** The secret itself. It goes straight to custody and is never returned upward. */
  token: string;
  /** The provider-side identity, so exactly this one can be revoked later. */
  identity: string;
  expiresAt: string | null;
  accountLabel: string | null;
};

export type Driver = {
  /** Mint a successor for one tier, where the provider allows it at all. */
  mint?(input: { admin: string; tier: Tier }): Promise<Minted>;
  /** Prove a credential actually works before anything is relied on. */
  verify(input: { token: string; tier: Tier }): Promise<void>;
  /** Destroy a previously minted identity at the provider, where supported. */
  revokeIdentity?(input: { admin: string; identity: string }): Promise<void>;
  /** Which tier's credential is powerful enough to act on the others. */
  adminTier: Tier;
};

/** The vault each tier's identity is expected to be able to reach. */
export const OP_VAULTS: Record<Tier, string> = {
  read: "aegis-read",
  write: "aegis-write",
  destructive: "aegis-admin",
};

const onepassword: Driver = {
  // The admin identity is the only writer of provider credentials.
  adminTier: "destructive",

  async verify({ token, tier }) {
    const { vaultList } = await import("./onepassword.server");
    const vaults = await vaultList(token);
    if (!vaults.some((v) => v.name === OP_VAULTS[tier])) {
      throw new Error(`The ${tier} service account cannot see ${OP_VAULTS[tier]}`);
    }
  },
};

const DRIVERS: Record<string, Driver> = { "1password": onepassword };

export function driver(provider: string): Driver | null {
  return DRIVERS[provider] ?? null;
}
