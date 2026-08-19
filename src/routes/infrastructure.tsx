import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Boxes, Cloud, RefreshCw, Server } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, HealthDot, Stat } from "@/components/ui-bits";
import { RolloutCard } from "@/components/RolloutCard";
import { ZeroTrustCard } from "@/components/ZeroTrustCard";
import { useAuth } from "@/hooks/useAuth";
import {
  launchRuntime,
  reconcileFleet,
  runtimeFleet,
  teardownRuntime,
} from "@/lib/deploy.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/infrastructure")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Infrastructure — Aegis Broker" },
      {
        name: "description",
        content:
          "Launch, tear down and self-heal isolated runtimes for every MCP broker: in-app, Cloudflare Workers for Platforms, or a dedicated AWS Lambda.",
      },
      { property: "og:title", content: "Infrastructure — Aegis Broker" },
      {
        property: "og:description",
        content: "Per-broker isolated compute with drift detection and one-sweep reconciliation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InfrastructurePage,
});

const TARGET_ICON: Record<string, typeof Cloud> = {
  inline: Server,
  cloudflare: Cloud,
  lambda: Boxes,
};

const STATUS_TONE: Record<string, string> = {
  live: "text-success",
  pending: "text-muted-foreground",
  degraded: "text-warning",
  failed: "text-destructive",
  removed: "text-muted-foreground",
};

type RuntimeTarget = "inline" | "cloudflare" | "lambda";

function InfrastructurePage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const loadFleet = useServerFn(runtimeFleet);
  const sweep = useServerFn(reconcileFleet);
  const launch = useServerFn(launchRuntime);
  const teardown = useServerFn(teardownRuntime);

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const state = useQuery({
    queryKey: ["infrastructure"],
    queryFn: () => loadFleet(),
    enabled: Boolean(session),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["infrastructure"] });
  const fail = (e: unknown) => toast.error((e as Error).message);

  const healAll = useMutation({
    mutationFn: () => sweep({ data: { origin } }),
    onSuccess: (r) => {
      toast.success(`Swept ${r.checked} deployment(s).`);
      void refresh();
    },
    onError: fail,
  });

  const move = useMutation({
    mutationFn: (input: { serverId: string; target: RuntimeTarget }) =>
      launch({ data: { serverId: input.serverId, origin, target: input.target } }),
    onSuccess: () => {
      toast.success("Runtime live.");
      void refresh();
    },
    onError: fail,
  });

  const stop = useMutation({
    mutationFn: (serverId: string) => teardown({ data: { serverId, origin } }),
    onSuccess: () => {
      toast.success("Torn down.");
      void refresh();
    },
    onError: fail,
  });

  const fleet = state.data?.fleet ?? [];
  const targets = state.data?.targets ?? [];
  const live = fleet.filter((f) => f.deployment?.status === "live").length;
  const drifting = fleet.filter(
    (f) => f.deployment && ["degraded", "failed"].includes(f.deployment.status),
  ).length;
  const dedicated = fleet.filter(
    (f) => f.deployment && f.deployment.target !== "inline" && f.deployment.status !== "removed",
  ).length;

  return (
    <AppShell>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Infrastructure</h1>
          <p className="text-sm text-muted-foreground">
            Every broker gets its own isolated runtime. Launch it, move it, or let the sweep heal it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => healAll.mutate()}
          disabled={healAll.isPending}
        >
          <RefreshCw className={cn("size-4", healAll.isPending && "animate-spin")} /> Reconcile fleet
        </Button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Brokers" value={fleet.length} />
        <Stat label="Live deployments" value={live} />
        <Stat label="Dedicated compute" value={dedicated} hint="off the shared runtime" />
        <Stat label="Drifting" value={drifting} hint="repaired on next sweep" />
      </div>

      <div className="mt-6">
        <RolloutCard />
      </div>

      <ZeroTrustCard />

      <div className="mt-6 flex flex-wrap gap-2">
        {targets.map(({ target, available, permitted }) => (
          <Badge key={target} variant={available ? "secondary" : "outline"}>
            {target} · {available ? "configured" : permitted ? "not configured" : "not in this stage"}
          </Badge>
        ))}
      </div>

      {fleet.length === 0 ? (
        <div className="mt-6">
          <Empty title="No brokers yet" body="Create a broker and it will appear here with its runtime." />
        </div>
      ) : (
        <div className="panel mt-6 overflow-hidden">
          {fleet.map((row) => {
            const Icon = TARGET_ICON[row.deployment?.target ?? "inline"] ?? Server;
            const status = row.deployment?.status ?? "not deployed";
            return (
              <div
                key={row.serverId}
                className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
              >
                <Icon className="size-4 text-muted-foreground" />
                <Link
                  to="/servers/$serverId"
                  params={{ serverId: row.serverId }}
                  className="min-w-40 font-medium hover:underline"
                >
                  {row.name}
                </Link>
                <HealthDot health={row.health} />
                <span className={cn("text-xs font-medium", STATUS_TONE[status] ?? "text-muted-foreground")}>
                  {status}
                </span>
                {row.deployment?.routeUrl ? (
                  <a
                    href={row.deployment.routeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-mono text-xs text-muted-foreground hover:underline"
                  >
                    {row.deployment.routeUrl}
                  </a>
                ) : null}
                <div className="ml-auto flex items-center gap-1.5">
                  {targets
                    .filter((t) => t.available && t.target !== row.deployment?.target)
                    .map((t) => (
                      <Button
                        key={t.target}
                        size="sm"
                        variant="outline"
                        disabled={move.isPending}
                        onClick={() =>
                          move.mutate({ serverId: row.serverId, target: t.target as RuntimeTarget })
                        }
                      >
                        Move to {t.target}
                      </Button>
                    ))}
                  {row.deployment && row.deployment.status !== "removed" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={stop.isPending}
                      onClick={() => stop.mutate(row.serverId)}
                    >
                      Tear down
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
