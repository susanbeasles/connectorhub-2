import { call, missingZeroTrust, zeroTrustConfig } from "./api.server";

/**
 * The Zero Trust estate: the account-wide pieces every managed tunnel assumes
 * already exist — an organisation, a login method, Gateway, and a device
 * enrollment rule that lets an operator's WARP client join the private
 * network. Inspecting and building it are the same vocabulary, so a fresh
 * account and a half-built one take the identical path.
 */

export type EstateStep =
  | "organization"
  | "identityProvider"
  | "gateway"
  | "deviceEnrollment"
  | "deviceProfile";

export type EstateCheck = {
  step: EstateStep;
  label: string;
  ready: boolean;
  detail: string;
};

export type Estate = {
  configured: boolean;
  missing: string[];
  ready: boolean;
  teamDomain: string | null;
  checks: EstateCheck[];
};

type Cfg = { accountId: string; token: string };

const LABELS: Record<EstateStep, string> = {
  organization: "Zero Trust organisation",
  identityProvider: "Login method",
  gateway: "Gateway",
  deviceEnrollment: "Device enrollment policy",
  deviceProfile: "WARP device profile",
};

/** Cloudflare answers "not provisioned" with an error, not an empty body. */
async function maybe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "aegis"
  );
}

type Org = { name?: string; auth_domain?: string } | null;
type Idp = { id: string; name: string; type: string };
type App = { id: string; type: string; name: string };

const Organization = {
  read: (cfg: Cfg) => maybe(() => call<Org>(cfg, `/accounts/${cfg.accountId}/access/organizations`)),
  create: (cfg: Cfg, team: string) =>
    call<Org>(cfg, `/accounts/${cfg.accountId}/access/organizations`, {
      method: "POST",
      body: JSON.stringify({
        name: "Aegis Zero Trust",
        auth_domain: `${team}.cloudflareaccess.com`,
        is_ui_read_only: false,
        auto_redirect_to_identity: false,
      }),
    }),
};

const IdentityProvider = {
  list: async (cfg: Cfg) =>
    (await maybe(() => call<Idp[]>(cfg, `/accounts/${cfg.accountId}/access/identity_providers`))) ?? [],
  /** One-time PIN needs no third-party app, so a fresh account can log in immediately. */
  createPin: (cfg: Cfg) =>
    call<Idp>(cfg, `/accounts/${cfg.accountId}/access/identity_providers`, {
      method: "POST",
      body: JSON.stringify({ name: "One-time PIN", type: "onetimepin", config: {} }),
    }),
};

const Gateway = {
  read: (cfg: Cfg) => maybe(() => call<{ id: string }>(cfg, `/accounts/${cfg.accountId}/gateway`)),
  provision: (cfg: Cfg) =>
    call<{ id: string }>(cfg, `/accounts/${cfg.accountId}/gateway`, { method: "POST", body: "{}" }),
};

const Enrollment = {
  find: async (cfg: Cfg) => {
    const apps = (await maybe(() => call<App[]>(cfg, `/accounts/${cfg.accountId}/access/apps`))) ?? [];
    return apps.find((a) => a.type === "warp") ?? null;
  },
  create: (cfg: Cfg) =>
    call<App>(cfg, `/accounts/${cfg.accountId}/access/apps`, {
      method: "POST",
      body: JSON.stringify({ name: "Warp Login App", type: "warp", session_duration: "24h" }),
    }),
  /** Only named operators may enrol a device — never "everyone". */
  allow: (cfg: Cfg, appId: string, emails: string[]) =>
    call(cfg, `/accounts/${cfg.accountId}/access/apps/${appId}/policies`, {
      method: "POST",
      body: JSON.stringify({
        name: "Aegis operators",
        decision: "allow",
        precedence: 1,
        include: emails.map((email) => ({ email: { email } })),
      }),
    }),
  policies: async (cfg: Cfg, appId: string) =>
    (await maybe(() => call<{ id: string }[]>(cfg, `/accounts/${cfg.accountId}/access/apps/${appId}/policies`))) ??
    [],
};

