import { tierSpec } from "./registry.server";
import { record } from "./install.server";
import type { Tier } from "./types";

/**
 * Minting: exchange a short-lived admin grant for the narrow, long-lived
 * credential the broker actually runs on. One function per provider, all with
 * the same shape, so the callback never learns provider detail.
 *
 * A provider without a minter is not a gap in the product — its script and
 * manual paths do the same work under the operator's own eyes.
 */

export type Minted = { value: string; accountLabel: string | null };
type Minter = (input: { tier: Tier; bootstrapToken: string }) => Promise<Minted>;

const CF_API = "https://api.cloudflare.com/client/v4";

async function cf(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await res.json()) as { success: boolean; result: unknown; errors?: { message: string }[] };
  if (!res.ok || !payload.success) {
    throw new Error(payload.errors?.map((e) => e.message).join("; ") || `Cloudflare returned ${res.status}`);
  }
  return payload.result;
}

/**
 * Cloudflare names permission groups rather than exposing stable ids, so the
 * scope names in the spec are resolved against the live catalogue. An
 * unresolvable name fails the mint instead of silently widening the token.
 */
const cloudflareMinter: Minter = async ({ tier, bootstrapToken }) => {
  const t = tierSpec("cloudflare", tier);
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");

  const groups = (await cf("/user/tokens/permission_groups", bootstrapToken)) as {
    id: string;
    name: string;
  }[];
  const resolved = t.scopes.map((scope) => {
    const match = groups.find((g) => g.name.toLowerCase() === scope.name.toLowerCase());
    if (!match) throw new Error(`Cloudflare no longer offers the permission "${scope.name}"`);
    return { id: match.id };
  });

  const expiresOn = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString().slice(0, 19) + "Z";
  const token = (await cf("/user/tokens", bootstrapToken, {
    method: "POST",
    body: JSON.stringify({
      name: `aegis-${tier}`,
      expires_on: expiresOn,
      policies: [
        {
          effect: "allow",
          permission_groups: resolved,
          resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
        },
      ],
    }),
  })) as { value: string };

  return { value: token.value, accountLabel: accountId };
};

/** Sentry mints an org-scoped auth token with exactly the listed scopes. */
const sentryMinter: Minter = async ({ tier, bootstrapToken }) => {
  const t = tierSpec("sentry", tier);
  const org = process.env["SENTRY_ORG"];
  if (!org) throw new Error("SENTRY_ORG is not configured");
  const res = await fetch(`https://sentry.io/api/0/organizations/${org}/org-auth-tokens/`, {
    method: "POST",
    headers: { authorization: `Bearer ${bootstrapToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: `aegis-${tier}`, scopes: t.scopes.map((s) => s.name) }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await res.json()) as { token?: string; detail?: string };
  if (!res.ok || !payload.token) throw new Error(payload.detail ?? `Sentry returned ${res.status}`);
  return { value: payload.token, accountLabel: org };
};

/** Slack hands back the bot token from the install itself; nothing to mint. */
const slackMinter: Minter = async ({ bootstrapToken }) => ({
  value: bootstrapToken,
  accountLabel: process.env["SLACK_WORKSPACE"] ?? null,
});

const MINTERS: Record<string, Minter> = {
  cloudflare: cloudflareMinter,
  sentry: sentryMinter,
  slack: slackMinter,
};

export async function mint(input: { provider: string; tier: Tier; bootstrapToken: string }): Promise<Minted> {
  const minter = MINTERS[input.provider];
  if (!minter) {
    throw new Error(
      `${input.provider} cannot be minted automatically yet — run the generated script or follow the manual steps.`,
    );
  }
  const minted = await minter({ tier: input.tier, bootstrapToken: input.bootstrapToken });
  await record({
    provider: input.provider,
    tier: input.tier,
    step: "mint",
    message: `Minted a ${input.tier} credential limited to ${tierSpec(input.provider, input.tier).scopes.length} scope(s)`,
    meta: { scopes: tierSpec(input.provider, input.tier).scopes.map((s) => s.name) },
  });
  return minted;
}
