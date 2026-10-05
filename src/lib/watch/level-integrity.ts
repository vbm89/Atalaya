import type { SetupProposal } from "../trading/types";

/**
 * Watch-only gate. It does not choose a stop, a target, or a pad.
 * A level that fails here is not an entry.
 */
export type LevelRejectReason =
  | "non-finite"
  | "risk-not-positive"
  | "stop-wrong-side"
  | "target-wrong-side"
  | "anchor-wrong-side"
  | "rounded-order"
  | "instrument";

export interface LevelVerdict {
  ok: boolean;
  reason: LevelRejectReason | null;
}

export interface ExecutableLevels {
  direction: "buy" | "sell";
  entry: number;
  stop: number;
  target: number;
  digits: number;
  /** Structural price before the pad. Absent when the publisher does not have one. */
  anchor?: number | null;
  /** Quote convention of these three prices, when known. */
  instrument?: string | null;
  /** Instrument the signal is allowed to use. Null skips the check. */
  referenceInstrument?: string | null;
}

const OK: LevelVerdict = { ok: true, reason: null };

function finite(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

function roundPrice(n: number, digits: number): number | null {
  if (!finite(n) || !Number.isInteger(digits) || digits < 0 || digits > 8) return null;
  return Number(n.toFixed(digits));
}

function stopAdverse(direction: "buy" | "sell", entry: number, stop: number): boolean {
  return direction === "buy" ? stop < entry : stop > entry;
}

function targetFavorable(direction: "buy" | "sell", entry: number, target: number): boolean {
  return direction === "buy" ? target > entry : target < entry;
}

function anchorAdverse(direction: "buy" | "sell", entry: number, anchor: number): boolean {
  return direction === "buy" ? anchor < entry : anchor > entry;
}

/**
 * Same shift on every level. A constant basis cannot invent distance.
 * Returns null when the basis itself is not a finite number.
 */
export function shiftLevels<T extends { entry: number; stop: number; target: number; anchor?: number | null }>(
  levels: T,
  basis: number,
): T | null {
  if (!finite(basis)) return null;
  const move = (n: number) => n - basis;
  return {
    ...levels,
    entry: move(levels.entry),
    stop: move(levels.stop),
    target: move(levels.target),
    anchor: levels.anchor == null ? levels.anchor : move(levels.anchor),
  };
}

export function assessExecutableLevels(levels: ExecutableLevels): LevelVerdict {
  const { direction, entry, stop, target, digits } = levels;
  if (!finite(entry) || !finite(stop) || !finite(target)) return { ok: false, reason: "non-finite" };
  if (levels.anchor != null && !finite(levels.anchor)) return { ok: false, reason: "non-finite" };

  const quote = levels.instrument?.trim() || null;
  const reference = levels.referenceInstrument?.trim() || null;
  if (quote && reference && quote !== reference) return { ok: false, reason: "instrument" };

  if (levels.anchor != null && !anchorAdverse(direction, entry, levels.anchor)) {
    return { ok: false, reason: "anchor-wrong-side" };
  }
  if (stop === entry || target === entry) return { ok: false, reason: "risk-not-positive" };
  if (!stopAdverse(direction, entry, stop)) return { ok: false, reason: "stop-wrong-side" };
  if (!targetFavorable(direction, entry, target)) return { ok: false, reason: "target-wrong-side" };

  const rounded = {
    entry: roundPrice(entry, digits),
    stop: roundPrice(stop, digits),
    target: roundPrice(target, digits),
  };
  if (rounded.entry == null || rounded.stop == null || rounded.target == null) {
    return { ok: false, reason: "non-finite" };
  }
  if (rounded.stop === rounded.entry || rounded.target === rounded.entry) {
    return { ok: false, reason: "rounded-order" };
  }
  if (!stopAdverse(direction, rounded.entry, rounded.stop) || !targetFavorable(direction, rounded.entry, rounded.target)) {
    return { ok: false, reason: "rounded-order" };
  }
  return OK;
}

/**
 * Pad is added only after the anchor is already on the adverse side of the entry.
 * A pad must not drag a wrong-side swing across the price.
 */
export function stopFromStructuralAnchor(args: {
  direction: "buy" | "sell";
  entry: number;
  anchor: number;
  pad: number;
}): { ok: true; stop: number } | { ok: false; reason: LevelRejectReason } {
  if (!finite(args.entry) || !finite(args.anchor) || !finite(args.pad)) {
    return { ok: false, reason: "non-finite" };
  }
  if (!anchorAdverse(args.direction, args.entry, args.anchor)) {
    return { ok: false, reason: "anchor-wrong-side" };
  }
  if (!(args.pad >= 0)) return { ok: false, reason: "risk-not-positive" };
  const stop = args.direction === "sell" ? args.anchor + args.pad : args.anchor - args.pad;
  if (!stopAdverse(args.direction, args.entry, stop)) {
    return { ok: false, reason: "stop-wrong-side" };
  }
  return { ok: true, stop };
}

export function entryPrice(setup: SetupProposal): number {
  return setup.direction === "sell" ? setup.zone.low : setup.zone.high;
}

export function assessSetupLevels(
  setup: SetupProposal,
  digits: number,
  instrument?: { instrument?: string | null; referenceInstrument?: string | null },
): LevelVerdict {
  return assessExecutableLevels({
    direction: setup.direction,
    entry: entryPrice(setup),
    stop: setup.stopLoss,
    target: setup.takeProfit1,
    digits,
    instrument: instrument?.instrument ?? null,
    referenceInstrument: instrument?.referenceInstrument ?? null,
  });
}

export function levelRejectWaitReason(reason: LevelRejectReason): string {
  return `BLOQUEO — niveles inválidos (${reason}). No es una entrada.`;
}
