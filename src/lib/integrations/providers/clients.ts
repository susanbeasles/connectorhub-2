import type { Spec } from "../types";

/**
 * LLM clients have no admin API to mint against, so "installing" one means
 * writing a verified config that points at this broker and pairing it with a
 * DPoP-bound, short-lived grant. No provider credential is created or held.
 */

const ENDPOINT = {
  name: "AEGIS_ENDPOINT",
  label: "This broker's MCP endpoint",
  example: "https://love.vespoli.me/api/public/mcp/your-server-id",
};

function pairing(id: string, label: string, summary: string, docsUrl: string, install: string, configPath: string): Spec {
  return {
    id,
    label,
    kind: "client",
    summary,
    docsUrl,
    tiers: {
      read: {
        summary: "Discover and call the tools you approved. Nothing else is reachable.",
        lifetime: "short-lived",
        vault: "aegis-read",
        bootstrapScopes: [],
        capabilities: [`Use this broker from ${label}`],
        scopes: [
          {
            name: "mcp:discover",
            grants: "List the tools this broker exposes.",
            why: "The client needs a tool list before it can call anything.",
          },
          {
            name: "tool:<name>",
            grants: "Call one named tool.",
            why: "Granted per tool on the consent screen, never in bulk.",
          },
        ],
        blueprint: {
          variables: [ENDPOINT],
          steps: [
            {
              title: "Check the broker answers",
              why: "Confirms the endpoint and the edge gate before you point a client at it.",
              command: `curl --request GET "$AEGIS_ENDPOINT/../../../.well-known/oauth-protected-resource"`,
            },
            {
              title: "Write the client configuration",
              why: `Adds this broker to ${label}. No token is written to disk — the client completes an OAuth handshake on first use and receives a short-lived, key-bound token.`,
              command: `cat > ${configPath} <<'JSON'
{
  "mcpServers": {
    "aegis": {
      "type": "http",
      "url": "AEGIS_ENDPOINT"
    }
  }
}
JSON`,
            },
            {
              title: "Restart the client",
              why: "Picks up the new server entry and starts the authorization flow.",
              command: install,
            },
          ],
          outputs: [
            "On first use the client opens the consent screen where you approve individual tools.",
            "Nothing needs to be pasted back into this console.",
          ],
        },
        manual: [
          {
            title: `Add the broker in ${label}`,
            url: docsUrl,
            detail: `Add an HTTP MCP server pointing at this broker's endpoint. Leave any token field blank — authorization happens in the browser.`,
            why: "A pasted token would be a long-lived secret; the handshake gives a short-lived, key-bound one instead.",
          },
          {
            title: "Approve only the tools you need",
            detail: "The consent screen lists each tool separately with its method and path.",
            why: "Scope is chosen per tool, so a client that only reads can never write.",
          },
        ],
      },
    },
  };
}

export const claudeWeb = pairing(
  "claude",
  "Claude.ai",
  "Connect this broker to Claude on the web as a remote MCP connector.",
  "https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp",
  `echo "Open Claude settings, Connectors, then Add custom connector"`,
  "claude-connector.json",
);

export const chatgpt = pairing(
  "chatgpt",
  "ChatGPT",
  "Expose this broker to ChatGPT as a connector with per-tool consent.",
  "https://platform.openai.com/docs/mcp",
  `echo "Open ChatGPT settings, Connectors, then Add"`,
  "chatgpt-connector.json",
);

export const claudeCode = pairing(
  "claude-code",
  "Claude Code",
  "Register this broker with the Claude Code command line client.",
  "https://docs.claude.com/en/docs/claude-code/mcp",
  `claude mcp add --transport http aegis "$AEGIS_ENDPOINT"`,
  "$HOME/.claude/mcp.json",
);

export const codex = pairing(
  "codex",
  "Codex",
  "Register this broker with the Codex command line client.",
  "https://developers.openai.com/codex/mcp",
  `codex mcp add aegis --url "$AEGIS_ENDPOINT"`,
  "$HOME/.codex/mcp.json",
);

export const jetbrains = pairing(
  "jetbrains",
  "JetBrains IDEs",
  "Add this broker to the AI Assistant in any JetBrains IDE.",
  "https://www.jetbrains.com/help/ai-assistant/mcp.html",
  `echo "Open Settings, Tools, AI Assistant, Model Context Protocol, then Add"`,
  "$HOME/.jetbrains/mcp.json",
);
