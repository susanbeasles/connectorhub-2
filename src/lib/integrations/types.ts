/**
 * The vocabulary every integration is described in. Providers are data written
 * against these types; no provider ever contributes control flow, so the
 * install pipeline, the generated shell script and the console all read from
 * exactly one description and can never disagree about a scope.
 */

export type Tier = "read" | "write" | "destructive";

export const TIERS: Tier[] = ["read", "write", "destructive"];

/** How durable the minted credential is, best first. */
export type Lifetime = "single-use" | "short-lived" | "rotating" | "annual" | "permanent";

/**
 * Four vaults, two kinds of secret. `aegis-seed` holds the identities the app
 * runs as; the three tier vaults hold the provider credentials those identities
 * read. Nothing that lives in a tier vault can reach the vault holding the
 * credential used to read it.
 */
export type Vault = "aegis-seed" | "aegis-read" | "aegis-write" | "aegis-admin";

export type Scope = {
  /** The provider's own name for the permission, verbatim. */
  name: string;
  /** What holding it permits, in plain language. */
  grants: string;
  /** Why this application needs it. */
  why: string;
};

export type Variable = {
  name: string;
  label: string;
  example: string;
  /** Left empty when the operator must supply it; prefilled when we know it. */
  value?: string;
  secret?: boolean;
};

export type Step = {
  title: string;
  why: string;
  command: string;
};

export type Blueprint = {
  variables: Variable[];
  steps: Step[];
  /** Printed at the end so the operator knows what to paste back. */
  outputs: string[];
};

export type ManualStep = {
  title: string;
  url?: string;
  detail: string;
  why: string;
};

export type TierSpec = {
  summary: string;
  lifetime: Lifetime;
  vault: Vault;
  scopes: Scope[];
  /** App features this tier unlocks; used verbatim by the capability gate. */
  capabilities: string[];
  /** OAuth scopes the bootstrap grant asks for, revoked once minting is done. */
  bootstrapScopes: string[];
  blueprint: Blueprint;
  manual: ManualStep[];
  /** Set only when no better credential exists; the reason is shown in the UI. */
  lastResort?: string;
};

export type SpecKind = "service" | "client";

export type Spec = {
  id: string;
  label: string;
  kind: SpecKind;
  summary: string;
  docsUrl: string;
  /** Absent for client pairings, which have no admin API to mint against. */
  oauth?: {
    authorizeUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
    clientIdEnv: string;
    clientSecretEnv: string;
  };
  /**
   * For providers with no admin OAuth grant but a machine credential that can
   * provision everything else. One seed, supplied once, after which the app
   * builds the vaults and files every later credential without a human.
   */
  selfProvision?: {
    /** What the operator seeds it with, named the way the provider names it. */
    credential: string;
    /** What the app will build with that seed, in plain language. */
    creates: string[];
    hint: string;
    docsUrl: string;
  };
  tiers: Partial<Record<Tier, TierSpec>>;
};

export type TierState = {
  tier: Tier;
  present: boolean;
  vaultItem: string | null;
  expiresAt: string | null;
  installedVia: "click" | "script" | "manual" | null;
  /** The provider-side identity the app minted, so it can revoke exactly this one. */
  identity: string | null;
  mintedAt: string | null;
  rotatedAt: string | null;
};

/**
 * Who holds the keys. `seed` means the operator's original credential is still
 * doing the work and must not be deleted yet; `self` means the app minted and
 * verified its own successors and the seed can be destroyed.
 */
export type Custody = "none" | "seed" | "self";

export type IntegrationState = {
  provider: string;
  status: "not_connected" | "read" | "read_write" | "full" | "revoked";
  tiers: TierState[];
  accountLabel: string | null;
  lastVerifiedAt: string | null;
  custody: Custody;
  seedDisownedAt: string | null;
};
