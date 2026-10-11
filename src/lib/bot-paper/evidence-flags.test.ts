import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { partialAt } from "../learn/price-behaviour/partial.ts";
import { setupsAt } from "../learn/price-behaviour/setups.ts";
import type { Bar, ContextView, MarketState, PriceEvent, StructureView } from "../learn/price-behaviour/types.ts";
import { captureStudy, measuredFlag } from "./study.ts";

const MEASURED_KEYS: Record<string, readonly string[]> = {
  TREND_PULLBACK: ["displacement", "location", "pullback", "reclaim", "structure", "trend"],
  BREAKOUT_ACCEPTANCE: ["breakout", "displacement", "noRejection", "structure", "trend"],
  SWEEP_RECLAIM: ["displacement", "reclaim", "structure"],
  FAILED_BREAKOUT: ["displacement", "reclaim", "structure"],
  EXPANSION_CONTINUATION: ["displacement", "location", "structure", "trend"],
};

const NOT_MEASURED: Record<string, readonly string[]> = {
  TREND_PULLBACK: [],
  BREAKOUT_ACCEPTANCE: ["pullback", "reclaim", "location"],
  SWEEP_RECLAIM: ["trend", "pullback", "location"],
  FAILED_BREAKOUT: ["trend", "pullback", "location"],
  EXPANSION_CONTINUATION: ["pullback", "reclaim"],
};

function ctx(over: Partial<ContextView> = {}): ContextView {
  return {
    ema: 10,
    atr: 1,
    atrPercentile: 0.5,
    distStructureAtr: 1,
    distSessionHighAtr: 2,
    distSessionLowAtr: 2,
    distRecentHighAtr: 2,
    distRecentLowAtr: 2,
    distEmaAtr: 3,
    volatility: "NORMAL",
    session: "LONDON",
    sessionHigh: 20,
    sessionLow: 8,
    htf1h: "FLAT",
    htf4h: "FLAT",
    ...over,
  };
}

function structure(over: Partial<StructureView> = {}): StructureView {
  return {
    swings: [],
    hh: false,
    hl: false,
    lh: false,
    ll: false,
    lastHigh: null,
    prevHigh: null,
    lastLow: null,
    prevLow: null,
    recentHigh: null,
    recentLow: null,
    rangeHigh: null,
    rangeLow: null,
    bosUp: false,
    bosDown: false,
    ...over,
  };
}

function state(kind: MarketState["state"]): MarketState {
  return { state: kind, confidence: 1, evidence: [] };
}

function ev(event: PriceEvent["event"], level: number | null = null): PriceEvent {
  return { event, confidence: 1, price: 11, level, evidence: [] };
}

function bar(over: Partial<Bar> = {}): Bar {
  return { t: 1_700_000_000, o: 10, h: 11, l: 9.5, c: 10.2, v: 1, ...over };
}

function hits(args: { bars?: Bar[]; state?: MarketState["state"]; structure?: Partial<StructureView>; events?: PriceEvent[]; ctx?: Partial<ContextView> }) {
  const bars = args.bars ?? [bar()];
  const i = bars.length - 1;
  const view = structure(args.structure);
  return setupsAt(bars, i, state(args.state ?? "UNCLEAR"), view, args.events ?? [], ctx(args.ctx));
}

function one(id: string, direction: "LONG" | "SHORT", found: ReturnType<typeof hits>) {
  const hit = found.find((row) => row.id === id && row.direction === direction);
  assert.ok(hit, `${id} ${direction}`);
  return hit!;
}

