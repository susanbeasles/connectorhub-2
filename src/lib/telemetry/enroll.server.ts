import { sha256Hex } from "../crypto.server";
import { bodyDigest, jwkThumbprint, verifyProof } from "../dpop.server";
import type { Source } from "./ingest.server";

/**
 * Asymmetric provisioning for telemetry sources. The operator never handles a
 * credential: the broker issues a one-time, short-lived enrollment ticket, the
 * agent generates its own keypair in its own store, and only the public half
 * ever crosses the wire. From then on every batch carries a signed proof.
 */

const TICKET_TTL_MS = 15 * 60_000;

export type Enrollment = {
  sourceId: string;
  ticket: string;
  expiresAt: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function ticketValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const raw = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `enr_${raw}`;
}

/** Mint (or replace) the enrollment ticket for an asymmetric source. */
export async function issueEnrollment(sourceId: string): Promise<Enrollment> {
  const db = await admin();
  const ticket = ticketValue();
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS).toISOString();
  const { error } = await db
    .from("ingest_sources")
    .update({
      auth_mode: "asymmetric",
      enroll_hash: await sha256Hex(ticket),
      enroll_expires_at: expiresAt,
      public_jwk: null,
      jkt: null,
      enrolled_at: null,
    })
    .eq("id", sourceId);
  if (error) throw new Error(error.message);
  return { sourceId, ticket, expiresAt };
}

function publicOnly(jwk: JsonWebKey): JsonWebKey {
  if ("d" in jwk || "p" in jwk || "q" in jwk) throw new Error("Send the public key only");
  if (jwk.kty !== "EC" && jwk.kty !== "RSA") throw new Error("Unsupported key type");
  return jwk;
}

/**
 * Redeem a ticket by binding the agent's public key to the source. One shot:
 * the ticket is cleared on success and a second attempt finds nothing.
 */
export async function redeemEnrollment(input: {
  ticket: string;
  publicJwk: JsonWebKey;
}): Promise<{ sourceId: string; jkt: string }> {
  const db = await admin();
  const jwk = publicOnly(input.publicJwk);
  const { data } = await db
    .from("ingest_sources")
    .select("id, enroll_expires_at, disabled")
    .eq("enroll_hash", await sha256Hex(input.ticket.trim()))
    .maybeSingle();
  if (!data || data.disabled) throw new Error("Enrollment ticket is not valid");
  if (!data.enroll_expires_at || new Date(data.enroll_expires_at).getTime() < Date.now()) {
    throw new Error("Enrollment ticket has expired");
  }

  const jkt = await jwkThumbprint(jwk);
  const { error } = await db
    .from("ingest_sources")
    .update({
      public_jwk: jwk as never,
      jkt,
      enrolled_at: new Date().toISOString(),
      enroll_hash: null,
      enroll_expires_at: null,
    })
    .eq("id", data.id);
  if (error) throw new Error(error.message);
  return { sourceId: data.id as string, jkt };
}

/**
 * Authenticate a batch by proof alone. The proof is bound to the method, URL
 * and the exact payload, and is single-use — a captured request is inert.
 */
export async function resolveByProof(input: {
  proof: string | null;
  method: string;
  url: string;
  body: string;
}): Promise<Source | null> {
  if (!input.proof) return null;
  const verified = await verifyProof({
    proof: input.proof,
    method: input.method,
    url: input.url,
    bodyHash: await bodyDigest(input.body),
  });

  const db = await admin();
  const { data } = await db
    .from("ingest_sources")
    .select("id, name, server_id, redact_keys, disabled")
    .eq("jkt", verified.jkt)
    .maybeSingle();
  if (!data || data.disabled) return null;
  return data as Source;
}
