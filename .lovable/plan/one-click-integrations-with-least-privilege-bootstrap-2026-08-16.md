# One-click integrations with least-privilege bootstrap

Goal: from an empty portal, one click per provider performs an admin OAuth handshake, mints narrowly-scoped machine credentials, files them into the right 1Password vault, then revokes the bootstrap grant. Nothing long-lived, nothing broader than the job needs.

## The integrations plane (new boundary)

A single generic layer, `src/lib/integrations/`, owns every provider. Providers are data, not code branches.

```text
integrations/
  types.ts            IntegrationSpec, Grant, Credential, Capability
  registry.server.ts  the provider table (one entry per provider)
  install.server.ts   the universal install pipeline
  revoke.server.ts    bootstrap-grant destruction + credential rotation
  vault.server.ts     1Password Connect/Service-Account client
  providers/*.ts      per-provider spec: scopes, mint calls, revoke call
integrations.functions.ts   operator-gated server functions
```

Install pipeline (identical for every provider):

```text
1 consent   → OAuth 2.0 authorization code + PKCE, admin scopes only
2 mint      → provider API call creating scoped machine credentials
3 classify  → each credential tagged read | write | destructive
4 store     → written to the matching 1Password vault, never to our DB
5 reference → DB keeps only vault item id, scope set, expiry, digest
6 revoke    → bootstrap OAuth grant revoked at the provider, token discarded
7 attest    → signed attestation row recording exactly what was granted
```

## Credential tiers

Every provider spec declares capabilities in three tiers, minted as separate credentials with separate identities:

| Tier | Example | Vault | Unlock |
| --- | --- | --- | --- |
| read | inspect Workers, list buckets, read repos | `aegis-read` | service account, online |
| write | deploy Worker, push DNS, create issue | `aegis-write` | operator session |
| destructive | delete Worker/role/bucket/repo | `aegis-admin` | owner WebAuthn step-up, per-use |

Rules enforced in `install.server.ts`, not per provider:
- a read credential can never carry a write scope; specs that try are rejected at load
- destructive credentials are minted only on explicit opt-in and are never cached in memory beyond one call
- asymmetric preferred: OIDC federation / signing keypair where the provider supports it, else short-lived token, else ≤1 year key, and permanent keys are refused unless the spec marks `lastResort` with a reason shown in the UI

## 1Password vaults

`vault.server.ts` is the only writer of secrets. Three vaults, three service accounts:
- read SA token → held by the runtime, read-only, scoped to `aegis-read`
- write SA token → itself stored sealed; unwrapping requires owner WebAuthn assertion (reuses `src/lib/webauthn.server.ts` + `signing/`), used only during bootstrap
- admin SA token → same gate, one-shot, tied to a single destructive action id

If 1Password is not yet connected, the first click runs a "vault bootstrap" that creates the three vaults and service accounts and stores the read token in the existing sealed vault (`signing/vault.server.ts`) as the only local secret.

## Providers

Full one-click OAuth + scoped mint: Cloudflare, AWS (IAM Identity Center / OIDC role federation, no static keys), GitHub (App installation), Slack, Sentry, 1Password.

Client-side pairing (no admin API to mint against — one click writes a verified config + DPoP-bound broker token instead): Claude.ai, ChatGPT, Claude Code, Codex, JetBrains. These produce an installable config, not a provider credential.

Each provider spec is ~40 lines: authorize/token URLs, admin scope list, mint calls per tier, revoke call, and a health probe.

## Scripted fallback (equal-status second path)

Every provider card offers "Run it yourself" next to the one-click button. The registry is the single source of truth, so the script is generated from the same spec the button uses — the two can never drift.

`src/lib/integrations/script.server.ts` renders a POSIX `sh` script per provider and tier:
- every value the user would otherwise type twice is a variable in a clearly labelled block at the top
- one command per line, plain `curl` / `aws` / `wrangler` / `gh` calls, long flags, no pipelines into interpreters, no inline Python or Node, no nested loops, no single-letter names
- a comment above each call stating what it creates, which scopes it asks for, and why this app needs them
- a dry-run flag that prints the calls without executing
- the final step prints the credential and the exact `aegis` paste-back token so the app can file it in the vault; nothing is emailed or auto-posted

Safe to run in Cloudflare/AWS CloudShell or any local terminal. The script is shown in a viewer with copy and download, plus a checksum the app also displays so a downloaded copy can be verified.

## Manual path (when nothing can be automated)

For any credential a provider only issues by hand, the card renders a step list containing: the exact console URL as a clickable link showing the full URL, the exact role/scope names to select, what each one permits, and one sentence on why the app needs it. A paste field then hands the value to the vault writer — it never lands in the database or logs.

## Graceful degradation

Capability, not configuration, gates every feature. `Integration.capabilities(provider)` returns the tiers actually present, and each consumer asks before acting:
- read-only install → all inspection, telemetry, posture, drift detection and fleet views work normally
- missing write → deploy/provision actions render disabled with a one-line reason and a link to add the write tier; nothing throws, nothing half-executes
- missing destructive → teardown actions are hidden behind the same explanation
- no integration at all → the provider's panels show the install card instead of an error

A capability check runs before any mutating call, so a revoked or expired credential degrades to the read-only experience rather than failing mid-operation.


## UI

New `/integrations` route plus `IntegrationsPanel`:
- grid of provider cards with state: not connected / read only / read+write / full
- three ways in on every card: one-click install, "Run it yourself" script, manual steps
- per-card scope disclosure showing exactly what the bootstrap grant asks for and that it will be revoked
- destructive tier shown as a separate locked toggle requiring the security key
- vault status strip: which vault holds what, last rotation, next expiry
- capability badges so it is obvious which app features each tier unlocks

## 1Password automation

Beyond storing secrets, the vault layer closes the loop: after any path — click, script paste-back, or manual paste — the credential is written straight into the tiered vault with provider, tier, scope list and expiry as item fields, and the app keeps only the item reference. `op` CLI variants of every script are offered so a user already signed into 1Password can have the script itself write the item, and the rotation sweep updates the same item in place rather than creating duplicates.

## Data

One migration: `integrations` (provider, status, tier grants, vault item refs, expiry, revoked_at), `integration_events` (per-step audit), both operator-only RLS via `private.is_operator`, with GRANTs. No secret material in Postgres.

## Delivery order

1. types + registry + vault client + install pipeline + capability gate + migration
2. `/integrations` UI with Cloudflare as the first live provider, all three paths working
3. script generator + manual-step renderer applied across every provider spec
4. AWS OIDC federation, GitHub App, Slack, Sentry, 1Password self-bootstrap
5. Client pairing cards (Claude, ChatGPT, Claude Code, Codex, JetBrains)
6. Rotation + expiry sweep folded into the existing runtime cron


## What I need from you

The 1Password piece needs one bootstrap credential to create the vaults (a service account token with vault-create rights, or Connect server URL + token). Everything else is obtained through the in-app OAuth clicks.
