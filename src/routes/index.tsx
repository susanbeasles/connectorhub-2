import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Activity, ArrowRight, Plus, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { HealthDot, Stat, Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Aegis Broker — Zero-trust MCP & connector fleet" },
      {
        name: "description",
        content:
          "Launch, monitor and lock down custom MCP servers and API connectors with least-privilege scopes, short-lived tokens and full call auditing.",
      },
      { property: "og:title", content: "Aegis Broker — Zero-trust MCP & connector fleet" },
      {
        property: "og:description",
        content:
          "Launch, monitor and lock down custom MCP servers and API connectors with least-privilege scopes, short-lived tokens and full call auditing.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const { data } = useQuery({
    queryKey: ["fleet"],
    enabled: !!session,
    refetchInterval: 20_000,
    queryFn: async () => {
      const [servers, tools, approvals, logs] = await Promise.all([
        supabase.from("servers").select("*").order("created_at", { ascending: false }),
        supabase.from("tools").select("id, server_id, enabled, approval"),
        supabase.from("approvals").select("id, server_id, tool_name, created_at").eq("status", "pending"),
        supabase
          .from("audit_logs")
          .select("id, level, event, tool_name, message, status_code, created_at, server_id")
          .order("created_at", { ascending: false })
          .limit(12),
      ]);
      return {
        servers: servers.data ?? [],
        tools: tools.data ?? [],
        approvals: approvals.data ?? [],
        logs: logs.data ?? [],
      };
    },
  });

  const servers = data?.servers ?? [];
  const tools = data?.tools ?? [];

  return (
    <AppShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-caps">Control plane</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Server fleet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every server is an isolated broker: it holds the credential, you hold nothing.
          </p>
        </div>
        <Button asChild>
          <Link to="/servers/new">
            <Plus className="size-4" /> New server
          </Link>
        </Button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Servers" value={servers.length} hint={`${servers.filter((s) => s.enabled).length} enabled`} />
        <Stat
          label="Exposed tools"
          value={tools.filter((t) => t.enabled).length}
          hint={`${tools.filter((t) => t.approval === "always_ask").length} gated by approval`}
        />
        <Stat
          label="Healthy upstreams"
          value={servers.filter((s) => s.health === "healthy").length}
          hint={`${servers.filter((s) => s.health === "down").length} down`}
        />
        <Stat label="Pending approvals" value={data?.approvals.length ?? 0} hint="Human-in-the-loop calls" />
      </div>

      {data?.approvals.length ? (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <ShieldAlert className="size-4" />
          <span>
            {data.approvals.length} tool call{data.approvals.length > 1 ? "s are" : " is"} waiting for
            your approval.
          </span>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section>
          <h2 className="label-caps mb-3">Servers</h2>
          {servers.length === 0 ? (
            <Empty
              title="No servers yet"
              body="Create your first broker: point it at a provider API or import an existing public MCP server, then pare the tool surface down to what you actually want an assistant to touch."
            />
          ) : (
            <div className="space-y-3">
              {servers.map((s) => (
                <Link
                  key={s.id}
                  to="/servers/$serverId"
                  params={{ serverId: s.id }}
                  className="panel group flex items-center gap-4 p-4 transition-shadow hover:shadow-lift"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                        {s.kind}
                      </Badge>
                      {!s.enabled ? <Badge variant="outline">disabled</Badge> : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {s.base_url || "no upstream set"}
                    </p>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    {tools.filter((t) => t.server_id === s.id).length} tools
                  </div>
                  <HealthDot health={s.health} />
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="label-caps mb-3">Live activity</h2>
          <div className="panel divide-y divide-border">
            {(data?.logs ?? []).length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No proxy traffic recorded yet.</p>
            ) : (
              data?.logs.map((l) => (
                <div key={l.id} className="flex gap-3 p-3 text-xs">
                  <Activity
                    className={
                      l.level === "error"
                        ? "size-3.5 shrink-0 text-destructive"
                        : l.level === "warn"
                          ? "size-3.5 shrink-0 text-warning"
                          : "size-3.5 shrink-0 text-muted-foreground"
                    }
                  />
                  <div className="min-w-0">
                    <p className="font-mono">
                      {l.event}
                      {l.tool_name ? ` · ${l.tool_name}` : ""}
                      {l.status_code ? ` · ${l.status_code}` : ""}
                    </p>
                    <p className="truncate text-muted-foreground">{l.message}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {new Date(l.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
