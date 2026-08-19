import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { serverHistory, serverInsights } from "@/lib/insights.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const WINDOWS = [
  { value: "1", label: "Last hour" },
  { value: "24", label: "Last 24 hours" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
];

const HISTORY_RANGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "3650", label: "All time" },
];

const LEVELS = ["all", "info", "warn", "error"] as const;

function exportCsv(name: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join(
    "\n",
  );
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}


const levelClass = (level: string) =>
  level === "error"
    ? "shrink-0 text-destructive"
    : level === "warn"
      ? "shrink-0 text-warning"
      : "shrink-0 text-muted-foreground";

export function InsightsPanel({ serverId }: { serverId: string }) {
  const [windowHours, setWindowHours] = useState("24");
  const [historyDays, setHistoryDays] = useState("90");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  const filters = {
    serverId,
    windowHours: Number(windowHours),
    level: level === "all" ? null : level,
    tool: null,
    search: search || null,
  };

  const { data, isFetching } = useQuery({
    queryKey: ["insights", filters],
    queryFn: () => serverInsights({ data: filters }),
    refetchInterval: 30_000,
  });

  const history = useQuery({
    queryKey: ["history", serverId, historyDays],
    queryFn: () => serverHistory({ data: { serverId, days: Number(historyDays) } }),
  });


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={windowHours} onValueChange={setWindowHours}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={level} onValueChange={(v) => setLevel(v as (typeof LEVELS)[number])}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l === "all" ? "All levels" : l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-64"
          placeholder="Search messages…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSearch(draft.trim())}
        />
        <Button variant="secondary" onClick={() => setSearch(draft.trim())}>
          Filter
        </Button>
        <Button
          variant="ghost"
          onClick={() => exportCsv(`aegis-logs-${serverId}.csv`, data?.logs ?? [])}
        >
          <Download className="size-4" /> Export
        </Button>
        {isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}

        <span className="ml-auto text-xs text-muted-foreground">
          {data?.totals.calls ?? 0} events · {data?.totals.errors ?? 0} errors ·{" "}
          {data?.totals.warnings ?? 0} warnings
        </span>
      </div>

      <div className="panel overflow-hidden">
        <p className="label-caps border-b border-border p-3">Tool reliability</p>
        {(data?.tools ?? []).length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No tool activity in this window.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="p-3 font-medium">Tool</th>
                <th className="p-3 font-medium">Calls</th>
                <th className="p-3 font-medium">Error rate</th>
                <th className="p-3 font-medium">p50</th>
                <th className="p-3 font-medium">p95</th>
                <th className="p-3 font-medium">Last error</th>
              </tr>
            </thead>
            <tbody>
              {data?.tools.map((t) => (
                <tr key={t.tool} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono">{t.tool}</td>
                  <td className="p-3 tabular-nums">{t.calls}</td>
                  <td
                    className={`p-3 tabular-nums ${t.errorRate > 0 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {Math.round(t.errorRate * 100)}%
                  </td>
                  <td className="p-3 tabular-nums">{t.p50}ms</td>
                  <td className="p-3 tabular-nums">{t.p95}ms</td>
                  <td className="max-w-xs truncate p-3 text-muted-foreground">
                    {t.lastError ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel divide-y divide-border font-mono text-xs">
        {(data?.logs ?? []).length === 0 ? (
          <p className="p-5 font-sans text-sm text-muted-foreground">No events match this filter.</p>
        ) : (
          data?.logs.map((l) => (
            <div key={l.id} className="flex gap-3 p-3">
              <span className="shrink-0 text-muted-foreground">
                {new Date(l.created_at).toLocaleString()}
              </span>
              <span className={levelClass(l.level)}>{l.level}</span>
              <span className="shrink-0">{l.event}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {l.tool_name ? `${l.tool_name} — ` : ""}
                {l.message}
              </span>
              {l.duration_ms ? <span className="shrink-0">{l.duration_ms}ms</span> : null}
              {l.status_code ? <span className="shrink-0">{l.status_code}</span> : null}
            </div>
          ))
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <p className="label-caps">Permanent history</p>
          <Select value={historyDays} onValueChange={setHistoryDays}>
            <SelectTrigger className="ml-auto w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HISTORY_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportCsv(`aegis-history-${serverId}.csv`, history.data ?? [])}
          >
            <Download className="size-4" /> Export
          </Button>
        </div>
        {(history.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            Nothing rolled up yet — events are folded into daily history once they age past this
            broker's retention window.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="p-3 font-medium">Day</th>
                <th className="p-3 font-medium">Tool</th>
                <th className="p-3 font-medium">Calls</th>
                <th className="p-3 font-medium">Errors</th>
                <th className="p-3 font-medium">p50</th>
                <th className="p-3 font-medium">p95</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((r) => (
                <tr key={`${r.day}-${r.tool_name}`} className="border-b border-border last:border-0">
                  <td className="p-3 tabular-nums">{r.day}</td>
                  <td className="p-3 font-mono">{r.tool_name || "—"}</td>
                  <td className="p-3 tabular-nums">{r.calls}</td>
                  <td
                    className={`p-3 tabular-nums ${r.errors > 0 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {r.errors}
                  </td>
                  <td className="p-3 tabular-nums">{r.p50_ms}ms</td>
                  <td className="p-3 tabular-nums">{r.p95_ms}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>

  );
}
