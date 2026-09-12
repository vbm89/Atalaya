/**
 * Discovery universes: COMMON_4 vs ASSET_DEEP vs TF_SOLO.
 *
 * DISCOVERY_COMMON_MIN_DAYS unlocks the *next TF ingest*. It is not a
 * statistical-sufficiency gate. Inference on this tape stays INSUFFICIENT.
 */
import type { AssetId } from "../trading/types";
import { spanDays } from "./shadow-discovery-bars";
import { barCloseOf, htfClosedAtDecision } from "./shadow-discovery-clock";
import {
  DISCOVERY_ARCHIVE_TFS,
  DISCOVERY_ASSETS,
  DISCOVERY_COMMON_MIN_DAYS,
  DISCOVERY_RECENT_TFS,
  type DiscoveryBar,
  type DiscoveryEvent,
  type DiscoveryMtfAvailability,
  type DiscoveryTf,
  type DiscoveryUniverseKind,
} from "./shadow-discovery-types";

export interface DiscoveryAssetSpan {
  assetId: AssetId;
  tf: DiscoveryTf;
  firstT: number | null;
  lastT: number | null;
  exhausted: boolean;
}

export interface TimeWindow {
  fromT: number;
  toT: number;
}

export interface Common4Window {
  tf: DiscoveryTf;
  available: boolean;
  fromT: number | null;
  toT: number | null;
  days: number | null;
  assets: readonly AssetId[];
  limitingAssets: AssetId[];
  /**
   * Bar count of the clipped COMMON_4 universe for this TF.
   * Derived via clipBarsToCommon4(...).length — never min(n per asset),
   * never ASSET_DEEP length, never event count. null until bars are attached.
   */
  n: number | null;
  /** Unlock ingest of the next TF — not evidence. */
  unlocksNextTf: boolean;
  inference: "INSUFFICIENT";
  exploreGrade: "EXPLORE";
}

export interface AssetDeepSlice {
  assetId: AssetId;
  tf: DiscoveryTf;
  fromT: number | null;
  toT: number | null;
  extraBars: number;
  extraDays: number | null;
}

export function intersectWindows(windows: readonly TimeWindow[]): TimeWindow | null {
  if (windows.length === 0) return null;
  const fromT = Math.max(...windows.map((w) => w.fromT));
  const toT = Math.min(...windows.map((w) => w.toT));
  if (fromT > toT) return null;
  return { fromT, toT };
}

export function assetReadyForTfUnlock(span: DiscoveryAssetSpan | undefined): boolean {
  if (!span) return false;
  if (span.exhausted) return true;
  const days = spanDays(span.firstT, span.lastT);
  return days != null && days >= DISCOVERY_COMMON_MIN_DAYS;
}

export function tfUnlocksNext(spans: readonly DiscoveryAssetSpan[], tf: DiscoveryTf): boolean {
  return DISCOVERY_ASSETS.every((id) => assetReadyForTfUnlock(spans.find((s) => s.assetId === id && s.tf === tf)));
}

/**
 * First archive TF that is not yet unlocked. After every TF is unlocked,
 * deepen the first TF that still has a live (!exhausted) cursor.
 *
 * Ingest of "Actualizar cobertura" must NOT use the deepen tail.
 * Use nextTfToCompleteCoverage instead.
 */
export function nextDiscoveryTfToBackfill(spans: readonly DiscoveryAssetSpan[]): DiscoveryTf {
  for (const tf of DISCOVERY_ARCHIVE_TFS) {
    if (!tfUnlocksNext(spans, tf)) return tf;
  }
  for (const tf of DISCOVERY_ARCHIVE_TFS) {
    const live = DISCOVERY_ASSETS.some((id) => {
      const s = spans.find((x) => x.assetId === id && x.tf === tf);
      return Boolean(s && !s.exhausted);
    });
    if (live) return tf;
  }
  return DISCOVERY_ARCHIVE_TFS[DISCOVERY_ARCHIVE_TFS.length - 1]!;
}

/** First archive TF that has not reached COMMON_MIN (or exhausted) for all 4 assets. */
export function nextTfToCompleteCoverage(spans: readonly DiscoveryAssetSpan[]): DiscoveryTf | null {
  for (const tf of DISCOVERY_ARCHIVE_TFS) {
    if (!tfUnlocksNext(spans, tf)) return tf;
  }
  return null;
}

