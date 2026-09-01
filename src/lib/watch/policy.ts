import type { SetupState } from "../trading/types";

/** Default push policy. MAPA and ESPERAR are stored, never pushed. */
export function shouldPushState(to: SetupState): boolean {
  return to === "entry" || to === "pending";
}

export function pushEventKey(episodeId: string, slot: number, from: SetupState, to: SetupState): string {
  return `${episodeId}|${slot}|${from}|${to}`;
}
