import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { claimInstanceSeat, instanceClaim } from "@/lib/bootstrap.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Everything an authenticated-but-unseated identity may see: either the
 * one-time ownership ceremony, or a flat denial.
 */
export function ClaimGate({ onSignOut }: { onSignOut: () => void }) {
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");
  const [recovery, setRecovery] = useState<string | null>(null);

  const state = useQuery({ queryKey: ["instance-claim"], queryFn: () => instanceClaim({}) });

  const claim = useMutation({
    mutationFn: () => claimInstanceSeat({ data: { secret } }),
    onSuccess: (result) => {
      setRecovery(result.recoveryCode);
      void qc.invalidateQueries({ queryKey: ["operator"] });
      void qc.invalidateQueries({ queryKey: ["instance-claim"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (state.isLoading) {
    return <Loader2 className="mx-auto mt-16 size-5 animate-spin text-muted-foreground" />;
  }

  if (recovery) {
    return (
      <div className="panel mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold">Instance claimed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Store this recovery code somewhere offline. It is shown once and kept only as a hash — no
          one, including this console, can print it again.
        </p>
        <code className="mt-4 block break-all rounded-md bg-secondary p-3 font-mono text-xs">
          {recovery}
        </code>
        <Button className="mt-5 w-full" onClick={() => window.location.reload()}>
          Enter the console
        </Button>
      </div>
    );
  }

  if (state.data?.claimed) {
    return (
      <div className="panel mx-auto max-w-md p-6 text-center">
        <ShieldX className="mx-auto size-6 text-destructive" />
        <h1 className="mt-3 text-lg font-semibold">Not an operator</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This broker belongs to a single owner. Signing in does not grant access — the owner has to
          add your address to the operator roster first. Nothing in this console is reachable until
          they do.
        </p>
        <Button className="mt-5" variant="outline" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="panel mx-auto max-w-md p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Claim this instance</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        No owner exists yet. Claiming binds this deployment to your identity permanently; every
        other operator is added by invitation afterwards.
      </p>
      {state.data?.requiresSecret ? (
        <>
          <div className="mt-4">
            <Label className="label-caps">Bootstrap secret</Label>
            <Input
              className="mt-1"
              type="password"
              autoComplete="off"
              placeholder="Deployment-time BOOTSTRAP_SECRET"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          <Button
            className="mt-5 w-full"
            disabled={claim.isPending || !secret}
            onClick={() => claim.mutate()}
          >
            {claim.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Claim ownership
          </Button>
        </>
      ) : (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-muted-foreground">
          Unclaimed and unprotected: no BOOTSTRAP_SECRET is configured, so this console refuses to
          seat anyone. First-come ownership is not a path here. Set the deployment secret, then
          reload and claim with it.
        </p>
      )}

      <Button className="mt-2 w-full" variant="ghost" onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  );
}