export function assetsNeedingCoverage(spans: readonly DiscoveryAssetSpan[], tf: DiscoveryTf): AssetId[] {
  return DISCOVERY_ASSETS.filter((id) => !assetReadyForTfUnlock(spans.find((s) => s.assetId === id && s.tf === tf)));
}

export function common4Window(spans: readonly DiscoveryAssetSpan[], tf: DiscoveryTf): Common4Window {
  const four = DISCOVERY_ASSETS.map((id) => spans.find((s) => s.assetId === id && s.tf === tf));
  const unlocksNextTf = tfUnlocksNext(spans, tf);
  const base = {
    tf,
    assets: DISCOVERY_ASSETS,
    unlocksNextTf,
    inference: "INSUFFICIENT" as const,
    exploreGrade: "EXPLORE" as const,
  };
  if (four.some((s) => !s || s.firstT == null || s.lastT == null)) {
    return { ...base, available: false, fromT: null, toT: null, days: null, limitingAssets: [], n: null };
  }
  const windows = four.map((s) => ({ fromT: s!.firstT!, toT: s!.lastT! }));
  const hit = intersectWindows(windows);
  if (!hit) {
    return { ...base, available: false, fromT: null, toT: null, days: null, limitingAssets: [], n: null };
  }
  const limitingAssets = DISCOVERY_ASSETS.filter((id, i) => {
    const s = four[i]!;
    return s.firstT === hit.fromT || s.lastT === hit.toT;
  });
  return {
    ...base,
    available: true,
    fromT: hit.fromT,
    toT: hit.toT,
    days: spanDays(hit.fromT, hit.toT),
    limitingAssets,
    n: null,
  };
}

export function inWindow(t: number, window: TimeWindow | Common4Window | null | undefined): boolean {
  if (!window || window.fromT == null || window.toT == null) return false;
  return t >= window.fromT && t <= window.toT;
}

export function classifyBarUniverse(bar: DiscoveryBar, common: Common4Window): DiscoveryUniverseKind {
  if (bar.tf !== common.tf) return "TF_SOLO";
  if (common.available && inWindow(bar.t, common)) return "COMMON_4";
  if (common.available) return "ASSET_DEEP";
  return "TF_SOLO";
}

export function clipBarsToCommon4(bars: readonly DiscoveryBar[], common: Common4Window): DiscoveryBar[] {
  if (!common.available) return [];
  return bars.filter((b) => b.tf === common.tf && classifyBarUniverse(b, common) === "COMMON_4");
}

/** Attach the exact clipped bar count. n is never approximated. */
export function attachCommon4BarCount(
  common: Common4Window,
  bars: readonly DiscoveryBar[],
): Common4Window {
  if (!common.available) return { ...common, n: 0 };
  return { ...common, n: clipBarsToCommon4(bars, common).length };
}

/**
 * COMMON_4 catalog event: openT inside the window AND no ASSET_DEEP warmup.
 * Warmup-tagged events remain on the tape; they are not counted here.
 */
export function isCommon4CatalogEvent(event: DiscoveryEvent, common: Common4Window): boolean {
  if (!common.available || common.fromT == null || common.toT == null) return false;
  if (event.tf !== common.tf) return false;
  if (event.warmupOutsideCommon) return false;
  return event.openT >= common.fromT && event.openT <= common.toT;
}

export function clipBarsToAssetDeep(bars: readonly DiscoveryBar[], common: Common4Window): DiscoveryBar[] {
  if (!common.available) return [];
  return bars.filter((b) => b.tf === common.tf && classifyBarUniverse(b, common) === "ASSET_DEEP");
}

export function assetDeepSlices(bars: readonly DiscoveryBar[], common: Common4Window): AssetDeepSlice[] {
  const deep = clipBarsToAssetDeep(bars, common);
  return DISCOVERY_ASSETS.map((assetId) => {
    const series = deep.filter((b) => b.assetId === assetId).sort((a, b) => a.t - b.t);
    const firstT = series[0]?.t ?? null;
    const lastT = series.length ? series[series.length - 1]!.t : null;
    return {
      assetId,
      tf: common.tf,
      fromT: firstT,
      toT: lastT,
      extraBars: series.length,
      extraDays: spanDays(firstT, lastT),
    };
  }).filter((s) => s.extraBars > 0);
}

