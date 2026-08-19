# Aegis Broker — Work Plan

Zero-trust MCP / connector builder: control plane + live proxy.
Status legend: [x] done · [~] partial · [ ] not started

## Phase 0 — Foundation (done)
- [x] Lovable Cloud backend enabled
- [x] Schema: `servers`, `tools`, `credentials`, `access_tokens`, `approvals`, `audit_logs` (RLS + grants)
- [x] `VAULT_ENCRYPTION_KEY` secret, AES-GCM envelope encryption (`crypto.server.ts`)
- [x] Design system: "cool clinical light", IBM Plex Sans, OKLCH blue

## Phase 1 — Control plane (done)
- [x] Operator auth: email/password + Google + Entra ID (`/auth`)
- [x] Fleet dashboard: stats, health dots, live activity feed
- [x] Creation wizard: identity, upstream base URL, auth type
- [x] Tool sources: JSON manifest paste, remote MCP introspection, empty start
- [x] Server console: Tools / Credentials / Access / Approvals / Logs
- [x] Credential rotation + TTL, short-lived opaque client tokens
- [x] Health checks with audit logging

## Phase 2 — Live proxy (done)
- [x] `POST /api/public/mcp/:serverId` JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`
- [x] Bearer token auth (hashed, expiring, revocable)
- [x] Least-privilege outbound: credentials injected server-side only, never returned
- [x] `always_ask` approval gate with pending queue + one-shot consumption
- [x] Full request audit (status, duration, tool, level)

## Phase 3 — Client integration (done)
- [x] One-click config snippets per client (Claude Desktop, Cursor/Codex, VS Code, generic remote)
- [x] Copy-ready cURL + connector setup instructions for ChatGPT/Claude web
- [x] One-time reveal UX hardening (masked by default, reveal/copy/dismiss, never re-fetchable)

## Phase 4 — Client authorization: OAuth 2.1 (done)
- [x] Broker acts as its own authorization server: discovery metadata, dynamic client registration, PKCE-S256 authorization code, refresh grant, revocation
- [x] Per-grant fine-grained scopes derived from the broker's enabled tools (`tool:<name>`)
- [x] Consent screen: pick exact tools, grant lifetime (15m–7d), optional max-call budget
- [x] Proxy enforces scopes on `tools/list` and `tools/call`; out-of-scope calls are denied and audited
- [x] Grant inventory + instant revoke in the broker console
- [x] Legacy bearer tokens demoted to an explicitly-labelled fallback — never silent (warn-level audit event + notice injected into the client session)

## Phase 5 — Non-replayable tokens (done)

- DPoP (RFC 9449) proofs on every MCP call: single-use `jti`, broker-issued
  rolling `DPoP-Nonce`, method/URL/token binding, replay table.
- Grants sender-constrained to the client key thumbprint (`cnf.jkt`); a stolen
  token is inert without the private key.
- Refresh rotation with reuse detection — replay nukes the grant chain.
- Broker signing key in AWS KMS (HSM) when configured, WebCrypto otherwise;
  public half published at `/.well-known/jwks.json`.
- WebAuthn touch on the consent screen, policy per broker: never / writes /
  destructive / always, and physical-key-only, device-key, or any authenticator.

## Phase 6 — Ops hardening (in progress)
- [x] Scheduled health checks (`POST /api/public/cron/health`, `x-cron-secret`)
- [x] Log filtering/search + root-cause view (per-tool error rate, p50/p95 latency)
- [x] Rate limiting per grant (broker default configurable under Security)
- [x] Automatic credential + grant expiry warnings (fleet sweep)
- [x] Managed runtime targets (inline + Cloudflare Workers for Platforms), self-healing reconciliation
- [x] Permanent history: daily rollups, verbatim archive, configurable hot-log retention, CSV export
- [x] Zero-trust bootstrap: explicit ownership ceremony (`BOOTSTRAP_SECRET`), one-time recovery code, signing-key attestation chain
- [x] Cloudflare Access JWT verification in front of console + proxy (`src/lib/access/`): team JWKS with rotation-safe cache, per-surface audiences, `off`/`monitor`/`enforce` rollout, denied proxy calls audited as `access.denied`, status readout on the Operators page
  - Env: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, optional `CF_ACCESS_PROXY_AUD`, `CF_ACCESS_MODE`
- [x] Upstream (provider-side) OAuth2 authorization-code flow with PKCE, sealed client secret, server-side refresh rotation, single-use handshake state (`/api/public/oauth/upstream-callback`, "Provider auth" tab)


## Phase 7 — Tool surface authoring (done)
Three sources, one editable shape. No curated vendor templates — explicitly out of scope.
- [x] JSON manifest paste/upload
- [x] Inline form editor: method, path, name, description, approval, scopes, JSON Schema
- [x] Pull the official public MCP server for a service, then customize every discovered tool to the same degree as a hand-built one (staged, editable, nothing written until saved)
- [x] Per-tool inline edit in the broker console (not just add/delete/toggle)
- [x] Export the broker's tool surface as a portable JSON manifest


## Phase 8 — Telemetry & wire ledger (done)
- [x] Normalized traces → spans → payloads → costs, priced token breakdowns, S3 archive
- [x] Asymmetric agent provisioning (keyless enrollment tickets, DPoP body binding)
- [x] Wire ledger: full inbound/upstream exchange anatomy, per-tool token + spend rollups, CSV export

## Phase 9 — Posture (in progress)
- [x] `/posture`: weighted, graded scan over ownership, identity/MFA, edge gate, token binding,
      credential freshness, runtime health and history durability (`src/lib/posture/`)
- [x] Managed infrastructure: three isolation targets (inline, Cloudflare Workers for Platforms,
      dedicated AWS Lambda + function URL), fleet inventory at `/infrastructure`, one-click move
      between targets, drift-detecting sweep (`POST /api/public/cron/runtime`, `x-cron-secret`)
  - Env: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_LAMBDA_ROLE_ARN`
