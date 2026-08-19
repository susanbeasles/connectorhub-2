/**
 * An authority is permission to make one outbound call — not a credential.
 *
 * Application code never receives a bearer token, a signature key or a secret
 * string from this boundary. It describes the request it is about to send and
 * receives back the headers that authorize exactly that request. Whatever
 * plaintext was needed to produce them lives inside the broker for the length
 * of that computation and is overwritten when the authority is disposed.
 */

export type OutboundRequest = {
  method: string;
  url: string;
  /** Body as it will go on the wire; needed by signature schemes that cover it. */
  body?: string | undefined;
};

export type Authority = {
  /** How the upstream was satisfied, for the ledger. Never contains material. */
  readonly kind: GrantKind;
  /** Headers that authorize this one request. */
  authorize(request: OutboundRequest): Promise<Record<string, string>>;
  /** Overwrite anything the authority is still holding. Idempotent. */
  dispose(): void;
};

/**
 * Preference order, strongest first. `refresh` is the fallback of last resort
 * and is the only kind where a reusable secret exists at all.
 */
export const GRANT_KINDS = ["workload", "mtls", "assertion", "refresh"] as const;

export type GrantKind = (typeof GRANT_KINDS)[number];

export function isGrantKind(value: string): value is GrantKind {
  return (GRANT_KINDS as readonly string[]).includes(value);
}

/** An authority backed by a header the broker computed and will now forget. */
export function headerAuthority(
  kind: GrantKind,
  name: string,
  build: () => Promise<string> | string,
): Authority {
  let spent = false;
  return {
    kind,
    async authorize() {
      if (spent) throw new Error("This authority has already been used");
      spent = true;
      return { [name.toLowerCase()]: await build() };
    },
    dispose() {
      spent = true;
    },
  };
}
