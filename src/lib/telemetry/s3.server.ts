/** Minimal SigV4 PUT. No SDK: the Worker runtime only needs fetch and WebCrypto. */

const enc = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (value: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));

async function hmac(key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> {
  const material = key instanceof Uint8Array ? new Uint8Array(key).slice().buffer : key;
  const cryptoKey = await crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(value));
}

export async function awsPut(input: {
  bucket: string;
  region: string;
  access: string;
  secret: string;
  key: string;
  body: string;
}): Promise<boolean> {
  const host = `${input.bucket}.s3.${input.region}.amazonaws.com`;
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = stamp.slice(0, 8);
  const payloadHash = await sha256(input.body);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const path = `/${input.key.split("/").map(encodeURIComponent).join("/")}`;
  const canonical = `PUT\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${await sha256(canonical)}`;

  let signing: ArrayBuffer | Uint8Array = enc.encode(`AWS4${input.secret}`);
  for (const part of [date, input.region, "s3", "aws4_request"]) signing = await hmac(signing, part);
  const signature = hex(await hmac(signing, toSign));

  const res = await fetch(`https://${host}${path}`, {
    method: "PUT",
    headers: {
      "x-amz-date": stamp,
      "x-amz-content-sha256": payloadHash,
      "content-type": "application/x-ndjson",
      authorization: `AWS4-HMAC-SHA256 Credential=${input.access}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: input.body,
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok;
}
