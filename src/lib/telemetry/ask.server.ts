import type { SupabaseClient } from "@supabase/supabase-js";
import { patternReport, spendReport } from "./query.server";

/**
 * Conversation over the telemetry plane. The model never sees raw payloads —
 * only the rollups — so answering a question can't leak a prompt body.
 */

type DB = SupabaseClient<any, any, any>;

const SYSTEM = `You are the analyst for an agent-observability broker.
You are given rolled-up telemetry: spend by model, tool and skill, error counts,
cache ratios and repeated call patterns. Answer the operator's question directly,
cite the numbers you used, and name the single highest-leverage change.
If the data does not support an answer, say so plainly.`;

export async function askTelemetry(
  supabase: DB,
  input: { question: string; windowHours: number },
): Promise<{ answer: string }> {
  const [spend, patterns] = await Promise.all([
    spendReport(supabase, { windowHours: input.windowHours }),
    patternReport(supabase, { windowHours: input.windowHours }),
  ]);

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Analysis model is not configured.");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Window: last ${input.windowHours}h\n\nTelemetry:\n${JSON.stringify({ spend, patterns })}\n\nQuestion: ${input.question}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (res.status === 429) throw new Error("Analysis rate limit reached — try again shortly.");
  if (res.status === 402) throw new Error("Analysis credits exhausted.");
  if (!res.ok) throw new Error(`Analysis failed (${res.status})`);

  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return { answer: body.choices?.[0]?.message?.content ?? "No answer returned." };
}
