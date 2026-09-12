import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { barCloseSec } from "./shadow-discovery-clock.ts";
import {
  DISCOVERY_ARCHIVE_TFS,
  DISCOVERY_ASSETS,
  DISCOVERY_COMMON_MIN_DAYS,
  type DiscoveryBar,
  type DiscoveryEvent,
  type DiscoveryTf,
} from "./shadow-discovery-types.ts";
import {
  assetDeepSlices,
  attachCommon4BarCount,
  classifyBarUniverse,
  clipBarsToAssetDeep,
  clipBarsToCommon4,
  common4Window,
  eventUsedBarsBeforeCommon,
  htfContextBars,
  intersectWindows,
  isCommon4CatalogEvent,
  mtfLegsInValidWindows,
  mtfPairAvailability,
  nextDiscoveryTfToBackfill,
  nextTfToCompleteCoverage,
  assetsNeedingCoverage,
  tfUnlocksNext,
  type Common4Window,
  type DiscoveryAssetSpan,
} from "./shadow-discovery-universe.ts";
import { detectEvents } from "./shadow-discovery-events.ts";
import { exploreDiscovery } from "./shadow-discovery-explore.ts";
import { detectHtfContextSequences, detectSequences } from "./shadow-discovery-sequences.ts";
import type { AssetId } from "../trading/types.ts";

const DAY = 86400;
const NOW = 2_000_000_000;

function span(
  assetId: AssetId,
  days: number,
  exhausted: boolean,
  tf: DiscoveryTf = "15m",
  lastT = NOW,
): DiscoveryAssetSpan {
  return {
    assetId,
    tf,
    firstT: lastT - days * DAY,
    lastT,
    exhausted,
  };
}

function four(days: number, exhausted = false): DiscoveryAssetSpan[] {
  return DISCOVERY_ASSETS.map((id) => span(id, days, exhausted));
}

function bar(assetId: AssetId, t: number, tf: DiscoveryTf = "15m"): DiscoveryBar {
  return {
    assetId, tf, t, o: 1, h: 2, l: 0.5, c: 1.1, v: 1, source: "test",
  };
}

function ev(p: Partial<DiscoveryEvent> & Pick<DiscoveryEvent, "kind" | "tf" | "openT" | "closeT">): DiscoveryEvent {
  return {
    id: `${p.assetId ?? "BTCUSD"}|${p.tf}|${p.kind}|${p.openT}`,
    assetId: "BTCUSD",
    direction: null,
    level: null,
    atr: null,
    extra: {},
    warmupOutsideCommon: false,
    ...p,
  };
}

function win(fromT: number, toT: number, tf: DiscoveryTf = "15m"): Common4Window {
  return {
    tf,
    available: true,
    fromT,
    toT,
    days: (toT - fromT) / DAY,
    assets: DISCOVERY_ASSETS,
    limitingAssets: [],
    n: null,
    unlocksNextTf: true,
    inference: "INSUFFICIENT",
    exploreGrade: "EXPLORE",
  };
}

