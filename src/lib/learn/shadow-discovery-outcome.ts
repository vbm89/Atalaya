import { barCloseOf } from "./shadow-discovery-clock";
import { DISCOVERY_OUTCOME_HORIZON_BARS, type DiscoveryBar, type DiscoveryEvent, type DiscoveryOutcome } from "./shadow-discovery-types";

/**
 * Outcome is computed AFTER the detector. Horizon is a laboratory constant.
 * Missing costs stay UNKNOWN (netR = null). Never 0.
 */
export function outcomeAfterEvent(
  event: DiscoveryEvent,
  bars: readonly DiscoveryBar[],
  horizonBars = DISCOVERY_OUTCOME_HORIZON_BARS,
): DiscoveryOutcome {
  const after = bars
    .filter((b) => b.assetId === event.assetId && b.tf === event.tf && barCloseOf(b) > event.closeT)
    .sort((a, b) => a.t - b.t)
    .slice(0, horizonBars);
  const atr = event.atr;
  if (!after.length || atr == null || atr <= 0) {
    return {
      eventId: event.id,
      horizonBars,
      barsAvailable: after.length,
      mfeAtr: null,
      maeAtr: null,
      closeReturnAtr: null,
      netR: null,
      costKnown: false,
    };
  }
  const entry = event.level ?? after[0]!.o;
  const dir = event.direction === "sell" ? -1 : 1;
  let mfe = 0;
  let mae = 0;
  for (const b of after) {
    const fav = dir === 1 ? b.h - entry : entry - b.l;
    const adv = dir === 1 ? entry - b.l : b.h - entry;
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;
  }
  const last = after[after.length - 1]!;
  const closeMove = dir === 1 ? last.c - entry : entry - last.c;
  return {
    eventId: event.id,
    horizonBars,
    barsAvailable: after.length,
    mfeAtr: mfe / atr,
    maeAtr: mae / atr,
    closeReturnAtr: closeMove / atr,
    netR: null,
    costKnown: false,
  };
}
