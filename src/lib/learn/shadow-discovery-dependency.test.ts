import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { AssetId } from "../trading/types.ts";
import { atrAt } from "./shadow-discovery-primitives.ts";
import { detectEvents } from "./shadow-discovery-events.ts";
import { closedBarsThrough, isBarClosed } from "./shadow-discovery-clock.ts";
import {
  classifyEventCommon4,
  classifySequenceCommon4,
  eventInCatalogUniverse,
} from "./shadow-discovery-dependency.ts";
import { collectExploreCatalog } from "./shadow-discovery-explore.ts";
import { DISCOVERY_ASSETS, type DiscoveryBar, type DiscoveryEvent, type DiscoverySequence, type DiscoveryTf } from "./shadow-discovery-types.ts";
import { eventUsedBarsBeforeCommon, type Common4Window } from "./shadow-discovery-universe.ts";
import { DISCOVERY_ONESHOT_MARK } from "./shadow-discovery-explore-once.ts";

const STEP = 900;
const FROM = 100_000;
const TO = FROM + 80 * STEP;

function src(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

function win(tf: DiscoveryTf = "15m", fromT = FROM, toT = TO): Common4Window {
  return {
    tf, available: true, fromT, toT, days: (toT - fromT) / 86400,
    assets: DISCOVERY_ASSETS, limitingAssets: [], n: null,
    unlocksNextTf: true, inference: "INSUFFICIENT", exploreGrade: "EXPLORE",
  };
}

function quiet(assetId: AssetId, t: number, tf: DiscoveryTf = "15m", px = 100): DiscoveryBar {
  return { assetId, tf, t, o: px, h: px + 1, l: px - 1, c: px + 0.2, v: 10, source: "test" };
}

function seriesFrom(times: number[], make: (t: number, i: number) => DiscoveryBar): DiscoveryBar[] {
  return times.map((t, i) => make(t, i));
}

function times(n: number, start: number, step = STEP): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function classify(e: DiscoveryEvent, w: Common4Window = win()) {
  return classifyEventCommon4(e, w);
}

describe("A. RANGE + ASSET_DEEP prefix, lookback inside COMMON_4", () => {
  it("range_breakout with 16-bar lookback inside window is STRICT and CAUSAL", () => {
    const prefixN = 25;
    const ts = times(prefixN + 20, FROM - prefixN * STEP);
    const bars = seriesFrom(ts, (t, i) => {
      if (i === prefixN + 16) {
        return { assetId: "BTCUSD" as const, tf: "15m" as const, t, o: 100, h: 108, l: 100, c: 107, v: 10, source: "test" };
      }
      return quiet("BTCUSD", t);
    });
    const evs = detectEvents(bars).filter((e) => e.kind === "range_breakout" && e.openT >= FROM);
    assert.ok(evs.length >= 1, "expected in-window range_breakout");
    const e = evs[0]!;
    const dep = classify(e);
    assert.equal(e.geometryMinT >= FROM, true, `geometryMinT=${e.geometryMinT}`);
    assert.equal(dep.usesPreCommonGeometry, false);
    assert.equal(e.stateMinT, null);
    assert.equal(dep.usesPreCommonState, false);
    assert.equal(dep.strict, true);
    assert.equal(dep.causal, true);
    assert.equal(eventInCatalogUniverse(dep, "COMMON_4_STRICT"), true);
    assert.equal(eventInCatalogUniverse(dep, "COMMON_4_CAUSAL"), true);
    assert.equal(eventUsedBarsBeforeCommon(bars, e, win()), true, "legacy prefix bound still true");
  });
});

describe("B. RANGE lookback crosses COMMON_4.fromT", () => {
  it("range_breakout with i-16 before fromT is neither STRICT nor CAUSAL", () => {
    const prefixN = 20;
    const ts = times(prefixN + 8, FROM - prefixN * STEP);
    const bars = seriesFrom(ts, (t, i) => {
      if (i === prefixN + 5) {
        return { assetId: "BTCUSD" as const, tf: "15m" as const, t, o: 100, h: 108, l: 100, c: 107, v: 10, source: "test" };
      }
      return quiet("BTCUSD", t);
    });
    const evs = detectEvents(bars).filter((e) => e.kind === "range_breakout" && e.openT >= FROM);
    assert.ok(evs.length >= 1);
    const e = evs[0]!;
    const dep = classify(e);
    assert.equal(dep.usesPreCommonGeometry, true);
    assert.ok(dep.warmupReason.includes("geometry_prefix"));
    assert.equal(dep.strict, false);
    assert.equal(dep.causal, false);
  });
});

describe("C/D. SWEEP lastSwing", () => {
  function sweepSeries(opts: { peakBeforeFrom: boolean }): DiscoveryBar[] {
    const prefixN = 20;
    const peakI = opts.peakBeforeFrom ? 8 : prefixN + 6;
    const sweepI = prefixN + 18;
    const ts = times(sweepI + 1, FROM - prefixN * STEP);
    return seriesFrom(ts, (t, i) => {
      if (i === peakI) {
        return { assetId: "BTCUSD" as const, tf: "15m" as const, t, o: 100, h: 130, l: 99, c: 101, v: 10, source: "test" };
      }
      if (i === sweepI) {
        return { assetId: "BTCUSD" as const, tf: "15m" as const, t, o: 100, h: 135, l: 99, c: 101, v: 10, source: "test" };
      }
      return quiet("BTCUSD", t);
    });
  }

  it("C. in-window sweep of pre-COMMON swing is CAUSAL not STRICT, last_swing", () => {
    const bars = sweepSeries({ peakBeforeFrom: true });
    const evs = detectEvents(bars).filter((e) => e.kind === "sweep_prior_high" && e.openT >= FROM);
    assert.ok(evs.length >= 1, "expected sweep");
    const e = evs[0]!;
    const dep = classify(e);
    assert.equal(dep.usesPreCommonGeometry, false);
    assert.equal(dep.usesPreCommonState, true);
    assert.equal(dep.strict, false);
    assert.equal(dep.causal, true);
    assert.ok(dep.warmupReason.includes("last_swing"));
    assert.ok(!dep.warmupReason.includes("geometry_prefix"));
  });

  it("D. sweep of in-window swing is STRICT and CAUSAL", () => {
    const bars = sweepSeries({ peakBeforeFrom: false });
    const evs = detectEvents(bars).filter((e) => e.kind === "sweep_prior_high" && e.openT >= FROM);
    assert.ok(evs.length >= 1);
    const e = evs[0]!;
    const dep = classify(e);
    assert.equal(dep.usesPreCommonGeometry, false);
    assert.equal(dep.usesPreCommonState, false);
    assert.equal(dep.strict, true);
    assert.equal(dep.causal, true);
  });
});

describe("E/F. FVG retest", () => {
  function fvgSeries(createdI: number, retestI: number): DiscoveryBar[] {
    const n = retestI + 1;
    const start = FROM - 20 * STEP;
    const ts = times(n, start);
    return seriesFrom(ts, (t, i) => {
      if (i === createdI - 2) {
        return { assetId: "XAUUSD" as const, tf: "15m" as const, t, o: 100, h: 100, l: 98, c: 99, v: 10, source: "test" };
      }
      if (i === createdI) {
        return { assetId: "XAUUSD" as const, tf: "15m" as const, t, o: 112, h: 114, l: 111, c: 113, v: 10, source: "test" };
      }
      if (i === retestI) {
        return { assetId: "XAUUSD" as const, tf: "15m" as const, t, o: 112, h: 113, l: 105, c: 106, v: 10, source: "test" };
      }
      if (i > createdI && i < retestI) {
        return { assetId: "XAUUSD" as const, tf: "15m" as const, t, o: 112, h: 114, l: 111.5, c: 113, v: 10, source: "test" };
      }
      return quiet("XAUUSD", t, "15m", 112);
    });
  }

  it("E. FVG created before fromT, retest in window → CAUSAL last_fvg", () => {
    const createdI = 10;
    const retestI = 35;
    const bars = fvgSeries(createdI, retestI);
    assert.ok(bars[createdI]!.t < FROM);
    assert.ok(bars[retestI]!.t >= FROM);
    const evs = detectEvents(bars).filter((e) => e.kind === "fvg_retested" && e.openT >= FROM);
    assert.ok(evs.length >= 1, "expected fvg_retested");
    const dep = classify(evs[0]!);
    assert.equal(dep.usesPreCommonGeometry, false);
    assert.equal(dep.usesPreCommonState, true);
    assert.equal(dep.strict, false);
    assert.equal(dep.causal, true);
    assert.ok(dep.warmupReason.includes("last_fvg"));
  });

  it("F. FVG created and retested inside COMMON_4 → STRICT", () => {
    const createdI = 28;
    const retestI = 40;
    const bars = fvgSeries(createdI, retestI);
    assert.ok(bars[createdI]!.t >= FROM);
    const evs = detectEvents(bars).filter((e) => e.kind === "fvg_retested");
    assert.ok(evs.length >= 1);
    const dep = classify(evs[0]!);
    assert.equal(dep.strict, true);
    assert.equal(dep.causal, true);
  });
});

describe("G/H/I. displacement A4c ATR Wilder", () => {
  function dispBars(prefixN: number, bodyI: number): DiscoveryBar[] {
    const ts = times(bodyI + 1, FROM - prefixN * STEP);
    return seriesFrom(ts, (t, i) => {
      if (i === bodyI) {
        return { assetId: "BTCUSD" as const, tf: "15m" as const, t, o: 100, h: 180, l: 99, c: 175, v: 10, source: "test" };
      }
      if (i < prefixN) {
        return { assetId: "BTCUSD" as const, tf: "15m" as const, t, o: 100, h: 140, l: 60, c: 100.2, v: 10, source: "test" };
      }
      return quiet("BTCUSD", t);
    });
  }

  it("G. prefix ASSET_DEEP → displacement CAUSAL, atr_wilder, not STRICT", () => {
    const prefixN = 30;
    const bodyI = 45;
    const bars = dispBars(prefixN, bodyI);
    const evs = detectEvents(bars).filter((e) => e.kind === "displacement" && e.openT >= FROM);
    assert.ok(evs.length >= 1);
    const e = evs[0]!;
    const idx = Number(e.extra.index);
    assert.equal(e.atr, atrAt(bars, idx));
    const dep = classify(e);
    assert.equal(dep.usesPreCommonGeometry, false);
    assert.equal(dep.usesPreCommonState, true);
    assert.equal(dep.strict, false);
    assert.equal(dep.causal, true);
    assert.ok(dep.warmupReason.includes("atr_wilder"));
  });

  it("H. series starts at COMMON_4 → displacement STRICT once ATR exists; none before", () => {
    const bars = dispBars(0, 20);
    assert.equal(bars[0]!.t, FROM);
    const all = detectEvents(bars).filter((e) => e.kind === "displacement");
    assert.equal(all.some((e) => Number(e.extra.index) < 14), false);
    const e = all.find((x) => x.openT === bars[20]!.t);
    assert.ok(e);
    const dep = classify(e!);
    assert.equal(dep.usesPreCommonState, false);
    assert.equal(dep.strict, true);
  });

  it("I. ATR is NOT recomputed from fromT (A4c, not A4b)", () => {
    const prefixN = 30;
    const bodyI = 45;
    const bars = dispBars(prefixN, bodyI);
    const e = detectEvents(bars).find((x) => x.kind === "displacement" && x.openT >= FROM)!;
    const idx = Number(e.extra.index);
    const fromIdx = bars.findIndex((b) => b.t >= FROM);
    const clipped = bars.slice(fromIdx);
    const iClip = idx - fromIdx;
    assert.equal(e.atr, atrAt(bars, idx));
    assert.notEqual(e.atr, atrAt(clipped, iClip));
    assert.doesNotMatch(src("shadow-discovery-events.ts"), /COMMON_4|fromT|clipBarsToCommon4/);
    assert.doesNotMatch(src("shadow-discovery-primitives.ts"), /COMMON_4/);
  });
});

describe("J/K. sequences inherit legs", () => {
  const w = win();
  function ev(kind: DiscoveryEvent["kind"], openT: number, geo: number, state: number | null): DiscoveryEvent {
    return {
      id: `BTCUSD|15m|${kind}|${openT}`,
      assetId: "BTCUSD", tf: "15m", kind, openT, closeT: openT + STEP,
      direction: "buy", level: 1, atr: 1, extra: {}, warmupOutsideCommon: false,
      geometryMinT: geo, stateMinT: state,
    };
  }

  it("J. STRICT leg + CAUSAL leg → sequence CAUSAL, not STRICT", () => {
    const a = ev("range_breakout", FROM + 20 * STEP, FROM + 4 * STEP, null);
    const b = ev("displacement", FROM + 22 * STEP, FROM + 22 * STEP, FROM - 10 * STEP);
    assert.equal(classify(a).strict, true);
    assert.equal(classify(b).causal, true);
    assert.equal(classify(b).strict, false);
    const seq: DiscoverySequence = {
      family: "BREAKOUT_RETEST_CONTINUE",
      assetId: "BTCUSD",
      legs: [a, b],
      decisionCloseT: b.closeT,
    };
    const dep = classifySequenceCommon4(seq, [w]);
    assert.equal(dep.strict, false);
    assert.equal(dep.causal, true);
    assert.ok(dep.warmupReason.includes("atr_wilder"));
  });

  it("K. geometry pre-COMMON on a leg → neither STRICT nor CAUSAL", () => {
    const a = ev("range_breakout", FROM + 5 * STEP, FROM - STEP, null);
    const b = ev("reclaim", FROM + 6 * STEP, FROM + STEP, null);
    const seq: DiscoverySequence = {
      family: "BREAKOUT_RETEST_CONTINUE",
      assetId: "BTCUSD",
      legs: [a, b],
      decisionCloseT: b.closeT,
    };
    const dep = classifySequenceCommon4(seq, [w]);
    assert.equal(dep.strict, false);
    assert.equal(dep.causal, false);
    assert.ok(dep.warmupReason.includes("geometry_prefix"));
  });
});

describe("L. HTF/LTF sequence", () => {
  it("HTF bos with lastSwing pre-common → sequence CAUSAL, not STRICT, keeps mtf join", () => {
    const w4 = win("4h", FROM, TO);
    const w15 = win("15m", FROM, TO);
    const bos: DiscoveryEvent = {
      id: "BTCUSD|4h|bos_up|1",
      assetId: "BTCUSD", tf: "4h", kind: "bos_up",
      openT: FROM + 14400, closeT: FROM + 28800,
      direction: "buy", level: 1, atr: 1, extra: { swingIndex: 2 },
      warmupOutsideCommon: false,
      geometryMinT: FROM + 14400,
      stateMinT: FROM - 28800,
    };
    const sweep: DiscoveryEvent = {
      id: "BTCUSD|15m|sweep_prior_low|2",
      assetId: "BTCUSD", tf: "15m", kind: "sweep_prior_low",
      openT: FROM + 30000, closeT: FROM + 30900,
      direction: "buy", level: 1, atr: 1, extra: {},
      warmupOutsideCommon: false,
      geometryMinT: FROM + 30000,
      stateMinT: FROM + 20000,
    };
    assert.equal(classifyEventCommon4(bos, w4).causal, true);
    assert.equal(classifyEventCommon4(bos, w4).strict, false);
    assert.equal(classifyEventCommon4(sweep, w15).strict, true);
    const seq: DiscoverySequence = {
      family: "HTF_CONTEXT_LTF_EVENT",
      assetId: "BTCUSD",
      legs: [bos, sweep],
      decisionCloseT: sweep.closeT,
    };
    const dep = classifySequenceCommon4(seq, [w4, w15]);
    assert.equal(dep.strict, false);
    assert.equal(dep.causal, true);
    assert.ok(dep.warmupReason.includes("last_swing"));
    assert.ok(dep.warmupReason.includes("htf_leg"));
    const seqSrc = src("shadow-discovery-sequences.ts");
    assert.match(seqSrc, /mtfLegsInValidWindows/);
  });
});

describe("M. open candle never classified", () => {
  it("unclosed last bar is dropped before detectEvents in catalog path", () => {
    const lastOpen = FROM + 10 * STEP;
    const bars = times(12, FROM - STEP).map((t) => quiet("US100", t));
    bars[bars.length - 1] = quiet("US100", lastOpen);
    const nowSec = lastOpen + STEP - 1;
    assert.equal(isBarClosed(bars[bars.length - 1]!, nowSec), false);
    const closed = closedBarsThrough(bars, nowSec);
    assert.equal(closed.some((b) => b.t === lastOpen), false);
    const evs = detectEvents(closed);
    assert.equal(evs.some((e) => e.openT === lastOpen), false);
  });
});

describe("N. future invariance", () => {
  it("bars after decision do not change historical STRICT/CAUSAL labels", () => {
    const prefixN = 30;
    const bodyI = 45;
    const ts = times(bodyI + 1, FROM - prefixN * STEP);
    const bars = seriesFrom(ts, (t, i) => i === bodyI
      ? { assetId: "BTCUSD" as const, tf: "15m" as const, t, o: 100, h: 120, l: 99, c: 118, v: 10, source: "test" }
      : quiet("BTCUSD", t));
    const a = detectEvents(bars);
    const future = { assetId: "BTCUSD" as const, tf: "15m" as const, t: bars[bars.length - 1]!.t + STEP, o: 1, h: 9, l: 1, c: 8, v: 10, source: "test" };
    const b = detectEvents([...bars, future]);
    const histA = a.filter((e) => e.openT <= bars[bodyI]!.t).map((e) => {
      const d = classify(e);
      return `${e.id}|${d.strict}|${d.causal}|${d.warmupReason.join(",")}`;
    });
    const histB = b.filter((e) => e.openT <= bars[bodyI]!.t).map((e) => {
      const d = classify(e);
      return `${e.id}|${d.strict}|${d.causal}|${d.warmupReason.join(",")}`;
    });
    assert.deepEqual(histB, histA);
  });
});

describe("O. FIRST_ONESHOT intact", () => {
  it("default catalog still uses prefix bound, not STRICT/CAUSAL", () => {
    const once = src("shadow-discovery-explore-once.ts");
    assert.match(once, /FIRST_ONESHOT_EXPLORE/);
    assert.match(once, /DISCOVERY_ONESHOT_MARK/);
    assert.doesNotMatch(once, /catalogUniverse/);
    assert.doesNotMatch(once, /COMMON_4_STRICT|COMMON_4_CAUSAL/);
    assert.equal(DISCOVERY_ONESHOT_MARK, "FIRST_ONESHOT_EXPLORE");
    const explore = src("shadow-discovery-explore.ts");
    assert.match(explore, /isCommon4CatalogEvent/);
    assert.match(explore, /eventUsedBarsBeforeCommon/);
    const breakoutAt = (id: AssetId, start: number, n: number, breakI: number) =>
      seriesFrom(times(n, start), (t, i) => {
        if (i === breakI) {
          return { assetId: id, tf: "15m" as const, t, o: 100, h: 108, l: 100, c: 107, v: 10, source: "test" };
        }
        return quiet(id, t);
      });
    const bars = [
      ...breakoutAt("BTCUSD", FROM - 25 * STEP, 50, 25 + 16),
      ...breakoutAt("XAUUSD", FROM - 25 * STEP, 50, 25 + 16),
      ...breakoutAt("US100", FROM, 25, 16),
      ...breakoutAt("WTI", FROM, 25, 16),
    ];
    const nowSec = TO + STEP;
    const legacy = collectExploreCatalog(bars, nowSec, "shadow-discovery-1", { detectPatterns: true });
    const strict = collectExploreCatalog(bars, nowSec, "shadow-discovery-1", {
      detectPatterns: true, catalogUniverse: "COMMON_4_STRICT",
    });
    assert.equal(legacy.report.journal.universe, "COMMON_4");
    assert.equal(strict.report.journal.universe, "COMMON_4_STRICT");
    const btcLegacy = legacy.report.eventCounts.reduce((s, r) => s + (r.byAsset.BTCUSD ?? 0), 0);
    const btcStrict = strict.report.eventCounts.reduce((s, r) => s + (r.byAsset.BTCUSD ?? 0), 0);
    assert.equal(btcLegacy, 0, "legacy prefix bound still drops BTC");
    assert.ok(btcStrict > 0, "STRICT per-primitive can count BTC range_breakout");
  });
});

describe("A4c / no outcome", () => {
  it("dependency module does not import outcome or ranking", () => {
    const d = src("shadow-discovery-dependency.ts");
    assert.doesNotMatch(d, /outcomeAfterEvent|expectancy|pnl|winRate|ranking/i);
    const e = src("shadow-discovery-events.ts");
    assert.doesNotMatch(e, /outcomeAfterEvent/);
  });
});
