import { createServerFn } from "@tanstack/react-start";
import { requireOperator } from "@/lib/operator.middleware";
import type { Tier } from "@/lib/integrations/types";
import {
  AwsBootstrapInput,
  AwsFederationInput,
  EventsInput,
  ProvisionInput,
  ScriptInput,
  SecretInput,
  StartInput,
  TierInput,
} from "@/lib/integrations/input";

/**
 * The console's entire surface onto integrations. Handlers stay thin: every
 * decision lives in the integrations boundary so the click path, the script
 * path and the cron sweep cannot drift apart.
 */

export const listIntegrations = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .handler(async () => {
    const { states } = await import("@/lib/integrations/install.server");
    const { specs } = await import("@/lib/integrations/registry.server");
    const { available } = await import("@/lib/integrations/vault.server");
    const { expiring } = await import("@/lib/integrations/revoke.server");
    const catalog = specs().map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      summary: s.summary,
      oneClick: !!s.oauth,
      selfProvision: s.selfProvision ?? null,
      tiers: Object.entries(s.tiers).map(([tier, t]) => ({
        tier: tier as Tier,
        summary: t.summary,
        lifetime: t.lifetime,
        vault: t.vault,
        capabilities: t.capabilities,
        scopes: t.scopes,
        manual: t.manual,
        lastResort: t.lastResort ?? null,
      })),
    }));
    return {
      catalog,
      states: await states(),
      vaultConnected: await available(),
      expiring: await expiring(),
    };
  });

export const integrationScript = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => ScriptInput.parse(input))
  .handler(async ({ data }) => {
    const { renderScript, renderVaultScript } = await import("@/lib/integrations/script.server");
    return data.withVault
      ? renderVaultScript(data.provider, data.tier)
      : renderScript(data.provider, data.tier);
  });

export const startIntegration = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => StartInput.parse(input))
  .handler(async ({ data, context }) => {
    const { beginInstall } = await import("@/lib/integrations/install.server");
    return beginInstall({ ...data, actor: context.operator.email ?? context.userId });
  });

export const saveIntegrationSecret = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => SecretInput.parse(input))
  .handler(async ({ data, context }) => {
    const { acceptCredential } = await import("@/lib/integrations/install.server");
    const { assertStepUp } = await import("@/lib/integrations/stepup.server");
    await assertStepUp(data.tier, context);
    return acceptCredential({
      provider: data.provider,
      tier: data.tier,
      value: data.value,
      via: "manual",
      accountLabel: data.accountLabel ?? null,
      actor: context.operator.email ?? context.userId,
    });
  });

export const revokeIntegration = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => TierInput.parse(input))
  .handler(async ({ data, context }) => {
    const { revokeTier } = await import("@/lib/integrations/revoke.server");
    const { assertStepUp } = await import("@/lib/integrations/stepup.server");
    await assertStepUp(data.tier, context);
    return revokeTier({ ...data, actor: context.operator.email ?? context.userId });
  });

export const rotateIntegration = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => TierInput.parse(input))
  .handler(async ({ data, context }) => {
    const { rotate } = await import("@/lib/integrations/rotate.server");
    const { assertStepUp } = await import("@/lib/integrations/stepup.server");
    await assertStepUp(data.tier, context);
    return rotate({ ...data, actor: context.operator.email ?? context.userId });
  });

export const integrationEvents = createServerFn({ method: "GET" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => EventsInput.parse(input))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("integration_events")
      .select("id, provider, tier, step, level, message, actor, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.provider) query = query.eq("provider", data.provider);
    const { data: rows } = await query;
    return rows ?? [];
  });

export const provisionIntegration = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => ProvisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { provision } = await import("@/lib/integrations/provision.server");
    const { assertStepUp } = await import("@/lib/integrations/stepup.server");
    await assertStepUp("write", context);
    return provision({
      provider: data.provider,
      seed: data.seed.trim(),
      actor: context.operator.email ?? context.userId,
    });
  });

export const awsBootstrapScript = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => AwsBootstrapInput.parse(input))
  .handler(async ({ data }) => {
    const { bootstrapScript } = await import("@/lib/deploy/aws/federation.server");
    return { filename: "aegis-aws-bootstrap.sh", body: await bootstrapScript(data.region) };
  });

export const adoptAwsFederation = createServerFn({ method: "POST" })
  .middleware([requireOperator])
  .inputValidator((input: unknown) => AwsFederationInput.parse(input))
  .handler(async ({ data, context }) => {
    const { federationParse, federationStore } = await import("@/lib/deploy/aws/federation.server");
    const { assertStepUp } = await import("@/lib/integrations/stepup.server");
    await assertStepUp("write", context);
    const federation = federationParse(data.receipt);
    await federationStore(federation, context.operator.email ?? context.userId);
    const { state } = await import("@/lib/integrations/install.server");
    return state("aws");
  });
