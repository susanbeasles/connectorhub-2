/**
 * A secret reference is a URI. It is inert: it names where a value lives and
 * never carries the value's meaning, so it is safe to log, persist, and hand
 * across boundaries. Everything the application stores about a secret is one
 * of these strings.
 *
 * The scheme, not the caller, decides which adapter resolves it — which is why
 * a deployment can change hosts without rewriting a single stored row.
 */

export type Scheme = "aws-sm" | "cf-secrets" | "op" | "sealed";

export const SCHEMES: Scheme[] = ["aws-sm", "cf-secrets", "op", "sealed"];

export type SecretRef = string & { readonly __secretRef: unique symbol };

export type ParsedRef = {
  scheme: Scheme;
  /** Everything after the scheme, before the field. Adapter-specific. */
  locator: string;
  /** The named field inside the item, where the provider has such a concept. */
  field: string | null;
};

export function refOf(scheme: Scheme, locator: string, field?: string): SecretRef {
  return `${scheme}://${locator}${field ? `#${field}` : ""}` as SecretRef;
}

export function refParse(value: string): ParsedRef {
  const match = /^([a-z-]+):\/\/([^#]*)(?:#(.*))?$/.exec(value);
  const scheme = match?.[1] as Scheme | undefined;
  if (!match || !scheme || !SCHEMES.includes(scheme)) {
    throw new Error("Unrecognised secret reference");
  }
  return { scheme, locator: match[2] ?? "", field: match[3] ?? null };
}

export function isRef(value: string): boolean {
  try {
    refParse(value);
    return true;
  } catch {
    return false;
  }
}

/** What the console may show about a reference. Never the value, never the ciphertext. */
export function refLabel(value: string): string {
  const { scheme, locator, field } = refParse(value);
  const shown = scheme === "sealed" ? "sealed record" : locator;
  return field ? `${scheme}: ${shown} (${field})` : `${scheme}: ${shown}`;
}
