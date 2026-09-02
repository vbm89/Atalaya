import { formatPrice } from "../utils";
import type { AssetAnalysis, AssetId, SetupProposal, SetupState } from "../trading/types";
import { displayEntryPrice } from "../chart/labels";
import { setupStateEs } from "../watch/memory";
import type { HistoryRow } from "../watch/store";
import { freezeField } from "../watch/freeze";
import { glossaryById } from "./glossary";

export type CheckStatus = "ok" | "fail" | "na" | "pending";

export interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  meaning: string;
  seeing: string;
}

export interface ExplainLevels {
  zone: string;
  entry: string | null;
  sl: string;
  tp1: string;
  tp2: string;
  rr: string;
}

export interface ExplainView {
  source: "live" | "history";
  assetId: AssetId | "—";
  direction: "COMPRA" | "VENTA" | "—";
  timeframe: "M15";
  state: SetupState;
  stateLabel: string;
  headline: string;
  motive: string;
  checks: CheckItem[];
  extras: string[];
  levels: ExplainLevels | null;
  unmappedReasons: string[];
  disclaimer: string;
}

export interface ExplainInput {
  source: "live" | "history";
  id?: AssetId | null;
  setupState: SetupState;
  waitReason: string | null;
  missingForEntry: string | null;
  warnings: string[];
  bias4hLabel: string | null;
  setup: SetupProposal | null;
  digits: number;
  volumeRatio15: number | null;
  volumeAvailable: boolean;
  highImpact: boolean | null;
  underlyingClosed: boolean | null;
  dataStatus: string | null;
}

export const EXPLAIN_DISCLAIMER = "ANÁLISIS — NO ES UNA ORDEN. P5 explica V1; no cambia la decisión.";
export const PENDING_PHOTO = "Pendiente — este dato no está incluido en la fotografía actual.";
export const PENDING_HISTORY = "Pendiente — no estaba guardado en el freeze de este episodio.";

export interface WaitGuide {
  id: string;
  /** Static samples used in tests (exact V1 strings when not dynamic). */
  sample: string;
  match: (reason: string) => boolean;
  plain: string;
  failCheck: string | null;
}

function includes(reason: string, snippet: string): boolean {
  return reason.includes(snippet);
}

