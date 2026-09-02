import type { SetupState } from "../trading/types";

/**
 * Definitive push policy. Only a real V1 ENTRADA is pushable.
 * MAPA, PENDING / TRIGGER PENDIENTE and ESPERAR stay in the tray.
 */
export function shouldPushState(to: SetupState): boolean {
  return to === "entry";
}

export function pushEventKey(episodeId: string, slot: number, from: SetupState, to: SetupState): string {
  return `${episodeId}|${slot}|${from}|${to}`;
}
