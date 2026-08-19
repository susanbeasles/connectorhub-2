# Phase 7 — Managed runtime, retained history, zero-trust bootstrap

Today Aegis is a control plane plus an in-app proxy. What's missing is the part that makes it a *managed* product: it should stand up and keep alive the infrastructure each broker runs on, prove the trust chain from first boot, and never lose an event.

## 1. Deployment domain (`src/lib/deploy/`)

A provider-agnostic boundary so brokers can be launched anywhere without touching call sites.

```text
deploy/
  index.server.ts     single entrypoint: Deploy.launch/teardown/status/logs
  types.ts            Target, Deployment, DeployResult, LogCursor
  cloudflare.server.ts  Workers for Platforms dispatch namespace
  inline.server.ts      current in-app proxy, as a first-class target
```

- `Deploy.launch(serverId)` uploads a generated worker script into a Cloudflare dispatch namespace, binds a per-broker route, and records the deployment.
- Every broker row gains a runtime target (`inline` or `cloudflare`) plus deployment state, so the existing proxy keeps working untouched while new brokers can be pushed to isolated workers.
- Reconcile loop: the existing cron sweep also verifies each deployment matches its desired spec and redeploys drift.
- New tables: `deployments` (target, status, version, worker name, route, last_reconciled_at) and `deploy_events` (append-only launch/teardown/reconcile audit).
- Cloudflare API token stored as a secret; never exposed to the client.

## 2. Retained log history

Audit logs currently live in one hot table with no lifecycle.

- Add `audit_archive` (compressed JSON batches per broker per day) plus a rollup table for the metrics the Insights panel reads.
- Nightly job in the cron sweep: roll events older than 30 days into archive batches, keep the rollups forever, prune hot rows.
- Insights reads hot rows for recent windows and rollups for long ones — no UI change beyond a wider window selector (30d / 90d / all time) and an export action.
- Retention window configurable per broker under Security.

## 3. Zero-trust bootstrap

Right now the first sign-in claims the owner seat. That's a trust-on-first-use gap.

- Bootstrap ceremony: an unclaimed instance shows a one-time claim screen requiring the deploy-time `BOOTSTRAP_SECRET` plus a WebAuthn hardware key enrollment. The owner seat is bound to that credential.
- Every later operator invite requires the owner's hardware touch to issue and the invitee's hardware enrollment to accept.
- Instance attestation: on boot, the broker records its signing key thumbprint and deployment digest into an append-only `attestations` table; the console shows the chain and flags any unexpected key or code change.
- Break-glass: a sealed recovery code generated once at claim time, hashed at rest, single-use, and loudly audited.

## 4. Order of work

1. Deployment domain with `inline` + `cloudflare` targets, deployments/deploy_events schema, launch/teardown UI on the broker console.
2. Reconcile + self-heal in the cron sweep.
3. Log archive, rollups, retention config, wider Insights windows and export.
4. Bootstrap ceremony, hardware-bound owner claim, attestation chain, break-glass code.

Each step ships on its own and leaves the app working.

## Technical notes

- Cloudflare Workers for Platforms (dispatch namespaces) is the only way to programmatically launch isolated per-broker workers under one account; it needs a Workers Paid/Enterprise plan and an API token with `Workers Scripts: Edit`.
- Generated worker scripts are thin: they forward to the broker's proxy logic with the broker id baked in, so proxy behaviour stays in one place.
- Archival batches are stored in a Cloud storage bucket rather than the database once they exceed a size threshold.
