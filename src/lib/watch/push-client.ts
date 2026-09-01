export type PushUiState =
  | "checking"
  | "unsupported"
  | "ios-browser"
  | "denied"
  | "off"
  | "granted-no-sub"
  | "local-only"
  | "on"
  | "error";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export function detectPushUi(): PushUiState {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIos() && !isStandalone() ? "ios-browser" : "unsupported";
  }
  if (isIos() && !isStandalone()) return "ios-browser";
  if (Notification.permission === "denied") return "denied";
  return "off";
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerAtalayaWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function localPushSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function subscribeAtalayaPush(publicKey: string): Promise<{
  endpoint: string;
  p256dh: string;
  auth: string;
}> {
  const reg = await registerAtalayaWorker();
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    try {
      await existing.unsubscribe();
    } catch {
      /* replace below */
    }
  }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error("El navegador no entregó la suscripción.");
  return { endpoint, p256dh, auth };
}

export async function unsubscribeAtalayaPush(): Promise<string | null> {
  const sub = await localPushSubscription();
  const endpoint = sub?.endpoint ?? null;
  if (sub) await sub.unsubscribe();
  return endpoint;
}

export function pushStateLabel(state: PushUiState): string {
  switch (state) {
    case "on":
      return "Suscripción activa en este dispositivo y en el servidor";
    case "local-only":
      return "Permiso concedido en el dispositivo, sin registro en el servidor";
    case "granted-no-sub":
      return "Permiso concedido, sin suscripción Push";
    case "off":
      return "Avisos no activados";
    case "denied":
      return "Avisos bloqueados en el sistema";
    case "ios-browser":
      return "No compatible aquí — instala en inicio";
    case "unsupported":
      return "Este navegador no admite Web Push";
    case "error":
      return "Error de registro";
    case "checking":
      return "Comprobando avisos…";
  }
}