describe("evidence flags", () => {
  it("does not turn a missing key into false", () => {
    assert.equal(measuredFlag({}, "displacement"), null);
    assert.equal(measuredFlag({}, "reclaim"), null);
    assert.equal(measuredFlag({}, "location"), null);
    assert.equal(measuredFlag({}, "structure"), null);
    assert.equal(measuredFlag({}, "confirmation"), null);
    assert.equal(measuredFlag({}, "pullback"), null);
    assert.equal(measuredFlag({}, "trend"), null);
    assert.equal(measuredFlag({}, "breakout"), null);
    assert.equal(measuredFlag({}, "noRejection"), null);
    assert.equal(measuredFlag({ displacement: false }, "displacement"), false);
    assert.equal(measuredFlag({ displacement: true }, "displacement"), true);
  });

  it("stores only measured booleans and leaves the rest null", () => {
    const tape = [bar()];
    const empty = captureStudy(tape, {
      asset: "US100",
      lastBarT: tape[0]!.t,
      marketState: "RANGE",
      event: "NO_EVENT",
      setup: "BREAKOUT_ACCEPTANCE",
      tier: "FULL",
      direction: "LONG",
      rr: 1.6,
      entry: 10,
      stop: 9,
      target: 12,
      confirmation: false,
      evidence: {},
    });
    assert.equal(empty.displacement, null);
    assert.equal(empty.reclaim, null);
    assert.equal(empty.location, null);
    assert.equal(empty.structure, null);
    assert.equal(empty.confirmation, false);
    assert.equal("pullback" in empty, false);
    assert.equal("trend" in empty, false);

    const partial = captureStudy(tape, {
      asset: "WTI",
      lastBarT: tape[0]!.t,
      marketState: "RANGE",
      event: "BREAKOUT_UP",
      setup: "BREAKOUT_ACCEPTANCE",
      tier: "PARTIAL",
      direction: "LONG",
      rr: 1.6,
      entry: 10,
      stop: 9,
      target: 12,
      confirmation: true,
      evidence: { structure: true, direction: true, event: true, confirmation: true, location: true, partial: true },
    });
    assert.equal(partial.displacement, null);
    assert.equal(partial.reclaim, null);
    assert.equal(partial.location, true);
    assert.equal(partial.structure, true);
    assert.equal(partial.confirmation, true);
  });

  it("keeps each setup on its measured keys, with real true and false", () => {
    const trendOn = one(
      "TREND_PULLBACK",
      "LONG",
      hits({
        state: "TREND_UP",
        structure: { hh: true, hl: true, bosDown: false, lastLow: { index: 0, price: 9.6, kind: "low", confirmIndex: 0 }, lastHigh: { index: 0, price: 12, kind: "high", confirmIndex: 0 } },
        events: [ev("PULLBACK"), ev("RECLAIM_UP", 9.6), ev("DISPLACEMENT_UP")],
        ctx: { distEmaAtr: 0.2 },
      }),
    );
    const trendOff = one("TREND_PULLBACK", "LONG", hits({ state: "RANGE" }));
    for (const hit of [trendOn, trendOff]) {
      assert.deepEqual(Object.keys(hit.evidence).sort(), [...MEASURED_KEYS.TREND_PULLBACK]);
    }
    assert.equal(trendOn.evidence.trend, true);
    assert.equal(trendOn.evidence.structure, true);
    assert.equal(trendOn.evidence.pullback, true);
    assert.equal(trendOn.evidence.reclaim, true);
    assert.equal(trendOn.evidence.displacement, true);
    assert.equal(trendOn.evidence.location, true);
    assert.equal(trendOff.evidence.trend, false);
    assert.equal(trendOff.evidence.structure, false);
    assert.equal(trendOff.evidence.pullback, false);
    assert.equal(trendOff.evidence.reclaim, false);
    assert.equal(trendOff.evidence.displacement, false);
    assert.equal(trendOff.evidence.location, false);

    const breakOn = one(
      "BREAKOUT_ACCEPTANCE",
      "LONG",
      hits({
        state: "RANGE",
        structure: { rangeHigh: 10 },
        events: [ev("DISPLACEMENT_UP"), ev("BREAKOUT_UP", 10)],
        bars: [bar({ o: 10.2, h: 11.2, l: 10.1, c: 11.15 })],
      }),
    );
    const breakOff = one("BREAKOUT_ACCEPTANCE", "SHORT", hits({ state: "TREND_UP" }));
    assert.deepEqual(Object.keys(breakOn.evidence).sort(), [...MEASURED_KEYS.BREAKOUT_ACCEPTANCE]);
    for (const key of NOT_MEASURED.BREAKOUT_ACCEPTANCE) {
      assert.equal(Object.hasOwn(breakOn.evidence, key), false);
      assert.equal(measuredFlag(breakOn.evidence, key), null);
    }
    assert.equal(breakOn.evidence.displacement, true);
    assert.equal(breakOn.evidence.breakout, true);
    assert.equal(breakOff.evidence.trend, false);
    assert.equal(breakOff.evidence.displacement, false);
    assert.equal(breakOff.evidence.breakout, false);

    const sweepOn = one(
      "SWEEP_RECLAIM",
      "LONG",
      hits({
        events: [ev("SWEEP_LOW", 9.4), ev("DISPLACEMENT_UP")],
        bars: [bar({ c: 10.8 })],
      }),
    );
    const sweepOff = one("SWEEP_RECLAIM", "LONG", hits({}));
    assert.deepEqual(Object.keys(sweepOn.evidence).sort(), [...MEASURED_KEYS.SWEEP_RECLAIM]);
    assert.equal(sweepOn.evidence.reclaim, true);
    assert.equal(sweepOn.evidence.displacement, true);
    assert.equal(sweepOff.evidence.reclaim, false);
    assert.equal(sweepOff.evidence.displacement, false);
    assert.equal(sweepOff.evidence.structure, false);
    assert.equal(measuredFlag(sweepOff.evidence, "location"), null);
    assert.equal(measuredFlag(sweepOff.evidence, "trend"), null);
    assert.equal(measuredFlag(sweepOff.evidence, "pullback"), null);

    const failedOn = one(
      "FAILED_BREAKOUT",
      "LONG",
      hits({
        structure: { rangeLow: 9 },
        events: [ev("FAILED_BREAKOUT_DOWN", 9), ev("DISPLACEMENT_UP")],
        bars: [bar({ c: 10.5 })],
      }),
    );
    const failedOff = one("FAILED_BREAKOUT", "SHORT", hits({}));
    assert.deepEqual(Object.keys(failedOn.evidence).sort(), [...MEASURED_KEYS.FAILED_BREAKOUT]);
    assert.equal(failedOn.evidence.reclaim, true);
    assert.equal(failedOn.evidence.structure, true);
    assert.equal(failedOn.evidence.displacement, true);
    assert.equal(failedOff.evidence.reclaim, false);
    assert.equal(failedOff.evidence.displacement, false);
    assert.equal(measuredFlag(failedOff.evidence, "pullback"), null);

    const bars: Bar[] = [];
    for (let i = 0; i < 12; i++) bars.push(bar({ t: 1_700_000_000 + i * 900, o: 10, h: 10.2, l: 9.9, c: 10.05 }));
    bars.push(bar({ t: 1_700_000_000 + 12 * 900, o: 10, h: 12, l: 9.8, c: 11.7 }));
    const expansionOn = one(
      "EXPANSION_CONTINUATION",
      "LONG",
      hits({
        bars,
        state: "TREND_UP",
        structure: { bosUp: true },
        events: [ev("DISPLACEMENT_UP")],
        ctx: { atr: 2 },
      }),
    );
    const expansionOff = one("EXPANSION_CONTINUATION", "LONG", hits({ state: "RANGE", bars: [bar({ o: 10, h: 10.2, l: 9.9, c: 9.95 })] }));
    assert.deepEqual(Object.keys(expansionOn.evidence).sort(), [...MEASURED_KEYS.EXPANSION_CONTINUATION]);
    assert.equal(expansionOn.evidence.location, true);
    assert.equal(expansionOn.evidence.displacement, true);
    assert.equal(expansionOff.evidence.location, false);
    assert.equal(expansionOff.evidence.displacement, false);
    assert.equal(expansionOff.evidence.trend, false);
    assert.equal(measuredFlag(expansionOff.evidence, "reclaim"), null);
    assert.equal(measuredFlag(expansionOff.evidence, "pullback"), null);
  });

  it("a partial reading does not invent displacement, reclaim, pullback or trend", () => {
    const candle = bar({ o: 10, h: 11.2, l: 9.8, c: 11.05 });
    const reading = partialAt(
      [candle],
      0,
      state("RANGE"),
      structure({ rangeHigh: 10.4, rangeLow: 9.5 }),
      [ev("BREAKOUT_UP", 10.4)],
      ctx({ atr: 1 }),
    );
    assert.ok(reading);
    assert.deepEqual(Object.keys(reading!.evidence).sort(), ["confirmation", "direction", "event", "location", "partial", "structure"]);
    for (const key of Object.keys(reading!.evidence)) assert.equal(reading!.evidence[key], true);
    for (const key of ["displacement", "reclaim", "pullback", "trend", "breakout", "noRejection"]) {
      assert.equal(measuredFlag(reading!.evidence, key), null);
    }
    const none = partialAt([bar({ o: 10, h: 10.1, l: 9.9, c: 9.95 })], 0, state("RANGE"), structure(), [], ctx());
    assert.equal(none, null);
  });
});
