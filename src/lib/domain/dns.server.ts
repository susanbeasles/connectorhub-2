/**
 * DNS proof over DoH. The Worker runtime has no resolver, and a resolver-free
 * lookup keeps the check identical in every environment.
 */

type DohAnswer = { type: number; data: string };

const RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

export async function txtRecords(name: string): Promise<string[]> {
  for (const resolver of RESOLVERS) {
    try {
      const url = new URL(resolver);
      url.searchParams.set("name", name);
      url.searchParams.set("type", "TXT");
      const res = await fetch(url, { headers: { accept: "application/dns-json" } });
      if (!res.ok) continue;
      const body = (await res.json()) as { Answer?: DohAnswer[] };
      return (body.Answer ?? [])
        .filter((a) => a.type === 16)
        .map((a) => a.data.replace(/^"|"$/g, "").replace(/"\s+"/g, ""));
    } catch {
      continue;
    }
  }
  throw new Error("Could not reach a DNS resolver to check the record");
}

export function verifyName(domain: string): string {
  return `_aegis-verify.${domain}`;
}

export async function domainProves(domain: string, token: string): Promise<boolean> {
  const records = await txtRecords(verifyName(domain));
  return records.some((r) => r.trim() === token || r.trim() === `aegis-verify=${token}`);
}
