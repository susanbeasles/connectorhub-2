/**
 * One rate-limiting boundary for the whole broker. Callers name a subject and a
 * budget; the counter itself lives in Postgres so every worker instance shares
 * the same window. Nothing else in the app may count calls.
 */

export type RateVerdict = {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
  retryAfterSec: number;
};

export async function rateHit(
  subject: string,
  limit: number,
  windowSec = 60,
): Promise<RateVerdict> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("rate_hit", {
    _subject: subject,
    _window_seconds: windowSec,
  });
  // A counter outage must never become an outage of the broker itself.
  const used = error ? 0 : Number(data ?? 0);
  const windowMs = windowSec * 1000;
  const resetMs = Math.ceil(Date.now() / windowMs) * windowMs;
  return {
    allowed: used <= limit,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetAt: new Date(resetMs).toISOString(),
    retryAfterSec: Math.max(1, Math.ceil((resetMs - Date.now()) / 1000)),
  };
}
