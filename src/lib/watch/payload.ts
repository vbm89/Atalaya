import type { AssetId, SetupState } from "../trading/types";
import { setupStateEs } from "./memory";
import { watchLinkPath } from "./link";
import type { EpisodeDraft } from "./episode";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  episodeId: string;
  assetId: AssetId;
  state: SetupState;
}

function dirLabel(direction: "buy" | "sell"): string {
  return direction === "sell" ? "SHORT" : "LONG";
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
  const dir = dirLabel(episode.direction);
  const zone = `${compact(episode.zoneLow)}–${compact(episode.zoneHigh)}`;
  const sl = compact(episode.sl);
  const tp1 = compact(episode.tp1);
  const pendingNote = to === "pending" ? " — no es orden" : "";
  return {
    title: `ATALAYA · ${episode.assetId}`,
    body: `${stateEs} ${dir}${pendingNote}\nZona ${zone}\nSL ${sl} · TP1 ${tp1}`,
    url: watchLinkPath(episode.assetId, episode.episodeId),
    episodeId: episode.episodeId,
    assetId: episode.assetId,
    state: to,
  };
}
