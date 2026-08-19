import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Cloud, PlayCircle, RefreshCw, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  launchRuntime,
  reconcileRuntime,
  runtimeState,
  teardownRuntime,
} from "@/lib/deploy.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const STATUS_TONE: Record<string, string> = {
  live: "text-success",
  pending: "text-muted-foreground",
  degraded: "text-warning",
  failed: "text-destructive",
  removed: "text-muted-foreground",
};

const TARGET_COPY: Record<string, { title: string; blurb: string; icon: typeof Cloud }> = {
  inline: {
    title: "In-app runtime",
    blurb: "Served by this broker's own worker. Nothing to provision, always available.",
    icon: Server,
  },
  cloudflare: {
    title: "Isolated edge worker",
    blurb:
      "Its own script in a Workers for Platforms namespace, so one broker cannot reach another.",
    icon: Cloud,
  },
  lambda: {
    title: "Dedicated Lambda function",
    blurb:
      "Its own AWS function and public function URL, isolated per broker with its own execution role.",
    icon: Boxes,
  },
};

const TARGET_ENV: Record<string, string> = {
  inline: "nothing — this runtime is always available",
  cloudflare: "CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and CLOUDFLARE_DISPATCH_NAMESPACE",
  lambda: "the keyless AWS federation setup from Integrations",
};

/** Where this broker actually runs — launch it, tear it down, or heal drift. */
export function RuntimePanel({ serverId }: { serverId: string }) {
  const qc = useQueryClient();
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const state = useQuery({
    queryKey: ["runtime", serverId],
    queryFn: () => runtimeState({ data: { serverId } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["runtime", serverId] });
  const fail = (e: unknown) => toast.error((e as Error).message);

  const launch = useMutation({
    mutationFn: (target: "inline" | "cloudflare" | "lambda") =>
      launchRuntime({ data: { serverId, origin, target } }),
    onSuccess: () => {
      toast.success("Runtime live.");
      void refresh();
    },
    onError: fail,
  });

  const heal = useMutation({
    mutationFn: () => reconcileRuntime({ data: { serverId, origin } }),
    onSuccess: (r) => {
      toast.success(r.status === "repaired" ? "Drift detected — redeployed." : `Runtime ${r.status}.`);
      void refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => teardownRuntime({ data: { serverId, origin } }),
    onSuccess: () => {
      toast.success("Runtime torn down.");
      void refresh();
    },
    onError: fail,
  });

  const deployment = state.data?.deployment ?? null;

  return (
    <div className="space-y-4">
      <div className="panel p-5">
        <div className="flex flex-wrap items-center gap-3">
          <p className="label-caps">Current runtime</p>
          <Badge variant="outline" className={STATUS_TONE[deployment?.status ?? "pending"]}>
            {deployment?.status ?? "not deployed"}
          </Badge>
          {deployment ? <Badge variant="secondary">v{deployment.version}</Badge> : null}
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!deployment || heal.isPending}
              onClick={() => heal.mutate()}
            >
              <RefreshCw className="size-4" /> Reconcile
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!deployment || remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-4" /> Tear down
            </Button>
          </div>
        </div>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Endpoint</dt>
            <dd className="break-all font-mono text-xs">{deployment?.routeUrl ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last reconciled</dt>
            <dd>
              {deployment?.lastReconciledAt
                ? new Date(deployment.lastReconciledAt).toLocaleString()
                : "—"}
            </dd>
          </div>
          {deployment?.lastError ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Last error</dt>
              <dd className="text-destructive">{deployment.lastError}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(state.data?.targets ?? []).map(({ target, available, permitted }) => {
          const copy = TARGET_COPY[target]!;
          const Icon = copy.icon;
          return (
            <div key={target} className="panel flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <p className="font-medium">{copy.title}</p>
                {deployment?.target === target && deployment.status === "live" ? (
                  <Badge variant="secondary">active</Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{copy.blurb}</p>
              {available ? null : (
                <p className="text-xs text-warning">
                  {permitted
                    ? `Add ${TARGET_ENV[target]} to enable this runtime.`
                    : "Not available in the current rollout stage."}
                </p>
              )}
              <Button
                className="mt-auto w-fit"
                size="sm"
                disabled={!available || launch.isPending}
                onClick={() => launch.mutate(target as "inline" | "cloudflare" | "lambda")}
              >
                <PlayCircle className="size-4" /> Launch here
              </Button>
            </div>
          );
        })}
      </div>

      <div className="panel divide-y divide-border text-xs">
        <p className="label-caps p-3">Deployment history</p>
        {(state.data?.events ?? []).length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Nothing deployed yet.</p>
        ) : (
          state.data?.events.map((e) => (
            <div key={e.id} className="flex gap-3 p-3 font-mono">
              <span className="shrink-0 text-muted-foreground">
                {new Date(e.created_at).toLocaleString()}
              </span>
              <span className="shrink-0">{e.action}</span>
              <span className={`shrink-0 ${STATUS_TONE[e.status] ?? ""}`}>{e.status}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.detail}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
