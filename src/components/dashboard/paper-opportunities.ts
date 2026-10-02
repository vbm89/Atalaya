import type { AssetId } from "@/lib/trading/types";

export interface PaperAssetDecision {
  asset: AssetId;
  status: string;
  provider: string | null;
  action: "COMPRA" | "VENTA" | "ESPERAR";
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  setup: string | null;
  rationale: string;
  wait: string;
  candles?: { c: number }[];
}

const PAPER_ORDER: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];

function isPaperEntry(row: PaperAssetDecision): boolean {
  return (
    (row.action === "COMPRA" || row.action === "VENTA") &&
    row.status === "DATA_OK" &&
    row.entry != null &&
    row.stop != null &&
    row.target != null &&
    row.rr != null
  );
}

/** Decisiones ya emitidas por PAPER, de mayor R:R a menor. No recalcula el mercado. */
export function listPaperOpportunities(assets: readonly PaperAssetDecision[]): PaperAssetDecision[] {
  return assets.filter(isPaperEntry).slice().sort((a, b) => {
    const byRr = (b.rr ?? 0) - (a.rr ?? 0);
    if (byRr !== 0) return byRr;
    return PAPER_ORDER.indexOf(a.asset) - PAPER_ORDER.indexOf(b.asset);
  });
}

/** Elige una decisión ya emitida por PAPER. No recalcula el mercado. */
export function pickPaperOpportunity(assets: readonly PaperAssetDecision[]): PaperAssetDecision | null {
  return listPaperOpportunities(assets)[0] ?? null;
}
