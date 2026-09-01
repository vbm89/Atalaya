/** 0.2px/bar ≈ 1950 velas en un iPhone de 390px. Permite ver todo el histórico cargado. */
export const CHART_MIN_BAR_SPACING = 0.2;

/** Espaciado inicial; la vista por defecto fija el rango lógico, no este valor. */
export const CHART_BAR_SPACING = 8;

export const CHART_RIGHT_OFFSET = 5;

/** Máximo por petición (Binance/Bitget). No se inventan velas. */
export const CHART_HISTORY_LIMIT = 1000;

/** Zoom in extremo: ~12 velas, como un gráfico de trading móvil. */
export const CHART_MIN_VISIBLE_BARS = 12;

export const CHART_ZOOM_OUT = 1.85;
export const CHART_ZOOM_IN = 1 / 1.85;

/** Menos velas = velas más grandes. Referencias del brief, no rígidas. */
const VISIBLE_BY_TF: Record<string, number> = {
  "1m": 120,
  "5m": 110,
  "15m": 90,
  "30m": 80,
  "1h": 70,
  "4h": 60,
  "1d": 50,
  "1w": 40,
  "1M": 36,
};

export function defaultVisibleBars(
  tf: string,
  count: number,
  focusSetup = false,
  widthPx = 0,
): number {
  if (count <= 0) return 0;
  const base = VISIBLE_BY_TF[tf] ?? 90;
  let target = focusSetup ? Math.max(base, Math.min(110, base + 10)) : base;
  if (widthPx >= 700) target = Math.round(target * 1.35);
  return Math.max(40, Math.min(count, target));
}

export function defaultLogicalRange(
  barCount: number,
  visible: number,
  rightOffset = CHART_RIGHT_OFFSET,
): { from: number; to: number } {
  const vis = Math.max(1, Math.min(visible, Math.max(barCount, 1)));
  return {
    from: Math.max(0, barCount - vis),
    to: barCount + rightOffset,
  };
}

/** CENTRAR: mismo zoom (span), volver al precio actual. No es AJUSTAR. */
export function centerLogicalRange(
  barCount: number,
  span: number,
  rightOffset = CHART_RIGHT_OFFSET,
): { from: number; to: number } {
  const vis = Math.max(CHART_MIN_VISIBLE_BARS, span);
  return {
    from: Math.max(0, barCount - vis),
    to: barCount + rightOffset,
  };
}

export function barSpacingForView(widthPx: number, visible: number): number {
  if (!(widthPx > 0) || !(visible > 0)) return CHART_BAR_SPACING;
  return Math.max(CHART_MIN_BAR_SPACING, widthPx / visible);
}

export function maxBarsAtMinSpacing(
  widthPx: number,
  minBarSpacing = CHART_MIN_BAR_SPACING,
): number {
  if (!(widthPx > 0) || !(minBarSpacing > 0)) return 0;
  return Math.floor(widthPx / minBarSpacing);
}

/** Zoom anclado al borde derecho (vela actual), como MetaTrader. */
export function zoomLogicalRange(
  range: { from: number; to: number },
  factor: number,
  barCount: number,
  rightOffset = CHART_RIGHT_OFFSET,
): { from: number; to: number } {
  const span = Math.max(1, range.to - range.from);
  const maxSpan = Math.max(CHART_MIN_VISIBLE_BARS, barCount + rightOffset);
  const next = Math.min(maxSpan, Math.max(CHART_MIN_VISIBLE_BARS, span * factor));
  const to = range.to;
  const from = to - next;
  if (from < 0) return { from: 0, to: next };
  return { from, to };
}
