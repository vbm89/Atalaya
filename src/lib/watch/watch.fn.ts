import { createServerFn } from "@tanstack/react-start";
import type { AssetId, SetupKind, SetupProposal, SetupState } from "@/lib/trading/types";
import type { EpisodeDraft } from "./episode";
import type { EpisodeFreeze } from "./freeze";

export const getWatchHealth = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("./store");
  const { readWatchHealth } = await import("./health");
  const sql = await getSql();
  return readWatchHealth(createPgStore(sql), Date.now());
});

export const getWatchSnapshots = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("./store");
  const sql = await getSql();
  return createPgStore(sql).listSnapshots();
});

export const getVapidPublicKey = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { loadVapidPublicKey } = await import("./vapid");
  const sql = await getSql();
  return { publicKey: await loadVapidPublicKey(sql) };
});

export const getPushGate = createServerFn({ method: "POST" }).handler(async () => {
  const { envAlertPin } = await import("./pin");
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("./store");
  const sql = await getSql();
  const stored = await createPgStore(sql).getAlertPinHash();
  const env = envAlertPin();
  const pinSet = env != null || stored != null;
  return { pinSet, open: !pinSet };
});

export const setAlertPin = createServerFn({ method: "POST" })
  .validator((input: { pin: string }) => {
    const pin = typeof input?.pin === "string" ? input.pin : "";
    return { pin };
  })
  .handler(async ({ data }) => {
    const { envAlertPin, hashPin, normalizePin } = await import("./pin");
    if (envAlertPin()) throw new Error("El PIN ya está fijado en el servidor.");
    const pin = normalizePin(data.pin);
    if (!pin) throw new Error("PIN de 4 a 12 dígitos.");
    const { getSql } = await import("@/lib/db");
    const { createPgStore } = await import("./store");
    const sql = await getSql();
    const ok = await createPgStore(sql).setAlertPinHash(hashPin(pin));
    if (!ok) throw new Error("El PIN ya existe. Úsalo para activar avisos.");
    return { ok: true };
  });

function validPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
}

