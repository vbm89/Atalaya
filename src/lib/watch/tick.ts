import type { AssetId, Candle } from "../trading/types";
import { foldEpisode, type FoldInput, type SignalEventDraft } from "./episode";
import { slotOpenSec, slotSecFromNow } from "./identity";
import { resolveOutcome } from "./outcome";
import { FEED_GRACE_MS } from "./schedule";
import type { WatchStore } from "./store";

export const FEED_RETRY_MS = 20_000;

export interface WatchLoad {
  assets: FoldInput[];
  m15ByAsset: Partial<Record<AssetId, Candle[]>>;
  errors: string[];
}

export type TickStatus = "ok" | "lag" | "failed" | "too_early" | "in_flight" | "duplicate" | "exhausted";

export interface TickResult {
  status: TickStatus;
  slot: number;
  retryAfterMs: number | null;
  durationMs: number;
  duplicate: boolean;
  error: string | null;
  assets: Array<{
    id: AssetId;
    state: FoldInput["setupState"];
    episodeId: string | null;
    events: number;
  }>;
  retryCount: number;
  pushed: number;
}

function emptyTick(
  status: TickStatus,
  slot: number,
  extra: Partial<TickResult> = {},
): TickResult {
  return {
    status,
    slot,
    retryAfterMs: extra.retryAfterMs ?? null,
    durationMs: extra.durationMs ?? 0,
    duplicate: extra.duplicate ?? false,
    error: extra.error ?? null,
    assets: extra.assets ?? [],
    retryCount: extra.retryCount ?? 0,
    pushed: extra.pushed ?? 0,
  };
}

export function m15CoversSlot(candles: Candle[] | undefined, slotSec: number): boolean {
  if (!candles || candles.length === 0) return false;
  const open = slotOpenSec(slotSec);
  return candles.some((c) => c.time === open);
}

/**
 * One 15M watch cycle. Caller supplies the analysis (same V1 via analyzeAsset
 * in production). Push is optional and server-only.
 */
export async function runWatchTick(args: {
  nowMs: number;
  store: WatchStore;
  load: () => Promise<WatchLoad>;
  notify?: (events: SignalEventDraft[]) => Promise<number>;
}): Promise<TickResult> {
  const started = Date.now();
  const slot = slotSecFromNow(args.nowMs);
  const readyAt = slot * 1000 + FEED_GRACE_MS;

  if (args.nowMs < readyAt) {
    return emptyTick("too_early", slot, {
      retryAfterMs: readyAt - args.nowMs,
    });
  }

  const claim = await args.store.claimEval(slot, args.nowMs);
  if (claim.kind === "duplicate") {
    return emptyTick("duplicate", slot, {
      duplicate: true,
      retryCount: claim.eval.retryCount,
      durationMs: claim.eval.durationMs ?? 0,
    });
  }
  if (claim.kind === "in_flight") {
    return emptyTick("in_flight", slot, { retryCount: claim.eval.retryCount });
  }
  if (claim.kind === "exhausted") {
    return emptyTick("exhausted", slot, {
      retryCount: claim.eval.retryCount,
      error: claim.eval.error,
    });
  }

  try {
    const loaded = await args.load();
    const btcBars = loaded.m15ByAsset.BTCUSD;
    if (!m15CoversSlot(btcBars, slot)) {
      const durationMs = Date.now() - started;
      const error = "LAG — vela 15M de BTCUSD aún no publicada para este slot.";
      await args.store.completeEval(slot, args.nowMs, "lag", error, durationMs, {
        errors: loaded.errors,
      });
      console.info("[watch] tick", {
        slot,
        status: "lag",
        durationMs,
        retryCount: claim.retryCount,
      });
      return emptyTick("lag", slot, {
        retryAfterMs: FEED_RETRY_MS,
        durationMs,
        error,
        retryCount: claim.retryCount,
      });
    }

    const assets: TickResult["assets"] = [];
    const notifyQueue: SignalEventDraft[] = [];
    for (const asset of loaded.assets) {
      const prev = await args.store.getOpenEpisode(asset.id);
      const folded = foldEpisode(prev, asset, slot, args.nowMs);
      if (folded.closePrevious) await args.store.upsertEpisode(folded.closePrevious);
      if (folded.episode && folded.episode !== folded.closePrevious) {
        await args.store.upsertEpisode(folded.episode);
      }
      const toResolve = [folded.closePrevious, folded.episode].filter(
        (ep, i, arr): ep is NonNullable<typeof ep> => ep != null && arr.indexOf(ep) === i,
      );
      for (const ep of toResolve) {
        const candles = loaded.m15ByAsset[asset.id] ?? [];
        const resolved = resolveOutcome({
          direction: ep.direction,
          sl: ep.sl,
          tp1: ep.tp1,
          tp2: ep.tp2,
          zoneLow: ep.zoneLow,
          zoneHigh: ep.zoneHigh,
          openedSlot: ep.openedSlot,
          closed: ep.closedAtMs != null,
          candles,
        });
        await args.store.upsertOutcome(ep.episodeId, args.nowMs, resolved);
      }
      let written = 0;
      for (const ev of folded.events) {
        await args.store.insertEvent(ev);
        written += 1;
        notifyQueue.push(ev);
      }
      await args.store.upsertSnapshot(folded.snapshot);
      assets.push({
        id: asset.id,
        state: folded.snapshot.state,
        episodeId: folded.snapshot.episodeId,
        events: written,
      });
    }

    let pushed = 0;
    if (args.notify) {
      try {
        pushed = await args.notify(notifyQueue);
      } catch (e) {
        console.info("[watch] notify failed", {
          error: e instanceof Error ? e.message : "error",
        });
      }
    }

    const durationMs = Date.now() - started;
    await args.store.completeEval(slot, args.nowMs, "ok", null, durationMs, {
      assets,
      errors: loaded.errors,
      pushed,
    });
    console.info("[watch] tick", {
      slot,
      status: "ok",
      durationMs,
      retryCount: claim.retryCount,
      assets: assets.map((a) => `${a.id}:${a.state}`),
      pushed,
      errors: loaded.errors,
    });
    return {
      status: "ok",
      slot,
      retryAfterMs: null,
      durationMs,
      duplicate: false,
      error: loaded.errors.length ? loaded.errors.join(" · ") : null,
      assets,
      retryCount: claim.retryCount,
      pushed,
    };
  } catch (e) {
    const durationMs = Date.now() - started;
    const error = e instanceof Error ? e.message : "error";
    await args.store.completeEval(slot, args.nowMs, "failed", error, durationMs, {});
    console.info("[watch] tick", { slot, status: "failed", durationMs, error });
    return emptyTick("failed", slot, {
      durationMs,
      error,
      retryAfterMs: FEED_RETRY_MS,
      retryCount: claim.retryCount,
    });
  }
}
