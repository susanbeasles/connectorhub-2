import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cloud, KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  accessGate,
  closeBreakglass,
  issueBreakglassCode,
  openBreakglass,
  revokeBreakglassCode,
  setAccessMode,
} from "@/lib/access.functions";

const TONE: Record<string, string> = {
  enforce: "Private network enforced",
  monitor: "Open — verifying only",
  off: "Not configured",
};

function relative(value: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return "expired";
  return `${Math.max(1, Math.round(ms / 60_000))} min left`;
}

export function AccessGateCard() {
  const qc = useQueryClient();
  const [issued, setIssued] = useState<string | null>(null);

  const fetchGate = useServerFn(accessGate);
  const setMode = useServerFn(setAccessMode);
  const open = useServerFn(openBreakglass);
  const close = useServerFn(closeBreakglass);
  const issue = useServerFn(issueBreakglassCode);
  const revoke = useServerFn(revokeBreakglassCode);

  const { data } = useQuery({
    queryKey: ["access-gate"],
    staleTime: 15_000,
    queryFn: () => fetchGate({ data: undefined }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["access-gate"] });
  const fail = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : "That did not work");

  const mode = useMutation({
    mutationFn: (next: boolean) =>
      setMode({ data: { mode: next ? "zero_trust" : "public" } }),
    onSuccess: (policy) => {
      toast.success(
        policy.mode === "zero_trust"
          ? "Private network required for the console and proxy"
          : "Gate open — requests are verified but never blocked",
      );
      refresh();
    },
    onError: fail,
  });

  const window_ = useMutation({
    mutationFn: (minutes: number | null) =>
      minutes === null ? close({ data: undefined }) : open({ data: { minutes } }),
    onSuccess: () => refresh(),
    onError: fail,
  });

  const code = useMutation({
    mutationFn: () => issue({ data: { label: "recovery" } }),
    onSuccess: (result) => {
      setIssued(result.code);
      refresh();
    },
    onError: fail,
  });

  const drop = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: refresh,
    onError: fail,
  });

  if (!data) return null;
  const live = data.codes.filter((c) => !c.usedAt && !c.revokedAt);

  return (
    <section className="panel mb-6 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Cloudflare Access</h2>
        </div>
        <Badge variant={data.mode === "enforce" ? "default" : "secondary"}>
          {TONE[data.mode] ?? data.mode}
        </Badge>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        A second, independent gate in front of both the console and the MCP proxy. Assertions are
        verified against your team's signing keys on every request. Enforcement is yours to turn on
        and off — it is never on by default, and a recovery code can always reopen the door.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4 rounded-md border border-border/60 p-3">
        <Switch
          id="zt-gate"
          checked={data.policyMode === "zero_trust"}
          disabled={!data.configured || mode.isPending}
          onCheckedChange={(next) => mode.mutate(next)}
          aria-label="Require the private network"
        />
        <label htmlFor="zt-gate" className="text-sm">
          Require the private network
          <span className="ml-2 text-xs text-muted-foreground">
            {data.configured
              ? data.policyMode === "zero_trust"
                ? "Requests without a valid Access assertion are refused"
                : "Requests are verified and reported, never refused"
              : "Set the team domain and audience first"}
          </span>
        </label>
      </div>

      {data.breakglassActive ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <ShieldAlert className="size-4 text-warning" />
          <span>
            Breakglass open — enforcement suspended, {relative(data.breakglassUntil)}.
          </span>
          <Button size="sm" variant="outline" onClick={() => window_.mutate(null)}>
            Close now
          </Button>
        </div>
      ) : data.policyMode === "zero_trust" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>Locked out of the tunnel?</span>
          <Button size="sm" variant="outline" onClick={() => window_.mutate(30)}>
            Suspend enforcement for 30 min
          </Button>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="label-caps">Team domain</dt>
          <dd className="mt-0.5 font-mono text-xs">{data.teamDomain ?? "CF_ACCESS_TEAM_DOMAIN"}</dd>
        </div>
        <div>
          <dt className="label-caps">Applications</dt>
          <dd className="mt-0.5">
            {data.consoleAudiences} console · {data.proxyAudiences} proxy
          </dd>
        </div>
        <div>
          <dt className="label-caps">This request</dt>
          <dd className="mt-0.5">
            {data.allowed ? (data.identityEmail ?? "Allowed") : (data.reason ?? "Rejected")}
          </dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Recovery codes</h3>
            <span className="text-xs text-muted-foreground">{live.length} unused</span>
          </div>
          <Button size="sm" variant="outline" onClick={() => code.mutate()} disabled={code.isPending}>
            Issue a code
          </Button>
        </div>
        <p className="mt-2 max-w-2xl text-xs text-muted-foreground">
          A code is redeemed at <code className="font-mono">/api/public/breakglass</code> with no
          session and no tunnel, so an outage of either cannot strand you. Single use, self-expiring
          window, every redemption audited.
        </p>
        {issued ? (
          <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              Store this now — it is never shown again.
            </p>
            <p className="mt-1 font-mono text-sm">{issued}</p>
            <Button size="sm" variant="ghost" className="mt-1 px-0" onClick={() => setIssued(null)}>
              I have stored it
            </Button>
          </div>
        ) : null}
        {live.length ? (
          <ul className="mt-3 space-y-1 text-xs">
            {live.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {c.label} · issued {new Date(c.createdAt).toLocaleDateString()}
                </span>
                <Button size="sm" variant="ghost" onClick={() => drop.mutate(c.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {data.history.length ? (
        <ul className="mt-4 space-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {data.history.slice(0, 5).map((event) => (
            <li key={event.id}>
              {new Date(event.createdAt).toLocaleString()} · {event.action}
              {event.actorEmail ? ` · ${event.actorEmail}` : ""}
              {event.reason ? ` · ${event.reason}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
