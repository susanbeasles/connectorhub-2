/** Posture is a set of independent verdicts over one snapshot of the broker. */
export type PostureState = "pass" | "warn" | "fail" | "unknown";

export type PostureDomain =
  | "ownership"
  | "identity"
  | "edge"
  | "clients"
  | "credentials"
  | "runtime"
  | "history";

export interface PostureFinding {
  id: string;
  domain: PostureDomain;
  title: string;
  state: PostureState;
  detail: string;
  /** What the operator does about it; omitted when the check passes. */
  remedy?: string;
  weight: number;
}

export interface PostureReport {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  generatedAt: string;
  counts: Record<PostureState, number>;
  findings: PostureFinding[];
}

export interface PostureContext {
  db: {
    from: (table: string) => any;
  };
  now: Date;
}

export interface PostureCheck {
  id: string;
  domain: PostureDomain;
  title: string;
  weight: number;
  evaluate: (
    ctx: PostureContext,
  ) => Promise<Pick<PostureFinding, "state" | "detail"> & { remedy?: string }>;
}
