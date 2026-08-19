import { Secret } from "@/lib/secret/index.server";
import type { Authority, GrantKind, OutboundRequest } from "@/lib/secret/authority";

/**
 * Turning a durable grant into permission for one outbound call.
 *
 * Every path here is chosen by strength, not convenience. Workload identity
 * and signed assertions authenticate by possession — the upstream receives a
 * signature or a platform-signed request and no reusable secret exists to
 * steal. Only the refresh path involves a bearer token at all, and there the
 * token is minted inside `authorize()`, attached to exactly one request, and
 * dropped with the call frame. It is never returned to a caller, never
 * persisted, and never held between operations.
 */

export type UpstreamConfigRow = {
  server_id: string;
  user_id: string;
  provider: string;
  token_url: string;
  client_id: string;
  encrypted_client_secret: string | null;
  audience: string | null;
  header_name: string;
  value_template: string;
  scopes: string[] | null;
  grant_kind: string;
  key_ref: string | null;
  aws_service: string | null;
};

export type GrantRow = {
  id: string;
  server_id: string;
  subject: string;
  sealed_grant: string | null;
  grant_kind: string;
  key_ref: string | null;
  rotations: number;
};

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
};

/**
 * Provider errors are summarised, never echoed. Token endpoints routinely
 * reflect the credential that failed back in the body, and that body would
 * otherwise reach a log line.
 */
function tokenError(status: number, body: string): Error {
  let code = "";
  try {
    code = String((JSON.parse(body) as { error?: string }).error ?? "");
  } catch {
    code = "";
  }
  return new Error(`Provider token endpoint returned ${status}${code ? ` (${code})` : ""}`);
}

async function postToken(cfg: UpstreamConfigRow, body: URLSearchParams): Promise<TokenResponse> {
  body.set("client_id", cfg.client_id);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  // The client secret is the one value a token endpoint may require in the
  // clear. It is borrowed for this request and overwritten as the scope ends.
  if (cfg.encrypted_client_secret) {
    headers["authorization"] = await Secret.use(
      cfg.encrypted_client_secret,
      (secret) => `Basic ${btoa(`${cfg.client_id}:${secret}`)}`,
    );
  }
  const res = await fetch(cfg.token_url, {
    method: "POST",
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw tokenError(res.status, text);
  return JSON.parse(text) as TokenResponse;
}

export { postToken };

function segment(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * RFC 7523 client assertion. The private key stays inside KMS (or, on hosts
 * without a key service, inside the sealed deployment key); this process only
 * ever holds the assertion, which is useless for anything but this one
 * audience and expiry.
 */
async function assertionGrant(cfg: UpstreamConfigRow, keyRef: string | null): Promise<TokenResponse> {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: cfg.client_id,
    sub: cfg.client_id,
    aud: cfg.audience || cfg.token_url,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 120,
  };
  const { signature, keyId } = await Secret.sign(
    `${segment({ alg: "ES256", typ: "JWT", kid: "pending" })}.${segment(claims)}`,
    keyRef,
  );
  const header = segment({ alg: "ES256", typ: "JWT", kid: keyId });
  const assertion = `${header}.${segment(claims)}.${signature}`;
  return postToken(
    cfg,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
      ...(cfg.scopes?.length ? { scope: cfg.scopes.join(" ") } : {}),
    }),
  );
}

/** SigV4 from the execution role: no secret exists on either side of the call. */
async function workloadAuthority(cfg: UpstreamConfigRow): Promise<Authority> {
  return {
    kind: "workload",
    async authorize(request: OutboundRequest) {
      const { credentials } = await import("@/lib/deploy/aws/federation.server");
      const { awsSignedHeaders } = await import("@/lib/deploy/aws/sigv4.server");
      const creds = await credentials();
      if (!creds) throw new Error("AWS workload identity is not available for this server");
      const url = new URL(request.url);
      return awsSignedHeaders(creds, {
        service: cfg.aws_service || "execute-api",
        method: request.method,
        host: url.hostname,
        path: url.pathname,
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.body === undefined ? {} : { contentType: "application/json" }),
      });
    },
    dispose() {
      // Nothing was decrypted and nothing was minted; there is nothing to wipe.
    },
  };
}

/**
 * The fallback, and the only kind where a reusable secret exists at all.
 * The exchange happens inside `authorize()` so the bearer's whole life is one
 * request. It costs a token-endpoint round trip per call; that cost is
 * accepted rather than softened with a cache.
 */
function bearerAuthority(
  kind: GrantKind,
  cfg: UpstreamConfigRow,
  mint: () => Promise<TokenResponse>,
): Authority {
  let spent = false;
  return {
    kind,
    async authorize() {
      if (spent) throw new Error("This authority has already been used");
      spent = true;
      const issued = await mint();
      const header = cfg.value_template.replace(/\{\{\s*secret\s*\}\}/g, issued.access_token);
      // The response object is the only other place the token exists; drop it
      // before returning so nothing but the header survives this frame.
      issued.access_token = "";
      return { [cfg.header_name.toLowerCase()]: header };
    },
    dispose() {
      spent = true;
    },
  };
}

export async function authorityFor(
  cfg: UpstreamConfigRow,
  grant: GrantRow,
  onRotate: (issued: TokenResponse, refresh: string) => Promise<void>,
): Promise<Authority> {
  switch (grant.grant_kind as GrantKind) {
    case "workload":
      return workloadAuthority(cfg);

    case "assertion":
      return bearerAuthority("assertion", cfg, () =>
        assertionGrant(cfg, grant.key_ref ?? cfg.key_ref),
      );

    case "mtls":
      // Called out explicitly rather than silently downgraded: neither the
      // Workers runtime nor Lambda's fetch exposes a client-certificate
      // channel, so an mTLS grant cannot be honoured from the broker today.
      throw new Error(
        "mTLS grants are not supported on this runtime — use an assertion or workload grant",
      );

    default:
      return bearerAuthority("refresh", cfg, async () => {
        if (!grant.sealed_grant) throw new Error("Provider grant is missing — reconnect the provider");
        return Secret.decryptForUse(grant.sealed_grant, async (refresh) => {
          const issued = await postToken(
            cfg,
            new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
          );
          await onRotate(issued, refresh);
          return issued;
        });
      });
  }
}
