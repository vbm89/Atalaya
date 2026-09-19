import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDistinctSourceTarget,
  buildDiscoveryPageSql,
  buildMigrationPlan,
  normalizeDbIdentity,
  parseMigrateArgs,
  redactDatabaseUrl,
  runDevStorageMigrateCli,
} from "./dev-storage-migrate.mjs";

const SRC = "postgresql://neondb_owner:secret@ep-src.neon.tech:5432/neondb";
const DST = "postgresql://avnadmin:other@pg-aiven.example.com:5432/defaultdb";

test("normalizeDbIdentity ignores credentials", () => {
  assert.equal(
    normalizeDbIdentity(SRC),
    "ep-src.neon.tech:5432/neondb",
  );
});

test("migrator plan rejects same SOURCE/TARGET", () => {
  const same = assertDistinctSourceTarget(SRC, SRC);
  assert.equal(same.ok, false);
  assert.match(same.reason, /same host\+db/i);

  const plan = buildMigrationPlan({
    sourceUrl: SRC,
    targetUrl: SRC,
    confirmWrite: false,
    jobId: "j1",
    pageSize: 100,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.mode, "misconfigured");
});

test("migrator plan accepts distinct SOURCE/TARGET and stays dry-run", () => {
  const ok = assertDistinctSourceTarget(SRC, DST);
  assert.equal(ok.ok, true);
  const plan = buildMigrationPlan({
    sourceUrl: SRC,
    targetUrl: DST,
    confirmWrite: false,
    jobId: "j1",
    pageSize: 100,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.mode, "plan");
  assert.equal(plan.confirmWrite, false);
  assert.ok(plan.steps.length > 3);
  assert.equal(String(plan.source).includes("secret"), false);
  assert.equal(String(JSON.stringify(plan)).includes("secret"), false);
});

test("redactDatabaseUrl strips password", () => {
  const r = redactDatabaseUrl(SRC);
  assert.equal(r.includes("secret"), false);
  assert.match(r, /ep-src\.neon\.tech/);
});

test("CLI exits 2 when SOURCE equals TARGET", async () => {
  const lines = [];
  const code = await runDevStorageMigrateCli({
    sourceUrl: SRC,
    targetUrl: SRC,
    argv: ["node", "dev-storage-migrate.mjs"],
    log: (s) => lines.push(s),
  });
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /same host\+db|Refusing/i);
});

test("CLI plan exits 0 without confirm-write", async () => {
  const lines = [];
  let writeCalled = false;
  const code = await runDevStorageMigrateCli({
    sourceUrl: SRC,
    targetUrl: DST,
    argv: ["node", "dev-storage-migrate.mjs"],
    log: (s) => lines.push(s),
    executeWrite: async () => {
      writeCalled = true;
    },
  });
  assert.equal(code, 0);
  assert.equal(writeCalled, false);
  assert.match(lines.join("\n"), /dry-run/i);
});

test("CLI with --confirm-write invokes write hook", async () => {
  let writeCalled = false;
  const code = await runDevStorageMigrateCli({
    sourceUrl: SRC,
    targetUrl: DST,
    argv: ["node", "dev-storage-migrate.mjs", "--confirm-write"],
    log: () => {},
    executeWrite: async () => {
      writeCalled = true;
    },
  });
  assert.equal(code, 0);
  assert.equal(writeCalled, true);
  assert.equal(parseMigrateArgs(["node", "x", "--confirm-write"]).confirmWrite, true);
});

test("buildDiscoveryPageSql always has WHERE+LIMIT", () => {
  const { text, params } = buildDiscoveryPageSql("XAUUSD", "15m", 0, 50);
  assert.match(text, /where/i);
  assert.match(text, /limit/i);
  assert.equal(params[3], 50);
});
