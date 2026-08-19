import type { Spec } from "../types";

const ORG = { name: "GITHUB_ORG", label: "Organisation or user login", example: "acme" };
const REPO = { name: "GITHUB_REPO", label: "Repository the app works with", example: "aegis-tools" };
const TOKEN = {
  name: "GITHUB_BOOTSTRAP_TOKEN",
  label: "Temporary token allowed to manage the GitHub App installation",
  example: "paste-the-temporary-token-here",
  secret: true,
};

export const github: Spec = {
  id: "github",
  label: "GitHub",
  kind: "service",
  summary:
    "Tool manifests and connector definitions read from repositories, with issues and pull requests written back. Installed as a GitHub App so credentials are short-lived by construction.",
  docsUrl: "https://docs.github.com/apps/creating-github-apps",
  oauth: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    revokeUrl: "https://api.github.com/applications",
    clientIdEnv: "GITHUB_OAUTH_CLIENT_ID",
    clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
  },
  tiers: {
    read: {
      summary: "Read repository contents and metadata.",
      lifetime: "short-lived",
      vault: "aegis-read",
      bootstrapScopes: ["read:org"],
      capabilities: [
        "Import tool manifests from a repository",
        "Show the commit a manifest came from",
      ],
      scopes: [
        {
          name: "Contents: Read-only",
          grants: "Read files and commits in the selected repositories.",
          why: "Manifests and connector definitions live in the repository.",
        },
        {
          name: "Metadata: Read-only",
          grants: "Read repository names and default branches.",
          why: "Mandatory for any GitHub App; the smallest possible permission.",
        },
      ],
      blueprint: {
        variables: [ORG, REPO, TOKEN],
        steps: [
          {
            title: "Confirm the app installation can see the repository",
            why: "GitHub App tokens are minted per installation and expire in one hour, so there is no long-lived secret to create here. This check just proves the read path works.",
            command: `curl --request GET "https://api.github.com/repos/$GITHUB_ORG/$GITHUB_REPO" \\
  --header "Authorization: Bearer $GITHUB_BOOTSTRAP_TOKEN" \\
  --header "Accept: application/vnd.github+json"`,
          },
        ],
        outputs: [
          "A 200 response means the read tier is ready.",
          "Paste the installation id shown in the console into the GitHub card.",
        ],
      },
      manual: [
        {
          title: "Create a GitHub App",
          url: "https://github.com/settings/apps/new",
          detail:
            "Set repository permissions to Contents: Read-only and Metadata: Read-only. Leave every other permission at No access.",
          why: "An App issues one-hour installation tokens instead of a permanent personal token.",
        },
        {
          title: "Install it on only the repositories the app needs",
          detail: "Choose 'Only select repositories' rather than all repositories.",
          why: "The app can never see a repository you did not pick.",
        },
      ],
    },
    write: {
      summary: "Open issues and pull requests. Cannot force-push or delete.",
      lifetime: "short-lived",
      vault: "aegis-write",
      bootstrapScopes: ["read:org"],
      capabilities: ["File an issue when a broker fails", "Open a pull request with a generated manifest"],
      scopes: [
        {
          name: "Issues: Read and write",
          grants: "Create and comment on issues.",
          why: "Fleet failures are reported where your team already works.",
        },
        {
          name: "Pull requests: Read and write",
          grants: "Open pull requests from a branch.",
          why: "Generated manifests are proposed for review, never committed directly.",
        },
      ],
      blueprint: {
        variables: [ORG, REPO, TOKEN],
        steps: [
          {
            title: "Confirm the installation can open an issue",
            why: "Verifies the write permission without creating anything permanent.",
            command: `curl --request GET "https://api.github.com/repos/$GITHUB_ORG/$GITHUB_REPO/issues" \\
  --header "Authorization: Bearer $GITHUB_BOOTSTRAP_TOKEN" \\
  --header "Accept: application/vnd.github+json"`,
          },
        ],
        outputs: ["A 200 response means the write tier is ready."],
      },
      manual: [
        {
          title: "Raise the App permissions",
          url: "https://github.com/settings/apps",
          detail: "Set Issues and Pull requests to Read and write. Leave Contents at Read-only.",
          why: "Writing happens through review, so contents write access is never needed.",
        },
      ],
    },
  },
};
