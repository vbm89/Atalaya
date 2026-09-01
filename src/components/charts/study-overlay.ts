import type {
  AutoscaleInfo,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import { interpolateTimeCoordinate, type TimePointX } from "@/lib/chart/setup-overlay";

export interface StudyFill {
  low: number;
  high: number;
  fill: string;
}

class StudyRenderer implements IPrimitivePaneRenderer {
  constructor(
    private fills: { y1: number; y2: number; x1: number; x2: number; fill: string }[],
    private lineX: number | null,
    private lineColor: string,
    private label: string,
    private labelColor: string,
  ) {}

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const pr = scope.verticalPixelRatio;
      const phr = scope.horizontalPixelRatio;
      for (const f of this.fills) {
        const x = Math.min(f.x1, f.x2) * phr;
        const w = Math.max(1, Math.abs(f.x2 - f.x1) * phr);
        const y = Math.min(f.y1, f.y2) * pr;
        const h = Math.max(1, Math.abs(f.y2 - f.y1) * pr);
        ctx.fillStyle = f.fill;
        ctx.fillRect(x, y, w, h);
      }
      if (this.lineX == null) return;
      const x = this.lineX * phr;
      ctx.strokeStyle = this.lineColor;
      ctx.lineWidth = Math.max(1, Math.round(phr));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scope.bitmapSize.height);
      ctx.stroke();
      if (!this.label) return;
      const fontPx = 11 * pr;
      ctx.font = `${fontPx}px IBM Plex Sans, sans-serif`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      const tx = x + 6 * phr;
      const ty = 8 * pr;
      ctx.lineWidth = 3 * pr;
      ctx.strokeStyle = "rgba(11,12,14,0.72)";
      ctx.strokeText(this.label, tx, ty);
      ctx.fillStyle = this.labelColor;
      ctx.fillText(this.label, tx, ty);
    });
  }
}

class StudyView implements IPrimitivePaneView {
  fills: { y1: number; y2: number; x1: number; x2: number; fill: string }[] = [];
  lineX: number | null = null;
  lineColor = "#4d8ec9";
  label = "";
  labelColor = "#4d8ec9";
  private z: "bottom" | "top";

  constructor(z: "bottom" | "top") {
    this.z = z;
  }

  zOrder() {
    return this.z;
  }

  renderer() {
    if (this.z === "bottom") {
      return new StudyRenderer(this.fills, null, this.lineColor, "", this.labelColor);
    }
    return new StudyRenderer([], this.lineX, this.lineColor, this.label, this.labelColor);
  }
}

class StartAxisView implements ISeriesPrimitiveAxisView {
  x = 0;
  textValue = "";
  color = "#4d8ec9";
  visibleFlag = false;

  coordinate() {
    return this.x;
  }

  text() {
    return this.textValue;
  }

  textColor() {
    return this.color;
  }

  backColor() {
    return "#14161a";
  }

  visible() {
    return this.visibleFlag;
  }
}

/**
 * Time-bounded study fills + start marker.
 * Does not capture hits. Does not participate in autoscale.
 */
export class StudyOverlay implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private timer = 0;
  private fillSpecs: StudyFill[];
  private startSec: number;
  private closedAtSec: number | null;
  private live: boolean;
  private lineColor: string;
  private label: string;
  private axisClock: string;
  private fillView = new StudyView("bottom");
  private lineView = new StudyView("top");
  private axisView = new StartAxisView();
  private pane = [this.fillView, this.lineView];
  private axis = [this.axisView];

  constructor(opts: {
    fills: StudyFill[];
    startSec: number;
    closedAtSec: number | null;
    live: boolean;
    lineColor: string;
    label: string;
    axisClock: string;
  }) {
    this.fillSpecs = opts.fills;
    this.startSec = opts.startSec;
    this.closedAtSec = opts.closedAtSec;
    this.live = opts.live;
    this.lineColor = opts.lineColor;
    this.label = opts.label;
    this.axisClock = opts.axisClock;
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.series = param.series;
    this.chart = param.chart as IChartApi;
    this.requestUpdate = param.requestUpdate;
    this.syncTimer();
  }

  detached() {
    this.clearTimer();
    this.series = null;
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews() {
    return this.pane;
  }

  timeAxisViews() {
    return this.axis;
  }

  autoscaleInfo(): AutoscaleInfo | null {
    return null;
  }

  updateAllViews() {
    const series = this.series;
    const chart = this.chart;
    if (!series || !chart) {
      this.fillView.fills = [];
      this.lineView.lineX = null;
      this.axisView.visibleFlag = false;
      return;
    }
    const data = series.data() as { time: unknown }[];
    const points: TimePointX[] = [];
    const ts = chart.timeScale();
    for (const row of data) {
      const t = typeof row.time === "number" ? row.time : Number(row.time);
      if (!Number.isFinite(t)) continue;
      const x = ts.timeToCoordinate(t as Time);
      if (x == null) continue;
      points.push({ time: t, x });
    }
    const nowSec = Date.now() / 1000;
    const endSec =
      this.closedAtSec != null
        ? Math.max(this.startSec, this.closedAtSec)
        : this.live
          ? Math.max(this.startSec, nowSec)
          : this.startSec;
    const x1 = interpolateTimeCoordinate(this.startSec, points);
    const x2 = interpolateTimeCoordinate(endSec, points);
    const fills: StudyView["fills"] = [];
    if (x1 != null && x2 != null && x2 > x1) {
      for (const spec of this.fillSpecs) {
        const y1 = series.priceToCoordinate(spec.high);
        const y2 = series.priceToCoordinate(spec.low);
        if (y1 == null || y2 == null) continue;
        fills.push({ y1, y2, x1, x2, fill: spec.fill });
      }
    }
    this.fillView.fills = fills;
    this.lineView.lineX = x1;
    this.lineView.lineColor = this.lineColor;
    this.lineView.label = this.label;
    this.lineView.labelColor = this.lineColor;
    this.axisView.x = x1 ?? 0;
    this.axisView.textValue = this.axisClock;
    this.axisView.color = this.lineColor;
    this.axisView.visibleFlag = x1 != null;
  }

  private syncTimer() {
    this.clearTimer();
    if (!this.live || this.closedAtSec != null) return;
    this.timer = window.setInterval(() => {
      this.requestUpdate?.();
    }, 1000);
  }

  private clearTimer() {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }
}
