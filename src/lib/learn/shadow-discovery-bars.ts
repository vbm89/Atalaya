/**
 * Universe hygiene: validate, dedupe, order, gap-detect. Never synthesize bars.
 */
import type { AssetId } from "../trading/types";
import {
  DISCOVERY_STEP_SEC,
  type DiscoveryBar,
  type DiscoveryGap,
  type DiscoveryQuality,
  type DiscoveryStatus,
  type DiscoveryTf,
  type DiscoveryUse,
} from "./shadow-discovery-types";

export function ohlcValid(b: Pick<DiscoveryBar, "o" | "h" | "l" | "c">): boolean {
  if (![b.o, b.h, b.l, b.c].every((n) => Number.isFinite(n))) return false;
  if (b.h < b.l) return false;
  if (b.h < Math.max(b.o, b.c)) return false;
  if (b.l > Math.min(b.o, b.c)) return false;
  return true;
}

export function isoUtc(openSec: number): string {
  return new Date(openSec * 1000).toISOString();
}

export function excludeOpenBars(bars: readonly DiscoveryBar[], nowSec: number): DiscoveryBar[] {
  return bars.filter((b) => b.t + DISCOVERY_STEP_SEC[b.tf] <= nowSec);
}

export function sanitizeBars(input: readonly DiscoveryBar[], nowSec?: number): DiscoveryBar[] {
  const seen = new Set<string>();
  const out: DiscoveryBar[] = [];
  for (const b of input) {
    if (!Number.isFinite(b.t) || b.t <= 0) continue;
    if (!ohlcValid(b)) continue;
    if (nowSec != null && b.t + DISCOVERY_STEP_SEC[b.tf] > nowSec) continue;
    const k = `${b.assetId}|${b.tf}|${b.t}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...b, v: b.v != null && Number.isFinite(b.v) ? b.v : null });
  }
  out.sort((a, b) => (
    a.assetId === b.assetId
      ? (a.tf === b.tf ? a.t - b.t : a.tf.localeCompare(b.tf))
      : a.assetId.localeCompare(b.assetId)
  ));
  return out;
}

export function detectGaps(bars: readonly DiscoveryBar[], tf: DiscoveryTf): DiscoveryGap[] {
  const step = DISCOVERY_STEP_SEC[tf];
  const gaps: DiscoveryGap[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const cur = bars[i]!;
    if (prev.assetId !== cur.assetId || prev.tf !== cur.tf) continue;
    const d = (cur.t - prev.t) / step;
    if (d > 1.51) {
      const missing = Math.round(d - 1);
      gaps.push({ assetId: cur.assetId, tf, fromT: prev.t, toT: cur.t, missing });
    }
  }
  return gaps;
}

export function seriesWithGaps(bars: readonly DiscoveryBar[], tf: DiscoveryTf): {
  bars: DiscoveryBar[];
  gaps: DiscoveryGap[];
} {
  const clean = sanitizeBars(bars.filter((b) => b.tf === tf));
  return { bars: clean, gaps: detectGaps(clean, tf) };
}

export function marketDaysUtc(bars: readonly DiscoveryBar[]): number {
  const days = new Set<string>();
  for (const b of bars) days.add(isoUtc(b.t).slice(0, 10));
  return days.size;
}

/**
 * Depth grades are coverage rules, not fitted to any expectancy.
 * 1M/5M cannot be A/B — they are recent-only by protocol.
 */
export function discoveryStatus(args: {
  bars: number;
  calendarDays: number | null;
  tf: DiscoveryTf;
}): DiscoveryStatus {
  if (args.bars <= 0) return "D";
  if (args.tf === "1m" || args.tf === "5m") return args.bars >= 50 ? "C" : "D";
  const days = args.calendarDays ?? 0;
  if (args.tf === "15m") {
    if (days >= 90 && args.bars >= 5000) return "A";
    if (days >= 30 && args.bars >= 1500) return "B";
    if (args.bars >= 50) return "C";
    return "D";
  }
  if (args.tf === "30m") {
    if (days >= 90 && args.bars >= 2500) return "A";
    if (days >= 30 && args.bars >= 800) return "B";
    if (args.bars >= 40) return "C";
    return "D";
  }
  if (args.tf === "1h") {
    if (days >= 180 && args.bars >= 2500) return "A";
    if (days >= 60 && args.bars >= 800) return "B";
    if (args.bars >= 24) return "C";
    return "D";
  }
  if (days >= 365 && args.bars >= 1500) return "A";
  if (days >= 90 && args.bars >= 400) return "B";
  if (args.bars >= 20) return "C";
  return "D";
}

export function coverageQuality(args: {
  bars: number;
  days: number | null;
  tf: DiscoveryTf;
}): { quality: DiscoveryQuality; use: DiscoveryUse; explore: boolean; trainCandidate: boolean } {
  const status = discoveryStatus({ bars: args.bars, calendarDays: args.days, tf: args.tf });
  if (status === "D" || args.bars <= 0) {
    return { quality: args.bars <= 0 ? "empty" : "thin", use: "unavailable", explore: false, trainCandidate: false };
  }
  if (status === "C" || args.tf === "1m" || args.tf === "5m") {
    return { quality: "thin", use: "recent_only", explore: true, trainCandidate: false };
  }
  return { quality: "ok", use: "explore", explore: true, trainCandidate: status === "A" };
}

export function spanDays(firstT: number | null, lastT: number | null): number | null {
  if (firstT == null || lastT == null || lastT < firstT) return null;
  return (lastT - firstT) / 86400;
}

export function groupByAssetTf(bars: readonly DiscoveryBar[]): Map<string, DiscoveryBar[]> {
  const m = new Map<string, DiscoveryBar[]>();
  for (const b of bars) {
    const k = `${b.assetId}|${b.tf}`;
    const list = m.get(k) ?? [];
    list.push(b);
    m.set(k, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.t - b.t);
  return m;
}

export function keyOf(assetId: AssetId, tf: DiscoveryTf): string {
  return `${assetId}|${tf}`;
}
