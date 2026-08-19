import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Plug, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Empty, Stat } from "@/components/ui-bits";
import { TierCard } from "@/components/integrations/TierCard";
import { ProvisionCard } from "@/components/integrations/ProvisionCard";
import { AwsBootstrapCard } from "@/components/integrations/AwsBootstrapCard";
import { listIntegrations } from "@/lib/integrations.functions";

export const Route = createFileRoute("/integrations")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Integrations — Aegis Broker" },
      {
        name: "description",
        content:
          "One-click, scripted or manual least-privilege setup for Cloudflare, AWS, GitHub, Slack, Sentry, 1Password and LLM clients.",
      },
      { property: "og:title", content: "Integrations — Aegis Broker" },
      {
        property: "og:description",
        content: "Split read, write and destructive credentials across tiered vaults with zero standing admin access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const load = useServerFn(listIntegrations);
  const { data, isLoading, refetch } = useQuery({ queryKey: ["integrations"], queryFn: () => load({}) });

  const services = data?.catalog.filter((c) => c.kind === "service") ?? [];
  const clients = data?.catalog.filter((c) => c.kind === "client") ?? [];
  const connected = data?.states.filter((s) => s.status !== "not_connected" && s.status !== "revoked").length ?? 0;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-8">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every provider installs as three separate credentials. Read can never write, write is unlocked by a second
            factor, and destructive access is owner-only behind a hardware key. Install with one click, or download the
            same steps as a plain shell script and run them yourself.
          </p>
        </header>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading integrations…
          </div>
        ) : !data ? (
          <Empty title="Nothing to show" body="Integrations could not be loaded." />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Connected" value={connected} hint={`of ${data.catalog.length} providers`} />
              <Stat
                label="Vault custody"
                value={data.vaultConnected ? "1Password" : "sealed locally"}
                hint={
                  data.vaultConnected
                    ? "Secrets live in tiered vaults; the app holds references"
                    : "Connect 1Password to move secrets out of the broker database"
                }
              />
              <Stat label="Expiring soon" value={data.expiring.length} hint="within 30 days" />
            </div>

            {data.expiring.length ? (
              <div className="panel flex items-start gap-2 border-warning/40 bg-warning/5 p-4 text-sm">
                <AlertTriangle className="mt-0.5 size-4 text-warning-foreground" />
                <div>
                  <p className="font-medium">Credentials approaching expiry</p>
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {data.expiring.map((e) => (
                      <li key={`${e.provider}-${e.tier}`}>
                        {e.provider} · {e.tier} · {new Date(e.expiresAt).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            <section className="space-y-4">
              <h2 className="label-caps">Infrastructure and services</h2>
              {services.map((provider) => {
                const state = data.states.find((s) => s.provider === provider.id);
                return (
                  <article key={provider.id} className="panel p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Plug className="size-4 text-primary" />
                      <h3 className="font-semibold tracking-tight">{provider.label}</h3>
                      <Badge variant="outline" className="capitalize">
                        {(state?.status ?? "not_connected").replace("_", " ")}
                      </Badge>
                      {provider.oneClick || provider.selfProvision ? null : (
                        <Badge variant="outline" className="text-muted-foreground">
                          script or manual
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{provider.summary}</p>
                    {provider.id === "aws" ? (
                      <AwsBootstrapCard
                        configured={state?.tiers.some((tier) => tier.tier === "write" && tier.present) ?? false}
                        onChanged={() => void refetch()}
                      />
                    ) : null}
                    {provider.selfProvision ? (
                      <ProvisionCard
                        provider={provider.id}
                        view={provider.selfProvision}
                        custody={state?.custody ?? "none"}
                        seedDisownedAt={state?.seedDisownedAt ?? null}
                        onChanged={() => void refetch()}
                      />
                    ) : null}
                    {provider.id === "aws" ? null : (
                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      {provider.tiers.map((tier) => {
                        const ts = state?.tiers.find((t) => t.tier === tier.tier);
                        return (
                          <TierCard
                            key={tier.tier}
                            provider={provider.id}
                            oneClick={provider.oneClick}
                            view={tier}
                            present={ts?.present ?? false}
                            installedVia={ts?.installedVia ?? null}
                            selfMinted={!!ts?.identity}
                            expiresAt={ts?.expiresAt ?? null}
                            rotatedAt={ts?.rotatedAt ?? null}
                            onChanged={() => void refetch()}
                          />
                        );
                      })}
                    </div>
                    )}
                  </article>
                );
              })}
            </section>

            <section className="space-y-4">
              <h2 className="label-caps">Model clients</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {clients.map((provider) => (
                  <article key={provider.id} className="panel p-5">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="size-4 text-primary" />
                      <h3 className="font-semibold tracking-tight">{provider.label}</h3>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{provider.summary}</p>
                    <div className="mt-3 space-y-3">
                      {provider.tiers.map((tier) => {
                        const ts = data.states
                          .find((s) => s.provider === provider.id)
                          ?.tiers.find((t) => t.tier === tier.tier);
                        return (
                          <TierCard
                            key={tier.tier}
                            provider={provider.id}
                            oneClick={provider.oneClick}
                            view={tier}
                            present={ts?.present ?? false}
                            installedVia={ts?.installedVia ?? null}
                            selfMinted={!!ts?.identity}
                            expiresAt={ts?.expiresAt ?? null}
                            rotatedAt={ts?.rotatedAt ?? null}
                            onChanged={() => void refetch()}
                          />
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
