import type { AssetId, AssetAnalysis, SetupProposal, SetupState } from "../trading/types";
import { formatPrice } from "../utils";
import { displayEntryPrice } from "../chart/labels";
import { analysisDisclaimer } from "../broker/broker-view";
import { assetDataLamp, type DataLamp } from "./feed-lamp";
import { inboxStateLabel } from "./inbox";
import type { EpisodeDraft } from "./episode";

const SECRET_RE =
  /WATCH_SECRET|VAPID|DATABASE_URL|API[_-]?KEY|PRIVATE[_-]?KEY|BEGIN [A-Z ]+PRIVATE/i;

const ASSET_IDS: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];

export interface ShareCardInput {
  assetId: string;
  state: SetupState;
  direction: "buy" | "sell" | null;
  zoneLow: number | null;
  zoneHigh: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  riskReward: number | null;
  digits: number;
  instrumentKind: "proxy" | "native" | string | null;
  feedSymbol: string | null;
  dataLamp: { lamp: DataLamp; label: string };
  waitReason: string | null;
}

function lampMark(lamp: DataLamp): string {
  if (lamp === "ok") return "DATOS OK";
  if (lamp === "delayed") return "DATOS RETRASADOS";
  return "DATOS NO DISPONIBLES";
}

function asAssetId(id: string): AssetId | null {
  return ASSET_IDS.includes(id as AssetId) ? (id as AssetId) : null;
}

export function formatShareCard(input: ShareCardInput): string {
  const lines = ["ATALAYA", input.assetId, inboxStateLabel(input.state)];
  if (input.direction === "buy") lines.push("COMPRA");
  if (input.direction === "sell") lines.push("VENTA");
  const d = input.digits;
  if (input.direction && input.zoneLow != null && input.zoneHigh != null) {
    const entry = displayEntryPrice(input.direction, input.zoneLow, input.zoneHigh);
    lines.push(`ENTRADA V1: ${formatPrice(entry, d)}`);
  }
  if (input.sl != null) lines.push(`SL de análisis: ${formatPrice(input.sl, d)}`);
  if (input.tp1 != null) lines.push(`TP1: ${formatPrice(input.tp1, d)}`);
  if (input.tp2 != null) lines.push(`TP2: ${formatPrice(input.tp2, d)}`);
  if (input.riskReward != null && Number.isFinite(input.riskReward)) {
    lines.push(`R:R: 1 : ${input.riskReward.toFixed(1)}`);
  }
  if (!input.direction) {
    lines.push(input.waitReason ?? "Sin setup");
  }
  lines.push(`Estado de datos: ${lampMark(input.dataLamp.lamp)}`);
  const id = asAssetId(input.assetId);
  const fuente =
    input.instrumentKind === "proxy"
      ? `PROXY${input.feedSymbol ? ` · ${input.feedSymbol}` : ""}`
      : input.instrumentKind === "native"
        ? "NATIVO"
        : input.feedSymbol ?? "n/d";
  lines.push(`Proxy/fuente: ${fuente}`);
  if (id) lines.push(analysisDisclaimer(id).replace(/\n/g, " "));
  lines.push("ANÁLISIS — NO ES UNA ORDEN");
  const text = lines.join("\n");
  if (SECRET_RE.test(text)) {
    return "ATALAYA\nANÁLISIS — NO ES UNA ORDEN";
  }
  return text;
}

export function setupShareText(asset: AssetAnalysis): string {
  const s: SetupProposal | null = asset.setup;
  const lamp = assetDataLamp({
    dataStatus: asset.dataStatus,
    dataStatusLabel: asset.dataStatusLabel,
    lastDataAt: asset.lastDataAt,
    price: asset.id === "XAUUSD" ? asset.priceSpot : asset.price,
  });
  return formatShareCard({
    assetId: asset.id,
    state: asset.setupState !== "wait" ? asset.setupState : (s?.state ?? "wait"),
    direction: s?.direction ?? null,
    zoneLow: s?.zone.low ?? null,
    zoneHigh: s?.zone.high ?? null,
    sl: s?.stopLoss ?? null,
    tp1: s?.takeProfit1 ?? null,
    tp2: s?.takeProfit2 ?? null,
    riskReward: s?.riskReward ?? null,
    digits: asset.digits,
    instrumentKind: asset.instrumentKind,
    feedSymbol: asset.feedSymbol ?? null,
    dataLamp: lamp,
    waitReason: asset.waitReason,
  });
}

/** Frozen episode levels only. Does not re-run V1. */
export function episodeShareText(
  ep: EpisodeDraft,
  digits: number,
  dataLamp?: { lamp: DataLamp; label: string },
): string {
  const lamp = dataLamp ?? { lamp: "ok" as const, label: "DATOS OK" };
  const live = ep.closedAtMs == null && ep.currentState !== "wait";
  return formatShareCard({
    assetId: ep.assetId,
    state: live ? ep.currentState : ep.openedState,
    direction: ep.direction,
    zoneLow: ep.zoneLow,
    zoneHigh: ep.zoneHigh,
    sl: ep.sl,
    tp1: ep.tp1,
    tp2: ep.tp2,
    riskReward: ep.freeze?.riskReward ?? null,
    digits,
    instrumentKind: ep.freeze?.instrumentKind ?? null,
    feedSymbol: ep.freeze?.feedSymbol ?? null,
    dataLamp: lamp,
    waitReason: live ? null : "Esta señal ya no está vigente.",
  });
}

export function shareContainsSecrets(text: string): boolean {
  return SECRET_RE.test(text);
}
