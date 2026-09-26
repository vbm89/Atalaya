import type { AssetId, Bar } from "./types.ts";

export interface PaperSignal {
  id: string;
  asset: AssetId;
  timeframe: "15m";
  timestamp: number;
  lastBarT: number;
  direction: "COMPRA" | "VENTA";
  entry: number;
  stop: number;
  target: number;
  rr: number;
  setup: string;
  tier: "FULL" | "PARTIAL";
  marketState: string;
  event: string;
  rationale: string;
  provider: string;
  revisionOf: string | null;
  result: "ABIERTA" | "SL" | "TP";
}

const keyOf = (s: Pick<PaperSignal, "asset" | "timeframe" | "lastBarT" | "direction">) =>
  `${s.asset}|${s.timeframe}|${s.lastBarT}|${s.direction}`;

function sameLevels(a: PaperSignal, b: PaperSignal): boolean {
  const eps = Math.max(1e-8, Math.abs(a.entry) * 1e-8);
  return Math.abs(a.entry - b.entry) <= eps && Math.abs(a.stop - b.stop) <= eps && Math.abs(a.target - b.target) <= eps;
}

export function admitSignal(
  book: readonly PaperSignal[],
  incoming: PaperSignal,
): { book: PaperSignal[]; status: "NEW" | "DUPLICATE" | "REVISION" } {
  const prev = [...book].reverse().find((row) => keyOf(row) === keyOf(incoming));
  if (!prev) return { book: [...book, incoming], status: "NEW" };
  if (sameLevels(prev, incoming)) return { book: [...book], status: "DUPLICATE" };
  const revision: PaperSignal = { ...incoming, id: `${incoming.id}:rev`, revisionOf: prev.id };
  return { book: [...book, revision], status: "REVISION" };
}

/** SL primero si la misma vela toca stop y objetivo. Solo velas posteriores a la de entrada. */
export function settleSignal(row: PaperSignal, bars: readonly Bar[]): PaperSignal["result"] {
  for (const bar of bars) {
    if (bar.t <= row.lastBarT) continue;
    const stopHit = row.direction === "COMPRA" ? bar.l <= row.stop : bar.h >= row.stop;
    const targetHit = row.direction === "COMPRA" ? bar.h >= row.target : bar.l <= row.target;
    if (stopHit) return "SL";
    if (targetHit) return "TP";
  }
  return "ABIERTA";
}

let book: PaperSignal[] = [];

export function resetPaperBook(): void {
  book = [];
}

export function readPaperBook(): PaperSignal[] {
  return book;
}

export function rememberSignal(incoming: PaperSignal): "NEW" | "DUPLICATE" | "REVISION" {
  const next = admitSignal(book, incoming);
  book = next.book;
  return next.status;
}

export function settleBook(asset: AssetId, bars: readonly Bar[]): void {
  book = book.map((row) => (row.asset === asset && row.result === "ABIERTA" ? { ...row, result: settleSignal(row, bars) } : row));
}
