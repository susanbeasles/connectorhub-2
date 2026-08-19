/**
 * Token accounting for the model side of an MCP exchange.
 *
 * Nothing here calls a tokenizer: the broker never sees the model's own
 * encoder, so it estimates with the industry-standard ~4 characters per token
 * heuristic and reports the character count alongside it so an operator can
 * always audit the estimate against their provider's invoice.
 */

const CHARS_PER_TOKEN = 4;

export type TokenSplit = {
  /** What the model spent writing the request into our broker. */
  inbound: number;
  /** What the model must read back — the result we hand it. */
  outbound: number;
  /** What the upstream provider's raw payload cost before we shaped it. */
  upstream: number;
  total: number;
};

export function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function countTokens(value: unknown): number {
  const chars = textOf(value).length;
  return chars === 0 ? 0 : Math.ceil(chars / CHARS_PER_TOKEN);
}

export function splitTokens(parts: {
  inbound?: unknown;
  outbound?: unknown;
  upstream?: unknown;
}): TokenSplit {
  const inbound = countTokens(parts.inbound);
  const outbound = countTokens(parts.outbound);
  const upstream = countTokens(parts.upstream);
  return { inbound, outbound, upstream, total: inbound + outbound };
}
