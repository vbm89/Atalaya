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

export function inboxPushLabel(row: InboxItem): string {
  if (row.notified) return "Push enviado";
  if (!shouldPushState(row.toState)) return "solo bandeja";
  if (row.notifyStatus === "failed") {
    return row.notifyLastError ? `Push falló · ${row.notifyLastError}` : "Push falló";
  }
  if (row.notifyStatus === "claimed") return "Push reclamado, sin confirmación";
  return "Push no enviado";
}
