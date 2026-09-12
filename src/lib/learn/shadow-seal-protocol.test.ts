import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateSealReadiness,
  nextHypothesisStatus,
  SHADOW_SEAL_PROTOCOL,
  type SealReadinessInput,
  type SealTrainTrade,
} from "./shadow-seal-protocol.ts";

const registeredAt = Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000);

function trade(slot: number, outcome: "tp1" | "sl", r: number, asset = "XAUUSD"): SealTrainTrade {
  return { assetId: asset, decisionSlot: slot, outcome, rrAtOutcome: r };
}

function enoughTrades(): SealTrainTrade[] {
  const rows: SealTrainTrade[] = [];
  for (let i = 0; i < 40; i += 1) rows.push(trade(registeredAt - (80 - i) * 86400, "tp1", 2, "XAUUSD"));
  for (let i = 0; i < 40; i += 1) rows.push(trade(registeredAt - (40 - i) * 86400, "tp1", 2, "BTCUSD"));
  return rows;
}

function ready(over: Partial<SealReadinessInput> = {}): SealReadinessInput {
  const trainTrades = over.trainTrades ?? enoughTrades();
  return {
    hypothesisId: "K1_FAILED_BREAKOUT_TRAP_15M",
    status: "REGISTERED",
    registeredAtSec: registeredAt,
    nowSec: registeredAt + 90 * 86400,
    trainDecided: 80,
    trainPending: 0,
    trainTrades,
    costsKnown: true,
    assetsWithTrainDecided: 2,
    ...over,
  };
}

describe("SEAL protocol", () => {
  it("declares a priori thresholds and never inspects TEST", () => {
    assert.equal(SHADOW_SEAL_PROTOCOL.minTrainDecided, 80);
    assert.equal(SHADOW_SEAL_PROTOCOL.minObservationDaysAfterRegistration, 90);
    assert.equal(SHADOW_SEAL_PROTOCOL.inspectsTestOutcomes, false);
    assert.equal(SHADOW_SEAL_PROTOCOL.inspectsTestExpectancy, false);
    assert.equal(SHADOW_SEAL_PROTOCOL.inspectsTestSuccess, false);
    assert.equal(SHADOW_SEAL_PROTOCOL.oneWay, true);
  });

  it("stays NOT_READY when observation time is short, even with a fat TRAIN", () => {
    const got = evaluateSealReadiness(ready({ nowSec: registeredAt + 10 * 86400 }));
    assert.equal(got.status, "NOT_READY");
    assert.equal(got.canRevealTest, false);
    assert.ok(got.reasons.some((r) => r.includes("observación")));
  });

  it("stays NOT_READY when costs are unknown", () => {
    const got = evaluateSealReadiness(ready({ costsKnown: false }));
    assert.equal(got.eligible, false);
    assert.ok(got.reasons.includes("costes desconocidos"));
  });

  it("stays NOT_READY with fewer than 80 TRAIN decided", () => {
    const got = evaluateSealReadiness(ready({ trainDecided: 79, trainTrades: enoughTrades().slice(0, 79) }));
    assert.equal(got.eligible, false);
    assert.ok(got.reasons.some((r) => r.includes("TRAIN decididos")));
  });

  it("identical TRAIN + different TEST-like trades not in the input yield the same decision", () => {
    const a = evaluateSealReadiness(ready());
    const b = evaluateSealReadiness(ready());
    assert.deepEqual(a.reasons, b.reasons);
    assert.equal(a.inspectsTestOutcomes, false);
    assert.equal("testExpectancy" in a, false);
    assert.equal("testSuccessPct" in a, false);
  });

  it("passes when every TRAIN+calendar gate is met, still without revealing TEST until status is SEALED", () => {
    const got = evaluateSealReadiness(ready());
    assert.equal(got.eligible, true);
    assert.equal(got.status, "READY_TO_SEAL");
    assert.equal(got.canRevealTest, false);
  });

  it("SEALED is one-way and is the only status that may reveal TEST", () => {
    const sealed = evaluateSealReadiness(ready({ status: "SEALED" }));
    assert.equal(sealed.status, "SEALED");
    assert.equal(sealed.canRevealTest, true);
    assert.equal(nextHypothesisStatus("SEALED", evaluateSealReadiness(ready({ trainDecided: 0 }))), "SEALED");
    const notReady = evaluateSealReadiness(ready({ costsKnown: false }));
    assert.equal(nextHypothesisStatus("REGISTERED", notReady), "REGISTERED");
    assert.equal(nextHypothesisStatus("REGISTERED", evaluateSealReadiness(ready())), "SEALED");
  });

  it("concentration veto on TRAIN blocks seal", () => {
    const rows: SealTrainTrade[] = [
      ...enoughTrades().slice(0, 79).map((t, i) => ({ ...t, outcome: "sl" as const, rrAtOutcome: -1, assetId: i < 40 ? "XAUUSD" : "BTCUSD" })),
      { assetId: "XAUUSD", decisionSlot: registeredAt - 86400, outcome: "tp1", rrAtOutcome: 90 },
    ];
    const got = evaluateSealReadiness(ready({ trainTrades: rows, trainDecided: 80 }));
    assert.equal(got.eligible, false);
    assert.ok(got.reasons.some((r) => r.includes("concentración") || r.includes("signo") || r.includes("split")));
  });
});
