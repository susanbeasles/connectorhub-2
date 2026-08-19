import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Activity,
  Copy,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  issueToken,
  runHealthCheck,
  saveCredential,
  testTool,
} from "@/lib/console.functions";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { HealthDot } from "@/components/ui-bits";
import { OAuthPanel } from "@/components/OAuthPanel";
import { SecurityPanel } from "@/components/SecurityPanel";
import { InsightsPanel } from "@/components/InsightsPanel";
import { WirePanel } from "@/components/WirePanel";
import { UpstreamPanel } from "@/components/UpstreamPanel";
import { RuntimePanel } from "@/components/RuntimePanel";
import { TunnelPanel } from "@/components/TunnelPanel";
import { ToolsPanel } from "@/components/tools/ToolsPanel";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/servers/$serverId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Broker console — Aegis" },
      {
        name: "description",
        content:
          "Inspect health, edit the tool surface, rotate credentials, issue short-lived access tokens and audit every proxied call for one broker.",
      },
      { property: "og:title", content: "Broker console — Aegis" },
      {
        property: "og:description",
        content: "Health, tools, credentials, tokens and audit trail for a single broker.",
      },
    ],
  }),
  component: ServerConsole,
});

function ServerConsole() {
  const { serverId } = Route.useParams();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const { data } = useQuery({
    queryKey: ["server", serverId],
    enabled: !!session,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [server, tools, creds, tokens, logs, approvals] = await Promise.all([
        supabase.from("servers").select("*").eq("id", serverId).maybeSingle(),
        supabase.from("tools").select("*").eq("server_id", serverId).order("name"),
        supabase.from("credentials").select("*").eq("server_id", serverId),
        supabase.from("access_tokens").select("*").eq("server_id", serverId),
        supabase
          .from("audit_logs")
          .select("*")
          .eq("server_id", serverId)
          .order("created_at", { ascending: false })
          .limit(60),
        supabase
          .from("approvals")
          .select("*")
          .eq("server_id", serverId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      return {
        server: server.data,
        tools: tools.data ?? [],
        creds: creds.data ?? [],
        tokens: tokens.data ?? [],
        logs: logs.data ?? [],
        approvals: approvals.data ?? [],
      };
    },
  });

  const server = data?.server;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["server", serverId] });

  async function guard<T>(fn: () => Promise<T>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!server) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Loading broker…</p>
      </AppShell>
    );
  }

  const endpoint = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/mcp/${server.id}`;

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-caps">{server.kind}</p>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {server.name} <HealthDot health={server.health} />
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{server.base_url}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
            <Switch
              checked={server.enabled}
              onCheckedChange={(v) =>
                void guard(
                  async () => {
                    const { error } = await supabase
                      .from("servers")
                      .update({ enabled: v })
                      .eq("id", server.id);
                    if (error) throw new Error(error.message);
                  },
                  v ? "Broker enabled" : "Broker disabled",
                )
              }
            />
            {server.enabled ? "enabled" : "disabled"}
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void guard(() => runHealthCheck({ data: { serverId: server.id } }), "Health check done")
            }
          >
            <Activity className="size-4" /> Probe
          </Button>
          <Button
            aria-label="Delete broker"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (!confirm("Delete this broker and everything under it?")) return;
              void guard(async () => {
                const { error } = await supabase.from("servers").delete().eq("id", server.id);
                if (error) throw new Error(error.message);
                void navigate({ to: "/" });
              }, "Broker deleted");
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="tools" className="mt-6">
        <TabsList>
          <TabsTrigger value="tools">Tools ({data?.tools.length ?? 0})</TabsTrigger>
          <TabsTrigger value="creds">Credentials</TabsTrigger>
          <TabsTrigger value="upstream">Provider auth</TabsTrigger>
          <TabsTrigger value="oauth">OAuth grants</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
          <TabsTrigger value="access">Legacy bearer</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="wire">Wire ledger</TabsTrigger>
          <TabsTrigger value="logs">Logs &amp; insights</TabsTrigger>
        </TabsList>

        <TabsContent value="runtime" className="space-y-4">
          <h2 className="sr-only">Runtime</h2>
          <RuntimePanel serverId={server.id} />
          <TunnelPanel serverId={server.id} />
        </TabsContent>

        <TabsContent value="tools">
          <h2 className="sr-only">Tools</h2>
          <ToolsPanel
            serverId={server.id}
            serverSlug={server.slug}
            tools={(data?.tools ?? []) as never}
            onChange={refresh}
          />
        </TabsContent>


        <TabsContent value="creds">
          <h2 className="sr-only">Credentials</h2>
          <CredentialsPanel
            serverId={server.id}
            authType={server.auth_type}
            creds={data?.creds ?? []}
            onChange={refresh}
          />
        </TabsContent>

        <TabsContent value="upstream">
          <h2 className="sr-only">Provider auth</h2>
          <UpstreamPanel serverId={server.id} />
        </TabsContent>

        <TabsContent value="oauth">
          <h2 className="sr-only">OAuth grants</h2>
          <OAuthPanel serverId={server.id} endpoint={endpoint} />
        </TabsContent>

        <TabsContent value="security">
          <h2 className="sr-only">Security</h2>
          <SecurityPanel
            serverId={server.id}
            policy={{
              dpop_mode: String((server as { dpop_mode?: string }).dpop_mode ?? "preferred"),
              webauthn_policy: String((server as { webauthn_policy?: string }).webauthn_policy ?? "write"),
              webauthn_authenticator: String(
                (server as { webauthn_authenticator?: string }).webauthn_authenticator ?? "any",
              ),
              webauthn_sso_fallback:
                (server as { webauthn_sso_fallback?: boolean }).webauthn_sso_fallback ?? true,
              rate_limit_per_min: Number(
                (server as { rate_limit_per_min?: number }).rate_limit_per_min ?? 60,
              ),
              retention_days: Number((server as { retention_days?: number }).retention_days ?? 30),
            }}

          />
        </TabsContent>

        <TabsContent value="access">
          <h2 className="sr-only">Legacy bearer tokens</h2>
          <AccessPanel serverId={server.id} name={server.slug} endpoint={endpoint} tokens={data?.tokens ?? []} onChange={refresh} />
        </TabsContent>

        <TabsContent value="approvals">
          <h2 className="sr-only">Approvals</h2>
          <div className="panel divide-y divide-border">
            {(data?.approvals ?? []).length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No approval requests yet.</p>
            ) : (
              data?.approvals.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                  <span className="font-mono">{a.tool_name}</span>
                  <Badge variant={a.status === "pending" ? "default" : "secondary"}>{a.status}</Badge>
                  <code className="max-w-md truncate rounded bg-muted px-2 py-0.5 font-mono text-xs">
                    {JSON.stringify(a.args)}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                  {a.status === "pending" ? (
                    <div className="ml-auto flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void guard(async () => {
                            const { error } = await supabase
                              .from("approvals")
                              .update({ status: "approved", decided_at: new Date().toISOString() })
                              .eq("id", a.id);
                            if (error) throw new Error(error.message);
                          }, "Approved — the agent can retry the call")
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void guard(async () => {
                            const { error } = await supabase
                              .from("approvals")
                              .update({ status: "denied", decided_at: new Date().toISOString() })
                              .eq("id", a.id);
                            if (error) throw new Error(error.message);
                          }, "Denied")
                        }
                      >
                        Deny
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="wire">
          <h2 className="sr-only">Wire ledger</h2>
          <WirePanel serverId={serverId} />
        </TabsContent>

        <TabsContent value="logs">
          <h2 className="sr-only">Logs and insights</h2>
          <InsightsPanel serverId={serverId} />
        </TabsContent>

      </Tabs>
    </AppShell>
  );
}

function CredentialsPanel({
  serverId,
  authType,
  creds,
  onChange,
}: {
  serverId: string;
  authType: string;
  creds: any[];
  onChange: () => void;
}) {
  const [form, setForm] = useState({
    label: "primary",
    kind: authType === "none" ? "api_key" : authType,
    headerName: "Authorization",
    valueTemplate: "Bearer {{secret}}",
    secret: "",
    ttlHours: "720",
  });
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        {creds.length === 0 ? (
          <p className="panel p-5 text-sm text-muted-foreground">
            No credential stored. The broker cannot reach the upstream until you add one — it is
            encrypted at rest and never returned to the browser.
          </p>
        ) : (
          creds.map((c) => (
            <div key={c.id} className="panel flex items-center gap-3 p-4 text-sm">
              <KeyRound className="size-4 text-primary" />
              <div>
                <p className="font-medium">{c.label}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {c.kind} · {c.header_name} · rotated{" "}
                  {c.rotated_at ? new Date(c.rotated_at).toLocaleDateString() : "never"}
                  {c.expires_at ? ` · expires ${new Date(c.expires_at).toLocaleDateString()}` : ""}
                </p>
              </div>
              <Button
                aria-label="Delete credential"
                size="icon"
                variant="ghost"
                className="ml-auto"
                onClick={async () => {
                  await supabase.from("credentials").delete().eq("id", c.id);
                  onChange();
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="panel space-y-3 p-5">
        <h3 className="label-caps">Store / rotate credential</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["api_key", "bearer", "basic", "oauth2"].map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Header name</Label>
          <Input
            value={form.headerName}
            onChange={(e) => setForm({ ...form, headerName: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Value template</Label>
          <Input
            value={form.valueTemplate}
            onChange={(e) => setForm({ ...form, valueTemplate: e.target.value })}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Secret</Label>
          <Input
            type="password"
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            placeholder="ghp_…"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Expiry (hours, 0 = no expiry)</Label>
          <Input
            type="number"
            value={form.ttlHours}
            onChange={(e) => setForm({ ...form, ttlHours: e.target.value })}
          />
        </div>
        <Button
          className="w-full"
          disabled={busy || !form.secret}
          onClick={async () => {
            setBusy(true);
            try {
              const ttl = Number(form.ttlHours);
              await saveCredential({
                data: {
                  serverId,
                  label: form.label,
                  kind: form.kind as "api_key",
                  headerName: form.headerName,
                  valueTemplate: form.valueTemplate,
                  secret: form.secret,
                  ttlHours: ttl > 0 ? ttl : null,
                },
              });
              setForm({ ...form, secret: "" });
              toast.success("Credential encrypted and stored");
              onChange();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not store credential");
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw className="size-4" /> Save / rotate
        </Button>
      </div>
    </div>
  );
}

function AccessPanel({
  serverId,
  name,
  endpoint,
  tokens,
  onChange,
}: {
  serverId: string;
  name: string;
  endpoint: string;
  tokens: any[];
  onChange: () => void;
}) {
  const [label, setLabel] = useState("claude-desktop");
  const [ttl, setTtl] = useState("168");
  const [issued, setIssued] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const key = name || "aegis";
  const bearer = issued ?? "<paste-token>";

  const snippets: Record<string, { label: string; hint: string; body: string }> = {
    claude: {
      label: "Claude Desktop",
      hint: "~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%\\Claude\\ (Windows)",
      body: JSON.stringify(
        {
          mcpServers: {
            [key]: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${bearer}` } },
          },
        },
        null,
        2,
      ),
    },
    cursor: {
      label: "Cursor / Codex",
      hint: "~/.cursor/mcp.json or .cursor/mcp.json in the repo root",
      body: JSON.stringify(
        {
          mcpServers: {
            [key]: { url: endpoint, headers: { Authorization: `Bearer ${bearer}` } },
          },
        },
        null,
        2,
      ),
    },
    vscode: {
      label: "VS Code",
      hint: ".vscode/mcp.json — remote streamable-HTTP server",
      body: JSON.stringify(
        {
          servers: {
            [key]: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${bearer}` } },
          },
        },
        null,
        2,
      ),
    },
    web: {
      label: "ChatGPT / Claude web",
      hint: "Add a custom remote connector in the client's settings using these values",
      body: [
        `Name:        ${key}`,
        `Transport:   Streamable HTTP (remote MCP)`,
        `Server URL:  ${endpoint}`,
        `Auth:        Custom header`,
        `Header name: Authorization`,
        `Header val:  Bearer ${bearer}`,
        ``,
        `Note: the broker sits behind Cloudflare Access. Web clients must reach it`,
        `through a hostname the Access policy allows for service tokens.`,
      ].join("\n"),
    },
    curl: {
      label: "cURL",
      hint: "Smoke-test the broker before wiring a client",
      body: [
        `curl -sS ${endpoint} \\`,
        `  -H 'authorization: Bearer ${bearer}' \\`,
        `  -H 'content-type: application/json' \\`,
        `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq`,
      ].join("\n"),
    },
  };

  const [tab, setTab] = useState("claude");
  const active = snippets[tab]!;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="panel space-y-3 p-5">
        <h3 className="label-caps">Legacy bearer tokens — fallback only</h3>
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          These tokens are unscoped: any client holding one can call every enabled tool until it
          expires, and every use is logged as <span className="font-mono">auth.legacy_bearer_used</span>{" "}
          with a warning injected into the client's session. Use OAuth grants unless a client cannot
          speak OAuth 2.1.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>TTL (hours)</Label>
            <Input type="number" value={ttl} onChange={(e) => setTtl(e.target.value)} />
          </div>
        </div>
        <Button
          className="w-full"
          onClick={async () => {
            try {
              const res = await issueToken({
                data: { serverId, label, ttlHours: Math.max(1, Number(ttl) || 1) },
              });
              setIssued((res as { token: string }).token);
              setRevealed(false);
              toast.success("Token issued — reveal and copy it now, it is not shown again");
              onChange();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not issue token");
            }
          }}
        >
          <KeyRound className="size-4" /> Issue token
        </Button>
        {issued ? (
          <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="label-caps">One-time value</p>
            <code className="block break-all font-mono text-xs">
              {revealed ? issued : "•".repeat(44)}
            </code>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setRevealed((v) => !v)}>
                {revealed ? "Hide" : "Reveal"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(issued);
                  toast.success("Token copied");
                }}
              >
                <Copy className="size-4" /> Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  setIssued(null);
                  setRevealed(false);
                }}
              >
                Dismiss
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Not retrievable later — the broker only keeps a SHA-256 hash. Dismiss once it is stored
              in your client config.
            </p>
          </div>
        ) : null}
        <div className="divide-y divide-border">
          {tokens.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2 text-xs">
              <span className="font-medium">{t.label}</span>
              <span className="text-muted-foreground">
                exp {new Date(t.expires_at).toLocaleString()}
              </span>
              {t.revoked_at ? <Badge variant="outline">revoked</Badge> : null}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={async () => {
                  await supabase
                    .from("access_tokens")
                    .update({ revoked_at: new Date().toISOString() })
                    .eq("id", t.id);
                  onChange();
                }}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel space-y-3 p-5">
        <h3 className="label-caps">Client wiring</h3>
        <div className="space-y-1.5">
          <Label>Endpoint</Label>
          <div className="flex gap-2">
            <Input readOnly value={endpoint} className="font-mono text-xs" />
            <Button
              aria-label="Copy endpoint URL"
              variant="outline"
              size="icon"
              onClick={() => {
                void navigator.clipboard.writeText(endpoint);
                toast.success("Endpoint copied");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            {Object.entries(snippets).map(([k, s]) => (
              <TabsTrigger key={k} value={k}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{active.hint}</p>
          <Textarea readOnly rows={14} value={active.body} className="font-mono text-xs" />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              void navigator.clipboard.writeText(active.body);
              toast.success(`${active.label} snippet copied`);
            }}
          >
            <Copy className="size-4" /> Copy {active.label} snippet
          </Button>
          {!issued ? (
            <p className="text-[11px] text-muted-foreground">
              Issue a token to inline it here — otherwise replace{" "}
              <code className="font-mono">&lt;paste-token&gt;</code> yourself.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
