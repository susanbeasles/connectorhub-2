import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteSecurityKey,
  finishKeyRegistration,
  listSecurityKeys,
  startKeyRegistration,
  updateBrokerPolicy,
} from "@/lib/webauthn.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Policy = {
  dpop_mode: string;
  webauthn_policy: string;
  webauthn_authenticator: string;
  webauthn_sso_fallback: boolean;
  rate_limit_per_min: number;
  retention_days: number;
};

const DPOP = [
  { value: "preferred", label: "Preferred — proof honoured when offered" },
  { value: "required", label: "Required — every call must be signed" },
  { value: "disabled", label: "Disabled — bearer semantics only" },
];

const KEY_POLICY = [
  { value: "disabled", label: "Never — SSO alone approves grants" },
  { value: "write", label: "Any write scope (POST/PUT/PATCH/DELETE)" },
  { value: "delete", label: "Destructive scopes only (DELETE)" },
  { value: "always", label: "Every grant, read-only included" },
];

const AUTHENTICATORS = [
  { value: "cross_platform", label: "Physical security key only (YubiKey et al.)" },
  { value: "platform", label: "Device-bound key — no synced passkeys" },
  { value: "any", label: "Any authenticator, synced passkeys allowed" },
];

export function SecurityPanel({ serverId, policy }: { serverId: string; policy: Policy }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Policy>(policy);
  const [label, setLabel] = useState("");

  const keys = useQuery({ queryKey: ["security-keys"], queryFn: () => listSecurityKeys({}) });

  const save = useMutation({
    mutationFn: () =>
      updateBrokerPolicy({
        data: {
          serverId,
          dpop_mode: draft.dpop_mode as never,
          webauthn_policy: draft.webauthn_policy as never,
          webauthn_authenticator: draft.webauthn_authenticator as never,
          webauthn_sso_fallback: draft.webauthn_sso_fallback,
          rate_limit_per_min: Number(draft.rate_limit_per_min) || 60,
          retention_days: Number(draft.retention_days) || 30,
        },
      }),
    onSuccess: () => {
      toast.success("Policy updated");
      void qc.invalidateQueries({ queryKey: ["server", serverId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enroll = useMutation({
    mutationFn: async () => {
      const origin = window.location.origin;
      const options = await startKeyRegistration({
        data: { origin, authenticator: draft.webauthn_authenticator as never },
      });
      const response = await startRegistration({ optionsJSON: options as never });
      return finishKeyRegistration({
        data: {
          origin,
          label: label || "Security key",
          authenticator: draft.webauthn_authenticator as never,
          response,
        },
      });
    },
    onSuccess: () => {
      setLabel("");
      toast.success("Hardware key registered");
      void keys.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (keyId: string) => deleteSecurityKey({ data: { keyId } }),
    onSuccess: () => {
      toast.success("Key removed");
      void keys.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Proof-of-possession</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          A sender-constrained token is bound to the client's private key. Every call carries a
          fresh single-use signature over the method, URL and broker-issued nonce, so a captured
          token replays nowhere.
        </p>
        <div className="mt-3 max-w-md">
          <Label className="label-caps">DPoP enforcement</Label>
          <Select
            value={draft.dpop_mode}
            onValueChange={(v) => setDraft({ ...draft, dpop_mode: v })}
          >
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DPOP.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Call budget</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Ceiling on tool calls per minute, counted per grant. A looping agent throttles itself
          long before it drains an upstream quota.
        </p>
        <div className="mt-3 max-w-xs">
          <Label className="label-caps">Calls per minute</Label>
          <Input
            type="number"
            min={1}
            max={6000}
            className="mt-1"
            value={draft.rate_limit_per_min}
            onChange={(e) => setDraft({ ...draft, rate_limit_per_min: Number(e.target.value) })}
          />
        </div>
      </section>

      <section className="panel p-5">
        <h3 className="text-sm font-semibold">Log retention</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          How long raw events stay queryable. Older events are archived verbatim and folded into
          permanent daily rollups — history is never lost, only compacted.
        </p>
        <div className="mt-3 max-w-xs">
          <Label className="label-caps">Hot window (days)</Label>
          <Input
            type="number"
            min={1}
            max={3650}
            className="mt-1"
            value={draft.retention_days}
            onChange={(e) => setDraft({ ...draft, retention_days: Number(e.target.value) })}
          />
        </div>
      </section>




      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <Fingerprint className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Hardware-key approval</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Require a physical touch on the consent screen before a grant is issued.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <Label className="label-caps">Require a touch for</Label>
            <Select
              value={draft.webauthn_policy}
              onValueChange={(v) => setDraft({ ...draft, webauthn_policy: v })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEY_POLICY.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="label-caps">Accepted authenticators</Label>
            <Select
              value={draft.webauthn_authenticator}
              onValueChange={(v) => setDraft({ ...draft, webauthn_authenticator: v })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTHENTICATORS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="mt-3 flex items-center justify-between rounded-md border border-border px-3 py-2">
          <span className="text-sm">
            Allow SSO-only approval until a key is enrolled
            <span className="block text-xs text-muted-foreground">
              Bootstrap escape hatch. Once any key exists it is always required.
            </span>
          </span>
          <Switch
            checked={draft.webauthn_sso_fallback}
            onCheckedChange={(v) => setDraft({ ...draft, webauthn_sso_fallback: v })}
          />
        </label>
        <Button className="mt-4" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}Save policy
        </Button>
      </section>

      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Your authenticators</h3>
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Label (e.g. YubiKey 5C — desk)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button variant="outline" onClick={() => enroll.mutate()} disabled={enroll.isPending}>
            {enroll.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}Enroll
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {(keys.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No authenticators enrolled yet.</p>
          )}
          {(keys.data ?? []).map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{k.label}</p>
                <p className="text-xs text-muted-foreground">
                  {k.attachment === "cross-platform" ? "Physical key" : "Device key"}
                  {k.backed_up ? " · synced" : " · hardware-bound"}
                  {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!k.backed_up && <Badge variant="secondary">non-exportable</Badge>}
                <Button aria-label="Remove authenticator" size="icon" variant="ghost" onClick={() => remove.mutate(k.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
