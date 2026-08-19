import type { Tier } from "./types";

export type VaultRow = { id: string; name: string };
export type ItemRow = { id: string; title: string };

async function invoke<T>(payload: Record<string, unknown>): Promise<T> {
  const { invokeOnePasswordBridge } = await import("@/lib/deploy/lambda.server");
  try {
    return await invokeOnePasswordBridge<T>(payload);
  } catch (error) {
    throw new Error(`1Password SDK: ${errorMessage(error)}`);
  }
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Adapter invocation failed";
  return message.replace(/ops_[A-Za-z0-9_=-]+/g, "[redacted]").slice(0, 300);
}

export async function bridgeEnsure(): Promise<void> {
  const { ensureOnePasswordBridge } = await import("@/lib/deploy/lambda.server");
  await ensureOnePasswordBridge();
}

export function vaultList(token: string) {
  return invoke<VaultRow[]>({ action: "vault.list", token });
}

export function itemList(token: string, vaultId: string) {
  return invoke<ItemRow[]>({ action: "item.list", token, vaultId });
}

export function itemRead(token: string, vaultId: string, itemId: string) {
  return invoke<{ id: string; value: string }>({ action: "item.read", token, vaultId, itemId });
}

export function itemCreate(token: string, vaultId: string, input: { title: string; value: string; provider: string; tier: Tier }) {
  return invoke<{ id: string }>({ action: "item.create", token, vaultId, input });
}

export function itemDelete(token: string, vaultId: string, itemId: string) {
  return invoke<{ deleted: boolean }>({ action: "item.delete", token, vaultId, itemId });
}