describe("Discovery COMMON_MIN unlock vs exhausted", () => {
  it("COMMON_MIN is 30 days and is not a sufficiency claim", () => {
    assert.equal(DISCOVERY_COMMON_MIN_DAYS, 30);
    const src = readFileSync(new URL("./shadow-discovery-types.ts", import.meta.url), "utf8");
    assert.match(src, /Not a sufficiency/);
  });

  it("4 assets with 30d unlock the next TF (30m)", () => {
    const spans = four(30, false);
    assert.equal(tfUnlocksNext(spans, "15m"), true);
    assert.equal(nextDiscoveryTfToBackfill(spans), "30m");
  });

  it("29d does not unlock 30m", () => {
    const spans = four(29, false);
    assert.equal(tfUnlocksNext(spans, "15m"), false);
    assert.equal(nextDiscoveryTfToBackfill(spans), "15m");
  });

  it("exhausted=true unlocks even with fewer than 30d", () => {
    const spans = [
      span("XAUUSD", 30, false),
      span("BTCUSD", 30, false),
      span("US100", 10, true),
      span("WTI", 8, true),
    ];
    assert.equal(tfUnlocksNext(spans, "15m"), true);
    assert.equal(nextDiscoveryTfToBackfill(spans), "30m");
  });

  it("BTC 260d + XAU 78d + US100/WTI 31d do not block 30m", () => {
    const spans = [
      span("XAUUSD", 78, false),
      span("BTCUSD", 260, false),
      span("US100", 31, true),
      span("WTI", 31, true),
    ];
    assert.equal(tfUnlocksNext(spans, "15m"), true);
    assert.equal(nextDiscoveryTfToBackfill(spans), "30m");
    const common = common4Window(spans, "15m");
    assert.equal(common.available, true);
    assert.ok(common.days != null && common.days >= 30 && common.days < 32);
    assert.equal(common.inference, "INSUFFICIENT");
  });

  it("nextTfToCompleteCoverage is null once every archive TF meets COMMON_MIN", () => {
    const spans = DISCOVERY_ARCHIVE_TFS.flatMap((tf) => four(31, false).map((s) => ({ ...s, tf })));
    assert.equal(nextTfToCompleteCoverage(spans), null);
    assert.equal(nextDiscoveryTfToBackfill(spans), "15m");
  });

  it("assets below COMMON_MIN on an incomplete TF are the only ones needing coverage", () => {
    const spans = [
      span("XAUUSD", 78, false),
      span("BTCUSD", 260, false),
      span("US100", 10, false),
      span("WTI", 8, false),
    ];
    assert.equal(nextTfToCompleteCoverage(spans), "15m");
    assert.deepEqual(assetsNeedingCoverage(spans, "15m"), ["US100", "WTI"]);
  });
});

describe("COMMON_4 is a real intersection", () => {
  it("does not substitute min(oldest_t) for the overlap", () => {
    const spans: DiscoveryAssetSpan[] = [
      { assetId: "XAUUSD", tf: "15m", firstT: 200, lastT: 500, exhausted: false },
      { assetId: "BTCUSD", tf: "15m", firstT: 100, lastT: 400, exhausted: false },
      { assetId: "US100", tf: "15m", firstT: 150, lastT: 350, exhausted: true },
      { assetId: "WTI", tf: "15m", firstT: 180, lastT: 360, exhausted: true },
    ];
    const hit = intersectWindows(spans.map((s) => ({ fromT: s.firstT!, toT: s.lastT! })));
    assert.deepEqual(hit, { fromT: 200, toT: 350 });
    const common = common4Window(spans, "15m");
    assert.equal(common.fromT, 200);
    assert.equal(common.toT, 350);
    assert.notEqual(common.fromT, 100);
  });

  it("BTC/XAU extra tape stays ASSET_DEEP and does not enter COMMON_4", () => {
    const lastT = NOW;
    const spans = [
      span("XAUUSD", 78, false, "15m", lastT),
      span("BTCUSD", 260, false, "15m", lastT),
      span("US100", 31, true, "15m", lastT),
      span("WTI", 31, true, "15m", lastT),
    ];
    const common = common4Window(spans, "15m");
    const bars: DiscoveryBar[] = [
      bar("BTCUSD", lastT - 200 * DAY),
      bar("BTCUSD", lastT - 10 * DAY),
      bar("XAUUSD", lastT - 10 * DAY),
      bar("US100", lastT - 10 * DAY),
      bar("WTI", lastT - 10 * DAY),
    ];
    const commonBars = clipBarsToCommon4(bars, common);
    const deep = clipBarsToAssetDeep(bars, common);
    assert.equal(classifyBarUniverse(bars[0]!, common), "ASSET_DEEP");
    assert.equal(commonBars.some((b) => b.t === lastT - 200 * DAY), false);
    assert.equal(deep.some((b) => b.assetId === "BTCUSD" && b.t === lastT - 200 * DAY), true);
    assert.equal(commonBars.length, 4);
    const slices = assetDeepSlices(bars, common);
    assert.equal(slices.some((s) => s.assetId === "BTCUSD" && s.extraBars === 1), true);
  });

  it("ASSET_DEEP remains a separate universe in the explore report", () => {
    const lastT = NOW;
    const mk = (id: AssetId, days: number) => {
      const out: DiscoveryBar[] = [];
      const first = lastT - days * DAY;
      for (let t = first; t <= lastT; t += 3 * DAY) {
        out.push(bar(id, t));
      }
      return out;
    };
    const bars = [
      ...mk("BTCUSD", 260),
      ...mk("XAUUSD", 78),
      ...mk("US100", 31),
      ...mk("WTI", 31),
    ];
    const report = exploreDiscovery(bars, lastT + 900, "shadow-discovery-1", { detectPatterns: false });
    const c15 = report.universes.common4.find((c) => c.tf === "15m");
    assert.ok(c15?.available);
    assert.ok((c15!.days ?? 0) < 32);
    const btcDeep = report.universes.assetDeep.find((d) => d.assetId === "BTCUSD" && d.tf === "15m");
    assert.ok(btcDeep && btcDeep.extraBars > 0);
    assert.equal(report.universes.inference, "INSUFFICIENT");
    assert.equal(report.journal.universe, "COMMON_4");
    assert.equal(report.journal.outcomeConsulted, false);
    assert.match(report.journal.notes ?? "", /descriptivo, no validación/);
    assert.equal(report.rankingByExpectancy, false);
  });
});

