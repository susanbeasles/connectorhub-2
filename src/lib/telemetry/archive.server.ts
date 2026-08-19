import { sha256Hex } from "../crypto.server";

/**
 * Audit-grade long-term storage. Raw batches go to S3 when the bucket is
 * configured; otherwise they stay in the database so nothing is ever lost.
 * Either way the content hash is recorded, which is what makes the provenance
 * chain provable rather than merely readable.
 */

type Batch = { sourceId: string | null; events: unknown[] };

const S3_BUCKET = () => process.env["TELEMETRY_S3_BUCKET"];

async function putObject(key: string, body: string): Promise<boolean> {
  const { allows } = await import("@/lib/stage/stage.server");
  if (!(await allows("archive:s3"))) return false;

  const bucket = S3_BUCKET();
  const region = process.env["TELEMETRY_S3_REGION"] ?? "us-east-1";
  const access = process.env["TELEMETRY_S3_ACCESS_KEY_ID"];
  const secret = process.env["TELEMETRY_S3_SECRET_ACCESS_KEY"];
  if (!bucket || !access || !secret) return false;

  const { awsPut } = await import("./s3.server");
  return awsPut({ bucket, region, access, secret, key, body });
}

export async function archiveBatch(batch: Batch): Promise<void> {
  if (batch.events.length === 0) return;
  const body = batch.events.map((e) => JSON.stringify(e)).join("\n");
  const hash = await sha256Hex(body);
  const day = new Date().toISOString().slice(0, 10);
  const key = `telemetry/${batch.sourceId ?? "unknown"}/${day}/${hash.slice(0, 16)}.ndjson`;
  const offloaded = await putObject(key, body).catch(() => false);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("telemetry_archive").insert({
    source_id: batch.sourceId,
    day,
    object_key: key,
    event_count: batch.events.length,
    bytes: body.length,
    content_hash: hash,
    stored_in: offloaded ? "s3" : "database",
    batch: offloaded ? null : (batch.events as never),
  });
}
