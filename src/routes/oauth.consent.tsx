import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Fingerprint, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  approveAuthorizationRequest,
  denyAuthorizationRequest,
  getAuthorization,
  grantAssertionOptions,
} from "@/lib/oauth.functions";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TTL_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "60", label: "1 hour" },
  { value: "480", label: "8 hours" },
  { value: "1440", label: "24 hours" },
  { value: "10080", label: "7 days" },
];

export const Route = createFileRoute("/oauth/consent")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Authorize client — Aegis Broker" },
      {
        name: "description",
        content:
          "Grant a client per-tool, time-boxed access to one Aegis broker. Choose exactly which tools, for how long, and how many calls.",
      },
      { property: "og:title", content: "Authorize client — Aegis Broker" },
      {
        property: "og:description",
        content: "Fine-grained, expiring authorization for a single MCP client.",
      },
    ],
  }),
  errorComponent: ({ error }) => (
    <Shell>
      <p className="text-sm text-destructive">{error.message}</p>
    </Shell>
  ),
  component: ConsentPage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck className="size-6 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Aegis Broker</h1>
        </div>
        <div className="panel p-6">{children}</div>
      </div>
    </div>
  );
}

function ConsentPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const requestId = useMemo(
    () => new URLSearchParams(window.location.search).get("authorization_id") ?? "",
    [],
  );
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [ttl, setTtl] = useState("60");
  const [maxCalls, setMaxCalls] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !session) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      void navigate({ to: "/auth", search: { next } as never });
    }
  }, [loading, session, navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["authorization", requestId],
    enabled: !!session && !!requestId,
    queryFn: () => getAuthorization({ data: { requestId } }),
  });

  useEffect(() => {
    if (!data) return;
    setSelected(Object.fromEntries(data.requestedScopes.map((s) => [s, true])));
  }, [data]);

  if (!requestId) return <Shell><p className="text-sm text-destructive">Missing authorization_id.</p></Shell>;
  if (loading || isLoading || !session)
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading authorization request…
        </div>
      </Shell>
    );
  if (error) return <Shell><p className="text-sm text-destructive">{(error as Error).message}</p></Shell>;
  if (!data) return null;

  const chosen = Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const policy = data.server.webauthn_policy;
  const selectedMethods = data.scopes
    .filter((s) => chosen.includes(s.scope))
    .map((s) => s.method.toUpperCase());
  const touchRequired =
    policy === "always" ||
    (policy === "delete" && selectedMethods.includes("DELETE")) ||
    (policy === "write" && selectedMethods.some((m) => m !== "GET" && m !== "HEAD"));

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      let assertion: unknown;
      if (approve && touchRequired) {
        try {
          const options = await grantAssertionOptions({
            data: { requestId, origin: window.location.origin },
          });
          assertion = await startAuthentication({ optionsJSON: options as never });
        } catch (e) {
          // No usable key is only survivable when the broker still allows bootstrap.
          if (!data!.server.webauthn_sso_fallback) throw e;
        }
      }
      const res = approve
        ? await approveAuthorizationRequest({
            data: {
              requestId,
              scopes: ["mcp:discover", ...chosen],
              ttlMinutes: Number(ttl),
              maxCalls: maxCalls ? Math.max(1, Number(maxCalls)) : null,
              origin: window.location.origin,
              assertion,
            },
          })
        : await denyAuthorizationRequest({ data: { requestId } });
      window.location.replace((res as { redirectUrl: string }).redirectUrl);
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Could not complete authorization");
    }
  }

  return (
    <Shell>
      <p className="label-caps">Authorization request</p>
      <h2 className="mt-1 text-xl font-semibold">
        Connect {data.clientName} to {data.server.name}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Signed in as {session.user.email}. This grant lets {data.clientName} call only the tools you
        tick below, only until it expires. Credentials for {data.server.base_url} never leave the
        broker.
      </p>
      <p className="mt-2 break-all text-xs text-muted-foreground">
        Redirects to <span className="font-mono">{data.redirectUri}</span>
      </p>

      {touchRequired && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Fingerprint className="mt-0.5 size-3.5 shrink-0 text-primary" />
          This broker requires a hardware-key touch before issuing a grant at this power level.
        </p>
      )}

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="label-caps">Tools to allow</p>
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() =>
              setSelected(
                Object.fromEntries(
                  data.scopes.map((s) => [s.scope, chosen.length !== data.scopes.length]),
                ),
              )
            }
          >
            {chosen.length === data.scopes.length ? "Clear all" : "Select all"}
          </button>
        </div>
        {data.scopes.length === 0 && (
          <p className="text-sm text-muted-foreground">This broker exposes no enabled tools yet.</p>
        )}
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {data.scopes.map((s) => (
            <label
              key={s.scope}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
            >
              <Checkbox
                checked={!!selected[s.scope]}
                onCheckedChange={(v) => setSelected((p) => ({ ...p, [s.scope]: !!v }))}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{s.tool}</span>
                  <Badge variant={s.destructive ? "destructive" : "secondary"}>
                    {s.destructive ? "writes" : "read-only"}
                  </Badge>
                  {data.requestedScopes.includes(s.scope) && (
                    <Badge variant="outline">requested</Badge>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {s.method} {s.path}
                  {s.description ? ` — ${s.description}` : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Grant expires after</Label>
          <Select value={ttl} onValueChange={setTtl}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TTL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Max calls (optional)</Label>
          <Input
            type="number"
            min={1}
            placeholder="unlimited"
            value={maxCalls}
            onChange={(e) => setMaxCalls(e.target.value)}
          />
        </div>
      </div>

      {chosen.some((c) => data.scopes.find((s) => s.scope === c)?.destructive) && (
        <p className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          You are granting write access. The agent will be able to change data upstream without
          asking again until this grant expires.
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <Button className="flex-1" disabled={busy} onClick={() => void decide(true)}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              {touchRequired && <Fingerprint className="mr-2 size-4" />}
              {touchRequired
                ? `Touch key to approve ${chosen.length} tool(s)`
                : `Approve ${chosen.length} tool(s)`}
            </>
          )}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>
          Cancel connection
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Approving does not bypass the broker's per-tool approval rules or its audit trail. You can
        revoke this grant at any time from the broker console.
      </p>
    </Shell>
  );
}
