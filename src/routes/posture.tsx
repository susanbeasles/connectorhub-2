import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CircleHelp, ShieldAlert, ShieldCheck, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui-bits";
import { useAuth } from "@/hooks/useAuth";
import { posture } from "@/lib/posture/posture.functions";
import type { PostureDomain, PostureFinding, PostureState } from "@/lib/posture/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/posture")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Security posture — Aegis Broker" },
      {
        name: "description",
        content:
          "Live zero-trust posture: ownership, factors, edge gate, token binding, credential freshness and audit durability.",
      },
      { property: "og:title", content: "Security posture — Aegis Broker" },
      {
        property: "og:description",
        content: "Every zero-trust guarantee of the broker, graded and explained in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PosturePage,
});

const DOMAIN_LABEL: Record<PostureDomain, string> = {
  ownership: "Ownership",
  identity: "Identity",
  edge: "Edge gate",
  clients: "Client authorization",
  credentials: "Credentials",
  runtime: "Runtime",
  history: "History",
};

const STATE_STYLE: Record<PostureState, string> = {
  pass: "border-success/25 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/15 text-warning-foreground",
  fail: "border-destructive/25 bg-destructive/10 text-destructive",
  unknown: "border-border bg-muted text-muted-foreground",
};

function StateIcon({ state }: { state: PostureState }) {
  if (state === "pass") return <ShieldCheck className="size-4" />;
  if (state === "warn") return <AlertTriangle className="size-4" />;
  if (state === "fail") return <ShieldAlert className="size-4" />;
  return <CircleHelp className="size-4" />;
}

function FindingRow({ finding }: { finding: PostureFinding }) {
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-0">
      <span
        className={cn(
          "mt-0.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
          STATE_STYLE[finding.state],
        )}
      >
        <StateIcon state={finding.state} />
        {finding.state}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{finding.title}</p>
        <p className="text-sm text-muted-foreground">{finding.detail}</p>
        {finding.remedy ? (
          <p className="mt-1 text-xs text-muted-foreground">→ {finding.remedy}</p>
        ) : null}
      </div>
      <Badge variant="outline" className="ml-auto shrink-0 font-mono text-[10px]">
        {finding.id}
      </Badge>
    </div>
  );
}

function PosturePage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const scan = useServerFn(posture);

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["posture"],
    queryFn: () => scan(),
    enabled: Boolean(session),
  });

  const domains = Object.keys(DOMAIN_LABEL) as PostureDomain[];

  return (
    <AppShell>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Security posture</h1>
          <p className="text-sm text-muted-foreground">
            Every zero-trust guarantee this broker claims, evaluated against live state.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={cn("size-4", isFetching && "animate-spin")} /> Re-scan
        </Button>
      </div>

      {data ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Score" value={`${data.score} · ${data.grade}`} hint="weighted" />
            <Stat label="Passing" value={data.counts.pass} />
            <Stat label="Warnings" value={data.counts.warn} />
            <Stat label="Failures" value={data.counts.fail} />
            <Stat label="Unknown" value={data.counts.unknown} hint="not applicable yet" />
          </div>

          <div className="mt-6 space-y-5">
            {domains.map((domain) => {
              const rows = data.findings.filter((f) => f.domain === domain);
              if (!rows.length) return null;
              return (
                <section key={domain} className="panel overflow-hidden">
                  <header className="border-b border-border px-4 py-2.5">
                    <p className="label-caps">{DOMAIN_LABEL[domain]}</p>
                  </header>
                  {rows.map((finding) => (
                    <FindingRow key={finding.id} finding={finding} />
                  ))}
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">Scanning broker state…</p>
      )}
    </AppShell>
  );
}
