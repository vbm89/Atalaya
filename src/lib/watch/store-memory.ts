import type { AssetId, SetupProposal, SetupState } from "../trading/types";
import type { EpisodeDraft, SignalEventDraft, SnapshotDraft } from "./episode";
import type { InboxItem } from "./inbox";
import { DEFAULT_PUSH_PREFS, parsePushPrefs, type PushPrefs } from "./push-prefs";
import type { OutcomeResult } from "./outcome";
import {
  MAX_LAG_RETRIES,
  MAX_NOTIFY_ATTEMPTS,
  NOTIFY_CLAIM_STALE_MS,
  STALE_PENDING_MS,
  type Claim,
  type EvalRow,
  type EvalStatus,
  type HistoryRow,
  type PushSubRow,
  type WatchStore,
} from "./store";

interface EventRec {
  episodeId: string;
  fromState: SetupState;
  toState: SetupState;
  atMs: number;
  slot: number;
  notified: boolean;
  notifyStatus: "pending" | "claimed" | "failed" | "sent";
  notifyAttempts: number;
  notifyClaimedAt: number | null;
  notifyLastError: string | null;
}

interface OutcomeRec {
  outcome: string;
  firstTouch: string | null;
  firstTouchAtMs: number | null;
  mfe: number | null;
  mae: number | null;
}

function eventKey(episodeId: string, slot: number, from: SetupState, to: SetupState): string {
  return `${episodeId}|${slot}|${from}|${to}`;
}

