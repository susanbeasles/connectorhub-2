# Seed handoff: you touch one credential, once, then never again

Yes — that works, and it is the right shape. The flow you described:

```text
you   create a vault + a seed service account, paste the seed once
app   uses the seed to build the aegis vaults
app   mints its OWN successor credentials (read / write / destructive)
app   files them in the vaults, keeps only references
you   delete the seed
app   holds custody and rotates on schedule from then on
```

Today the app stops halfway: `provision.server.ts` creates the three vaults from the
seed, then keeps the seed itself as the write credential. So deleting the seed would
break it. This plan adds the mint-successor-and-disown step, plus rotation.

## What changes

### 1. Successor mint (the missing step)

After the vaults exist, the provisioner immediately mints three new, separate
identities against the seed — one per tier, each scoped to exactly one vault:

| Tier | Permission | Vault | Life |
| --- | --- | --- | --- |
| read | read_items | aegis-read | 365d |
| write | read_items, write_items | aegis-write | 365d |
| destructive | read_items, write_items, delete_items | aegis-admin | 90d |

Each is filed through the existing `acceptCredential` door. The seed is used only
in-memory during this one call and is never stored.

### 2. Disown the seed

Once all three successors verify (a read probe per tier, so a bad mint fails loudly
before you throw the seed away), the app records a `seed.disowned` audit event and
the card flips to "Safe to delete the seed" with the exact revoke instruction. If
verification fails, the seed is kept and the card says so rather than stranding you.

### 3. Rotation without you

The credentials the app minted, it can re-mint — the write token has enough rights
to create the next read token, and so on. A `rotate.server.ts` boundary mints the
successor, verifies it, files it in place of the old item, revokes the previous
identity, and records the event. It runs three ways:

- automatically from the existing runtime cron when a credential is inside its
  expiry window
- manually from a "Rotate now" button on each tier
- on demand as part of revocation

Destructive-tier rotation still requires your security key, because that is the one
token whose loss actually deletes things.

### 4. Card changes

The 1Password card becomes a three-state strip: `seed needed` → `provisioned, seed
still live` → `self-custodial`. In the last state it shows what it holds, when each
credential expires, when it last rotated, and nothing you need to do.

## Technical notes

- `src/lib/integrations/provision.server.ts` gains a `mintSuccessors` step and stops
  filing the seed as write custody.
- New `src/lib/integrations/rotate.server.ts`, one generic entry `rotate(provider,
  tier)` driving provider-supplied mint/revoke calls — same registry, no branching.
- New `rotateIntegration` server fn, operator-gated, tier-appropriate step-up.
- `integrations.tiers` gains `mintedAt`, `expiresAt`, `rotatedAt`, `identity` so the
  sweep knows what is due. No secret material in Postgres.
- Cron hook added to the existing `/api/public/cron/runtime` sweep.

## One caveat, honestly

1Password's service-account creation API is not uniformly available on every plan —
on some it is CLI/console only. The mint step is written against the API and, if the
account rejects it, the card falls back to the generated `op` script for the three
successors and still performs the verify-then-disown handoff. Either way you touch
one credential, once.
