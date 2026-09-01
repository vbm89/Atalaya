import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { ema, rsiWilder } from "@/lib/trading/indicators";
import type { ChartOverlays, ChartSeries } from "@/lib/chart/types";
import type { TickHandler } from "@/lib/chart/live";
import { liveQuotesSnapshot, subscribeLiveQuotes } from "@/lib/chart/live-quotes";
import { chartSetupLevels, setupAutoscaleLocked, setupLevelsKey, setupVisiblePriceRange, type ChartSetupLevels } from "@/lib/chart/setup-overlay";
import {
  CHART_BAR_SPACING,
  CHART_MIN_BAR_SPACING,
  CHART_RIGHT_OFFSET,
  CHART_ZOOM_IN,
  CHART_ZOOM_OUT,
  barSpacingForView,
  centerLogicalRange,
  defaultLogicalRange,
  defaultVisibleBars,
  zoomLogicalRange,
} from "@/lib/chart/view";
import type { AssetAnalysis, Candle } from "@/lib/trading/types";
import { formatPrice } from "@/lib/utils";
import { ZoneBand } from "./zone-band";

type CandleApi = ISeriesApi<"Candlestick">;
type LineApi = ISeriesApi<"Line">;
type HistApi = ISeriesApi<"Histogram">;

export interface CandleChartHandle {
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  centerNow: () => void;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function colors() {
  return {
    bg: cssVar("--color-bg", "#0b0c0e"),
    surface: cssVar("--color-surface", "#14161a"),
    fg: cssVar("--color-fg", "#f1f2f4"),
    muted: cssVar("--color-muted", "#8b909a"),
    subtle: cssVar("--color-subtle", "#6b7078"),
    border: cssVar("--color-border", "#2a2d34"),
    buy: cssVar("--color-buy", "#3d9a6a"),
    sell: cssVar("--color-sell", "#c45c5c"),
    wait: cssVar("--color-wait", "#c4a35a"),
    map: cssVar("--color-map", "#8fa3b8"),
    accent: cssVar("--color-accent", "#c5ccd6"),
  };
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (hex.startsWith("#") && (hex.length === 7 || hex.length === 4)) {
    const h =
      hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    const n = Number.parseInt(h.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const rgb = hex.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const [r, g, b] = rgb[1]!.split(",").map((x) => Number(x.trim()));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

/** Axis/crosshair only. Candle.time stays UTC unix seconds. */
const CHART_TZ = "Europe/Madrid";

function unixSec(time: Time): number | null {
  return typeof time === "number" && Number.isFinite(time) ? time : null;
}

function madridFormat(unix: number, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: CHART_TZ,
    hour12: false,
    ...opts,
  }).format(new Date(unix * 1000));
}

function chartTimeFormatter(time: Time): string {
  const sec = unixSec(time);
  if (sec == null) return "";
  return madridFormat(sec, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function chartTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string | null {
  const sec = unixSec(time);
  if (sec == null) return null;
  switch (tickMarkType) {
    case TickMarkType.Year:
      return madridFormat(sec, { year: "numeric" });
    case TickMarkType.Month:
      return madridFormat(sec, { month: "short" });
    case TickMarkType.DayOfMonth:
      return madridFormat(sec, { day: "2-digit" });
    case TickMarkType.Time:
      return madridFormat(sec, { hour: "2-digit", minute: "2-digit" });
    case TickMarkType.TimeWithSeconds:
      return madridFormat(sec, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    default:
      return madridFormat(sec, { hour: "2-digit", minute: "2-digit" });
  }
}

function toCandle(c: Candle) {
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function ohlcLine(c: Candle, digits: number): string {
  return `O ${formatPrice(c.open, digits)}  H ${formatPrice(c.high, digits)}  L ${formatPrice(c.low, digits)}  C ${formatPrice(c.close, digits)}`;
}

const CandleChartInner = forwardRef<
  CandleChartHandle,
  {
    series: ChartSeries;
    overlays: ChartOverlays;
    analysis: AssetAnalysis | null;
    frozenLevels?: ChartSetupLevels | null;
    focusSetup?: boolean;
    subscribeTick: (fn: TickHandler) => () => void;
    getBars: () => Candle[];
    hudEl?: HTMLElement | null;
    visibleLevels?: { zone: boolean; sl: boolean; tp1: boolean; tp2: boolean };
    lastPrice?: number | null;
  }
>(function CandleChartInner(
  { series, overlays, analysis, frozenLevels, focusSetup, subscribeTick, getBars, hudEl, visibleLevels, lastPrice },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLParagraphElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<CandleApi | null>(null);
  const volRef = useRef<HistApi | null>(null);
  const ema20Ref = useRef<LineApi | null>(null);
  const ema50Ref = useRef<LineApi | null>(null);
  const ema200Ref = useRef<LineApi | null>(null);
  const rsiRef = useRef<LineApi | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const lastLineRef = useRef<IPriceLine | null>(null);
  const zoneRef = useRef<ZoneBand | null>(null);
  const viewKeyRef = useRef("");
  const dataKeyRef = useRef("");
  const levelsKeyRef = useRef("");
  const indicatorKeyRef = useRef("");
  const viewTimerRef = useRef(0);
  const [chartBoot, setChartBoot] = useState(0);
  const levels = frozenLevels ?? (analysis ? chartSetupLevels(analysis) : null);

  const writeHud = (c: Candle | undefined) => {
    const text = c ? ohlcLine(c, series.digits) : "";
    if (hudEl) hudEl.textContent = text;
    else if (hudRef.current) hudRef.current.textContent = text;
  };

  const stampMeta = (visible?: number) => {
    const el = hostRef.current;
    if (!el) return;
    const n = getBars().length || series.candles.length;
    el.dataset.chartBars = String(n);
    el.dataset.chartTf = series.tf;
    el.dataset.chartMinSpacing = String(CHART_MIN_BAR_SPACING);
    if (visible != null) el.dataset.chartVisible = String(visible);
  };

  const applySetupScale = () => {
    const candle = candleRef.current;
    const lv = frozenLevels ?? (analysis ? chartSetupLevels(analysis) : null);
    const last = getBars().at(-1)?.close ?? series.candles.at(-1)?.close ?? null;
    if (!candle) return;
    if (!setupAutoscaleLocked(series.assetId)) {
      candle.applyOptions({ autoscaleInfoProvider: undefined });
      candle.priceScale().setAutoScale(true);
      return;
    }
    if (lv) {
      const range = setupVisiblePriceRange(lv, last);
      candle.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: range.min, maxValue: range.max },
        }),
      });
    } else {
      candle.applyOptions({ autoscaleInfoProvider: undefined });
    }
  };

  const applyDefaultView = () => {
    const chart = chartRef.current;
    const el = hostRef.current;
    if (!chart) return;
    const n = getBars().length || series.candles.length;
    if (!n) return;
    const width = Math.max(el?.clientWidth ?? 0, 1);
    const visible = defaultVisibleBars(series.tf, n, !!focusSetup, width);
    const range = defaultLogicalRange(n, visible);
    chart.timeScale().applyOptions({
      barSpacing: barSpacingForView(width, visible),
      minBarSpacing: CHART_MIN_BAR_SPACING,
      rightOffset: CHART_RIGHT_OFFSET,
    });
    chart.timeScale().setVisibleLogicalRange(range);
    applySetupScale();
    stampMeta(visible);
  };

  const centerNow = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const n = getBars().length || series.candles.length;
    if (!n) return;
    const current = chart.timeScale().getVisibleLogicalRange();
    const span = current ? Math.max(1, current.to - current.from) : defaultVisibleBars(series.tf, n, !!focusSetup);
    const next = centerLogicalRange(n, span);
    chart.timeScale().setVisibleLogicalRange(next);
    stampMeta(Math.max(0, Math.round(next.to - next.from)));
  };

  const zoomBy = (factor: number) => {
    const chart = chartRef.current;
    if (!chart) return;
    const n = getBars().length || series.candles.length;
    const current = chart.timeScale().getVisibleLogicalRange();
    const fallback = defaultLogicalRange(
      n,
      defaultVisibleBars(series.tf, n, !!focusSetup, hostRef.current?.clientWidth ?? 0),
    );
    const next = zoomLogicalRange(current ?? fallback, factor, n);
    chart.timeScale().setVisibleLogicalRange(next);
    stampMeta(Math.max(0, Math.round(next.to - next.from)));
  };

  const scheduleDefaultView = () => {
    applyDefaultView();
    requestAnimationFrame(() => {
      applyDefaultView();
      if (viewTimerRef.current) window.clearTimeout(viewTimerRef.current);
      viewTimerRef.current = window.setTimeout(() => {
        viewTimerRef.current = 0;
        applyDefaultView();
      }, 80);
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      resetView: applyDefaultView,
      zoomIn: () => zoomBy(CHART_ZOOM_IN),
      zoomOut: () => zoomBy(CHART_ZOOM_OUT),
      centerNow,
    }),
    [series.tf, series.candles.length, focusSetup, getBars],
  );

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const c = colors();
    let chart: IChartApi | null = null;
    let candles: CandleApi | null = null;
    let cancelled = false;
    let resizeRaf = 0;
    let primed = false;
    let onMove: ((param: MouseEventParams) => void) | null = null;
    let onRange: ((range: LogicalRange | null) => void) | null = null;

    const attach = () => {
      if (cancelled || chart) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 8 || h < 8) return;
      chart = createChart(el, {
        autoSize: false,
        width: w,
        height: h,
        layout: {
          background: { type: ColorType.Solid, color: c.bg },
          textColor: c.muted,
          fontFamily: "IBM Plex Sans, sans-serif",
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: c.border, style: LineStyle.Dotted },
          horzLines: { color: c.border, style: LineStyle.Dotted },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: c.subtle, width: 1, style: LineStyle.Dashed, labelBackgroundColor: c.surface },
          horzLine: { color: c.subtle, width: 1, style: LineStyle.Dashed, labelBackgroundColor: c.surface },
        },
        rightPriceScale: {
          borderColor: c.border,
          scaleMargins: { top: 0.06, bottom: overlays.volume ? 0.18 : 0.08 },
        },
        timeScale: {
          borderColor: c.border,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: CHART_RIGHT_OFFSET,
          barSpacing: CHART_BAR_SPACING,
          minBarSpacing: CHART_MIN_BAR_SPACING,
          shiftVisibleRangeOnNewBar: true,
          lockVisibleTimeRangeOnResize: true,
          allowBoldLabels: false,
          tickMarkFormatter: chartTickMarkFormatter,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: series.assetId === "US100",
        },
        handleScale: {
          axisPressedMouseMove: { time: true, price: true },
          mouseWheel: true,
          pinch: true,
          axisDoubleClickReset: true,
        },
        kineticScroll: { touch: true, mouse: false },
        localization: {
          locale: "es-ES",
          timeFormatter: chartTimeFormatter,
        },
      });
      candles = chart.addSeries(CandlestickSeries, {
        upColor: c.buy,
        downColor: c.sell,
        borderUpColor: c.buy,
        borderDownColor: c.sell,
        wickUpColor: c.buy,
        wickDownColor: c.sell,
      });
      chartRef.current = chart;
      candleRef.current = candles;
      lastLineRef.current = null;
      viewKeyRef.current = "";
      dataKeyRef.current = "";
      levelsKeyRef.current = "";
      indicatorKeyRef.current = "";

      onMove = (param: MouseEventParams) => {
        const raw = param.seriesData.get(candles!);
        const d = raw as { open?: number; high?: number; low?: number; close?: number } | undefined;
        if (!d || d.close == null) {
          writeHud(getBars().at(-1) ?? series.candles.at(-1));
          return;
        }
        writeHud({
          time: 0,
          open: d.open ?? d.close,
          high: d.high ?? d.close,
          low: d.low ?? d.close,
          close: d.close,
          volume: null,
        });
      };
      chart.subscribeCrosshairMove(onMove);

      onRange = (range: LogicalRange | null) => {
        if (!range || !hostRef.current) return;
        hostRef.current.dataset.chartVisible = String(Math.max(0, Math.round(range.to - range.from)));
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      setChartBoot((n) => n + 1);
    };

    const resize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        if (!chart) {
          attach();
          return;
        }
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w > 8 && h > 8) {
          chart.resize(w, h);
          if (!primed) {
            primed = true;
            scheduleDefaultView();
          }
        }
      });
    };
    attach();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    window.visualViewport?.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      if (viewTimerRef.current) window.clearTimeout(viewTimerRef.current);
      if (chart && onRange) chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      if (chart && onMove) chart.unsubscribeCrosshairMove(onMove);
      if (chart) chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      rsiRef.current = null;
      linesRef.current = [];
      zoneRef.current = null;
    };
  }, [series.assetId, series.digits]);

  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle) return;
    const c = colors();
    const live = getBars();
    const bars = live.length ? live : series.candles;
    const dataKey = `${series.assetId}:${series.tf}:${bars.length}:${bars[0]?.time ?? 0}`;
    const dataChanged = dataKeyRef.current !== dataKey;
    if (dataChanged) {
      dataKeyRef.current = dataKey;
      candle.setData(bars.map(toCandle));
      candle.applyOptions({
        priceFormat: {
          type: "price",
          precision: series.digits,
          minMove: Number((10 ** -series.digits).toFixed(series.digits)),
        },
      });
      writeHud(bars.at(-1));
      stampMeta();
    }

    const showVol = overlays.volume && series.volumeAvailable;
    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.06, bottom: showVol ? 0.18 : 0.08 },
    });
    const indicatorKey = `${dataKey}:${overlays.ema20 ? 1 : 0}${overlays.ema50 ? 1 : 0}${overlays.ema200 ? 1 : 0}${overlays.rsi ? 1 : 0}${showVol ? 1 : 0}`;
    if (indicatorKeyRef.current !== indicatorKey) {
      indicatorKeyRef.current = indicatorKey;
      const closes = bars.map((b) => b.close);
      const times = bars.map((b) => b.time as UTCTimestamp);

      const setLine = (
        lineRef: { current: LineApi | null },
        on: boolean,
        period: number,
        color: string,
        pane = 0,
      ) => {
        if (!on) {
          if (lineRef.current) {
            chart.removeSeries(lineRef.current);
            lineRef.current = null;
          }
          return;
        }
        const values = ema(closes, period);
        const data = values
          .map((v, i) =>
            Number.isFinite(v) ? { time: times[i]!, value: v } : null,
          )
          .filter((x): x is { time: UTCTimestamp; value: number } => x != null);
        if (!lineRef.current) {
          lineRef.current = chart.addSeries(
            LineSeries,
            { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
            pane,
          );
        }
        lineRef.current.setData(data);
      };

      setLine(ema20Ref, overlays.ema20, 20, c.accent);
      setLine(ema50Ref, overlays.ema50, 50, c.map);
      setLine(ema200Ref, overlays.ema200, 200, c.wait);

      if (!showVol) {
        if (volRef.current) {
          chart.removeSeries(volRef.current);
          volRef.current = null;
        }
      } else {
        if (!volRef.current) {
          volRef.current = chart.addSeries(HistogramSeries, {
            priceScaleId: "vol",
            priceLineVisible: false,
            lastValueVisible: false,
          });
          chart.priceScale("vol").applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
          });
        }
        volRef.current.setData(
          bars.map((b) => ({
            time: b.time as UTCTimestamp,
            value: b.volume ?? 0,
            color: b.close >= b.open ? c.buy : c.sell,
          })),
        );
      }

      if (!overlays.rsi) {
        if (rsiRef.current) {
          chart.removeSeries(rsiRef.current);
          rsiRef.current = null;
        }
      } else {
        const rsi = rsiWilder(closes, 14);
        const data = rsi
          .map((v, i) =>
            Number.isFinite(v) ? { time: times[i]!, value: v } : null,
          )
          .filter((x): x is { time: UTCTimestamp; value: number } => x != null);
        if (!rsiRef.current) {
          rsiRef.current = chart.addSeries(
            LineSeries,
            {
              color: c.wait,
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: true,
              priceFormat: { type: "price", precision: 1, minMove: 0.1 },
            },
            1,
          );
          const panes = chart.panes();
          const rsiPane = panes[1];
          if (rsiPane) rsiPane.setHeight(64);
        }
        rsiRef.current.setData(data);
      }
    }

    const lv = frozenLevels ?? (analysis ? chartSetupLevels(analysis) : null);
    const visKey = `${visibleLevels?.zone !== false ? 1 : 0}${visibleLevels?.sl !== false ? 1 : 0}${visibleLevels?.tp1 !== false ? 1 : 0}${visibleLevels?.tp2 !== false ? 1 : 0}`;
    const lvKey = `${setupLevelsKey(lv)}:${visKey}`;
    if (levelsKeyRef.current !== lvKey) {
      levelsKeyRef.current = lvKey;
      for (const line of linesRef.current) candle.removePriceLine(line);
      linesRef.current = [];
      if (zoneRef.current) {
        candle.detachPrimitive(zoneRef.current);
        zoneRef.current = null;
      }

      if (lv) {
        const dirColor = lv.direction === "buy" ? c.buy : c.sell;
        const extras = [lv.stopLoss, lv.takeProfit1, lv.entry];
        if (lv.takeProfit2 != null) extras.push(lv.takeProfit2);
        const showZone = visibleLevels?.zone !== false;
        const band = new ZoneBand(
          lv.zoneLow,
          lv.zoneHigh,
          withAlpha(dirColor, showZone ? 0.16 : 0),
          extras,
          setupAutoscaleLocked(series.assetId),
        );
        candle.attachPrimitive(band);
        zoneRef.current = band;

        const add = (price: number, title: string, color: string, dashed = false) => {
          if (!Number.isFinite(price)) return;
          linesRef.current.push(
            candle.createPriceLine({
              price,
              title,
              color,
              lineWidth: 1,
              lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
              axisLabelVisible: true,
            }),
          );
        };
        if (visibleLevels?.zone !== false) {
          add(lv.zoneHigh, lv.direction === "buy" && lv.state === "entry" ? "Entrada" : "Zona", dirColor, !(lv.direction === "buy" && lv.state === "entry"));
          add(lv.zoneLow, lv.direction === "sell" && lv.state === "entry" ? "Entrada" : "Zona", dirColor, !(lv.direction === "sell" && lv.state === "entry"));
        }
        if (visibleLevels?.sl !== false) add(lv.stopLoss, "SL", c.sell);
        if (visibleLevels?.tp1 !== false) add(lv.takeProfit1, "TP1", c.buy);
        if (visibleLevels?.tp2 !== false && lv.takeProfit2 != null) add(lv.takeProfit2, "TP2", c.buy);
        if (lv.state === "pending" || lv.state === "map") {
          add(lv.invalidation, "Inv.", c.subtle, true);
        }
      }
    }

    const viewKey = `${series.assetId}:${series.tf}:${focusSetup ? 1 : 0}`;
    if (viewKeyRef.current !== viewKey) {
      viewKeyRef.current = viewKey;
      scheduleDefaultView();
    }
  }, [chartBoot, series.assetId, series.tf, series.digits, series.volumeAvailable, overlays, analysis, frozenLevels, focusSetup, getBars, visibleLevels]);

  useEffect(() => {
    const c = colors();
    let n = 0;
    let windowStart = performance.now();
    return subscribeTick((bar, isNewBar) => {
      const candle = candleRef.current;
      if (!candle) return;
      candle.update(toCandle(bar));
      if (isNewBar && volRef.current && bar.volume != null) {
        volRef.current.update({
          time: bar.time as UTCTimestamp,
          value: bar.volume,
          color: bar.close >= bar.open ? c.buy : c.sell,
        });
      }
      if (isNewBar) {
        const all = getBars();
        const closes = all.map((b) => b.close);
        const t = bar.time as UTCTimestamp;
        const patch = (lineRef: { current: LineApi | null }, period: number) => {
          if (!lineRef.current) return;
          const values = ema(closes, period);
          const v = values[values.length - 1];
          if (v != null && Number.isFinite(v)) lineRef.current.update({ time: t, value: v });
        };
        patch(ema20Ref, 20);
        patch(ema50Ref, 50);
        patch(ema200Ref, 200);
        if (rsiRef.current) {
          const rsi = rsiWilder(closes, 14);
          const v = rsi[rsi.length - 1];
          if (v != null && Number.isFinite(v)) rsiRef.current.update({ time: t, value: v });
        }
        stampMeta();
      }
      writeHud(bar);
      n += 1;
      const now = performance.now();
      if (now - windowStart >= 1000) {
        const el = hostRef.current;
        if (el) el.dataset.chartTickHz = String(n);
        n = 0;
        windowStart = now;
      }
    });
  }, [subscribeTick, getBars, series.digits]);

  useEffect(() => {
    const apply = (price: number | null | undefined) => {
      const candle = candleRef.current;
      if (!candle) return;
      if (price == null || !(price > 0) || !Number.isFinite(price)) return;
      if (!lastLineRef.current) {
        const c = colors();
        lastLineRef.current = candle.createPriceLine({
          price,
          title: "Last",
          color: c.accent,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
        });
        return;
      }
      lastLineRef.current.applyOptions({ price });
    };
    apply(liveQuotesSnapshot()[series.assetId] ?? lastPrice);
    return subscribeLiveQuotes(() => {
      apply(liveQuotesSnapshot()[series.assetId]);
    });
  }, [series.assetId, chartBoot, lastPrice]);

  return (
    <div className="atalaya-chart">
      {!hudEl ? (
        <p ref={hudRef} className="sr-only" />
      ) : null}
      {levels ? (
        <span
          data-chart-setup={levels.state}
          data-chart-dir={levels.direction}
          data-chart-zone={levels.labelZone}
          data-chart-sl={levels.labelSl}
          data-chart-tp1={levels.labelTp1}
          data-chart-tp2={levels.labelTp2 ?? ""}
          data-chart-freeze={frozenLevels ? "1" : "0"}
          className="sr-only"
        />
      ) : null}
      <div ref={hostRef} className="atalaya-chart-host" data-chart-canvas="1" />
    </div>
  );
});

export const CandleChart = memo(CandleChartInner);
