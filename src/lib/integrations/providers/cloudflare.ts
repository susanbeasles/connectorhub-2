import type { Spec } from "../types";

const ACCOUNT = {
  name: "CLOUDFLARE_ACCOUNT_ID",
  label: "Cloudflare account id",
  example: "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
};

const ZONE = {
  name: "CLOUDFLARE_ZONE_ID",
  label: "Zone id for the domain the tunnels live on",
  example: "9f8e7d6c5b4a39281706f5e4d3c2b1a0",
};

const BOOTSTRAP = {
  name: "CLOUDFLARE_BOOTSTRAP_TOKEN",
  label: "Temporary token that is allowed to create API tokens",
  example: "paste-the-temporary-token-here",
  secret: true,
};

const TOKENS_URL = "https://api.cloudflare.com/client/v4/user/tokens";

export const cloudflare: Spec = {
  id: "cloudflare",
  label: "Cloudflare",
  kind: "service",
  summary:
    "Zero Trust tunnels, DNS records and Workers for Platforms deployments for every broker in the fleet.",
  docsUrl: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
  oauth: {
    authorizeUrl: "https://dash.cloudflare.com/oauth2/auth",
    tokenUrl: "https://dash.cloudflare.com/oauth2/token",
    revokeUrl: "https://dash.cloudflare.com/oauth2/revoke",
    clientIdEnv: "CLOUDFLARE_OAUTH_CLIENT_ID",
    clientSecretEnv: "CLOUDFLARE_OAUTH_CLIENT_SECRET",
  },
  tiers: {
    read: {
      summary: "Look at what exists. Cannot change a single thing.",
      lifetime: "annual",
      vault: "aegis-read",
      bootstrapScopes: ["account:read", "user:tokens:write"],
      capabilities: [
        "See tunnel health for every broker",
        "See Worker deployments and detect drift",
        "Read DNS records used by managed tunnels",
      ],
      scopes: [
        {
          name: "Account Settings:Read",
          grants: "Read the account name and id.",
          why: "Labels the integration so you can tell accounts apart.",
        },
        {
          name: "Cloudflare Tunnel:Read",
          grants: "List tunnels and their connector health.",
          why: "The fleet view reports tunnel health without touching it.",
        },
        {
          name: "Workers Scripts:Read",
          grants: "Read deployed Worker scripts and metadata.",
          why: "Drift detection compares the deployed script with what we built.",
        },
        {
          name: "Zone:DNS:Read",
          grants: "Read DNS records in the selected zone.",
          why: "Confirms the tunnel CNAME still points where it should.",
        },
      ],
      blueprint: {
        variables: [ACCOUNT, ZONE, BOOTSTRAP],
        steps: [
          {
            title: "Create a read-only API token",
            why: "This token is the only Cloudflare credential the app uses for inspection. It can read tunnels, Workers and DNS, and nothing else.",
            command: `curl --request POST "${TOKENS_URL}" \\
  --header "Authorization: Bearer $CLOUDFLARE_BOOTSTRAP_TOKEN" \\
  --header "Content-Type: application/json" \\
  --data '{
    "name": "aegis-read",
    "policies": [
      {
        "effect": "allow",
        "resources": { "com.cloudflare.api.account.'"$CLOUDFLARE_ACCOUNT_ID"'": "*" },
        "permission_groups": [
          { "name": "Account Settings Read" },
          { "name": "Cloudflare Tunnel Read" },
          { "name": "Workers Scripts Read" }
        ]
      },
      {
        "effect": "allow",
        "resources": { "com.cloudflare.api.account.zone.'"$CLOUDFLARE_ZONE_ID"'": "*" },
        "permission_groups": [ { "name": "DNS Read" } ]
      }
    ],
    "expires_on": "'"$AEGIS_EXPIRES_ON"'"
  }'`,
          },
        ],
        outputs: [
          "The value of result.value in the response is the read token.",
          "Paste it into the Cloudflare card under 'Read tier' in the console.",
        ],
      },
      manual: [
        {
          title: "Open the API token page",
          url: "https://dash.cloudflare.com/profile/api-tokens",
          detail: "Select 'Create Token', then 'Get started' on the custom token row.",
          why: "Cloudflare only mints tokens from an authenticated dashboard session.",
        },
        {
          title: "Add exactly these permissions",
          detail:
            "Account · Account Settings · Read; Account · Cloudflare Tunnel · Read; Account · Workers Scripts · Read; Zone · DNS · Read.",
          why: "These four are the complete read surface the app uses; anything more widens the blast radius for no benefit.",
        },
        {
          title: "Set an expiry no further than one year out",
          detail: "Under 'TTL', choose an end date. Then create the token and copy the value once.",
          why: "A dated token fails closed if it is ever forgotten; the app reminds you before it lapses.",
        },
      ],
    },
    write: {
      summary: "Create and update. Cannot delete anything.",
      lifetime: "annual",
      vault: "aegis-write",
      bootstrapScopes: ["account:read", "user:tokens:write"],
      capabilities: [
        "Provision Zero Trust tunnels and Access applications",
        "Deploy and update Workers for a broker",
        "Create the DNS record a tunnel needs",
      ],
      scopes: [
        {
          name: "Cloudflare Tunnel:Edit",
          grants: "Create tunnels and write their configuration.",
          why: "One-click tunnel provisioning for a broker.",
        },
        {
          name: "Access: Apps and Policies:Edit",
          grants: "Create Access applications and policies.",
          why: "Every managed tunnel is fronted by an operator-only Access policy.",
        },
        {
          name: "Workers Scripts:Edit",
          grants: "Upload Worker scripts into the dispatch namespace.",
          why: "Deploys the thin forwarding Worker for each broker.",
        },
        {
          name: "Zone:DNS:Edit",
          grants: "Create and update DNS records in the selected zone.",
          why: "Points the broker hostname at its tunnel.",
        },
      ],
      blueprint: {
        variables: [ACCOUNT, ZONE, BOOTSTRAP],
        steps: [
          {
            title: "Create a create-and-update API token",
            why: "Cloudflare edit permissions include delete, so this token is kept in the write vault and is never used by read paths. Teardown still asks for the destructive tier and your security key.",
            command: `curl --request POST "${TOKENS_URL}" \\
  --header "Authorization: Bearer $CLOUDFLARE_BOOTSTRAP_TOKEN" \\
  --header "Content-Type: application/json" \\
  --data '{
    "name": "aegis-write",
    "policies": [
      {
        "effect": "allow",
        "resources": { "com.cloudflare.api.account.'"$CLOUDFLARE_ACCOUNT_ID"'": "*" },
        "permission_groups": [
          { "name": "Cloudflare Tunnel Write" },
          { "name": "Access: Apps and Policies Write" },
          { "name": "Workers Scripts Write" }
        ]
      },
      {
        "effect": "allow",
        "resources": { "com.cloudflare.api.account.zone.'"$CLOUDFLARE_ZONE_ID"'": "*" },
        "permission_groups": [ { "name": "DNS Write" } ]
      }
    ],
    "expires_on": "'"$AEGIS_EXPIRES_ON"'"
  }'`,
          },
        ],
        outputs: [
          "Copy result.value from the response.",
          "Paste it into the Cloudflare card under 'Write tier'.",
        ],
      },
      manual: [
        {
          title: "Open the API token page",
          url: "https://dash.cloudflare.com/profile/api-tokens",
          detail: "Create Token, then custom token.",
          why: "Same dashboard flow as the read token, with edit permissions instead.",
        },
        {
          title: "Add exactly these permissions",
          detail:
            "Account · Cloudflare Tunnel · Edit; Account · Access: Apps and Policies · Edit; Account · Workers Scripts · Edit; Zone · DNS · Edit.",
          why: "Provisioning a tunnel touches these four surfaces and nothing else.",
        },
      ],
      lastResort:
        "Cloudflare does not separate delete from edit in its permission model, so this token can also remove the resources it creates. It is stored in the write vault and only unsealed for provisioning.",
    },
  },
};
