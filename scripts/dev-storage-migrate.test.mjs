import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLAN_SCOPES,
  assertDistinctSourceTarget,
  buildDiscoveryPageSql,
  buildMigrationPlan,
  normalizeDbIdentity,
  parseMigrateArgs,
  parseScopeToken,
  redactDatabaseUrl,
  resolveMigrateScopes,
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
  assert.ok(plan.objectStorage);
  assert.ok(plan.objectStorage.requiredEnv.includes("OBJECT_STORAGE_ENDPOINT"));
  assert.ok(plan.objectStorage.requiredEnv.includes("OBJECT_STORAGE_BUCKET"));
  assert.equal(plan.objectStorage.requiredEnv.includes("R2_ACCOUNT_ID"), false);
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

import {
  afterTBeforeUtcDay,
  barLine,
  copyDiscoveryScopeByDay,
  discoveryDayObjectKey,
  resolveResumeCursor,
  utcDayFromT,
  verifyManifestAgainstObjectStorage,
} from "./dev-storage-migrate.mjs";

function syntheticBars() {
  const mk = (day, n) => {
    const start = Date.parse(`${day}T00:00:00.000Z`) / 1000;
    return Array.from({ length: n }, (_, i) => ({
      asset_id: "XAUUSD",
      tf: "15m",
      t: start + i * 900,
      o: 2000 + i,
      h: 2001 + i,
      l: 1999 + i,
      c: 2000.5 + i,
      v: 100 + i,
      source: "volume-smoke-test",
    }));
  };
  return [...mk("2024-01-01", 4), ...mk("2024-01-02", 4)];
}

function makeFetch(rows) {
  return async (afterT, limit) =>
    rows
      .filter((r) => Number(r.t) > afterT)
      .sort((a, b) => a.t - b.t)
      .slice(0, limit);
}

test("JSONL schema is canonical camelCase assetId (not asset_id)", () => {
  const line = barLine({
    asset_id: "XAUUSD",
    tf: "15m",
    t: 1704067200,
    o: 1,
    h: 2,
    l: 0.5,
    c: 1.5,
    v: 9,
    source: "volume-smoke-test",
  });
  const obj = JSON.parse(line);
  assert.deepEqual(Object.keys(obj), [
    "assetId",
    "tf",
    "t",
    "o",
    "h",
    "l",
    "c",
    "v",
    "source",
  ]);
  assert.equal(obj.assetId, "XAUUSD");
  assert.equal("asset_id" in obj, false);
});

test("resolveResumeCursor rewinds open currentDay to UTC day start bound", () => {
  const resumed = resolveResumeCursor({
    scopeIndex: 0,
    afterT: 1704070000,
    currentDay: "2024-01-01",
  });
  assert.equal(resumed.currentDay, null);
  assert.equal(resumed.rewoundDay, "2024-01-01");
  assert.equal(resumed.afterT, afterTBeforeUtcDay("2024-01-01"));
  assert.ok(resumed.afterT < 1704067200);
});

test("happy path copies complete UTC days", async () => {
  const all = syntheticBars();
  const store = new Map();
  await copyDiscoveryScopeByDay({
    pageSize: 3,
    initialAfterT: 0,
    fetchPage: makeFetch(all),
    flushDay: async (day, text, meta) => {
      store.set(discoveryDayObjectKey("XAUUSD", "15m", day), { text, meta });
    },
    saveCheckpoint: async () => {},
  });
  assert.equal(store.size, 2);
  assert.equal(store.get("discovery/XAUUSD/15m/2024-01-01.jsonl").meta.rowCount, 4);
  assert.equal(store.get("discovery/XAUUSD/15m/2024-01-02.jsonl").meta.rowCount, 4);
});

