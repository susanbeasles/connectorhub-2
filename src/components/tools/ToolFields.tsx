/** The one editable field set for a tool, shared by every source. */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { METHODS, type ToolDraft } from "@/lib/tools/draft";

export function ToolFields({
  draft,
  onChange,
}: {
  draft: ToolDraft;
  onChange: (next: ToolDraft) => void;
}) {
  const set = (patch: Partial<ToolDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <Select value={draft.method} onValueChange={(method) => set({ method })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={draft.path}
          onChange={(e) => set({ path: e.target.value })}
          placeholder="/repos/{{owner}}/{{repo}}/issues"
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Tool name</Label>
        <Input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="create_issue"
          className="font-mono"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Description shown to the model</Label>
        <Input
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Approval</Label>
          <Select
            value={draft.approval}
            onValueChange={(v) => set({ approval: v as ToolDraft["approval"] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="always_ask">Always ask</SelectItem>
              <SelectItem value="always_allow">Always allow</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Scopes (comma separated)</Label>
          <Input
            value={draft.scopes.join(", ")}
            onChange={(e) =>
              set({
                scopes: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="issues:write"
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Input schema (JSON Schema)</Label>
        <Textarea
          rows={8}
          value={draft.schemaJson}
          onChange={(e) => set({ schemaJson: e.target.value })}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
}
