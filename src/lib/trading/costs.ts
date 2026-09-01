import type { AssetId } from "./types";
import { ASSETS } from "./assets";

export const COSTS_STORAGE_KEY = "atalaya:costs:v1";

/** User-entered trading costs. Never a broker default. Independent of risk.ts. */
export interface AssetCosts {
  spreadTicks: number | null;
  commissionEur: number | null;
}

export type CostsBook = Record<AssetId, AssetCosts>;

function empty(): AssetCosts {
  return { spreadTicks: null, commissionEur: null };
}

export function emptyCosts(): CostsBook {
  const out = {} as CostsBook;
  for (const a of ASSETS) out[a.id] = empty();
  return out;
}

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function readCosts(): CostsBook {
  const base = emptyCosts();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(COSTS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const a of ASSETS) {
      const o = parsed[a.id];
      if (!o || typeof o !== "object") continue;
      const row = o as Record<string, unknown>;
      base[a.id] = {
        spreadTicks: positive(row.spreadTicks),
        commissionEur: positive(row.commissionEur),
      };
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function writeCosts(book: CostsBook) {
  try {
    window.localStorage.setItem(COSTS_STORAGE_KEY, JSON.stringify(book));
  } catch {
    /* ignore */
  }
}

export function costsComplete(costs: AssetCosts): boolean {
  return costs.spreadTicks != null && costs.commissionEur != null;
}

/** Informational only. Does not change V1 R:R. */
export function costImpactNote(
  costs: AssetCosts,
  tickValue: number | null,
  slTicks: number | null,
): string | null {
  if (costs.spreadTicks == null && costs.commissionEur == null) return null;
  const bits: string[] = [];
  if (costs.spreadTicks != null) bits.push(`spread ${costs.spreadTicks} ticks (manual)`);
  if (costs.commissionEur != null) bits.push(`comisión ${costs.commissionEur} € (manual)`);
  if (tickValue != null && costs.spreadTicks != null && slTicks != null && slTicks > 0) {
    const spreadEur = costs.spreadTicks * tickValue;
    const slEur = slTicks * tickValue;
    if (slEur > 0) {
      const pct = (spreadEur / slEur) * 100;
      bits.push(`spread ≈ ${pct.toFixed(0)} % del SL teórico`);
    }
  }
  return `Costes introducidos: ${bits.join(" · ")}. No modifican el R:R de V1.`;
}

/** Separate from V1 R:R. Missing user data → NO CALCULABLE, never invented. */
export function costEstimateLabel(
  costs: AssetCosts,
  tickValue: number | null,
  slTicks: number | null,
): { calculable: boolean; text: string } {
  const note = costImpactNote(costs, tickValue, slTicks);
  if (!note) {
    return { calculable: false, text: "NO CALCULABLE" };
  }
  if (tickValue == null || slTicks == null) {
    return { calculable: false, text: `${note} · impacto en € NO CALCULABLE` };
  }
  return { calculable: true, text: note };
}
