import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import {
  deletePushSubscription,
  getPushGate,
  getPushPrefs,
  getPushStatus,
  getVapidPublicKey,
  savePushPrefs,
  savePushSubscription,
  sendTestPush,
  setAlertPin,
} from "@/lib/watch/watch.fn";
import { DEFAULT_PUSH_PREFS, type PushPrefs } from "@/lib/watch/push-prefs";
import {
  detectPushUi,
  localPushSubscription,
  pushStateLabel,
  registerAtalayaWorker,
  subscribeAtalayaPush,
  unsubscribeAtalayaPush,
  type PushUiState,
} from "@/lib/watch/push-client";

const ENDPOINT_KEY = "atalaya:push-endpoint:v1";

type ServerStatus = {
  vapidConfigured: boolean;
  vapidSubjectKind?: "https" | "mailto";
  vapidSubjectOverridden?: boolean;
  vapidKeyPairMatch?: boolean | null;
  vapidPublicCorrected?: boolean;
  vapidPublicFingerprint?: string | null;
  vapidJwt?: {
    alg: string;
    typ: string;
    kid: null;
    aud: string | null;
    sub: string;
    iat: number;
    exp: number;
    secondsUntilExp: number;
    appleHost: boolean;
  } | null;
  activeSubscriptions: number;
  disabledSubscriptions: number;
  subscriptionHosts?: string[];
  thisDeviceRegistered: boolean | null;
  lastEvents: Array<{
    assetId: string;
    toState: string;
    notified: boolean;
    notifyStatus: string;
    notifyLastError: string | null;
    pushable: boolean;
  }>;
};


