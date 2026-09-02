export const JOURNAL_ACTIONS = ["took", "skipped", "partial"] as const;
export type JournalAction = (typeof JOURNAL_ACTIONS)[number];

export const JOURNAL_CLEARABLE = ["lots", "entryPrice", "exitPrice", "note"] as const;
export type JournalClearField = (typeof JOURNAL_CLEARABLE)[number];

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

export function parseClearFields(raw: unknown): JournalClearField[] {
  if (!Array.isArray(raw)) return [];
  const out: JournalClearField[] = [];
  for (const item of raw) {
    if (item === "lots" || item === "entryPrice" || item === "exitPrice" || item === "note") {
      if (!out.includes(item)) out.push(item);
    }
  }
  return out;
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

/**
 * Empty incoming fields keep the stored value unless listed in `clear`.
 * Prevents TOMÉ + blank inputs from wiping lots/entry/exit/note.
 */
export function mergeJournal(
  existing: JournalEntry | null,
  incoming: JournalEntry,
  clear: readonly JournalClearField[] = [],
): JournalEntry {
  const wipe = new Set(clear);
  const pickNum = (
    field: "lots" | "entryPrice" | "exitPrice",
    next: number | null,
    prev: number | null,
  ): number | null => {
    if (wipe.has(field)) return null;
    if (next != null) return next;
    return prev;
  };
  let note: string | null;
  if (wipe.has("note")) note = null;
  else if (incoming.note != null) note = incoming.note;
  else note = existing?.note ?? null;
  return {
    episodeId: incoming.episodeId,
    action: incoming.action,
    lots: pickNum("lots", incoming.lots, existing?.lots ?? null),
    entryPrice: pickNum("entryPrice", incoming.entryPrice, existing?.entryPrice ?? null),
    exitPrice: pickNum("exitPrice", incoming.exitPrice, existing?.exitPrice ?? null),
    note,
    updatedAtMs: incoming.updatedAtMs,
  };
}

/** TOMÉ/PARCIAL without lot or real entry. NO TOMÉ is never incomplete. */
export function journalIncomplete(row: Pick<JournalEntry, "action" | "lots" | "entryPrice">): boolean {
  if (row.action === "skipped") return false;
  return row.lots == null || row.entryPrice == null;
}