export const savePushSubscription = createServerFn({ method: "POST" })
  .validator((input: { endpoint: string; p256dh: string; auth: string; userAgent?: string; pin?: string }) => {
    if (!input || !validPushEndpoint(input.endpoint) || !input.p256dh || !input.auth) {
      throw new Error("Suscripción no válida.");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { envAlertPin, pinMatches } = await import("./pin");
    const { getSql } = await import("@/lib/db");
    const { createPgStore } = await import("./store");
    const sql = await getSql();
    const store = createPgStore(sql);
    const stored = await store.getAlertPinHash();
    const required = envAlertPin() != null || stored != null;
    if (required && !pinMatches(data.pin ?? "", stored)) {
      throw new Error("PIN incorrecto.");
    }
    await store.upsertPushSub(
      { endpoint: data.endpoint, p256dh: data.p256dh, auth: data.auth },
      data.userAgent ?? null,
    );
    const counts = await store.countPushSubs();
    const registered = await store.hasPushSub(data.endpoint);
    return { ok: true, thisDeviceRegistered: registered, activeSubscriptions: counts.active };
  });

export const deletePushSubscription = createServerFn({ method: "POST" })
  .validator((input: { endpoint: string }) => {
    if (!input?.endpoint || !validPushEndpoint(input.endpoint)) throw new Error("Endpoint no válido.");
    return input;
  })
  .handler(async ({ data }) => {
    const { getSql } = await import("@/lib/db");
    const { createPgStore } = await import("./store");
    const sql = await getSql();
    await createPgStore(sql).deletePushSub(data.endpoint);
    return { ok: true };
  });

export const getPushStatus = createServerFn({ method: "POST" })
  .validator((input: { endpoint?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { getSql } = await import("@/lib/db");
    const { createPgStore } = await import("./store");
    const { inspectVapidEnv, loadVapidKeys, vapidJwtPreview } = await import("./vapid");
    const { shouldPushState } = await import("./policy");
    const { pushEndpointHost } = await import("./notify");
    const sql = await getSql();
    const store = createPgStore(sql);
    const counts = await store.countPushSubs();
    const events = await store.listNotifyDebug(20);
    const endpoint = typeof data.endpoint === "string" ? data.endpoint : "";
    const thisDeviceRegistered = endpoint ? await store.hasPushSub(endpoint) : null;
    const subs = await store.listActivePushSubs();
    const hosts = [...new Set(subs.map((s) => pushEndpointHost(s.endpoint)))];
    const vapid = inspectVapidEnv();
    const keys = await loadVapidKeys(sql);
    const sample =
      subs.find((s) => pushEndpointHost(s.endpoint).includes("push.apple.com"))?.endpoint ??
      subs[0]?.endpoint ??
      "https://web.push.apple.com/x";
    const jwt = keys ? vapidJwtPreview(sample, keys.subject) : null;
    return {
      vapidConfigured: vapid.configured,
      vapidSubjectKind: jwt ? (jwt.sub.startsWith("mailto:") ? "mailto" : "https") : vapid.subjectKind,
      vapidSubjectOverridden: vapid.subjectOverridden,
      vapidKeyPairMatch: vapid.keyPairMatch,
      vapidPublicCorrected: vapid.publicCorrected,
      vapidPublicFingerprint: vapid.publicFingerprint,
      vapidJwt: jwt
        ? {
            alg: jwt.alg,
            typ: jwt.typ,
            kid: jwt.kid,
            aud: jwt.aud,
            sub: jwt.sub,
            iat: jwt.iat,
            exp: jwt.exp,
            secondsUntilExp: jwt.secondsUntilExp,
            appleHost: jwt.appleHost,
          }
        : null,
      activeSubscriptions: counts.active,
      disabledSubscriptions: counts.disabled,
      subscriptionHosts: hosts,
      thisDeviceRegistered,
      lastEvents: events.map((e) => ({
        assetId: e.assetId,
        fromState: e.fromState,
        toState: e.toState,
        atMs: e.atMs,
        notified: e.notified,
        notifyStatus: e.notifyStatus,
        notifyAttempts: e.notifyAttempts,
        notifyLastError: e.notifyLastError,
        pushable: shouldPushState(e.toState),
      })),
    };
  });

export const sendTestPush = createServerFn({ method: "POST" })
  .validator((input: { pin?: string } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { envAlertPin, pinMatches } = await import("./pin");
    const { getSql } = await import("@/lib/db");
    const { createPgStore } = await import("./store");
    const { sendWebPush } = await import("./notify");
    const { buildTestPushPayload } = await import("./payload");
    const sql = await getSql();
    const store = createPgStore(sql);
    const stored = await store.getAlertPinHash();
    const required = envAlertPin() != null || stored != null;
    if (required && !pinMatches(data.pin ?? "", stored)) {
      throw new Error("PIN incorrecto.");
    }
    const subs = await store.listActivePushSubs();
    if (subs.length === 0) {
      return {
        sent: 0,
        failed: 0,
        subs: 0,
        error: "Ningún dispositivo registrado en Neon. Activa avisos en este dispositivo.",
      };
    }
    const payload = buildTestPushPayload();
    let sent = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (const sub of subs) {
      const status = await sendWebPush(sub, payload);
      if (status === "ok") sent += 1;
      else {
        failed += 1;
        lastError = status;
        if (status === "gone") await store.disablePushSub(sub.endpoint, "gone");
      }
    }
    return {
      sent,
      failed,
      subs: subs.length,
      appleAccepted: sent > 0,
      error: sent > 0 ? null : lastError ?? "El proveedor no aceptó el envío.",
    };
  });

export interface WatchEpisodeView {
  episodeId: string;
  assetId: AssetId;
  live: boolean;
  state: SetupState;
  direction: "buy" | "sell";
  zoneLow: number;
  zoneHigh: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  openedAtMs: number;
  closedAtMs: number | null;
  setup: SetupProposal | null;
  waitReason: string | null;
  freeze: EpisodeFreeze | null;
}

function setupFromEpisode(ep: EpisodeDraft, snapshotSetup: SetupProposal | null): SetupProposal {
  if (snapshotSetup) return snapshotSetup;
  const state: SetupState = ep.openedState === "wait" ? "map" : ep.openedState;
  return {
    state,
    kind: ep.kind as SetupKind,
    direction: ep.direction,
    zone: { low: ep.zoneLow, high: ep.zoneHigh },
    invalidation: ep.sl,
    stopLoss: ep.sl,
    takeProfit1: ep.tp1,
    takeProfit2: ep.tp2,
    riskReward: ep.freeze?.riskReward ?? 0,
    quality: (ep.freeze?.quality as SetupProposal["quality"]) ?? "media",
    qualityPhase: "final",
    supersedeLevel: null,
    missingForEntry: null,
    slWide: false,
    warnings: [],
    managementNote: "",
    entryLabel: String(ep.zoneLow),
  };
}

export const getWatchEpisode = createServerFn({ method: "POST" })
  .validator((input: { episodeId: string }) => {
    const episodeId = input?.episodeId?.trim() ?? "";
    if (episodeId.length < 8) throw new Error("Episodio no válido.");
    return { episodeId };
  })
  .handler(async ({ data }): Promise<WatchEpisodeView | null> => {
    const { getSql } = await import("@/lib/db");
    const { createPgStore } = await import("./store");
    const sql = await getSql();
    const store = createPgStore(sql);
    const ep = await store.getEpisode(data.episodeId);
    if (!ep) return null;
    const snap = await store.getSnapshot(ep.assetId);
    const live = ep.closedAtMs == null && ep.currentState !== "wait";
    const snapFits = live && snap?.episodeId === ep.episodeId;
    return {
      episodeId: ep.episodeId,
      assetId: ep.assetId,
      live,
      state: live ? ep.currentState : "wait",
      direction: ep.direction,
      zoneLow: ep.zoneLow,
      zoneHigh: ep.zoneHigh,
      sl: ep.sl,
      tp1: ep.tp1,
      tp2: ep.tp2,
      openedAtMs: ep.openedAtMs,
      closedAtMs: ep.closedAtMs,
      setup: setupFromEpisode(ep, snapFits ? snap?.setup ?? null : null),
      waitReason: live ? null : "Esta señal ya no está vigente.",
      freeze: ep.freeze,
    };
  });

export const getWatchHistory = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("./store");
  const sql = await getSql();
  return createPgStore(sql).listHistory(80);
});

export const getWatchInbox = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("./store");
  const sql = await getSql();
  return createPgStore(sql).listInbox(20);
});

export const getWatchEpisodeEvents = createServerFn({ method: "POST" })
  .validator((input: { episodeId: string }) => {
    const episodeId = input?.episodeId?.trim() ?? "";
    if (episodeId.length < 8) throw new Error("Episodio no válido.");
    return { episodeId };
  })
  .handler(async ({ data }) => {
    const { getSql } = await import("@/lib/db");
    const { createPgStore } = await import("./store");
    const sql = await getSql();
    return createPgStore(sql).listEpisodeEvents(data.episodeId);
  });

export const getPushPrefs = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("./store");
  const sql = await getSql();
  return createPgStore(sql).getPushPrefs();
});

export const savePushPrefs = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    return input;
  })
  .handler(async ({ data }) => {
    const { getSql } = await import("@/lib/db");
    const { createPgStore } = await import("./store");
    const { parsePushPrefs } = await import("./push-prefs");
    const sql = await getSql();
    const prefs = parsePushPrefs(data);
    await createPgStore(sql).setPushPrefs(prefs);
    return { ok: true, prefs };
  });
