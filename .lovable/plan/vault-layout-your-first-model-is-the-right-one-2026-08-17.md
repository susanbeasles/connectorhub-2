# Vault layout: your first model is the right one

Your split is correct, and it is cleaner than the alternative. The reason is that it separates two different kinds of secret that the current code wrongly puts in the same three vaults:

- **identity secrets** — the three 1Password service account tokens the app runs as
- **provider secrets** — the AWS / Cloudflare / GitHub tokens, one per tier

Your model gives identity secrets their own vault (`aegis-seed`) with a single custodian, and lets the provider secrets sit in tier vaults that the runtime accounts only ever read.

## The layout, as you described it

| Account | aegis-seed | aegis-read | aegis-write | aegis-admin |
| --- | --- | --- | --- | --- |
| `aegis-seed` | read + write | — | — | — |
| `aegis-admin` | — | read + write | read + write | read |
| `aegis-write` | — | — | read | — |
| `aegis-read` | — | read | — | — |

- **seed** holds and rotates the three service account tokens. Nothing else.
- **admin** files provider credentials into the read and write vaults, and reads destructive provider credentials from its own.
- **read** and **write** are pure consumers. Their power is the provider token they can read, not any vault write grant.

That last point is what makes this better than your alternative: a tier's blast radius is defined by *which provider tokens it can see*, not by vault permissions, so a leaked runtime token can never write anything anywhere in 1Password.

Why not the alternative (seed writes everything, all three read-only): every provider install and every provider rotation would then need the seed. The seed becomes a hot, constantly-used credential instead of a cold one touched only on identity rotation. Your version keeps the seed cold.

## One gap in your model, and the fix

Nothing can write into `aegis-admin`. Admin has read there, seed has no access there, so there is no way to file a *destructive-tier provider* credential (e.g. an AWS token that can delete).

You originally refused admin write on its own vault because of lockout. That reason disappears in this model: admin's own credential now lives in `aegis-seed`, not in `aegis-admin`. Admin writing `aegis-admin` can no longer overwrite itself.

So: **grant admin read + write on `aegis-admin`**. It becomes uniform — admin writes all three tier vaults, reads all three, and cannot touch `aegis-seed` where its own credential lives.

## What changes in code

- `types.ts` — `Vault` gains `aegis-seed`. Add a distinction between an identity secret (always `aegis-seed`) and a provider secret (tier vault).
- `vault.server.ts` — `storeSecret` / `readSecret` take the vault from that distinction rather than from `VAULT_FOR[tier]` alone. `custodian()` becomes: `aegis-seed` → seed for both modes; `aegis-read` → read for reads, destructive for writes; `aegis-write` → write for reads, destructive for writes; `aegis-admin` → destructive for both.
- `custody.server.ts` — `OP_ACCESS` rewritten to the table above; the seed's own grant documented as `aegis-seed` only.
- `provision.server.ts` — creates four vaults; the three minted successors are filed into `aegis-seed` by the seed.
- `rotate.server.ts` — identity rotation uses the seed as the minting/filing credential; provider rotation keeps using admin. No other change.
- `providers/onepassword.ts` — the generated `op` scripts and the shown scope descriptions updated to the four-vault grants.
- `ProvisionCard.tsx` / `TierCard.tsx` — copy updated to say the seed holds the service accounts and stays.

No migration needed; `integrations.tiers` already stores the vault name per entry.
