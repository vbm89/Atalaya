import assert from "node:assert/strict";
import test from "node:test";
import { createR2Adapter } from "./r2-adapter";
import { InactiveStorageError } from "./types";

test("R2 adapter is inactive without env", () => {
  const r2 = createR2Adapter({});
  assert.equal(r2.active, false);
  assert.ok(r2.missingEnv.includes("R2_ACCOUNT_ID"));
  assert.ok(r2.missingEnv.includes("R2_ACCESS_KEY_ID"));
  assert.ok(r2.missingEnv.includes("R2_SECRET_ACCESS_KEY"));
  assert.ok(r2.missingEnv.includes("R2_BUCKET"));
});

test("inactive R2 methods throw InactiveStorageError", async () => {
  const r2 = createR2Adapter({ R2_BUCKET: "only-bucket" });
  assert.equal(r2.active, false);
  await assert.rejects(() => r2.putObject("k", "x"), (err: unknown) => {
    assert.ok(err instanceof InactiveStorageError);
    assert.match(String((err as Error).message), /missing/i);
    // Env var NAMES may appear; secret VALUES must not.
    assert.equal(String((err as Error).message).includes("super-secret-value"), false);
    return true;
  });
  await assert.rejects(() => r2.getObjectText("k"), InactiveStorageError);
  await assert.rejects(() => r2.listPrefix("p"), InactiveStorageError);
});

test("R2 adapter becomes active when all required env present", () => {
  const r2 = createR2Adapter({
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "super-secret-value",
    R2_BUCKET: "bucket",
  });
  assert.equal(r2.active, true);
  assert.deepEqual(r2.missingEnv, []);
  // Do not call network — destroy without put
  r2.destroy();
});

test("inactive error message never embeds secret values", async () => {
  const r2 = createR2Adapter({
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "super-secret-value",
    // bucket missing → inactive
  });
  assert.equal(r2.active, false);
  try {
    await r2.putObject("k", "x");
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof InactiveStorageError);
    assert.equal(String((err as Error).message).includes("super-secret-value"), false);
  }
});
