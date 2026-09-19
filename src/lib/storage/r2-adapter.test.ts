/**
 * Thin compat tests: R2-named factory is an alias over OBJECT_STORAGE_* env.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createR2Adapter } from "./r2-adapter";
import { createObjectStorageAdapter } from "./s3-adapter";
import { InactiveStorageError } from "./types";

const FULL_ENV = {
  OBJECT_STORAGE_ENDPOINT: "https://s3.example.test",
  OBJECT_STORAGE_REGION: "us-east-005",
  OBJECT_STORAGE_ACCESS_KEY_ID: "key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "super-secret-value",
  OBJECT_STORAGE_BUCKET: "bucket",
};

test("createR2Adapter still works as alias with OBJECT_STORAGE_* env", () => {
  const r2 = createR2Adapter({});
  assert.equal(r2.active, false);
  assert.ok(r2.missingEnv.includes("OBJECT_STORAGE_ENDPOINT"));
  assert.equal(r2.missingEnv.includes("R2_ACCOUNT_ID"), false);

  const active = createR2Adapter(FULL_ENV);
  assert.equal(active.active, true);
  assert.deepEqual(active.getPublicConfig().forcePathStyle, false);
  assert.equal(active.bucket, "bucket");
  active.destroy();
});

test("createR2Adapter matches createObjectStorageAdapter inactivity", async () => {
  const a = createR2Adapter({ OBJECT_STORAGE_BUCKET: "x" });
  const b = createObjectStorageAdapter({ OBJECT_STORAGE_BUCKET: "x" });
  assert.equal(a.active, b.active);
  assert.deepEqual([...a.missingEnv].sort(), [...b.missingEnv].sort());
  await assert.rejects(() => a.putObject("k", "v"), InactiveStorageError);
});