/** Catalog of V1 waitReason strings. Unknown reasons are surfaced, never dropped. */
export const WAIT_GUIDES: WaitGuide[] = [
  {
    id: "data-htf",
    sample: "ESPERAR — DATOS NO DISPONIBLES en 15M, 1H o 4H.",
    match: (s) => includes(s, "DATOS NO DISPONIBLES en 15M, 1H o 4H"),
    plain: "Faltan velas cerradas de 15M, 1H o 4H. Sin esos datos V1 no analiza.",
    failCheck: "estructura",
  },
  {
    id: "data-15m",
    sample: "ESPERAR — DATOS NO DISPONIBLES en 15M.",
    match: (s) => includes(s, "DATOS NO DISPONIBLES en 15M.") || /DATOS NO DISPONIBLES en 15M(?!,)/.test(s),
    plain: "No hay vela 15M para evaluar el trigger.",
    failCheck: "trigger",
  },
  {
    id: "data-tfs",
    sample: "ESPERAR — DATOS NO DISPONIBLES en 15M, 1H.",
    match: (s) => /DATOS NO DISPONIBLES en /.test(s) && !includes(s, "precio"),
    plain: "Faltan temporalidades del motor. V1 no inventa velas.",
    failCheck: "estructura",
  },
  {
    id: "xau-spot",
    sample: "ESPERAR — DATOS NO DISPONIBLES — precio XAUUSD spot.",
    match: (s) => includes(s, "precio XAUUSD spot.") && includes(s, "DATOS NO DISPONIBLES"),
    plain: "No hay precio SPOT de oro. V1 no usa solo el proxy para XAU.",
    failCheck: "estructura",
  },
  {
    id: "xau-spot-unconfirmed",
    sample: "ESPERAR — precio XAUUSD spot no confirmado (cruce gold-api/OANDA incompleto).",
    match: (s) => includes(s, "precio XAUUSD spot no confirmado"),
    plain: "El spot de oro no está cruzado. No se fabrica el precio.",
    failCheck: "estructura",
  },
  {
    id: "xau-proxy",
    sample: "ESPERAR — DATOS NO DISPONIBLES — precio PROXY XAUUSDT.",
    match: (s) => includes(s, "precio PROXY XAUUSDT"),
    plain: "Falta el proxy de velas XAUUSDT.",
    failCheck: "estructura",
  },
  {
    id: "xau-basis",
    sample: "ESPERAR — basis PROXY/SPOT (0.400 %) supera max(0.25 %, ATR% 1h).",
    match: (s) => includes(s, "basis PROXY/SPOT"),
    plain: "El desfase proxy/spot es demasiado grande. V1 espera.",
    failCheck: "estructura",
  },
  {
    id: "no-price",
    sample: "ESPERAR — no hay precio real disponible.",
    match: (s) => includes(s, "no hay precio real disponible"),
    plain: "No hay precio de mercado. Sin precio no hay setup.",
    failCheck: "estructura",
  },
  {
    id: "source-error",
    sample: "ESPERAR — error de fuente. timeout",
    match: (s) => includes(s, "error de fuente"),
    plain: "La fuente de datos falló. No se simula el mercado.",
    failCheck: "estructura",
  },
  {
    id: "invalidated-high",
    sample: "ESPERAR — invalidado (cierre 15M > 77.964).",
    match: (s) => /invalidado \(cierre 15M >/.test(s),
    plain: "Un cierre 15M superó la invalidación. La idea de venta ya no vale.",
    failCheck: "invalidacion",
  },
  {
    id: "invalidated-low",
    sample: "ESPERAR — invalidado (cierre 15M < 77.382).",
    match: (s) => /invalidado \(cierre 15M </.test(s),
    plain: "Un cierre 15M perforó la invalidación. La idea de compra ya no vale.",
    failCheck: "invalidacion",
  },
  {
    id: "no-bos",
    sample: "ESPERAR — no hay BOS 4H por cierre.",
    match: (s) => includes(s, "no hay BOS 4H por cierre"),
    plain: "Falta un BOS 4H confirmado por cierre.",
    failCheck: "bos",
  },
  {
    id: "no-origin",
    sample: "ESPERAR — BOS 4H sin zona 4H/1H de origen válida.",
    match: (s) => includes(s, "sin zona 4H/1H de origen válida"),
    plain: "Hay BOS 4H pero no hay zona de origen HTF válida.",
    failCheck: "origen",
  },
  {
    id: "no-tp",
    sample: "ESPERAR — no hay TP estructural a favor.",
    match: (s) => includes(s, "no hay TP estructural a favor"),
    plain: "No hay objetivo estructural. V1 no inventa un TP.",
    failCheck: "rr",
  },
  {
    id: "no-sl",
    sample: "ESPERAR — no hay ancla estructural de SL.",
    match: (s) => includes(s, "no hay ancla estructural de SL"),
    plain: "No hay ancla para el stop. Sin SL no hay setup.",
    failCheck: "sl",
  },
  {
    id: "rr-12",
    sample: "ESPERAR — R:R estructural por debajo de 1,2.",
    match: (s) => includes(s, "R:R estructural por debajo de 1,2"),
    plain: "El R:R estructural no llega a 1,2.",
    failCheck: "rr",
  },
  {
    id: "rr-15",
    sample: "ESPERAR — R:R estructural por debajo de 1,5.",
    match: (s) => includes(s, "R:R estructural por debajo de 1,5"),
    plain: "El R:R estructural no llega a 1,5.",
    failCheck: "rr",
  },
  {
    id: "quality",
    sample: "ESPERAR — el setup no alcanza calidad MEDIA.",
    match: (s) => includes(s, "no alcanza calidad MEDIA"),
    plain: "El setup no llega a calidad media. V1 no lo publica.",
    failCheck: "origen",
  },
  {
    id: "caducity",
    sample: "ESPERAR — sin setup válido actualmente.",
    match: (s) => includes(s, "sin setup válido actualmente"),
    plain: "El origen caducó. Ya no hay setup vigente.",
    failCheck: "caducidad",
  },
  {
    id: "choch",
    sample: "ESPERAR — CHOCH 1H contrario.",
    match: (s) => includes(s, "CHOCH 1H contrario"),
    plain: "La estructura de 1H giró en contra del BOS 4H.",
    failCheck: "estructura",
  },
  {
    id: "supersede",
    sample: "ESPERAR — mapa supersedido (viaje sin retest).",
    match: (s) => includes(s, "mapa supersedido"),
    plain: "El precio viajó sin retest. El mapa ya no vale.",
    failCheck: "caducidad",
  },
  {
    id: "no-opportunity",
    sample: "ESPERAR — no existe oportunidad definida.",
    match: (s) => includes(s, "no existe oportunidad definida"),
    plain: "No hay oportunidad definida ahora.",
    failCheck: "bos",
  },
];

export function classifyWaitReason(reason: string | null): WaitGuide | null {
  if (!reason) return null;
  for (const g of WAIT_GUIDES) {
    if (g.match(reason)) return g;
  }
  return null;
}

const MISSING_FRAGMENTS: Array<{ snippet: string; check: string; plain: string }> = [
  {
    snippet: "cierre 15M de fallo de aceptación o rechazo",
    check: "trigger",
    plain: "Falta el cierre 15M que confirma el trigger.",
  },
  {
    snippet: "sesgo 4H intacto",
    check: "estructura",
    plain: "El sesgo 4H ya no coincide con la dirección del setup.",
  },
  {
    snippet: "noticia de alto impacto próxima",
    check: "noticia",
    plain: "Hay una noticia de alto impacto en la ventana de V1. Bloquea ENTRADA nueva.",
  },
  {
    snippet: "señal tardía",
    check: "trigger",
    plain: "El precio ya recorrió demasiado del camino a TP1. V1 no da ENTRADA tardía.",
  },
  {
    snippet: "volumen 15M insuficiente",
    check: "volumen",
    plain: "El volumen del trigger 15M no llega al umbral de V1.",
  },
  {
    snippet: "volumen 4H muerto",
    check: "volumen",
    plain: "El volumen 4H está muerto. No hay ENTRADA.",
  },
  {
    snippet: "mercado del subyacente cerrado",
    check: "mercado",
    plain: "El subyacente está cerrado (sesión). No hay ENTRADA.",
  },
  {
    snippet: "salida 15M de la zona a favor",
    check: "retorno",
    plain: "El precio aún no ha cerrado fuera de la zona a favor.",
  },
];

export function missingParts(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .replace(/^Falta:\s*/i, "")
    .replace(/\.\s*$/, "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
}

function meaning(id: string, fallback: string): string {
  return glossaryById(id)?.what ?? fallback;
}

function check(
  id: string,
  label: string,
  status: CheckStatus,
  meaningText: string,
  seeing: string,
): CheckItem {
  return { id, label, status, meaning: meaningText, seeing };
}

function pendingText(source: ExplainInput["source"]): string {
  return source === "history" ? PENDING_HISTORY : PENDING_PHOTO;
}

function volumeSeeing(input: ExplainInput, passed: boolean, failed: boolean): { status: CheckStatus; seeing: string } {
  if (failed) {
    const n = input.volumeRatio15;
    return {
      status: "fail",
      seeing:
        n != null
          ? `V1 lista volumen insuficiente. Ratio 15M: ${n.toFixed(2)}.`
          : "V1 lista volumen insuficiente. El ratio no viene en esta fotografía.",
    };
  }
  if (input.volumeRatio15 != null) {
    return {
      status: passed ? "ok" : "na",
      seeing: `Ratio 15M del análisis: ${input.volumeRatio15.toFixed(2)}. Informativo; el umbral es el de V1.`,
    };
  }
  if (input.volumeAvailable === false && input.source === "live") {
    return { status: passed ? "ok" : "pending", seeing: "Volumen no disponible en este feed. V1 lo trata como dato, no se inventa." };
  }
  if (passed) {
    return { status: "ok", seeing: "V1 no bloqueó por volumen. El ratio no está en esta fotografía." };
  }
  return { status: "pending", seeing: pendingText(input.source) };
}

function newsSeeing(input: ExplainInput, failed: boolean): { status: CheckStatus; seeing: string } {
  if (failed || input.highImpact === true) {
    return { status: "fail", seeing: "V1 marca noticia de alto impacto próxima (calendario, no RSS)." };
  }
  if (input.highImpact === null && input.source === "history") {
    return { status: "pending", seeing: pendingText(input.source) };
  }
  return { status: "ok", seeing: "No hay bloqueo de noticia de alto impacto en este análisis." };
}

function marketSeeing(input: ExplainInput, failed: boolean): { status: CheckStatus; seeing: string } {
  if (failed || input.underlyingClosed === true) {
    return { status: "fail", seeing: "V1 marca el subyacente cerrado. No hay ENTRADA." };
  }
  if (input.underlyingClosed === null && input.source === "history") {
    return { status: "pending", seeing: pendingText(input.source) };
  }
  return { status: "ok", seeing: "Sesión: no hay bloqueo de subyacente cerrado." };
}

function levelsFromSetup(setup: SetupProposal, digits: number): ExplainLevels {
  const entryPx = displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high);
  return {
    zone: `${formatPrice(setup.zone.low, digits)} – ${formatPrice(setup.zone.high, digits)}`,
    entry: formatPrice(entryPx, digits),
    sl: formatPrice(setup.stopLoss, digits),
    tp1: formatPrice(setup.takeProfit1, digits),
    tp2: setup.takeProfit2 != null ? formatPrice(setup.takeProfit2, digits) : "n/d",
    rr: `1 : ${setup.riskReward.toFixed(1)}`,
  };
}

function levelsFromHistory(row: HistoryRow): ExplainLevels | null {
  const ep = row.episode;
  const digits = 2;
  const entryPx = displayEntryPrice(ep.direction, ep.zoneLow, ep.zoneHigh);
  const rr = ep.freeze?.riskReward;
  return {
    zone: `${formatPrice(ep.zoneLow, digits)} – ${formatPrice(ep.zoneHigh, digits)}`,
    entry: formatPrice(entryPx, digits),
    sl: formatPrice(ep.sl, digits),
    tp1: formatPrice(ep.tp1, digits),
    tp2: ep.tp2 != null ? formatPrice(ep.tp2, digits) : "n/d",
    rr: rr != null && Number.isFinite(rr) ? `1 : ${rr.toFixed(1)}` : pendingText("history"),
  };
}

export function explain(input: ExplainInput): ExplainView {
  const state = input.setupState;
  const setup = input.setup;
  const missing = missingParts(input.missingForEntry);
  const unmappedMissing: string[] = [];
  const failByCheck = new Map<string, string>();
  for (const part of missing) {
    const hit = MISSING_FRAGMENTS.find((f) => part.includes(f.snippet));
    if (hit) failByCheck.set(hit.check, hit.plain);
    else unmappedMissing.push(part);
  }

  const waitGuide = classifyWaitReason(input.waitReason);
  const unmappedReasons: string[] = [];
  if (input.waitReason && !waitGuide) unmappedReasons.push(input.waitReason);

  const extras: string[] = [];
  for (const w of input.warnings) extras.push(w);
  for (const u of unmappedMissing) extras.push(`Falta (texto V1): ${u}`);
  for (const u of unmappedReasons) extras.push(`Motivo V1 (sin plantilla): ${u}`);

  let headline: string;
  let motive: string;
  if (state === "entry") {
    headline = "V1 da ENTRADA porque se cumplieron las condiciones del motor.";
    motive = "Todas las puertas listadas abajo están cubiertas según este análisis. Análisis, no orden.";
  } else if (state === "pending") {
    headline = "La estructura y la zona son válidas, pero todavía falta la confirmación necesaria.";
    motive = input.missingForEntry ?? "Falta confirmación 15M. No es orden.";
  } else if (state === "map") {
    headline = "Existe una zona potencial, pero todavía no se cumplen todas las condiciones para preparar una entrada.";
    motive = input.missingForEntry ?? "Falta: salida 15M de la zona a favor.";
  } else {
    headline = "Todavía no hay entrada.";
    motive = waitGuide?.plain ?? input.waitReason ?? "ESPERAR — no existe oportunidad definida.";
  }

  const waitFail = state === "wait" ? waitGuide?.failCheck ?? null : null;
  const hasSetup = setup != null && state !== "wait";

  const estructuraSeeing =
    input.bias4hLabel && input.bias4hLabel !== "Sin datos"
      ? `Sesgo 4H del análisis: ${input.bias4hLabel}.`
      : state === "wait" && waitFail === "estructura"
        ? motive
        : input.source === "history"
          ? pendingText(input.source)
          : input.bias4hLabel
            ? `Sesgo 4H: ${input.bias4hLabel}.`
            : pendingText(input.source);

  const bosStatus: CheckStatus =
    state === "wait" && (waitFail === "bos" || waitFail === "estructura" && waitGuide?.id === "no-bos")
      ? "fail"
      : state === "wait" && (waitGuide?.id === "data-htf" || waitGuide?.id === "data-tfs" || waitGuide?.id === "source-error" || waitGuide?.id === "no-price")
        ? "na"
        : hasSetup || state === "entry" || state === "pending" || state === "map"
          ? "ok"
          : waitFail === "bos"
            ? "fail"
            : "na";

  const originStatus: CheckStatus =
    waitFail === "origen" || waitGuide?.id === "no-origin"
      ? "fail"
      : hasSetup
        ? "ok"
        : waitFail === "bos" || bosStatus === "na" || bosStatus === "fail"
          ? "na"
          : "na";

  const zonaStatus: CheckStatus = hasSetup ? "ok" : originStatus === "fail" ? "fail" : "na";
  const retornoStatus: CheckStatus =
    state === "map" || failByCheck.has("retorno")
      ? "fail"
      : state === "pending" || state === "entry"
        ? "ok"
        : "na";
  const triggerStatus: CheckStatus =
    state === "entry"
      ? "ok"
      : failByCheck.has("trigger") || waitFail === "trigger"
        ? "fail"
        : state === "pending"
          ? "fail"
          : state === "map"
            ? "na"
            : "na";

  const volFail = failByCheck.has("volumen");
  const volPassed = state === "entry" || (hasSetup && !volFail);
  const vol = volumeSeeing(input, volPassed && !volFail, volFail);

  const rrStatus: CheckStatus =
    waitFail === "rr"
      ? "fail"
      : setup
        ? "ok"
        : input.source === "history" && input.setup == null
          ? "pending"
          : "na";
  const rrSeeing =
    setup
      ? `R:R estructural del análisis: 1 : ${setup.riskReward.toFixed(1)}.`
      : waitFail === "rr"
        ? motive
        : pendingText(input.source);

  const newsFail = failByCheck.has("noticia");
  const news = newsSeeing(input, newsFail);
  const mktFail = failByCheck.has("mercado");
  const mkt = marketSeeing(input, mktFail);

  const slStatus: CheckStatus = waitFail === "sl" ? "fail" : setup ? "ok" : "na";
  const invStatus: CheckStatus =
    waitFail === "invalidacion" ? "fail" : setup ? "ok" : "na";
  const cadStatus: CheckStatus = waitFail === "caducidad" ? "fail" : "na";

  const checks: CheckItem[] = [
    check(
      "estructura",
      "Estructura 4H",
      failByCheck.has("estructura") ? "fail" : waitFail === "estructura" ? "fail" : hasSetup || (input.bias4hLabel && input.bias4hLabel !== "Sin datos") ? (bosStatus === "na" && state === "wait" ? (waitFail === "estructura" ? "fail" : "na") : "ok") : waitFail === "estructura" ? "fail" : "na",
      meaning("estructura", "Sesgo 4H del mercado."),
      failByCheck.get("estructura") ?? estructuraSeeing,
    ),
    check(
      "bos",
      "BOS 4H",
      bosStatus,
      meaning("bos", "Ruptura de estructura 4H por cierre."),
      bosStatus === "fail"
        ? motive
        : bosStatus === "ok"
          ? "V1 tiene BOS 4H por cierre. Sin él no habría setup."
          : "No aplica todavía: primero hace falta estructura/datos.",
    ),
    check(
      "origen",
      "Zona de origen HTF",
      originStatus,
      meaning("origen-htf", "Zona anclada en 4H o 1H."),
      originStatus === "fail"
        ? waitGuide?.plain ?? motive
        : originStatus === "ok" && setup
          ? `Zona de origen ${formatPrice(setup.zone.low, input.digits)} – ${formatPrice(setup.zone.high, input.digits)}.`
          : originStatus === "na"
            ? "No aplica todavía."
            : pendingText(input.source),
    ),
    check(
      "retorno",
      "Retorno / salida de zona",
      retornoStatus,
      meaning("mapa", "Salida 15M de la zona a favor y retest."),
      retornoStatus === "fail"
        ? failByCheck.get("retorno") ?? "El precio aún no ha cerrado fuera de la zona a favor."
        : retornoStatus === "ok"
          ? "V1 considera la zona armada (ya no es MAPA)."
          : "No aplica todavía.",
    ),
    check(
      "volumen",
      "Volumen",
      state === "wait" && !volFail ? "na" : vol.status,
      meaning("volumen", "Actividad de la vela 15M/4H."),
      state === "wait" && !volFail ? "No aplica todavía." : vol.seeing,
    ),
    check(
      "rr",
      "R:R estructural",
      rrStatus,
      meaning("rr", "Recompensa TP1 / riesgo SL."),
      rrSeeing,
    ),
    check(
      "trigger",
      "Trigger M15",
      triggerStatus,
      meaning("trigger", "Cierre 15M de fallo de aceptación o rechazo."),
      triggerStatus === "ok"
        ? "V1 tiene el cierre 15M de trigger. Una mecha sola no bastaría."
        : triggerStatus === "fail"
          ? failByCheck.get("trigger") ?? "Falta el cierre 15M que confirma el trigger."
          : "No aplica todavía.",
    ),
    check(
      "noticia",
      "Noticias (calendario)",
      state === "wait" && !newsFail ? "na" : news.status,
      meaning("noticia", "Evento de alto impacto del calendario."),
      state === "wait" && !newsFail ? "No es el bloqueo en este caso." : news.seeing,
    ),
    check(
      "mercado",
      "Mercado / subyacente",
      state === "wait" && !mktFail ? "na" : mkt.status,
      meaning("subyacente", "Sesión del subyacente."),
      state === "wait" && !mktFail ? "No es el bloqueo en este caso." : mkt.seeing,
    ),
    check(
      "sl",
      "SL",
      slStatus,
      meaning("sl", "Stop estructural."),
      slStatus === "ok" && setup
        ? `SL del análisis: ${formatPrice(setup.stopLoss, input.digits)}.`
        : slStatus === "fail"
          ? motive
          : "No aplica todavía.",
    ),
    check(
      "invalidacion",
      "Invalidación",
      invStatus,
      meaning("invalidacion", "Cierre 15M que anula el BOS."),
      invStatus === "fail"
        ? input.waitReason ?? motive
        : invStatus === "ok" && setup
          ? `Invalidación del análisis: ${formatPrice(setup.invalidation, input.digits)}.`
          : "No aplica todavía.",
    ),
    check(
      "caducidad",
      "Caducidad",
      cadStatus,
      meaning("caducidad", "El origen deja de ser válido."),
      cadStatus === "fail" ? motive : "No hay caducidad activa en este estado.",
    ),
  ];

  const direction: ExplainView["direction"] = setup
    ? setup.direction === "buy"
      ? "COMPRA"
      : "VENTA"
    : "—";

  return {
    source: input.source,
    assetId: input.id ?? "—",
    direction,
    timeframe: "M15",
    state,
    stateLabel: setupStateEs(state),
    headline,
    motive,
    checks,
    extras,
    levels: setup ? levelsFromSetup(setup, input.digits) : null,
    unmappedReasons,
    disclaimer: EXPLAIN_DISCLAIMER,
  };
}

export function explainFromAnalysis(asset: AssetAnalysis): ExplainView {
  const tf15 = asset.timeframes.find((t) => t.timeframe === "15m");
  const highImpact =
    (asset.setup?.warnings ?? []).some((w) => /impacto|calendario|noticia/i.test(w)) ||
    missingParts(asset.setup?.missingForEntry ?? null).some((p) => p.includes("noticia de alto impacto"));
  return explain({
    source: "live",
    id: asset.id,
    setupState: asset.setupState,
    waitReason: asset.waitReason,
    missingForEntry: asset.setup?.missingForEntry ?? null,
    warnings: asset.setup?.warnings ?? [],
    bias4hLabel: asset.bias4hLabel,
    setup: asset.setup,
    digits: asset.digits,
    volumeRatio15: tf15?.indicators.volumeRatio ?? null,
    volumeAvailable: tf15?.indicators.volumeAvailable ?? false,
    highImpact,
    underlyingClosed: asset.dataStatus === "session_closed",
    dataStatus: asset.dataStatus,
  });
}

export function explainFromHistory(row: HistoryRow): ExplainView {
  const ep = row.episode;
  const freeze = ep.freeze;
  const inv = freezeField(freeze?.invalidation);
  const rr = freezeField(freeze?.riskReward);
  const fakeSetup: SetupProposal = {
    state: ep.openedState,
    kind: ep.kind === "break-retest" ? "break-retest" : "continuation",
    direction: ep.direction,
    zone: { low: ep.zoneLow, high: ep.zoneHigh },
    invalidation: inv ?? ep.sl,
    stopLoss: ep.sl,
    takeProfit1: ep.tp1,
    takeProfit2: ep.tp2,
    riskReward: rr != null && Number.isFinite(rr) ? rr : 0,
    quality: freeze?.quality === "alta" ? "alta" : "media",
    qualityPhase: freezeField(freeze?.qualityPhase) ?? "preliminar",
    supersedeLevel: null,
    missingForEntry: freezeField(freeze?.missingForEntry),
    slWide: freezeField(freeze?.slWide) ?? false,
    warnings: freeze?.warnings ?? [],
    managementNote: "",
    entryLabel: "",
  };
  const withLevels = explain({
    source: "history",
    id: ep.assetId,
    setupState: ep.openedState,
    waitReason: freezeField(freeze?.waitReason),
    missingForEntry: freezeField(freeze?.missingForEntry),
    warnings: freeze?.warnings ?? [],
    bias4hLabel: freezeField(freeze?.bias4hLabel),
    setup: fakeSetup,
    digits: 2,
    volumeRatio15: freezeField(freeze?.volumeRatio15),
    volumeAvailable: freezeField(freeze?.volumeAvailable15) ?? false,
    highImpact: freeze ? freeze.highImpact : null,
    underlyingClosed: freeze ? freeze.underlyingClosed : null,
    dataStatus: freezeField(freeze?.dataStatus),
  });
  const pendingIfMissing: Record<string, boolean> = {
    estructura: freezeField(freeze?.bias4hLabel) == null,
    bos: freezeField(freeze?.bias4hLabel) == null,
    origen: freezeField(freeze?.bias4hLabel) == null,
    retorno: freezeField(freeze?.missingForEntry) == null && ep.openedState === "map",
    volumen: freezeField(freeze?.volumeRatio15) == null,
    trigger: freezeField(freeze?.missingForEntry) == null && ep.openedState === "pending",
    invalidacion: inv == null,
    rr: rr == null || !Number.isFinite(rr),
  };
  const checks = withLevels.checks.map((c) => {
    if (pendingIfMissing[c.id]) {
      return { ...c, status: "pending" as const, seeing: PENDING_HISTORY };
    }
    return c;
  });
  return {
    ...withLevels,
    motive:
      ep.openedState === "entry"
        ? "Episodio histórico. Los niveles salen del freeze/episodio. Lo que no se fotografió se marca Pendiente."
        : withLevels.motive,
    checks,
    levels: levelsFromHistory(row),
    extras: [
      ...withLevels.extras,
      row.outcome && row.outcome !== "pending" ? `Desenlace posterior (no es V1): ${row.outcome}.` : "",
    ].filter(Boolean),
  };
}
