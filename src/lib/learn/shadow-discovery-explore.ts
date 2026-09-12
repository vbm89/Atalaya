import type { AssetId } from "../trading/types";
import { K1_REGISTERED_AT } from "./shadow-k1-failed-breakout";
import { closedBarsThrough } from "./shadow-discovery-clock";
import {
  coverageQuality,
  detectGaps,
  discoveryStatus,
  groupByAssetTf,
  isoUtc,
  marketDaysUtc,
  sanitizeBars,
  spanDays,
} from "./shadow-discovery-bars";
import { detectEvents } from "./shadow-discovery-events";
import { detectSequences, detectHtfContextSequences } from "./shadow-discovery-sequences";
import {
  assetDeepSlices,
  attachCommon4BarCount,
  common4Window,
  eventUsedBarsBeforeCommon,
  isCommon4CatalogEvent,
  MTF_ARCHIVE_PAIRS,
  mtfPairAvailability,
  spansFromCoverage,
  type AssetDeepSlice,
  type Common4Window,
} from "./shadow-discovery-universe";
import {
  DISCOVERY_ARCHIVE_TFS,
  DISCOVERY_ASSETS,
  DISCOVERY_TFS,
  type DiscoveryBar,
  type DiscoveryCoverageRow,
  type DiscoveryEvent,
  type DiscoveryEventKind,
  type DiscoveryJournalEntry,
  type DiscoveryMtfAvailability,
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
  mtfAvailable: DiscoveryMtfAvailability[];
  journal: DiscoveryJournalEntry;
  /** Outcomes are never consulted in EXPLORE. Always 0. */
  outcomesSampled: 0;
  rankingByExpectancy: false;
  universes: {
    common4: Common4Window[];
    assetDeep: AssetDeepSlice[];
    inference: "INSUFFICIENT";
    exploreGrade: "EXPLORE";
  };
}

function emptyCoverage(assetId: AssetId, tf: DiscoveryTf): DiscoveryCoverageRow {
  const q = coverageQuality({ bars: 0, days: null, tf });
  return {
    assetId, tf, source: null, instrument: null, instrumentKind: null,
    firstT: null, lastT: null, firstIso: null, lastIso: null,
    bars: 0, days: null, marketDays: 0, gaps: 0, missingBars: 0,
    quality: q.quality, use: q.use, discoveryStatus: "D",
    servesExplore: q.explore, servesTrainCandidate: q.trainCandidate,
    exhausted: null,
  };
}

export function buildCoverage(
  bars: readonly DiscoveryBar[],
  cursors?: ReadonlyArray<{ assetId: AssetId; tf: DiscoveryTf; exhausted: boolean; instrument?: string | null; instrumentKind?: DiscoveryCoverageRow["instrumentKind"] }>,
): DiscoveryCoverageRow[] {
  const clean = sanitizeBars(bars);
  const grouped = groupByAssetTf(clean);
  const rows: DiscoveryCoverageRow[] = [];
  for (const assetId of DISCOVERY_ASSETS) {
    for (const tf of DISCOVERY_TFS) {
      const series = grouped.get(`${assetId}|${tf}`) ?? [];
      const cur = cursors?.find((c) => c.assetId === assetId && c.tf === tf);
      if (!series.length) {
        const empty = emptyCoverage(assetId, tf);
        empty.exhausted = cur?.exhausted ?? null;
        rows.push(empty);
        continue;
      }
      const gaps = detectGaps(series, tf);
      const firstT = series[0]!.t;
      const lastT = series[series.length - 1]!.t;
      const days = spanDays(firstT, lastT);
      const q = coverageQuality({ bars: series.length, days, tf });
      const sources = [...new Set(series.map((b) => b.source))];
      const instruments = [...new Set(series.map((b) => b.instrument).filter(Boolean))];
      const kinds = [...new Set(series.map((b) => b.instrumentKind).filter(Boolean))];
      rows.push({
        assetId, tf, source: sources.join(",") || null,
        instrument: (instruments[0] as string | undefined) ?? cur?.instrument ?? null,
        instrumentKind: (kinds[0] as DiscoveryCoverageRow["instrumentKind"]) ?? cur?.instrumentKind ?? null,
        firstT, lastT, firstIso: isoUtc(firstT), lastIso: isoUtc(lastT),
        bars: series.length, days, marketDays: marketDaysUtc(series),
        gaps: gaps.length, missingBars: gaps.reduce((s, g) => s + g.missing, 0),
        quality: q.quality, use: q.use,
        discoveryStatus: discoveryStatus({ bars: series.length, calendarDays: days, tf }),
        servesExplore: q.explore, servesTrainCandidate: q.trainCandidate,
        exhausted: cur?.exhausted ?? null,
      });
    }
  }
  return rows;
}

