import type { SqlQuery } from "./store";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidEnvKeys(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || process.env.VITE_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:noreply@atalaya.local";
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
    const subject = map.get("vapid_subject") || "mailto:noreply@atalaya.local";
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