describe("MTF join causality", () => {
  const htfWindow = { fromT: 0, toT: 80_000 };
  const ltfWindow = { fromT: 0, toT: 80_000 };
  const decisionOpen = 14_400;
  const decisionClose = barCloseSec(decisionOpen, "15m"); // 15300
  const closedHtf = { ...bar("BTCUSD", 0, "4h"), tf: "4h" as const, t: 0 };           // close 14400
  const openHtf = { ...bar("BTCUSD", 14_400, "4h"), tf: "4h" as const, t: 14_400 };   // close 28800
  const ltf = bar("BTCUSD", decisionOpen, "15m");

  it("A. HTF close > decisionClose is excluded", () => {
    const legs = mtfLegsInValidWindows({
      htf: [closedHtf, openHtf], ltf: [ltf], htfWindow, ltfWindow, decisionClose,
    });
    assert.equal(legs.htf.some((b) => b.t === 14_400), false);
  });

  it("B. HTF still open (bar containing the decision) is excluded", () => {
    const legs = mtfLegsInValidWindows({
      htf: [openHtf], ltf: [ltf], htfWindow, ltfWindow, decisionClose,
    });
    assert.equal(legs.htf.length, 0);
  });

  it("C. HTF close == decisionClose is included", () => {
    const atOpenOf4h = 14_400;
    const legs = mtfLegsInValidWindows({
      htf: [closedHtf, openHtf],
      ltf: [bar("BTCUSD", 13_500, "15m")],
      htfWindow,
      ltfWindow,
      decisionClose: atOpenOf4h,
    });
    assert.equal(legs.htf.length, 1);
    assert.equal(legs.htf[0]!.t, 0);
    assert.equal(barCloseSec(0, "4h"), atOpenOf4h);
  });

  it("D. HTF outside COMMON_4 is excluded", () => {
    const legs = mtfLegsInValidWindows({
      htf: [{ ...bar("BTCUSD", -10_000, "4h"), tf: "4h", t: -10_000 }, closedHtf],
      ltf: [ltf],
      htfWindow,
      ltfWindow,
      decisionClose,
    });
    assert.equal(legs.htf.some((b) => b.t === -10_000), false);
    assert.equal(legs.htf.some((b) => b.t === 0), true);
  });

  it("E. LTF outside COMMON_4 is excluded", () => {
    const outside = bar("BTCUSD", 90_000, "15m");
    const legs = mtfLegsInValidWindows({
      htf: [closedHtf],
      ltf: [outside],
      htfWindow,
      ltfWindow,
      decisionClose: barCloseSec(90_000, "15m"),
    });
    assert.equal(legs.ltf.length, 0);
    assert.equal(legs.htf.length, 0);
  });

  it("F. ASSET_DEEP HTF does not enter a COMMON_4 join", () => {
    const deep = { ...bar("BTCUSD", -50_000, "4h"), tf: "4h" as const, t: -50_000 };
    const ctx = htfContextBars({
      htf: [deep, closedHtf],
      ltf: [ltf],
      htfWindow: win(0, 80_000, "4h"),
      ltfWindow: win(0, 80_000, "15m"),
      decisionClose,
    });
    assert.equal(ctx.some((b) => b.t === -50_000), false);
    assert.equal(ctx.some((b) => b.t === 0), true);
  });

  it("H. htfContextBars cannot return HTF outside the window", () => {
    const ctx = htfContextBars({
      htf: [{ ...bar("BTCUSD", 1_000, "4h"), tf: "4h", t: 1_000 }, closedHtf],
      ltf: [ltf],
      htfWindow: win(5_000, 80_000, "4h"),
      ltfWindow: win(0, 80_000, "15m"),
      decisionClose,
    });
    assert.equal(ctx.some((b) => b.t === 1_000), false);
  });

  it("K. future HTF after the decision does not change the join", () => {
    const base = mtfLegsInValidWindows({
      htf: [closedHtf], ltf: [ltf], htfWindow, ltfWindow, decisionClose,
    });
    const future = { ...bar("BTCUSD", 28_800, "4h"), tf: "4h" as const, t: 28_800 };
    const withFuture = mtfLegsInValidWindows({
      htf: [closedHtf, future], ltf: [ltf], htfWindow, ltfWindow, decisionClose,
    });
    assert.deepEqual(withFuture.htf.map((b) => b.t), base.htf.map((b) => b.t));
  });
});

