import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bootstrapZeroTrust, zeroTrustState } from "@/lib/tunnel.functions";
import { cn } from "@/lib/utils";

/**
 * Detects whether the Cloudflare account has a Zero Trust estate at all and,
 * when it does not, builds the whole thing in one action so tunnel management
 * is usable immediately.
 */
export function ZeroTrustCard() {
  const qc = useQueryClient();
  const inspect = useServerFn(zeroTrustState);
  const build = useServerFn(bootstrapZeroTrust);

  const state = useQuery({ queryKey: ["zero-trust"], queryFn: () => inspect({ data: undefined }) });

  const setup = useMutation({
    mutationFn: () => build({ data: {} }),
    onSuccess: (r) => {
      toast.success(
        r.created.length ? `Configured ${r.created.length} missing piece(s).` : "Estate already complete.",
      );
      void qc.invalidateQueries({ queryKey: ["zero-trust"] });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const data = state.data;
  const pending = data?.checks.filter((c) => !c.ready) ?? [];

  return (
    <section className="panel mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Zero Trust private network</h2>
        </div>
        <div className="flex items-center gap-2">
          {data ? (
            <Badge variant={data.ready ? "default" : "secondary"}>
              {!data.configured ? "Not connected" : data.ready ? "Configured" : `${pending.length} missing`}
            </Badge>
          ) : null}
          {data?.configured && !data.ready ? (
            <Button size="sm" onClick={() => setup.mutate()} disabled={setup.isPending}>
              {setup.isPending ? "Configuring…" : "Set it up for me"}
            </Button>
          ) : null}
        </div>
      </div>

      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Tunnels assume the account already has an organisation, a login method, Gateway and a device
        enrollment rule. If any of it is missing, this builds it end to end — operators install WARP,
        sign in, and the brokers become reachable on the private network only.
      </p>

      {data && !data.configured ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Add {data.missing.join(", ")} to let the broker inspect and configure Zero Trust.
        </p>
      ) : null}

      {data?.teamDomain ? (
        <p className="mt-3 font-mono text-xs text-muted-foreground">{data.teamDomain}</p>
      ) : null}

      {data?.checks.length ? (
        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          {data.checks.map((c) => (
            <li key={c.step} className="flex items-start gap-2">
              {c.ready ? (
                <Check className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <X className="mt-0.5 size-4 shrink-0 text-warning" />
              )}
              <span>
                <span className={cn("font-medium", !c.ready && "text-warning")}>{c.label}</span>
                <span className="block text-xs text-muted-foreground">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
