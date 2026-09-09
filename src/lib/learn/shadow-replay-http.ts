import { timingSafeEqual } from "node:crypto";
import type { SqlQuery } from "../watch/store";
import { loadShadowEpisodes } from "./shadow-db";
import { analyzeShadowReplay } from "./shadow-analysis";
import { saveShadowReplayReport } from "./shadow-replay-store";
import { captureShadowIntrabar } from "./shadow-intrabar-capture";
import { buildShadowIntrabarReport } from "./shadow-intrabar";

export const SHADOW_REPLAY_HOST = "atalaya-dev.vercel.app";
const MIN_TOKEN_LEN = 16;
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function requestHost(request: Request): string {
  const raw = request.headers.get("host") ?? "";
  return raw.split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
}

function enabled(): boolean {
  const raw = typeof process === "undefined" ? undefined : process.env.SHADOW_REPLAY_ENABLED;
  return (raw?.trim() ?? "") === "true";
}

function replayToken(): string | null {
  const raw = typeof process === "undefined" ? undefined : process.env.SHADOW_REPLAY_TOKEN;
  const value = raw?.trim() ?? "";
  if (value.length < MIN_TOKEN_LEN) return null;
  return value;
}

export function authorizeShadowReplay(request: Request):
  | { ok: true }
  | { ok: false; status: number; error: string } {
  if (!enabled() || requestHost(request) !== SHADOW_REPLAY_HOST) return { ok: false, status: 404, error: "No encontrado." };
  if (request.method.toUpperCase() !== "POST") return { ok: false, status: 405, error: "Método no permitido." };
  const secret = replayToken();
  if (!secret) return { ok: false, status: 503, error: "Replay no disponible." };
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token || !equal(token, secret)) return { ok: false, status: 401, error: "No autorizado." };
  return { ok: true };
}

async function withSql<T>(fn: (sql: SqlQuery) => Promise<T>): Promise<T> {
  const databaseUrl = typeof process === "undefined" ? undefined : process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");
  const { Pool, types } = await import("pg");
  types.setTypeParser(OID_INT8, Number);
  types.setTypeParser(OID_DATE, (v: string) => v);
  types.setTypeParser(OID_INTERVAL, (v: string) => v);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sql: SqlQuery = { query: async <R = Record<string, unknown>>(text: string, params: unknown[] = []) => (await client.query(text, params)).rows as R[] };
    const out = await fn(sql);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function handleShadowReplay(request: Request): Promise<Response> {
  const auth = authorizeShadowReplay(request);
  if (!auth.ok) {
    const headers: Record<string, string> = {};
    if (auth.status === 405) headers.Allow = "POST";
    return Response.json({ error: auth.error }, { status: auth.status, headers });
  }

  try {
    const generatedAt = new Date().toISOString();
    const analysis = await withSql(async (sql) => {
      // Capture native 1M/5M research tape before replay so the next report can
      // compare decision cadence without changing V1 or fabricating intrabar data.
      await captureShadowIntrabar(sql);
      const episodes = await loadShadowEpisodes(sql);
      const report = analyzeShadowReplay(episodes);
      await saveShadowReplayReport(sql, report, generatedAt);
      const intrabar = await buildShadowIntrabarReport(sql, episodes);
      return { report, intrabar };
    });

    const extraTestN = Math.max(0, ...analysis.report.comparisons.map((c) => c.extraTestN));
    const evidenceLabel = analysis.report.comparisons.length
      ? analysis.report.comparisons.reduce((best, c) => c.extraTestN > best.extraTestN ? c : best).evidenceLabel
      : "INSUFFICIENT";

    return Response.json({
      ok: true,
      readOnly: false,
      persisted: true,
      host: SHADOW_REPLAY_HOST,
      generatedAt,
      episodesAnalyzed: analysis.report.replay.episodesAnalyzed,
      extraTestN,
      evidenceLabel,
      intrabar: analysis.intrabar,
      report: analysis.report,
    });
  } catch {
    return Response.json({ error: "Replay no disponible." }, { status: 503 });
  }
}
