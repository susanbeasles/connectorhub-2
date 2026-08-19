import type { PostureCheck, PostureContext } from "./types";

const DAY = 86_400_000;

async function count(ctx: PostureContext, table: string, shape: (q: any) => any): Promise<number> {
  const { count: n } = await shape(ctx.db.from(table).select("*", { count: "exact", head: true }));
  return n ?? 0;
}

const ownershipClaimed: PostureCheck = {
  id: "ownership.claimed",
  domain: "ownership",
  title: "Ownership ceremony completed",
  weight: 3,
  async evaluate(ctx) {
    const { data } = await ctx.db.from("instance_claim").select("*").maybeSingle();
    if (!data?.claimed_at)
      return {
        state: "fail" as const,
        detail: "No owner is seated on this broker.",
        remedy: "Sign in and complete the claim ceremony with the deployment secret.",
      };
    if (data.recovery_used_at)
      return {
        state: "warn" as const,
        detail: "The one-time recovery code has been consumed.",
        remedy: "Re-issue a recovery code so the seat stays recoverable.",
      };
    return { state: "pass" as const, detail: `Owner seated ${data.claimed_email ?? ""}`.trim() };
  },
};

const bootstrapSecret: PostureCheck = {
  id: "ownership.secret",
  domain: "ownership",
  title: "Deployment secret configured",
  weight: 2,
  async evaluate() {
    return process.env["BOOTSTRAP_SECRET"]
      ? { state: "pass" as const, detail: "Claiming requires the deployment secret." }
      : {
          state: "fail" as const,
          detail: "BOOTSTRAP_SECRET is absent; the claim path is closed.",
          remedy: "Set BOOTSTRAP_SECRET in the deployment environment.",
        };
  },
};

const signingAttested: PostureCheck = {
  id: "ownership.attestation",
  domain: "ownership",
  title: "Signing identity attested",
  weight: 2,
  async evaluate(ctx) {
    const { data: keys } = await ctx.db.from("signing_keys").select("kid, active").eq("active", true);
    if (!keys?.length)
      return {
        state: "warn" as const,
        detail: "No active broker signing key yet; one is minted on first token issue.",
      };
    const trusted = await count(ctx, "attestations", (q: any) => q.eq("trusted", true));
    return trusted
      ? { state: "pass" as const, detail: `${keys.length} active key, ${trusted} trusted attestation(s).` }
      : {
          state: "warn" as const,
          detail: "The active signing key has no trusted attestation.",
          remedy: "Pin the key on the Operators page to close the chain.",
        };
  },
};

const signingCustody: PostureCheck = {
  id: "ownership.custody",
  domain: "ownership",
  title: "Broker key held in hardware",
  weight: 3,
  async evaluate() {
    const { brokerSigner } = await import("@/lib/signing/index.server");
    const custody = (await brokerSigner()).custody();
    return custody === "kms"
      ? {
          state: "pass" as const,
          detail: "Signatures are produced inside your KMS HSM; the private key cannot be exported.",
        }
      : {
          state: "warn" as const,
          detail: "The broker key is sealed with the deployment vault key rather than an HSM.",
          remedy: "Run the AWS CloudShell bootstrap so signing moves into a KMS key you own.",
        };
  },
};

const mfaCoverage: PostureCheck = {
  id: "identity.mfa",
  domain: "identity",
  title: "Every operator holds a second factor",
  weight: 3,
  async evaluate(ctx) {
    const { data: ops } = await ctx.db.from("operators").select("user_id, email");
    const { data: factors } = await ctx.db.from("mfa_factors").select("user_id, verified_at");
    const enrolled = new Set(
      (factors ?? []).filter((f: any) => f.verified_at).map((f: any) => f.user_id),
    );
    const naked = (ops ?? []).filter((o: any) => !enrolled.has(o.user_id));
    if (!ops?.length) return { state: "unknown" as const, detail: "No operators seated." };
    return naked.length
      ? {
          state: "fail" as const,
          detail: `${naked.length} of ${ops.length} operator(s) have no verified factor.`,
          remedy: "Have them enroll a passkey at the MFA gate, or remove the seat.",
        }
      : { state: "pass" as const, detail: `All ${ops.length} operator(s) carry a verified factor.` };
  },
};

