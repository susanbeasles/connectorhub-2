import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { adoptSession } from "@/routes/auth";
import { finishGithubVerify } from "@/lib/identity/verify.functions";

export const Route = createFileRoute("/auth/github")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Confirming your GitHub address — Aegis Broker" },
      {
        name: "description",
        content:
          "Aegis reads only the verified email on your GitHub account to confirm the address you claimed. Nothing else is requested.",
      },
      { property: "og:title", content: "Confirming your GitHub address — Aegis Broker" },
      {
        property: "og:description",
        content: "Address-only GitHub confirmation for the Aegis zero-trust console.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GithubReturn,
});

function GithubReturn() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setError("GitHub did not return a usable response");
      return;
    }
    void finishGithubVerify({
      data: { code, state, redirectUri: `${window.location.origin}/auth/github` },
    })
      .then((result) => adoptSession(result, "/"))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Verification failed"));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="panel max-w-sm p-6 text-center">
        {error ? (
          <>
            <h1 className="text-base font-semibold">Could not confirm that address</h1>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <a className="mt-4 inline-block text-sm text-primary" href="/auth">
              Back to sign in
            </a>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto size-5 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Confirming your GitHub address…</p>
          </>
        )}
      </div>
    </div>
  );
}
