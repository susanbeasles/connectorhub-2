import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { applyStage, stageStatus } from "@/lib/stage.functions";

/**
 * One switch: everything private on your own infrastructure, or not.
 * Unmet prerequisites are acknowledged for you — the operator decides.
 */

type Stage = "sandbox" | "production";

export function RolloutCard() {
  const queryClient = useQueryClient();
  const status = useServerFn(stageStatus);
  const apply = useServerFn(applyStage);

  const state = useQuery({ queryKey: ["stage"], queryFn: () => status({ data: undefined }) });
  const stage = (state.data?.stage ?? "sandbox") as Stage;
  const isProduction = stage === "production";

  const flip = useMutation({
    mutationFn: (next: Stage) =>
      apply({
        data: {
          stage: next,
          acknowledge: (state.data?.readiness ?? []).filter((c) => c.state !== "pass").map((c) => c.id),
        },
      }),
    onSuccess: (report) => {
      queryClient.invalidateQueries();
      if (report.completed) toast.success(`Now running in ${report.stage}`);
      else toast.error(report.steps.find((s) => s.status === "failed")?.detail ?? "Switch stopped partway");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="panel flex flex-wrap items-center gap-4 p-6">
      {isProduction ? (
        <Rocket className="size-4 text-success" />
      ) : (
        <FlaskConical className="size-4 text-muted-foreground" />
      )}
      <div className="flex-1">
        <h2 className="font-medium">Private infrastructure</h2>
        <p className="text-sm text-muted-foreground">
          {isProduction
            ? "On — your AWS runtimes, hardware signing, 1Password custody, private network required."
            : "Off — everything runs on this deployment and stays reachable."}
        </p>
      </div>
      <Switch
        checked={isProduction}
        disabled={flip.isPending || state.isLoading}
        onCheckedChange={(next) => flip.mutate(next ? "production" : "sandbox")}
        aria-label="Private infrastructure"
      />
    </section>
  );
}
