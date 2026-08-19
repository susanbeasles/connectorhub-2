/**
 * SigV4 for arbitrary AWS services. No SDK: the Worker runtime has fetch and
 * WebCrypto, and every provider that needs AWS goes through this one signer.
 */

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function sha256(body: Uint8Array | string): Promise<string> {
  const bytes = typeof body === "string" ? enc.encode(body) : body;
  return hex(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
  const material = key instanceof Uint8Array ? (key.slice().buffer as ArrayBuffer) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(value));
}

export interface AwsCredentials {
  region: string;
  access: string;
  secret: string;
  session?: string;
}

export interface SignedRequest {
  service: string;
  method: string;
  host: string;
  path: string;
  query?: Record<string, string>;
  body?: Uint8Array | string;
  contentType?: string;
}

/**
 * Signs one request and returns only the headers. Splitting this out lets the
 * secret broker authorize an outbound call it does not own — workload identity
 * with no credential ever reaching the caller.
 */
export async function awsSignedHeaders(
  creds: AwsCredentials,
  req: SignedRequest,
): Promise<Record<string, string>> {
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = stamp.slice(0, 8);
  const payload = req.body ?? "";
  const payloadHash = await sha256(payload);
  const query = Object.entries(req.query ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const headers: Record<string, string> = {
    host: req.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  if (req.contentType) headers["content-type"] = req.contentType;
  if (creds.session) headers["x-amz-security-token"] = creds.session;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = `${req.method}\n${req.path}\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${creds.region}/${req.service}/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${await sha256(canonical)}`;

  let signing: ArrayBuffer | Uint8Array = enc.encode(`AWS4${creds.secret}`);
  for (const part of [date, creds.region, req.service, "aws4_request"])
    signing = await hmac(signing, part);
  const signature = hex(await hmac(signing, toSign));

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${creds.access}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** Signs and sends one request; returns the parsed JSON body plus the raw status. */
export async function awsFetch<T = unknown>(
  creds: AwsCredentials,
  req: SignedRequest,
): Promise<{ ok: boolean; status: number; body: T }> {
  const payload = req.body ?? "";
  const headers = await awsSignedHeaders(creds, req);
  const query = Object.entries(req.query ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `https://${req.host}${req.path}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "DELETE" ? null : (payload as BodyInit),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: parsed as T };
}

/** AWS error envelopes vary; this pulls the human part out of any of them. */
export function awsReason(body: unknown, status: number): string {
  const b = body as { message?: string; Message?: string; raw?: string } | null;
  return b?.message ?? b?.Message ?? b?.raw ?? `HTTP ${status}`;
}