export function createMemoryStore(): WatchStore {
  const evals = new Map<number, EvalRow>();
  const episodes = new Map<string, EpisodeDraft>();
  const events = new Map<string, EventRec>();
  const snapshots = new Map<AssetId, SnapshotDraft>();
  const outcomes = new Map<string, OutcomeRec>();
  const subs = new Map<string, PushSubRow & { disabled: boolean }>();
  let pinHash: string | null = null;
  let prefs: PushPrefs = { ...DEFAULT_PUSH_PREFS };

  return {
    async claimEval(slot, nowMs) {
      const existing = evals.get(slot);
      if (!existing) {
        const row: EvalRow = {
          slot,
          startedAtMs: nowMs,
          ranAtMs: nowMs,
          status: "pending",
          error: null,
          durationMs: null,
          retryCount: 0,
          assets: [],
        };
        evals.set(slot, row);
        return { kind: "acquired", retryCount: 0 } satisfies Claim;
      }
      if (existing.status === "ok") return { kind: "duplicate", eval: existing };
      const canRetry =
        (existing.status === "lag" || existing.status === "failed") &&
        existing.retryCount < MAX_LAG_RETRIES;
      const stalePending =
        existing.status === "pending" && nowMs - existing.startedAtMs > STALE_PENDING_MS;
      if (canRetry || stalePending) {
        const next: EvalRow = {
          ...existing,
          status: "pending",
          startedAtMs: nowMs,
          ranAtMs: nowMs,
          retryCount: existing.retryCount + 1,
          error: null,
        };
        evals.set(slot, next);
        return { kind: "acquired", retryCount: next.retryCount };
      }
      if (existing.status === "pending") return { kind: "in_flight", eval: existing };
      return { kind: "exhausted", eval: existing };
    },

    async completeEval(slot, nowMs, status, error, durationMs, assets) {
      const prev = evals.get(slot);
      evals.set(slot, {
        slot,
        startedAtMs: prev?.startedAtMs ?? nowMs,
        ranAtMs: nowMs,
        status: status as EvalStatus,
        error,
        durationMs,
        retryCount: prev?.retryCount ?? 0,
        assets,
      });
    },

    async getEval(slot) {
      return evals.get(slot) ?? null;
    },

    async lastCompletedEval() {
      const rows = [...evals.values()]
        .filter((e) => e.status === "ok" || e.status === "failed" || e.status === "lag")
        .sort((a, b) => b.slot - a.slot);
      return rows[0] ?? null;
    },

    async lastOkEval() {
      const rows = [...evals.values()].filter((e) => e.status === "ok").sort((a, b) => b.slot - a.slot);
      return rows[0] ?? null;
    },

    async getEpisode(episodeId) {
      return episodes.get(episodeId) ?? null;
    },

    async getOpenEpisode(assetId) {
      for (const ep of episodes.values()) {
        if (ep.assetId === assetId && ep.closedAtMs == null) return ep;
      }
      return null;
    },

    async upsertEpisode(row) {
      const prev = episodes.get(row.episodeId);
      if (!prev) {
        episodes.set(row.episodeId, { ...row });
        return;
      }
      episodes.set(row.episodeId, {
        ...prev,
        currentState: row.currentState,
        closedAtMs: row.closedAtMs,
      });
    },

    async insertEvent(row) {
      const k = eventKey(row.episodeId, row.slot, row.fromState, row.toState);
      if (events.has(k)) return false;
      events.set(k, {
        ...row,
        notified: false,
        notifyStatus: "pending",
        notifyAttempts: 0,
        notifyClaimedAt: null,
        notifyLastError: null,
      });
      return true;
    },

    async claimNotify(episodeId, slot, fromState, toState, nowMs) {
      const k = eventKey(episodeId, slot, fromState, toState);
      const ev = events.get(k);
      if (!ev || ev.notified) return false;
      if (ev.notifyAttempts >= MAX_NOTIFY_ATTEMPTS) return false;
      const staleClaimed =
        ev.notifyStatus === "claimed" &&
        ev.notifyClaimedAt != null &&
        nowMs - ev.notifyClaimedAt > NOTIFY_CLAIM_STALE_MS;
      if (ev.notifyStatus !== "pending" && ev.notifyStatus !== "failed" && !staleClaimed) {
        return false;
      }
      events.set(k, {
        ...ev,
        notifyStatus: "claimed",
        notifyClaimedAt: nowMs,
        notifyAttempts: ev.notifyAttempts + 1,
      });
      return true;
    },

    async markNotifySent(episodeId, slot, fromState, toState, _nowMs) {
      const k = eventKey(episodeId, slot, fromState, toState);
      const ev = events.get(k);
      if (!ev) return;
      events.set(k, { ...ev, notified: true, notifyStatus: "sent" });
    },

    async markNotifyFailed(episodeId, slot, fromState, toState, error) {
      const k = eventKey(episodeId, slot, fromState, toState);
      const ev = events.get(k);
      if (!ev || ev.notified) return;
      events.set(k, { ...ev, notifyStatus: "failed", notifyLastError: error });
    },

    async listRetryableEvents(nowMs) {
      const out: SignalEventDraft[] = [];
      for (const ev of events.values()) {
        if (ev.notified) continue;
        if (ev.notifyAttempts >= MAX_NOTIFY_ATTEMPTS) continue;
        const staleClaimed =
          ev.notifyStatus === "claimed" &&
          ev.notifyClaimedAt != null &&
          nowMs - ev.notifyClaimedAt > NOTIFY_CLAIM_STALE_MS;
        if (ev.notifyStatus !== "pending" && ev.notifyStatus !== "failed" && !staleClaimed) {
          continue;
        }
        out.push({
          episodeId: ev.episodeId,
          fromState: ev.fromState,
          toState: ev.toState,
          atMs: ev.atMs,
          slot: ev.slot,
          notified: false,
        });
      }
      out.sort((a, b) => a.atMs - b.atMs);
      return out;
    },

    async getAlertPinHash() {
      return pinHash;
    },

    async setAlertPinHash(hash) {
      if (pinHash) return false;
      pinHash = hash;
      return true;
    },

    async upsertOutcome(episodeId, _nowMs, result: OutcomeResult) {
      const prev = outcomes.get(episodeId);
      if (prev && prev.outcome !== "pending" && prev.outcome !== "none") return;
      outcomes.set(episodeId, {
        outcome: result.outcome,
        firstTouch: result.firstTouch,
        firstTouchAtMs: result.firstTouchAtSec == null ? null : result.firstTouchAtSec * 1000,
        mfe: result.mfe,
        mae: result.mae,
      });
    },

    async listHistory(limit) {
      const rows: HistoryRow[] = [...episodes.values()]
        .sort((a, b) => b.openedAtMs - a.openedAtMs)
        .slice(0, limit)
        .map((episode) => {
          const o = outcomes.get(episode.episodeId);
          return {
            episode,
            outcome: o?.outcome ?? null,
            firstTouch: o?.firstTouch ?? null,
            firstTouchAtMs: o?.firstTouchAtMs ?? null,
            mfe: o?.mfe ?? null,
            mae: o?.mae ?? null,
            hadV1Entry: [...events.values()].some(
              (ev) => ev.episodeId === episode.episodeId && ev.toState === "entry",
            ),
          };
        });
      return rows;
    },

    async listInbox(limit) {
      const rows: InboxItem[] = [];
      for (const ev of events.values()) {
        const ep = episodes.get(ev.episodeId);
        if (!ep) continue;
        rows.push({
          episodeId: ev.episodeId,
          assetId: ep.assetId,
          direction: ep.direction,
          fromState: ev.fromState,
          toState: ev.toState,
          atMs: ev.atMs,
          slot: ev.slot,
          notified: ev.notified,
          live: ep.closedAtMs == null,
          notifyStatus: ev.notifyStatus,
          notifyAttempts: ev.notifyAttempts,
          notifyLastError: ev.notifyLastError,
        });
      }
      rows.sort((a, b) => b.atMs - a.atMs);
      return rows.slice(0, limit);
    },

    async getPushPrefs() {
      return { ...prefs };
    },

    async setPushPrefs(next) {
      prefs = parsePushPrefs(next);
    },

    async upsertSnapshot(row) {
      snapshots.set(row.assetId, { ...row });
    },

    async listSnapshots() {
      return [...snapshots.values()]
        .sort((a, b) => a.assetId.localeCompare(b.assetId))
        .map((s) => {
          const ep = s.episodeId ? episodes.get(s.episodeId) : undefined;
          return {
            ...s,
            openedAtMs: ep?.openedAtMs ?? s.openedAtMs ?? null,
            closedAtMs: ep?.closedAtMs ?? s.closedAtMs ?? null,
          };
        });
    },

    async countOpenEpisodes() {
      return [...episodes.values()].filter((e) => e.closedAtMs == null).length;
    },

    async getSnapshot(assetId) {
      return snapshots.get(assetId) ?? null;
    },

    async upsertPushSub(row, _userAgent) {
      subs.set(row.endpoint, { ...row, disabled: false });
    },

    async listActivePushSubs() {
      return [...subs.values()]
        .filter((s) => !s.disabled)
        .map((s) => ({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }));
    },

    async disablePushSub(endpoint, _error) {
      const s = subs.get(endpoint);
      if (s) subs.set(endpoint, { ...s, disabled: true });
    },

    async deletePushSub(endpoint) {
      subs.delete(endpoint);
    },

    async countPushSubs() {
      const all = [...subs.values()];
      return {
        active: all.filter((s) => !s.disabled).length,
        disabled: all.filter((s) => s.disabled).length,
      };
    },

    async hasPushSub(endpoint) {
      const s = subs.get(endpoint);
      return Boolean(s && !s.disabled);
    },

    async listNotifyDebug(limit) {
      const rows = [...events.values()]
        .map((ev) => {
          const ep = episodes.get(ev.episodeId);
          if (!ep) return null;
          return {
            episodeId: ev.episodeId,
            assetId: ep.assetId,
            fromState: ev.fromState,
            toState: ev.toState,
            atMs: ev.atMs,
            notified: ev.notified,
            notifyStatus: ev.notifyStatus,
            notifyAttempts: ev.notifyAttempts,
            notifyLastError: ev.notifyLastError,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r != null)
        .sort((a, b) => b.atMs - a.atMs);
      return rows.slice(0, limit);
    },
  };
}

export type { SetupProposal };
