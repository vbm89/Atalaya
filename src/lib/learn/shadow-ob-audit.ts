import { barCloseOf } from "./shadow-discovery-clock";
import { detectEvents } from "./shadow-discovery-events";
import { DISCOVERY_OUTCOME_HORIZON_BARS, type DiscoveryBar, type DiscoveryEvent } from "./shadow-discovery-types";

export interface OrderBlockAuditRow {
  eventId: string;
  assetId: DiscoveryBar["assetId"];
  tf: DiscoveryBar["tf"];
  direction: "buy" | "sell";
  decisionCloseT: number;
  originOpenT: number | null;
  zoneLow: number;
  zoneHigh: number;
  atr: number | null;
  firstTouchT: number | null;
  barsToFirstTouch: number | null;
  firstTouchOverlap: number | null;
}

export interface OrderBlockAuditReport {
  generatedAt: string;
  codeVersion: string;
  /** Descriptive audit only. It does not rank, optimize, or promote OBs. */
  status: "DESCRIPTIVE_ONLY";
  horizonBars: number;
  detected: number;
  touchedWithinHorizon: number;
  touchRate: number | null;
  rows: OrderBlockAuditRow[];
}

function asFiniteNumber(value: number | string | boolean | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function closedAfterEvent(
  event: DiscoveryEvent,
  bars: readonly DiscoveryBar[],
  horizonBars: number,
): DiscoveryBar[] {
  return bars
    .filter((b) => b.assetId === event.assetId && b.tf === event.tf && barCloseOf(b) > event.closeT)
    .sort((a, b) => a.t - b.t)
    .slice(0, horizonBars);
}

function firstTouch(
  event: DiscoveryEvent,
  bars: readonly DiscoveryBar[],
  horizonBars: number,
): Pick<OrderBlockAuditRow, "firstTouchT" | "barsToFirstTouch" | "firstTouchOverlap"> {
  const low = asFiniteNumber(event.extra.zoneLow);
  const high = asFiniteNumber(event.extra.zoneHigh);
  if (low == null || high == null || high < low) {
    return { firstTouchT: null, barsToFirstTouch: null, firstTouchOverlap: null };
  }
  const width = high - low;
  const after = closedAfterEvent(event, bars, horizonBars);
  for (let i = 0; i < after.length; i += 1) {
    const b = after[i]!;
    const overlap = Math.max(0, Math.min(b.h, high) - Math.max(b.l, low));
    const touched = width === 0 ? b.l <= high && b.h >= low : overlap > 0;
    if (touched) {
      return {
        firstTouchT: b.t,
        barsToFirstTouch: i + 1,
        firstTouchOverlap: width === 0 ? null : overlap / width,
      };
    }
  }
  return { firstTouchT: null, barsToFirstTouch: null, firstTouchOverlap: null };
}

/**
 * Audit the existing causal Order Block primitive without introducing a trading rule.
 *
 * Important boundaries:
 * - event existence comes only from detectEvents(), therefore decision is causal;
 * - touch search starts strictly after event.closeT;
 * - horizon is the existing laboratory constant, not a searched parameter;
 * - output is descriptive and never converted into an expectancy/ranking score.
 */
export function auditOrderBlocks(
  bars: readonly DiscoveryBar[],
  generatedAt = new Date().toISOString(),
  horizonBars = DISCOVERY_OUTCOME_HORIZON_BARS,
): OrderBlockAuditReport {
  const safeHorizon = Math.max(1, Math.floor(horizonBars));
  const events = detectEvents(bars).filter((e) => e.kind === "order_block");
  const rows: OrderBlockAuditRow[] = events.map((event) => {
    const touch = firstTouch(event, bars, safeHorizon);
    return {
      eventId: event.id,
      assetId: event.assetId,
      tf: event.tf,
      direction: event.direction === "sell" ? "sell" : "buy",
      decisionCloseT: event.closeT,
      originOpenT: asFiniteNumber(event.extra.originOpenT),
      zoneLow: asFiniteNumber(event.extra.zoneLow) ?? Number.NaN,
      zoneHigh: asFiniteNumber(event.extra.zoneHigh) ?? Number.NaN,
      atr: event.atr,
      ...touch,
    };
  });
  const touchedWithinHorizon = rows.filter((r) => r.firstTouchT != null).length;
  return {
    generatedAt,
    codeVersion: "shadow-ob-audit-1",
    status: "DESCRIPTIVE_ONLY",
    horizonBars: safeHorizon,
    detected: rows.length,
    touchedWithinHorizon,
    touchRate: rows.length ? touchedWithinHorizon / rows.length : null,
    rows,
  };
}
