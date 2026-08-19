import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ExternalLink,
  Fingerprint,
  Globe,
  Loader2,
  LogIn,
  Mail,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { startPasskeySignIn, finishPasskeySignIn } from "@/lib/passkey.functions";
import {
  githubVerifyStatus,
  redeemEmailCode,
  requestEmailCode,
  startGithubVerify,
} from "@/lib/identity/verify.functions";
import { useWebauthn } from "@/hooks/useWebauthn";
import { DomainOnboarding } from "@/components/auth/DomainOnboarding";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Aegis Broker Console" },
      {
        name: "description",
        content:
          "Verify and enter the Aegis zero-trust console: passkey, one-time code, or domain proof — one plane for both first entry and return.",
      },
      { property: "og:title", content: "Sign in — Aegis Broker Console" },
      {
        property: "og:description",
        content: "Operator access to the zero-trust MCP and connector control plane.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

/** Only same-origin relative paths survive; anything else falls back to the fleet. */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  const value = decodeURIComponent(raw);
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

type Step = "identify" | "code" | "domain";

export type SessionResult = { accessToken: string; refreshToken: string };

/** One place where a proven identity becomes a live session. */
export async function adoptSession(tokens: SessionResult, next: string) {
  const { error } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error) throw error;
  window.location.replace(next);
}

function AuthPage() {
  const { session, loading } = useAuth();
  const [step, setStep] = useState<Step>("identify");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [code, setCode] = useState("");
  const [ticket, setTicket] = useState<{ ticket: string; sessionKey: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [github, setGithub] = useState(false);
  const webauthn = useWebauthn();

  const next = safeNext(
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next"),
  );

  useEffect(() => {
    if (!loading && session) window.location.replace(next);
  }, [loading, session, next]);

  useEffect(() => {
    void githubVerifyStatus({}).then((s) => setGithub(s.configured)).catch(() => setGithub(false));
  }, []);

  async function guard<T>(run: () => Promise<T>) {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  /** Password is the plain door: same form signs in an existing seat or opens a new one. */
  const passwordSignIn = () =>
    guard(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.replace(next);
    });

  const passwordSignUp = () =>
    guard(async () => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      if (!data.session) {
        toast.success("Account created — check your email to confirm, then sign in");
        return;
      }
      window.location.replace(next);
    });

  const sendCode = () =>
    guard(async () => {
      const issued = await requestEmailCode({ data: { email } });
      setTicket({ ticket: issued.ticket, sessionKey: issued.sessionKey });
      setStep("code");
      toast.success("Code sent — it only works in this tab");
    });


  const enterCode = () =>
    guard(async () => {
      if (!ticket) return;
      const result = await redeemEmailCode({ data: { ...ticket, code } });
      await adoptSession(result, next);
    });

  const passkeySignIn = () =>
    guard(async () => {
      const origin = window.location.origin;
      const { ticket: t, options } = await startPasskeySignIn({ data: { origin } });
      const response = await startAuthentication({ optionsJSON: options as never });
      const result = await finishPasskeySignIn({ data: { origin, ticket: t, response } });
      await adoptSession(result, next);
    });


  const google = () =>
    guard(async () => {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth?next=${encodeURIComponent(next)}`,
      });
      if (result.error) throw new Error(result.error.message ?? "Sign-in failed");
      if (!result.redirected) window.location.replace(next);
    });

  const githubVerify = () =>
    guard(async () => {
      const { url } = await startGithubVerify({
        data: { redirectUri: `${window.location.origin}/auth/github` },
      });
      window.location.assign(url);
    });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <ShieldCheck className="size-6 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight">Sign in to Aegis Broker</h1>
        </div>

        <div className="panel p-6">
          <p className="label-caps">Operator access</p>
          <h2 className="mt-1 text-xl font-semibold">Verify and enter</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One plane for first entry and every return. Whatever proves who you are also signs you
            in — no second credential prompt, no link to click.
          </p>

          {step === "identify" ? (
            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email username webauthn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && email && password.length >= 8) void passwordSignIn();
                  }}
                  placeholder="••••••••"
                />
              </div>
              <Button
                className="w-full"
                disabled={busy || !email || password.length < 8}
                onClick={passwordSignIn}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                Log in
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy || !email || password.length < 8}
                onClick={passwordSignUp}
              >
                <UserPlus className="size-4" /> Create an account
              </Button>
              <Button variant="ghost" className="w-full" disabled={busy || !email} onClick={sendCode}>
                <Mail className="size-4" /> Email me a one-time code instead
              </Button>

              <Button
                variant="outline"
                className="w-full"
                disabled={busy || webauthn.state === "unsupported"}
                onClick={passkeySignIn}
              >
                <Fingerprint className="size-4" /> Passkey (MFA) — no email needed
              </Button>
              {webauthn.state === "framed" ? (
                <button
                  className="flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => window.open(window.location.href, "_blank", "noopener")}
                >
                  <ExternalLink className="size-3.5" /> Passkey prompt refused in this frame? Open
                  the console in its own tab
                </button>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" disabled={busy} onClick={google}>
                  Google
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={
                    github
                      ? githubVerify
                      : () => toast.error("GitHub verification is not configured on this broker")
                  }
                >
                  GitHub
                </Button>
              </div>
              <button
                className="flex w-full items-center justify-center gap-1.5 pt-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setStep("domain")}
              >
                <Globe className="size-3.5" /> I control a domain — verify that instead
              </button>
              <p className="text-center text-[11px] text-muted-foreground">
                A passkey is created with the seat it belongs to, never bolted onto an address
                later from a signed-out browser. Google and GitHub are read only as address oracles: does the account you are already
                signed into hold this address? Nothing else is requested or kept.
              </p>
            </div>
          ) : null}

          {step === "code" ? (
            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code">Six-digit code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  className="text-center font-mono text-lg tracking-[0.4em]"
                />
                <p className="text-[11px] text-muted-foreground">
                  Sent to {email}. Redeemable only in this tab — a code carried to another browser
                  is rejected, which is why nothing in that mail is clickable.
                </p>
              </div>
              <Button className="w-full" disabled={busy || code.length < 6} onClick={enterCode}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Verify and enter
              </Button>
              <button
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setStep("identify")}
              >
                Use a different method
              </button>
            </div>
          ) : null}

          {step === "domain" ? (
            <DomainOnboarding onBack={() => setStep("identify")} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
