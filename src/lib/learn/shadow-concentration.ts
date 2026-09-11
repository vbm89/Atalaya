export interface ConcentrationRow {
  decisionSlot: number;
  outcome: "tp1" | "tp2" | "sl" | "expired" | "pending" | string;
  rrAtOutcome: number | null;
}

export interface ConcentrationVeto {
  veto: boolean;
  reason: string | null;
  originalExpectancyR: number | null;
  withoutBestTradeR: number | null;
  withoutBestDayR: number | null;
  bestTradeFlipsSign: boolean;
  bestDayFlipsSign: boolean;
}

function finite(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

function decided(rows: readonly ConcentrationRow[]): ConcentrationRow[] {
  return rows.filter((r) => r.outcome === "tp1" || r.outcome === "tp2" || r.outcome === "sl");
}

export function expectancyR(rows: readonly ConcentrationRow[]): number | null {
  const values = decided(rows).map((r) => r.rrAtOutcome).filter(finite);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function utcDay(slotSec: number): string {
  return new Date(slotSec * 1000).toISOString().slice(0, 10);
}

function signFlip(original: number | null, remaining: number | null): boolean {
  if (original == null || original <= 0) return false;
  if (remaining == null) return true;
  return remaining <= 0;
}

function dropBestTrade(rows: readonly ConcentrationRow[]): ConcentrationRow[] {
  const pool = decided(rows);
  if (pool.length < 2) return [...rows];
  let bestIdx = 0;
  for (let i = 1; i < pool.length; i += 1) {
    const a = pool[i]!.rrAtOutcome ?? Number.NEGATIVE_INFINITY;
    const b = pool[bestIdx]!.rrAtOutcome ?? Number.NEGATIVE_INFINITY;
    if (a > b) bestIdx = i;
  }
  const drop = pool[bestIdx]!;
  return rows.filter((r) => r !== drop);
}

function dropBestDay(rows: readonly ConcentrationRow[]): ConcentrationRow[] {
  const pool = decided(rows);
  if (pool.length < 2) return [...rows];
  const byDay = new Map<string, number>();
  for (const r of pool) {
    const day = utcDay(r.decisionSlot);
    byDay.set(day, (byDay.get(day) ?? 0) + (r.rrAtOutcome ?? 0));
  }
  let bestDay: string | null = null;
  let bestSum = Number.NEGATIVE_INFINITY;
  for (const [day, sum] of byDay) {
    if (sum > bestSum) {
      bestDay = day;
      bestSum = sum;
    }
  }
  if (bestDay == null) return [...rows];
  return rows.filter((r) => utcDay(r.decisionSlot) !== bestDay);
}

/** If dropping the best trade or best day flips +EV to ≤0, KEEP is forbidden. */
export function concentrationVeto(rows: readonly ConcentrationRow[]): ConcentrationVeto {
  const original = expectancyR(rows);
  const withoutBestTradeR = expectancyR(dropBestTrade(rows));
  const withoutBestDayR = expectancyR(dropBestDay(rows));
  const bestTradeFlipsSign = signFlip(original, withoutBestTradeR);
  const bestDayFlipsSign = signFlip(original, withoutBestDayR);
  const veto = bestTradeFlipsSign || bestDayFlipsSign;
  let reason: string | null = null;
  if (bestTradeFlipsSign) reason = "el mejor trade invierte el signo de R";
  else if (bestDayFlipsSign) reason = "el mejor día invierte el signo de R";
  return {
    veto,
    reason,
    originalExpectancyR: original,
    withoutBestTradeR,
    withoutBestDayR,
    bestTradeFlipsSign,
    bestDayFlipsSign,
  };
}
