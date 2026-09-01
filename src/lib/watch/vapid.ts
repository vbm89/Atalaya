import type { SqlQuery } from "./store";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Apple and RFC 8292 reject mailto:…@….local. Always a real https origin. */
export const DEFAULT_VAPID_SUBJECT = "https://atalaya-nu.vercel.app";

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

export function inspectVapidEnv(): {
  configured: boolean;
  subjectKind: "https" | "mailto";
  subjectOverridden: boolean;
} {
  const info = resolveVapidSubject(process.env.VAPID_SUBJECT);
  return {
    configured: vapidEnvKeys() != null,
    subjectKind: info.kind,
    subjectOverridden: info.overridden,
  };
}

export function vapidEnvKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || process.env.VITE_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = resolveVapidSubject(process.env.VAPID_SUBJECT).subject;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
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
    if (publicKey && privateKey) return { publicKey, privateKey, subject };
  } catch {
    /* table may be absent */
  }
  return null;
}

export async function loadVapidPublicKey(sql: SqlQuery): Promise<string | null> {
  const keys = await loadVapidKeys(sql);
  return keys?.publicKey ?? null;
}
