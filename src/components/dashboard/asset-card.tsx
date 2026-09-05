import { useState } from "react";
import { ChevronRight, HelpCircle, Star } from "lucide-react";
import { cn, formatDateTime, formatPct, formatPrice, decodeEntities } from "@/lib/utils";
import type { AssetAnalysis, AssetId, Timeframe } from "@/lib/trading/types";
import { hasChartableSetup } from "@/lib/chart/setup-overlay";
import { displayEntryPrice } from "@/lib/chart/labels";
import { setupDistance, distanceUnavailableLabel } from "@/lib/chart/zone-distance";
import { analysisPriceCaption } from "@/lib/broker/broker-view";
import type { AssetWatch } from "@/lib/watch/memory";
import { setupStateEs, watchPhaseCaption } from "@/lib/watch/memory";
import { assetDataLamp } from "@/lib/watch/feed-lamp";
import { tileStatusChips } from "@/lib/watch/market-session";
import { WatchPhaseBadge } from "./signal-badge";
import { Sparkline } from "./sparkline";
import { DataLampChip } from "./data-lamp";
import { LiveQuoteReadout } from "./live-quote-readout";
import { AssetMark, ASSET_SUBTITLE } from "./marks";


const TF_ORDER: Timeframe[] = ["5m", "15m", "1h", "4h"];
const CHART_FAV_KEY = "atalaya:chart-favs:v1";

function readChartFavs(): AssetId[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHART_FAV_KEY);
    return raw ? (JSON.parse(raw) as AssetId[]) : [];
  } catch {
    return [];
  }
}

