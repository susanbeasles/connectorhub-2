import { useState } from "react";
import { Check, Download, KeyRound, Loader2, RefreshCw, ShieldAlert, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  integrationScript,
  revokeIntegration,
  rotateIntegration,
  saveIntegrationSecret,
  startIntegration,
} from "@/lib/integrations.functions";
import type { Tier } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

type Scope = { name: string; grants: string; why: string };
type Manual = { title: string; url?: string; detail: string; why: string };

export type TierView = {
  tier: Tier;
  summary: string;
  lifetime: string;
  vault: string;
  capabilities: string[];
  scopes: Scope[];
  manual: Manual[];
  lastResort: string | null;
};

const TIER_STYLE: Record<Tier, string> = {
  read: "border-success/25 bg-success/5",
  write: "border-warning/40 bg-warning/5",
  destructive: "border-destructive/25 bg-destructive/5",
};

const TIER_NOTE: Record<Tier, string> = {
  read: "Installed on its own. Nothing it holds can change anything.",
  write: "Needs a verified second factor. Kept apart from read so a leaked reader cannot write.",
  destructive: "Owner only, unlocked by a hardware key touch, in its own vault.",
};

export function TierCard({
  provider,
  oneClick,
  view,
  present,
  installedVia,
  selfMinted,
  expiresAt,
  rotatedAt,
  onChanged,
}: {
  provider: string;
  oneClick: boolean;
  view: TierView;
  present: boolean;
  installedVia: string | null;
  /** True once the app minted this credential itself and can re-mint it. */
  selfMinted?: boolean;
  expiresAt?: string | null;
  rotatedAt?: string | null;
  onChanged: () => void;
}) {
  const begin = useServerFn(startIntegration);
  const script = useServerFn(integrationScript);
  const save = useServerFn(saveIntegrationSecret);
  const revoke = useServerFn(revokeIntegration);
  const rotateNow = useServerFn(rotateIntegration);
  const [busy, setBusy] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [value, setValue] = useState("");

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const install = () =>
    run("install", async () => {
      const { authorizeUrl } = await begin({
        data: { provider, tier: view.tier, origin: window.location.origin },
      });
      window.open(authorizeUrl, "_blank", "noopener,width=680,height=860");
      toast.info("Approve the scopes in the new window; the admin grant is revoked as soon as minting finishes.");
    });

  const download = (withVault: boolean) =>
    run(withVault ? "vault-script" : "script", async () => {
      const rendered = await script({ data: { provider, tier: view.tier, withVault } });
      const url = URL.createObjectURL(new Blob([rendered.body], { type: "text/x-shellscript" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = rendered.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${rendered.filename} downloaded (checksum ${rendered.checksum})`);
    });

  const paste = () =>
    run("save", async () => {
      await save({ data: { provider, tier: view.tier, value: value.trim() } });
      setValue("");
      setPasting(false);
      toast.success("Filed in the vault. The app keeps only a reference.");
      onChanged();
    });

  return (
    <div className={cn("rounded-lg border p-4", TIER_STYLE[view.tier])}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold capitalize">{view.tier}</h3>
        {present ? (
          <Badge variant="outline" className="gap-1 border-success/30 text-success">
            <Check className="size-3" /> installed{installedVia ? ` · ${installedVia}` : ""}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            not installed
          </Badge>
        )}
        <Badge variant="outline" className="font-mono text-[11px]">
          {view.lifetime}
        </Badge>
        <Badge variant="outline" className="font-mono text-[11px]">
          {view.vault}
        </Badge>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{view.summary}</p>
      <p className="mt-1 text-xs text-muted-foreground">{TIER_NOTE[view.tier]}</p>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          Exactly what it asks for ({view.scopes.length})
        </summary>
        <ul className="mt-2 space-y-2">
          {view.scopes.map((scope) => (
            <li key={scope.name} className="rounded-md border border-border/60 bg-background/60 p-2">
              <p className="font-mono text-xs">{scope.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{scope.grants}</p>
              <p className="text-xs text-muted-foreground">Needed for: {scope.why}</p>
            </li>
          ))}
        </ul>
        {view.lastResort ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-foreground">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" /> {view.lastResort}
          </p>
        ) : null}
      </details>

      {view.manual.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground">Do it by hand instead</summary>
          <ol className="mt-2 space-y-2 text-xs text-muted-foreground">
            {view.manual.map((step, i) => (
              <li key={step.title}>
                <span className="font-medium text-foreground">
                  {i + 1}. {step.title}
                </span>
                <p>{step.detail}</p>
                <p>Why: {step.why}</p>
                {step.url ? (
                  <a className="text-primary underline" href={step.url} target="_blank" rel="noreferrer">
                    {step.url}
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {oneClick ? (
          <Button size="sm" disabled={!!busy} onClick={install}>
            {busy === "install" ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
            One-click install
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => download(false)}>
          {busy === "script" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          Script
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => download(true)}>
          {busy === "vault-script" ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
          Script + 1Password
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPasting((p) => !p)}>
          Paste credential
        </Button>
        {present && selfMinted ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              run("rotate", async () => {
                await rotateNow({ data: { provider, tier: view.tier } });
                toast.success("Rotated. The previous identity no longer exists.");
                onChanged();
              })
            }
          >
            {busy === "rotate" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Rotate now
          </Button>
        ) : null}
        {present ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Destroy the ${view.tier} credential`}
            className="text-destructive"
            disabled={!!busy}
            onClick={() =>
              run("revoke", async () => {
                await revoke({ data: { provider, tier: view.tier } });
                toast.success("Credential destroyed");
                onChanged();
              })
            }
          >
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {pasting ? (
        <div className="mt-2 flex gap-2">
          <Input
            type="password"
            value={value}
            placeholder={`Paste the ${view.tier} credential`}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button size="sm" disabled={!value.trim() || !!busy} onClick={paste}>
            {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : "File it"}
          </Button>
        </div>
      ) : null}

      {present && (expiresAt || rotatedAt) ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {selfMinted ? "App-minted · " : ""}
          {expiresAt ? `expires ${new Date(expiresAt).toLocaleDateString()}` : "no expiry"}
          {rotatedAt ? ` · last rotated ${new Date(rotatedAt).toLocaleDateString()}` : ""}
        </p>
      ) : null}

      {view.capabilities.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Unlocks: {view.capabilities.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
