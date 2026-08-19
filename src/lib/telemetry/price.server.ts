import type { Usage } from "./normalize.server";

/**
 * Token counts -> money. Prices are read from the database and snapshotted onto
 * every row, so a later price change never rewrites history.
 */

export type Price = {
  provider: string;
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cached_per_mtok: number;
};

export type Priced = Price & { cost_usd: number };

let cache: { at: number; rows: Price[] } | null = null;

async function prices(): Promise<Price[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("model_prices")
    .select("provider, model, input_per_mtok, output_per_mtok, cached_per_mtok")
    .order("effective_from", { ascending: false });
  const rows = (data ?? []).map((r) => ({
    provider: String(r.provider),
    model: String(r.model),
    input_per_mtok: Number(r.input_per_mtok),
    output_per_mtok: Number(r.output_per_mtok),
    cached_per_mtok: Number(r.cached_per_mtok),
  }));
  cache = { at: Date.now(), rows };
  return rows;
}

const ZERO: Price = {
  provider: "",
  model: "",
  input_per_mtok: 0,
  output_per_mtok: 0,
  cached_per_mtok: 0,
};

/** Longest-prefix match so `gpt-4o-2024-11-20` still bills as `gpt-4o`. */
async function match(provider: string, model: string): Promise<Price> {
  if (!model) return ZERO;
  const rows = await prices();
  const key = model.toLowerCase();
  const candidates = rows
    .filter((r) => (!provider || !r.provider || r.provider === provider) && key.startsWith(r.model.toLowerCase()))
    .sort((a, b) => b.model.length - a.model.length);
  return candidates[0] ?? ZERO;
}

export async function priceUsage(
  provider: string,
  model: string,
  usage: Usage,
  override: number | null,
): Promise<Priced> {
  const price = await match(provider, model);
  const billable = Math.max(0, usage.input - usage.cached);
  const computed =
    (billable / 1_000_000) * price.input_per_mtok +
    ((usage.output + usage.reasoning) / 1_000_000) * price.output_per_mtok +
    (usage.cached / 1_000_000) * price.cached_per_mtok;
  return { ...price, cost_usd: override ?? computed };
}
