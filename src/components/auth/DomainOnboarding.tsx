import { useState } from "react";
import { CheckCircle2, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkClaim, openClaim } from "@/lib/domain/domain.functions";

type Claim = Awaited<ReturnType<typeof openClaim>>;

/**
 * Zone proof registers the domain and unlocks provider configuration for it.
 * It never stands in for an identity assertion, so signing in still happens
 * through a flow that actually verifies the person.
 */
export function DomainOnboarding({ onBack }: { onBack: () => void }) {
  const [domain, setDomain] = useState("");
  const [claim, setClaim] = useState<Claim | null>(null);
  const [busy, setBusy] = useState(false);

  async function guard(run: () => Promise<void>) {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  const open = () =>
    guard(async () => {
      setClaim(await openClaim({ data: { domain } }));
    });

  const check = () =>
    guard(async () => {
      if (!claim) return;
      const result = await checkClaim({ data: { id: claim.id } });
      setClaim(result);
      if (result.status === "verified") toast.success("Zone verified");
      else toast.message("Record not visible yet — DNS may still be propagating");
    });

  const verified = claim?.status === "verified";

  return (
    <div className="mt-5 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="domain">Domain</Label>
        <div className="flex gap-2">
          <Input
            id="domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="company.com"
            disabled={!!claim}
          />
          <Button variant="outline" disabled={busy || !domain || !!claim} onClick={open}>
            Start
          </Button>
        </div>
      </div>

      {claim ? (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
          <p className="label-caps">Publish this TXT record</p>
          <div className="space-y-1 font-mono text-[11px] break-all">
            <p>{claim.recordName}</p>
            <p className="text-muted-foreground">{claim.recordValue}</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(claim.recordValue);
                toast.success("Copied");
              }}
            >
              <Copy className="size-3.5" /> Copy value
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={check}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Check DNS
            </Button>
          </div>
          {verified ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
              Zone verified. Identities in {claim.domain} still sign in through the domain&apos;s
              identity provider or an address verification — proving the zone does not by itself
              prove an identity inside it.
            </p>
          ) : null}
        </div>
      ) : null}


      <button
        className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        Back
      </button>
    </div>
  );
}
