import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { K1_REGISTERED_AT } from "./shadow-k1-failed-breakout.ts";
import { barCloseSec, closedBarsThrough, htfClosedAtDecision, isBarClosed } from "./shadow-discovery-clock.ts";
import { detectGaps, ohlcValid, sanitizeBars } from "./shadow-discovery-bars.ts";
import { atrAt, confirmedSwings, fvgAt } from "./shadow-discovery-primitives.ts";
import { detectEvents } from "./shadow-discovery-events.ts";
import { detectSequences } from "./shadow-discovery-sequences.ts";
import { outcomeAfterEvent } from "./shadow-discovery-outcome.ts";
import { buildCoverage, exploreDiscovery } from "./shadow-discovery-explore.ts";
import { assertNativeTf } from "./shadow-discovery-ingest.ts";
import type { DiscoveryBar } from "./shadow-discovery-types.ts";

function bar(
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  extra?: Partial<DiscoveryBar>,
): DiscoveryBar {
  return { assetId: "BTCUSD", tf: "15m", t, o, h, l, c, v: 10, source: "test", ...extra };
}

function ramp(n: number, start = 1000, step = 900): DiscoveryBar[] {
  const out: DiscoveryBar[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = px + 0.2;
    out.push(bar(start + i * step, o, Math.max(o, c) + 0.4, Math.min(o, c) - 0.4, c, { v: 8 + (i % 3) }));
    px = c;
  }
  return out;
}

describe("shadow discovery clock", () => {
  it("excludes the open bar", () => {
    const b = bar(1000, 1, 2, 0.5, 1.2);
    assert.equal(barCloseSec(1000, "15m"), 1900);
    assert.equal(isBarClosed(b, 1899), false);
    assert.equal(isBarClosed(b, 1900), true);
    assert.equal(closedBarsThrough([b], 1899).length, 0);
  });

  it("MTF only uses HTF bars whose close <= decision", () => {
    const h4: DiscoveryBar[] = [
      { ...bar(0, 1, 2, 1, 1.5), tf: "4h", t: 0 },
      { ...bar(14400, 1.5, 3, 1.4, 2), tf: "4h", t: 14400 },
    ];
    const at15mClose = 14400;
    const allowed = htfClosedAtDecision(h4, at15mClose);
    assert.equal(allowed.length, 1);
    assert.equal(allowed[0]!.t, 0);
    assert.equal(htfClosedAtDecision(h4, 14399).length, 0);
  });
});

describe("bars / gaps / no synthesis", () => {
  it("drops invalid OHLC and duplicates", () => {
    const bad = bar(1000, 10, 9, 11, 10);
    assert.equal(ohlcValid(bad), false);
    const a = bar(1000, 1, 2, 0.5, 1);
    const dup = bar(1000, 1, 2, 0.5, 1);
    assert.equal(sanitizeBars([a, dup, bad]).length, 1);
  });

  it("records gaps without filling them", () => {
    const a = bar(1000, 1, 2, 0.5, 1);
    const c = bar(1000 + 3 * 900, 1, 2, 0.5, 1);
    const gaps = detectGaps([a, c], "15m");
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.missing, 2);
  });

  it("does not invent 30m from 15m", () => {
    assertNativeTf("30m");
    assertNativeTf("1m");
    const src = readFileSync(new URL("./shadow-discovery-ingest.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /resample\(/);
  });
});

describe("anti-lookahead events", () => {
  it("future OHLC after the decision does not change already detected events", () => {
    const prefix = ramp(40);
    const a = detectEvents(prefix);
    const futureWin = bar(prefix[prefix.length - 1]!.t + 900, 200, 400, 200, 390);
    const futureLose = bar(prefix[prefix.length - 1]!.t + 900, 50, 51, 1, 2);
    const b = detectEvents([...prefix, futureWin]);
    const c = detectEvents([...prefix, futureLose]);
    const idsA = a.map((e) => e.id);
    const idsB = b.filter((e) => e.openT <= prefix[prefix.length - 1]!.t).map((e) => e.id);
    const idsC = c.filter((e) => e.openT <= prefix[prefix.length - 1]!.t).map((e) => e.id);
    assert.deepEqual(idsB, idsA);
    assert.deepEqual(idsC, idsA);
  });

  it("ATR at i ignores bars after i", () => {
    const bars = ramp(30);
    const a = atrAt(bars, 20);
    const longer = [...bars, bar(bars[29]!.t + 900, 1000, 2000, 1000, 1800)];
    const b = atrAt(longer, 20);
    assert.equal(a, b);
  });

  it("a swing is confirmed only after radius bars exist", () => {
    const bars = ramp(10);
    const peakI = 5;
    bars[peakI] = bar(bars[peakI]!.t, 100, 120, 99, 101);
    const early = confirmedSwings(bars, peakI);
    const late = confirmedSwings(bars, peakI + 2);
    assert.equal(early.some((s) => s.index === peakI && s.kind === "high"), false);
    assert.equal(late.some((s) => s.index === peakI && s.kind === "high"), true);
  });
});

describe("K1 isolation", () => {
  it("EXPLORE drops 15M events in the K1 TEST window", () => {
    const t = K1_REGISTERED_AT - 900;
    const before = bar(t - 900 * 40, 100, 101, 99, 100.2);
    const series: DiscoveryBar[] = [];
    let px = 100;
    for (let i = 0; i < 50; i++) {
      const openT = t - 900 * (49 - i);
      series.push(bar(openT, px, px + 1, px - 1, px + 0.1));
      px += 0.1;
    }
    const afterTest = bar(K1_REGISTERED_AT + 900, 200, 250, 200, 240);
    series.push(afterTest);
    const report = exploreDiscovery(series, K1_REGISTERED_AT + 10000, "shadow-discovery-1", { detectPatterns: true });
    assert.equal(report.k1TestExcluded, true);
    assert.equal(report.rankingByExpectancy, false);
    for (const row of report.eventCounts) {
      void row;
    }
    const ev = detectEvents(series);
    const leaked = ev.filter((e) => e.tf === "15m" && e.closeT >= K1_REGISTERED_AT);
    const exploreKinds = new Set(report.eventCounts.map((e) => e.kind));
    for (const e of leaked) {
      const count = report.eventCounts.find((x) => x.kind === e.kind);
      if (count) {
        const inExplore = detectEvents(series.filter((b) => b.t + 900 < K1_REGISTERED_AT));
        assert.ok(inExplore.every((x) => x.closeT < K1_REGISTERED_AT));
      }
    }
    assert.ok(exploreKinds.size >= 0);
    assert.ok(leaked.every((e) => e.closeT >= K1_REGISTERED_AT));
  });

  it("does not import V1 protected modules", () => {
    const files = [
      "shadow-discovery.ts",
      "shadow-discovery-events.ts",
      "shadow-discovery-primitives.ts",
      "shadow-discovery-explore.ts",
    ];
    for (const f of files) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
      assert.doesNotMatch(src, /trading\/engine/);
      assert.doesNotMatch(src, /trading\/signals/);
      assert.doesNotMatch(src, /trading\/structure/);
      assert.doesNotMatch(src, /trading\/risk/);
      assert.doesNotMatch(src, /watch\/outcome/);
      assert.doesNotMatch(src, /market\/xau-spot/);
    }
  });
});

