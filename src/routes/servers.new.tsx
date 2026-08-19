import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { introspectMcp } from "@/lib/console.functions";
import { useAuth } from "@/hooks/useAuth";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SAMPLE = `{
  "tools": [
    {
      "name": "list_my_repos",
      "description": "List repositories the token can see",
      "method": "GET",
      "path": "/user/repos?per_page=20",
      "approval": "always_allow",
      "scopes": ["repo:read"],
      "inputSchema": { "type": "object", "properties": {} }
    },
    {
      "name": "create_issue",
      "description": "Open an issue on one repository",
      "method": "POST",
      "path": "/repos/{{owner}}/{{repo}}/issues",
      "approval": "always_ask",
      "scopes": ["issues:write"],
      "inputSchema": {
        "type": "object",
        "required": ["owner", "repo", "title"],
        "properties": {
          "owner": { "type": "string" },
          "repo": { "type": "string" },
          "title": { "type": "string" },
          "body": { "type": "string" }
        }
      }
    }
  ]
}`;

type DraftTool = {
  name: string;
  description: string;
  method: string;
  path: string;
  approval: "always_ask" | "always_allow";
  scopes: string[];
  input_schema: Record<string, unknown>;
};

export const Route = createFileRoute("/servers/new")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create a broker — Aegis" },
      {
        name: "description",
        content:
          "Define a new least-privilege MCP server or connector: upstream API, credential handling, and the exact tool surface you expose.",
      },
      { property: "og:title", content: "Create a broker — Aegis" },
      {
        property: "og:description",
        content: "Define upstream, credentials and tool surface for a new zero-trust broker.",
      },
    ],
  }),
  component: NewServer,
});

function NewServer() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState("mcp");
  const [baseUrl, setBaseUrl] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [authType, setAuthType] = useState("api_key");
  const [manifest, setManifest] = useState(SAMPLE);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [imported, setImported] = useState<DraftTool[]>([]);
  const [busy, setBusy] = useState(false);

  async function fetchRemote() {
    setBusy(true);
    try {
      const tools = await introspectMcp({ data: { url: remoteUrl } });
      setImported(
        tools.map((t) => ({
          name: t.name,
          description: t.description,
          method: "POST",
          path: "/",
          approval: "always_ask" as const,
          scopes: [],
          input_schema: JSON.parse(t.inputSchemaJson) as Record<string, unknown>,
        })),
      );
      toast.success(`Discovered ${tools.length} tools — review and trim before saving`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reach that MCP server");
    } finally {
      setBusy(false);
    }
  }

  function parseManifest(): DraftTool[] {
    const parsed = JSON.parse(manifest) as { tools?: any[] };
    return (parsed.tools ?? []).map((t) => ({
      name: String(t.name),
      description: String(t.description ?? ""),
      method: String(t.method ?? "GET").toUpperCase(),
      path: String(t.path ?? "/"),
      approval: t.approval === "always_allow" ? "always_allow" : "always_ask",
      scopes: Array.isArray(t.scopes) ? t.scopes.map(String) : [],
      input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
    }));
  }

  async function create(source: "manifest" | "remote" | "empty") {
    setBusy(true);
    try {
      let drafts: DraftTool[] = [];
      if (source === "manifest") drafts = parseManifest();
      if (source === "remote") drafts = imported;

      const { data: server, error } = await supabase
        .from("servers")
        .insert({
          name,
          slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
          kind: kind as "mcp",
          base_url: baseUrl,
          description,
          instructions,
          auth_type: authType as "api_key",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);

      if (drafts.length) {
        const { error: te } = await supabase.from("tools").insert(
          drafts.map((d) => ({
            server_id: server.id,
            name: d.name,
            description: d.description,
            method: d.method,
            path: d.path,
            approval: d.approval,
            scopes: d.scopes,
            input_schema: d.input_schema as never,
          })),
        );
        if (te) throw new Error(te.message);
      }
      toast.success("Broker created");
      void navigate({ to: "/servers/$serverId", params: { serverId: server.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create server");
    } finally {
      setBusy(false);
    }
  }

  const ready = name.trim().length > 1 && baseUrl.startsWith("https://");

  return (
    <AppShell>
      <p className="label-caps">Provision</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">New broker</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        One broker, one upstream, one credential. Keeping them isolated means a compromised assistant
        session can never move laterally into another provider.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="panel space-y-4 p-5">
          <h2 className="label-caps">Identity &amp; upstream</h2>
          <div className="space-y-1.5">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="GitHub (read + issues)"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="github-scoped"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcp">MCP server</SelectItem>
                  <SelectItem value="connector">Connector</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="base">Upstream base URL</Label>
            <Input
              id="base"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.github.com"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Upstream auth type</Label>
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api_key">API key / PAT</SelectItem>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="basic">Basic</SelectItem>
                <SelectItem value="oauth2">OAuth2 (short-lived)</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Description</Label>
            <Input
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Read-only repo access plus issue creation"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inst">Agent instructions (prompt)</Label>
            <Textarea
              id="inst"
              rows={4}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Use these tools only for the repositories the user names. Never write to main."
            />
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="label-caps">Tool surface</h2>
          <Tabs defaultValue="manifest" className="mt-3">
            <TabsList className="w-full">
              <TabsTrigger value="manifest" className="flex-1">
                Manifest
              </TabsTrigger>
              <TabsTrigger value="remote" className="flex-1">
                Fetch MCP
              </TabsTrigger>
              <TabsTrigger value="empty" className="flex-1">
                Start empty
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manifest" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Paste a JSON manifest of endpoints. <code className="font-mono">{"{{param}}"}</code>{" "}
                placeholders in the path are filled from tool arguments; everything else becomes the
                query string or JSON body.
              </p>
              <Textarea
                rows={16}
                value={manifest}
                onChange={(e) => setManifest(e.target.value)}
                className="font-mono text-xs"
              />
              <Button disabled={!ready || busy} onClick={() => void create("manifest")}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                Create from manifest
              </Button>
            </TabsContent>

            <TabsContent value="remote" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Point at a provider&apos;s public MCP endpoint. Aegis reads its tool list so you can
                re-expose only the calls you trust.
              </p>
              <div className="flex gap-2">
                <Input
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://mcp.provider.com/mcp"
                  className="font-mono text-xs"
                />
                <Button aria-label="Fetch tools from remote MCP server" variant="outline" disabled={busy || !remoteUrl} onClick={() => void fetchRemote()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                </Button>
              </div>
              <div className="max-h-72 space-y-2 overflow-auto">
                {imported.map((t, i) => (
                  <label key={t.name} className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                    <input
                      type="checkbox"
                      defaultChecked
                      className="mt-0.5"
                      onChange={(e) =>
                        setImported((prev) =>
                          e.target.checked ? prev : prev.filter((_, idx) => idx !== i),
                        )
                      }
                    />
                    <span>
                      <span className="font-mono font-medium">{t.name}</span>
                      <span className="block text-muted-foreground">{t.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              <Button disabled={!ready || busy || !imported.length} onClick={() => void create("remote")}>
                Create with {imported.length} tools
              </Button>
            </TabsContent>

            <TabsContent value="empty" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Create the broker now and add endpoints one by one in the inline editor.
              </p>
              <Button disabled={!ready || busy} onClick={() => void create("empty")}>
                Create empty broker
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppShell>
  );
}
