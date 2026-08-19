/** Painted while a client-only route boots, so the shell is never a blank page. */
export function BootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
        Loading Aegis Broker…
      </div>
    </div>
  );
}
