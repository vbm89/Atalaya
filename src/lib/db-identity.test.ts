import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dbFingerprint, dbWriteGate } from "./db-identity.ts";

const A = "postgres://u:pw@ep-aaa-pooler.eu.aws.neon.tech/dev?sslmode=require";
describe("db identity gate", () => {
  it("fingerprint ignores credentials, query and pooler suffix", () => {
    const f = dbFingerprint(A)!;
    assert.match(f, /^[0-9a-f]{16}$/);
    assert.equal(dbFingerprint("postgres://x:y@ep-aaa.eu.aws.neon.tech/dev"), f);
    assert.notEqual(dbFingerprint("postgres://u:pw@ep-bbb.eu.aws.neon.tech/dev"), f);
    assert.notEqual(dbFingerprint("postgres://u:pw@ep-aaa.eu.aws.neon.tech/prod"), f);
    assert.ok(!f.includes("pw"));
  });
  it("read-only unless DB_IDENTITY_ALLOW matches exactly", () => {
    assert.equal(dbWriteGate({ DATABASE_URL: A }).writable, false);
    assert.equal(dbWriteGate({ DATABASE_URL: A, DB_IDENTITY_ALLOW: "nope" }).writable, false);
    assert.equal(dbWriteGate({ DATABASE_URL: A, DB_IDENTITY_ALLOW: dbFingerprint(A)! }).writable, true);
    assert.equal(dbWriteGate({ DB_IDENTITY_ALLOW: "x" }).writable, false);
  });
});
