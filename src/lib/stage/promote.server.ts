import { stageRecord, stageSet, type StageActor } from "./stage.server";
import type { Stage } from "./capability";

/**
 * The migration itself: an ordered list of idempotent steps, each able to
 * describe what it would do before it does it. Re-running a completed step is a
 * no-op, so a failure is fixed and the run resumed rather than restarted.
 *
 * Ordering is deliberate. Identity and custody move first, compute second, and
 * the network gate last, so a Cloudflare mistake can never strand the operator
 * halfway through with no console to fix it from.
 */

export type StepResult = {
  id: string;
  title: string;
  status: "ok" | "skipped" | "failed" | "planned";
  detail: string;
};

export type RunReport = {
  stage: Stage;
  dryRun: boolean;
  steps: StepResult[];
  completed: boolean;
};

type Context = { origin: string; actor: StageActor };

type Step = {
  id: string;
  title: string;
  /** What this step would do, computed without changing anything. */
  plan: (ctx: Context) => Promise<string>;
  run: (ctx: Context) => Promise<Omit<StepResult, "id" | "title">>;
};

async function fleetBrokers() {
  const { Deploy } = await import("@/lib/deploy/index.server");
  return (await Deploy.fleet()).filter((b) => b.enabled);
}

const awsSession: Step = {
  id: "aws.session",
  title: "Verify AWS federation",
  async plan() {
    const { federationLoad } = await import("@/lib/deploy/aws/federation.server");
    const config = await federationLoad();
    return config ? `Assume ${config.roleArn}` : "No federated role registered";
  },
  async run() {
    const { credentials } = await import("@/lib/deploy/aws/federation.server");
    const creds = await credentials();
    if (!creds) throw new Error("AWS federation did not return a session");
    return { status: "ok", detail: `Short-lived session for ${creds.roleArn}` };
  },
};

const signingCustody: Step = {
  id: "signing.kms",
  title: "Move broker signing into KMS",
  async plan() {
    const { federationLoad } = await import("@/lib/deploy/aws/federation.server");
    return (await federationLoad())?.kmsKeyArn ?? "No KMS key registered";
  },
  async run() {
    const { brokerSigner, resetBrokerSigner } = await import("@/lib/signing/index.server");
    resetBrokerSigner();
    const custody = (await brokerSigner()).custody();
    if (custody !== "kms") throw new Error("Broker signing did not resolve to the KMS key");
    // Both public halves stay published, so tokens signed before the switch
    // keep verifying while they live out their remaining minutes.
    return { status: "ok", detail: "Broker signatures now originate in the HSM" };
  },
};

const secretCustody: Step = {
  id: "custody.vault",
  title: "File secrets into the tier vaults",
  async plan() {
    const sealed = await sealedCredentials();
    return sealed.length
      ? sealed.map((s) => `${s.provider}/${s.tier} → ${s.vault}`).join(", ")
      : "Nothing is held locally";
  },
  async run() {
    const { available, readSecret, storeSecret } = await import("@/lib/integrations/vault.server");
    if (!(await available())) throw new Error("The 1Password estate is not reachable");
    const sealed = await sealedCredentials();
    for (const entry of sealed) {
      const value = await readSecret(entry.provider, entry.tier);
      await storeSecret({ provider: entry.provider, tier: entry.tier, value });
    }
    return {
      status: sealed.length ? "ok" : "skipped",
      detail: sealed.length ? `${sealed.length} credential(s) moved into custody` : "Already in custody",
    };
  },
};

/** Credentials still sealed in the app database rather than filed in a vault. */
async function sealedCredentials() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { vaultFor } = await import("@/lib/integrations/vault.server");
  const { data } = await supabaseAdmin.from("integrations").select("provider, tiers");
  const out: { provider: string; tier: "read" | "write" | "destructive"; vault: string }[] = [];
  for (const row of data ?? []) {
    const provider = row.provider as string;
    // The custody provider's own identities are seeded by hand and stay sealed.
    if (provider === "1password") continue;
    const tiers = (row.tiers as Record<string, { itemId?: string }> | null) ?? {};
    for (const [tier, entry] of Object.entries(tiers)) {
      if (!entry || (entry.itemId && !entry.itemId.startsWith("sealed:"))) continue;
      const t = tier as "read" | "write" | "destructive";
      out.push({ provider, tier: t, vault: vaultFor(provider, t) });
    }
  }
  return out;
}

const runtimeFleet: Step = {
  id: "runtime.lambda",
  title: "Relaunch brokers on dedicated Lambdas",
  async plan() {
    const brokers = await fleetBrokers();
    const moving = brokers.filter((b) => b.desiredTarget !== "lambda");
    return moving.length ? moving.map((b) => b.name).join(", ") : "Every broker already runs on Lambda";
  },
  async run(ctx) {
    const { Deploy } = await import("@/lib/deploy/index.server");
    const brokers = await fleetBrokers();
    const moving = brokers.filter((b) => b.desiredTarget !== "lambda");
    // One at a time and probed before the next, so a bad image stops the run
    // with one broker affected rather than the whole fleet.
    for (const broker of moving) {
      await Deploy.launch(broker.serverId, "lambda", ctx.origin);
      const { status } = await Deploy.reconcile(broker.serverId, ctx.origin);
      if (status === "removed") throw new Error(`${broker.name} did not come up on Lambda`);
    }
    return {
      status: moving.length ? "ok" : "skipped",
      detail: moving.length ? `${moving.length} broker(s) relaunched` : "No move needed",
    };
  },
};

