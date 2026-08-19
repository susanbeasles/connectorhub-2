# Zero reusable credentials: capability broker, no persisted access tokens

## The violation, named

`storeTokens()` writes `encrypted_access` — the upstream access token — into
`upstream_tokens` on every code redemption and every refresh. `upstreamHeaders()`
then returns a fully-formed `Authorization` header string to `proxy.server.ts`,
so application code holds a reusable bearer for the whole outbound call and
beyond. Both go. The row keeps only the durable grant; the broker performs the
call-time authorization itself.

## 1. Schema: grants, not tokens

Rename `upstream_tokens` -> `upstream_grants` and drop the access column entirely.

```
upstream_grants(
  server_id, subject,            -- one grant per person per server, no fallback
  sealed_grant text,             -- ciphertext + wrapped DEK + metadata (refresh grant)
  grant_kind text,               -- 'refresh' | 'assertion' | 'workload' | 'mtls'
  key_ref text,                  -- non-exportable signing key for assertion kinds
  scope, expires_at,             -- expiry of the *grant*, not of any token
  rotated_at, rotations
)
```

No `encrypted_access`, no `access_expires_at`, no cache table, no KV entry.
`grant_kind = 'workload' | 'assertion' | 'mtls'` rows carry no secret at all —
only a `key_ref` naming a key the broker can sign with but never read.
`upstreamStatus` reports grant health from `expires_at`/`rotations`; it stops
reporting anything about an access token because none exists.

Migration drops the column outright (existing access ciphertext is discarded,
not migrated) and keeps the `(server_id, subject)` unique index.

## 2. SecretBroker becomes capability-first

`resolve()` demotes to the documented fallback. The preferred surface, added to
`src/lib/secret/broker.ts` and every adapter:

```ts
sign(keyRef: KeyRef, payload: Uint8Array, alg): Promise<Signature>  // key never leaves the boundary
deriveDataKey(): Promise<DataKey>                                    // existing dataKey(), renamed
decryptForUse<T>(sealed, use: (bytes) => T): Promise<T>              // plaintext scoped to `use`
exchangeGrant(req: GrantExchange): Promise<Authorized>               // grant -> upstream call authority
destroy(ref): Promise<void>
resolve(ref, terms): Promise<Lease>                                  // fallback, for provider client secrets only
```

`Authorized` is deliberately not a token: it is `{ apply(init: RequestInit): RequestInit }`
plus a `dispose()`. The caller passes its request, gets a request back, and
never sees the credential. `exchangeGrant` runs the token endpoint call, applies
the header, and zeroizes on dispose — one operation, one plaintext window.

Adapter mapping for `sign`: AWS `KMS:Sign` (non-exportable CMK), Cloudflare
software ES256 from Secrets Store (reported `hardware: false`), Lovable software
key (reported degraded). No adapter ever returns private-key bytes.

## 3. The outbound path

`upstreamHeaders()` is deleted. `proxy.server.ts` calls:

```ts
await Upstream.authorize(serverId, subject, async (authorized) => fetch(url, authorized.apply(init)))
```

Inside `authorize`, by `grant_kind`, in preference order:

1. **workload / platform binding** — SigV4 from the execution role, or a Worker
   binding. Nothing decrypted, nothing exchanged, no bearer.
2. **assertion (private_key_jwt / JWT-bearer)** — broker builds the assertion
   header+claims, `Secret.sign(keyRef, ...)` signs it in KMS, the assertion goes
   to the token endpoint. Private key bytes never enter memory.
3. **mTLS** — client-cert bound channel where the provider supports it.
4. **refresh grant (last resort)** — `decryptForUse` opens the sealed refresh
   grant inside one callback, posts to the token endpoint, applies the returned
   access token to *this one request*, then zeroizes both. The access token is
   never returned upward, never stored, never logged. Rotated refresh tokens are
   re-sealed in place; that is the only thing written.

Every path is per-`subject`. A missing grant is an error, never a fall-through
to another subject's or to the app identity.

## 4. Explicit cost, no caching

Kind 4 costs one token-endpoint round trip per upstream request (typically
80-250 ms). That is accepted and documented in the custody matrix rather than
softened with a cache. No LRU, no module global, no Durable Object, no request-
coalescing that outlives a single operation.

## 5. Leak surfaces closed

- `redact()` sweep applied ahead of `logEvent`, wire-ledger writes and telemetry;
  `access_token`, `refresh_token`, `assertion`, `client_secret`, `authorization`
  keys are dropped before serialization.
- Token-endpoint error bodies are truncated to a status + provider error code;
  the current `text.slice(0, 200)` can echo credential material.
- `Lease` gains a dev-mode assertion that a leased value is not returned out of
  its `use()` scope.

## 6. Custody matrix, shipped as docs

`docs/CUSTODY.md`, one row per host x upstream auth kind, answering exactly the
ten questions asked: reusable secret exists; app code sees it; exportable;
plaintext in app memory; max plaintext lifetime; written to disk; in env;
cached across operations; replaceable by workload identity or asymmetric proof;
audit trail (CloudTrail for KMS/ASM, Cloudflare audit log, `audit_logs` rows for
every `exchangeGrant` and `sign`).

Named exceptions up front: providers with no `private_key_jwt` and no workload
identity (most consumer OAuth — Slack, Notion, Google user-scoped) are kind 4
and are listed as such. `VAULT_ENCRYPTION_KEY` on the Lovable host is the one
env-resident secret in the system, and is reported as degraded custody, not
parity.

## Order of work

1. Broker interface + adapter methods (`sign`, `exchangeGrant`, `decryptForUse`).
2. `Upstream.authorize` callback path; delete `upstreamHeaders`; repoint proxy.
3. Migration: `upstream_grants`, drop `encrypted_access`, add `grant_kind`/`key_ref`.
4. Assertion (private_key_jwt) and workload kinds + console UI to pick the kind.
5. `redact()` sweep, error-body truncation, lease escape assertion.
6. `docs/CUSTODY.md` matrix.
