/**
 * Tool drafts — the single shape every tool source normalises into.
 *
 * JSON manifest, inline form, and public-MCP introspection all produce a
 * ToolDraft, so an imported tool is editable to exactly the same degree as a
 * hand-built one. Persistence lives here too, so no surface writes tool rows
 * on its own terms.
 */

export type ApprovalMode = "always_ask" | "always_allow";

export type ToolDraft = {
  name: string;
  description: string;
  method: string;
  path: string;
  approval: ApprovalMode;
  scopes: string[];
  schemaJson: string;
  enabled: boolean;
};

export type ToolRow = {
  id: string;
  name: string;
  description: string | null;
  method: string;
  path: string;
  approval: ApprovalMode;
  scopes: string[] | null;
  input_schema: unknown;
  enabled: boolean;
};

export const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

const EMPTY_SCHEMA = { type: "object", properties: {} };

export function blankDraft(): ToolDraft {
  return {
    name: "",
    description: "",
    method: "GET",
    path: "/",
    approval: "always_ask",
    scopes: [],
    schemaJson: JSON.stringify(EMPTY_SCHEMA, null, 2),
    enabled: true,
  };
}

function approvalOf(value: unknown): ApprovalMode {
  return value === "always_allow" ? "always_allow" : "always_ask";
}

function schemaText(value: unknown): string {
  return JSON.stringify(value ?? EMPTY_SCHEMA, null, 2);
}

export function draftFromRow(row: ToolRow): ToolDraft {
  return {
    name: row.name,
    description: row.description ?? "",
    method: row.method,
    path: row.path,
    approval: approvalOf(row.approval),
    scopes: row.scopes ?? [],
    schemaJson: schemaText(row.input_schema),
    enabled: row.enabled,
  };
}

/** Accepts `{ tools: [...] }` or a bare array; unknown fields are ignored. */
export function draftsFromManifest(text: string): ToolDraft[] {
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : ((parsed as { tools?: unknown[] })?.tools ?? []);
  if (!Array.isArray(list)) throw new Error("Manifest has no `tools` array");
  return list.map((raw) => {
    const t = raw as Record<string, unknown>;
    if (!t?.["name"]) throw new Error("Every tool needs a name");
    return {
      ...blankDraft(),
      name: String(t["name"]),
      description: String(t["description"] ?? ""),
      method: String(t["method"] ?? "POST").toUpperCase(),
      path: String(t["path"] ?? "/"),
      approval: approvalOf(t["approval"]),
      scopes: Array.isArray(t["scopes"]) ? (t["scopes"] as unknown[]).map(String) : [],
      schemaJson: schemaText(t["inputSchema"] ?? t["input_schema"]),
    };
  });
}

/** Tools discovered on a public MCP server — same editable shape as any other. */
export function draftsFromIntrospection(
  tools: Array<{ name: string; description: string; inputSchemaJson: string }>,
): ToolDraft[] {
  return tools.map((t) => ({
    ...blankDraft(),
    name: t.name,
    description: t.description,
    method: "POST",
    path: "/",
    schemaJson: schemaText(safeParse(t.inputSchemaJson)),
  }));
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return EMPTY_SCHEMA;
  }
}

export function validateDraft(draft: ToolDraft): Record<string, unknown> {
  if (!draft.name.trim()) throw new Error("Tool name is required");
  if (!/^[a-zA-Z0-9_.-]+$/.test(draft.name.trim())) {
    throw new Error(`"${draft.name}" is not a valid tool name`);
  }
  let schema: unknown;
  try {
    schema = JSON.parse(draft.schemaJson);
  } catch {
    throw new Error(`Input schema for ${draft.name} is not valid JSON`);
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error(`Input schema for ${draft.name} must be a JSON object`);
  }
  return schema as Record<string, unknown>;
}

export function draftToRecord(draft: ToolDraft) {
  const schema = validateDraft(draft);
  return {
    name: draft.name.trim(),
    description: draft.description,
    method: draft.method,
    path: draft.path || "/",
    approval: draft.approval,
    scopes: draft.scopes,
    enabled: draft.enabled,
    input_schema: schema as never,
  };
}
