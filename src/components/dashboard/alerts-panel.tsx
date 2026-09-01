import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import {
  deletePushSubscription,
  getPushGate,
  getPushPrefs,
  getVapidPublicKey,
  savePushPrefs,
  savePushSubscription,
  setAlertPin,
} from "@/lib/watch/watch.fn";
import { DEFAULT_PUSH_PREFS, type PushPrefs } from "@/lib/watch/push-prefs";
import {
  detectPushUi,
  registerAtalayaWorker,
  urlBase64ToUint8Array,
  type PushUiState,
} from "@/lib/watch/push-client";

const ENDPOINT_KEY = "atalaya:push-endpoint:v1";

export function AlertsPanel() {
  const [state, setState] = useState<PushUiState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [gate, setGate] = useState<{ pinSet: boolean; open: boolean } | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const base = detectPushUi();
      try {
        const g = await getPushGate();
        if (!cancel) setGate(g);
        const p = await getPushPrefs();
        if (!cancel) setPrefs(p);
      } catch {
        if (!cancel) setGate({ pinSet: false, open: true });
      }
      if (base !== "off") {
        if (!cancel) setState(base);
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (!cancel) setState(sub ? "on" : "off");
      } catch {
        if (!cancel) setState("off");
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      const vis = detectPushUi();
      if (vis === "ios-browser" || vis === "unsupported") {
        setState(vis);
        return;
      }
      if (gate?.open && pin.length >= 4) {
        await setAlertPin({ data: { pin } });
        setGate({ pinSet: true, open: false });
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const { publicKey } = await getVapidPublicKey();
      if (!publicKey) throw new Error("VAPID no configurado en el servidor.");
      const reg = await registerAtalayaWorker();
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      const endpoint = json.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!endpoint || !p256dh || !auth) throw new Error("El navegador no entregó la suscripción.");
      await savePushSubscription({
        data: { endpoint, p256dh, auth, userAgent: navigator.userAgent, pin: pin || undefined },
      });
      try {
        window.localStorage.setItem(ENDPOINT_KEY, endpoint);
      } catch {
        /* ignore */
      }
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron activar los avisos.");
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      const endpoint = sub?.endpoint ?? window.localStorage.getItem(ENDPOINT_KEY);
      if (sub) await sub.unsubscribe();
      if (endpoint) await deletePushSubscription({ data: { endpoint } });
      try {
        window.localStorage.removeItem(ENDPOINT_KEY);
      } catch {
        /* ignore */
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron desactivar.");
    } finally {
      setBusy(false);
    }
  };

  const needsPin = gate != null && (gate.pinSet || gate.open);

  return (
    <section className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-muted uppercase">Avisos</p>
          <p className="mt-0.5 text-sm" data-alerts-state={state}>
            {state === "on" && "Avisos activados"}
            {state === "off" && "Avisos no activados"}
            {state === "denied" && "Avisos bloqueados en el sistema"}
            {state === "ios-browser" && "No compatible aquí — instala en inicio"}
            {state === "unsupported" && "No compatible"}
            {state === "checking" && "Comprobando avisos…"}
          </p>
        </div>
        {state === "on" ? (
          <BellRing className="mt-0.5 size-4 text-buy" />
        ) : state === "off" ? (
          <BellOff className="mt-0.5 size-4 text-muted" />
        ) : (
          <Bell className="mt-0.5 size-4 text-muted" />
        )}
      </div>
      {state === "ios-browser" ? (
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          En iPhone los avisos solo funcionan si Atalaya está en la pantalla de inicio y la abres
          desde el icono. Compartir → Añadir a inicio.
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
      {needsPin && state !== "on" && state !== "ios-browser" && state !== "unsupported" ? (
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
        <button
          type="button"
          disabled={busy}
          onClick={() => void disable()}
          className="mt-3 min-h-11 w-full rounded-[var(--radius-md)] bg-surface text-sm font-medium disabled:opacity-50"
        >
          Desactivar avisos
        </button>
      ) : state === "off" || state === "denied" ? (
        <button
          type="button"
          disabled={busy || state === "denied"}
          onClick={() => void enable()}
          className="mt-3 min-h-11 w-full rounded-[var(--radius-md)] bg-surface text-sm font-medium disabled:opacity-50"
        >
          Activar avisos
        </button>
      ) : null}
      {error ? <p className="mt-2 text-xs text-sell">{error}</p> : null}
      {state === "on" ? (
        <div className="mt-3 space-y-2 border-t border-border/80 pt-3">
          <p className="text-xs text-subtle">Solo controla Push. No cambia V1 ni la vigilancia.</p>
          {(
            [
              ["enabled", "Avisos globales"],
              ["entry", "ENTRADA"],
              ["pending", "TRIGGER PENDIENTE"],
              ["map", "MAPA"],
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
            CADUCIDAD / ESPERAR: se guarda en la bandeja. No genera Push. No es un aviso de
            proximidad ni una nueva señal.
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
