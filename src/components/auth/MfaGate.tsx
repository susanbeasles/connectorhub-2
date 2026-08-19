import { useEffect, useState } from "react";
import { ExternalLink, Fingerprint, Loader2, ShieldAlert, Smartphone } from "lucide-react";
import { startRegistration } from "@simplewebauthn/browser";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  enrollFactor,
  finishFactorKey,
  mfaStatus,
  mintRecoveryCodes,
  startFactorKey,
} from "@/lib/mfa/mfa.functions";

import { useWebauthn } from "@/hooks/useWebauthn";

/**
 * A seat without a second factor gets the enrollment screen and nothing else.
 * There is no "remind me later": the console it would otherwise show is the
 * thing the factor exists to protect.
 */
export function MfaGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"checking" | "enrolled" | "missing">("checking");
  const [busy, setBusy] = useState(false);
  const [totp, setTotp] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const webauthn = useWebauthn();

  useEffect(() => {
    void mfaStatus({})
      .then((s) => setState(s.enrolled ? "enrolled" : "missing"))
      .catch(() => setState("enrolled"));
  }, []);

  async function guard(run: () => Promise<void>) {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enrollment failed");
    } finally {
      setBusy(false);
    }
  }

  /** A frame that refuses the ceremony is not a failure to report — it is a window to open. */
  const escalate = () => {
    toast.message("Opening the console in its own tab so your device can prompt you.");
    window.open(window.location.href, "_blank", "noopener");
  };

  const addPasskey = () =>
    guard(async () => {
      const origin = window.location.origin;
      try {
        const options = await startFactorKey({ data: { origin } });
        const response = await startRegistration({ optionsJSON: options as never });
        await finishFactorKey({ data: { origin, label: "Passkey", response } });
        await enrollFactor({ data: { kind: "passkey", reference: response.id, label: "Passkey" } });
        setCodes((await mintRecoveryCodes({})).codes);
        setState("enrolled");
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        const refusedInFrame =
          webauthn.state === "framed" &&
          ["NotAllowedError", "SecurityError", "NotSupportedError", "AbortError"].includes(name);
        if (!refusedInFrame) throw e;
        escalate();
      }
    });


  const beginTotp = () =>
    guard(async () => {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setTotp({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    });

  const confirmTotp = () =>
    guard(async () => {
      if (!totp) return;
      const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.data.id,
        code,
      });
      if (verified.error) throw verified.error;
      await enrollFactor({ data: { kind: "totp", reference: totp.id, label: "Authenticator app" } });
      setCodes((await mintRecoveryCodes({})).codes);
      setState("enrolled");
    });

  if (state === "checking") {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === "enrolled" && !codes) return <>{children}</>;

  if (codes) {
    return (
      <div className="panel mx-auto max-w-md p-6">
        <h2 className="text-lg font-semibold">Save your recovery codes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Shown once. Each works a single time if you lose every factor.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-xs">
          {codes.map((c) => (
            <li key={c} className="rounded border border-border bg-muted/40 px-2 py-1.5">
              {c}
            </li>
          ))}
        </ul>
        <Button className="mt-5 w-full" onClick={() => setCodes(null)}>
          I have stored them
        </Button>
      </div>
    );
  }

  return (
    <div className="panel mx-auto max-w-md p-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">Add a second factor</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        This seat can broker credentials for third-party accounts. It does not open until a factor
        is bound to it.
      </p>

      <div className="mt-5 space-y-3">
        <Button
          className="w-full"
          disabled={busy || webauthn.state === "unsupported"}
          onClick={addPasskey}
        >
          <Fingerprint className="size-4" /> Passkey or security key
        </Button>
        {webauthn.state === "framed" ? (
          <Button variant="outline" className="w-full" onClick={escalate}>
            <ExternalLink className="size-4" /> Open the console in its own tab
          </Button>
        ) : null}

        {totp ? (
          <div className="space-y-3 rounded-md border border-border p-3">
            <img src={totp.qr} alt="TOTP enrollment QR code" className="mx-auto size-40" />
            <p className="break-all text-center font-mono text-[11px] text-muted-foreground">
              {totp.secret}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="totp">Code from your app</Label>
              <Input
                id="totp"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="text-center font-mono tracking-[0.4em]"
              />
            </div>
            <Button className="w-full" disabled={busy || code.length < 6} onClick={confirmTotp}>
              Confirm authenticator
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full" disabled={busy} onClick={beginTotp}>
            <Smartphone className="size-4" /> Authenticator app (TOTP)
          </Button>
        )}
      </div>
    </div>
  );
}
