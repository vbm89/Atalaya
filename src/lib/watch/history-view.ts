import { formatPrice } from "../utils";
import { ASSETS } from "../trading/assets";
import type { AssetId, SetupState } from "../trading/types";
import { displayEntryPrice } from "../chart/labels";
import { formatMadridStamp } from "./clock";
import { setupStateEs } from "./memory";
import type { HistoryRow } from "./store";

export const HISTORY_DISCLAIMER = "ANÁLISIS — NO ES UNA ORDEN";

export function entryPrice(direction: "buy" | "sell", zoneLow: number, zoneHigh: number): number {
  return displayEntryPrice(direction, zoneLow, zoneHigh);
}

export function kindLabel(kind: string): string {
  if (kind === "break-retest") return "ruptura + retest";
  if (kind === "continuation") return "continuación";
  return kind || "—";
}

export function timeframeLabel(row: HistoryRow): string {
  const tf = row.episode.freeze?.timeframe ?? "15m";
  if (tf === "15m") return "M15";
  return String(tf).toUpperCase();
}

export function outcomeView(row: HistoryRow): { text: string; cls: string } {
  switch (row.outcome) {
    case "tp1":
      return { text: "TP1", cls: "text-buy" };
    case "tp2":
      return { text: "TP2", cls: "text-buy" };
    case "sl":
      return { text: "SL", cls: "text-sell" };
    case "expired":
      return { text: "EXPIRADA", cls: "text-muted" };
    default:
      break;
  }
  if (row.episode.closedAtMs == null && row.episode.currentState !== "wait") {
    return { text: "PENDIENTE", cls: "text-wait" };
  }
  return { text: "RESULTADO PENDIENTE", cls: "text-subtle" };
}

export function wickNote(row: HistoryRow): string {
  const touch = row.firstTouch;
  if (touch === "sl" || touch === "tp1" || touch === "tp2") {
    const when =
      row.firstTouchAtMs != null ? formatMadridStamp(row.firstTouchAtMs) : "hora no registrada";
    const what = touch === "sl" ? "SL" : touch === "tp1" ? "TP1" : "TP2";
    return `Mecha 15M tocó ${what} · ${when} (Madrid). Primer toque. Misma vela: gana SL.`;
  }
  if (row.outcome === "expired") {
    return "Cerrada sin toque de SL ni TP. No es un WIN/LOSS inventado.";
  }
  return "Aún sin toque de mecha 15M posterior al slot de apertura.";
}

export interface HistoryCardModel {
  episodeId: string;
  assetId: AssetId;
  direction: string;
  signalOpened: string;
  signalNow: string;
  timeframe: string;
  kind: string;
  openedStamp: string;
  closedStamp: string | null;
  entry: string;
  zone: string;
  sl: string;
  tp1: string;
  tp2: string | null;
  outcome: string;
  outcomeCls: string;
  wick: string;
  quality: string | null;
  rr: string | null;
  disclaimer: string;
}

export function historyCardModel(row: HistoryRow): HistoryCardModel {
  const ep = row.episode;
  const d = ASSETS.find((a) => a.id === ep.assetId)?.digits ?? 2;
  const oc = outcomeView(row);
  const entry = entryPrice(ep.direction, ep.zoneLow, ep.zoneHigh);
  const opened: SetupState = ep.openedState;
  const nowState: SetupState = ep.currentState;
  const q = ep.freeze?.quality ?? null;
  const rr = ep.freeze?.riskReward ?? null;
  return {
    episodeId: ep.episodeId,
    assetId: ep.assetId,
    direction: ep.direction === "buy" ? "COMPRA" : "VENTA",
    signalOpened: setupStateEs(opened),
    signalNow: setupStateEs(nowState),
    timeframe: timeframeLabel(row),
    kind: kindLabel(ep.kind),
    openedStamp: formatMadridStamp(ep.openedAtMs),
    closedStamp: ep.closedAtMs != null ? formatMadridStamp(ep.closedAtMs) : null,
    entry: formatPrice(entry, d),
    zone: `${formatPrice(ep.zoneLow, d)}–${formatPrice(ep.zoneHigh, d)}`,
    sl: formatPrice(ep.sl, d),
    tp1: formatPrice(ep.tp1, d),
    tp2: ep.tp2 != null ? formatPrice(ep.tp2, d) : null,
    outcome: oc.text,
    outcomeCls: oc.cls,
    wick: wickNote(row),
    quality: q,
    rr: rr != null && Number.isFinite(rr) ? rr.toFixed(2).replace(".", ",") : null,
    disclaimer: HISTORY_DISCLAIMER,
  };
}
