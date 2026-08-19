import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2Off, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  configureUpstream,
  revokeUpstream,
  startUpstream,
  upstreamState,
} from "@/lib/upstream.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Draft = {
  provider: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  headerName: string;
  valueTemplate: string;
};

const EMPTY: Draft = {
  provider: "custom",
  authorizeUrl: "",
  tokenUrl: "",
  clientId: "",
  clientSecret: "",
  scopes: "",
  headerName: "authorization",
  valueTemplate: "Bearer {{secret}}",
};

function when(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

/** Provider-side grant: the broker holds it, refreshes it, and never reveals it. */
export function UpstreamPanel({ serverId }: { serverId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const status = useQuery({
    queryKey: ["upstream", serverId],
    queryFn: () => upstreamState({ data: { serverId } }),
  });

  useEffect(() => {
    const s = status.data;
    if (!s?.configured) return;
    setDraft((d) => ({
      ...d,
      provider: s.provider ?? d.provider,
      authorizeUrl: s.authorizeUrl ?? "",
      tokenUrl: s.tokenUrl ?? "",
      clientId: s.clientId ?? "",
      scopes: s.scopes.join(" "),
    }));
  }, [status.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["upstream", serverId] });
  const fail = (e: unknown) => toast.error((e as Error).message);

  const save = useMutation({
    mutationFn: () =>
      configureUpstream({
        data: {
          serverId,
          provider: draft.provider,
          authorizeUrl: draft.authorizeUrl,
          tokenUrl: draft.tokenUrl,
          clientId: draft.clientId,
          ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
          scopes: draft.scopes.split(/\s+/).filter(Boolean),
          headerName: draft.headerName,
          valueTemplate: draft.valueTemplate,
        },
      }),
    onSuccess: () => {
      setDraft((d) => ({ ...d, clientSecret: "" }));
      toast.success("Provider app saved — client secret sealed at rest.");
      void refresh();
    },
    onError: fail,
  });

  const connect = useMutation({
    mutationFn: () => startUpstream({ data: { serverId, origin: window.location.origin } }),
    onSuccess: (r) => window.location.assign(r.authorizeUrl),
    onError: fail,
  });

  const disconnect = useMutation({
    mutationFn: () => revokeUpstream({ data: { serverId } }),
    onSuccess: () => {
      toast.success("Provider grant deleted.");
      void refresh();
    },
    onError: fail,
  });

  const s = status.data;
  const field = (key: keyof Draft, label: string, placeholder = "", type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`up-${key}`}>{label}</Label>
      <Input
        id={`up-${key}`}
        type={type}
        placeholder={placeholder}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="panel p-5">
        <div className="flex items-center gap-3">
          <p className="label-caps">Provider grant</p>
          <Badge variant={s?.connected ? "default" : "secondary"}>
            {s?.connected ? "connected" : s?.configured ? "not authorized" : "not configured"}
          </Badge>
          {s?.connected && !s.refreshable ? (
            <Badge variant="secondary">no refresh token</Badge>
          ) : null}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          The broker completes the provider handshake with PKCE, keeps the access and refresh
          tokens sealed, and rotates them on its own before every expiring call. Nothing here is
          ever returned to a client, an operator, or a model.
        </p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Granted scope</dt>
            <dd className="font-medium">{s?.scope || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Access expires</dt>
            <dd className="font-medium">{when(s?.expiresAt ?? null)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rotations</dt>
            <dd className="font-medium">
              {s?.rotations ?? 0} · last {when(s?.rotatedAt ?? null)}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={!s?.configured || connect.isPending} onClick={() => connect.mutate()}>
            {s?.connected ? <RefreshCw className="size-4" /> : <ExternalLink className="size-4" />}
            {s?.connected ? "Re-authorize" : "Authorize provider"}
          </Button>
          {s?.connected ? (
            <Button variant="outline" onClick={() => disconnect.mutate()}>
              <Link2Off className="size-4" /> Disconnect
            </Button>
          ) : null}
        </div>
      </section>

      <section className="panel p-5">
        <p className="label-caps">Provider OAuth app</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {field("provider", "Provider", "github")}
          {field("clientId", "Client ID")}
          {field("authorizeUrl", "Authorization URL", "https://github.com/login/oauth/authorize")}
          {field("tokenUrl", "Token URL", "https://github.com/login/oauth/access_token")}
          {field(
            "clientSecret",
            "Client secret (write-only)",
            s?.configured ? "unchanged" : "",
            "password",
          )}
          {field("scopes", "Scopes (space separated)", "repo:status read:user")}
          {field("headerName", "Outbound header")}
          {field("valueTemplate", "Header template")}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Redirect URI to register with the provider:{" "}
          <code className="font-mono">
            {typeof window === "undefined" ? "" : window.location.origin}
            /api/public/oauth/upstream-callback
          </code>
        </p>
        <Button
          className="mt-4"
          disabled={!draft.clientId || !draft.authorizeUrl || !draft.tokenUrl || save.isPending}
          onClick={() => save.mutate()}
        >
          <ShieldCheck className="size-4" /> Save provider app
        </Button>
      </section>
    </div>
  );
}
