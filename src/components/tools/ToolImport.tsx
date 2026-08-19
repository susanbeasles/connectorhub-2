/**
 * Import surface for an existing broker: paste a JSON manifest or pull the
 * official public MCP server. Both land in the same staged, fully editable
 * draft list before anything is written.
 */
import { useState } from "react";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { introspectMcp } from "@/lib/console.functions";
import { ToolFields } from "@/components/tools/ToolFields";
import {
  draftsFromIntrospection,
  draftsFromManifest,
  type ToolDraft,
} from "@/lib/tools/draft";

const SAMPLE = `{
  "tools": [
    {
      "name": "list_issues",
      "description": "List open issues for a repository",
      "method": "GET",
      "path": "/repos/{{owner}}/{{repo}}/issues",
      "approval": "always_allow",
      "inputSchema": { "type": "object", "properties": { "owner": { "type": "string" }, "repo": { "type": "string" } } }
    }
  ]
}`;

export function ToolImport({ onImport }: { onImport: (drafts: ToolDraft[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState(SAMPLE);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [staged, setStaged] = useState<ToolDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  function stage(drafts: ToolDraft[]) {
    setStaged(drafts);
    setEditing(null);
    toast.success(`${drafts.length} tool${drafts.length === 1 ? "" : "s"} staged — review before saving`);
  }

  async function pullRemote() {
    setBusy(true);
    try {
      stage(draftsFromIntrospection(await introspectMcp({ data: { url: remoteUrl } })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach that MCP server");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await onImport(staged);
      setStaged([]);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="size-4" /> Import tools
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import tools into this broker</DialogTitle>
          <DialogDescription>
            Nothing is written until you save. Everything imported stays fully editable — method,
            path, schema, scopes and approval — exactly like a tool you built by hand.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="remote">
          <TabsList>
            <TabsTrigger value="remote">Public MCP server</TabsTrigger>
            <TabsTrigger value="manifest">JSON manifest</TabsTrigger>
          </TabsList>

          <TabsContent value="remote" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label>Official MCP endpoint</Label>
              <Input
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className="font-mono text-xs"
              />
            </div>
            <Button disabled={!remoteUrl || busy} onClick={() => void pullRemote()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Discover tools
            </Button>
          </TabsContent>

          <TabsContent value="manifest" className="space-y-3 pt-3">
            <Textarea
              rows={10}
              value={manifest}
              onChange={(e) => setManifest(e.target.value)}
              className="font-mono text-xs"
            />
            <Button
              onClick={() => {
                try {
                  stage(draftsFromManifest(manifest));
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Invalid manifest");
                }
              }}
            >
              <Plus className="size-4" /> Stage manifest
            </Button>
          </TabsContent>
        </Tabs>

        {staged.length ? (
          <div className="space-y-2 border-t pt-4">
            <h4 className="label-caps">Staged ({staged.length})</h4>
            {staged.map((d, i) => (
              <div key={i} className="panel p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{d.method}</span>
                  <span className="font-mono text-sm">{d.name || "unnamed"}</span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(editing === i ? null : i)}
                    >
                      {editing === i ? "Done" : "Customize"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setStaged(staged.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {editing === i ? (
                  <div className="mt-3">
                    <ToolFields
                      draft={d}
                      onChange={(next) => setStaged(staged.map((s, j) => (j === i ? next : s)))}
                    />
                  </div>
                ) : null}
              </div>
            ))}
            <Button className="w-full" disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save {staged.length} tool{staged.length === 1 ? "" : "s"}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
