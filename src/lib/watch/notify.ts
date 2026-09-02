import type { SetupState } from "../trading/types";
import type { EpisodeDraft, SignalEventDraft } from "./episode";
import { buildPushPayload, type PushPayload } from "./payload";
import { shouldPushState } from "./policy";
import { shouldPushWithPrefs } from "./push-prefs";
import type { WatchStore } from "./store";

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSender = (sub: PushSub, payload: PushPayload) => Promise<"ok" | "gone" | string>;

export interface NotifyResult {
  considered: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
}

function keyOf(ev: SignalEventDraft): string {
  return `${ev.episodeId}|${ev.slot}|${ev.fromState}|${ev.toState}`;
}

export function pushEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "unknown";
  }
}

/** Map web-push WebPushError into a short lastError. 404/410 → gone. */
export function formatPushSendError(e: unknown): "gone" | string {
  const err = e as { statusCode?: number; message?: string; body?: string };
  const status = typeof err.statusCode === "number" ? err.statusCode : 0;
  if (status === 404 || status === 410) return "gone";
  const body = typeof err.body === "string" ? err.body.replace(/\s+/g, " ").slice(0, 80) : "";
  const bit = status ? `HTTP ${status}` : (err.message ?? "sin-codigo").slice(0, 80);
  return body ? `proveedor ${bit} · ${body}` : `proveedor ${bit}`;
}

export async function dispatchEventPushes(
  store: WatchStore,
  events: SignalEventDraft[],
  send: PushSender,
  nowMs = Date.now(),
): Promise<NotifyResult> {
  const result: NotifyResult = {
    considered: 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    retried: 0,
  };
  const retryable = await store.listRetryableEvents(nowMs);
  const merged: SignalEventDraft[] = [];
  const seen = new Set<string>();
  for (const ev of [...events, ...retryable]) {
    const k = keyOf(ev);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(ev);
  }
  result.considered = merged.length;
  const subs = await store.listActivePushSubs();
  const prefs = await store.getPushPrefs();

  for (const ev of merged) {
    if (!shouldPushWithPrefs(ev.toState, prefs, nowMs)) {
      result.skipped += 1;
      continue;
    }
    if (subs.length === 0) {
      result.skipped += 1;
      continue;
    }
    const claimed = await store.claimNotify(ev.episodeId, ev.slot, ev.fromState, ev.toState, nowMs);
    if (!claimed) {
      result.skipped += 1;
      continue;
    }
    result.claimed += 1;
    if (!events.some((e) => keyOf(e) === keyOf(ev))) result.retried += 1;
    const episode = await store.getEpisode(ev.episodeId);
    if (!episode) {
      await store.markNotifyFailed(ev.episodeId, ev.slot, ev.fromState, ev.toState, "episodio ausente");
      result.failed += 1;
      continue;
    }
    const payload = buildPushPayload(episode, ev.toState);
    let ok = 0;
    let lastError = "error";
    for (const sub of subs) {
      try {
        const status = await send(sub, payload);
        if (status === "gone") await store.disablePushSub(sub.endpoint, "gone");
        else if (status === "ok") ok += 1;
        else lastError = status && status !== "error" ? status : "proveedor";
      } catch (e) {
        lastError = e instanceof Error ? e.message : "error";
        await store.disablePushSub(sub.endpoint, lastError).catch(() => undefined);
      }
    }
    if (ok > 0) {
      await store.markNotifySent(ev.episodeId, ev.slot, ev.fromState, ev.toState, nowMs);
      result.sent += ok;
    } else {
      await store.markNotifyFailed(ev.episodeId, ev.slot, ev.fromState, ev.toState, lastError);
      result.failed += 1;
    }
  }
  return result;
}

export async function sendWebPush(sub: PushSub, payload: PushPayload): Promise<"ok" | "gone" | string> {
  const { getSql } = await import("@/lib/db");
  const { loadVapidKeys, vapidKeyPairMatches, vapidSubjectForEndpoint } = await import("./vapid");
  const webpush = await import("web-push");
  const sql = await getSql();
  const keys = await loadVapidKeys(sql);
  if (!keys) return "vapid ausente";
  if (!vapidKeyPairMatches(keys.publicKey, keys.privateKey)) {
    return "vapid claves no coinciden";
  }
  const subject = vapidSubjectForEndpoint(keys.subject, sub.endpoint).subject;
  try {
    const res = (await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
        TTL: 3600,
        urgency: "high",
        contentEncoding: "aes128gcm",
      },
    )) as { statusCode?: number; headers?: Record<string, string | string[] | undefined> };
    const http = typeof res?.statusCode === "number" ? res.statusCode : 201;
    if (http === 201 || (http >= 200 && http < 300)) return "ok";
    return `proveedor HTTP ${http}`;
  } catch (e) {
    const mapped = formatPushSendError(e);
    console.info("[watch] push send failed", {
      mapped,
      endpoint: sub.endpoint.slice(0, 48),
    });
    return mapped;
  }
}

export function isPushableTransition(to: SetupState): boolean {
  return shouldPushState(to);
}

export type { EpisodeDraft };
