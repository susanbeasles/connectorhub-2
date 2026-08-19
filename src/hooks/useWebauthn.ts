import { useEffect, useState } from "react";

export type WebauthnAvailability =
  | { state: "checking" }
  | { state: "ready" }
  | { state: "unsupported" }
  | { state: "framed" };

/**
 * WebAuthn can still work inside a frame when the embedder delegated
 * `publickey-credentials-get`, and the legacy featurePolicy API that used to
 * report that is gone from current browsers. Report the frame instead of
 * guessing: the ceremony is attempted, and only a real rejection escalates to
 * a top-level window.
 */
export function useWebauthn(): WebauthnAvailability {
  const [availability, setAvailability] = useState<WebauthnAvailability>({ state: "checking" });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.PublicKeyCredential) {
      setAvailability({ state: "unsupported" });
      return;
    }
    setAvailability({ state: window.self !== window.top ? "framed" : "ready" });
  }, []);

  return availability;
}
