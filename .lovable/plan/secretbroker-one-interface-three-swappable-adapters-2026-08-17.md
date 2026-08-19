# SecretBroker: one interface, three swappable adapters

Correcting the previous draft. There is no cross-vendor blending. The hosting
provider is chosen once — **Lovable**, **AWS**, or **Cloudflare** — and it
determines the secret store. Cloudflare's only role in an AWS deployment is DNS
and the optional Zero Trust tunnel.

Everything in the app calls one boundary. Choosing a host swaps one file.

## The boundary

`src/lib/secret/broker.ts` defines the interface; `src/lib/secret/index.server.ts`
loads exactly one adapter at runtime from the configured host. Nothing else in the
codebase imports an adapter, and nothing else calls `decryptSecret` again.

```ts
type SecretBroker = {
  resolve(ref: SecretRef): Promise<Lease>;   // fetch, leased, zeroized
  put(name: string, value: string): Promise<SecretRef>;
  destroy(ref: SecretRef): Promise<void>;
  dataKey(): Promise<DataKey>;               // envelope DEK, plaintext + wrapped
  unwrap(wrapped: Uint8Array): Promise<Uint8Array>;
  sign(input: string): Promise<string>;      // ES256, key held by the provider
};
```

A `SecretRef` is a URI, inert and safe to log or persist:
`aws-sm://aegis/prod/github#client_secret`, `cf-secrets://AEGIS_GITHUB`,
`op://aegis-write/github/client_secret`, `sealed://github/write`.

Adapters, one file each, nothing else provider-aware in the repo:

| Host | Store | Envelope KEK | Signing | Hot state |
|---|---|---|---|---|
| AWS | Secrets Manager | KMS CMK | KMS asymmetric (HSM) | DynamoDB + TTL |
| Cloudflare | Secrets Store binding | key from Secrets Store | software ES256 | D1 / Durable Object |
| Lovable | sealed in Postgres | env key | software ES256 | Postgres |

## How the app authenticates to its own store (the bootstrap)

No adapter stores a credential to reach its store.

- **AWS**: the execution IAM role. GitHub Actions assumes a deploy role via OIDC;
  the running function has a runtime role. Zero long-lived AWS keys exist anywhere,
  including in the app database.
- **Cloudflare**: Worker bindings, attached by the platform. The Worker holds no
  API token. The deploy token lives in GitHub Actions, not in the app.
- **Lovable**: an injected env key. Weakest of the three; the console reports it
  as degraded custody rather than implying parity.

## Two classes of secret

**Low cardinality, app-level** — provider client secrets, connector tokens, model
API keys. Tens of them. These live *inside* the provider's secret manager. The
database stores only the `SecretRef`.

**High cardinality, per-user** — upstream OAuth refresh tokens, one per user per
server, unbounded growth. These do **not** go in Secrets Manager; it is the wrong
tool at that cardinality. They get envelope encryption:

- `dataKey()` mints a DEK (AWS: `KMS:GenerateDataKey`; CF: derived from the
  Secrets Store KEK). Plaintext DEK exists only inside the request.
- Ciphertext and the wrapped DEK sit in the app database. A dump is inert without
  a `kms:Decrypt` call that IAM authorizes and CloudTrail records.
- **Access tokens are never persisted.** They are minted from the refresh token
  per request and die with it.
- **Broker-issued client tokens stay SHA-256 hashes only** — already true today.

## Memory lifetime

`resolve()` returns a `Lease`, never a string:

```ts
await using lease = await Secret.resolve(ref);
await lease.use(async (value) => { /* one call, one scope */ });
```

Backed by `Uint8Array`, decoded only at the point of use, overwritten on dispose or
throw. `lease({ uses, ttlMs })` bounds the multi-call case; whichever runs out first
disposes. No module-level plaintext caches, no plaintext on a returned object, no
value outliving the request. A single `redact()` runs ahead of every log and
telemetry writer.

## 1Password stays optional

It is an additional custody source for human-managed credentials, resolved by
`op://` reference at use time — never a runtime dependency. When it is not
connected, the host's own store is the fallback and nothing else in the app
changes: same references, same call sites, different scheme in the URI.

## The three credentials in play

Thirty users on three servers means ninety grants, and none of them is the same
object as any other:

1. **Client → broker**: DPoP-bound, short-lived, stored as a hash. The only
   credential an LLM client ever sees.
2. **Broker → provider, as that user**: the user's own refresh token, envelope
   encrypted. **Gap to fix**: `upstream_tokens` is keyed `server_id UNIQUE` — one
   grant shared by everyone. It must be `(server_id, subject)`.
3. **Broker → provider, as the app**: one credential per server, in the secret
   manager, for tools declared app-identity rather than user-identity.

## Tenancy (the original small ask)

Tenant handle derives from the verified domain in `domain_claims` — `sonarmd.com`
soft-defaults the handle to `sonarmd`, so 1Password resolves to
`sonarmd.1password.com` (blank falls back to `my.1password.com`). One global
override, plus a per-integration override. `src/lib/tenancy/tenancy.server.ts`
resolves provider → variable with that precedence and feeds the generated scripts,
Slack workspace, and GitHub org.

## Order of work

1. `SecretBroker` interface, `Lease`/zeroize, ref-URI parsing, `redact()` sweep.
2. Lovable adapter (wraps today's sealed-in-Postgres behaviour, unchanged
   semantics) so the boundary lands with zero behavioural change.
3. Repoint every `encrypted_*` reader/writer in the app through the broker; add
   `*_ref` columns.
4. Envelope encryption for per-user upstream tokens; re-key `upstream_tokens` to
   `(server_id, subject)`.
5. AWS adapter (Secrets Manager + KMS + DynamoDB), then Cloudflare adapter.
6. Tenancy resolver on the verified domain.
