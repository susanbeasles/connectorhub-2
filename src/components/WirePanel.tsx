import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { serverWire } from "@/lib/wire.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const num = (n: number) => n.toLocaleString();

function exportCsv(name: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) =>
    `"${String(typeof v === "object" && v !== null ? JSON.stringify(v) : (v ?? "")).replace(/"/g, '""')}"`;
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type WireEntry = {
  id: string;
  created_at: string;
  outcome: string;
  tool_name: string | null;
  rpc_method: string;
  client_name: string | null;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  duration_ms: number;
  inbound_tokens: number;
  outbound_tokens: number;
  request_bytes: number;
  response_bytes: number;
  request_headers: unknown;
  request_body: unknown;
  response_body: string | null;
  upstream_url: string | null;
  upstream_method: string | null;
  upstream_status: number | null;
  upstream_duration_ms: number | null;
  upstream_request: unknown;
  upstream_response: string | null;
};

function Detail({ entry }: { entry: WireEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 p-3 text-left text-sm"
      >
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(entry.created_at).toLocaleTimeString()}
        </span>
        <Badge variant={entry.outcome === "ok" ? "secondary" : "destructive"}>{entry.outcome}</Badge>
        <span className="font-medium">{entry.tool_name ?? entry.rpc_method}</span>
        <span className="text-xs text-muted-foreground">{entry.client_name || "unknown client"}</span>
        <span className="text-xs text-muted-foreground">{entry.ip || "no ip"}</span>
        <span className="ml-auto font-mono text-xs">
          ↑{num(entry.inbound_tokens)} ↓{num(entry.outbound_tokens)} tok · {entry.duration_ms}ms
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t p-3 text-xs">
          <Block title="Inbound headers" body={JSON.stringify(entry.request_headers, null, 2)} />
          <Block title="Inbound body" body={JSON.stringify(entry.request_body, null, 2)} />
          {entry.upstream_url ? (
            <Block
              title={`Upstream ${entry.upstream_method} ${entry.upstream_url} → ${entry.upstream_status} (${entry.upstream_duration_ms}ms)`}
              body={`${JSON.stringify(entry.upstream_request, null, 2)}\n\n${entry.upstream_response ?? ""}`}
            />
          ) : null}
          <Block title="Returned to model" body={entry.response_body ?? ""} />
          <p className="text-muted-foreground">
            {entry.user_agent || "no user agent"} · {entry.country || "unknown region"} ·{" "}
            {num(entry.request_bytes)} B in / {num(entry.response_bytes)} B out
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="mb-1 font-medium">{title}</p>
      <pre className="max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] leading-relaxed">
        {body || "—"}
      </pre>
    </div>
  );
}

export function WirePanel({ serverId }: { serverId: string }) {
  const [windowHours, setWindowHours] = useState("24");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  const filters = { serverId, windowHours: Number(windowHours), tool: null, search: search || null };
  const { data, isFetching } = useQuery({
    queryKey: ["wire", filters],
    queryFn: () => serverWire({ data: filters }),
    refetchInterval: 30_000,
  });

  const totals = data?.totals ?? { calls: 0, inbound: 0, outbound: 0, upstream: 0, total: 0 };

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
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSearch(draft)}
          placeholder="Filter by client, IP, or method"
          className="max-w-xs"
        />
        <Button variant="outline" onClick={() => setSearch(draft)}>
          Search
        </Button>
        {isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => exportCsv(`wire-${serverId}.csv`, (data?.entries ?? []) as never)}
        >
          <Download className="mr-2 h-4 w-4" /> Export ledger
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Exchanges" value={num(totals.calls)} hint="inbound MCP calls" />
        <Stat label="Inbound tokens" value={num(totals.inbound)} hint="model → this broker" />
        <Stat label="Outbound tokens" value={num(totals.outbound)} hint="broker → model to read" />
        <Stat label="Upstream tokens" value={num(totals.upstream)} hint="raw provider payload" />
        <Stat
          label="Total model spend"
          value={num(totals.total)}
          hint="inbound + outbound, estimated"
        />
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Tool / method</th>
              <th className="p-2 text-right">Calls</th>
              <th className="p-2 text-right">Inbound</th>
              <th className="p-2 text-right">Outbound</th>
              <th className="p-2 text-right">Upstream</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-right">Avg / call</th>
            </tr>
          </thead>
          <tbody>
            {(data?.tools ?? []).map((t) => (
              <tr key={t.tool} className="border-t">
                <td className="p-2 font-medium">{t.tool}</td>
                <td className="p-2 text-right font-mono">{num(t.calls)}</td>
                <td className="p-2 text-right font-mono">{num(t.inbound)}</td>
                <td className="p-2 text-right font-mono">{num(t.outbound)}</td>
                <td className="p-2 text-right font-mono">{num(t.upstream)}</td>
                <td className="p-2 text-right font-mono">{num(t.total)}</td>
                <td className="p-2 text-right font-mono">{num(t.avgTotal)}</td>
              </tr>
            ))}
            {(data?.tools ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                  No exchanges recorded in this window yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        {(data?.entries ?? []).map((e) => (
          <Detail key={(e as unknown as WireEntry).id} entry={e as unknown as WireEntry} />
        ))}
      </div>
    </div>
  );
}