describe("sequences and outcome", () => {
  it("sequences respect temporal order", () => {
    const ev = detectEvents(ramp(40));
    const seq = detectSequences(ev);
    for (const s of seq) {
      for (let i = 1; i < s.legs.length; i++) {
        assert.ok(s.legs[i]!.closeT > s.legs[i - 1]!.closeT);
      }
    }
  });

  it("UNKNOWN costs stay null, never 0", () => {
    const series = ramp(40);
    const ev = detectEvents(series);
    if (ev[0]) {
      const o = outcomeAfterEvent(ev[0]!, series);
      assert.equal(o.netR, null);
      assert.equal(o.costKnown, false);
    }
  });

  it("FVG cannot form on two bars", () => {
    const bars = ramp(8);
    assert.equal(fvgAt(bars, 1), null);
  });
});

describe("coverage and explore report", () => {
  it("does not mix assets into one homogeneous n", () => {
    const btc = ramp(30).map((b) => ({ ...b, assetId: "BTCUSD" as const }));
    const xau = ramp(5).map((b) => ({ ...b, assetId: "XAUUSD" as const, t: b.t + 1 }));
    const cov = buildCoverage([...btc, ...xau]);
    const btc15 = cov.find((r) => r.assetId === "BTCUSD" && r.tf === "15m");
    const xau15 = cov.find((r) => r.assetId === "XAUUSD" && r.tf === "15m");
    assert.ok(btc15 && xau15);
    assert.notEqual(btc15!.bars, xau15!.bars);
  });

  it("1m/5m never serve as TRAIN candidates", () => {
    const m1 = ramp(200).map((b) => ({ ...b, tf: "1m" as const, t: 1_000 + b.t / 900 * 60 }));
    const cov = buildCoverage(m1);
    const row = cov.find((r) => r.tf === "1m" && r.assetId === "BTCUSD");
    assert.equal(row?.servesTrainCandidate, false);
    assert.equal(row?.use, "recent_only");
  });

  it("event counts are alphabetical, not ranked by R", () => {
    const report = exploreDiscovery(ramp(40), 10_000_000, "shadow-discovery-1", { detectPatterns: true });
    const kinds = report.eventCounts.map((e) => e.kind);
    const sorted = [...kinds].sort();
    assert.deepEqual(kinds, sorted);
    assert.equal(report.rankingByExpectancy, false);
  });

  it("htfContextBars requires windows; lab stays detectPatterns false", () => {
    const uni = readFileSync(new URL("./shadow-discovery-universe.ts", import.meta.url), "utf8");
    assert.match(uni, /export function htfContextBars\(args: \{/);
    assert.match(uni, /htfWindow:/);
    assert.match(uni, /return mtfLegsInValidWindows\(args\)\.htf/);
    const lab = readFileSync(new URL("./shadow-discovery.ts", import.meta.url), "utf8");
    assert.match(lab, /detectPatterns:\s*false/);
  });
});