function mtfMatrix(
  coverage: DiscoveryCoverageRow[],
  commons: Common4Window[],
): DiscoveryMtfAvailability[] {
  const pairs: [DiscoveryTf, DiscoveryTf][] = [
    ...MTF_ARCHIVE_PAIRS,
    ["15m", "5m"],
    ["5m", "1m"],
  ];
  return pairs.map(([from, to]) => mtfPairAvailability(from, to, coverage, commons));
}

export interface DiscoveryCatalogCell {
  tf: DiscoveryTf;
  assetId: AssetId;
  kind: DiscoveryEventKind;
  n: number;
  buy: number;
  sell: number;
}

export interface DiscoverySequenceCell {
  family: string;
  assetId: AssetId;
  tf: DiscoveryTf;
  n: number;
}

export interface DiscoveryExploreCatalog {
  report: DiscoveryExploreReport;
  cells: DiscoveryCatalogCell[];
  sequenceCells: DiscoverySequenceCell[];
  sequences: Array<{
    family: string;
    assetId: AssetId;
    decisionCloseT: number;
    legs: Array<{
      kind: string;
      tf: DiscoveryTf;
      openT: number;
      closeT: number;
      direction: DiscoveryEvent["direction"];
    }>;
  }>;
  detectedN: number;
  k1TestExcludedN: number;
  warmupTaggedN: number;
  warmupExcludedN: number;
  outsideWindowN: number;
  catalogN: number;
}

function catalogCells(events: readonly DiscoveryEvent[]): DiscoveryCatalogCell[] {
  const map = new Map<string, DiscoveryCatalogCell>();
  for (const e of events) {
    const key = `${e.tf}|${e.assetId}|${e.kind}`;
    const cur = map.get(key) ?? { tf: e.tf, assetId: e.assetId, kind: e.kind, n: 0, buy: 0, sell: 0 };
    cur.n += 1;
    if (e.direction === "buy") cur.buy += 1;
    if (e.direction === "sell") cur.sell += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) =>
    a.tf.localeCompare(b.tf) || a.assetId.localeCompare(b.assetId) || a.kind.localeCompare(b.kind),
  );
}

function sequenceCellsOf(sequences: readonly DiscoverySequence[]): DiscoverySequenceCell[] {
  const map = new Map<string, DiscoverySequenceCell>();
  for (const s of sequences) {
    const tf = s.legs[s.legs.length - 1]?.tf ?? s.legs[0]?.tf;
    if (!tf) continue;
    const key = `${s.family}|${s.assetId}|${tf}`;
    const cur = map.get(key) ?? { family: s.family, assetId: s.assetId, tf, n: 0 };
    cur.n += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) =>
    a.family.localeCompare(b.family) || a.assetId.localeCompare(b.assetId) || a.tf.localeCompare(b.tf),
  );
}

/**
 * EXPLORE catalog. Never sorts by R / expectancy.
 * 15M events with closeT >= K1_REGISTERED_AT are excluded so K1 TEST cannot leak.
 */
