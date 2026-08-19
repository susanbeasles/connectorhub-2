# Phased rollout: sandbox now, production on a switch

## What you get

One flag — the **stage** — decides which infrastructure Aegis is allowed to touch. It starts in **sandbox**, where everything runs on what's already provisioned and nothing requires your AWS account or production Cloudflare. When you're satisfied, you flip it to **production**, and the app migrates itself onto the hardened path step by step, reporting each step, and it can flip back.

Nothing is rewritten to make this work. Runtimes, credential custody, signing, and the network gate are already behind single boundaries; the stage just decides which implementation each boundary is permitted to pick.

## The two stages

| Concern | Sandbox | Production |
| --- | --- | --- |
| Broker runtime | inline (in this app) | your AWS Lambda, per broker |
| Network gate | public, verified-and-reported | private network required |
| Broker signing key | sealed key, this deployment | your AWS KMS HSM |
| Provider credentials | encrypted in the app database | 1Password tiered vaults |
| Wire log archive | database retention only | your S3 bucket |
| Third-party targets | anything you point it at | unchanged |

Sandbox is not "insecure mode": encryption, RLS, MFA, consent, DPoP, audit and redaction all behave identically. What changes is *whose* infrastructure holds the assets — which is exactly the commitment you don't want to make before you've played with it.

## How the switch behaves

**Readiness first.** Production is only offered once its prerequisites actually pass: AWS federation connected, KMS key present, 1Password estate adopted, Cloudflare Access configured with an application audience, and at least one unused breakglass code issued. Each unmet prerequisite is listed with the exact action that clears it. You can promote with an item unmet only by explicitly acknowledging it, and that acknowledgement is recorded.

**Dry run before commit.** "Preview promotion" plans every step and shows what would change — which brokers move to Lambda, which secrets migrate into which vault, which signing key becomes active — without doing any of it.

**Stepwise and resumable.** The promotion runs as a list of idempotent steps, each recorded with its outcome. A failed step stops the run with the reason; fixing it and re-running continues from there rather than starting over. Re-running a completed step is a no-op.

**Reversible.** Demoting to sandbox flips the boundaries back and leaves your AWS and 1Password resources intact — it is a routing change, not a teardown. Secrets already filed in 1Password stay there and are still read from there; demotion never copies them back down into the app database.

**The gate moves last.** The private-network requirement is the final step, so a Cloudflare misconfiguration can't lock you out mid-migration, and your recovery code still reopens it.

## Steps in a promotion

1. Verify AWS federation and mint a short-lived session.
2. Switch broker signing to the KMS key; publish both public halves so nothing in flight breaks.
3. Verify the 1Password estate and migrate provider secrets from the database into their tier vaults, leaving references behind.
4. Relaunch each broker on Lambda, one at a time, and probe it before moving to the next.
5. Point wire-log archival at your S3 bucket.
6. Require the private network.

## Technical notes

- New `src/lib/stage/` boundary: `stage.server.ts` (read/set the stage, history, actor), `readiness.server.ts` (prerequisite checks reusing the existing posture check shape), `promote.server.ts` (the step runner), `capability.ts` (the pure stage → capability matrix). Every consumer asks the matrix rather than testing the stage directly, so adding a concern later is one matrix entry.
- New tables: `deployment_stage` (singleton, plus acknowledgement notes) and `stage_events` (append-only step log with actor and outcome). GRANTs and RLS in the same migration; service-role write only, read via server functions.
- `Deploy.targets()` filters by the matrix, so Lambda simply isn't offered in sandbox and inline isn't offered in production.
- `brokerSigner()` and the credential custody driver consult the matrix instead of inferring from whether AWS/1Password happen to be configured.
- Access enforcement keeps the toggle and breakglass built in Stage 1; promotion sets the policy mode through the same path, so there's still exactly one place that decides whether the gate blocks.
- Server functions in `src/lib/stage.functions.ts`, owner-only, zod-validated. UI is a `RolloutCard` on `/infrastructure`: current stage, readiness list, preview, promote, demote, and the step log.
- No destructive operations in either direction: promotion creates and re-points; demotion re-points only.
