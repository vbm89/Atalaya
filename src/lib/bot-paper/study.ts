import { contextAt, sessionId } from "../learn/price-behaviour/context.ts";
import { structureAt } from "../learn/price-behaviour/structure.ts";
import type { AssetId, Bar } from "../learn/price-behaviour/types.ts";
import type { StoredSignal } from "./store.ts";

/**
 * Telemetría de una operación PAPER. Usa las mismas lecturas ya cerradas
 * del motor (contextAt / htfBias / sessionId) y no vuelve a decidir.
 * H1 = 4 velas de 15m. H4 = 16. Sesión en UTC, en el cierre de la vela.
 */
export interface PaperStudy {
  h1: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  h4: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  marketState: string;
  event: string;
  setup: string | null;
  tier: "FULL" | "PARTIAL" | null;
  direction: "LONG" | "SHORT" | null;
  rr: number | null;
  atr: number | null;
  riskAtr: number | null;
  displacement: boolean | null;
  reclaim: boolean | null;
  location: boolean | null;
  structure: boolean | null;
  confirmation: boolean;
  hourUtc: number | null;
  session: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  resultR: number | null;
  /** R favorable antes del cierre. null = todavía abierta o no medida. */
  mfeR?: number | null;
  /** R adverso antes del cierre, negativo o cero. null = todavía abierta o no medida. */
  maeR?: number | null;
}

export function resultROf(result: "ABIERTA" | "SL" | "TP", rr: number): number | null {
  if (result === "TP") return rr;
  if (result === "SL") return -1;
  return null;
}

/**
 * MFE/MAE en R con velas posteriores a lastBarT, incluida la vela que cierra.
 * No mira la vela de entrada ni las velas posteriores al SL o al TP.
 * MAE es <= 0. No modifica la decisión ni el resultado.
 */
export function excursionR(
  row: { direction: "COMPRA" | "VENTA"; entry: number; stop: number; target: number; lastBarT: number },
  bars: readonly { t: number; h: number; l: number }[],
): { mfeR: number | null; maeR: number | null } {
  const risk = Math.abs(row.entry - row.stop);
  if (!(risk > 0) || !Number.isFinite(row.entry) || !Number.isFinite(row.stop) || !Number.isFinite(row.target)) {
    return { mfeR: null, maeR: null };
  }
  let mfe = 0;
  let mae = 0;
  let seen = false;
  for (const bar of bars) {
    if (!(bar.t > row.lastBarT) || !Number.isFinite(bar.h) || !Number.isFinite(bar.l)) continue;
    seen = true;
    if (row.direction === "COMPRA") {
      mfe = Math.max(mfe, bar.h - row.entry);
      mae = Math.max(mae, row.entry - bar.l);
    } else {
      mfe = Math.max(mfe, row.entry - bar.l);
      mae = Math.max(mae, bar.h - row.entry);
    }
    const stopHit = row.direction === "COMPRA" ? bar.l <= row.stop : bar.h >= row.stop;
    const targetHit = row.direction === "COMPRA" ? bar.h >= row.target : bar.l <= row.target;
    if (stopHit || targetHit) break;
  }
  if (!seen) return { mfeR: null, maeR: null };
  return { mfeR: mfe / risk, maeR: -mae / risk };
}

/** Presente en evidence: true o false medido. Ausente: no evaluado, nunca false. */
export function measuredFlag(evidence: Record<string, boolean>, key: string): boolean | null {
  if (!Object.prototype.hasOwnProperty.call(evidence, key)) return null;
  return evidence[key] === true;
}

export function captureStudy(
  bars: readonly Bar[],
  board: {
    asset: AssetId;
    lastBarT: number | null;
    marketState: string;
    event: string;
    setup: string | null;
    tier: "FULL" | "PARTIAL" | null;
    direction: "LONG" | "SHORT" | null;
    rr: number | null;
    entry: number | null;
    stop: number | null;
    target: number | null;
    confirmation: boolean;
    evidence: Record<string, boolean>;
  },
): PaperStudy {
  const i = bars.length - 1;
  const bar = i >= 0 ? bars[i]! : null;
  const closeT = board.lastBarT != null ? board.lastBarT + 900 : bar?.t ?? null;
  const structure = i >= 0 ? structureAt(bars, i) : null;
  const ctx = i >= 0 && structure ? contextAt(bars, i, board.asset, structure) : null;
  const atr = ctx?.atr ?? null;
  const riskAtr =
    atr != null && atr > 0 && board.entry != null && board.stop != null
      ? Math.abs(board.entry - board.stop) / atr
      : null;
  return {
    h1: ctx?.htf1h ?? "UNKNOWN",
    h4: ctx?.htf4h ?? "UNKNOWN",
    marketState: board.marketState,
    event: board.event,
    setup: board.setup,
    tier: board.tier,
    direction: board.direction,
    rr: board.rr,
    atr,
    riskAtr,
    displacement: measuredFlag(board.evidence, "displacement"),
    reclaim: measuredFlag(board.evidence, "reclaim"),
    location: measuredFlag(board.evidence, "location"),
    structure: measuredFlag(board.evidence, "structure"),
    confirmation: board.confirmation,
    hourUtc: closeT == null ? null : new Date(closeT * 1000).getUTCHours(),
    session: closeT == null ? null : sessionId(closeT, board.asset),
    entry: board.entry,
    stop: board.stop,
    target: board.target,
    resultR: null,
    mfeR: null,
    maeR: null,
  };
}

export const STUDY_MIN_N = 8;

