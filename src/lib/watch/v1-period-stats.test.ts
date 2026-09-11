import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { V1_PERIOD_STATS_SQL, foldV1PeriodStats } from "./v1-period-stats.ts";

describe("v1 period stats", () => {
  it("counts only to_state=entry and prefers postEntry over MAP-birth outcome", () => {
    assert.match(V1_PERIOD_STATS_SQL, /to_state = 'entry'/);
    assert.match(V1_PERIOD_STATS_SQL, /postEntry/);
    assert.match(V1_PERIOD_STATS_SQL, /expired/);
    assert.match(V1_PERIOD_STATS_SQL, /pending/);
    assert.doesNotMatch(V1_PERIOD_STATS_SQL, /\b(insert|update|delete|drop|alter)\b/i);
  });

  it("does not hide expired V1 entries as pending=0 / tp1=0", () => {
    const stats = foldV1PeriodStats(
      [
        { asset_id: "BTCUSD", entries: 2, tp1: 0, tp2: 0, sl: 0, pending: 0, expired: 2 },
        { asset_id: "US100", entries: 1, tp1: 0, tp2: 0, sl: 0, pending: 0, expired: 1 },
      ],
      "2026-09-01T00:00:00.000Z",
      "2026-09-11T00:00:00.000Z",
    );
    assert.equal(stats.entries, 3);
    assert.equal(stats.tp1, 0);
    assert.equal(stats.sl, 0);
    assert.equal(stats.pending, 0);
    assert.equal(stats.expired, 3);
    assert.equal(stats.byAsset.find((r) => r.assetId === "XAUUSD")?.entries, 0);
    assert.equal(stats.byAsset.find((r) => r.assetId === "BTCUSD")?.expired, 2);
    assert.equal(stats.byAsset.find((r) => r.assetId === "WTI")?.expired, 0);
  });
});
