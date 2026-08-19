import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, Network, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  provisionTunnel,
  reconcileTunnel,
  revealConnector,
  teardownTunnel,
  tunnelState,
} from "@/lib/tunnel.functions";

const STATUS_TONE: Record<string, string> = {
  live: "text-success",
  pending: "text-muted-foreground",
  degraded: "text-warning",
  failed: "text-destructive",
};

/** A private front door for this broker: tunnel, DNS and Access policy in one action. */
export function TunnelPanel({ serverId }: { serverId: string }) {
  const qc = useQueryClient();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [connector, setConnector] = useState<string | null>(null);

  const state = useQuery({
    queryKey: ["tunnel", serverId],
    queryFn: () => tunnelState({ data: { serverId } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["tunnel", serverId] });
  const fail = (e: unknown) => toast.error((e as Error).message);

  const provision = useMutation({
    mutationFn: () => provisionTunnel({ data: { serverId, origin } }),
    onSuccess: () => {
      toast.success("Tunnel provisioned.");
      void refresh();
    },
    onError: fail,
  });

  const probe = useMutation({
    mutationFn: () => reconcileTunnel({ data: { serverId, origin } }),
    onSuccess: (r) => {
      toast.success(`Tunnel ${r.status}.`);
      void refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => teardownTunnel({ data: { serverId } }),
    onSuccess: () => {
      setConnector(null);
      toast.success("Tunnel removed.");
      void refresh();
    },
    onError: fail,
  });

  const reveal = useMutation({
    mutationFn: () => revealConnector({ data: { serverId } }),
    onSuccess: (r) => setConnector(r.token),
    onError: fail,
  });

  const tunnel = state.data?.tunnel ?? null;
  const available = state.data?.available ?? false;
  const missing = state.data?.missing ?? [];

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Zero Trust tunnel</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {tunnel ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => probe.mutate()}
                disabled={probe.isPending}
                aria-label="Check tunnel health"
              >
                <RefreshCw className="size-4" /> Check
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                aria-label="Tear down tunnel"
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => provision.mutate()} disabled={!available || provision.isPending}>
              Provision tunnel
            </Button>
          )}
        </div>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        The broker creates the tunnel, its DNS record, and a Cloudflare Access application with an
        operator-only policy. No inbound port is opened and the origin is never addressable directly.
      </p>

      {!available ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Configure {missing.join(", ")} to enable provisioning.
        </p>
      ) : null}

      {tunnel ? (
        <>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="label-caps">Hostname</dt>
              <dd className="mt-0.5 truncate font-mono text-xs">{tunnel.hostname}</dd>
            </div>
            <div>
              <dt className="label-caps">Status</dt>
              <dd className={`mt-0.5 font-medium ${STATUS_TONE[tunnel.status] ?? ""}`}>
                {tunnel.status}
              </dd>
            </div>
            <div>
              <dt className="label-caps">Connectors</dt>
              <dd className="mt-0.5">{tunnel.connectors}</dd>
            </div>
            <div>
              <dt className="label-caps">Access audience</dt>
              <dd className="mt-0.5 truncate font-mono text-xs">{tunnel.accessAud ?? "—"}</dd>
            </div>
          </dl>

          {tunnel.lastError ? (
            <p className="mt-3 text-xs text-destructive">{tunnel.lastError}</p>
          ) : null}

          <div className="mt-4 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="label-caps">Connector command</span>
              {connector ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Copy connector command"
                  onClick={() => {
                    void navigator.clipboard.writeText(`cloudflared tunnel run --token ${connector}`);
                    toast.success("Copied.");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => reveal.mutate()} disabled={reveal.isPending}>
                  <Eye className="size-4" /> Reveal
                </Button>
              )}
            </div>
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
              {connector
                ? `cloudflared tunnel run --token ${connector}`
                : "Hidden. Reveal only on the host that will run the connector."}
            </p>
          </div>
        </>
      ) : null}

      {tunnel ? (
        <Badge variant="secondary" className="mt-4">
          Checked {tunnel.lastCheckedAt ? new Date(tunnel.lastCheckedAt).toLocaleString() : "never"}
        </Badge>
      ) : null}
    </section>
  );
}
