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
  type DiscoveryBar,
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
    return { ...base, available: false, fromT: null, toT: null, days: null, limitingAssets: [] };
  }
  const windows = four.map((s) => ({ fromT: s!.firstT!, toT: s!.lastT! }));
  const hit = intersectWindows(windows);
  if (!hit) {
    return { ...base, available: false, fromT: null, toT: null, days: null, limitingAssets: [] };
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
