# First-class auth plane + drop-anywhere manifests

Two tracks: a rebuilt sign-in/enrollment experience, and manifest intake that works from anywhere in the console.

## 1. One auth plane (no separate signup)

`/auth` becomes a single stepper instead of a signin/signup toggle. You enter an
email, the broker figures out whether that identity exists, and every method that
can create a seat can also sign you in:

- Password
- Passkey (create one during enrollment, not only after)
- GitHub / Google email-match verification

No mode switch, no "create your login" link, no re-entering credentials after
account creation — the session is established the moment enrollment completes.

## 2. Verification without email links

Email confirmation is turned off. Verification of the address happens one of four ways:

- **GitHub**: OAuth grant for `read:user user:email` only. We read the verified
  emails on the account, check one matches what was typed, and discard the token
  immediately. No repo, org, or profile access retained.
- **Google**: same shape — an OIDC identity read purely to compare the verified
  email against the typed one.
- **Emailed code**: 6-digit numeric code, never a clickable link. The code is
  bound to the browser session that requested it (a ticket cookie/id) and is only
  redeemable in that same session, within 10 minutes, with attempt throttling.
  A code pasted into another browser is rejected.
- **Domain + IdP proof (strongest, skips mailbox proof entirely)**: prove control
  of the DNS zone with a `_aegis-verify` TXT record, then bind a SAML/OIDC IdP for
  that same domain. Whoever holds the zone and the IdP already controls every
  mailbox in it, so asserting a mailbox is redundant — any identity that domain's
  IdP asserts is accepted at face value. Signup for that path is: verify domain ->
  provision SSO -> signed in, no email round trip.

Any existing magic-link paths are removed, including the OTP link that dumped you
on a failed-OTP error URL.

### Asymmetric SSO provisioning with rotation

The domain path provisions SSO automatically rather than through a settings form:

- SAML metadata URL or OIDC discovery URL in, connection out — no manual cert
  paste, no field-by-field config.
- Signature verification is asymmetric only (RS256/ES256 against the IdP's
  JWKS/metadata cert). Shared secrets are never accepted.
- Keys rotate on their own: the IdP's JWKS/metadata is re-fetched on a schedule
  and on unknown-`kid`, keeping old and new keys valid through the overlap window,
  and the broker's own SP signing key rotates on the same cadence with both keys
  published while the old one drains. Rotation never requires a human to touch the
  connection, and every rotation writes to the attestation chain.


## 3. MFA is mandatory and real

Immediately after enrollment the user lands on an MFA step that cannot be skipped;
until a factor is enrolled, the console renders the enrollment screen instead of any
route. Factors: passkey, TOTP (QR + code), or an SSO identity that already carries
strong auth.

Passkey-only login still performs two challenges — possession of the credential
plus the user-verification (biometric/PIN) assertion that the broker requires and
verifies server-side (`userVerification: "required"`, `uv` flag checked, not just
`up`). The UI wording says "Passkey (MFA)" only where both challenges actually
completed; a passkey that returned no user verification falls through to a second
factor prompt.

Recovery codes are issued once at MFA enrollment (hash-stored, same as the
ownership recovery code).

## 4. Ownership can no longer be "whoever signs in first"

The current claim ceremony seats the first authenticated identity when no
`BOOTSTRAP_SECRET` is set. That path is removed. Claiming requires **all** of:

1. A verified identity — GitHub/Google email match, an emailed code, or a
   domain+IdP proof (which stands on its own and needs no mailbox check).
2. An enrolled MFA factor. A domain-SSO identity satisfies this when the IdP
   asserts an MFA'd authentication context; otherwise a local factor is required.
3. The deployment secret when one is set; when none is set the console shows an
   explicit unclaimed-and-unprotected banner and refuses to seat until an operator
   sets one. No silent first-come ownership.

Domain-scoped claiming uses a `domain_claims` table with `pending`/`verified`
states, a TXT-record checker, and a one-domain-one-holder constraint so a second
party cannot claim a zone already held. An unverified domain match grants nothing:
mutations against an existing instance always require a seat plus a verified
identity. Whether this ever runs multi-tenant is left open — the same table works
for a single-tenant deployment claiming its own zone.


## 5. Manifest intake from anywhere

A single intake surface, three inputs, one modal:

- Paste JSON
- Click to pick a file
- **Drag a file onto any page** — a global drop zone lives in the app shell, so a
  drop on the fleet list, a server console, or the operators page opens the same
  configure modal in place, with no navigation.

Dropped/opened manifests reuse the existing `ToolDraft` normalization and the
staged review list, so everything stays customizable before it is written. If no
server is in context, the modal asks which server to attach to.

## Technical notes

- New tables: `identity_verifications` (ticket, email, code hash, session binding,
  attempts, expiry), `mfa_factors` (type, secret/credential ref, verified_at),
  `mfa_recovery_codes`, `domain_claims`. All with GRANTs + RLS; the console reads
  them through operator-gated server functions only.
- GitHub verification runs entirely server-side through a new
  `src/lib/verify/github.server.ts` + `google.server.ts` behind one
  `verifyEmailOwnership(provider, email)` interface; the OAuth client id/secret are
  operator-supplied secrets, never bundled.
- TOTP via a small RFC 6238 implementation in `src/lib/mfa/totp.server.ts` (no
  Node-only deps — WebCrypto HMAC).
- Auth gating moves into one `useIdentity` hook / `requireVerifiedOperator`
  middleware pair so no route or server function can bypass verification or MFA.
- Passkey signup uses the existing WebAuthn plumbing with a pre-account
  registration ticket, then mints the session directly.
- Domain path: `src/lib/domain/dns.server.ts` (DoH TXT lookup, no Node DNS),
  `src/lib/domain/sso.server.ts` (metadata/discovery ingest, JWKS refresh, key
  overlap, SP key rotation). SSO connections are created through the managed
  SAML/OIDC configuration rather than hand-rolled assertion parsing.

## Order of work

1. Verification + OTP-code plumbing, magic links removed
2. Single auth plane UI (password / passkey / GitHub / Google, signup == signin)
3. MFA enrollment gate + TOTP + recovery codes
4. Domain proof -> auto SSO provisioning -> signed in, with rotation
5. Ownership claim hardening on top of the domain/verification primitives
6. Global manifest drop zone + modal

