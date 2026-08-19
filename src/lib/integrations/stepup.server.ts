import type { Tier } from "./types";

/**
 * Custody ceremonies, one per tier. The rule is uniform and enforced here so no
 * caller can pick a weaker one: reading is ordinary operator work, writing
 * needs a verified second factor, and anything destructive needs the owner to
 * have touched their hardware key moments ago.
 */

const TOUCH_WINDOW_MS = 5 * 60_000;

type Context = { userId: string; operator: { role: string; email: string | null } };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Was a hardware key actually used by this identity inside the window? */
async function touchedRecently(userId: string): Promise<boolean> {
  const db = await admin();
  const { data } = await db
    .from("webauthn_credentials")
    .select("last_used_at")
    .eq("user_id", userId)
    .order("last_used_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = data?.last_used_at ? new Date(data.last_used_at as string).getTime() : 0;
  return Date.now() - last < TOUCH_WINDOW_MS;
}

export async function assertStepUp(tier: Tier, context: Context): Promise<void> {
  if (tier === "read") return;

  const { mfaState } = await import("@/lib/mfa/factors.server");
  const { enrolled } = await mfaState(context.userId);
  if (!enrolled) {
    throw new Error("Enroll a second factor before handling write credentials");
  }

  if (tier === "write") return;

  if (context.operator.role !== "owner") {
    throw new Error("Only the owner can handle destructive credentials");
  }
  if (!(await touchedRecently(context.userId))) {
    throw new Error(
      "Touch your hardware key to unlock destructive credentials, then retry within five minutes",
    );
  }
}

/** What the console shows before it offers an action, so the ask is never a surprise. */
export async function stepUpFor(tier: Tier, context: Context) {
  try {
    await assertStepUp(tier, context);
    return { tier, satisfied: true, requirement: null as string | null };
  } catch (e) {
    return {
      tier,
      satisfied: false,
      requirement: e instanceof Error ? e.message : "Additional verification is required",
    };
  }
}
