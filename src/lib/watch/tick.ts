import type { AssetId, CalendarEvent, Candle } from "../trading/types";
import { foldEpisode, type EpisodeDraft, type FoldInput, type SignalEventDraft } from "./episode";
import { slotOpenSec, slotSecFromNow } from "./identity";
import { resolveOutcome } from "./outcome";
import { computePostEntryMetrics, mergePostEntry, parsePostEntry, watchOutcomeOpenedSlot } from "./post-entry";
import { diagnoseBornFreeze, logCaptureIssues } from "./capture-issues";
import { FEED_GRACE_MS } from "./schedule";
import { entrySessionOpen } from "./market-session";
import { adaptWatchTarget, buildMomentumContinuation } from "./continuation";
import { assessSetupLevels, levelRejectWaitReason, type LevelRejectReason } from "./level-integrity";
import type { WatchStore } from "./store";

export const FEED_RETRY_MS = 20_000;

export interface WatchLoad {
  assets: FoldInput[];
  m15ByAsset: Partial<Record<AssetId, Candle[]>>;
  h1ByAsset?: Partial<Record<AssetId, Candle[]>>;
  h4ByAsset?: Partial<Record<AssetId, Candle[]>>;
  calendar?: CalendarEvent[];
  sourceByAsset?: Partial<Record<AssetId, string | null>>;
  instrumentByAsset?: Partial<Record<AssetId, string | null>>;
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
    waitReason: string | null;
    missingForEntry: string | null;
    direction: "buy" | "sell" | null;
    quality: string | null;
    riskReward: number | null;
  }>;
  retryCount: number;
  pushed: number;
  /** Append-only for this tick. Not written into signal events or past episodes. */
  rejections: EntryLevelRejection[];
}

export interface EntryLevelRejection {
  assetId: AssetId;
  slot: number;
  atMs: number;
  reason: LevelRejectReason;
  direction: "buy" | "sell" | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  instrument: string | null;
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
    rejections: extra.rejections ?? [],
  };
}

export function m15CoversSlot(candles: Candle[] | undefined, slotSec: number): boolean {
  if (!candles || candles.length === 0) return false;
  const open = slotOpenSec(slotSec);
  return candles.some((c) => c.time === open);
}

/**
 * Continuation and any other new Watch entry share this gate.
 * The underlying clock must be open for the whole just-closed 15M bar,
 * and that bar must be in the feed. A Sunday perp print is not an entry.
 */
export function mayOpenWatchContinuation(
  id: AssetId,
  nowMs: number,
  m15: Candle[] | undefined,
  slot: number,
): boolean {
  if (!m15CoversSlot(m15, slot)) return false;
  if (!(nowMs >= slot * 1000)) return false;
  return entrySessionOpen(id, nowMs, slotOpenSec(slot), slot);
}

/** Snapshot text for a blocked signal. Not an entry and not a V1 wait reason. */
export const CLOSED_ENTRY_BLOCK =
  "BLOQUEO — mercado cerrado o vela no válida. No es una entrada.";

async function safeRemember(
  fn: ((work: MemoryTickWork) => Promise<void>) | undefined,
  work: MemoryTickWork,
): Promise<void> {
  if (!fn) return;
  try {
    await fn(work);
  } catch (e) {
    console.info("[memory] persist failed", {
      error: e instanceof Error ? e.message : "error",
      slot: work.slot,
    });
  }
}

/**
 * One 15M watch cycle. Caller supplies the analysis (same V1 via analyzeAsset
 * in production). Push is optional and server-only.
 * `remember` is a sidecar (cinta/archivo/SHA). Failure never changes V1.
 */
