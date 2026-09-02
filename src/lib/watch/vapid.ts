import { createECDH, createHash } from "node:crypto";
import type { SqlQuery } from "./store";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface VapidJwtPreview {
  alg: "ES256";
  typ: "JWT";
  kid: null;
  aud: string | null;
  sub: string;
  iat: number;
  exp: number;
  secondsUntilExp: number;
  appleHost: boolean;
}

/** Apple and RFC 8292 reject mailto:…@….local. Always a real https origin. */
export const DEFAULT_VAPID_SUBJECT = "https://atalaya-nu.vercel.app";

/** web-push default. Apple rejects exp more than 24h ahead. */
export const VAPID_EXPIRATION_SECONDS = 12 * 60 * 60;

export function normalizeVapidB64(raw: string): string {
  return raw
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function resolveVapidSubject(raw: string | undefined | null): {
  subject: string;
  kind: "https" | "mailto";
  overridden: boolean;
} {
  const t = (raw ?? "").trim();
  if (!t) return { subject: DEFAULT_VAPID_SUBJECT, kind: "https", overridden: false };
  if (/^https:\/\//i.test(t) && !/\.local(?:[:/?#]|$)/i.test(t)) {
    return { subject: t, kind: "https", overridden: false };
  }
  const mail = /^mailto:([^\s@]+)@([^\s@]+)$/i.exec(t);
  if (mail) {
    const domain = mail[2] ?? "";
    if (domain.includes(".") && !/\.local$/i.test(domain)) {
      return { subject: t, kind: "mailto", overridden: false };
    }
  }
  return { subject: DEFAULT_VAPID_SUBJECT, kind: "https", overridden: true };
}

export function isApplePushHost(host: string): boolean {
  return host === "web.push.apple.com" || host.endsWith(".push.apple.com");
}

export function pushServiceOrigin(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Apple JWT `sub` must be https: or mailto: without spaces/.local.
 * mailto that Apple still rejects as BadJwtToken → always https origin for Apple.
 */
export function vapidSubjectForEndpoint(
  configured: string,
  endpoint: string,
): { subject: string; kind: "https" | "mailto"; overridden: boolean } {
  const host = (() => {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return "";
    }
  })();
  if (isApplePushHost(host)) {
    const used = DEFAULT_VAPID_SUBJECT;
    const same = configured === used;
    return { subject: used, kind: "https", overridden: !same };
  }
  const resolved = resolveVapidSubject(configured);
  return resolved;
}

export function vapidPublicFromPrivate(privateKey: string): string | null {
  try {
    const priv = Buffer.from(normalizeVapidB64(privateKey), "base64url");
    if (priv.length !== 32) return null;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    const pub = ecdh.getPublicKey();
    if (pub.length !== 65) return null;
    return Buffer.from(pub).toString("base64url");
  } catch {
    return null;
  }
}

export function vapidKeyPairMatches(publicKey: string, privateKey: string): boolean {
  const derived = vapidPublicFromPrivate(privateKey);
  if (!derived) return false;
  return derived === normalizeVapidB64(publicKey);
}

export function vapidPublicFingerprint(publicKey: string): string {
  return createHash("sha256").update(normalizeVapidB64(publicKey), "utf8").digest("hex").slice(0, 16);
}

export function vapidJwtPreview(
  endpoint: string,
  configuredSubject: string,
  nowMs = Date.now(),
): VapidJwtPreview {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + VAPID_EXPIRATION_SECONDS;
  const host = (() => {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return "";
    }
  })();
  const sub = vapidSubjectForEndpoint(configuredSubject, endpoint);
  return {
    alg: "ES256",
    typ: "JWT",
    kid: null,
    aud: pushServiceOrigin(endpoint),
    sub: sub.subject,
    iat,
    exp,
    secondsUntilExp: exp - iat,
    appleHost: isApplePushHost(host),
  };
}

export function inspectVapidEnv(): {
  configured: boolean;
  subjectKind: "https" | "mailto";
  subjectOverridden: boolean;
  keyPairMatch: boolean | null;
  publicFingerprint: string | null;
} {
  const info = resolveVapidSubject(process.env.VAPID_SUBJECT);
  const keys = vapidEnvKeys();
  return {
    configured: keys != null,
    subjectKind: info.kind,
    subjectOverridden: info.overridden,
    keyPairMatch: keys ? vapidKeyPairMatches(keys.publicKey, keys.privateKey) : null,
    publicFingerprint: keys ? vapidPublicFingerprint(keys.publicKey) : null,
  };
}

export function vapidEnvKeys(): VapidKeys | null {
  const publicRaw = process.env.VAPID_PUBLIC_KEY?.trim() || process.env.VITE_VAPID_PUBLIC_KEY?.trim();
  const privateRaw = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = resolveVapidSubject(process.env.VAPID_SUBJECT).subject;
  if (!publicRaw || !privateRaw) return null;
  const publicKey = normalizeVapidB64(publicRaw);
  const privateKey = normalizeVapidB64(privateRaw);
  const vitePub = process.env.VITE_VAPID_PUBLIC_KEY?.trim();
  let chosen = publicKey;
  if (!vapidKeyPairMatches(publicKey, privateKey) && vitePub) {
    const alt = normalizeVapidB64(vitePub);
    if (vapidKeyPairMatches(alt, privateKey)) chosen = alt;
  }
  return { publicKey: chosen, privateKey, subject };
}

export function vapidConfigured(): boolean {
  return vapidEnvKeys() != null;
}

/**
 * Load VAPID from env, then watch_config if already stored.
 * Never generate keys on boot. Missing keys → null (Push stays off).
 */
export async function loadVapidKeys(sql: SqlQuery): Promise<VapidKeys | null> {
  const fromEnv = vapidEnvKeys();
  if (fromEnv) return fromEnv;

  try {
    const rows = await sql.query<{ key: string; value: string }>(
      `select key, value from watch_config where key in ('vapid_public', 'vapid_private', 'vapid_subject')`,
    );
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const publicKey = map.get("vapid_public");
    const privateKey = map.get("vapid_private");
    const subject = resolveVapidSubject(map.get("vapid_subject")).subject;
    if (publicKey && privateKey) {
      return {
        publicKey: normalizeVapidB64(publicKey),
        privateKey: normalizeVapidB64(privateKey),
        subject,
      };
    }
  } catch {
    /* table may be absent */
  }
  return null;
}

export async function loadVapidPublicKey(sql: SqlQuery): Promise<string | null> {
  const keys = await loadVapidKeys(sql);
  return keys?.publicKey ?? null;
}
