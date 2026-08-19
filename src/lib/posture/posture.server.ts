import { postureChecks } from "./checks.server";
import type { PostureContext, PostureFinding, PostureReport, PostureState } from "./types";

const CREDIT: Record<PostureState, number> = { pass: 1, warn: 0.5, fail: 0, unknown: 1 };

function grade(score: number): PostureReport["grade"] {
  if (score >= 95) return "A";
  if (score >= 85) return "B";
  if (score >= 70) return "C";
  if (score >= 55) return "D";
  return "F";
}

/** One snapshot, every check, never a partial failure: a broken check reads unknown. */
export async function postureReport(ctx: PostureContext): Promise<PostureReport> {
  const findings: PostureFinding[] = await Promise.all(
    postureChecks.map(async (check) => {
      try {
        const verdict = await check.evaluate(ctx);
        return { id: check.id, domain: check.domain, title: check.title, weight: check.weight, ...verdict };
      } catch (error) {
        return {
          id: check.id,
          domain: check.domain,
          title: check.title,
          weight: check.weight,
          state: "unknown" as const,
          detail: error instanceof Error ? error.message : "Check could not run.",
        };
      }
    }),
  );

  const total = findings.reduce((sum, f) => sum + f.weight, 0) || 1;
  const earned = findings.reduce((sum, f) => sum + f.weight * CREDIT[f.state], 0);
  const score = Math.round((earned / total) * 100);
  const counts: Record<PostureState, number> = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const f of findings) counts[f.state] += 1;

  const order: PostureState[] = ["fail", "warn", "unknown", "pass"];
  findings.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || b.weight - a.weight);

  return { score, grade: grade(score), generatedAt: ctx.now.toISOString(), counts, findings };
}
