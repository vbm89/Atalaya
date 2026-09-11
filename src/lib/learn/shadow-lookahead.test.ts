import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShadowCaseInput } from "./shadow-features.ts";
import type { ShadowEpisode, ShadowTapeBar } from "./shadow-replay.ts";
import { shadowCandidateForTest, shadowOutcomeForTest } from "./shadow-replay.ts";

function base(id: string): ShadowCaseInput {
  return {
    episodeId: id,
    assetId: "XAUUSD",
    direction: "sell",
    kind: "continuation",
    openedAtMs: 1_000_000,
    openedSlot: 1_000,
    openedState: "map",
    currentState: "map",
    closedAtMs: 30_000_000,
    bias4hLabel: "BAJISTA LOCAL",
    qualityPhase: "preliminar",
    volumeRatio15: 1.2,
    volumeAvailable15: true,
    volumeRatio4h: 1.1,
    volumeAvailable4h: true,
    highImpact: false,
    underlyingClosed: false,
    dataStatus: "ok",
    zoneLow: 100,
    zoneHigh: 110,
    entry: 100,
    sl: 115,
    tp1: 80,
    tp2: 70,
    invalidation: 120,
    riskReward: 1.333,
    quality: "media",
    slWide: false,
  };
}

function bar(id: string, t: number, o: number, h: number, l: number, c: number): ShadowTapeBar {
  return { episodeId: id, tf: "15m", t, o, h, l, c, v: 2, role: "forward" };
}

function lookback(id: string): ShadowTapeBar[] {
  return Array.from({ length: 8 }, (_, i) => bar(id, 100 + i * 900, 105, 106, 104, 105));
}

describe("anti look-ahead is demonstrated, not declared", () => {
  it("future TP versus future SL does not change the candidate slot", () => {
    const id = "XAUUSD-la-demo";
    const mom = bar(id, 8200, 104, 104, 90, 91);
    const pull = bar(id, 9100, 96, 108, 95, 101);
    const win = bar(id, 20_000, 101, 102, 70, 72);
    const lose = bar(id, 20_000, 101, 130, 100, 120);
    const a: ShadowEpisode = { case: base(id), events: [], bars: [...lookback(id), mom, pull, win], observedOutcome: "tp1" };
    const b: ShadowEpisode = { case: base(id), events: [], bars: [...lookback(id), mom, pull, lose], observedOutcome: "sl" };
    const ca = shadowCandidateForTest(a, "MOMENTUM_PULLBACK");
    const cb = shadowCandidateForTest(b, "MOMENTUM_PULLBACK");
    assert.ok(ca && cb);
    assert.equal(ca!.decisionSlot, cb!.decisionSlot);
    assert.equal(ca!.decisionBarTime, pull.t);
    assert.ok(ca!.decisionBarTime < win.t);
    assert.equal("outcome" in ca!.features, false);
  });

  it("outcome evaluation never reads bars whose open is before the decision close", () => {
    const id = "XAUUSD-la-bars";
    const mom = bar(id, 8200, 104, 104, 90, 91);
    const pull = bar(id, 9100, 96, 108, 95, 101);
    const same = bar(id, 9100, 96, 130, 70, 90);
    const ep: ShadowEpisode = { case: base(id), events: [], bars: [...lookback(id), mom, pull, same], observedOutcome: null };
    const c = shadowCandidateForTest(ep, "MOMENTUM_PULLBACK");
    assert.ok(c);
    const o = shadowOutcomeForTest(c!, ep);
    assert.equal(o.outcome, "expired");
  });

  it("observedOutcome on the episode is ignored by generation", () => {
    const id = "XAUUSD-la-obs";
    const mom = bar(id, 8200, 104, 104, 90, 91);
    const pull = bar(id, 9100, 96, 108, 95, 101);
    const ep: ShadowEpisode = {
      case: base(id),
      events: [],
      bars: [...lookback(id), mom, pull],
      observedOutcome: "tp2",
    };
    const c = shadowCandidateForTest(ep, "MOMENTUM_PULLBACK");
    assert.ok(c);
    assert.equal(c!.trigger, "momentum_pullback");
  });
});
