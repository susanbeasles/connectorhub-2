import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { errorMessage } from "./onepassword.server";
import { identityItems } from "./provision.server";

describe("1Password adapter boundary", () => {
  test("redacts service-account tokens from errors", () => {
    assert.equal(errorMessage(new Error("denied ops_exampleSecret123")), "denied [redacted]");
  });

  test("matches each adopted identity exactly once", () => {
    assert.deepEqual(identityItems([
      { id: "a", title: "aegis-admin service account" },
      { id: "r", title: "aegis-read service account" },
      { id: "w", title: "aegis-write service account" },
    ]), [
      { tier: "destructive", itemId: "a" },
      { tier: "write", itemId: "w" },
      { tier: "read", itemId: "r" },
    ]);
  });

  test("contains no tenant REST route", () => {
    for (const file of ["custody.server.ts", "provision.server.ts", "vault.server.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.ok(!source.includes("1password.com/api"));
      assert.ok(!source.includes("/v1/vaults"));
    }
  });
});