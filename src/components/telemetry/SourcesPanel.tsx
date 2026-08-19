import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui-bits";
import {
  createIngestSource,
  rotateIngestEnrollment,
  setIngestSourceState,
  telemetrySources,
} from "@/lib/telemetry.functions";

const ENDPOINT = "/api/public/telemetry/v1/events";
const ENROLL = "/api/public/telemetry/v1/enroll";

type Issued = { ticket: string; expiresAt: string } | null;

function CopyBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
      <p className="text-xs font-medium">{label}</p>
      <code className="mt-1 block break-all font-mono text-xs">{value}</code>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Copied");
        }}
      >
        <Copy className="size-3.5" /> Copy
      </Button>
    </div>
  );
}

export function SourcesPanel() {
  const queryClient = useQueryClient();
  const fetchSources = useServerFn(telemetrySources);
  const addSource = useServerFn(createIngestSource);
  const toggleSource = useServerFn(setIngestSourceState);
  const rotate = useServerFn(rotateIngestEnrollment);

  const [name, setName] = useState("");
  const [redact, setRedact] = useState("");
  const [mode, setMode] = useState<"asymmetric" | "key">("asymmetric");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [issuedTicket, setIssuedTicket] = useState<Issued>(null);

  const sources = useQuery({ queryKey: ["telemetry", "sources"], queryFn: () => fetchSources({}) });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["telemetry", "sources"] });

  const create = useMutation({
    mutationFn: () =>
      addSource({
        data: {
          name,
          serverId: null,
          mode,
          redactKeys: redact.split(",").map((k) => k.trim()).filter(Boolean),
        },
      }),
    onSuccess: (result) => {
      setIssuedKey(result.key ?? null);
      setIssuedTicket(
        result.enrollment
          ? { ticket: result.enrollment.ticket, expiresAt: result.enrollment.expiresAt }
          : null,
      );
      setName("");
      setRedact("");
      refresh();
      toast.success(
        result.enrollment
          ? "Enrollment ticket issued — the agent generates its own key."
          : "Ingest key issued — copy it now, it is never shown again.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reIssue = useMutation({
    mutationFn: (sourceId: string) => rotate({ data: { sourceId } }),
    onSuccess: (result) => {
      setIssuedKey(null);
      setIssuedTicket({ ticket: result.ticket, expiresAt: result.expiresAt });
      refresh();
      toast.success("New enrollment ticket issued.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const flip = useMutation({
    mutationFn: (input: { sourceId: string; disabled: boolean }) => toggleSource({ data: input }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel space-y-4 p-4">
        <div>
          <p className="label-caps">New source</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Asymmetric by default: the agent generates a keypair in its own store and enrolls the
            public half. Nothing secret is ever issued, copied, or held here.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: "asymmetric", title: "Asymmetric", body: "Agent-held key, signed proofs" },
              { id: "key", title: "Shared key", body: "Fallback for callers that can't sign" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              className={`rounded-md border p-3 text-left transition ${
                mode === option.id ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
              }`}
            >
              <p className="text-sm font-medium">{option.title}</p>
              <p className="text-xs text-muted-foreground">{option.body}</p>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="source-name">Name</Label>
          <Input id="source-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="local code agent" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="source-redact">Redact (comma separated)</Label>
          <Input
            id="source-redact"
            value={redact}
            onChange={(e) => setRedact(e.target.value)}
            placeholder="sk-, ghp_, internal.example.com"
          />
        </div>
        <Button onClick={() => create.mutate()} disabled={!name || create.isPending}>
          {mode === "asymmetric" ? <ShieldCheck className="size-4" /> : <KeyRound className="size-4" />}
          {mode === "asymmetric" ? "Issue enrollment ticket" : "Issue ingest key"}
        </Button>

        {issuedKey ? <CopyBlock label="Copy this key now" value={issuedKey} /> : null}
        {issuedTicket ? (
          <CopyBlock
            label="One-time enrollment ticket"
            value={issuedTicket.ticket}
            hint={`Expires ${new Date(issuedTicket.expiresAt).toLocaleString()} · redeemable once, grants only a key binding.`}
          />
        ) : null}

        <div className="rounded-md bg-secondary p-3">
          <p className="label-caps">Enroll</p>
          <code className="mt-1 block break-all font-mono text-xs">
            POST {origin}{ENROLL} · {"{ ticket, publicJwk }"}
          </code>
          <p className="mt-2 text-xs text-muted-foreground">
            Generate ES256 locally, send the public JWK with the ticket. The private key never leaves
            the agent.
          </p>
        </div>

        <div className="rounded-md bg-secondary p-3">
          <p className="label-caps">Endpoint</p>
          <code className="mt-1 block break-all font-mono text-xs">POST {origin}{ENDPOINT}</code>
          <p className="mt-2 text-xs text-muted-foreground">
            Enrolled sources send a <code className="font-mono">DPoP</code> proof bound to the method,
            URL and payload hash — single use, so a captured request is inert. Shared-key sources send
            a bearer key. JSON, JSON array, or NDJSON.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {(sources.data ?? []).length === 0 ? (
          <Empty title="No sources" body="Provision a source to start capturing telemetry." />
        ) : (
          (sources.data ?? []).map((source) => {
            const asymmetric = source.auth_mode === "asymmetric";
            const pending = asymmetric && !source.enrolled_at;
            return (
              <div key={source.id} className="panel flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{source.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {asymmetric ? (source.jkt ? `${source.jkt.slice(0, 12)}…` : "awaiting enrollment") : `${source.key_prefix}…`}{" "}
                    ·{" "}
                    {source.last_seen_at
                      ? `last seen ${new Date(source.last_seen_at).toLocaleString()}`
                      : "never used"}
                  </p>
                </div>
                <Badge variant={asymmetric ? "outline" : "secondary"}>
                  {asymmetric ? "asymmetric" : "shared key"}
                </Badge>
                {source.disabled ? (
                  <Badge variant="destructive">disabled</Badge>
                ) : pending ? (
                  <Badge variant="secondary">pending</Badge>
                ) : (
                  <Badge variant="outline">live</Badge>
                )}
                {asymmetric ? (
                  <Button variant="ghost" size="sm" onClick={() => reIssue.mutate(source.id)}>
                    Re-enroll
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => flip.mutate({ sourceId: source.id, disabled: !source.disabled })}
                >
                  {source.disabled ? "Enable" : "Disable"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
