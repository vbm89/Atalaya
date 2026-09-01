import type { EpisodeDraft } from "../watch/episode";
import type { EpisodeFreeze } from "../watch/freeze";
import type { HistoryRow } from "../watch/store";
import type { EpisodeContext } from "./context";
import type { JournalEntry } from "./journal";
import { JOURNAL_LABEL } from "./journal";
import { sessionLabel } from "./session";
import type { TapeBar, TapeTf } from "./tape";
import { detectGaps } from "./tape";

const PENDING = "PENDIENTE";

export interface PostMortemFact {
  key: string;
  label: string;
  value: string;
  pending: boolean;
}

export interface PostMortem {
  episodeId: string;
  complete: boolean;
  outcome: string;
  facts: PostMortemFact[];
  pending: string[];
  disclaimer: string;
}

function fact(key: string, label: string, value: string | null | undefined, pendingIfEmpty = true): PostMortemFact {
  if (value == null || value === "" || value === PENDING) {
    return { key, label, value: PENDING, pending: pendingIfEmpty };
  }
  return { key, label, value, pending: false };
}

function fmtMs(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function fmtNum(n: number | null | undefined, digits = 2): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toFixed(digits);
}

function riskUnit(ep: EpisodeDraft): number | null {
  const entry = ep.direction === "sell" ? ep.zoneHigh : ep.zoneLow;
  const r = Math.abs(entry - ep.sl);
  return r > 0 && Number.isFinite(r) ? r : null;
}

function outcomeLabel(outcome: string | null): string {
  if (outcome === "tp1") return "TP1";
  if (outcome === "tp2") return "TP2";
  if (outcome === "sl") return "SL";
  if (outcome === "expired") return "EXPIRADA";
  if (outcome === "pending" || outcome === "none" || outcome == null) return PENDING;
  return outcome.toUpperCase();
}

function tapeStats(bars: TapeBar[], tf: TapeTf): { count: number; gaps: number } {
  const times = bars.filter((b) => b.tf === tf).map((b) => b.t);
  return { count: times.length, gaps: detectGaps(times, tf).length };
}

export function buildPostMortem(args: {
  row: HistoryRow;
  context: EpisodeContext | null;
  tape: TapeBar[];
  journal: JournalEntry | null;
  freeze?: EpisodeFreeze | null;
}): PostMortem {
  const ep = args.row.episode;
  const outcome = args.row.outcome;
  const terminal = outcome === "tp1" || outcome === "tp2" || outcome === "sl" || outcome === "expired";
  const pending: string[] = [];
  const facts: PostMortemFact[] = [];

  const push = (f: PostMortemFact) => {
    facts.push(f);
    if (f.pending) pending.push(f.label);
  };

  push(fact("outcome", "Resultado V1", outcomeLabel(outcome), !terminal));

  const duration =
    ep.closedAtMs != null ? ep.closedAtMs - ep.openedAtMs : null;
  push(fact("duration", "Duración", fmtMs(duration)));

  const touchMs =
    args.row.firstTouchAtMs != null ? args.row.firstTouchAtMs - ep.openedAtMs : null;
  push(
    fact(
      "timeToTouch",
      "Tiempo hasta primer toque",
      args.row.firstTouch ? fmtMs(touchMs) : terminal ? "Sin toque de SL/TP" : null,
      !args.row.firstTouch && !terminal,
    ),
  );

  const r = riskUnit(ep);
  const mfe = args.row.mfe;
  const mae = args.row.mae;
  push(fact("mfe", "MFE", fmtNum(mfe, 2)));
  push(fact("mae", "MAE", fmtNum(mae, 2)));
  push(
    fact(
      "mfeR",
      "MFE en R",
      r && mfe != null ? `${(mfe / r).toFixed(2)} R` : null,
    ),
  );
  push(
    fact(
      "maeR",
      "MAE en R",
      r && mae != null ? `${(mae / r).toFixed(2)} R` : null,
    ),
  );

  const ctx = args.context;
  push(fact("session", "Sesión", ctx?.session ? sessionLabel(ctx.session) : null));
  push(
    fact(
      "when",
      "Apertura Madrid",
      ctx?.madridDate && ctx.madridTime ? `${ctx.madridDate} ${ctx.madridTime}` : null,
    ),
  );
  push(fact("weekday", "Día", ctx?.weekday ?? null));
  push(fact("dataStatus", "Estado de datos", ctx?.dataStatus ?? args.freeze?.dataStatus ?? null));
  push(fact("basis", "Basis XAU", fmtNum(ctx?.basis ?? args.freeze?.basis ?? null, 2)));

  if (!ctx) pending.push("Contexto histórico");
  if (ctx && ctx.calendar.length) {
    push(
      fact(
        "calendar",
        "Eventos ±2 h",
        ctx.calendar.map((e) => `${e.impact} ${e.title}`).join(" · "),
        false,
      ),
    );
  } else {
    push(fact("calendar", "Eventos ±2 h", ctx ? "Ninguno en ventana" : null, !ctx));
  }

  const look15 = tapeStats(args.tape.filter((b) => b.role === "lookback"), "15m");
  const fwd15 = tapeStats(args.tape.filter((b) => b.role === "forward"), "15m");
  const look1h = tapeStats(args.tape.filter((b) => b.role === "lookback"), "1h");
  const look4h = tapeStats(args.tape.filter((b) => b.role === "lookback"), "4h");

  push(
    fact(
      "tape15",
      "Cinta 15m",
      args.tape.length
        ? `lookback ${look15.count} · forward ${fwd15.count}${look15.gaps + fwd15.gaps ? ` · huecos ${look15.gaps + fwd15.gaps}` : ""}`
        : null,
    ),
  );
  push(fact("tape1h", "Cinta 1h lookback", look1h.count ? String(look1h.count) : null));
  push(fact("tape4h", "Cinta 4h lookback", look4h.count ? String(look4h.count) : null));

  const warnings = ctx?.warnings ?? args.freeze?.warnings ?? null;
  push(
    fact(
      "warnings",
      "Avisos V1 en freeze",
      warnings && warnings.length ? warnings.join(" · ") : ctx || args.freeze ? "Ninguno" : null,
      !(ctx || args.freeze),
    ),
  );

  if (args.journal) {
    push(fact("journal", "Diario humano", JOURNAL_LABEL[args.journal.action], false));
  } else {
    push(fact("journal", "Diario humano", "Sin anotar", false));
  }

  push(fact("git", "SHA de código", ctx?.gitSha ?? null));
  push(fact("v1", "Motor", ctx?.v1Label ?? "V1", false));

  return {
    episodeId: ep.episodeId,
    complete: terminal && pending.length === 0,
    outcome: outcomeLabel(outcome),
    facts,
    pending,
    disclaimer:
      "Resumen factual del freeze, la cinta, el desenlace y el contexto histórico. No es una explicación causal. No modifica V1.",
  };
}
