import { cloudflare } from "./providers/cloudflare";
import { aws } from "./providers/aws";
import { github } from "./providers/github";
import { slack } from "./providers/slack";
import { sentry } from "./providers/sentry";
import { onepassword } from "./providers/onepassword";
import { chatgpt, claudeCode, claudeWeb, codex, jetbrains } from "./providers/clients";
import { TIERS, type Spec, type Tier } from "./types";

/**
 * The provider table. Every path — one-click install, generated script, manual
 * instructions, capability gate — reads this and only this, so a scope can
 * never be requested by one path and absent from another's description.
 */
const SPECS: Spec[] = [
  cloudflare,
  aws,
  onepassword,
  github,
  slack,
  sentry,
  claudeWeb,
  chatgpt,
  claudeCode,
  codex,
  jetbrains,
];

const WRITE_WORDS = /(write|edit|create|update|delete|remove|put|post|manage)/i;

/**
 * A read tier that smuggles in a mutating scope would quietly defeat the whole
 * split, so specs are validated once at load rather than trusted.
 */
function validate(spec: Spec) {
  const read = spec.tiers.read;
  if (!read) return;
  for (const scope of read.scopes) {
    if (WRITE_WORDS.test(scope.name)) {
      throw new Error(`${spec.id}: read tier declares a mutating scope "${scope.name}"`);
    }
  }
}

SPECS.forEach(validate);

const BY_ID = new Map(SPECS.map((s) => [s.id, s]));

export function specs(): Spec[] {
  return SPECS;
}

export function spec(provider: string): Spec {
  const found = BY_ID.get(provider);
  if (!found) throw new Error(`Unknown integration "${provider}"`);
  return found;
}

export function tierSpec(provider: string, tier: Tier) {
  const found = spec(provider).tiers[tier];
  if (!found) throw new Error(`${provider} has no ${tier} tier`);
  return found;
}

export function tiersOf(provider: string): Tier[] {
  const s = spec(provider);
  return TIERS.filter((t) => !!s.tiers[t]);
}