const archive: Step = {
  id: "archive.s3",
  title: "Archive the wire ledger to S3",
  async plan() {
    return process.env["TELEMETRY_S3_BUCKET"] ?? "No bucket configured";
  },
  async run() {
    const bucket = process.env["TELEMETRY_S3_BUCKET"];
    return bucket
      ? { status: "ok", detail: `New batches offload to ${bucket}` }
      : {
          status: "skipped",
          detail: "No bucket configured; the ledger stays in the database and nothing is lost",
        };
  },
};

const gate: Step = {
  id: "gate.enforce",
  title: "Require the private network",
  async plan() {
    const { accessConfig } = await import("@/lib/access/config.server");
    return accessConfig().teamDomain ?? "The edge gate is unconfigured";
  },
  async run(ctx) {
    const { policySet } = await import("@/lib/access/policy.server");
    await policySet("zero_trust", ctx.actor, "stage promotion");
    return { status: "ok", detail: "The console and proxy now require the private network" };
  },
};

const PROMOTION: Step[] = [awsSession, signingCustody, secretCustody, runtimeFleet, archive, gate];

const DEMOTION: Step[] = [
  {
    id: "gate.public",
    title: "Release the private network requirement",
    plan: async () => "Set the gate back to verify-and-report",
    async run(ctx) {
      const { policySet } = await import("@/lib/access/policy.server");
      await policySet("public", ctx.actor, "stage demotion");
      return { status: "ok", detail: "The gate verifies and reports without blocking" };
    },
  },
  {
    id: "runtime.inline",
    title: "Bring brokers back in-app",
    async plan() {
      const brokers = (await fleetBrokers()).filter((b) => b.desiredTarget !== "inline");
      return brokers.length ? brokers.map((b) => b.name).join(", ") : "Every broker already runs in-app";
    },
    async run(ctx) {
      const { Deploy } = await import("@/lib/deploy/index.server");
      const brokers = (await fleetBrokers()).filter((b) => b.desiredTarget !== "inline");
      for (const broker of brokers) await Deploy.launch(broker.serverId, "inline", ctx.origin);
      return {
        status: brokers.length ? "ok" : "skipped",
        detail: brokers.length ? `${brokers.length} broker(s) returned in-app` : "No move needed",
      };
    },
  },
  {
    id: "signing.sealed",
    title: "Return signing to the sealed key",
    plan: async () => "Broker signatures fall back to the sealed key",
    async run() {
      const { resetBrokerSigner } = await import("@/lib/signing/index.server");
      resetBrokerSigner();
      // The KMS key is left exactly where it is; demotion re-points, never destroys.
      return { status: "ok", detail: "Your KMS key is untouched and reused on the next promotion" };
    },
  },
];

function stepsFor(stage: Stage): Step[] {
  return stage === "production" ? PROMOTION : DEMOTION;
}

/** What a run would do, computed without changing anything. */
export async function stagePlan(stage: Stage, ctx: Context): Promise<RunReport> {
  const steps = await Promise.all(
    stepsFor(stage).map(async (step) => ({
      id: step.id,
      title: step.title,
      status: "planned" as const,
      detail: await step.plan(ctx).catch((e: Error) => e.message),
    })),
  );
  return { stage, dryRun: true, steps, completed: false };
}

/**
 * Move to a stage and run its steps. The stage is set first so every boundary
 * is already answering for the target stage while the steps execute; a failure
 * stops the run and leaves the completed steps in place to resume from.
 */
export async function stageRun(
  stage: Stage,
  ctx: Context,
  acknowledgements: string[] = [],
): Promise<RunReport> {
  await stageSet(stage, ctx.actor, acknowledgements);
  await stageRecord({ stage, step: "stage.set", status: "ok", detail: stage, actor: ctx.actor });

  const results: StepResult[] = [];
  for (const step of stepsFor(stage)) {
    try {
      const outcome = await step.run(ctx);
      results.push({ id: step.id, title: step.title, ...outcome });
      await stageRecord({ stage, step: step.id, status: outcome.status, detail: outcome.detail, actor: ctx.actor });
    } catch (e) {
      const detail = (e as Error).message;
      results.push({ id: step.id, title: step.title, status: "failed", detail });
      await stageRecord({ stage, step: step.id, status: "failed", detail, actor: ctx.actor });
      return { stage, dryRun: false, steps: results, completed: false };
    }
  }
  return { stage, dryRun: false, steps: results, completed: true };
}
