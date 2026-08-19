import { sha256Hex } from "../crypto.server";
import { awsFetch, awsReason, type AwsCredentials } from "./aws/sigv4.server";
import { toBase64, zipFiles } from "./aws/zip";
import type { DeploySpec, Deployment, Provider } from "./types";

/**
 * AWS Lambda: one function per broker, each with its own execution environment
 * and its own public function URL. The function holds no credentials — it is a
 * thin forwarder into the broker origin, where every policy still applies.
 */

type Config = AwsCredentials & { roleArn: string };

async function config(): Promise<Config | null> {
  const { credentials } = await import("./aws/federation.server");
  return credentials();
}

function functionName(spec: DeploySpec) {
  return `aegis-${spec.slug}-${spec.serverId.slice(0, 8)}`.slice(0, 64);
}

function source(spec: DeploySpec) {
  return `const ORIGIN = ${JSON.stringify(spec.origin)};
const SERVER_ID = ${JSON.stringify(spec.serverId)};
export const handler = async (event) => {
  const headers = { ...(event.headers ?? {}) };
  delete headers.host;
  headers["x-aegis-edge"] = SERVER_ID;
  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : event.body
    : undefined;
  const method = event.requestContext?.http?.method ?? "POST";
  const res = await fetch(ORIGIN + "/api/public/mcp/" + SERVER_ID, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
  return {
    statusCode: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    body: await res.text(),
  };
};
`;
}

function host(cfg: Config) {
  return `lambda.${cfg.region}.amazonaws.com`;
}

async function api<T = unknown>(
  cfg: Config,
  method: string,
  path: string,
  body?: unknown,
  tolerate: number[] = [],
): Promise<T> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const res = await awsFetch<T>(cfg, {
    service: "lambda",
    method,
    host: host(cfg),
    path,
    body: payload,
    ...(payload ? { contentType: "application/json" } : {}),
  });
  if (!res.ok && !tolerate.includes(res.status)) {
    throw new Error(`Lambda: ${awsReason(res.body, res.status)}`);
  }
  return res.body;
}

async function upsertFunction(cfg: Config, name: string, zipB64: string) {
  const exists = await awsFetch(cfg, {
    service: "lambda",
    method: "GET",
    host: host(cfg),
    path: `/2015-03-31/functions/${name}`,
  });

  if (exists.ok) {
    await api(cfg, "PUT", `/2015-03-31/functions/${name}/code`, { ZipFile: zipB64 });
    return;
  }

  await api(cfg, "POST", "/2015-03-31/functions", {
    FunctionName: name,
    Runtime: "nodejs22.x",
    Role: cfg.roleArn,
    Handler: "index.handler",
    Timeout: 30,
    MemorySize: 256,
    Architectures: ["arm64"],
    PackageType: "Zip",
    Code: { ZipFile: zipB64 },
  });
}

const BRIDGE_NAME = "aegis-onepassword-adapter";

function bridgeSource() {
  return `import * as sdk from "@1password/sdk";
const clientFor = (token) => sdk.createClient({ auth: token, integrationName: "Aegis", integrationVersion: "1.0.0" });
const resolveVault = async (client, vault) => {
  const match = (await client.vaults.list()).find(({ id, title }) => id === vault || title === vault);
  if (!match) throw new Error("The service account cannot see the requested vault");
  return match.id;
};
const fieldValue = (item) => item.fields?.find((field) => field.id === "credential")?.value
  ?? item.fields?.find((field) => /credential|token|password/i.test(field.title ?? ""))?.value
  ?? item.fields?.find((field) => field.fieldType === sdk.ItemFieldType.Concealed && field.value)?.value;
export const handler = async (event) => {
  const { token, action, vaultId, itemId, input } = event ?? {};
  if (typeof token !== "string" || token.length < 20) throw new Error("A service-account token is required");
  const client = await clientFor(token);
  if (action === "vault.list") return (await client.vaults.list()).map(({ id, title }) => ({ id, name: title }));
  const resolvedVault = vaultId ? await resolveVault(client, vaultId) : null;
  if (action === "item.list") return (await client.items.list(resolvedVault)).map(({ id, title }) => ({ id, title }));
  if (action === "item.read") {
    const item = await client.items.get(resolvedVault, itemId);
    const value = fieldValue(item);
    if (!value) throw new Error("The item has no credential field");
    return { id: item.id, value };
  }
  if (action === "item.create") {
    const item = await client.items.create({
      category: sdk.ItemCategory.ApiCredentials,
      vaultId: resolvedVault,
      title: input.title,
      fields: [
        { id: "credential", title: "credential", fieldType: sdk.ItemFieldType.Concealed, value: input.value },
        { id: "provider", title: "provider", fieldType: sdk.ItemFieldType.Text, value: input.provider },
        { id: "tier", title: "tier", fieldType: sdk.ItemFieldType.Text, value: input.tier },
      ],
    });
    return { id: item.id };
  }
  if (action === "item.delete") { await client.items.delete(resolvedVault, itemId); return { deleted: true }; }
  throw new Error("Unsupported adapter action");
};
`;
}

