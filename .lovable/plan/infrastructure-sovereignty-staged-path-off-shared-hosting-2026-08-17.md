# Infrastructure Sovereignty: Staged Path Off Shared Hosting

## Where things stand

- Control plane (SSR, server functions, OAuth server, public API routes) runs on Lovable hosting, built to a Cloudflare Workers edge runtime.
- Database, auth, and all persisted state (encrypted credentials, wire logs, telemetry, integration records) run on Lovable Cloud managed Postgres.
- Broker runtime already supports three targets: inline, Cloudflare Workers, and AWS Lambda in your account via keyless OIDC federation.
- The signing key that AWS federation trusts is a software ES256 key sealed with the app vault key and stored in Lovable Cloud Postgres.
- The published site is currently public. Nothing gates `love.vespoli.me` today.

That last point is the immediate risk, and it is independent of the AWS question.

## The AWS access concern

The CloudShell bootstrap does not grant admin. The `aegis-control` role it creates is limited to
create/get/update/invoke on `aegis-*` Lambda functions plus `iam:PassRole` on one execution role,
and it is only assumable by a token signed with the broker key for subject `aegis:aws`. There is no
IAM user, no access key, no read of any other AWS resource. If that scope is still too broad,
the plan below narrows it further and puts the trust anchor in your account rather than ours.

## Stage 1 — Access gate as a toggle with breakglass (do first)

1. Add an `access_policy` record: mode (`public` / `zero_trust`), enabled_at, last_actor.
2. A request middleware reads the policy and, in `zero_trust` mode, requires a valid Cloudflare
   Access JWT on every route except the breakglass path and the OIDC/JWKS metadata routes.
3. Breakglass: a signed, operator-held recovery path that flips the mode back to `public` without
   passing through Cloudflare. Gated by passkey/WebAuthn re-authentication, rate limited,
   time-boxed (auto-reverts after a chosen window), and every use writes an audit record.
4. Infrastructure UI gets the toggle, current mode, and a visible breakglass history.

Result: you can turn the private network on and off yourself, and a Zero Trust outage cannot
lock you out of your own control plane.

## Stage 2 — Move the trust anchor into your AWS account

Wire the existing but unused KMS signer as the active signer, backed by an asymmetric ECC_NIST_P256
key created in your account. The private half is generated in and never leaves the AWS HSM; Aegis
can request signatures but can never export the key. The CloudShell script creates the key and
grants the control role `kms:Sign` and `kms:GetPublicKey` on that key only.

After this stage, possession of the Lovable Cloud database no longer confers the ability to mint
AWS federation tokens. This is the single highest-value change and it does not require moving any
infrastructure.

## Stage 3 — Move state you consider sensitive out of shared Postgres

Rather than a full migration, classify what actually must not live in shared hosting:

- Credential material and vault references — highest sensitivity.
- Wire logs and telemetry payloads — high volume, moderate sensitivity, already archivable to S3.
- Operational metadata (servers, tools, deployments) — lowest sensitivity.

The credential layer already routes through one boundary, so it can be repointed at storage in
your account without touching callers. Telemetry archival to your S3 already exists and can become
the system of record with short retention in Postgres.

## Stage 4 — Full relocation, only if Stage 2 and 3 are not enough

Control plane to Lambda or ECS behind your own domain, database to RDS with private networking.
This is a real project, not an increment: it ends Lovable preview/publish, requires your own CI,
secrets, migrations, and monitoring, and should only be started once Stages 1-3 have proven the
boundaries hold.

## Recommendation

Do Stage 1 now — you are publicly exposed and that is fixable today. Do Stage 2 before pasting the
1Password seed token, because it is what makes the seed handoff meaningful. Decide on Stage 3 and 4
after, with the trust anchor already outside shared infrastructure.

## Technical notes

- Access JWT verification reuses the existing JWKS fetch and cache in `src/lib/access/`.
- The signer swap is a one-line change in `signer()`; `kms.server.ts` already implements the
  interface including DER-to-raw signature conversion.
- Breakglass must not depend on Cloudflare, Zero Trust, or the Access JWKS endpoint being reachable.
- Policy mode is read per request, not cached at module scope, so a flip takes effect immediately.