const DeviceProfile = {
  read: (cfg: Cfg) => maybe(() => call<{ enabled?: boolean }>(cfg, `/accounts/${cfg.accountId}/devices/policy`)),
  /** Gateway with WARP: the client joins the private network and is filtered. */
  harden: (cfg: Cfg) =>
    call(cfg, `/accounts/${cfg.accountId}/devices/policy`, {
      method: "PATCH",
      body: JSON.stringify({
        service_mode_v2: { mode: "warp" },
        allow_mode_switch: false,
        switch_locked: true,
        auto_connect: 0,
        captive_portal: 180,
      }),
    }),
};

async function operatorEmails(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("operators").select("email");
  return (data ?? []).map((r) => r.email as string).filter(Boolean);
}

function check(step: EstateStep, ready: boolean, detail: string): EstateCheck {
  return { step, label: LABELS[step], ready, detail };
}

async function survey(cfg: Cfg): Promise<{ checks: EstateCheck[]; teamDomain: string | null }> {
  const [org, idps, gateway, app, profile] = await Promise.all([
    Organization.read(cfg),
    IdentityProvider.list(cfg),
    Gateway.read(cfg),
    Enrollment.find(cfg),
    DeviceProfile.read(cfg),
  ]);
  const policies = app ? await Enrollment.policies(cfg, app.id) : [];
  const teamDomain = org?.auth_domain ?? null;

  return {
    teamDomain,
    checks: [
      check(
        "organization",
        Boolean(org?.auth_domain),
        org?.auth_domain ? org.auth_domain : "No Zero Trust organisation on this account yet.",
      ),
      check(
        "identityProvider",
        idps.length > 0,
        idps.length ? idps.map((i) => i.name).join(", ") : "No login method — nobody can authenticate.",
      ),
      check("gateway", Boolean(gateway), gateway ? "Provisioned" : "Gateway is not provisioned."),
      check(
        "deviceEnrollment",
        Boolean(app) && policies.length > 0,
        app
          ? policies.length
            ? "Operators may enrol a device."
            : "Enrollment app exists with no policy — enrolment is closed."
          : "No device enrollment rule, so WARP cannot join.",
      ),
      check(
        "deviceProfile",
        Boolean(profile),
        profile ? "Default profile in place." : "No default device profile.",
      ),
    ],
  };
}

export const ZeroTrust = {
  async inspect(): Promise<Estate> {
    const cfg = zeroTrustConfig();
    if (!cfg) {
      return { configured: false, missing: missingZeroTrust(), ready: false, teamDomain: null, checks: [] };
    }
    const { checks, teamDomain } = await survey(cfg);
    return {
      configured: true,
      missing: [],
      ready: checks.every((c) => c.ready),
      teamDomain,
      checks,
    };
  },

  /**
   * Build whatever is missing, in dependency order, and stop at the first hard
   * failure so a half-built estate is never reported as ready.
   */
  async bootstrap(input: { teamName?: string }): Promise<Estate & { created: EstateStep[] }> {
    const cfg = zeroTrustConfig();
    if (!cfg) throw new Error(`Cloudflare Zero Trust needs ${missingZeroTrust().join(", ")}`);

    const created: EstateStep[] = [];
    const team = slug(input.teamName ?? "aegis");

    if (!(await Organization.read(cfg))?.auth_domain) {
      await Organization.create(cfg, team);
      created.push("organization");
    }

    if (!(await IdentityProvider.list(cfg)).length) {
      await IdentityProvider.createPin(cfg);
      created.push("identityProvider");
    }

    if (!(await Gateway.read(cfg))) {
      await Gateway.provision(cfg);
      created.push("gateway");
    }

    const emails = await operatorEmails();
    if (!emails.length) {
      throw new Error("Add at least one operator before opening device enrollment.");
    }
    const app = (await Enrollment.find(cfg)) ?? (await Enrollment.create(cfg));
    if (!(await Enrollment.policies(cfg, app.id)).length) {
      await Enrollment.allow(cfg, app.id, emails);
      created.push("deviceEnrollment");
    }

    if (!(await DeviceProfile.read(cfg))) {
      await DeviceProfile.harden(cfg);
      created.push("deviceProfile");
    }

    return { ...(await ZeroTrust.inspect()), created };
  },
};