export interface StudyCell {
  key: string;
  n: number;
  tp: number;
  sl: number;
  open: number;
  netR: number | null;
  enough: boolean;
}

export interface StudySlice {
  label: string;
  from: string | null;
  to: string | null;
  n: number;
  cells: StudyCell[];
}

function isoWeek(sec: number): string {
  const d = new Date(sec * 1000);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function day(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function rrBucket(rr: number | null | undefined): string {
  if (rr == null || !Number.isFinite(rr)) return "RR:NA";
  if (rr < 2) return "RR:1.5-2";
  if (rr < 3) return "RR:2-3";
  if (rr < 5) return "RR:3-5";
  return "RR:5+";
}

function flagLabel(value: boolean | null | undefined, hasStudy: boolean): string {
  if (!hasStudy) return "MISSING";
  if (value == null) return "UNEVALUATED";
  return String(value);
}

function featuresOf(row: StoredSignal): string[] {
  const study = row.study;
  const hour = study?.hourUtc ?? new Date(row.timestamp * 1000).getUTCHours();
  const session = study?.session ?? `hour-${hour}`;
  const out = [
    `tier:${row.tier}`,
    `setup:${row.setup}`,
    `state:${row.marketState}`,
    `event:${row.event}`,
    `dir:${row.direction}`,
    `session:${session}`,
    rrBucket(row.RR),
    `h1:${study?.h1 ?? "MISSING"}`,
    `h4:${study?.h4 ?? "MISSING"}`,
    `displacement:${flagLabel(study?.displacement, study != null)}`,
    `reclaim:${flagLabel(study?.reclaim, study != null)}`,
    `location:${flagLabel(study?.location, study != null)}`,
    `structure:${flagLabel(study?.structure, study != null)}`,
    `confirmation:${study ? String(study.confirmation) : String(row.confirmation)}`,
  ];
  return out;
}

function cellOf(key: string, rows: readonly StoredSignal[]): StudyCell {
  let tp = 0;
  let sl = 0;
  let open = 0;
  let net = 0;
  let scored = 0;
  for (const row of rows) {
    const r = row.resultR ?? resultROf(row.result, row.RR);
    if (row.result === "TP") tp += 1;
    else if (row.result === "SL") sl += 1;
    else open += 1;
    if (r != null) {
      net += r;
      scored += 1;
    }
  }
  const n = rows.length;
  return { key, n, tp, sl, open, netR: scored ? net : null, enough: n >= STUDY_MIN_N };
}

export function studySlices(signals: readonly StoredSignal[], asset: AssetId): StudySlice[] {
  const rows = signals.filter((row) => row.asset === asset).slice().sort((a, b) => a.timestamp - b.timestamp);
  const slices: { label: string; rows: StoredSignal[] }[] = [{ label: "MUESTRA", rows }];
  if (rows.length >= 2) {
    const mid = Math.floor(rows.length / 2);
    slices.push({ label: "TRAIN", rows: rows.slice(0, mid) }, { label: "TEST", rows: rows.slice(mid) });
  }
  const weeks = new Map<string, StoredSignal[]>();
  for (const row of rows) {
    const key = isoWeek(row.timestamp);
    const list = weeks.get(key) ?? [];
    list.push(row);
    weeks.set(key, list);
  }
  for (const [week, list] of weeks) slices.push({ label: week, rows: list });

  return slices.map(({ label, rows: part }) => {
    const groups = new Map<string, StoredSignal[]>();
    for (const row of part) {
      for (const key of featuresOf(row)) {
        const list = groups.get(key) ?? [];
        list.push(row);
        groups.set(key, list);
      }
    }
    const cells = [...groups.entries()]
      .map(([key, list]) => cellOf(key, list))
      .filter((cell) => cell.enough)
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
    return {
      label,
      from: part.length ? day(part[0]!.timestamp) : null,
      to: part.length ? day(part[part.length - 1]!.timestamp) : null,
      n: part.length,
      cells,
    };
  });
}

export function renderStudyReport(signals: readonly StoredSignal[]): string {
  const assets: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];
  const lines = [
    "# PAPER study",
    "",
    "Informe acumulativo. No es una regla y no demuestra edge.",
    `Una celda solo se imprime si N >= ${STUDY_MIN_N}.`,
    "TRAIN/TEST es la mitad cronológica de la muestra disponible, no un régimen distinto.",
    "H1/H4 faltan en operaciones anteriores a esta telemetría y aparecen como MISSING.",
    "Un flag ausente en evidence queda null (UNEVALUATED). No se reescriben operaciones ya guardadas.",
    "",
  ];
  for (const asset of assets) {
    const own = signals.filter((row) => row.asset === asset);
    lines.push(`## ${asset}`, "", `n=${own.length}`, "");
    if (own.length < 2) {
      lines.push("Muestra insuficiente para partir.", "");
      continue;
    }
    for (const slice of studySlices(signals, asset)) {
      lines.push(`### ${slice.label} ${slice.from ?? ""}..${slice.to ?? ""} n=${slice.n}`);
      if (!slice.cells.length) {
        lines.push("Ninguna celda alcanza el mínimo.", "");
        continue;
      }
      lines.push("| feature | N | TP | SL | abierta | R neto |");
      lines.push("|---|---:|---:|---:|---:|---:|");
      for (const cell of slice.cells) {
        const net = cell.netR == null ? "" : cell.netR.toFixed(2);
        lines.push(`| ${cell.key} | ${cell.n} | ${cell.tp} | ${cell.sl} | ${cell.open} | ${net} |`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
