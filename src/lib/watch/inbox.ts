import type { AssetId, SetupState } from "../trading/types";
import { shouldPushState } from "./policy";

export interface InboxItem {
  episodeId: string;
  assetId: AssetId;
  direction: "buy" | "sell";
  fromState: SetupState;
  toState: SetupState;
  atMs: number;
  slot: number;
  notified: boolean;
  live: boolean;
  notifyStatus?: string | null;
  notifyAttempts?: number | null;
  notifyLastError?: string | null;
}

export function inboxStateLabel(to: SetupState): string {
  if (to === "entry") return "ENTRADA";
  if (to === "pending") return "TRIGGER PENDIENTE";
  if (to === "map") return "MAPA";
  return "ESPERAR";
}

export function inboxItemKey(row: Pick<InboxItem, "episodeId" | "slot" | "fromState" | "toState">): string {
  return `${row.episodeId}|${row.slot}|${row.fromState}|${row.toState}`;
}

/** One visual row per real entry. Later events for the same episode stay in the database. */
export function presentInboxEntries(rows: readonly InboxItem[]): InboxItem[] {
  const sorted = rows.slice().sort((a, b) => b.atMs - a.atMs || b.slot - a.slot);
  const seen = new Set<string>();
  const out: InboxItem[] = [];
  for (const row of sorted) {
    if (row.toState !== "entry") continue;
    if (seen.has(row.episodeId)) continue;
    seen.add(row.episodeId);
    out.push(row);
  }
  return out;
}

export function inboxTradeStatus(live: boolean): "ABIERTO" | "CERRADO" {
  return live ? "ABIERTO" : "CERRADO";
}

/** Result already stored on the episode. No new outcome is inferred. */
export function inboxResultLabel(outcome: string | null | undefined): string | null {
  if (outcome === "tp1") return "TP1";
  if (outcome === "tp2") return "TP2";
  if (outcome === "sl") return "SL";
  if (outcome === "expired") return "EXPIRADA";
  return null;
}

export function inboxPushLabel(row: InboxItem): string {
  if (row.notified) return "Push enviado";
  if (!shouldPushState(row.toState)) return "solo bandeja";
  if (row.notifyStatus === "failed") {
    return row.notifyLastError ? `Push falló · ${row.notifyLastError}` : "Push falló";
  }
  if (row.notifyStatus === "claimed") return "Push reclamado, sin confirmación";
  return "Push no enviado";
}
