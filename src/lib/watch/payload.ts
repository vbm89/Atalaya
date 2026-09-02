import type { AssetId, SetupState } from "../trading/types";
import { getAsset } from "../trading/assets";
import { formatPrice } from "../utils";
import { watchLinkPath } from "./link";
import type { EpisodeDraft } from "./episode";
import { directionUi, displayEntryPrice } from "../chart/labels";
import { pushInstrumentLine } from "../broker/broker-view";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  episodeId: string;
  assetId: AssetId;
  state: SetupState;
}

export function buildPushPayload(episode: EpisodeDraft, to: SetupState): PushPayload {
  const dir = directionUi(episode.direction);
  const d = getAsset(episode.assetId).digits;
  const entry = formatPrice(
    displayEntryPrice(episode.direction, episode.zoneLow, episode.zoneHigh),
    d,
  );
  const sl = formatPrice(episode.sl, d);
  const tp1 = formatPrice(episode.tp1, d);
  const lines = [
    pushInstrumentLine(episode.assetId, dir),
    `Entrada de análisis: ${entry}`,
    `SL de análisis: ${sl}`,
    `TP1: ${tp1}`,
  ];
  if (episode.tp2 != null) lines.push(`TP2: ${formatPrice(episode.tp2, d)}`);
  lines.push("NO ES PRECIO DE EJECUCIÓN T4TRADE");
  return {
    title: `ATALAYA · ${episode.assetId} · ENTRADA V1`,
    body: lines.join("\n"),
    url: watchLinkPath(episode.assetId, episode.episodeId),
    episodeId: episode.episodeId,
    assetId: episode.assetId,
    state: to,
  };
}

export function buildTestPushPayload(): PushPayload {
  return {
    title: "ATALAYA · prueba",
    body: "Registro correcto. Solo ENTRADA avisará así. MAPA, PENDING y ESPERAR no.",
    url: "/",
    episodeId: "test",
    assetId: "XAUUSD",
    state: "entry",
  };
}