export async function runWatchTick(args: {
  nowMs: number;
  store: WatchStore;
  load: () => Promise<WatchLoad>;
  notify?: (events: SignalEventDraft[]) => Promise<number>;
  remember?: (work: MemoryTickWork) => Promise<void>;
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
      await safeRemember(args.remember, {
        slot,
        nowMs: args.nowMs,
        loaded,
        born: [],
        touched: [],
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
    const rejections: EntryLevelRejection[] = [];
    const born: EpisodeDraft[] = [];
    const touched: EpisodeDraft[] = [];
    for (const asset of loaded.assets) {
      const bars = loaded.m15ByAsset[asset.id];
      const admits = mayOpenWatchContinuation(asset.id, args.nowMs, bars, slot);
      // Research overlay: adds a momentum-continuation entry without changing V1.
      // The function itself also refuses a closed session or a stale bar.
      let effectiveAsset = asset;
      if (asset.setupState !== "entry" && admits) {
        const continuation = buildMomentumContinuation({
          id: asset.id,
          m15: bars ?? [],
          h1: loaded.h1ByAsset?.[asset.id] ?? [],
          h4: loaded.h4ByAsset?.[asset.id] ?? [],
          nowMs: args.nowMs,
          basis: asset.freeze?.basis ?? null,
          digits: asset.digits,
        });
        if (continuation) {
          const tuned = adaptWatchTarget({
            setup: continuation,
            m15: bars ?? [],
            h1: loaded.h1ByAsset?.[asset.id] ?? [],
            h4: loaded.h4ByAsset?.[asset.id] ?? [],
            currentPrice: (bars ?? []).at(-1)?.close ?? continuation.zone.low,
            basis: asset.freeze?.basis ?? null,
            digits: asset.digits,
          });
          effectiveAsset = {
            ...asset,
            setupState: "entry",
            setup: tuned,
            waitReason: null,
            freeze: asset.freeze
              ? {
                  ...asset.freeze,
                  setupKind: tuned.kind,
                  setupState: "entry",
                  direction: tuned.direction,
                  riskReward: tuned.riskReward,
                  missingForEntry: null,
                }
              : null,
          };
        }
      }

      // Closed session or a bar that is not the one that just closed:
      // do not record an entry, do not close or rewrite an existing episode.
      if (effectiveAsset.setupState === "entry" && !admits) {
        const prev = await args.store.getOpenEpisode(asset.id);
        await args.store.upsertSnapshot({
          assetId: asset.id,
          state: "wait",
          setup: null,
          waitReason: CLOSED_ENTRY_BLOCK,
          evaluatedAtMs: args.nowMs,
          slot,
          episodeId: prev?.episodeId ?? null,
        });
        assets.push({
          id: asset.id,
          state: "wait",
          episodeId: prev?.episodeId ?? null,
          events: 0,
          waitReason: CLOSED_ENTRY_BLOCK,
          missingForEntry: null,
          direction: null,
          quality: null,
          riskReward: null,
        });
        console.info("[watch] entry blocked", { id: asset.id, slot });
        continue;
      }

      // Any real V1 entry also gets the same reachable-target audit. This
      // changes only TP1/TP2, never the protected entry/SL logic.
      if (effectiveAsset.setupState === "entry" && effectiveAsset.setup) {
        effectiveAsset = {
          ...effectiveAsset,
          setup: adaptWatchTarget({
            setup: effectiveAsset.setup,
            m15: loaded.m15ByAsset[asset.id] ?? [],
            h1: loaded.h1ByAsset?.[asset.id] ?? [],
            h4: loaded.h4ByAsset?.[asset.id] ?? [],
            currentPrice: (loaded.m15ByAsset[asset.id] ?? []).at(-1)?.close ?? effectiveAsset.setup.zone.low,
            basis: asset.freeze?.basis ?? null,
            digits: asset.digits,
          }),
        };
      }

      if (effectiveAsset.setupState === "entry" && effectiveAsset.setup) {
        const verdict = assessSetupLevels(effectiveAsset.setup, effectiveAsset.digits);
        if (!verdict.ok && verdict.reason) {
          const setup = effectiveAsset.setup;
          const rejection: EntryLevelRejection = {
            assetId: asset.id,
            slot,
            atMs: args.nowMs,
            reason: verdict.reason,
            direction: setup.direction,
            entry: setup.direction === "sell" ? setup.zone.low : setup.zone.high,
            stop: setup.stopLoss,
            target: setup.takeProfit1,
            instrument: loaded.instrumentByAsset?.[asset.id] ?? null,
          };
          rejections.push(rejection);
          console.info("[watch] entry rejected", rejection);
          const prev = await args.store.getOpenEpisode(asset.id);
          const waitReason = levelRejectWaitReason(verdict.reason);
          await args.store.upsertSnapshot({
            assetId: asset.id,
            state: "wait",
            setup: null,
            waitReason,
            evaluatedAtMs: args.nowMs,
            slot,
            episodeId: prev?.episodeId ?? null,
          });
          assets.push({
            id: asset.id,
            state: "wait",
            episodeId: prev?.episodeId ?? null,
            events: 0,
            waitReason,
            missingForEntry: null,
            direction: null,
            quality: null,
            riskReward: null,
          });
          continue;
        }
      }

      const prev = await args.store.getOpenEpisode(effectiveAsset.id);
      const folded = foldEpisode(prev, effectiveAsset, slot, args.nowMs);
      if (folded.closePrevious) await args.store.upsertEpisode(folded.closePrevious);
      if (folded.episode && folded.episode !== folded.closePrevious) {
        await args.store.upsertEpisode(folded.episode);
      }
      const toResolve = [folded.closePrevious, folded.episode].filter(
        (ep, i, arr): ep is NonNullable<typeof ep> => ep != null && arr.indexOf(ep) === i,
      );
      for (const ep of toResolve) {
        const candles = loaded.m15ByAsset[asset.id] ?? [];
        const priorDetails = await args.store.getOutcomeDetails(ep.episodeId);
        const entryEv =
          folded.events.find((e) => e.episodeId === ep.episodeId && e.toState === "entry") ??
          (await args.store.findEntryEvent(ep.episodeId));
        const resolved = resolveOutcome({
          direction: ep.direction,
          sl: ep.sl,
          tp1: ep.tp1,
          tp2: ep.tp2,
          zoneLow: ep.zoneLow,
          zoneHigh: ep.zoneHigh,
          openedSlot: watchOutcomeOpenedSlot(ep.openedSlot, entryEv?.slot),
          closed: ep.closedAtMs != null,
          candles,
        });
        await args.store.upsertOutcome(ep.episodeId, args.nowMs, resolved);
        if (entryEv) {
          const computed = computePostEntryMetrics(ep, entryEv, candles);
          const postEntry = mergePostEntry(parsePostEntry(priorDetails?.postEntry), computed);
          await args.store.patchOutcomeDetails(ep.episodeId, { postEntry });
        }
      }
      let written = 0;
      for (const ev of folded.events) {
        const inserted = await args.store.insertEvent(ev);
        if (!inserted) continue;
        written += 1;
        notifyQueue.push(ev);
      }
      await args.store.upsertSnapshot(folded.snapshot);
      if (folded.closePrevious) touched.push(folded.closePrevious);
      if (folded.episode) {
        touched.push(folded.episode);
        const isBirth = folded.events.some((e) => e.fromState === "wait" && e.toState !== "wait");
        if (isBirth) born.push(folded.episode);
      }
      assets.push({
        id: asset.id,
        state: folded.snapshot.state,
        episodeId: folded.snapshot.episodeId,
        events: written,
        waitReason: asset.waitReason ?? null,
        missingForEntry: asset.freeze?.missingForEntry ?? null,
        direction: asset.setup?.direction ?? asset.freeze?.direction ?? null,
        quality: asset.setup?.quality ?? asset.freeze?.quality ?? null,
        riskReward: asset.setup?.riskReward ?? asset.freeze?.riskReward ?? null,
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
      rejections,
    });
    await safeRemember(args.remember, {
      slot,
      nowMs: args.nowMs,
      loaded,
      born,
      touched,
    });
    logCaptureIssues(diagnoseBornFreeze(born));
    console.info("[watch] tick", {
      slot,
      status: "ok",
      durationMs,
      retryCount: claim.retryCount,
      assets: assets.map((a) => ({
        id: a.id,
        state: a.state,
        waitReason: a.waitReason,
        missingForEntry: a.missingForEntry,
        direction: a.direction,
        quality: a.quality,
        riskReward: a.riskReward,
      })),
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
      rejections,
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
