import type { Database } from "@/integrations/supabase/types";

export type OperatorRole = Database["public"]["Enums"]["operator_role"];

export type Operator = {
  userId: string;
  email: string;
  role: OperatorRole;
  createdAt: string;
};

const RANK: Record<OperatorRole, number> = { viewer: 0, admin: 1, owner: 2 };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function toOperator(row: {
  user_id: string;
  email: string;
  role: OperatorRole;
  created_at: string;
}): Operator {
  return { userId: row.user_id, email: row.email, role: row.role, createdAt: row.created_at };
}

/**
 * The single trust decision for console access: an identity is an operator only
 * if it already holds a seat or redeems an invite the owner created. An
 * unclaimed instance seats nobody — ownership is taken through the bootstrap
 * ceremony, never by whoever signs in first.
 */
export async function resolveOperator(userId: string, email?: string): Promise<Operator | null> {
  const db = await admin();

  const seat = await db.from("operators").select("*").eq("user_id", userId).maybeSingle();
  if (seat.data) return toOperator(seat.data);
  if (!email) return null;



  const invite = await db
    .from("operator_invites")
    .select("*")
    .ilike("email", email)
    .maybeSingle();
  if (!invite.data) return null;

  const seated = await db
    .from("operators")
    .insert({
      user_id: userId,
      email,
      role: invite.data.role,
      created_by: invite.data.created_by,
    })
    .select("*")
    .maybeSingle();
  if (!seated.data) return null;
  await db.from("operator_invites").delete().eq("id", invite.data.id);
  return toOperator(seated.data);
}

function assertManager(actor: Operator) {
  if (RANK[actor.role] < RANK.admin) throw new Error("Forbidden: viewers cannot manage operators");
}

export async function operatorRoster(): Promise<{
  operators: Operator[];
  invites: { id: string; email: string; role: OperatorRole; createdAt: string }[];
}> {
  const db = await admin();
  const [seats, invites] = await Promise.all([
    db.from("operators").select("*").order("created_at"),
    db.from("operator_invites").select("*").order("created_at"),
  ]);
  return {
    operators: (seats.data ?? []).map(toOperator),
    invites: (invites.data ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.created_at,
    })),
  };
}

export async function inviteOperator(
  actor: Operator,
  input: { email: string; role: OperatorRole },
) {
  assertManager(actor);
  if (input.role === "owner") throw new Error("The broker has exactly one owner");
  const db = await admin();
  const { error } = await db
    .from("operator_invites")
    .insert({ email: input.email.toLowerCase(), role: input.role, created_by: actor.userId });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function revokeInvite(actor: Operator, id: string) {
  assertManager(actor);
  const db = await admin();
  await db.from("operator_invites").delete().eq("id", id);
  return { ok: true };
}

export async function revokeOperator(actor: Operator, userId: string) {
  assertManager(actor);
  if (userId === actor.userId) throw new Error("You cannot revoke your own seat");
  const db = await admin();
  const target = await db.from("operators").select("role").eq("user_id", userId).maybeSingle();
  if (!target.data) return { ok: true };
  if (target.data.role === "owner") throw new Error("The owner seat cannot be revoked");
  await db.from("operators").delete().eq("user_id", userId);
  return { ok: true };
}
