import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { analyzeShadowReplay } from "./shadow-analysis.ts";
import type { ShadowCaseInput } from "./shadow-features.ts";
import {
  SHADOW_PHASE_B_VARIANTS,
  SHADOW_REPLAY_PLAN,
  SHADOW_VARIANTS,
  ZONE_SWEEP_DEPTH,
  buildShadowReplayReport,
  isExtraVsV1,
  shadowCandidateForTest,
  shadowOutcomeForTest,
  v1EntryByEpisode,
  v1EntrySlot,
  type ShadowEpisode,
  type ShadowTapeBar,
} from "./shadow-replay.ts";

const here = dirname(fileURLToPath(import.meta.url));

function baseCase(id = "XAUUSD-1000-b"): ShadowCaseInput {
  return {
    episodeId: id,
    assetId: "XAUUSD",
    direction: "sell",
    kind: "continuation",
    openedAtMs: 1_000_000,
    openedSlot: 1000,
    openedState: "map",
    currentState: "wait",
    closedAtMs: 8_000_000,
    bias4hLabel: "BAJISTA LOCAL",
    qualityPhase: "preliminar",
    volumeRatio15: null,
    volumeAvailable15: null,
    volumeRatio4h: null,
    volumeAvailable4h: null,
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

function bar(
  episodeId: string,
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number | null = 2,
): ShadowTapeBar {
  return { episodeId, tf: "15m", t, o, h, l, c, v, role: "forward" };
}

function volumePrefix(id: string): ShadowTapeBar[] {
  return [
    bar(id, 100, 90, 91, 89, 90),
    bar(id, 1000, 90, 91, 89, 90),
    bar(id, 1900, 90, 91, 89, 90),
  ];
}

function ep(id: string, bars: ShadowTapeBar[], events: ShadowEpisode["events"] = []): ShadowEpisode {
  return { case: { ...baseCase(id), episodeId: id }, events, bars, observedOutcome: null };
}

test("Phase B variants are predefined and do not replace Phase A", () => {
  assert.equal(SHADOW_PHASE_B_VARIANTS.length, 6);
  assert.ok(SHADOW_VARIANTS.includes("BASELINE_V1"));
  assert.ok(SHADOW_VARIANTS.includes("ZONE_SWEEP_RECLAIM_MIN"));
  assert.ok(SHADOW_VARIANTS.includes("FVG_RETEST_STRICT"));
  assert.equal(ZONE_SWEEP_DEPTH.ZONE_SWEEP_RECLAIM_MIN, 0);
  assert.equal(ZONE_SWEEP_DEPTH.ZONE_SWEEP_RECLAIM_MID, 0.25);
  assert.equal(ZONE_SWEEP_DEPTH.ZONE_SWEEP_RECLAIM_WIDE, 0.5);
  assert.equal(SHADOW_REPLAY_PLAN.modifiesV1, false);
  assert.equal(SHADOW_REPLAY_PLAN.liveSignal, false);
});

test("sweep/reclaim: wick through zone and close inside is a candidate at that close", () => {
  const id = "XAUUSD-sweep";
  const sweep = bar(id, 2800, 108, 111.5, 105, 107);
  const e = ep(id, [...volumePrefix(id), sweep, bar(id, 3700, 107, 108, 79, 80)]);
  const min = shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_MIN");
  assert.equal(min?.trigger, "sweep_reclaim");
  assert.equal(min?.decisionBarTime, 2800);
  assert.equal(min?.decisionSlot, 3700);
  assert.equal(shadowCandidateForTest(e, "BASELINE_V1"), null, "MAP without V1 ENTRY is not baseline");
});

test("sweep/reclaim: close outside the zone is not a reclaim", () => {
  const id = "XAUUSD-no-reclaim";
  const sweep = bar(id, 2800, 108, 112, 105, 99);
  const e = ep(id, [...volumePrefix(id), sweep, bar(id, 3700, 99, 100, 79, 80)]);
  assert.equal(shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_MIN"), null);
});

test("sweep/reclaim depth variants are frozen: mid/wide require a deeper wick than min", () => {
  const id = "XAUUSD-depth";
  const shallow = bar(id, 2800, 108, 111.2, 105, 107);
  const e = ep(id, [...volumePrefix(id), shallow, bar(id, 3700, 107, 108, 102, 103)]);
  assert.ok(shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_MIN"));
  assert.equal(shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_MID"), null);
  assert.equal(shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_WIDE"), null);
  const deep = bar(id, 2800, 108, 116, 105, 107);
  const e2 = ep(id, [...volumePrefix(id), deep, bar(id, 3700, 107, 108, 102, 103)]);
  assert.ok(shadowCandidateForTest(e2, "ZONE_SWEEP_RECLAIM_WIDE"));
});

test("sweep/reclaim respects V1 direction: a buy-side sweep of lows is not a sell candidate", () => {
  const id = "XAUUSD-wrong-dir";
  const lows = bar(id, 2800, 105, 109, 98, 107);
  const e = ep(id, [...volumePrefix(id), lows, bar(id, 3700, 107, 108, 102, 103)]);
  assert.equal(shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_MIN"), null);
});

test("sweep/reclaim: wick through invalidation is not a candidate", () => {
  const id = "XAUUSD-inv";
  const sweep = bar(id, 2800, 108, 121, 105, 107);
  const e = ep(id, [...volumePrefix(id), sweep, bar(id, 3700, 107, 108, 102, 103)]);
  assert.equal(shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_MIN"), null);
});

test("sweep/reclaim outcome ignores the decision bar and uses later wicks only", () => {
  const id = "XAUUSD-sweep-outcome";
  const sweep = bar(id, 2800, 108, 111.5, 79, 107);
  const later = bar(id, 3700, 107, 116, 102, 108);
  const e = ep(id, [...volumePrefix(id), sweep, later]);
  const cand = shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_MIN");
  assert.ok(cand);
  const result = shadowOutcomeForTest(cand, e);
  assert.equal(result.outcome, "sl");
  assert.equal(result.firstTouchAtSec, 3700);
  assert.ok((result.firstTouchAtSec ?? 0) >= cand.decisionSlot);
  assert.equal(result.rrAtOutcome, -1);
  assert.ok((result.mae ?? 0) > 0);
});

test("FVG: detection, retest and decision are separate closed 15M bars", () => {
  const id = "XAUUSD-fvg";
  const a = bar(id, 1000, 114, 118, 112, 114);
  const mid = bar(id, 1900, 114, 114, 100, 102);
  const c = bar(id, 2800, 102, 101, 95, 97);
  const retest = bar(id, 3700, 104, 108, 100, 104);
  const later = bar(id, 4600, 104, 105, 79, 80);
  const e = ep(id, [bar(id, 100, 90, 91, 89, 90), a, mid, c, retest, later]);
  const full = shadowCandidateForTest(e, "FVG_RETEST_FULL");
  assert.equal(full?.trigger, "fvg_retest");
  assert.equal(full?.decisionBarTime, 3700);
  assert.equal(full?.decisionSlot, 4600);
  assert.notEqual(full?.decisionBarTime, 2800);
});

test("FVG cannot retest on the formation candle", () => {
  const id = "XAUUSD-fvg-same";
  const a = bar(id, 1000, 114, 118, 112, 114);
  const mid = bar(id, 1900, 114, 114, 100, 102);
  const c = bar(id, 2800, 102, 108, 95, 104);
  const e = ep(id, [bar(id, 100, 90, 91, 89, 90), a, mid, c, bar(id, 3700, 104, 105, 102, 103)]);
  assert.equal(shadowCandidateForTest(e, "FVG_RETEST_FULL"), null);
});

test("FVG STRICT requires close inside the gap; FULL allows a wick tap", () => {
  const id = "XAUUSD-fvg-strict";
  const a = bar(id, 1000, 114, 118, 112, 114);
  const mid = bar(id, 1900, 114, 114, 100, 102);
  const c = bar(id, 2800, 102, 101, 95, 97);
  const tap = bar(id, 3700, 99, 108, 98, 99);
  const e = ep(id, [bar(id, 100, 90, 91, 89, 90), a, mid, c, tap, bar(id, 4600, 99, 100, 79, 80)]);
  assert.ok(shadowCandidateForTest(e, "FVG_RETEST_FULL"));
  assert.equal(shadowCandidateForTest(e, "FVG_RETEST_STRICT"), null);
});

test("FVG PARTIAL fires on a body gap with wick overlap; FULL does not", () => {
  const id = "XAUUSD-fvg-partial";
  const a = bar(id, 1000, 110, 111, 108, 109);
  const mid = bar(id, 1900, 109, 109, 104, 105);
  const c = bar(id, 2800, 105, 109, 100, 103);
  const retest = bar(id, 3700, 106, 108, 105, 107);
  const e = ep(id, [bar(id, 100, 90, 91, 89, 90), a, mid, c, retest, bar(id, 4600, 107, 108, 102, 103)]);
  assert.equal(shadowCandidateForTest(e, "FVG_RETEST_FULL"), null);
  assert.ok(shadowCandidateForTest(e, "FVG_RETEST_PARTIAL"));
});

test("FVG of the opposite direction is ignored", () => {
  const id = "XAUUSD-fvg-opp";
  const a = bar(id, 1000, 96, 98, 94, 97);
  const mid = bar(id, 1900, 97, 108, 97, 107);
  const c = bar(id, 2800, 107, 112, 106, 110);
  const retest = bar(id, 3700, 108, 109, 105, 107);
  const e = ep(id, [bar(id, 100, 90, 91, 89, 90), a, mid, c, retest]);
  assert.equal(shadowCandidateForTest(e, "FVG_RETEST_FULL"), null);
});

test("a future 15M bar after the decision cannot create the candidate or change the FVG", () => {
  const id = "XAUUSD-fvg-future";
  const a = bar(id, 1000, 114, 118, 112, 114);
  const mid = bar(id, 1900, 114, 114, 100, 102);
  const c = bar(id, 2800, 102, 101, 95, 97);
  const retest = bar(id, 3700, 104, 108, 100, 104);
  const e1 = ep(id, [bar(id, 100, 90, 91, 89, 90), a, mid, c, retest, bar(id, 4600, 104, 105, 102, 103)]);
  const future = bar(id, 5500, 90, 140, 70, 80);
  const e2 = { ...e1, bars: [...e1.bars, future] };
  const a1 = shadowCandidateForTest(e1, "FVG_RETEST_FULL");
  const a2 = shadowCandidateForTest(e2, "FVG_RETEST_FULL");
  assert.equal(a1?.decisionSlot, a2?.decisionSlot);
  assert.equal(a1?.decisionBarTime, a2?.decisionBarTime);
});

test("FVG outcome excludes the retest/decision bar", () => {
  const id = "XAUUSD-fvg-out";
  const a = bar(id, 1000, 114, 118, 112, 114);
  const mid = bar(id, 1900, 114, 114, 100, 102);
  const c = bar(id, 2800, 102, 101, 95, 97);
  const retest = bar(id, 3700, 104, 116, 79, 104);
  const later = bar(id, 4600, 104, 105, 79, 80);
  const e = ep(id, [bar(id, 100, 90, 91, 89, 90), a, mid, c, retest, later]);
  const cand = shadowCandidateForTest(e, "FVG_RETEST_FULL");
  assert.ok(cand);
  const result = shadowOutcomeForTest(cand, e);
  assert.equal(result.outcome, "tp1");
  assert.equal(result.firstTouchAtSec, 4600);
  assert.ok((result.firstTouchAtSec ?? 0) >= cand.decisionSlot);
});

test("EXTRA vs OVERLAP: Phase B on a V1 ENTRY episode is overlap, never extra", () => {
  const id = "XAUUSD-b-overlap";
  const sweep = bar(id, 2800, 108, 111.5, 105, 107);
  const e = ep(id, [...volumePrefix(id), sweep, bar(id, 3700, 107, 108, 102, 103)], [
    { episodeId: id, fromState: "pending", toState: "entry", atMs: 4_600_000, slot: 4600 },
  ]);
  e.case = { ...e.case, openedState: "pending" };
  assert.equal(v1EntrySlot(e), 4600);
  assert.equal(isExtraVsV1(id, v1EntryByEpisode([e])), false);
  const report = buildShadowReplayReport([e]);
  const row = report.variants.find((v) => v.variant === "ZONE_SWEEP_RECLAIM_MIN");
  assert.ok(row);
  assert.equal(row.extra.candidates, 0);
  assert.equal(row.overlap.candidates, 1);
  assert.equal(row.overlap.candidates + row.extra.candidates, row.total.candidates);
  const baseline = report.variants.find((v) => v.variant === "BASELINE_V1");
  assert.equal(baseline?.extra.candidates, 0);
});

test("Phase B without V1 ENTRY is extra; MAP SL stored outcome is not a V1 trade", () => {
  const extraId = "WTI-b-extra";
  const sweep = bar(extraId, 2800, 108, 111.5, 105, 107);
  const extraEp = ep(extraId, [...volumePrefix(extraId), sweep, bar(extraId, 3700, 107, 116, 102, 108)]);
  extraEp.case = { ...extraEp.case, assetId: "WTI", openedState: "map" };
  extraEp.observedOutcome = "sl";
  const report = buildShadowReplayReport([extraEp]);
  const sweepRow = report.variants.find((v) => v.variant === "ZONE_SWEEP_RECLAIM_MIN");
  const baseline = report.variants.find((v) => v.variant === "BASELINE_V1");
  assert.equal(baseline?.candidates, 0);
  assert.equal(sweepRow?.extra.candidates, 1);
  assert.equal(sweepRow?.overlap.candidates, 0);
  assert.equal(sweepRow?.extra.sl, 1);
});

test("high-impact freeze blocks Phase B; it does not invent an entry", () => {
  const id = "XAUUSD-news";
  const sweep = bar(id, 2800, 108, 111.5, 105, 107);
  const e = ep(id, [...volumePrefix(id), sweep, bar(id, 3700, 107, 108, 102, 103)]);
  e.case = { ...e.case, highImpact: true };
  assert.equal(shadowCandidateForTest(e, "ZONE_SWEEP_RECLAIM_MIN"), null);
  assert.equal(shadowCandidateForTest(e, "FVG_RETEST_FULL"), null);
});

test("small Phase B TEST samples are INSUFFICIENT, not evidence", () => {
  const id = "XAUUSD-small-b";
  const sweep = bar(id, 2800, 108, 111.5, 105, 107);
  const e = ep(id, [...volumePrefix(id), sweep, bar(id, 3700, 107, 116, 102, 108)]);
  const analysis = analyzeShadowReplay([e]);
  const b = analysis.comparisons.filter((c) =>
    (SHADOW_PHASE_B_VARIANTS as readonly string[]).includes(c.variant),
  );
  assert.ok(b.length >= 1);
  assert.ok(b.every((c) => c.recommendation === "INSUFFICIENT"));
  assert.ok(b.every((c) => c.extraTestN < 30));
  assert.ok(b.every((c) => c.evidenceLabel === "INSUFFICIENT"));
});

test("Shadow Phase B modules do not import V1 engines or write SQL", async () => {
  const files = [
    "shadow-replay.ts",
    "shadow-analysis.ts",
    "shadow-db.ts",
    "shadow-features.ts",
    "shadow-replay-http.ts",
  ];
  const banned = /from ["'][^"']*(engine|signals|structure|risk|xau-spot)["']/;
  const outcomeImport = /from ["'][^"']*watch\/outcome["']/;
  for (const name of files) {
    const src = readFileSync(join(here, name), "utf8");
    assert.equal(banned.test(src), false, name);
    assert.equal(outcomeImport.test(src), false, name);
  }
  const db = readFileSync(join(here, "shadow-db.ts"), "utf8");
  assert.match(db, /select \* from signal_episodes/i);
  assert.doesNotMatch(db, /\binsert\b/i);
  assert.doesNotMatch(db, /\bupdate\b/i);
  assert.doesNotMatch(db, /\bdelete\b/i);
  const http = readFileSync(join(here, "shadow-replay-http.ts"), "utf8");
  assert.match(http, /BEGIN READ ONLY/);
  assert.match(http, /ROLLBACK/);
  const tick = readFileSync(join(here, "../watch/tick.ts"), "utf8");
  assert.doesNotMatch(tick, /learn\/shadow/);
  const { applyProposalToEngine, applyProposalToSignals } = await import("./proposals.ts");
  assert.throws(() => applyProposalToEngine({} as never), /P5 proposal/);
  assert.throws(() => applyProposalToSignals({} as never), /P5 proposal/);
});
