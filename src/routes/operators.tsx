import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Empty } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useOperator } from "@/hooks/useOperator";
import { cancelInvite, invite, removeOperator, roster } from "@/lib/operator.functions";
import { AccessGateCard } from "@/components/AccessGateCard";

export const Route = createFileRoute("/operators")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Operators — Aegis Broker" },
      {
        name: "description",
        content:
          "Manage who may configure this broker. One owner, invite-only seats, no self-service signup.",
      },
      { property: "og:title", content: "Operators — Aegis Broker" },
      {
        property: "og:description",
        content: "Invite-only operator roster for a single-owner zero-trust MCP broker.",
      },
    ],
  }),
  component: OperatorsPage,
});

function OperatorsPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { operator } = useOperator();
  const queryClient = useQueryClient();

  const fetchRoster = useServerFn(roster);
  const sendInvite = useServerFn(invite);
  const dropInvite = useServerFn(cancelInvite);
  const dropOperator = useServerFn(removeOperator);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "viewer">("admin");

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const { data } = useQuery({
    queryKey: ["roster"],
    enabled: !!operator,
    queryFn: () => fetchRoster({ data: undefined }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["roster"] });
  const fail = (e: unknown) => toast.error((e as Error).message);

  const inviteMutation = useMutation({
    mutationFn: () => sendInvite({ data: { email, role } }),
    onSuccess: () => {
      setEmail("");
      toast.success("Invite added — the seat activates on their first sign-in.");
      void refresh();
    },
    onError: fail,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => dropInvite({ data: { id } }),
    onSuccess: () => void refresh(),
    onError: fail,
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => dropOperator({ data: { userId } }),
    onSuccess: () => void refresh(),
    onError: fail,
  });

  const canManage = operator?.role !== "viewer";

  return (
    <AppShell>
      <header className="mb-6">
        <p className="label-caps">Trust boundary</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Operators</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          This broker has exactly one owner. Nobody gains console access by creating an account —
          an address has to be on this roster first. Clients that call your MCP endpoints never
          need a seat here; they authenticate against their own OAuth grant.
        </p>
      </header>

      <AccessGateCard />

      {canManage ? (
        <section className="panel mb-6 p-5">
          <p className="label-caps">Add operator</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "admin" | "viewer")}>
                <SelectTrigger id="invite-role" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!email || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate()}
            >
              <UserPlus className="size-4" /> Invite
            </Button>
          </div>
        </section>
      ) : null}

      <section className="panel p-5">
        <p className="label-caps">Roster</p>
        <ul className="mt-3 divide-y divide-border">
          {(data?.operators ?? []).map((o) => (
            <li key={o.userId} className="flex items-center gap-3 py-3 text-sm">
              <span className="font-medium">{o.email}</span>
              <Badge variant={o.role === "owner" ? "default" : "secondary"}>
                {o.role === "owner" ? <Crown className="mr-1 size-3" /> : null}
                {o.role}
              </Badge>
              {canManage && o.role !== "owner" && o.userId !== operator?.userId ? (
                <Button
                  className="ml-auto"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeMutation.mutate(o.userId)}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel mt-6 p-5">
        <p className="label-caps">Pending invites</p>
        {data?.invites.length ? (
          <ul className="mt-3 divide-y divide-border">
            {data.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3 text-sm">
                <span>{i.email}</span>
                <Badge variant="secondary">{i.role}</Badge>
                {canManage ? (
                  <Button
                    className="ml-auto"
                    variant="ghost"
                    size="sm"
                    onClick={() => cancelMutation.mutate(i.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No pending invites" body="Invited addresses claim their seat on first sign-in." />
        )}
      </section>
    </AppShell>
  );
}