const passkeyPreference: PostureCheck = {
  id: "identity.passkey",
  domain: "identity",
  title: "Hardware-backed factors in use",
  weight: 1,
  async evaluate(ctx) {
    const creds = await count(ctx, "webauthn_credentials", (q: any) => q);
    return creds
      ? { state: "pass" as const, detail: `${creds} passkey/security key registered.` }
      : {
          state: "warn" as const,
          detail: "Only authenticator-app factors are registered.",
          remedy: "Enroll a passkey or security key for phishing-resistant entry.",
        };
  },
};

const staleInvites: PostureCheck = {
  id: "identity.invites",
  domain: "identity",
  title: "No stale operator invites",
  weight: 1,
  async evaluate(ctx) {
    const cutoff = new Date(ctx.now.getTime() - 14 * DAY).toISOString();
    const stale = await count(ctx, "operator_invites", (q: any) => q.lt("created_at", cutoff));
    return stale
      ? {
          state: "warn" as const,
          detail: `${stale} invite(s) older than 14 days are still open.`,
          remedy: "Cancel unclaimed invites on the Operators page.",
        }
      : { state: "pass" as const, detail: "No invite has been left hanging." };
  },
};

const edgeGate: PostureCheck = {
  id: "edge.access",
  domain: "edge",
  title: "Cloudflare Access in front of the console",
  weight: 3,
  async evaluate() {
    const { accessConfig } = await import("@/lib/access/config.server");
    const cfg = accessConfig();
    if (cfg.mode === "enforce")
      return { state: "pass" as const, detail: `Enforcing against ${cfg.teamDomain}.` };
    if (cfg.mode === "monitor")
      return {
        state: "warn" as const,
        detail: "Access assertions are logged but not enforced.",
        remedy: "Set CF_ACCESS_MODE=enforce once the audience is verified.",
      };
    return {
      state: "fail" as const,
      detail: "No edge gate; the console relies on app auth alone.",
      remedy: "Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, then enforce.",
    };
  },
};

const dpopEnforcement: PostureCheck = {
  id: "clients.dpop",
  domain: "clients",
  title: "Tokens are sender-constrained",
  weight: 3,
  async evaluate(ctx) {
    const { data } = await ctx.db.from("servers").select("name, dpop_mode").eq("enabled", true);
    const rows = data ?? [];
    if (!rows.length) return { state: "unknown" as const, detail: "No enabled brokers." };
    const loose = rows.filter((s: any) => s.dpop_mode !== "require");
    return loose.length
      ? {
          state: "warn" as const,
          detail: `${loose.length} of ${rows.length} broker(s) accept bearer-only proofs.`,
          remedy: "Set DPoP to required under each broker's Security tab.",
        }
      : { state: "pass" as const, detail: "Every broker demands a DPoP proof." };
  },
};

const legacyTokens: PostureCheck = {
  id: "clients.legacy",
  domain: "clients",
  title: "Legacy bearer tokens retired",
  weight: 2,
  async evaluate(ctx) {
    const live = await count(ctx, "access_tokens", (q: any) =>
      q.is("revoked_at", null).gt("expires_at", ctx.now.toISOString()),
    );
    return live
      ? {
          state: "warn" as const,
          detail: `${live} live fallback token(s) still accepted.`,
          remedy: "Migrate those clients to OAuth 2.1 and revoke the tokens.",
        }
      : { state: "pass" as const, detail: "All client access runs through OAuth 2.1." };
  },
};

const grantHygiene: PostureCheck = {
  id: "clients.grants",
  domain: "clients",
  title: "Grants are short-lived and bound",
  weight: 2,
  async evaluate(ctx) {
    const { data } = await ctx.db
      .from("oauth_grants")
      .select("client_name, cnf_jkt, grant_expires_at, revoked_at")
      .is("revoked_at", null)
      .gt("grant_expires_at", ctx.now.toISOString());
    const rows = data ?? [];
    if (!rows.length) return { state: "unknown" as const, detail: "No active grants." };
    const unbound = rows.filter((g: any) => !g.cnf_jkt);
    return unbound.length
      ? {
          state: "warn" as const,
          detail: `${unbound.length} of ${rows.length} active grant(s) carry no key binding.`,
          remedy: "Revoke them and re-consent with a DPoP-capable client.",
        }
      : { state: "pass" as const, detail: `${rows.length} active grant(s), all key-bound.` };
  },
};

