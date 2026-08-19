/** Tool surface for one broker: list, inline edit, test, import, export. */
import { useState } from "react";
import { Loader2, Play, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { testTool } from "@/lib/console.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ToolFields } from "@/components/tools/ToolFields";
import { ToolImport } from "@/components/tools/ToolImport";
import {
  blankDraft,
  draftFromRow,
  draftToRecord,
  type ToolDraft,
  type ToolRow,
} from "@/lib/tools/draft";

export function ToolsPanel({
  serverId,
  serverSlug,
  tools,
  onChange,
}: {
  serverId: string;
  serverSlug: string;
  tools: ToolRow[];
  onChange: () => void;
}) {
  const [draft, setDraft] = useState<ToolDraft>(blankDraft());
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<ToolDraft>(blankDraft());
  const [testing, setTesting] = useState<string | null>(null);

  async function add() {
    try {
      const { error } = await supabase
        .from("tools")
        .insert({ server_id: serverId, ...draftToRecord(draft) });
      if (error) throw new Error(error.message);
      setDraft(blankDraft());
      toast.success("Tool added");
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid tool");
    }
  }

  async function importDrafts(drafts: ToolDraft[]) {
    const rows = drafts.map((d) => ({ server_id: serverId, ...draftToRecord(d) }));
    const { error } = await supabase.from("tools").insert(rows);
    if (error) throw new Error(error.message);
    toast.success(`Imported ${rows.length} tools`);
    onChange();
  }

  async function saveEdit(id: string) {
    try {
      const { error } = await supabase.from("tools").update(draftToRecord(edit)).eq("id", id);
      if (error) throw new Error(error.message);
      setEditing(null);
      toast.success("Tool updated");
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save tool");
    }
  }

  function exportManifest() {
    const manifest = {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        method: t.method,
        path: t.path,
        approval: t.approval,
        scopes: t.scopes ?? [],
        inputSchema: t.input_schema,
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${serverSlug || "broker"}-tools.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <ToolImport onImport={importDrafts} />
          <Button variant="outline" size="sm" disabled={!tools.length} onClick={exportManifest}>
            <Upload className="size-4" /> Export manifest
          </Button>
        </div>

        {tools.length === 0 ? (
          <p className="panel p-5 text-sm text-muted-foreground">
            No tools exposed. Nothing an assistant can call — add an endpoint on the right, or
            import a manifest or an official public MCP server.
          </p>
        ) : (
          tools.map((t) => (
            <div key={t.id} className="panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {t.method}
                </Badge>
                <span className="font-mono text-sm font-medium">{t.name}</span>
                <code className="truncate font-mono text-xs text-muted-foreground">{t.path}</code>
                <div className="ml-auto flex items-center gap-3">
                  <Badge variant={t.approval === "always_ask" ? "secondary" : "outline"}>
                    {t.approval === "always_ask" ? "Always ask" : "Always allow"}
                  </Badge>
                  <Switch
                    checked={t.enabled}
                    onCheckedChange={async (enabled) => {
                      await supabase.from("tools").update({ enabled }).eq("id", t.id);
                      onChange();
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (editing === t.id) return setEditing(null);
                      setEdit(draftFromRow(t));
                      setEditing(t.id);
                    }}
                  >
                    {editing === t.id ? "Close" : "Customize"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={testing === t.id}
                    onClick={async () => {
                      setTesting(t.id);
                      try {
                        const res = await testTool({ data: { toolId: t.id, args: {} } });
                        toast.success(`Upstream ${(res as { status?: number }).status ?? "responded"}`);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Call failed");
                      } finally {
                        setTesting(null);
                        onChange();
                      }
                    }}
                  >
                    {testing === t.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await supabase.from("tools").delete().eq("id", t.id);
                      onChange();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              {t.description ? (
                <p className="mt-2 text-xs text-muted-foreground">{t.description}</p>
              ) : null}

              {editing === t.id ? (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <ToolFields draft={edit} onChange={setEdit} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void saveEdit(t.id)}>
                      Save changes
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="panel space-y-3 p-5">
        <h3 className="label-caps">Add endpoint</h3>
        <ToolFields draft={draft} onChange={setDraft} />
        <Button className="w-full" disabled={!draft.name} onClick={() => void add()}>
          <Plus className="size-4" /> Add tool
        </Button>
      </div>
    </div>
  );
}