test("mid-day crash then resume yields complete day (no data loss)", async () => {
  const all = syntheticBars();
  const store = new Map();
  const checkpoints = [];
  let crashed = false;
  try {
    await copyDiscoveryScopeByDay({
      pageSize: 10,
      initialAfterT: 0,
      fetchPage: makeFetch(all),
      flushDay: async (day, text, meta) => {
        store.set(discoveryDayObjectKey("XAUUSD", "15m", day), { text, meta });
      },
      saveCheckpoint: async (c) => {
        checkpoints.push({ ...c });
      },
      shouldCrash: ({ phase, currentDay }) => {
        if (
          !crashed &&
          phase === "mid-day-after-row" &&
          currentDay === "2024-01-01"
        ) {
          const open = checkpoints.filter((c) => c.currentDay === "2024-01-01");
          if (open.length >= 2) {
            crashed = true;
            return true;
          }
        }
        return false;
      },
    });
    assert.fail("expected simulated crash");
  } catch (err) {
    assert.equal(err.name, "SimulatedMigratorCrash");
  }

  const last = checkpoints.at(-1);
  assert.equal(last.currentDay, "2024-01-01");
  assert.equal(last.afterT, 0, "durable afterT must not advance mid-day");
  assert.equal(last.openDayRows, 2);

  const resumed = resolveResumeCursor(last);
  assert.equal(resumed.rewoundDay, "2024-01-01");
  assert.equal(resumed.afterT, afterTBeforeUtcDay("2024-01-01"));

  await copyDiscoveryScopeByDay({
    pageSize: 10,
    initialAfterT: last.afterT,
    initialCurrentDay: last.currentDay,
    fetchPage: makeFetch(all),
    flushDay: async (day, text, meta) => {
      store.set(discoveryDayObjectKey("XAUUSD", "15m", day), { text, meta });
    },
    saveCheckpoint: async () => {},
  });

  const day1 = store.get("discovery/XAUUSD/15m/2024-01-01.jsonl");
  assert.ok(day1);
  assert.equal(day1.meta.rowCount, 4);
  const lines = day1.text.trim().split("\n");
  assert.equal(lines.length, 4);
  for (const ln of lines) {
    const o = JSON.parse(ln);
    assert.equal(o.assetId, "XAUUSD");
    assert.equal(utcDayFromT(o.t), "2024-01-01");
  }
  assert.equal(store.get("discovery/XAUUSD/15m/2024-01-02.jsonl").meta.rowCount, 4);
});

test("verifyManifestAgainstObjectStorage checks size+sha+rows", async () => {
  const all = syntheticBars();
  const store = new Map();
  await copyDiscoveryScopeByDay({
    pageSize: 10,
    initialAfterT: 0,
    fetchPage: makeFetch(all),
    flushDay: async (day, text, meta) => {
      store.set(discoveryDayObjectKey("XAUUSD", "15m", day), { text, meta });
    },
    saveCheckpoint: async () => {},
  });
  const verification = await verifyManifestAgainstObjectStorage({
    listManifest: async () =>
      [...store.entries()].map(([object_key, v]) => ({
        object_key,
        content_sha256: v.meta.sha256,
        byte_size: v.meta.byteSize,
        row_count: v.meta.rowCount,
      })),
    headObject: async (key) => {
      const v = store.get(key);
      return v ? { contentLength: Buffer.byteLength(v.text, "utf8") } : null;
    },
    getObjectText: async (key) => store.get(key).text,
  });
  assert.equal(verification.ok, true);
  assert.equal(verification.checked, 2);
});

test("migration plan includes verify-manifest against object storage", () => {
  const plan = buildMigrationPlan({
    sourceUrl: SRC,
    targetUrl: DST,
    confirmWrite: false,
    jobId: "j1",
    pageSize: 100,
  });
  const verify = plan.steps.find((s) => s.id === "verify-manifest");
  assert.ok(verify);
  assert.match(String(verify.detail), /HEAD|SHA-256|manifest/i);
});


test("parseScopeToken normalizes XAUUSD/15m", () => {
  const r = parseScopeToken("XAUUSD/15m");
  assert.equal(r.ok, true);
  assert.deepEqual(r, { ok: true, assetId: "XAUUSD", tf: "15m" });
});

test("--scope XAUUSD/15m yields exactly 1 scope", () => {
  const parsed = parseMigrateArgs([
    "node",
    "dev-storage-migrate.mjs",
    "--scope",
    "XAUUSD/15m",
  ]);
  assert.equal(parsed.scopeError, null);
  assert.ok(parsed.scopes);
  assert.equal(parsed.scopes.length, 1);
  assert.deepEqual(parsed.scopes[0], { assetId: "XAUUSD", tf: "15m" });
});

