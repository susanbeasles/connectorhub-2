import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { revokeGrant } from "@/lib/oauth.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Grant = {
  id: string;
  client_name: string;
  client_id: string;
  scopes: string[];
  grant_expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  call_count: number;
  max_calls: number | null;
};

type Client = {
  id: string;
  client_id: string;
  name: string;
  redirect_uris: string[];
  last_seen_at: string | null;
};

function copy(text: string, what: string) {
  void navigator.clipboard.writeText(text);
  toast.success(`${what} copied`);
}

export function OAuthPanel({ serverId, endpoint }: { serverId: string; endpoint: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["oauth", serverId],
    refetchInterval: 20_000,
    queryFn: async () => {
      const [grants, clients] = await Promise.all([
        supabase
          .from("oauth_grants")
          .select("*")
          .eq("server_id", serverId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("oauth_clients")
          .select("*")
          .eq("server_id", serverId)
          .order("created_at", { ascending: false }),
      ]);
      return {
        grants: (grants.data ?? []) as unknown as Grant[],
        clients: (clients.data ?? []) as unknown as Client[],
      };
    },
  });

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const config = JSON.stringify(
    { mcpServers: { aegis: { type: "http", url: endpoint } } },
    null,
    2,
  );

  const active = (data?.grants ?? []).filter(
    (g) => !g.revoked_at && new Date(g.grant_expires_at).getTime() > Date.now(),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="panel space-y-3 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h3 className="label-caps">OAuth 2.1 — preferred path</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Point the client at the endpoint with no credentials at all. It discovers this broker's
          authorization server, registers itself, and sends you to a consent screen where you pick
          the exact tools, lifetime, and call budget for that one grant. Nothing is copied by hand.
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
          {config}
        </pre>
        <Button variant="outline" className="w-full" onClick={() => copy(config, "Config")}>
          <Copy className="size-4" /> Copy client config
        </Button>
        <dl className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between gap-3">
            <dt>Discovery</dt>
            <dd className="truncate font-mono">{origin}/.well-known/oauth-authorization-server</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Registration</dt>
            <dd className="truncate font-mono">
              /api/public/oauth/register?server_id={serverId}
            </dd>
          </div>
        </dl>
      </div>

      <div className="panel space-y-3 p-5">
        <h3 className="label-caps">Active grants ({active.length})</h3>
        <p className="text-xs text-muted-foreground">
          Every grant is scoped to named tools and dies on its own. Revoke instantly to cut a client
          off mid-session.
        </p>
        <div className="space-y-2">
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">No client currently holds access.</p>
          )}
          {active.map((g) => (
            <div key={g.id} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{g.client_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(g.grant_expires_at).toLocaleString()} · {g.call_count}
                    {g.max_calls ? `/${g.max_calls}` : ""} calls
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await revokeGrant({ data: { grantId: g.id } });
                    toast.success("Grant revoked");
                    void qc.invalidateQueries({ queryKey: ["oauth", serverId] });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {g.scopes
                  .filter((s) => s.startsWith("tool:"))
                  .map((s) => (
                    <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                      {s.slice(5)}
                    </Badge>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <h3 className="label-caps pt-2">Registered clients ({data?.clients.length ?? 0})</h3>
        <div className="space-y-1.5">
          {(data?.clients ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate">{c.name}</span>
              <span className="truncate font-mono text-muted-foreground">{c.client_id}</span>
            </div>
          ))}
          {!data?.clients.length && (
            <p className="text-sm text-muted-foreground">No client has registered yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