const credentialExpiry: PostureCheck = {
  id: "credentials.expiry",
  domain: "credentials",
  title: "Upstream credentials are fresh",
  weight: 2,
  async evaluate(ctx) {
    const soon = new Date(ctx.now.getTime() + 7 * DAY).toISOString();
    const expiring = await count(ctx, "credentials", (q: any) =>
      q.not("expires_at", "is", null).lt("expires_at", soon),
    );
    return expiring
      ? {
          state: "warn" as const,
          detail: `${expiring} credential(s) expire within 7 days.`,
          remedy: "Rotate them from the broker's Credentials tab.",
        }
      : { state: "pass" as const, detail: "No credential expires in the next week." };
  },
};

const approvalBacklog: PostureCheck = {
  id: "runtime.approvals",
  domain: "runtime",
  title: "No abandoned approval requests",
  weight: 1,
  async evaluate(ctx) {
    const pending = await count(ctx, "approvals", (q: any) =>
      q.eq("status", "pending").lt("expires_at", ctx.now.toISOString()),
    );
    return pending
      ? {
          state: "warn" as const,
          detail: `${pending} approval request(s) expired undecided.`,
          remedy: "Clear the queue so callers are not silently stalled.",
        }
      : { state: "pass" as const, detail: "Approval queue is current." };
  },
};

const fleetHealth: PostureCheck = {
  id: "runtime.health",
  domain: "runtime",
  title: "Fleet is healthy",
  weight: 2,
  async evaluate(ctx) {
    const { data } = await ctx.db.from("servers").select("name, health").eq("enabled", true);
    const rows = data ?? [];
    if (!rows.length) return { state: "unknown" as const, detail: "No enabled brokers." };
    const bad = rows.filter((s: any) => s.health === "down");
    const soft = rows.filter((s: any) => s.health === "degraded" || s.health === "unknown");
    if (bad.length)
      return {
        state: "fail" as const,
        detail: `${bad.length} broker(s) failing upstream probes.`,
        remedy: "Check the upstream base URL and credentials.",
      };
    if (soft.length)
      return {
        state: "warn" as const,
        detail: `${soft.length} broker(s) degraded or never probed.`,
        remedy: "Run a health check from the broker console.",
      };
    return { state: "pass" as const, detail: `All ${rows.length} broker(s) healthy.` };
  },
};

const archiveDurability: PostureCheck = {
  id: "history.archive",
  domain: "history",
  title: "History lands in durable storage",
  weight: 2,
  async evaluate(ctx) {
    const { data } = await ctx.db
      .from("telemetry_archive")
      .select("stored_in")
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = data ?? [];
    if (!rows.length)
      return { state: "unknown" as const, detail: "Nothing archived yet." };
    const dbOnly = rows.filter((r: any) => r.stored_in !== "s3");
    return dbOnly.length
      ? {
          state: "warn" as const,
          detail: `${dbOnly.length} of the last ${rows.length} batches stayed in the database.`,
          remedy: "Configure the S3 archive so audit history survives the database.",
        }
      : { state: "pass" as const, detail: "Recent batches are all in object storage." };
  },
};

const auditContinuity: PostureCheck = {
  id: "history.audit",
  domain: "history",
  title: "Audit trail is being written",
  weight: 2,
  async evaluate(ctx) {
    const cutoff = new Date(ctx.now.getTime() - 7 * DAY).toISOString();
    const recent = await count(ctx, "audit_logs", (q: any) => q.gt("created_at", cutoff));
    const rollups = await count(ctx, "audit_rollups", (q: any) => q);
    if (!recent && !rollups)
      return {
        state: "warn" as const,
        detail: "No audit events recorded.",
        remedy: "Exercise a broker call to confirm the ledger is wired.",
      };
    return {
      state: "pass" as const,
      detail: `${recent} event(s) in the last 7 days, ${rollups} daily rollup(s) retained.`,
    };
  },
};

export const postureChecks: PostureCheck[] = [
  ownershipClaimed,
  bootstrapSecret,
  signingAttested,
  signingCustody,
  mfaCoverage,
  passkeyPreference,
  staleInvites,
  edgeGate,
  dpopEnforcement,
  legacyTokens,
  grantHygiene,
  credentialExpiry,
  approvalBacklog,
  fleetHealth,
  archiveDurability,
  auditContinuity,
];
