import type { Spec } from "../types";

const ORG = { name: "SENTRY_ORG", label: "Sentry organisation slug", example: "acme" };
const TOKEN = {
  name: "SENTRY_BOOTSTRAP_TOKEN",
  label: "Temporary Sentry auth token",
  example: "paste-the-temporary-token-here",
  secret: true,
};

export const sentry: Spec = {
  id: "sentry",
  label: "Sentry",
  kind: "service",
  summary:
    "Broker errors correlated with the telemetry ledger, so a failed tool call and its stack trace sit side by side.",
  docsUrl: "https://docs.sentry.io/api/auth/",
  oauth: {
    authorizeUrl: "https://sentry.io/oauth/authorize/",
    tokenUrl: "https://sentry.io/oauth/token/",
    clientIdEnv: "SENTRY_OAUTH_CLIENT_ID",
    clientSecretEnv: "SENTRY_OAUTH_CLIENT_SECRET",
  },
  tiers: {
    read: {
      summary: "Read issues and events. Cannot resolve or delete them.",
      lifetime: "annual",
      vault: "aegis-read",
      bootstrapScopes: ["org:read"],
      capabilities: ["Attach Sentry issues to a broker trace", "Show error rate per broker"],
      scopes: [
        {
          name: "project:read",
          grants: "Read projects and their settings.",
          why: "Maps a broker to its Sentry project.",
        },
        {
          name: "event:read",
          grants: "Read issues and individual events.",
          why: "Correlates a failed tool call with its stack trace.",
        },
      ],
      blueprint: {
        variables: [ORG, TOKEN],
        steps: [
          {
            title: "Create a read-only organisation token",
            why: "Sentry tokens carry exactly the scopes listed here and nothing more.",
            command: `curl --request POST "https://sentry.io/api/0/organizations/$SENTRY_ORG/org-auth-tokens/" \\
  --header "Authorization: Bearer $SENTRY_BOOTSTRAP_TOKEN" \\
  --header "Content-Type: application/json" \\
  --data '{ "name": "aegis-read", "scopes": ["project:read", "event:read"] }'`,
          },
        ],
        outputs: [
          "The token field in the response is the read credential.",
          "Paste it into the Sentry card under 'Read tier'.",
        ],
      },
      manual: [
        {
          title: "Open organisation auth tokens",
          url: "https://sentry.io/settings/auth-tokens/",
          detail: "Create New Token, tick only project:read and event:read.",
          why: "Read-only correlation of errors with broker traffic.",
        },
      ],
    },
    write: {
      summary: "Resolve issues and post release markers.",
      lifetime: "annual",
      vault: "aegis-write",
      bootstrapScopes: ["org:read"],
      capabilities: ["Mark an issue resolved after a broker redeploy", "Record a release per deployment"],
      scopes: [
        {
          name: "event:write",
          grants: "Update issue state.",
          why: "Closes issues automatically once drift is repaired.",
        },
        {
          name: "project:releases",
          grants: "Create release records.",
          why: "Ties every deployment to the code that produced it.",
        },
      ],
      blueprint: {
        variables: [ORG, TOKEN],
        steps: [
          {
            title: "Create a write token",
            why: "Kept in the write vault, separate from the read token, so read access can never mutate anything.",
            command: `curl --request POST "https://sentry.io/api/0/organizations/$SENTRY_ORG/org-auth-tokens/" \\
  --header "Authorization: Bearer $SENTRY_BOOTSTRAP_TOKEN" \\
  --header "Content-Type: application/json" \\
  --data '{ "name": "aegis-write", "scopes": ["event:write", "project:releases"] }'`,
          },
        ],
        outputs: ["Copy the token field and paste it under 'Write tier'."],
      },
      manual: [
        {
          title: "Create a second token",
          url: "https://sentry.io/settings/auth-tokens/",
          detail: "Name it aegis-write, tick only event:write and project:releases.",
          why: "Separate identity for anything that changes state.",
        },
      ],
    },
  },
};