test("invalid --scope rejected before any connection", async () => {
  let planCalled = false;
  let writeCalled = false;
  const lines = [];
  const code = await runDevStorageMigrateCli({
    sourceUrl: SRC,
    targetUrl: DST,
    argv: ["node", "dev-storage-migrate.mjs", "--scope", "NOPE/99m"],
    log: (s) => lines.push(s),
    executeWrite: async () => {
      writeCalled = true;
    },
  });
  assert.equal(code, 2);
  assert.equal(writeCalled, false);
  assert.match(lines.join("\n"), /Unknown --scope|invalid-scope|NOPE\/99m/i);
  // buildMigrationPlan not reached with valid URLs path for invalid scope —
  // plan would need distinct URLs; ensure error mode is invalid-scope
  assert.match(lines.join("\n"), /invalid-scope|Unknown --scope/i);
});

test("without --scope keeps all DEFAULT_PLAN_SCOPES (16)", () => {
  const parsed = parseMigrateArgs(["node", "dev-storage-migrate.mjs"]);
  assert.equal(parsed.scopeError, null);
  assert.equal(parsed.scopes, null); // null → CLI uses DEFAULT
  assert.equal(DEFAULT_PLAN_SCOPES.length, 16);
  const resolved = resolveMigrateScopes(null);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.scopes.length, 16);
});

test("buildMigrationPlan receives explicit single scope", () => {
  const plan = buildMigrationPlan({
    sourceUrl: SRC,
    targetUrl: DST,
    confirmWrite: false,
    jobId: "j-scope",
    pageSize: 2000,
    scopes: [{ assetId: "XAUUSD", tf: "15m" }],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.scopeCount, 1);
  assert.deepEqual(plan.scopes, [{ assetId: "XAUUSD", tf: "15m" }]);
  const copies = plan.steps.filter((s) => s.action === "copy_discovery_bars_by_day");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].assetId, "XAUUSD");
  assert.equal(copies[0].tf, "15m");
});

test("confirmWrite + --scope does not fall back to DEFAULT_PLAN_SCOPES", async () => {
  /** @type {unknown} */
  let writeArgs = null;
  const code = await runDevStorageMigrateCli({
    sourceUrl: SRC,
    targetUrl: DST,
    argv: [
      "node",
      "dev-storage-migrate.mjs",
      "--confirm-write",
      "--scope",
      "BTCUSD/1h",
      "--page-size",
      "2000",
    ],
    log: () => {},
    executeWrite: async (args) => {
      writeArgs = args;
    },
  });
  assert.equal(code, 0);
  assert.ok(writeArgs);
  assert.equal(writeArgs.scopes.length, 1);
  assert.deepEqual(writeArgs.scopes[0], { assetId: "BTCUSD", tf: "1h" });
  assert.notEqual(writeArgs.scopes.length, DEFAULT_PLAN_SCOPES.length);
});

test("dry-run with --scope XAUUSD/15m plans exactly 1 copy step", async () => {
  const lines = [];
  const code = await runDevStorageMigrateCli({
    sourceUrl: SRC,
    targetUrl: DST,
    argv: ["node", "dev-storage-migrate.mjs", "--scope", "XAUUSD/15m", "--page-size", "2000"],
    log: (s) => lines.push(s),
  });
  assert.equal(code, 0);
  const joined = lines.join("\n");
  assert.match(joined, /dry-run/i);
  const planLine = lines.find((l) => l.includes('"scopeCount"') || l.includes('"mode"'));
  // plan is JSON dumped as one blob
  const blob = lines.find((l) => l.trim().startsWith("{"));
  assert.ok(blob);
  const plan = JSON.parse(blob);
  assert.equal(plan.scopeCount, 1);
  assert.equal(plan.confirmWrite, false);
  const copies = plan.steps.filter((s) => s.action === "copy_discovery_bars_by_day");
  assert.equal(copies.length, 1);
});

test("CLI documents single --scope only (no multi-scope flag)", () => {
  // Design: one --scope ASSET/TF per invocation; multi-scope = omit --scope (all 16).
  const a = parseMigrateArgs(["node", "x", "--scope", "XAUUSD/15m"]);
  const b = parseMigrateArgs(["node", "x", "--scope", "BTCUSD/15m"]);
  assert.equal(a.scopes.length, 1);
  assert.equal(b.scopes.length, 1);
  assert.notDeepEqual(a.scopes[0], b.scopes[0]);
});
