import { permits, type Capability, type Stage } from "./capability";

/**
 * Custodian of the rollout stage. Nothing else reads the table, and nothing
 * else decides what a stage permits — callers ask `allows()` and get a plain
 * boolean, so a boundary can never invent its own interpretation.
 *
 * Reads fail open to `sandbox`: if the store that holds the answer is
 * unreachable, the safe default is the stage that touches nobody else's
 * infrastructure.
 */

export type StageActor = { userId: string; email: string | null };

export type StageState = {
  stage: Stage;
  acknowledgements: string[];
  updatedAt: string | null;
  updatedBy: string | null;
};

const FALLBACK: StageState = {
  stage: "sandbox",
  acknowledgements: [],
  updatedAt: null,
  updatedBy: null,
};

const CACHE_MS = 10_000;
let cached: { value: StageState; at: number } | null = null;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function stageRead(): Promise<StageState> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const client = await db();
    const { data } = await client
      .from("deployment_stage")
      .select("stage, acknowledgements, updated_at, updated_by")
      .eq("id", "singleton")
      .maybeSingle();
    const value: StageState = data
      ? {
          stage: (data.stage as Stage) ?? "sandbox",
          acknowledgements: (data.acknowledgements as string[]) ?? [],
          updatedAt: (data.updated_at as string) ?? null,
          updatedBy: (data.updated_by as string) ?? null,
        }
      : FALLBACK;
    cached = { value, at: Date.now() };
    return value;
  } catch {
    return FALLBACK;
  }
}

/** The one question every boundary asks. */
export async function allows(capability: Capability): Promise<boolean> {
  return permits((await stageRead()).stage, capability);
}

export async function stageSet(
  stage: Stage,
  actor: StageActor,
  acknowledgements: string[] = [],
): Promise<StageState> {
  const client = await db();
  await client
    .from("deployment_stage")
    .upsert(
      {
        id: "singleton",
        stage,
        acknowledgements: acknowledgements as never,
        updated_by: actor.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  cached = null;
  const { resetBrokerSigner } = await import("@/lib/signing/index.server");
  resetBrokerSigner();
  return stageRead();
}

export async function stageRecord(event: {
  stage: Stage;
  step: string;
  status: "ok" | "skipped" | "failed" | "planned";
  detail?: string;
  dryRun?: boolean;
  actor?: StageActor;
}): Promise<void> {
  const client = await db();
  await client.from("stage_events").insert({
    stage: event.stage,
    step: event.step,
    status: event.status,
    detail: event.detail ?? "",
    dry_run: event.dryRun ?? false,
    actor: event.actor?.userId ?? null,
    actor_email: event.actor?.email ?? null,
  });
}

export async function stageHistory(limit = 30) {
  try {
    const client = await db();
    const { data } = await client
      .from("stage_events")
      .select("id, stage, step, status, detail, dry_run, actor_email, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      stage: row.stage as Stage,
      step: row.step as string,
      status: row.status as string,
      detail: row.detail as string,
      dryRun: row.dry_run as boolean,
      actorEmail: (row.actor_email as string) ?? null,
      createdAt: row.created_at as string,
    }));
  } catch {
    return [];
  }
}
