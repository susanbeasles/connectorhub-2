import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Stat, Empty } from "@/components/ui-bits";
import { telemetryPatterns, telemetrySpend } from "@/lib/telemetry.functions";

const usd = (value: number) =>
  value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4).replace(/0+$/, "0")}`;
const count = (value: number) => new Intl.NumberFormat().format(Math.round(value));

type Slice = { key: string; calls: number; tokens: number; cost: number; errors: number };

function Breakdown({ title, rows }: { title: string; rows: Slice[] }) {
  const max = Math.max(1, ...rows.map((r) => r.cost));
  return (
    <div className="panel p-4">
      <p className="label-caps">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing recorded in this window.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.slice(0, 8).map((row) => (
            <li key={row.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{row.key}</span>
                <span className="font-mono tabular-nums">{usd(row.cost)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full bg-primary" style={{ width: `${(row.cost / max) * 100}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {count(row.calls)} calls · {count(row.tokens)} tokens
                {row.errors ? ` · ${row.errors} errors` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SpendPanel({ windowHours }: { windowHours: number }) {
  const fetchSpend = useServerFn(telemetrySpend);
  const fetchPatterns = useServerFn(telemetryPatterns);

  const spend = useQuery({
    queryKey: ["telemetry", "spend", windowHours],
    queryFn: () => fetchSpend({ data: { windowHours } }),
  });
  const patterns = useQuery({
    queryKey: ["telemetry", "patterns", windowHours],
    queryFn: () => fetchPatterns({ data: { windowHours } }),
  });

  if (spend.isLoading) return <p className="text-sm text-muted-foreground">Reading the ledger…</p>;
  if (!spend.data) return <Empty title="No telemetry yet" body="Point a source at the ingest endpoint and spend will appear here." />;

  const t = spend.data.totals;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Spend" value={usd(t.cost)} hint={`${count(t.calls)} recorded steps`} />
        <Stat label="Input tokens" value={count(t.inputTokens)} hint={`${count(t.cachedTokens)} served from cache`} />
        <Stat label="Output tokens" value={count(t.outputTokens)} />
        <Stat
          label="Errors"
          value={count(t.errors)}
          hint={`${Math.round((patterns.data?.cacheRatio ?? 0) * 100)}% cache ratio`}
        />

      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="By model" rows={spend.data.byModel} />
        <Breakdown title="By tool" rows={spend.data.byTool} />
        <Breakdown title="By skill" rows={spend.data.bySkill} />
        <Breakdown title="By source" rows={spend.data.bySource} />
      </div>

      {patterns.data && patterns.data.repeats.length > 0 ? (
        <div className="panel p-4">
          <p className="label-caps">Repeated steps</p>
          <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
            {patterns.data.repeats.map((row) => (
              <li key={row.name} className="flex justify-between gap-3">
                <span className="truncate">{row.name}</span>
                <span className="font-mono text-muted-foreground tabular-nums">{count(row.count)}×</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