export function AlertsPanel() {
  const [state, setState] = useState<PushUiState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [gate, setGate] = useState<{ pinSet: boolean; open: boolean } | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [server, setServer] = useState<ServerStatus | null>(null);

  async function refreshStatus() {
    const base = detectPushUi();
    if (base === "ios-browser" || base === "unsupported" || base === "denied") {
      setState(base);
      return base;
    }
    try {
      await registerAtalayaWorker();
    } catch {
      /* keep going — subscribe will retry */
    }
    let local: PushSubscription | null = null;
    try {
      local = await localPushSubscription();
    } catch {
      local = null;
    }
    const endpoint = local?.endpoint ?? (typeof window !== "undefined" ? window.localStorage.getItem(ENDPOINT_KEY) : null);
    let status: ServerStatus | null = null;
    try {
      status = await getPushStatus({ data: { endpoint: endpoint ?? undefined } });
      setServer(status);
    } catch {
      setServer(null);
    }
    const perm = typeof Notification !== "undefined" ? Notification.permission : "default";
    let next: PushUiState = "off";
    if (perm === "denied") next = "denied";
    else if (local && status?.thisDeviceRegistered === true) next = "on";
    else if (local && status?.thisDeviceRegistered === false) next = "local-only";
    else if (local && status == null) next = "local-only";
    else if (perm === "granted" && !local) next = "granted-no-sub";
    else next = "off";
    setState(next);
    return next;
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const g = await getPushGate();
        if (!cancel) setGate(g);
        const p = await getPushPrefs();
        if (!cancel) setPrefs(p);
      } catch {
        if (!cancel) setGate({ pinSet: false, open: true });
      }
      if (!cancel) await refreshStatus();
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    setTestNote(null);
    try {
      const vis = detectPushUi();
      if (vis === "ios-browser" || vis === "unsupported") {
        setState(vis);
        return;
      }
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setState(perm === "denied" ? "denied" : "off");
          return;
        }
      }
      if (gate?.open && pin.length >= 4) {
        await setAlertPin({ data: { pin } });
        setGate({ pinSet: true, open: false });
      }
      const { publicKey } = await getVapidPublicKey();
      if (!publicKey) throw new Error("VAPID no configurado en el servidor.");
      const sub = await subscribeAtalayaPush(publicKey);
      const saved = await savePushSubscription({
        data: { ...sub, userAgent: navigator.userAgent, pin: pin || undefined },
      });
      try {
        window.localStorage.setItem(ENDPOINT_KEY, sub.endpoint);
      } catch {
        /* ignore */
      }
      if (!saved.thisDeviceRegistered) {
        throw new Error("El servidor no guardó la suscripción. Revisa el PIN.");
      }
      setState("on");
      setServer((s) =>
        s
          ? { ...s, thisDeviceRegistered: true, activeSubscriptions: saved.activeSubscriptions }
          : {
              vapidConfigured: true,
              activeSubscriptions: saved.activeSubscriptions,
              disabledSubscriptions: 0,
              thisDeviceRegistered: true,
              lastEvents: [],
            },
      );
      try {
        const test = await sendTestPush({ data: { pin: pin || undefined } });
        if (test.sent > 0) {
          setTestNote("Prueba aceptada por Apple (HTTP 201). Si iOS lo permite, verás el aviso.");
        } else {
          setTestNote(test.error ?? "El proveedor no aceptó la prueba.");
        }
      } catch (e) {
        setTestNote(e instanceof Error ? e.message : "No se pudo enviar la prueba.");
      }
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron activar los avisos.");
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const endpoint = (await unsubscribeAtalayaPush()) ?? window.localStorage.getItem(ENDPOINT_KEY);
      if (endpoint) await deletePushSubscription({ data: { endpoint } });
      try {
        window.localStorage.removeItem(ENDPOINT_KEY);
      } catch {
        /* ignore */
      }
      setState("off");
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron desactivar.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setTestNote(null);
    try {
      const r = await sendTestPush({ data: { pin: pin || undefined } });
      if (r.sent > 0) setTestNote(`Prueba aceptada por Apple (HTTP 201) · ${r.sent}/${r.subs}.`);
      else setError(r.error ?? "Ningún envío aceptado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la prueba.");
    } finally {
      setBusy(false);
    }
  };

  const needsPin = gate != null && (gate.pinSet || gate.open);
  const canEnable = state === "off" || state === "granted-no-sub" || state === "local-only" || state === "error";
  const pushableUnsent = server?.lastEvents.filter((e) => e.pushable && !e.notified).length ?? 0;
  const lastSendError = server?.lastEvents.find((e) => e.notifyLastError)?.notifyLastError ?? null;
  const hostLine = server?.subscriptionHosts?.length ? server.subscriptionHosts.join(", ") : null;

  return (
    <section className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-muted uppercase">Avisos</p>
          <p className="mt-0.5 text-sm" data-alerts-state={state}>
            {pushStateLabel(state)}
          </p>
        </div>
        {state === "on" ? (
          <BellRing className="mt-0.5 size-4 text-buy" />
        ) : state === "off" || state === "granted-no-sub" || state === "local-only" ? (
          <BellOff className="mt-0.5 size-4 text-muted" />
        ) : (
          <Bell className="mt-0.5 size-4 text-muted" />
        )}
      </div>
      {server ? (
        <p className="mt-2 text-xs leading-relaxed text-subtle" data-push-server>
          Servidor: {server.vapidConfigured ? "VAPID listo" : "VAPID ausente"}
          {server.vapidKeyPairMatch === false ? " · claves pública/privada NO coinciden" : ""}
          {server.vapidKeyPairMatch === true ? " · par de claves OK" : ""}
          {server.vapidPublicCorrected ? " · pública corregida (reactiva avisos)" : ""}
          {server.vapidJwt?.aud ? ` · aud ${server.vapidJwt.aud}` : ""}
          {server.vapidJwt?.sub ? ` · sub ${server.vapidJwt.sub}` : ""}
          {server.vapidJwt ? ` · exp ${server.vapidJwt.secondsUntilExp}s` : ""} ·{" "}
          {server.activeSubscriptions} dispositivo{server.activeSubscriptions === 1 ? "" : "s"} en Neon
          {hostLine ? ` · ${hostLine}` : ""}
          {server.thisDeviceRegistered === true
            ? " · este dispositivo registrado"
            : server.thisDeviceRegistered === false
              ? " · este dispositivo NO está en Neon"
              : ""}
          {pushableUnsent ? ` · ${pushableUnsent} ENTRADA sin Push enviado` : ""}
        </p>
      ) : null}
      {lastSendError ? (
        <p className="mt-2 text-xs leading-relaxed text-wait" data-push-last-error>
          Último envío ENTRADA: {lastSendError}
        </p>
      ) : null}
      {state === "ios-browser" ? (
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          En iPhone los avisos solo funcionan si Atalaya está en la pantalla de inicio y la abres
          desde el icono. Compartir → Añadir a inicio.
        </p>
      ) : null}
      {state === "local-only" ? (
        <p className="mt-2 text-xs leading-relaxed text-wait">
          El navegador tiene una suscripción local que el servidor no reconoce. Vuelve a activar
          avisos con el PIN para registrarla en Neon.
        </p>
      ) : null}
      {gate?.open ? (
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          Elige un PIN de 4 a 12 dígitos la primera vez. Sin PIN, cualquiera con la dirección podría
          suscribirse.
        </p>
      ) : gate?.pinSet && state !== "on" ? (
        <p className="mt-2 text-xs leading-relaxed text-subtle">Introduce el PIN de avisos.</p>
      ) : null}
      {needsPin && state !== "ios-browser" && state !== "unsupported" ? (
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="PIN de avisos"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
          className="mt-3 min-h-11 w-full rounded-[var(--radius-md)] bg-surface px-3 text-sm"
        />
      ) : null}
      {state === "on" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void disable()}
            className="min-h-11 rounded-[var(--radius-md)] bg-surface text-sm font-medium disabled:opacity-50"
          >
            Desactivar avisos
          </button>
          <button
            type="button"
            disabled={busy || (gate?.pinSet === true && pin.length < 4)}
            onClick={() => void test()}
            className="min-h-11 rounded-[var(--radius-md)] bg-surface text-sm font-medium disabled:opacity-50"
            data-push-test
          >
            Enviar prueba
          </button>
        </div>
      ) : canEnable ? (
        <button
          type="button"
          disabled={busy || (needsPin && pin.length < 4)}
          onClick={() => void enable()}
          className="mt-3 min-h-11 w-full rounded-[var(--radius-md)] bg-surface text-sm font-medium disabled:opacity-50"
        >
          Activar avisos
        </button>
      ) : null}
      {error ? <p className="mt-2 text-xs text-sell">{error}</p> : null}
      {testNote ? <p className="mt-2 text-xs text-buy">{testNote}</p> : null}
      {state === "on" ? (
        <div className="mt-3 space-y-2 border-t border-border/80 pt-3">
          <p className="text-xs text-subtle">Solo controla Push. No cambia V1 ni la vigilancia.</p>
          {(
            [
              ["enabled", "Avisos globales"],
              ["entry", "ENTRADA"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center justify-between gap-2 text-sm">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={(e) => {
                  const next = { ...prefs, [key]: e.target.checked };
                  setPrefs(next);
                  void savePushPrefs({ data: next });
                }}
              />
            </label>
          ))}
          <p className="text-xs leading-relaxed text-subtle" data-caducity-policy>
            MAPA, TRIGGER PENDIENTE y ESPERAR se guardan en la bandeja. No generan Push. Solo
            ENTRADA avisa, una vez por episodio.
          </p>
          <p className="pt-2 text-xs font-medium tracking-wider text-muted uppercase">Horas silenciosas</p>
          <p className="text-xs text-subtle">
            Europe/Madrid. Durante la ventana no se envía Push. El evento se guarda en la bandeja
            y se reintenta al salir.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-subtle">Desde</span>
              <input
                type="time"
                value={prefs.quietStart ?? ""}
                onChange={(e) => {
                  const next = { ...prefs, quietStart: e.target.value || null };
                  setPrefs(next);
                  void savePushPrefs({ data: next });
                }}
                className="mt-1 h-11 w-full rounded-[var(--radius-md)] bg-surface px-3 font-mono text-sm tabular"
              />
            </label>
            <label className="block">
              <span className="text-xs text-subtle">Hasta</span>
              <input
                type="time"
                value={prefs.quietEnd ?? ""}
                onChange={(e) => {
                  const next = { ...prefs, quietEnd: e.target.value || null };
                  setPrefs(next);
                  void savePushPrefs({ data: next });
                }}
                className="mt-1 h-11 w-full rounded-[var(--radius-md)] bg-surface px-3 font-mono text-sm tabular"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const now = Date.now();
              const paused = prefs.pausedUntilMs != null && prefs.pausedUntilMs > now;
              const next = {
                ...prefs,
                pausedUntilMs: paused ? null : now + 24 * 60 * 60 * 1000,
              };
              setPrefs(next);
              void savePushPrefs({ data: next });
            }}
            className="mt-1 min-h-11 w-full rounded-[var(--radius-md)] bg-surface text-sm font-medium disabled:opacity-50"
            data-pause-push
          >
            {prefs.pausedUntilMs != null && prefs.pausedUntilMs > Date.now()
              ? "Reanudar avisos"
              : "Pausar avisos 24 h"}
          </button>
          {prefs.pausedUntilMs != null && prefs.pausedUntilMs > Date.now() ? (
            <p className="text-xs text-wait">
              Push pausado. La vigilancia y V1 siguen. Se reanuda al terminar la pausa.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
