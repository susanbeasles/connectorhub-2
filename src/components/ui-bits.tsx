import { cn } from "@/lib/utils";

const healthStyles: Record<string, string> = {
  healthy: "bg-success/10 text-success border-success/25",
  degraded: "bg-warning/15 text-warning-foreground border-warning/40",
  down: "bg-destructive/10 text-destructive border-destructive/25",
  unknown: "bg-muted text-muted-foreground border-border",
};

export function HealthDot({ health }: { health: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        healthStyles[health] ?? healthStyles["unknown"],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {health}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="panel p-4">
      <p className="label-caps">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-1 p-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
