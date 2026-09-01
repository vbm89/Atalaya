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

/** Horizontal zone fill. Levels come from the engine; this only paints. */
export class ZoneBand implements ISeriesPrimitive<Time> {
  private view: BandView;
  private extras: number[];
  private low: number;
  private high: number;

  constructor(low: number, high: number, fill: string, extras: number[] = []) {
    this.low = low;
    this.high = high;
    this.extras = extras;
    this.view = new BandView(null, low, high, fill);
  }

  attached(param: SeriesAttachedParameter<Time>) {
    this.view.bind(param.series);
  }

  detached() {
    this.view.bind(null);
  }

  updateAllViews() {
    this.view.update();
  }

  paneViews() {
    return [this.view];
  }

  autoscaleInfo(): AutoscaleInfo | null {
    const vals = [this.low, this.high, ...this.extras].filter((n) => Number.isFinite(n));
    if (vals.length < 2) return null;
    return {
      priceRange: {
        minValue: Math.min(...vals),
        maxValue: Math.max(...vals),
      },
    };
  }
}