export function collectExploreCatalog(
  bars: readonly DiscoveryBar[],
  nowSec: number,
  codeVersion = "shadow-discovery-1",
  opts?: { detectPatterns?: boolean; cursors?: Parameters<typeof buildCoverage>[1] },
): DiscoveryExploreCatalog {
  const closed = closedBarsThrough(sanitizeBars(bars), nowSec);
  const coverage = buildCoverage(closed, opts?.cursors);
  const spans = spansFromCoverage(coverage);
  const common4 = DISCOVERY_ARCHIVE_TFS.map((tf) =>
    attachCommon4BarCount(common4Window(spans, tf), closed),
  );
  const assetDeep = common4.flatMap((c) => assetDeepSlices(closed, c));
  const grouped = groupByAssetTf(closed);
  const events: DiscoveryEvent[] = [];
  let k1TestExcludedN = 0;
  if (opts?.detectPatterns) {
    for (const series of grouped.values()) {
      const detected = detectEvents(series);
      for (const e of detected) {
        if (e.tf === "15m" && e.closeT >= K1_REGISTERED_AT) {
          k1TestExcludedN += 1;
          continue;
        }
        events.push(e);
      }
    }
  }
  events.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const tagged = events.map((e) => {
    const c = common4.find((w) => w.tf === e.tf);
    const series = grouped.get(`${e.assetId}|${e.tf}`) ?? [];
    const warmup = c ? eventUsedBarsBeforeCommon(series, e, c) : false;
    return { ...e, warmupOutsideCommon: warmup };
  });

  const commonEvents = tagged.filter((e) => {
    const c = common4.find((w) => w.tf === e.tf);
    return c ? isCommon4CatalogEvent(e, c) : false;
  });

  const warmupTaggedN = tagged.filter((e) => e.warmupOutsideCommon).length;
  const warmupExcludedN = tagged.filter((e) => {
    const c = common4.find((w) => w.tf === e.tf);
    if (!c?.available || c.fromT == null || c.toT == null) return false;
    if (e.tf !== c.tf) return false;
    const inWindow = e.openT >= c.fromT && e.openT <= c.toT;
    return inWindow && e.warmupOutsideCommon;
  }).length;
  const outsideWindowN = tagged.filter((e) => {
    const c = common4.find((w) => w.tf === e.tf);
    if (!c?.available || c.fromT == null || c.toT == null) return true;
    if (e.tf !== c.tf) return true;
    return e.openT < c.fromT || e.openT > c.toT;
  }).length;

  const kinds = [...new Set(commonEvents.map((e) => e.kind))].sort();
  const eventCounts: DiscoveryEventCount[] = kinds.map((kind) => {
    const subset = commonEvents.filter((e) => e.kind === kind);
    const byAsset: Partial<Record<AssetId, number>> = {};
    const byTf: Partial<Record<DiscoveryTf, number>> = {};
    for (const e of subset) {
      byAsset[e.assetId] = (byAsset[e.assetId] ?? 0) + 1;
      byTf[e.tf] = (byTf[e.tf] ?? 0) + 1;
    }
    return { kind, n: subset.length, byAsset, byTf };
  });

  const sequences: DiscoverySequence[] = detectSequences(commonEvents);
  if (opts?.detectPatterns) {
    for (const [from, to] of MTF_ARCHIVE_PAIRS) {
      const htfW = common4.find((c) => c.tf === from) ?? null;
      const ltfW = common4.find((c) => c.tf === to) ?? null;
      sequences.push(...detectHtfContextSequences({
        events: commonEvents,
        htfBars: closed.filter((b) => b.tf === from),
        ltfBars: closed.filter((b) => b.tf === to),
        htfWindow: htfW,
        ltfWindow: ltfW,
      }));
    }
  }
  const seqNames = [...new Set(sequences.map((s) => s.family))].sort();
  const sequenceCounts = seqNames.map((family) => ({
    family,
    n: sequences.filter((s) => s.family === family).length,
  }));

  const primary = common4.find((c) => c.tf === "15m" && c.available) ?? common4.find((c) => c.available);
  const journal: DiscoveryJournalEntry = {
    exploredAt: new Date(nowSec * 1000).toISOString(),
    universe: primary ? "COMMON_4" : "TF_SOLO",
    primitives: ["swing", "range", "sweep", "reclaim", "displacement", "bos", "fvg", "atr", "volume_ratio"],
    families: sequenceCounts.map((s) => s.family),
    variants: eventCounts.map((e) => e.kind),
    discarded: [],
    discardReason: null,
    candidates: [],
    outcomeConsulted: false,
    codeVersion,
    notes: "EXPLORE / INSUFFICIENT. descriptivo, no validación. COMMON_4 = intersección. ASSET_DEEP separado. warmupOutsideCommon excluido de recuentos. outcome no consultado. Sin ranking. TEST de K1 excluido. k no incrementa.",
  };

  const report: DiscoveryExploreReport = {
    generatedAt: journal.exploredAt,
    codeVersion,
    k1TestExcluded: true,
    k1RegisteredAt: K1_REGISTERED_AT,
    coverage,
    eventCounts,
    sequenceCounts,
    mtfAvailable: mtfMatrix(coverage, common4),
    journal,
    outcomesSampled: 0,
    rankingByExpectancy: false,
    universes: {
      common4,
      assetDeep,
      inference: "INSUFFICIENT",
      exploreGrade: "EXPLORE",
    },
  };

  return {
    report,
    cells: catalogCells(commonEvents),
    sequenceCells: sequenceCellsOf(sequences),
    sequences: sequences.map((s) => ({
      family: s.family,
      assetId: s.assetId,
      decisionCloseT: s.decisionCloseT,
      legs: s.legs.map((l) => ({
        kind: l.kind,
        tf: l.tf,
        openT: l.openT,
        closeT: l.closeT,
        direction: l.direction,
      })),
    })),
    detectedN: events.length + k1TestExcludedN,
    k1TestExcludedN,
    warmupTaggedN,
    warmupExcludedN,
    outsideWindowN,
    catalogN: commonEvents.length,
  };
}

/**
 * EXPLORE: descriptive counts. Never sorts by R / expectancy.
 * 15M events with closeT >= K1_REGISTERED_AT are excluded so K1 TEST cannot leak into discovery.
 */
export function exploreDiscovery(
  bars: readonly DiscoveryBar[],
  nowSec: number,
  codeVersion = "shadow-discovery-1",
  opts?: { detectPatterns?: boolean; cursors?: Parameters<typeof buildCoverage>[1] },
): DiscoveryExploreReport {
  return collectExploreCatalog(bars, nowSec, codeVersion, opts).report;
}


export { htfContextBars } from "./shadow-discovery-universe";
