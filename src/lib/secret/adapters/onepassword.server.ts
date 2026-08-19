import type { SecretRef } from "../ref";
import { Lease, type LeaseTerms } from "../lease";
import { refOf, refParse } from "../ref";

/**
 * 1Password is not a host. It is an optional additional custody source for
 * credentials a human manages, and it resolves by `op://vault/item/field`
 * reference wherever the application happens to run. Nothing requires it: when
 * it is not connected, the host's own store holds the same values under a
 * different scheme, and no call site changes.
 */

export function opRef(vault: string, item: string, field = "credential"): SecretRef {
  return refOf("op", `${vault}/${item}`, field);
}

export async function opResolve(ref: SecretRef, terms?: LeaseTerms): Promise<Lease> {
  const { locator } = refParse(ref);
  const [vault, item] = locator.split("/");
  if (!vault || !item) throw new Error("A 1Password reference needs a vault and an item");
  const { itemRead } = await import("@/lib/integrations/onepassword.server");
  const { readSeed } = await import("@/lib/integrations/vault.server");
  const read = await itemRead(await readSeed(), vault, item);
  return Lease.ofText(read.value, terms);
}
