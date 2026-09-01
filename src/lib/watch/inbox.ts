import type { AssetId, SetupState } from "../trading/types";

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
