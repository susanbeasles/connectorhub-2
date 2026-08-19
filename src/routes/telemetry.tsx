import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { SpendPanel } from "@/components/telemetry/SpendPanel";
import { TracePanel } from "@/components/telemetry/TracePanel";
import { SourcesPanel } from "@/components/telemetry/SourcesPanel";
import { AskPanel } from "@/components/telemetry/AskPanel";

export const Route = createFileRoute("/telemetry")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Telemetry — Aegis Broker" },
      {
        name: "description",
        content:
          "Per-request token spend, provenance chains, and plain-language analysis across every agent, tool, and skill.",
      },
      { property: "og:title", content: "Telemetry — Aegis Broker" },
      {
        property: "og:description",
        content: "Capture everything your agents do, then see exactly where the tokens and time went.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TelemetryPage,
});

const WINDOWS = [
  { value: "24", label: "Last 24 hours" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
  { value: "2160", label: "Last 90 days" },
];

function TelemetryPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [windowHours, setWindowHours] = useState(24);

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Telemetry</h1>
            <p className="text-sm text-muted-foreground">
              Everything your agents emit, normalised into one provenance chain with the money attached.
            </p>
          </div>
          <Select value={String(windowHours)} onValueChange={(v) => setWindowHours(Number(v))}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w.value} value={w.value}>
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="spend">
          <TabsList>
            <TabsTrigger value="spend">Spend</TabsTrigger>
            <TabsTrigger value="traces">Traces</TabsTrigger>
            <TabsTrigger value="ask">Ask</TabsTrigger>
            <TabsTrigger value="sources">Sources</TabsTrigger>
          </TabsList>
          <TabsContent value="spend" className="mt-4">
            <SpendPanel windowHours={windowHours} />
          </TabsContent>
          <TabsContent value="traces" className="mt-4">
            <TracePanel windowHours={windowHours} />
          </TabsContent>
          <TabsContent value="ask" className="mt-4">
            <AskPanel windowHours={windowHours} />
          </TabsContent>
          <TabsContent value="sources" className="mt-4">
            <SourcesPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
