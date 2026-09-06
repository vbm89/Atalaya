import { formatPrice } from "../utils";
import { ASSETS } from "../trading/assets";
import type { AssetId, SetupState } from "../trading/types";
import { displayEntryPrice } from "../chart/labels";
import { analysisDisclaimer } from "../broker/broker-view";
import { formatMadridStamp } from "./clock";
import { setupStateEs } from "./memory";
import { setupBadgeLabel } from "./market-session";
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
  const entered = row.hadV1Entry === true;
  switch (row.outcome) {
    case "tp1":
      return entered
        ? { text: "TP1", cls: "text-buy" }
        : { text: "toque técnico TP1", cls: "text-muted" };
    case "tp2":
      return entered
        ? { text: "TP2", cls: "text-buy" }
        : { text: "toque técnico TP2", cls: "text-muted" };
    case "sl":
      return entered
        ? { text: "SL", cls: "text-sell" }
        : { text: "toque técnico SL", cls: "text-muted" };
    case "expired":
      return { text: "EXPIRADA", cls: "text-muted" };
    default:
      break;
  }
  const state = row.episode.currentState;
  if (row.episode.closedAtMs == null && state !== "wait") {
    if (state === "entry") return { text: "ENTRY", cls: "text-buy" };
    if (state === "pending") return { text: "PENDING", cls: "text-wait" };
    if (state === "map") return { text: "MAPA", cls: "text-map" };
  }
  return { text: "RESULTADO PENDIENTE", cls: "text-subtle" };
}

export function setupWithoutEntryLabel(row: HistoryRow): string | null {
  if (row.hadV1Entry === true) return null;
  if (row.outcome === "sl") return "Setup sin ENTRADA V1 — toque técnico SL";
  if (row.outcome === "tp1") return "Setup sin ENTRADA V1 — toque técnico TP1";
  if (row.outcome === "tp2") return "Setup sin ENTRADA V1 — toque técnico TP2";
  return "Setup sin ENTRADA V1. MAPA y PENDING no son operaciones.";
}

export function historyBuckets(rows: readonly HistoryRow[]): {
  operations: HistoryRow[];
  setups: HistoryRow[];
} {
  return {
    operations: rows.filter((r) => r.hadV1Entry === true),
    setups: rows.filter((r) => r.hadV1Entry !== true),
  };
}

export function wickNote(row: HistoryRow): string {
  const touch = row.firstTouch;
  if (touch === "sl" || touch === "tp1" || touch === "tp2") {
    const when =
      row.firstTouchAtMs != null ? formatMadridStamp(row.firstTouchAtMs) : "hora no registrada";
    const what = touch === "sl" ? "SL" : touch === "tp1" ? "TP1" : "TP2";
    if (row.hadV1Entry === false) {
      return `Mecha 15M tocó ${what} · ${when} (Madrid). No hubo ENTRADA V1: no es una operación.`;
    }
    return `Mecha 15M tocó ${what} · ${when} (Madrid). Primer toque. Misma vela: gana SL.`;
  }
  if (row.outcome === "expired") {
    return "Cerrada sin toque de SL ni TP. No es un WIN/LOSS inventado.";
  }
  if (row.hadV1Entry === false) {
    return "Episodio sin ENTRADA V1. MAPA y PENDING no son operaciones.";
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
  episodeState: string;
  hadV1Entry: boolean;
  entryV1Label: "SÍ" | "NO";
  setupCaption: string | null;
  isTradeOutcome: boolean;
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
    disclaimer: `${HISTORY_DISCLAIMER} · ${analysisDisclaimer(ep.assetId).replace(/\n/g, " ")}`,
    episodeState: setupBadgeLabel(nowState === "wait" ? opened : nowState),
    hadV1Entry: row.hadV1Entry === true,
    entryV1Label: row.hadV1Entry === true ? "SÍ" : "NO",
    setupCaption: setupWithoutEntryLabel(row),
    isTradeOutcome: row.hadV1Entry === true && (row.outcome === "tp1" || row.outcome === "tp2" || row.outcome === "sl" || row.outcome === "expired"),
  };
}
