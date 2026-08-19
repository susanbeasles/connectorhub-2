/**
 * Nothing sensitive is ever allowed to land in the ledger. Every header and
 * body passes through here on its way to storage, so a single change to this
 * list changes what the broker is capable of writing down anywhere.
 */

const SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "dpop",
  "x-api-key",
  "api-key",
  "x-telemetry-key",
  "x-broker-secret",
  "x-amz-security-token",
]);


const SECRET_KEYS =
  /(secret|password|passwd|token|api[_-]?key|authorization|credential|private|assertion|signature|refresh|bearer|jwk)/i;


const MAX_TEXT = 20_000;

export function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    out[name] = SECRET_HEADERS.has(name) ? `[redacted ${value.length} chars]` : value.slice(0, 2000);
  });
  return out;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return "[depth limit]";
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redactValue(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return truncate(value);
  return value;
}

export function truncate(text: string, max = MAX_TEXT): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

/** Best-effort client address: Cloudflare first, then the standard proxy chain. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return headers.get("cf-connecting-ip") ?? forwarded ?? headers.get("x-real-ip") ?? "";
}
