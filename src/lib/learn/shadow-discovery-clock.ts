import { DISCOVERY_STEP_SEC, type DiscoveryBar, type DiscoveryTf } from "./shadow-discovery-types";

export function barCloseSec(openT: number, tf: DiscoveryTf): number {
  return openT + DISCOVERY_STEP_SEC[tf];
}

export function barCloseOf(bar: DiscoveryBar): number {
  return barCloseSec(bar.t, bar.tf);
}

/** Forming bars are excluded. `nowSec` is unix seconds. */
export function isBarClosed(bar: DiscoveryBar, nowSec: number): boolean {
  return barCloseOf(bar) <= nowSec;
}

export function closedBarsThrough(bars: readonly DiscoveryBar[], nowSec: number): DiscoveryBar[] {
  return bars.filter((b) => isBarClosed(b, nowSec)).sort((a, b) => a.t - b.t);
}

/**
 * MTF: a higher-TF bar may inform a decision at `decisionClose` only if
 * its own close is already known: close <= decisionClose.
 */
export function htfClosedAtDecision(
  bars: readonly DiscoveryBar[],
  decisionClose: number,
): DiscoveryBar[] {
  return bars.filter((b) => barCloseOf(b) <= decisionClose).sort((a, b) => a.t - b.t);
}

export function prefixThroughIndex(bars: readonly DiscoveryBar[], lastInclusive: number): DiscoveryBar[] {
  if (lastInclusive < 0) return [];
  return bars.slice(0, lastInclusive + 1);
}
