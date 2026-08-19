/**
 * What production actually requires, expressed as independent verdicts over the
 * live system rather than a checklist someone ticks by hand. Each check names
 * the exact action that clears it, so the console never has to explain a
 * failure in its own words.
 */

export type ReadinessState = "pass" | "fail";

export type ReadinessCheck = {
  id: string;
  title: string;
  state: ReadinessState;
  detail: string;
  remedy?: string;
};

type Check = {
  id: string;
  title: string;
  evaluate: () => Promise<Omit<ReadinessCheck, "id" | "title">>;
};

const awsFederation: Check = {
  id: "aws.federation",
  title: "AWS federation connected",
  async evaluate() {
    const { federationLoad } = await import("@/lib/deploy/aws/federation.server");
    const config = await federationLoad();
    return config
      ? { state: "pass", detail: `Role ${config.roleArn} in ${config.region}.` }
      : {
          state: "fail",
          detail: "No federated AWS role is registered.",
          remedy: "Run the CloudShell bootstrap script and paste back its output.",
        };
  },
};

const kmsKey: Check = {
  id: "aws.kms",
  title: "Broker signing key in KMS",
  async evaluate() {
    const { federationLoad } = await import("@/lib/deploy/aws/federation.server");
    const config = await federationLoad();
    return config?.kmsKeyArn
      ? { state: "pass", detail: "An HSM key is available for broker signatures." }
      : {
          state: "fail",
          detail: "No KMS key is registered; signatures would stay on the sealed key.",
          remedy: "Re-run the bootstrap script so it creates and registers the KMS key.",
        };
  },
};

const vaultCustody: Check = {
  id: "custody.vault",
  title: "1Password estate adopted",
  async evaluate() {
    const { available } = await import("@/lib/integrations/vault.server");
    return (await available())
      ? { state: "pass", detail: "The service accounts are filed and reachable." }
      : {
          state: "fail",
          detail: "No custody credential is filed, so secrets would stay in the app database.",
          remedy: "Complete the 1Password adoption on the Integrations page.",
        };
  },
};

const edgeAccess: Check = {
  id: "edge.access",
  title: "Private network configured",
  async evaluate() {
    const { accessConfig } = await import("@/lib/access/config.server");
    const config = accessConfig();
    if (!config.teamDomain || !config.audiences.console.length)
      return {
        state: "fail",
        detail: "The edge gate has no team domain or application audience.",
        remedy: "Provision the tunnel and set the Zero Trust environment values.",
      };
    return { state: "pass", detail: `Verifying against ${config.teamDomain}.` };
  },
};

const recovery: Check = {
  id: "access.breakglass",
  title: "Recovery code issued",
  async evaluate() {
    const { codeList } = await import("@/lib/access/breakglass.server");
    const usable = (await codeList()).filter((c) => !c.usedAt && !c.revokedAt);
    return usable.length
      ? { state: "pass", detail: `${usable.length} unused recovery code.` }
      : {
          state: "fail",
          detail: "No unused recovery code exists; a gate mistake would lock you out.",
          remedy: "Issue a breakglass code and store it outside this system.",
        };
  },
};

const CHECKS: Check[] = [awsFederation, kmsKey, vaultCustody, edgeAccess, recovery];

export async function readiness(): Promise<ReadinessCheck[]> {
  return Promise.all(
    CHECKS.map(async (check) => {
      try {
        return { id: check.id, title: check.title, ...(await check.evaluate()) };
      } catch (e) {
        return {
          id: check.id,
          title: check.title,
          state: "fail" as const,
          detail: (e as Error).message,
          remedy: "Resolve the error above and re-check.",
        };
      }
    }),
  );
}

export function unmet(checks: ReadinessCheck[]): ReadinessCheck[] {
  return checks.filter((c) => c.state !== "pass");
}
