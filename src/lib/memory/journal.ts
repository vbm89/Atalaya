export const JOURNAL_ACTIONS = ["took", "skipped", "partial"] as const;
export type JournalAction = (typeof JOURNAL_ACTIONS)[number];

export interface JournalEntry {
  episodeId: string;
  action: JournalAction;
  lots: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  note: string | null;
  updatedAtMs: number;
}

export const JOURNAL_LABEL: Record<JournalAction, string> = {
  took: "TOMÉ",
  skipped: "NO TOMÉ",
  partial: "PARCIAL",
};

function finiteOrNull(n: unknown): number | null {
  if (n == null || n === "") return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return v;
}

export function parseJournalInput(raw: {
  episodeId?: unknown;
  action?: unknown;
  lots?: unknown;
  entryPrice?: unknown;
  exitPrice?: unknown;
  note?: unknown;
}): JournalEntry | { error: string } {
  const episodeId = typeof raw.episodeId === "string" ? raw.episodeId.trim() : "";
  if (episodeId.length < 8) return { error: "Episodio no válido." };
  if (raw.action !== "took" && raw.action !== "skipped" && raw.action !== "partial") {
    return { error: "Acción no válida." };
  }
  const lots = finiteOrNull(raw.lots);
  if (lots != null && !(lots > 0)) return { error: "Lote no válido." };
  const entryPrice = finiteOrNull(raw.entryPrice);
  if (entryPrice != null && !(entryPrice > 0)) return { error: "Precio de entrada no válido." };
  const exitPrice = finiteOrNull(raw.exitPrice);
  if (exitPrice != null && !(exitPrice > 0)) return { error: "Precio de salida no válido." };
  let note: string | null = typeof raw.note === "string" ? raw.note.trim() : null;
  if (note === "") note = null;
  if (note && note.length > 280) note = note.slice(0, 280);
  return {
    episodeId,
    action: raw.action,
    lots,
    entryPrice,
    exitPrice,
    note,
    updatedAtMs: Date.now(),
  };
}
