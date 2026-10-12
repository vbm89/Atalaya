import { test } from "node:test";
import assert from "node:assert/strict";
import { migrationSkipReason } from "./migrate-guard.mjs";

test("default (unset) skips, even on Vercel production", () => {
  assert.match(migrationSkipReason({}), /ALLOW_DB_MIGRATE/);
  assert.match(migrationSkipReason({ VERCEL_ENV: "production", DATABASE_URL: "x" }), /ALLOW_DB_MIGRATE/);
  assert.notEqual(migrationSkipReason({ VERCEL_ENV: "preview" }), null);
});
test("only exactly ALLOW_DB_MIGRATE=1 migrates", () => {
  assert.equal(migrationSkipReason({ ALLOW_DB_MIGRATE: "1" }), null);
  for (const v of ["true", "yes", "0", "", " 1"]) assert.notEqual(migrationSkipReason({ ALLOW_DB_MIGRATE: v }), null);
});
