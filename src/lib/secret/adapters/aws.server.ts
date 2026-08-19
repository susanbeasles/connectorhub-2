import type { Custody, SecretBroker } from "../broker";
import { b64, unb64, type DataKey } from "../envelope";
import { Lease, type LeaseTerms } from "../lease";
import { refOf, refParse, type SecretRef } from "../ref";

/**
 * AWS custody. Two services, each doing the job it is actually built for:
 * Secrets Manager holds the tens of app-level secrets, and KMS mints and
 * unwraps the data keys that seal the thousands of per-user grants. The
 * key-encryption key is generated in the HSM and cannot be exported, so
 * possession of the database yields nothing without a `kms:Decrypt` call the
 * operator's IAM policy authorises and CloudTrail records.
 *
 * Nothing here holds an AWS credential. Every call resolves a short-lived
 * federated session from the execution role, so there is no long-lived key to
 * steal, rotate or leak.
 */

type Creds = { region: string; access: string; secret: string; session?: string };

async function session(): Promise<{ creds: Creds; kmsKeyArn: string }> {
  const { credentials, federationLoad } = await import("@/lib/deploy/aws/federation.server");
  const [creds, config] = await Promise.all([credentials(), federationLoad()]);
  if (!creds) throw new Error("AWS federation is not connected");
  if (!config?.kmsKeyArn) throw new Error("No KMS key is configured for secret custody");
  return { creds, kmsKeyArn: config.kmsKeyArn };
}

async function callJson<T>(
  creds: Creds,
  service: "kms" | "secretsmanager",
  target: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { awsFetch, awsReason } = await import("@/lib/deploy/aws/sigv4.server");
  const prefix = service === "kms" ? "TrentService" : "secretsmanager";
  const result = await awsFetch<T>(creds, {
    service,
    method: "POST",
    host: `${service}.${creds.region}.amazonaws.com`,
    path: "/",
    body: JSON.stringify(body),
    contentType: "application/x-amz-json-1.1",
    // The target header is part of the JSON-1.1 protocol, not the signature
    // surface this signer covers; it is appended by the service prefix below.
    query: { "x-amz-target": `${prefix}.${target}` },
  });
  if (!result.ok) throw new Error(`AWS ${target}: ${awsReason(result.body, result.status)}`);
  return result.body;
}

const PREFIX = "aegis/";

export function awsBroker(): SecretBroker {
  return {
    host: "aws",

    async resolve(ref: SecretRef, terms?: LeaseTerms) {
      const { locator, field } = refParse(ref);
      const { creds } = await session();
      const out = await callJson<{ SecretString?: string }>(creds, "secretsmanager", "GetSecretValue", {
        SecretId: locator,
      });
      const raw = out.SecretString ?? "";
      const value = field ? String((JSON.parse(raw) as Record<string, unknown>)[field] ?? "") : raw;
      return Lease.ofText(value, terms);
    },

    async put(name: string, value: string) {
      const id = `${PREFIX}${name}`;
      const { creds } = await session();
      try {
        await callJson(creds, "secretsmanager", "CreateSecret", { Name: id, SecretString: value });
      } catch {
        await callJson(creds, "secretsmanager", "PutSecretValue", { SecretId: id, SecretString: value });
      }
      return refOf("aws-sm", id);
    },

    async destroy(ref: SecretRef) {
      const { locator } = refParse(ref);
      const { creds } = await session();
      await callJson(creds, "secretsmanager", "DeleteSecret", {
        SecretId: locator,
        ForceDeleteWithoutRecovery: true,
      });
    },

    async sign(input: string, keyRef?: string | null) {
      // KMS signs with a key generated inside the HSM. There is no API that
      // returns its private half, so no amount of access to this process or to
      // the database yields the ability to forge a signature.
      const { creds, kmsKeyArn } = await session();
      const { kmsSigner } = await import("@/lib/signing/kms.server");
      const s = kmsSigner({ keyId: keyRef || kmsKeyArn, resolve: async () => creds });
      return { signature: await s.sign(input), keyId: await s.keyId(), alg: "ES256" as const };
    },

    async deriveDataKey(): Promise<DataKey> {
      const { creds, kmsKeyArn } = await session();
      const out = await callJson<{ Plaintext: string; CiphertextBlob: string }>(creds, "kms", "GenerateDataKey", {
        KeyId: kmsKeyArn,
        KeySpec: "AES_256",
      });
      return { plaintext: unb64(out.Plaintext), wrapped: unb64(out.CiphertextBlob) };
    },

    async unwrap(wrapped: Uint8Array) {
      const { creds, kmsKeyArn } = await session();
      const out = await callJson<{ Plaintext: string }>(creds, "kms", "Decrypt", {
        KeyId: kmsKeyArn,
        CiphertextBlob: b64(wrapped),
      });
      return unb64(out.Plaintext);
    },

    custody(): Custody {
      return {
        host: "aws",
        store: "AWS Secrets Manager in your account",
        kek: "KMS customer-managed key, non-exportable",
        signing: "KMS asymmetric key, generated in the HSM and non-exportable",
        hardware: true,
      };
    },
  };
}