- [ ] Notification channels for fail-state transitions (webhook / email digest)
- [ ] Passkey management UI (list, rename, revoke) and invite lifecycle polish

## Phase 10 — Integrations plane (done)
- [x] Provider registry with read / write / destructive tiers, validated so a read tier can never carry a mutating scope
- [x] Three install paths from one spec: one-click OAuth bootstrap (admin grant revoked the moment the scoped credential is minted), generated beginner-readable `sh` script (+ `op` variant), exact manual instructions
- [x] Tiered 1Password custody (`aegis-read` / `aegis-write` / `aegis-admin`); the database holds references only, sealed local fallback until Connect is configured
- [x] Step-up ceremonies: write needs a verified second factor, destructive needs owner + hardware-key touch within 5 minutes
- [x] Capability gate — missing write/destructive credentials disable only the actions that need them
- [x] `/integrations` console with scope disclosure, script download, paste-back, revoke, expiry warnings

## Phase 11 — Production readiness (open)
- [ ] Publish the app so `love.vespoli.me` serves the real site instead of the access gate
- [ ] Configure provider environment (see "Production environment" below)
- [ ] Schedule the two cron endpoints (`/api/public/cron/health`, `/api/public/cron/runtime`) with `x-cron-secret`
- [ ] Minters for GitHub / AWS / 1Password one-click (script + manual paths already work)
- [ ] Notification channels for fail-state transitions (webhook / email digest)
- [ ] Passkey management UI (list, rename, revoke) and invite lifecycle polish
- [ ] End-to-end rehearsal: claim ownership → integrate Cloudflare → provision tunnel → deploy a broker → run a tool call → verify wire ledger and rollups

### Production environment
Set (already present): `VAULT_ENCRYPTION_KEY`, `BOOTSTRAP_SECRET`, `CRON_SECRET`, `LOVABLE_API_KEY`.

Still unset, each gating exactly one capability:
| Variable | Unlocks |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_TUNNEL_DOMAIN` | Workers deploys, Zero Trust tunnels, Cloudflare one-click mint |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_PROXY_AUD`, `CF_ACCESS_MODE` | Cloudflare Access in front of console + proxy |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_LAMBDA_ROLE_ARN` | Dedicated Lambda isolation per broker |
| `AWS_KMS_KEY_ID` | HSM-backed broker signing key (WebCrypto until then) |
| `TELEMETRY_S3_*` | Long-term wire archive in S3 |
| `OP_CONNECT_HOST`, `OP_CONNECT_TOKEN` | 1Password custody (secrets stay sealed locally until then) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in and GitHub integration |
| `SENTRY_ORG`, `SLACK_WORKSPACE` | Sentry / Slack one-click mint |
