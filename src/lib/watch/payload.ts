import type { AssetId, SetupState } from "../trading/types";
import { setupStateEs } from "./memory";
import { watchLinkPath } from "./link";
import type { EpisodeDraft } from "./episode";
import { directionUi, displayEntryPrice } from "../chart/labels";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  episodeId: string;
  assetId: AssetId;
  state: SetupState;
}

function compact(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : 2;
  return n.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function buildPushPayload(episode: EpisodeDraft, to: SetupState): PushPayload {
  const stateEs = setupStateEs(to);
  const dir = directionUi(episode.direction);
  const entry = compact(displayEntryPrice(episode.direction, episode.zoneLow, episode.zoneHigh));
  const sl = compact(episode.sl);
  const tp1 = compact(episode.tp1);
  const pendingNote = to === "pending" ? " — no es orden" : "";
  return {
    title: `ATALAYA · ${episode.assetId}`,
    body: `${stateEs} ${dir}${pendingNote}\nENTRADA ${entry}\nSL ${sl} · TP1 ${tp1}`,
    url: watchLinkPath(episode.assetId, episode.episodeId),
    episodeId: episode.episodeId,
    assetId: episode.assetId,
    state: to,
  };
}

export function buildTestPushPayload(): PushPayload {
  return {
    title: "ATALAYA · prueba",
    body: "Registro correcto. PENDING y ENTRADA avisarán así. MAPA no.",
    url: "/",
    episodeId: "test",
    assetId: "XAUUSD",
    state: "pending",
  };
}
