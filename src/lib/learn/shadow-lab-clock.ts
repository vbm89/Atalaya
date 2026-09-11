export const SHADOW_TRAIN_FRACTION = 0.7;
export const SHADOW_TRAIN_CUT_BASIS = "decisionSlot" as const;

function slotToMs(slotSec: number): number {
  return slotSec * 1000;
}

/** Chronological TRAIN/TEST cut on the decision clock, never on MAP birth. */
export function decisionCutMs(
  decisionTimesMs: readonly number[],
  trainFraction: number = SHADOW_TRAIN_FRACTION,
): number {
  const times = decisionTimesMs.filter((t) => Number.isFinite(t)).slice().sort((a, b) => a - b);
  if (!times.length) return Number.POSITIVE_INFINITY;
  const fraction = Math.min(0.99, Math.max(0.01, trainFraction));
  const idx = Math.min(times.length - 1, Math.max(0, Math.floor(times.length * fraction) - 1));
  return times[idx]!;
}

export function decisionTimesFromSlots(decisionSlots: readonly number[]): number[] {
  return decisionSlots.map(slotToMs);
}

export function isTrainDecision(decisionSlotSec: number, trainCutMs: number): boolean {
  return slotToMs(decisionSlotSec) <= trainCutMs;
}
