import type { AssetId, SetupProposal, SetupState } from "../trading/types";
import type { EpisodeFreeze } from "./freeze";
import { episodeId, isLiveState, levelsKey, sameOpportunity } from "./identity";

export interface EpisodeDraft {
  episodeId: string;
  assetId: AssetId;
  direction: "buy" | "sell";
  kind: string;
  zoneLow: number;
  zoneHigh: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  openedAtMs: number;
  openedState: SetupState;
  currentState: SetupState;
  closedAtMs: number | null;
  levelsKey: string;
  openedSlot: number;
  freeze: EpisodeFreeze | null;
}

export interface SignalEventDraft {
  episodeId: string;
  fromState: SetupState;
  toState: SetupState;
  atMs: number;
  slot: number;
  notified: false;
}

export interface SnapshotDraft {
  assetId: AssetId;
  state: SetupState;
  setup: SetupProposal | null;
  waitReason: string | null;
  evaluatedAtMs: number;
  slot: number;
  episodeId: string | null;
  /** Episode open wall clock. Copied from signal_episodes.opened_at — not invented. */
  openedAtMs?: number | null;
  closedAtMs?: number | null;
}

export interface FoldInput {
  id: AssetId;
  setupState: SetupState;
  setup: SetupProposal | null;
  waitReason: string | null;
  digits: number;
  freeze?: EpisodeFreeze | null;
}

export interface FoldResult {
  episode: EpisodeDraft | null;
  closePrevious: EpisodeDraft | null;
  events: SignalEventDraft[];
  snapshot: SnapshotDraft;
}

function draftFromSetup(
  assetId: AssetId,
  setup: SetupProposal,
  state: SetupState,
  key: string,
  slot: number,
  nowMs: number,
  freeze: EpisodeFreeze | null,
): EpisodeDraft {
  return {
    episodeId: episodeId(assetId, slot, key),
    assetId,
    direction: setup.direction,
    kind: setup.kind,
    zoneLow: setup.zone.low,
    zoneHigh: setup.zone.high,
    sl: setup.stopLoss,
    tp1: setup.takeProfit1,
    tp2: setup.takeProfit2,
    openedAtMs: nowMs,
    openedState: state,
    currentState: state,
    closedAtMs: null,
    levelsKey: key,
    openedSlot: slot,
    freeze,
  };
}

function event(
  episodeIdValue: string,
  from: SetupState,
  to: SetupState,
  slot: number,
  nowMs: number,
): SignalEventDraft {
  return {
    episodeId: episodeIdValue,
    fromState: from,
    toState: to,
    atMs: nowMs,
    slot,
    notified: false,
  };
}

/**
 * Pure identity layer. The engine stays stateless; this assigns episode_id
 * and records transitions. Does not invent setups.
 */
export function foldEpisode(
  prev: EpisodeDraft | null,
  asset: FoldInput,
  slot: number,
  nowMs: number,
): FoldResult {
  const to = asset.setupState;
  const setup = asset.setup;
  const live = isLiveState(to) && setup != null;
  const key = live && setup ? levelsKey(setup, asset.digits) : null;
  const freeze = asset.freeze ?? null;

  const snapshotBase = {
    assetId: asset.id,
    waitReason: asset.waitReason,
    evaluatedAtMs: nowMs,
    slot,
  };

  if (live && setup && key) {
    const same = prev != null && prev.closedAtMs == null && sameOpportunity(prev, setup, asset.digits);
    if (same && prev) {
      const events: SignalEventDraft[] = [];
      if (prev.currentState !== to) {
        events.push(event(prev.episodeId, prev.currentState, to, slot, nowMs));
      }
      const episode: EpisodeDraft = { ...prev, currentState: to };
      return {
        episode,
        closePrevious: null,
        events,
        snapshot: { ...snapshotBase, state: to, setup, episodeId: episode.episodeId },
      };
    }

    const events: SignalEventDraft[] = [];
    let closePrevious: EpisodeDraft | null = null;
    if (prev && prev.closedAtMs == null) {
      closePrevious = { ...prev, currentState: "wait", closedAtMs: nowMs };
      events.push(event(prev.episodeId, prev.currentState, "wait", slot, nowMs));
    }
    const born = draftFromSetup(asset.id, setup, to, key, slot, nowMs, freeze);
    events.push(event(born.episodeId, "wait", to, slot, nowMs));
    return {
      episode: born,
      closePrevious,
      events,
      snapshot: { ...snapshotBase, state: to, setup, episodeId: born.episodeId },
    };
  }

  if (prev && prev.closedAtMs == null) {
    const closed: EpisodeDraft = { ...prev, currentState: "wait", closedAtMs: nowMs };
    return {
      episode: closed,
      closePrevious: closed,
      events: [event(prev.episodeId, prev.currentState, "wait", slot, nowMs)],
      snapshot: {
        ...snapshotBase,
        state: "wait",
        setup: null,
        episodeId: prev.episodeId,
      },
    };
  }

  return {
    episode: prev,
    closePrevious: null,
    events: [],
    snapshot: {
      ...snapshotBase,
      state: "wait",
      setup: null,
      episodeId: prev?.episodeId ?? null,
    },
  };
}