async function waitForActive(cfg: Config, name: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await awsFetch<{ Configuration?: { State?: string; LastUpdateStatus?: string } }>(cfg, {
      service: "lambda",
      method: "GET",
      host: host(cfg),
      path: `/2015-03-31/functions/${name}`,
    });
    const status = result.body.Configuration;
    if (result.ok && status?.State === "Active" && status.LastUpdateStatus !== "InProgress") return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The private 1Password adapter did not become ready");
}

export async function ensureOnePasswordBridge(): Promise<void> {
  const cfg = await config();
  if (!cfg) throw new Error("AWS is not connected. Run the keyless CloudShell setup in the AWS integration, then adopt 1Password again.");
  const { onePasswordPackages } = await import("./aws/package.server");
  const code = bridgeSource();
  const zip = zipFiles([{ name: "index.mjs", content: code }, ...(await onePasswordPackages())]);
  await upsertFunction(cfg, BRIDGE_NAME, toBase64(zip));
  await waitForActive(cfg, BRIDGE_NAME);
}

export async function invokeOnePasswordBridge<T>(payload: Record<string, unknown>): Promise<T> {
  const cfg = await config();
  if (!cfg) throw new Error("AWS is not configured. The private 1Password adapter is unavailable.");
  const result = await api<T & { errorType?: string; errorMessage?: string }>(
    cfg,
    "POST",
    `/2015-03-31/functions/${BRIDGE_NAME}/invocations`,
    payload,
  );
  if (result?.errorType || result?.errorMessage) throw new Error(result.errorMessage ?? "1Password adapter failed");
  return result;
}

async function ensureUrl(cfg: Config, name: string): Promise<string | null> {
  const existing = await awsFetch<{ FunctionUrl?: string }>(cfg, {
    service: "lambda",
    method: "GET",
    host: host(cfg),
    path: `/2021-10-31/functions/${name}/url`,
  });
  if (existing.ok && existing.body.FunctionUrl) return existing.body.FunctionUrl;

  await api(
    cfg,
    "POST",
    `/2015-03-31/functions/${name}/policy`,
    {
      StatementId: "aegis-public-invoke",
      Action: "lambda:InvokeFunctionUrl",
      Principal: "*",
      FunctionUrlAuthType: "NONE",
    },
    [409],
  );

  const created = await api<{ FunctionUrl?: string }>(
    cfg,
    "POST",
    `/2021-10-31/functions/${name}/url`,
    { AuthType: "NONE", InvokeMode: "BUFFERED" },
  );
  return created.FunctionUrl ?? null;
}

export const lambdaProvider: Provider = {
  target: "lambda",
  available: () => true,

  async launch(spec: DeploySpec) {
    const cfg = await config();
    if (!cfg) throw new Error("AWS is not connected — run the keyless CloudShell setup from Integrations.");
    const name = functionName(spec);
    const code = source(spec);
    const zip = toBase64(zipFiles([{ name: "index.mjs", content: code }]));

    await upsertFunction(cfg, name, zip);
    const url = await ensureUrl(cfg, name);

    return { workerName: name, routeUrl: url, specDigest: await sha256Hex(code) };
  },

  async teardown(spec: DeploySpec) {
    const cfg = await config();
    if (!cfg) return;
    const name = functionName(spec);
    await api(cfg, "DELETE", `/2021-10-31/functions/${name}/url`, undefined, [404]).catch(
      () => undefined,
    );
    await api(cfg, "DELETE", `/2015-03-31/functions/${name}`, undefined, [404]).catch(
      () => undefined,
    );
  },

  async probe(spec: DeploySpec, deployment: Deployment) {
    const cfg = await config();
    if (!cfg) return "failed";
    if ((await sha256Hex(source(spec))) !== deployment.specDigest) return "degraded";
    const res = await awsFetch<{ Configuration?: { State?: string } }>(cfg, {
      service: "lambda",
      method: "GET",
      host: host(cfg),
      path: `/2015-03-31/functions/${functionName(spec)}`,
    });
    if (!res.ok) return "failed";
    const state = res.body.Configuration?.State;
    return state === "Active" || state === "Pending" ? "live" : "degraded";
  },
};