describe("HTF_CONTEXT uses the causal join", () => {
  it("G. detectSequences does not emit HTF_CONTEXT; join does", () => {
    const htfBar = { ...bar("BTCUSD", 0, "4h"), tf: "4h" as const, t: 0 };
    const ltfBar = bar("BTCUSD", 14_400, "15m");
    const htfEv = ev({ kind: "bos_down", tf: "4h", openT: 0, closeT: barCloseSec(0, "4h"), direction: "sell" });
    const ltfEv = ev({
      kind: "sweep_prior_high", tf: "15m", openT: 14_400, closeT: barCloseSec(14_400, "15m"), direction: "sell",
    });
    assert.equal(detectSequences([htfEv, ltfEv]).filter((s) => s.family === "HTF_CONTEXT_LTF_EVENT").length, 0);
    const seq = detectHtfContextSequences({
      events: [htfEv, ltfEv],
      htfBars: [htfBar],
      ltfBars: [ltfBar],
      htfWindow: win(0, 80_000, "4h"),
      ltfWindow: win(0, 80_000, "15m"),
    });
    assert.equal(seq.length, 1);
    assert.equal(seq[0]!.family, "HTF_CONTEXT_LTF_EVENT");
    assert.equal(seq[0]!.legs[0]!.openT, 0);
    assert.equal(seq[0]!.legs[1]!.openT, 14_400);
  });

  it("G. ASSET_DEEP HTF event is not a COMMON_4 context leg", () => {
    const deepHtf = { ...bar("BTCUSD", -50_000, "4h"), tf: "4h" as const, t: -50_000 };
    const ltfBar = bar("BTCUSD", 14_400, "15m");
    const htfEv = ev({ kind: "bos_down", tf: "4h", openT: -50_000, closeT: barCloseSec(-50_000, "4h") });
    const ltfEv = ev({ kind: "sweep_prior_high", tf: "15m", openT: 14_400, closeT: barCloseSec(14_400, "15m") });
    const seq = detectHtfContextSequences({
      events: [htfEv, ltfEv],
      htfBars: [deepHtf],
      ltfBars: [ltfBar],
      htfWindow: win(0, 80_000, "4h"),
      ltfWindow: win(0, 80_000, "15m"),
    });
    assert.equal(seq.length, 0);
  });

  it("source: HTF_CONTEXT is skipped in detectSequences and routed through mtfLegs", () => {
    const seqSrc = readFileSync(new URL("./shadow-discovery-sequences.ts", import.meta.url), "utf8");
    assert.match(seqSrc, /if \(family === "HTF_CONTEXT_LTF_EVENT"\) continue/);
    assert.match(seqSrc, /mtfLegsInValidWindows/);
    assert.doesNotMatch(seqSrc, /htfContextBars\(/);
    const lab = readFileSync(new URL("./shadow-discovery.ts", import.meta.url), "utf8");
    assert.match(lab, /detectPatterns:\s*false/);
  });
});

describe("warmup outside COMMON_4", () => {
  it("I. tags events whose prefix used bars before COMMON_4.fromT", () => {
    const common = win(10_000, 50_000, "15m");
    const series = [
      bar("BTCUSD", 1_000),
      bar("BTCUSD", 10_000),
      bar("BTCUSD", 10_900),
    ];
    const inside = ev({ kind: "displacement", tf: "15m", openT: 10_000, closeT: 10_900, extra: { index: 1 } });
    assert.equal(eventUsedBarsBeforeCommon(series, inside, common), true);
    const noWarm = ev({ kind: "displacement", tf: "15m", openT: 10_000, closeT: 10_900, extra: { index: 0 } });
    assert.equal(eventUsedBarsBeforeCommon([series[1]!, series[2]!], noWarm, common), false);
  });
});

const STEP = 900;

function rampAsset(id: AssetId, firstT: number, n: number): DiscoveryBar[] {
  const out: DiscoveryBar[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = px + 0.2;
    out.push({
      assetId: id,
      tf: "15m",
      t: firstT + i * STEP,
      o,
      h: Math.max(o, c) + 0.4,
      l: Math.min(o, c) - 0.4,
      c,
      v: 8,
      source: "test",
    });
    px = c;
  }
  return out;
}

describe("COMMON_4 catalog excludes warmup (A–E, K)", () => {
  const commonFirst = 20_000;
  const commonBars = 40;
  const extraBtc = 20;
  const lastT = commonFirst + (commonBars - 1) * STEP;
  const bars: DiscoveryBar[] = [
    ...rampAsset("BTCUSD", commonFirst - extraBtc * STEP, extraBtc + commonBars),
    ...rampAsset("XAUUSD", commonFirst, commonBars),
    ...rampAsset("US100", commonFirst, commonBars),
    ...rampAsset("WTI", commonFirst, commonBars),
  ];
  const nowSec = lastT + STEP;
  const report = exploreDiscovery(bars, nowSec, "shadow-discovery-1", { detectPatterns: true });
  const c15 = report.universes.common4.find((c) => c.tf === "15m")!;
  const clipped = clipBarsToCommon4(bars, c15);

  it("A. event inside COMMON_4 with warmup fully inside COMMON_4 is counted", () => {
    const usn = report.eventCounts.reduce((s, row) => s + (row.byAsset.US100 ?? 0), 0);
    assert.ok(usn > 0, "US100 (no ASSET_DEEP prefix) must contribute catalog events");
    const sample = ev({
      assetId: "US100",
      kind: "displacement",
      tf: "15m",
      openT: commonFirst + 20 * STEP,
      closeT: commonFirst + 21 * STEP,
      warmupOutsideCommon: false,
    });
    assert.equal(isCommon4CatalogEvent(sample, c15), true);
  });

  it("B. event inside COMMON_4 that needs bars before fromT is NOT counted", () => {
    const btcN = report.eventCounts.reduce((s, row) => s + (row.byAsset.BTCUSD ?? 0), 0);
    assert.equal(btcN, 0);
    const warm = ev({
      kind: "displacement",
      tf: "15m",
      openT: commonFirst + 5 * STEP,
      closeT: commonFirst + 6 * STEP,
      warmupOutsideCommon: true,
    });
    assert.equal(isCommon4CatalogEvent(warm, c15), false);
  });

  it("C. event outside COMMON_4 is NOT counted", () => {
    const outside = ev({
      kind: "displacement",
      tf: "15m",
      openT: commonFirst - STEP,
      closeT: commonFirst,
      warmupOutsideCommon: false,
    });
    assert.equal(isCommon4CatalogEvent(outside, c15), false);
    const btcDetected = detectEvents(bars.filter((b) => b.assetId === "BTCUSD"));
    const beforeWindow = btcDetected.filter((e) => e.openT < commonFirst);
    assert.ok(beforeWindow.length > 0);
    const countedKinds = new Set(report.eventCounts.map((r) => r.kind));
    for (const e of beforeWindow) {
      const tagged = { ...e, warmupOutsideCommon: eventUsedBarsBeforeCommon(bars.filter((b) => b.assetId === "BTCUSD"), e, c15) };
      assert.equal(isCommon4CatalogEvent(tagged, c15), false);
      void countedKinds;
    }
  });

  it("D. ASSET_DEEP does not enter n nor COMMON_4 counts", () => {
    assert.equal(clipped.some((b) => b.t < commonFirst), false);
    assert.equal(clipped.some((b) => b.assetId === "BTCUSD" && b.t < commonFirst), false);
    assert.equal(c15.n, clipped.length);
    const deep = clipBarsToAssetDeep(bars, c15);
    assert.ok(deep.some((b) => b.assetId === "BTCUSD"));
    assert.equal(deep.length + clipped.length, bars.filter((b) => b.tf === "15m").length);
    assert.equal(report.eventCounts.reduce((s, row) => s + (row.byAsset.BTCUSD ?? 0), 0), 0);
  });

  it("E. causal detector is unchanged (no COMMON_4 in detectEvents)", () => {
    const src = readFileSync(new URL("./shadow-discovery-events.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /COMMON_4|warmupOutsideCommon\s*=\s*true|clipBarsToCommon4/);
    const prefix = rampAsset("US100", commonFirst, 30);
    const a = detectEvents(prefix);
    const b = detectEvents([...prefix, ...rampAsset("US100", commonFirst + 30 * STEP, 5)]);
    const idsA = a.map((e) => e.id);
    const idsB = b.filter((e) => e.openT <= prefix[prefix.length - 1]!.t).map((e) => e.id);
    assert.deepEqual(idsB, idsA);
  });

  it("K. published n equals clipped COMMON_4 bar count", () => {
    const attached = attachCommon4BarCount(c15, bars);
    assert.equal(attached.n, clipped.length);
    assert.equal(c15.n, clipped.length);
    assert.notEqual(c15.n, bars.length);
    const btcAll = bars.filter((b) => b.assetId === "BTCUSD").length;
    assert.notEqual(c15.n, btcAll);
    const minPerAsset = Math.min(
      ...DISCOVERY_ASSETS.map((id) => bars.filter((b) => b.assetId === id).length),
    );
    assert.notEqual(c15.n, minPerAsset);
  });
});

describe("mtfMatrix recent vs historical", () => {
  it("J. 1m/5m recent tape is not historical MTF", () => {
    const coverage = [
      { tf: "15m" as const, bars: 200 },
      { tf: "5m" as const, bars: 200 },
      { tf: "1m" as const, bars: 200 },
      { tf: "4h" as const, bars: 80 },
    ];
    const commons = [win(0, 80_000, "15m"), win(0, 80_000, "4h")];
    const recent = mtfPairAvailability("15m", "5m", coverage, commons);
    assert.equal(recent.historical, false);
    assert.equal(recent.recentOnly, true);
    const hist = mtfPairAvailability("4h", "15m", coverage, commons);
    assert.equal(hist.historical, true);
    assert.equal(hist.recentOnly, false);
  });
});

describe("archive TF order", () => {
  it("walks 15m → 30m → 1h → 4h", () => {
    assert.deepEqual([...DISCOVERY_ARCHIVE_TFS], ["15m", "30m", "1h", "4h"]);
  });
});
