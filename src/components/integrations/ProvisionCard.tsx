import { useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { provisionIntegration } from "@/lib/integrations.functions";

export type ProvisionView = {
  credential: string;
  creates: string[];
  hint: string;
  docsUrl: string;
};

/**
 * The one-click path for providers with no admin OAuth grant: a single seed
 * credential the app uses to discover the estate and adopt the identities
 * already filed inside it. It creates nothing.
 */
export function ProvisionCard({
  provider,
  view,
  custody,
  seedDisownedAt,
  onChanged,
}: {
  provider: string;
  view: ProvisionView;
  /** none = seed needed, seed = seed still load-bearing, self = app-minted. */
  custody: "none" | "seed" | "self";
  seedDisownedAt: string | null;
  onChanged: () => void;
}) {
  const run = useServerFn(provisionIntegration);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await run({ data: { provider, seed } });
      setSeed("");
      toast.success("Adopted. The three service accounts are verified and the app holds custody.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Provisioning failed");
    } finally {
      setBusy(false);
    }
  };

  if (custody === "self") {
    return (
      <div className="mt-4 rounded-lg border border-success/30 bg-success/5 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-success" />
          <h4 className="text-sm font-semibold">Custody held</h4>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          The read, write and admin service accounts filed in aegis-seed were adopted and each one verified against its
          own vault. Your seed is sealed and kept solely as the custodian of aegis-seed — nothing else can read or
          replace those three, so no tier can ever overwrite the credential it authenticates with.
        </p>
        {seedDisownedAt ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="size-3.5" /> Adopted {new Date(seedDisownedAt).toLocaleString()}
          </p>
        ) : null}

      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <Wand2 className="size-4 text-primary" />
        <h4 className="text-sm font-semibold">Adopt existing 1Password estate</h4>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{view.hint}</p>
      {custody === "seed" ? (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-warning-foreground">
          At least one tier is still holding a credential the app did not adopt from aegis-seed. Paste the seed again to
          re-run adoption, or paste that tier's token in below.
        </p>
      ) : null}
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        {view.creates.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          className="max-w-md"
          type="password"
          value={seed}
          placeholder={view.credential}
          onChange={(e) => setSeed(e.target.value)}
        />
        <Button size="sm" disabled={!seed.trim() || busy} onClick={start}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          Adopt estate
        </Button>
      </div>
      <a className="mt-2 inline-block text-xs text-primary underline" href={view.docsUrl} target="_blank" rel="noreferrer">
        How to create this seed credential
      </a>
    </div>
  );
}
