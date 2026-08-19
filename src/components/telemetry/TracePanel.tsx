import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { Empty } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { telemetryTrace, telemetryTraces } from "@/lib/telemetry.functions";

const usd = (value: number) => `$${Number(value).toFixed(4)}`;

type SpanNode = {
  id: string;
  external_id: string;
  parent_external_id: string | null;
  kind: string;
  name: string;
  model: string;
  status: string;
  duration_ms: number;
  payload: { system_prompt: string | null; input: string | null; output: string | null } | null;
  cost: { cost_usd: number; input_tokens: number; output_tokens: number } | null;
};

function SpanTree({ spans, parent = null, depth = 0 }: { spans: SpanNode[]; parent?: string | null; depth?: number }) {
  const children = spans.filter((s) =>
    parent === null
      ? !s.parent_external_id || !spans.some((o) => o.external_id === s.parent_external_id)
      : s.parent_external_id === parent,
  );
  if (children.length === 0) return null;
  return (
    <ul className="space-y-2">
      {children.map((span) => (
        <li key={span.id} style={{ marginLeft: depth ? 16 : 0 }}>
          <details className="rounded-md border border-border bg-surface p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {span.kind}
              </Badge>
              <span className="truncate font-medium">{span.name}</span>
              {span.status === "error" ? <Badge variant="destructive">error</Badge> : null}
              <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                {span.duration_ms}ms{span.cost ? ` · ${usd(span.cost.cost_usd)}` : ""}
              </span>
            </summary>
            <div className="mt-3 space-y-2 text-xs">
              {span.model ? <p className="text-muted-foreground">model: {span.model}</p> : null}
              {span.cost ? (
                <p className="text-muted-foreground">
                  {span.cost.input_tokens} in / {span.cost.output_tokens} out
                </p>
              ) : null}
              {span.payload?.system_prompt ? (
                <pre className="max-h-40 overflow-auto rounded bg-secondary p-2">{span.payload.system_prompt}</pre>
              ) : null}
              {span.payload?.input ? (
                <pre className="max-h-40 overflow-auto rounded bg-secondary p-2">{span.payload.input}</pre>
              ) : null}
              {span.payload?.output ? (
                <pre className="max-h-40 overflow-auto rounded bg-secondary p-2">{span.payload.output}</pre>
              ) : null}
            </div>
          </details>
          <SpanTree spans={spans} parent={span.external_id} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

export function TracePanel({ windowHours }: { windowHours: number }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const fetchTraces = useServerFn(telemetryTraces);
  const fetchTrace = useServerFn(telemetryTrace);

  const traces = useQuery({
    queryKey: ["telemetry", "traces", windowHours, search],
    queryFn: () => fetchTraces({ data: { windowHours, search: search || null, limit: 50 } }),
  });
  const detail = useQuery({
    queryKey: ["telemetry", "trace", selected],
    queryFn: () => fetchTrace({ data: { traceId: selected as string } }),
    enabled: Boolean(selected),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
      <div className="space-y-3">
        <Input placeholder="Search intent or name" value={search} onChange={(e) => setSearch(e.target.value)} />
        {(traces.data ?? []).length === 0 ? (
          <Empty title="No traces" body="Nothing has been captured in this window." />
        ) : (
          <ul className="space-y-2">
            {(traces.data ?? []).map((trace) => (
              <li key={trace.id}>
                <button
                  type="button"
                  onClick={() => setSelected(trace.id)}
                  className={`panel flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-secondary ${
                    selected === trace.id ? "border-primary" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{trace.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{trace.intent || trace.actor || trace.client}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {trace.span_count} steps · {usd(Number(trace.total_cost_usd))}
                      {trace.error_count ? ` · ${trace.error_count} errors` : ""}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        {!selected ? (
          <Empty title="Pick a trace" body="Select a trace to walk its provenance chain step by step." />
        ) : detail.isLoading ? (
          <p className="text-sm text-muted-foreground">Reconstructing chain…</p>
        ) : detail.data ? (
          <div className="space-y-4">
            <div className="panel p-4">
              <p className="label-caps">Trace</p>
              <p className="mt-1 font-medium">{detail.data.trace.name}</p>
              <p className="text-sm text-muted-foreground">{detail.data.trace.intent}</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {detail.data.trace.actor} · {detail.data.trace.client} · {detail.data.trace.environment}
              </p>
            </div>
            <SpanTree spans={detail.data.spans as unknown as SpanNode[]} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
