import type {
  AutoscaleInfo,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import { zoneBandAutoscaleRange } from "@/lib/chart/setup-overlay";

export interface ZoneFill {
  low: number;
  high: number;
  fill: string;
}

class BandRenderer implements IPrimitivePaneRenderer {
  constructor(
    private y1: number | null,
    private y2: number | null,
    private fill: string,
  ) {}

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      if (this.y1 == null || this.y2 == null) return;
      const y1 = this.y1 * scope.verticalPixelRatio;
      const y2 = this.y2 * scope.verticalPixelRatio;
      const top = Math.min(y1, y2);
      const h = Math.max(1, Math.abs(y2 - y1));
      const ctx = scope.context;
      ctx.fillStyle = this.fill;
      ctx.fillRect(0, top, scope.bitmapSize.width, h);
    });
  }
}

class BandView implements IPrimitivePaneView {
  private y1: number | null = null;
  private y2: number | null = null;
  private series: ISeriesApi<SeriesType, Time> | null;

  constructor(
    series: ISeriesApi<SeriesType, Time> | null,
    private low: number,
    private high: number,
    private fill: string,
  ) {
    this.series = series;
  }

  bind(series: ISeriesApi<SeriesType, Time> | null) {
    this.series = series;
  }

  update() {
    if (!this.series) {
      this.y1 = null;
      this.y2 = null;
      return;
    }
    this.y1 = this.series.priceToCoordinate(this.high);
    this.y2 = this.series.priceToCoordinate(this.low);
  }

  zOrder() {
    return "bottom" as const;
  }

  renderer() {
    return new BandRenderer(this.y1, this.y2, this.fill);
  }
}

/** Horizontal fills at V1 prices. Does not move with last. */
export class ZoneBand implements ISeriesPrimitive<Time> {
  private views: BandView[];
  private extras: number[];
  private lockAutoscale: boolean;
  private low: number;
  private high: number;

  constructor(fills: ZoneFill[], extras: number[] = [], lockAutoscale = true) {
    this.extras = extras;
    this.lockAutoscale = lockAutoscale;
    const ys = fills.flatMap((f) => [f.low, f.high]);
    this.low = ys.length ? Math.min(...ys) : 0;
    this.high = ys.length ? Math.max(...ys) : 0;
    this.views = fills.map((f) => new BandView(null, f.low, f.high, f.fill));
  }

  attached(param: SeriesAttachedParameter<Time>) {
    for (const view of this.views) view.bind(param.series);
  }

  detached() {
    for (const view of this.views) view.bind(null);
  }

  updateAllViews() {
    for (const view of this.views) view.update();
  }

  paneViews() {
    return this.views;
  }

  autoscaleInfo(): AutoscaleInfo | null {
    const range = zoneBandAutoscaleRange(this.low, this.high, this.extras, this.lockAutoscale);
    if (!range) return null;
    return { priceRange: range };
  }
}
