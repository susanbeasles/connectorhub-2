import type { Spec } from "../types";

const TOKEN = {
  name: "SLACK_BOOTSTRAP_TOKEN",
  label: "Temporary Slack app configuration token",
  example: "paste-the-temporary-token-here",
  secret: true,
};

const CHANNEL = {
  name: "SLACK_CHANNEL",
  label: "Channel the app posts to",
  example: "C0123456789",
};

export const slack: Spec = {
  id: "slack",
  label: "Slack",
  kind: "service",
  summary:
    "Approval prompts and fleet alerts delivered to one channel. The app can post to that channel and read nothing else.",
  docsUrl: "https://api.slack.com/authentication/oauth-v2",
  oauth: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    revokeUrl: "https://slack.com/api/auth.revoke",
    clientIdEnv: "SLACK_OAUTH_CLIENT_ID",
    clientSecretEnv: "SLACK_OAUTH_CLIENT_SECRET",
  },
  tiers: {
    read: {
      summary: "Resolve channel and user names for display.",
      lifetime: "rotating",
      vault: "aegis-read",
      bootstrapScopes: ["channels:read"],
      capabilities: ["Show who approved an action, by name"],
      scopes: [
        {
          name: "channels:read",
          grants: "List public channels and their names.",
          why: "Turns a channel id into a readable name in the console.",
        },
        {
          name: "users:read",
          grants: "Read display names of workspace members.",
          why: "Approval records show a person, not an opaque id.",
        },
      ],
      blueprint: {
        variables: [TOKEN, CHANNEL],
        steps: [
          {
            title: "Check the token can see the channel",
            why: "Confirms the read scopes were granted, without posting anything.",
            command: `curl --request GET "https://slack.com/api/conversations.info?channel=$SLACK_CHANNEL" \\
  --header "Authorization: Bearer $SLACK_BOOTSTRAP_TOKEN"`,
          },
        ],
        outputs: ['A response containing "ok": true means the read tier is ready.'],
      },
      manual: [
        {
          title: "Create a Slack app",
          url: "https://api.slack.com/apps?new_app=1",
          detail: "Under OAuth and Permissions, add the bot scopes channels:read and users:read.",
          why: "These two scopes are display-only; neither can send or modify anything.",
        },
      ],
    },
    write: {
      summary: "Post messages to one channel.",
      lifetime: "rotating",
      vault: "aegis-write",
      bootstrapScopes: ["channels:read"],
      capabilities: ["Send approval prompts", "Send fleet health alerts"],
      scopes: [
        {
          name: "chat:write",
          grants: "Post messages as the app.",
          why: "Delivers approvals and alerts.",
        },
      ],
      blueprint: {
        variables: [TOKEN, CHANNEL],
        steps: [
          {
            title: "Send one test message",
            why: "Proves posting works before the app relies on it. Delete the message afterwards if you like.",
            command: `curl --request POST "https://slack.com/api/chat.postMessage" \\
  --header "Authorization: Bearer $SLACK_BOOTSTRAP_TOKEN" \\
  --header "Content-Type: application/json" \\
  --data '{ "channel": "'"$SLACK_CHANNEL"'", "text": "Aegis Broker write tier verified." }'`,
          },
        ],
        outputs: ['A response containing "ok": true means the write tier is ready.'],
      },
      manual: [
        {
          title: "Add the chat:write scope",
          url: "https://api.slack.com/apps",
          detail:
            "OAuth and Permissions, add chat:write, reinstall the app, then invite the app to just the one channel.",
          why: "Slack limits a bot to channels it has been invited to, so the single invite is the real boundary.",
        },
      ],
    },
  },
};
