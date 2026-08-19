# 1Password: adopt what already exists, stop trying to create it

The provisioner still runs the old script: it calls 1Password to **create four vaults**
and then to **create three service accounts**. Your account correctly refuses the second
call (service accounts cannot mint service accounts), and the code turns any 401/403 into
the misleading "needs permission to create vaults and service accounts" message — even
though everything it wants already exists.

Your estate is already built:

```text
aegis-seed vault    holds the admin, write and read service account tokens
aegis-admin  acct   read on aegis-seed's admin item is not needed; it has
                    read on aegis-admin vault, read+write on aegis-read and aegis-write
aegis-read   acct   read on aegis-read only
aegis-write  acct   read on aegis-write only
aegis-seed   acct   the only identity that touches aegis-seed
```

So provisioning should **discover and adopt**, never create.

## What changes

### 1. Provisioning becomes discovery + adoption

Pasting the seed token now runs:

1. **Probe** — list vaults with the seed. If the call fails, report the real reason
   (bad token, wrong API host, no vault access) instead of the invented permission message.
2. **Verify the estate** — confirm `aegis-seed`, `aegis-read`, `aegis-write`, `aegis-admin`
   exist. If any is missing, name exactly which, and stop.
3. **Adopt the three identities** — read the items inside `aegis-seed`, match them to the
   read / write / admin tiers by item title, pull each credential, and prove each one works
   by listing vaults as that token and checking it can see the vault it is supposed to.
4. **File them** — each token goes into custody through the existing single door, tagged
   with the `aegis-seed` item it came from, so rotation replaces that item rather than
   making a duplicate.
5. **Seal the seed** — kept, as today, as the sole custodian of `aegis-seed`.

No vault creation. No service account creation. If an item is missing or a token fails its
probe, the card says which one and nothing is filed.

### 2. Rotation matches reality

Minting a new service account over the API is not possible, so identity rotation stops
pretending. Instead:

- The app tracks each identity's expiry and warns before it lapses.
- "Rotate" for an identity produces the exact `op` command to create the replacement, and
  a paste-back field; the seed then files the new token over the existing `aegis-seed` item.
- Provider credential rotation (AWS, Cloudflare, GitHub) is unchanged and stays automatic —
  the admin identity files those.

### 3. Permission model in code

The write-custodian map is corrected to your layout: `aegis-read` and `aegis-write` are
written by **admin** and read by their own tier; `aegis-admin` is read by **admin**;
`aegis-seed` is read and written by **seed** only. Since admin has no write on its own
vault, the **seed** becomes the writer for `aegis-admin` — it is already the one identity
that exists to write what nothing else may write.

### 4. Card copy

The 1Password card stops offering to build anything. It reads: paste the seed, the app
adopts the three accounts already in `aegis-seed`, and shows which were adopted, verified
and when each expires.

## Technical notes

- `provision.server.ts`: `onepasswordProvisioner` replaced with a discovery step;
  `mintSuccessors` replaced with `adoptIdentities` (read `aegis-seed` items → verify → file).
- `custody.server.ts`: `mint` removed from the 1Password driver; keeps `verify` and drops
  the "create vaults and service accounts" wording from the 401 handler in `op()`.
- `vault.server.ts`: `CUSTODIANS['aegis-admin'].write` becomes `seed`.
- `rotate.server.ts`: identity tiers switch to the assisted paste-back path; provider tiers
  unchanged.
- `providers/onepassword.ts`: `selfProvision.creates` rewritten to describe adoption.
- `ProvisionCard.tsx`: states become `seed needed` → `adopted` with per-identity results.

## One thing I need to confirm while building

Whether your seed token reaches 1Password over the hosted API or a Connect server
(`OP_CONNECT_HOST`). The probe in step 1 will report exactly which endpoint answered and
what it said, so if the hosted endpoint is not usable for service account tokens we will
see it plainly instead of guessing.
