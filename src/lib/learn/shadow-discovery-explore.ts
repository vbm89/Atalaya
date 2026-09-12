import type { AssetId } from "../trading/types";
import { K1_REGISTERED_AT } from "./shadow-k1-failed-breakout";
import { closedBarsThrough, htfClosedAtDecision } from "./shadow-discovery-clock";
import {
  coverageQuality,
  detectGaps,
  groupByAssetTf,
  sanitizeBars,
  spanDays,
} from "./shadow-discovery-bars";
import { detectEvents } from "./shadow-discovery-events";
import { detectSequences } from "./shadow-discovery-sequences";
import { outcomeAfterEvent } from "./shadow-discovery-outcome";
import {
  DISCOVERY_ASSETS,
  DISCOVERY_TFS,
  type DiscoveryBar,
  type DiscoveryCoverageRow,
  type DiscoveryEvent,
  type DiscoveryEventKind,
  type DiscoveryJournalEntry,
  type DiscoverySequence,
  type DiscoveryTf,
} from "./shadow-discovery-types";

export interface DiscoveryEventCount {
  kind: DiscoveryEventKind;
  n: number;
  byAsset: Partial<Record<AssetId, number>>;
  byTf: Partial<Record<DiscoveryTf, number>>;
}

export interface DiscoveryExploreReport {
  generatedAt: string;
  codeVersion: string;
  k1TestExcluded: true;
  k1RegisteredAt: number;
  coverage: DiscoveryCoverageRow[];
  eventCounts: DiscoveryEventCount[];
  sequenceCounts: { family: string; n: number }[];
  mtfAvailable: { from: DiscoveryTf; to: DiscoveryTf; ok: boolean; reason: string }[];
  journal: DiscoveryJournalEntry;
  /** Outcomes are optional and NEVER used to rank. */
  outcomesSampled: number;
  rankingByExpectancy: false;
}

function emptyCoverage(assetId: AssetId, tf: DiscoveryTf): DiscoveryCoverageRow {
  const q = coverageQuality({ bars: 0, days: null, tf });
  return {
    assetId, tf, source: null, firstT: null, lastT: null, bars: 0, days: null,
    gaps: 0, missingBars: 0, quality: q.quality, use: q.use,
    servesExplore: q.explore, servesTrainCandidate: q.trainCandidate,
  };
}

export function buildCoverage(bars: readonly DiscoveryBar[]): DiscoveryCoverageRow[] {
  const clean = sanitizeBars(bars);
  const grouped = groupByAssetTf(clean);
  const rows: DiscoveryCoverageRow[] = [];
  for (const assetId of DISCOVERY_ASSETS) {
    for (const tf of DISCOVERY_TFS) {
      const series = grouped.get(`${assetId}|${tf}`) ?? [];
      if (!series.length) {
        rows.push(emptyCoverage(assetId, tf));
        continue;
      }
      const gaps = detectGaps(series, tf);
      const firstT = series[0]!.t;
      const lastT = series[series.length - 1]!.t;
      const days = spanDays(firstT, lastT);
      const q = coverageQuality({ bars: series.length, days, tf });
      const sources = [...new Set(series.map((b) => b.source))];
      rows.push({
        assetId, tf, source: sources.join(","), firstT, lastT,
        bars: series.length, days, gaps: gaps.length,
        missingBars: gaps.reduce((s, g) => s + g.missing, 0),
        quality: q.quality, use: q.use,
        servesExplore: q.explore, servesTrainCandidate: q.trainCandidate,
      });
    }
  }
  return rows;
}

function mtfMatrix(coverage: DiscoveryCoverageRow[]): DiscoveryExploreReport["mtfAvailable"] {
  const pairs: [DiscoveryTf, DiscoveryTf][] = [
    ["4h", "1h"], ["1h", "30m"], ["30m", "15m"], ["4h", "15m"], ["15m", "5m"], ["5m", "1m"],
  ];
  return pairs.map(([from, to]) => {
    const a = coverage.filter((r) => r.tf === from && r.bars > 0);
    const b = coverage.filter((r) => r.tf === to && r.bars > 0);
    if (!a.length || !b.length) {
      return { from, to, ok: false, reason: `sin cinta nativa ${from}→${to}` };
    }
    const recent = to === "1m" || to === "5m" || from === "1m" || from === "5m";
    if (recent) return { from, to, ok: true, reason: "solo reciente (histórico corto)" };
    return { from, to, ok: true, reason: "datos nativos en ambos TF" };
  });
}

/**
 * EXPLORE: descriptive counts. Never sorts by R / expectancy.
 * 15M events with closeT >= K1_REGISTERED_AT are excluded so K1 TEST cannot leak into discovery.
 */
export function exploreDiscovery(
  bars: readonly DiscoveryBar[],
  nowSec: number,
  codeVersion = "shadow-discovery-1",
): DiscoveryExploreReport {
  const closed = closedBarsThrough(sanitizeBars(bars), nowSec);
  const coverage = buildCoverage(closed);
  const grouped = groupByAssetTf(closed);
  const events: DiscoveryEvent[] = [];
  for (const series of grouped.values()) {
    const detected = detectEvents(series);
    for (const e of detected) {
      if (e.tf === "15m" && e.closeT >= K1_REGISTERED_AT) continue;
      events.push(e);
    }
  }
  events.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const kinds = [...new Set(events.map((e) => e.kind))].sort();
  const eventCounts: DiscoveryEventCount[] = kinds.map((kind) => {
    const subset = events.filter((e) => e.kind === kind);
    const byAsset: Partial<Record<AssetId, number>> = {};
    const byTf: Partial<Record<DiscoveryTf, number>> = {};
    for (const e of subset) {
      byAsset[e.assetId] = (byAsset[e.assetId] ?? 0) + 1;
      byTf[e.tf] = (byTf[e.tf] ?? 0) + 1;
    }
    return { kind, n: subset.length, byAsset, byTf };
  });

  const sequences: DiscoverySequence[] = detectSequences(events);
  const seqNames = [...new Set(sequences.map((s) => s.family))].sort();
  const sequenceCounts = seqNames.map((family) => ({
    family,
    n: sequences.filter((s) => s.family === family).length,
  }));

  let outcomesSampled = 0;
  for (const e of events.slice(0, 50)) {
    const series = grouped.get(`${e.assetId}|${e.tf}`) ?? [];
    outcomeAfterEvent(e, series);
    outcomesSampled += 1;
  }

  const journal: DiscoveryJournalEntry = {
    exploredAt: new Date(nowSec * 1000).toISOString(),
    universe: "independent_tape_excluding_k1_test",
    primitives: ["swing", "range", "sweep", "reclaim", "displacement", "bos", "fvg", "atr", "volume_ratio"],
    families: sequenceCounts.map((s) => s.family),
    variants: eventCounts.map((e) => e.kind),
    discarded: [],
    discardReason: null,
    candidates: [],
    outcomeConsulted: false,
    codeVersion,
    notes: "EXPLORE descriptivo. Sin ranking por R. TEST de K1 excluido. k no incrementa.",
  };

  return {
    generatedAt: journal.exploredAt,
    codeVersion,
    k1TestExcluded: true,
    k1RegisteredAt: K1_REGISTERED_AT,
    coverage,
    eventCounts,
    sequenceCounts,
    mtfAvailable: mtfMatrix(coverage),
    journal,
    outcomesSampled,
    rankingByExpectancy: false,
  };
}

export function htfContextBars(
  htf: readonly DiscoveryBar[],
  decisionClose: number,
): DiscoveryBar[] {
  return htfClosedAtDecision(htf, decisionClose);
}
