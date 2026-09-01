import { TF_STEP_SEC } from "../trading/integrity";

/** Cadence the watch layer uses: the engine decides on closed 15M (H1/H4 close with it). */
export const WATCH_STEP_SEC = TF_STEP_SEC["15m"];
export const WATCH_STEP_MS = WATCH_STEP_SEC * 1000;

/** Wait for the provider to publish the just-closed kline. */
export const FEED_GRACE_MS = 8_000;

/** Cheap clock check while foregrounded — does not fetch by itself. */
export const ALIGN_MS = 15_000;

export function lastBarCloseMs(now: number, stepMs = WATCH_STEP_MS): number {
  return Math.floor(now / stepMs) * stepMs;
}

export function nextBarCloseMs(now: number, stepMs = WATCH_STEP_MS): number {
  return lastBarCloseMs(now, stepMs) + stepMs;
}

/** Instant the watch layer should run the engine after a 15M close. */
export function nextWatchEvalMs(
  now: number,
  graceMs = FEED_GRACE_MS,
  stepMs = WATCH_STEP_MS,
): number {
  const close = lastBarCloseMs(now, stepMs);
  const slot = close + graceMs;
  if (now < slot) return slot;
  return close + stepMs + graceMs;
}

/**
 * True when a 15M bar has closed, grace has elapsed, and we have not yet
 * evaluated for that close. Mount with no prior eval also returns true after grace.
 */
export function shouldEvalNow(
  now: number,
  lastEvalMs: number | null,
  graceMs = FEED_GRACE_MS,
  stepMs = WATCH_STEP_MS,
): boolean {
  const close = lastBarCloseMs(now, stepMs);
  const ready = close + graceMs;
  if (now < ready) return false;
  if (lastEvalMs == null) return true;
  return lastEvalMs < ready;
}

export function analysisCoversClose(
  generatedAtMs: number,
  now: number,
  graceMs = FEED_GRACE_MS,
  stepMs = WATCH_STEP_MS,
): boolean {
  const close = lastBarCloseMs(now, stepMs);
  const ready = close + graceMs;
  if (now < ready) {
    const prevReady = close - stepMs + graceMs;
    return generatedAtMs >= prevReady;
  }
  return generatedAtMs >= ready;
}

export function sleepUntilEvalMs(now: number, lastEvalMs: number | null): number {
  if (shouldEvalNow(now, lastEvalMs)) return 0;
  return Math.max(250, nextWatchEvalMs(now) - now);
}
