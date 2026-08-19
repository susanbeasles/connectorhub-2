import { z } from "zod";

/**
 * Runtime contracts for every operator call into the integrations boundary.
 * Handlers stay thin, so the shape of anything crossing the wire is decided
 * here once and nowhere else.
 */

const tier = z.enum(["read", "write", "destructive"]);
const provider = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "provider must be a lowercase slug");

export const ScriptInput = z.object({ provider, tier, withVault: z.boolean() });

export const StartInput = z.object({ provider, tier, origin: z.string().trim().url().max(2048) });

export const SecretInput = z.object({
  provider,
  tier,
  value: z.string().min(1).max(8192),
  accountLabel: z.string().trim().max(128).optional(),
});

export const TierInput = z.object({ provider, tier });

export const EventsInput = z.object({ provider: provider.optional() });

export const ProvisionInput = z.object({
  provider,
  seed: z.string().min(1).max(8192),
});

export const AwsBootstrapInput = z.object({
  region: z.string().regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/),
});

export const AwsFederationInput = z.object({
  receipt: z.string().trim().min(1).max(4096),
});
