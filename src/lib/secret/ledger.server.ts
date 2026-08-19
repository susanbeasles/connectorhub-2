import { sha256Hex } from "@/lib/crypto.server";
import { logEvent } from "@/lib/proxy.server";

/**
 * Credential custody ledger.
 *
 * Every moment a credential is created, rotated, minted or spent leaves one
 * line here. The line is deliberately shaped so that it can be read by anyone
 * operating the broker: it names the operation, the grant kind and the
 * outcome, and it never carries material. The one field that is redacted is
 * the subject — the person the credential acts for — which is recorded as a
 * stable digest so a reviewer can correlate a chain of operations without the
 * ledger disclosing whose account it followed.
 */

export type CustodyOperation =
  | "grant.issued"
  | "grant.rotated"
  | "grant.revoked"
  | "token.minted"
  | "token.spent"
  | "credential.used";

export type CustodyEntry = {
  userId: string;
  serverId: string;
  operation: CustodyOperation;
  /** Authority kind: workload | mtls | assertion | refresh | stored. */
  kind: string;
  outcome: "ok" | "denied" | "error";
  /** Redacted before storage; never written in the clear. */
  subject?: string | undefined;
  provider?: string | undefined;
  durationMs?: number | undefined;
  detail?: Record<string, unknown> | undefined;
};

const FAILING: Record<string, string> = { denied: "warn", error: "error" };

/** Stable, non-reversible handle for a subject. Empty subject = the app itself. */
export async function subjectDigest(subject: string | undefined): Promise<string> {
  if (!subject) return "self";
  return `sub_${(await sha256Hex(subject)).slice(0, 16)}`;
}

export async function recordCustody(entry: CustodyEntry): Promise<void> {
  await logEvent({
    user_id: entry.userId,
    server_id: entry.serverId,
    level: FAILING[entry.outcome] ?? "info",
    event: `custody.${entry.operation}`,
    message: `${entry.operation} (${entry.kind})`,
    ...(entry.durationMs === undefined ? {} : { duration_ms: entry.durationMs }),
    meta: {
      operation: entry.operation,
      kind: entry.kind,
      outcome: entry.outcome,
      subject: await subjectDigest(entry.subject),
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(entry.detail ?? {}),
    },
  });
}

/** Times a credential operation and records its outcome either way. */
export async function withCustody<T>(
  entry: Omit<CustodyEntry, "outcome" | "durationMs">,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    await recordCustody({ ...entry, outcome: "ok", durationMs: Date.now() - started });
    return result;
  } catch (error) {
    await recordCustody({
      ...entry,
      outcome: "error",
      durationMs: Date.now() - started,
      detail: { ...(entry.detail ?? {}), reason: (error as Error).message },
    });
    throw error;
  }
}

export const Custody = { record: recordCustody, with: withCustody, digest: subjectDigest };
