import { Link, useNavigate } from "@tanstack/react-router";
import {
  ShieldCheck,
  LayoutGrid,
  Plus,
  LogOut,
  Lock,
  Users,
  Activity,
  Gauge,
  Boxes,
  Plug,
} from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useOperator } from "@/hooks/useOperator";
import { useAuth } from "@/hooks/useAuth";
import { ClaimGate } from "@/components/ClaimGate";
import { MfaGate } from "@/components/auth/MfaGate";
import { ManifestDrop } from "@/components/tools/ManifestDrop";



async function signOut(then: () => void) {
  await supabase.auth.signOut();
  then();
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { operator, loading, signedIn } = useOperator();
  const navigate = useNavigate();
  const denied = signedIn && !loading && !operator;

  return (
    <div className="min-h-screen bg-background">
      {signedIn ? <ManifestDrop /> : null}

      <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-5">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-5 text-primary" />
            <span className="tracking-tight">Aegis Broker</span>
          </Link>
          {operator ? (
            <nav className="hidden items-center gap-1 text-sm text-muted-foreground sm:flex">
              <Link
                to="/"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
                activeOptions={{ exact: true }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <LayoutGrid className="size-4" /> Fleet
                </span>
              </Link>
              <Link
                to="/servers/new"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="size-4" /> New server
                </span>
              </Link>
              <Link
                to="/telemetry"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="size-4" /> Telemetry
                </span>
              </Link>
              <Link
                to="/infrastructure"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Boxes className="size-4" /> Infra
                </span>
              </Link>
              <Link
                to="/integrations"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Plug className="size-4" /> Integrations
                </span>
              </Link>
              <Link
                to="/posture"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Gauge className="size-4" /> Posture
                </span>
              </Link>
              <Link
                to="/operators"
                className="rounded-md px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-4" /> Operators
                </span>
              </Link>


            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
              <Lock className="size-3" /> zero-trust mode
            </span>
            {user ? (
              <>
                <span className="hidden text-xs text-muted-foreground lg:inline">
                  {user.email}
                  {operator ? ` · ${operator.role}` : ""}
                </span>
                <Button
                  aria-label="Sign out"
                  variant="ghost"
                  size="sm"
                  onClick={() => void signOut(() => navigate({ to: "/auth" }))}
                >
                  <LogOut className="size-4" />
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">
        {signedIn ? (
          <MfaGate>
            {denied ? (
              <ClaimGate onSignOut={() => void signOut(() => navigate({ to: "/auth" }))} />
            ) : (
              children
            )}
          </MfaGate>
        ) : (
          children
        )}

      </main>

    </div>
  );
}
