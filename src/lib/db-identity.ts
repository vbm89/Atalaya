import { createHash } from "node:crypto";

/**
 * DB identity gate (fail-safe). DEV cannot prove its DATABASE_URL is not PROD's,
 * so the Postgres pool is READ ONLY unless DB_IDENTITY_ALLOW equals the
 * fingerprint of the DATABASE_URL in use. The fingerprint is a truncated
 * sha256 of host + database name (no user, password or query): it identifies
 * the database without revealing the connection string. Whoever sets
 * DB_IDENTITY_ALLOW asserts that this fingerprint is NOT the PROD database.
 * The gate does not prove isolation by itself.
 */
export function dbFingerprint(url: string | undefined): string | null {
  if (!url || !url.trim()) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
    const db = u.pathname.replace(/^\//, "");
    return createHash("sha256").update(`atalaya-db-id:v1:${host}/${db}`).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

export type DbWriteGate = { fingerprint: string | null; writable: boolean };

export function dbWriteGate(env: Record<string, string | undefined> = process.env): DbWriteGate {
  const fingerprint = dbFingerprint(env.DATABASE_URL);
  const allow = env.DB_IDENTITY_ALLOW?.trim();
  return { fingerprint, writable: fingerprint != null && !!allow && allow === fingerprint };
}