function writeChartFavs(ids: AssetId[]) {
  try {
    window.localStorage.setItem(CHART_FAV_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function AssetCard({
  asset,
  watch,
  onOpen,
  onViewChart,
  onWhy,
}: {
  asset: AssetAnalysis;
  watch?: AssetWatch | null;
  onOpen: () => void;
  onViewChart?: () => void;
  onWhy?: () => void;
}) {
  const chg = asset.dayChangePct;
  const up = chg == null ? null : chg >= 0;
  const news = asset.news[0];
  const lastAt = asset.lastDataAt ?? asset.marketTime;
  const proxy = asset.instrumentKind === "proxy";
  const isXau = asset.id === "XAUUSD";
  const displayPrice = isXau ? asset.priceSpot : asset.price;
  const chartable = hasChartableSetup(asset) && onViewChart != null;
  const phase = watch?.phase ?? (asset.setupState === "wait" ? "wait" : "live");
  const liveSetup = asset.setup;
  const dist =
    liveSetup && phase !== "expired"
      ? setupDistance({
          analysisPrice: asset.price,
          frozen: false,
          zoneLow: liveSetup.zone.low,
          zoneHigh: liveSetup.zone.high,
          entry: displayEntryPrice(liveSetup.direction, liveSetup.zone.low, liveSetup.zone.high),
        })
      : null;
  const dataLamp = assetDataLamp({
    dataStatus: asset.dataStatus,
    dataStatusLabel: asset.dataStatusLabel,
    lastDataAt: asset.lastDataAt,
    price: displayPrice,
  });

  return (
    <article
      className="rounded-[var(--radius-2xl)] bg-surface p-4 shadow-[var(--shadow-border)]"
      data-watch-phase={phase}
      data-watch-asset={asset.id}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left transition-opacity duration-150"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted">{asset.name}</p>
            <h2 className="text-lg font-semibold tracking-tight">{asset.label}</h2>
          </div>
          <div className="flex flex-col items-end gap-1">
            <WatchPhaseBadge phase={phase} signal={asset.signal} />
            <DataLampChip lamp={dataLamp.lamp} label={dataLamp.label} />
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium tracking-wide",
                proxy ? "bg-wait-dim text-wait" : "bg-elevated text-muted",
              )}
            >
              {proxy ? "PROXY" : "NATIVO"}
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <LiveQuoteReadout
              id={asset.id}
              digits={asset.digits}
              snapshotPrice={asset.price}
              snapshotSpot={asset.priceSpot}
              size="lg"
              align="left"
            />
            {isXau ? (
              <p className="mt-1 text-xs font-medium tracking-wider text-subtle uppercase">
                Precio de análisis · SPOT · no es last T4Trade
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs font-medium tracking-wider text-muted uppercase">
                  Precio de análisis
                </p>
                <p className="mt-0.5 text-xs font-medium tracking-wide text-subtle">
                  {analysisPriceCaption(asset.id, asset)}
                </p>
              </>
            )}
            {dist ? (
              <p className="mt-1 text-xs text-muted" data-zone-distance data-distance-source={dist.source}>
                {dist.label}
                {liveSetup
                  ? ` · ENTRADA V1 ${formatPrice(displayEntryPrice(liveSetup.direction, liveSetup.zone.low, liveSetup.zone.high), asset.digits)}`
                  : ""}
              </p>
            ) : phase === "expired" ? (
              <p className="mt-1 text-xs text-subtle" data-zone-distance="unavailable">
                {distanceUnavailableLabel(true)}
              </p>
            ) : null}
            <p
              className={cn(
                "mt-1.5 font-mono text-sm tabular",
                up == null && "text-muted",
                up === true && "text-buy",
                up === false && "text-sell",
              )}
            >
              {chg == null ? "var. n/d" : formatPct(chg)}
            </p>
          </div>
          <div className="w-28 shrink-0">
            <Sparkline values={asset.sparkline} positive={up} />
          </div>
        </div>

        {isXau ? (
          <div className="mt-2 space-y-0.5 font-mono text-xs tabular text-muted">
            <p>
              PROXY XAUUSDT:{" "}
              {asset.priceProxy == null
                ? "DATOS NO DISPONIBLES"
                : formatPrice(asset.priceProxy, asset.digits)}
            </p>
            <p>BASIS: {fmtBasis(asset.basis, asset.basisPct, asset.digits)}</p>
          </div>
        ) : null}

        <dl className="mt-3 space-y-1 text-xs">
          {isXau ? (
            <>
              <Meta label="Fuente precio" value="SPOT" />
              <Meta label="Fuente velas" value="PROXY" />
            </>
          ) : (
            <>
              <Meta label="Fuente" value={asset.venue || asset.dataSource} />
              <Meta label="Símbolo" value={asset.feedSymbol || "—"} />
              <Meta label="Tipo" value={proxy ? "PROXY · no es precio de bróker" : "NATIVO"} />
            </>
          )}
          <Meta
            label="Última actualización"
            value={lastAt ? formatDateTime(lastAt) : "DATOS NO DISPONIBLES"}
          />
          <Meta label="Estado" value={asset.dataStatusLabel || "n/d"} />
        </dl>

        <p className="mt-2 flex flex-wrap gap-1.5">
          {TF_ORDER.map((tf) => {
            const row = asset.timeframes.find((t) => t.timeframe === tf);
            const on = row?.sufficient === true;
            return (
              <span
                key={tf}
                className={cn(
                  "rounded-full px-2 py-0.5 font-mono text-xs tabular",
                  on ? "bg-elevated text-fg" : "bg-wait-dim text-wait",
                )}
              >
                {tf}
                {on ? "" : " n/d"}
              </span>
            );
          })}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Row label="Tendencia" value={cap(asset.trend)} />
          <Row label="Volatilidad" value={cap(asset.volatility)} />
          <Row label="Soportes" value={fmtLevels(asset.supports, asset.digits)} />
          <Row label="Resistencias" value={fmtLevels(asset.resistances, asset.digits)} />
        </dl>

        <p className="mt-3 text-sm leading-snug text-muted">{asset.technicalSummary}</p>

        <SetupLine asset={asset} watch={watch ?? null} />

        {dataLamp.lamp === "delayed" ? (
          <p className="mt-2 text-xs leading-snug text-wait" data-feed-note="delayed">
            El mercado/feed está retrasado. La información puede no estar actualizada. V1 no cambia.
          </p>
        ) : dataLamp.lamp === "unavailable" ? (
          <p className="mt-2 text-xs leading-snug text-sell" data-feed-note="unavailable">
            DATOS NO DISPONIBLES. No es un ESPERAR de V1.
          </p>
        ) : null}

        {news ? (
          <p className="mt-3 text-xs leading-snug text-subtle">{decodeEntities(news.title)}</p>
        ) : null}
      </button>

      <div className="mt-3 flex gap-2">
        {chartable ? (
          <button
            type="button"
            onClick={onViewChart}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-[var(--radius-md)] bg-elevated px-3 text-sm font-medium"
          >
            VER GRÁFICO
            <ChevronRight className="size-4" />
          </button>
        ) : null}
        {onWhy ? (
          <button
            type="button"
            onClick={onWhy}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-[var(--radius-md)] bg-elevated px-3 text-sm font-medium"
          >
            <HelpCircle className="size-4" />
            ¿Por qué?
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function MarketTile({
  asset,
  onOpen,
}: {
  asset: AssetAnalysis;
  onOpen: () => void;
}) {
  const chg = asset.dayChangePct;
  const up = chg == null ? null : chg >= 0;
  const [starred, setStarred] = useState(() => readChartFavs().includes(asset.id));
  const setup = asset.setup;
  const chips = tileStatusChips({
    id: asset.id,
    dataStatus: asset.dataStatus,
    setupState: asset.setupState,
    direction: setup?.direction ?? null,
  });

  return (
    <div
      data-watch-asset={asset.id}
      data-market-session={chips.session.kind}
      data-market-hunting={chips.hunting ? "1" : "0"}
      className={cn(
        "atalaya-market-tile relative",
        chips.session.kind === "open" && "is-open",
        chips.dim && "is-closed",
        chips.session.kind === "unknown" && "is-unknown",
      )}
    >
      <button
        type="button"
        className="absolute top-1.5 right-1 z-10 flex size-9 items-center justify-center text-muted"
        aria-label={starred ? "Quitar de favoritos" : "Añadir a favoritos"}
        onClick={() => {
          const next = readChartFavs();
          const ids = next.includes(asset.id) ? next.filter((x) => x !== asset.id) : [...next, asset.id];
          writeChartFavs(ids);
          setStarred(ids.includes(asset.id));
        }}
      >
        <Star className={starred ? "size-3.5 fill-wait text-wait" : "size-3.5"} />
      </button>
      <button type="button" onClick={onOpen} className="flex h-full w-full flex-col text-left">
        <div className="flex items-center gap-2 pr-7">
          <AssetMark id={asset.id} size="sm" />
          <div className="atalaya-tile-id min-w-0">
            <p className="atalaya-tile-name">{asset.label}</p>
            <p className="atalaya-tile-sub">{ASSET_SUBTITLE[asset.id]}</p>
          </div>
        </div>
        <div className="mt-1.5">
          <span
            className={cn(
              "atalaya-badge",
              chips.session.kind === "open" && "atalaya-badge-open",
              chips.session.kind === "closed" && "atalaya-badge-closed",
              chips.session.kind === "unknown" && "atalaya-badge-unknown",
            )}
            title={
              chips.session.kind === "open"
                ? "Mercado abierto"
                : chips.session.kind === "closed"
                  ? "Mercado cerrado"
                  : "Estado de mercado no disponible"
            }
            data-session-badge={chips.session.kind}
          >
            <span
              className={cn(
                "atalaya-session-dot",
                chips.session.kind === "open" && "is-open",
                chips.session.kind === "closed" && "is-closed",
                chips.session.kind === "unknown" && "is-unknown",
              )}
              aria-hidden
            />
            {chips.session.kind === "closed" ? "CERRADO" : chips.session.label}
          </span>
        </div>
        <div className="mt-2 min-w-0">
          <LiveQuoteReadout
            id={asset.id}
            digits={asset.digits}
            snapshotPrice={asset.price}
            snapshotSpot={asset.priceSpot}
            showSpotLabel={false}
            align="left"
            size="lg"
          />
          <p
            className={cn(
              "atalaya-tile-caption",
              chips.session.kind !== "closed" && "is-spacer",
            )}
          >
            {chips.session.kind === "closed" ? "Último dato disponible" : "\u00a0"}
          </p>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p
            className={cn(
              "font-mono text-[11px] tabular",
              up == null && "text-muted",
              up === true && "text-buy",
              up === false && "text-sell",
            )}
          >
            {chg == null ? "—" : compactPct(chg)}
          </p>
          <div className="atalaya-tile-spark">
            <Sparkline values={asset.sparkline} positive={up} />
          </div>
        </div>
        <div className="atalaya-tile-setups">
          {chips.setups.map((chip) =>
            chip.key === "dir" ? (
              <span
                key={chip.key}
                className={cn(
                  "text-[10px] font-semibold",
                  chip.current ? (setup?.direction === "buy" ? "text-buy" : "text-sell") : "text-subtle",
                )}
                data-setup-current={chip.current ? "1" : "0"}
              >
                {chip.label}
              </span>
            ) : (
              <span
                key={chip.key}
                className={cn(
                  "atalaya-badge",
                  chip.key === "entry"
                    ? "atalaya-badge-entry"
                    : chip.current && chip.key === "pending"
                      ? "atalaya-badge-wait"
                      : chip.current && chip.key === "map"
                        ? "atalaya-badge-map"
                        : "atalaya-badge-muted",
                )}
                data-setup-current={chip.current ? "1" : "0"}
              >
                {chip.label}
              </span>
            ),
          )}
        </div>
      </button>
    </div>
  );
}

function compactPct(value: number): string {
  const n = new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
  return `${n}%`;
}


function SetupLine({
  asset,
  watch,
}: {
  asset: AssetAnalysis;
  watch: AssetWatch | null;
}) {
  const setup = asset.setup;
  const phase = watch?.phase ?? (asset.setupState === "wait" ? "wait" : "live");

  if (phase === "expired" && watch?.expiredSetup) {
    const s = watch.expiredSetup;
    const entryPx = displayEntryPrice(s.direction, s.zone.low, s.zone.high);
    const was = watch.expiredFromState ? setupStateEs(watch.expiredFromState) : "setup";
    return (
      <div className="mt-3" data-setup-kind="expired">
        <p className="text-sm font-medium text-wait">{watchPhaseCaption(watch)}</p>
        <p className="mt-0.5 text-sm leading-snug text-muted">
          {s.direction === "buy" ? "COMPRA" : "VENTA"} · era {was} · ENTRADA V1{" "}
          {formatPrice(entryPx, asset.digits)}
        </p>
        <p className="mt-0.5 text-xs text-subtle">
          Ya no vigente según el motor. {watch.expiredReason ?? asset.waitReason ?? "ESPERAR"}
        </p>
        {watch.transition ? (
          <p className="mt-0.5 text-xs text-subtle">Cambio: {watch.transition}</p>
        ) : null}
      </div>
    );
  }

  if (asset.setupState === "wait" || !setup) {
    return (
      <p className="mt-3 text-sm leading-snug text-wait" data-setup-kind="wait">
        {asset.waitReason ?? "ESPERAR"}
      </p>
    );
  }

  const entryPx = displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high);
  const detail = `${setup.direction === "buy" ? "COMPRA" : "VENTA"} · calidad ${setup.quality.toUpperCase()} · ENTRADA V1 ${formatPrice(entryPx, asset.digits)}`;

  if (asset.setupState === "entry") {
    return (
      <div className="mt-3" data-setup-kind="entry">
        <p className="text-sm font-medium">ENTRADA V1 · vigente</p>
        <p className="mt-0.5 text-sm leading-snug text-muted">{detail}</p>
        {watch?.transition ? (
          <p className="mt-0.5 text-xs text-subtle">Cambio: {watch.transition}</p>
        ) : null}
        <p className="mt-0.5 text-xs text-subtle">Análisis, no orden.</p>
      </div>
    );
  }

  if (asset.setupState === "pending") {
    return (
      <div className="mt-3" data-setup-kind="pending">
        <p className="text-sm font-medium text-wait">TRIGGER PENDIENTE — vigente, no es orden</p>
        <p className="mt-0.5 text-sm leading-snug text-muted">{detail}</p>
        {watch?.transition ? (
          <p className="mt-0.5 text-xs text-subtle">Cambio: {watch.transition}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3" data-setup-kind="map">
      <p className="text-sm font-medium text-map">MAPA — vigente, no es orden</p>
      <p className="mt-0.5 text-sm leading-snug text-muted">{detail}</p>
      {watch?.transition ? (
        <p className="mt-0.5 text-xs text-subtle">Cambio: {watch.transition}</p>
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-subtle">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtLevels(levels: number[], digits: number): string {
  if (!levels.length) return "n/d";
  return levels
    .slice(0, 2)
    .map((n) => formatPrice(n, digits))
    .join(" · ");
}

function fmtBasis(
  basis: number | null | undefined,
  pct: number | null | undefined,
  digits: number,
): string {
  if (basis == null) return "DATOS NO DISPONIBLES";
  const p = pct == null ? "" : ` (${formatPct(pct)})`;
  return `${formatPrice(basis, digits)}${p}`;
}
