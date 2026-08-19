import { useEffect, useState } from "react";
import { FileJson, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToolFields } from "@/components/tools/ToolFields";
import { draftsFromManifest, draftToRecord, type ToolDraft } from "@/lib/tools/draft";

type Server = { id: string; name: string };

/**
 * A manifest can land anywhere in the console. Dropping one never navigates —
 * it stages the tools in place so the page you were on is still behind you.
 */
export function ManifestDrop() {
  const [dragging, setDragging] = useState(false);
  const [drafts, setDrafts] = useState<ToolDraft[] | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let depth = 0;
    const isFile = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!isFile(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (isFile(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!isFile(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void accept(file);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  async function accept(file: File) {
    try {
      const parsed = draftsFromManifest(await file.text());
      const { data } = await supabase.from("servers").select("id, name").order("name");
      setServers((data ?? []) as Server[]);
      setTarget((data?.[0]?.id as string) ?? "");
      setDrafts(parsed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That file is not a tool manifest");
    }
  }

  async function save() {
    if (!drafts || !target) return;
    setBusy(true);
    try {
      const rows = drafts.map((d) => ({ ...draftToRecord(d), server_id: target }));
      const { error } = await supabase.from("tools").insert(rows);
      if (error) throw new Error(error.message);
      toast.success(`Added ${rows.length} tool${rows.length === 1 ? "" : "s"}`);
      setDrafts(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stage those tools");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-primary bg-surface px-8 py-6 text-center">
            <FileJson className="mx-auto size-6 text-primary" />
            <p className="mt-2 text-sm font-medium">Drop a tool manifest</p>
            <p className="text-xs text-muted-foreground">
              It opens here — you stay on this page
            </p>
          </div>
        </div>
      ) : null}

      <Dialog open={!!drafts} onOpenChange={(o) => !o && setDrafts(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review imported tools</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Target broker</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a broker" />
              </SelectTrigger>
              <SelectContent>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-4">
            {(drafts ?? []).map((draft, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <ToolFields
                  draft={draft}
                  onChange={(next) =>
                    setDrafts((prev) => prev?.map((d, j) => (j === i ? next : d)) ?? prev)
                  }
                />
              </div>
            ))}
          </div>
          <Button disabled={busy || !target || !drafts?.length} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add to broker
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
