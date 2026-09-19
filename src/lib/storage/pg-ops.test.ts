import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadDiscoveryBarsPageSql } from "./pg-ops";

test("pagination helper never builds unbounded SQL", () => {
  const { text, params } = buildLoadDiscoveryBarsPageSql({
    assetId: "XAUUSD",
    tf: "15m",
    afterT: 100,
    limit: 500,
  });
  assert.match(text, /where\s+asset_id\s*=\s*\$1/i);
  assert.match(text, /tf\s*=\s*\$2/i);
  assert.match(text, /t\s*>\s*\$3/i);
  assert.match(text, /limit\s+\$4/i);
  assert.equal(text.includes("select * from discovery_bars"), false);
  // Must not allow a bare FROM without WHERE
  const fromIdx = text.toLowerCase().indexOf("from discovery_bars");
  const whereIdx = text.toLowerCase().indexOf("where");
  const limitIdx = text.toLowerCase().indexOf("limit");
  assert.ok(fromIdx >= 0 && whereIdx > fromIdx && limitIdx > whereIdx);
  assert.deepEqual(params, ["XAUUSD", "15m", 100, 500]);
});

test("pagination clamps limit and rejects missing asset/tf", () => {
  const big = buildLoadDiscoveryBarsPageSql({
    assetId: "BTCUSD",
    tf: "1h",
    afterT: 0,
    limit: 999_999,
  });
  assert.equal(big.params[3], 10_000);
  assert.throws(
    () => buildLoadDiscoveryBarsPageSql({ assetId: "", tf: "15m", afterT: 0, limit: 10 }),
    /assetId/,
  );
  assert.throws(
    () => buildLoadDiscoveryBarsPageSql({ assetId: "XAUUSD", tf: "15m", afterT: Number.NaN, limit: 10 }),
    /afterT/,
  );
});