/**
 * MTF: native bars only, causal HTF close, and every leg inside its own valid window.
 * Sole permitted path for HTF/LTF relations that can become a metric or sequence.
 */
export function mtfLegsInValidWindows(args: {
  htf: readonly DiscoveryBar[];
  ltf: readonly DiscoveryBar[];
  htfWindow: TimeWindow | Common4Window | null;
  ltfWindow: TimeWindow | Common4Window | null;
  decisionClose: number;
}): { htf: DiscoveryBar[]; ltf: DiscoveryBar[] } {
  const htfIn = args.htf.filter((b) => inWindow(b.t, args.htfWindow));
  const ltfIn = args.ltf.filter((b) => inWindow(b.t, args.ltfWindow));
  const ltf = ltfIn.filter((b) => barCloseOf(b) <= args.decisionClose);
  const decisionInWindow = ltf.some((b) => barCloseOf(b) === args.decisionClose);
  if (!decisionInWindow) return { htf: [], ltf: [] };
  return { htf: htfClosedAtDecision(htfIn, args.decisionClose), ltf };
}

/**
 * HTF context for a decision. Requires both windows — never window-blind.
 * Delegates to mtfLegsInValidWindows; cannot return ASSET_DEEP as COMMON_4 context.
 */
export function htfContextBars(args: {
  htf: readonly DiscoveryBar[];
  ltf: readonly DiscoveryBar[];
  htfWindow: TimeWindow | Common4Window;
  ltfWindow: TimeWindow | Common4Window;
  decisionClose: number;
}): DiscoveryBar[] {
  return mtfLegsInValidWindows(args).htf;
}

/** Prefix used to detect `event` includes any bar before COMMON_4.fromT. */
export function eventUsedBarsBeforeCommon(
  series: readonly DiscoveryBar[],
  event: DiscoveryEvent,
  common: Common4Window,
): boolean {
  if (!common.available || common.fromT == null || common.toT == null) return false;
  if (event.openT < common.fromT || event.openT > common.toT) return false;
  const idx = typeof event.extra.index === "number"
    ? event.extra.index
    : series.findIndex((b) => b.t === event.openT && b.assetId === event.assetId && b.tf === event.tf);
  if (idx < 0) return false;
  return series.slice(0, idx + 1).some((b) => b.t < common.fromT!);
}

export function mtfPairAvailability(
  from: DiscoveryTf,
  to: DiscoveryTf,
  coverage: ReadonlyArray<{ tf: DiscoveryTf; bars: number }>,
  commons: readonly Common4Window[],
): DiscoveryMtfAvailability {
  const aHas = coverage.some((r) => r.tf === from && r.bars > 0);
  const bHas = coverage.some((r) => r.tf === to && r.bars > 0);
  const recent = (DISCOVERY_RECENT_TFS as readonly DiscoveryTf[]).includes(from)
    || (DISCOVERY_RECENT_TFS as readonly DiscoveryTf[]).includes(to);
  if (!aHas || !bHas) {
    return { from, to, historical: false, recentOnly: false, reason: `sin cinta nativa ${from}→${to}` };
  }
  if (recent) {
    return { from, to, historical: false, recentOnly: true, reason: "1m/5m solo reciente; no MTF histórico" };
  }
  const wf = commons.find((c) => c.tf === from);
  const wt = commons.find((c) => c.tf === to);
  if (!wf?.available || !wt?.available) {
    return { from, to, historical: false, recentOnly: false, reason: `MTF ${from}→${to} exige COMMON_4 en ambos TF` };
  }
  return {
    from, to, historical: true, recentOnly: false,
    reason: "nativo; join causal solo vía mtfLegsInValidWindows",
  };
}

export const MTF_ARCHIVE_PAIRS: readonly [DiscoveryTf, DiscoveryTf][] = [
  ["4h", "1h"], ["1h", "30m"], ["30m", "15m"], ["4h", "15m"],
];


export function spansFromCoverage(
  rows: ReadonlyArray<{
    assetId: AssetId;
    tf: DiscoveryTf;
    firstT: number | null;
    lastT: number | null;
    exhausted: boolean | null;
  }>,
): DiscoveryAssetSpan[] {
  return rows.map((r) => ({
    assetId: r.assetId,
    tf: r.tf,
    firstT: r.firstT,
    lastT: r.lastT,
    exhausted: Boolean(r.exhausted),
  }));
}
