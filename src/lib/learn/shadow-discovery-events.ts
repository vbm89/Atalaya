import type { AssetId } from "../trading/types";
import { barCloseSec } from "./shadow-discovery-clock";
import {
  atrAt,
  confirmedSwings,
  displacementAt,
  fvgAt,
  lastSwing,
  rangeAt,
} from "./shadow-discovery-primitives";
import type { DiscoveryBar, DiscoveryEvent, DiscoveryEventKind, DiscoveryTf } from "./shadow-discovery-types";

function eid(assetId: AssetId, tf: DiscoveryTf, kind: DiscoveryEventKind, openT: number): string {
  return `${assetId}|${tf}|${kind}|${openT}`;
}

function base(
  bar: DiscoveryBar,
  i: number,
  kind: DiscoveryEventKind,
  direction: DiscoveryEvent["direction"],
  level: number | null,
  atr: number | null,
  extra: DiscoveryEvent["extra"] = {},
): DiscoveryEvent {
  return {
    id: eid(bar.assetId, bar.tf, kind, bar.t),
    assetId: bar.assetId,
    tf: bar.tf,
    kind,
    openT: bar.t,
    closeT: barCloseSec(bar.t, bar.tf),
    direction,
    level,
    atr,
    extra: { index: i, ...extra },
  };
}

/**
 * Detect events on a single closed series. Bar i is the last closed bar used.
 * Future bars after `endInclusive` must not change any event with confirm <= endInclusive.
 */
export function detectEvents(bars: readonly DiscoveryBar[], endInclusive = bars.length - 1): DiscoveryEvent[] {
  if (endInclusive < 0 || bars.length === 0) return [];
  const series = bars.slice(0, endInclusive + 1);
  const out: DiscoveryEvent[] = [];
  let lastFvg: { dir: "buy" | "sell"; low: number; high: number; createdI: number } | null = null;

  for (let i = 1; i <= endInclusive; i++) {
    const bar = series[i]!;
    const atr = atrAt(series, i);
    const swings = confirmedSwings(series, i);
    const lastH = lastSwing(swings, "high");
    const lastL = lastSwing(swings, "low");

    for (const s of swings) {
      if (s.confirmIndex !== i) continue;
      out.push(base(bar, i, s.kind === "high" ? "swing_high" : "swing_low", s.kind === "high" ? "sell" : "buy", s.price, atr, {
        swingIndex: s.index,
      }));
    }

    const range = rangeAt(series, i);
    if (range) {
      if (bar.c > range.high) {
        out.push(base(bar, i, "range_breakout", "buy", range.high, atr, { rangeLow: range.low, rangeHigh: range.high }));
      } else if (bar.c < range.low) {
        out.push(base(bar, i, "range_breakout", "sell", range.low, atr, { rangeLow: range.low, rangeHigh: range.high }));
      }
      // failed breakout: previous bar closed outside, this bar closes back in
      const prev = series[i - 1]!;
      const prevRange = rangeAt(series, i - 1);
      if (prevRange) {
        const wasUp = prev.c > prevRange.high;
        const wasDown = prev.c < prevRange.low;
        if (wasUp && bar.c <= prevRange.high && bar.c >= prevRange.low) {
          out.push(base(bar, i, "failed_breakout", "sell", prevRange.high, atr, { priorOpenT: prev.t }));
        }
        if (wasDown && bar.c >= prevRange.low && bar.c <= prevRange.high) {
          out.push(base(bar, i, "failed_breakout", "buy", prevRange.low, atr, { priorOpenT: prev.t }));
        }
      }
    }

    if (lastH && bar.h > lastH.price && bar.c < lastH.price) {
      out.push(base(bar, i, "sweep_prior_high", "sell", lastH.price, atr, { swingOpenT: series[lastH.index]!.t }));
    }
    if (lastL && bar.l < lastL.price && bar.c > lastL.price) {
      out.push(base(bar, i, "sweep_prior_low", "buy", lastL.price, atr, { swingOpenT: series[lastL.index]!.t }));
    }

    if (range && bar.h >= range.low && bar.l <= range.high) {
      const mid = (range.low + range.high) / 2;
      if (bar.c > mid && bar.c > bar.o) out.push(base(bar, i, "reclaim", "buy", range.low, atr));
      if (bar.c < mid && bar.c < bar.o) out.push(base(bar, i, "reclaim", "sell", range.high, atr));
    }

    if (displacementAt(series, i, atr)) {
      out.push(base(bar, i, "displacement", bar.c >= bar.o ? "buy" : "sell", bar.c, atr));
    }

    if (lastH && bar.c > lastH.price) out.push(base(bar, i, "bos_up", "buy", lastH.price, atr));
    if (lastL && bar.c < lastL.price) out.push(base(bar, i, "bos_down", "sell", lastL.price, atr));

    const fvg = fvgAt(series, i);
    if (fvg) {
      lastFvg = { ...fvg, createdI: i };
      out.push(base(bar, i, "fvg_created", fvg.dir, (fvg.low + fvg.high) / 2, atr, { fvgLow: fvg.low, fvgHigh: fvg.high }));
    } else if (lastFvg && i > lastFvg.createdI) {
      const tap = bar.l <= lastFvg.high && bar.h >= lastFvg.low;
      if (tap) {
        out.push(base(bar, i, "fvg_retested", lastFvg.dir, (lastFvg.low + lastFvg.high) / 2, atr));
        lastFvg = null;
      }
    }
  }
  return out;
}

export function eventsByKind(events: readonly DiscoveryEvent[], kind: DiscoveryEventKind): DiscoveryEvent[] {
  return events.filter((e) => e.kind === kind);
}
