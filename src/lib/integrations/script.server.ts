import { sha256Hex } from "@/lib/crypto.server";
import { spec, tierSpec } from "./registry.server";
import type { Tier, Variable } from "./types";

/**
 * The script is rendered from the same spec the one-click button executes, so
 * the two paths request identical scopes by construction. It is written for
 * someone reading shell for the first time: one command per line, long flags,
 * no pipelines into interpreters, no loops, no abbreviations.
 */

function expiry(): string {
  const date = new Date(Date.now() + 365 * 24 * 60 * 60_000);
  return date.toISOString().slice(0, 19) + "Z";
}

function variableBlock(variables: Variable[]): string {
  const lines = variables.map((v) => {
    const comment = `# ${v.label}${v.secret ? " (treat as a secret — do not paste it into chat)" : ""}`;
    const value = v.value ?? "";
    return `${comment}\n# example: ${v.example}\n${v.name}="${value}"`;
  });
  return lines.join("\n\n");
}

function commentBlock(title: string, why: string): string {
  return [`# ${title}`, ...why.match(/.{1,88}(\s|$)/g)!.map((line) => `# ${line.trim()}`)].join("\n");
}

export type RenderedScript = {
  provider: string;
  tier: Tier;
  filename: string;
  body: string;
  checksum: string;
  variables: Variable[];
};

export async function renderScript(provider: string, tier: Tier): Promise<RenderedScript> {
  const s = spec(provider);
  const t = tierSpec(provider, tier);
  const { variables, steps, outputs } = t.blueprint;

  const header = [
    "#!/bin/sh",
    "# ---------------------------------------------------------------------------",
    `# Aegis Broker — ${s.label} — ${tier} tier`,
    "#",
    ...`${t.summary} ${s.summary}`.match(/.{1,88}(\s|$)/g)!.map((line) => `# ${line.trim()}`),
    "#",
    "# Every permission this script asks for is listed below. Read them, remove any",
    "# you are not comfortable granting, and run the script yourself. The features",
    "# that depend on a removed permission switch off; nothing else breaks.",
    "#",
    ...t.scopes.map((scope) => `#   ${scope.name}\n#     grants: ${scope.grants}\n#     needed for: ${scope.why}`),
    "#",
    "# Set AEGIS_DRY_RUN=1 to print each command instead of running it.",
    "# ---------------------------------------------------------------------------",
    "",
    "set -e",
    "",
    "# ---- values you need to fill in -------------------------------------------",
    "",
    variableBlock(variables),
    "",
    `# The expiry date requested for any credential this script creates.`,
    `AEGIS_EXPIRES_ON="${expiry()}"`,
    "",
    "# ---- safety check ----------------------------------------------------------",
    "",
    ...variables.map(
      (v) =>
        `if [ -z "$${v.name}" ]; then\n  echo "Please set ${v.name} at the top of this script."\n  exit 1\nfi`,
    ),
    "",
  ].join("\n");

  const body = steps
    .map((step, index) => {
      const number = index + 1;
      return [
        "# ---------------------------------------------------------------------------",
        commentBlock(`Step ${number}: ${step.title}`, step.why),
        "# ---------------------------------------------------------------------------",
        "",
        `echo "Step ${number}: ${step.title}"`,
        "",
        `if [ "$AEGIS_DRY_RUN" = "1" ]; then`,
        `  echo "would run step ${number}"`,
        "else",
        step.command
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n"),
        "fi",
        "",
      ].join("\n");
    })
    .join("\n");

  const footer = [
    "# ---------------------------------------------------------------------------",
    "# What to do with the result",
    "# ---------------------------------------------------------------------------",
    "",
    ...outputs.map((line) => `echo "${line.replace(/"/g, "'")}"`),
    "",
    'echo "Done."',
    "",
  ].join("\n");

  const script = `${header}\n${body}\n${footer}`;
  return {
    provider,
    tier,
    filename: `aegis-${provider}-${tier}.sh`,
    body: script,
    checksum: (await sha256Hex(script)).slice(0, 16),
    variables,
  };
}

/**
 * The same steps with the credential filed straight into 1Password, for an
 * operator already signed in to `op`. Nothing is pasted back by hand.
 */
export async function renderVaultScript(provider: string, tier: Tier): Promise<RenderedScript> {
  const base = await renderScript(provider, tier);
  const t = tierSpec(provider, tier);
  const extra = [
    "",
    "# ---------------------------------------------------------------------------",
    "# Step: file the credential in 1Password",
    "# Stores the value in the tiered vault with its provider, tier and expiry, so",
    "# the app only ever holds a reference to the item and never the secret itself.",
    "# ---------------------------------------------------------------------------",
    "",
    "# Paste the credential the previous step printed.",
    'AEGIS_CREDENTIAL=""',
    "",
    'if [ -z "$AEGIS_CREDENTIAL" ]; then',
    '  echo "Set AEGIS_CREDENTIAL to the value printed above, then run this section again."',
    "  exit 1",
    "fi",
    "",
    `op item create \\`,
    `  --category "API Credential" \\`,
    `  --vault "${t.vault}" \\`,
    `  --title "aegis-${provider}-${tier}" \\`,
    `  "credential[password]=$AEGIS_CREDENTIAL" \\`,
    `  "provider[text]=${provider}" \\`,
    `  "tier[text]=${tier}" \\`,
    `  "expires[text]=$AEGIS_EXPIRES_ON"`,
    "",
    'echo "Filed in 1Password. Nothing further to paste."',
    "",
  ].join("\n");

  const script = `${base.body}${extra}`;
  return {
    provider,
    tier,
    filename: `aegis-${provider}-${tier}-1password.sh`,
    body: script,
    checksum: (await sha256Hex(script)).slice(0, 16),
    variables: base.variables,
  };
}
