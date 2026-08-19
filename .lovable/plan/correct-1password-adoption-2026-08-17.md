# Correct 1Password Adoption

## Goal
Make adoption work with the existing four vaults and existing service accounts without creating or changing anything in 1Password.

## What is wrong now
The current implementation sends a service-account token to a Connect REST route on the account website. A 1Password account hostname is not a Connect API server, and that endpoint does not authenticate service-account tokens. The 401 is caused by Aegis using the wrong protocol, not by the operator's vaults or permissions.

## Changes
1. Remove the account-domain field and every request to `https://<account>.1password.com/api/v1/*`.
2. Add a private, dedicated 1Password adapter running in an isolated AWS Lambda, because the official service-account SDK requires a Node runtime and cannot run safely in the app's edge runtime.
3. Provision the adapter from Aegis with no public function URL. Invoke it through the signed AWS Lambda API only.
4. Give the adapter the seed token once through encrypted Lambda configuration, then use the official 1Password SDK to:
   - verify the four existing vaults;
   - locate the read, write, and admin token items in `aegis-seed`;
   - verify each account's expected vault access;
   - return only verification metadata to the browser.
5. Route all subsequent vault item reads/writes through the adapter boundary. Secret values remain server-to-server and are never returned to client code or logs.
6. Update the adoption UI to say “Adopt existing 1Password estate,” remove misleading host guidance, and report precise SDK/permission failures.
7. Add focused tests for vault discovery, item matching, permission verification, error redaction, and the prohibition on tenant REST calls.

## Security boundaries
- No vaults, items, or service accounts are created during adoption.
- No public 1Password bridge endpoint is exposed.
- No service-account token is rendered, logged, or returned to the browser.
- The Lambda role permits only invoking the dedicated adapter; the adapter has no access to other Aegis runtimes.
- Adoption fails closed if AWS isolation or the official SDK cannot be provisioned.

## Technical notes
The 1Password JavaScript SDK uses a bundled WASM core and is documented for Node.js. The app backend runs at the edge, so importing it directly would be an unsupported production-only failure. The existing AWS SigV4 and Lambda provisioning boundary will be reused rather than introducing another infrastructure provider.
