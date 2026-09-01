import { useEffect, useRef, useState, memo, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
  RefreshCw,
  Star,
  Activity,
  Pencil,
  Layers,
  SlidersHorizontal,
  Crosshair,
  Maximize2,
} from "lucide-react";
import { getChartSeries } from "@/lib/market/chart.fn";
import { useChartLive, type TickHandler } from "@/lib/chart/live";
import { subscribeLiveQuotes, liveQuotesSnapshot, liveXauSpot, liveXauSpotAt } from "@/lib/chart/live-quotes";
import {
  CHART_TFS,
  DEFAULT_OVERLAYS,
  chartTfLabel,
  type ChartOverlays,
  type ChartTf,
  type LiveStatus,
} from "@/lib/chart/types";
import { SETUP_CHART_TF, hasChartableSetup, setupStateCaption, activeFrozenOverlay, chartSetupLevelsFromFrozen, type ChartIntent, type FrozenChartLevels } from "@/lib/chart/setup-overlay";
import { CHART_ASSET_BLURB } from "@/lib/chart/labels";
import { ASSETS } from "@/lib/trading/assets";
import type { AnalysisSnapshot, AssetId } from "@/lib/trading/types";
import { formatPrice } from "@/lib/utils";
import { xauSpotIsFresh } from "@/lib/chart/quote-view";
import { CandleChart, type CandleChartHandle } from "./candle-chart";
import { LiveQuoteReadout } from "@/components/dashboard/live-quote-readout";
import { PullRefresh } from "@/components/dashboard/pull-refresh";

export type { ChartIntent };

const FAV_KEY = "atalaya:chart-favs:v1";
const LAST_TF_KEY = "atalaya:chart-last-tf:v1";
const SETUP_OVERLAYS: ChartOverlays = {
  ema20: false,
  ema50: false,
  ema200: false,
  rsi: false,
  volume: false,
};

function readFavs(): AssetId[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    return raw ? (JSON.parse(raw) as AssetId[]) : [];
  } catch {
    return [];
  }
}

function readLastTf(id: AssetId): ChartTf {
  if (typeof window === "undefined") return SETUP_CHART_TF;
  try {
    const raw = window.localStorage.getItem(LAST_TF_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, ChartTf>) : {};
    return map[id] ?? SETUP_CHART_TF;
  } catch {
    return SETUP_CHART_TF;
  }
}

function writeLastTf(id: AssetId, tf: ChartTf) {
  try {
    const raw = window.localStorage.getItem(LAST_TF_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, ChartTf>) : {};
    map[id] = tf;
    window.localStorage.setItem(LAST_TF_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

const LIVE_LABEL: Record<LiveStatus, string> = {
  live: "EN TIEMPO REAL",
  connecting: "CONECTANDO",
  offline: "SIN CONEXIÓN",
  closed: "MERCADO CERRADO",
};

const LIVE_CLASS: Record<LiveStatus, string> = {
  live: "text-buy",
  connecting: "text-wait",
  offline: "text-sell",
  closed: "text-muted",
};

const LIVE_DOT: Record<LiveStatus, string> = {
  live: "bg-buy",
  connecting: "bg-wait",
  offline: "bg-sell",
  closed: "bg-muted",
};

export const ChartsScreen = memo(function ChartsScreen({
  snapshot,
  intent,
  onBack,
  onRefresh,
}: {
  snapshot: AnalysisSnapshot | undefined;
  intent: ChartIntent | null;
  onBack: () => void;
  onRefresh?: () => void;
}) {
  const [assetId, setAssetId] = useState<AssetId | null>(intent?.assetId ?? null);
  const [tf, setTf] = useState<ChartTf>(intent?.tf ?? SETUP_CHART_TF);
  const [overlays, setOverlays] = useState<ChartOverlays>(
    intent ? SETUP_OVERLAYS : DEFAULT_OVERLAYS,
  );
  const [menu, setMenu] = useState<
    "asset" | "tf" | "indicators" | "draw" | "objects" | "levels" | null
  >(null);
  const [favs, setFavs] = useState<AssetId[]>(readFavs);
  const chartRef = useRef<CandleChartHandle>(null);
  const hudEl = useRef<HTMLSpanElement>(null);
  const [levelsOn, setLevelsOn] = useState({ zone: true, sl: true, tp1: true, tp2: true });
  const [freeze, setFreeze] = useState<FrozenChartLevels | null>(intent?.freeze ?? null);

  useEffect(() => {
    if (!intent) return;
    setAssetId(intent.assetId);
    setTf(intent.tf);
    setOverlays(SETUP_OVERLAYS);
    setFreeze(intent.freeze);
  }, [intent]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    } catch {
      /* ignore */
    }
  }, [favs]);

  if (assetId == null) {
    return (
      <ChartMarketList
        snapshot={snapshot}
        favs={favs}
        onRefresh={onRefresh}
        onFav={(id) =>
          setFavs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
        }
        onPick={(id) => {
          const nextTf = readLastTf(id);
          setAssetId(id);
          setTf(nextTf);
          setOverlays(DEFAULT_OVERLAYS);
        }}
      />
    );
  }

  return (
    <ChartWorkspace
      snapshot={snapshot}
      assetId={assetId}
      tf={tf}
      overlays={overlays}
      menu={menu}
      favs={favs}
      levelsOn={levelsOn}
      freeze={freeze}
      chartRef={chartRef}
      hudEl={hudEl}
      onBackToList={() => {
        if (intent && intent.assetId === assetId) {
          onBack();
          return;
        }
        setAssetId(null);
        setMenu(null);
      }}
      onAsset={(id) => {
        setAssetId(id);
        const next = readLastTf(id);
        setTf(next);
        setMenu(null);
      }}
      onTf={(next) => {
        setTf(next);
        writeLastTf(assetId, next);
        setMenu(null);
      }}
      onOverlays={setOverlays}
      onMenu={setMenu}
      onFavs={setFavs}
      onLevels={setLevelsOn}
    />
  );
});

function ChartMarketList({
  snapshot,
  favs,
  onFav,
  onPick,
  onRefresh,
}: {
  snapshot: AnalysisSnapshot | undefined;
  favs: AssetId[];
  onFav: (id: AssetId) => void;
  onPick: (id: AssetId) => void;
  onRefresh?: () => void;
}) {
  const rest = ASSETS.filter((a) => !favs.includes(a.id));
  const favAssets = ASSETS.filter((a) => favs.includes(a.id));

  return (
    <PullRefresh className="atalaya-charts-list" data-chart-list="1" onRefresh={onRefresh ?? (() => {})} enabled={Boolean(onRefresh)}>
      <div className="atalaya-charts-list-head">
        <p className="text-xs tracking-wider text-muted uppercase">Gráficos</p>
        <h1 className="text-xl font-semibold tracking-tight">Mercados</h1>
      </div>
      {favAssets.length ? (
        <section>
          <p className="px-1 text-xs font-medium tracking-wider text-muted uppercase">Favoritos</p>
          <ul className="mt-2 space-y-1">
            {favAssets.map((a) => {
              const snap = snapshot?.assets.find((x) => x.id === a.id);
              return (
              <SymbolRow
                key={a.id}
                id={a.id}
                starred
                snapshotPrice={snap?.price}
                snapshotSpot={snap?.priceSpot}
                digits={a.digits}
                onPick={() => onPick(a.id)}
                onFav={() => onFav(a.id)}
              />
              );
            })}
          </ul>
        </section>
      ) : null}
      <section className="mt-5">
        <p className="px-1 text-xs font-medium tracking-wider text-muted uppercase">
          Todos los mercados
        </p>
        <ul className="mt-2 space-y-1">
          {(favAssets.length ? rest : ASSETS).map((a) => {
              const snap = snapshot?.assets.find((x) => x.id === a.id);
              return (
            <SymbolRow
              key={a.id}
              id={a.id}
              starred={favs.includes(a.id)}
              snapshotPrice={snap?.price}
              snapshotSpot={snap?.priceSpot}
              digits={a.digits}
              onPick={() => onPick(a.id)}
              onFav={() => onFav(a.id)}
            />
              );
            })}
        </ul>
      </section>
    </PullRefresh>
  );
}

function SymbolRow({
  id,
  starred,
  snapshotPrice,
  snapshotSpot,
  digits,
  onPick,
  onFav,
}: {
  id: AssetId;
  starred: boolean;
  snapshotPrice: number | null | undefined;
  snapshotSpot: number | null | undefined;
  digits: number;
  onPick: () => void;
  onFav: () => void;
}) {
  return (
    <li className="flex items-center gap-1 rounded-[var(--radius-lg)] bg-elevated px-2 shadow-[var(--shadow-border)]">
      <button type="button" onClick={onPick} className="min-h-14 flex-1 px-2 py-3 text-left">
        <p className="text-sm font-medium">{id}</p>
        <p className="text-xs text-muted">{CHART_ASSET_BLURB[id]}</p>
      </button>
      <LiveQuoteReadout
        id={id}
        digits={digits}
        snapshotPrice={snapshotPrice}
        snapshotSpot={snapshotSpot}
      />
      <button
        type="button"
        className="flex size-11 items-center justify-center text-muted"
        aria-label={starred ? "Quitar de favoritos" : "Añadir a favoritos"}
        onClick={onFav}
      >
        <Star className={starred ? "size-4 fill-wait text-wait" : "size-4"} />
      </button>
    </li>
  );
}

function ChartWorkspace({
  snapshot,
  assetId,
  tf,
  overlays,
  menu,
  favs,
  levelsOn,
  freeze,
  chartRef,
  hudEl,
  onBackToList,
  onAsset,
  onTf,
  onOverlays,
  onMenu,
  onFavs,
  onLevels,
}: {
  snapshot: AnalysisSnapshot | undefined;
  assetId: AssetId;
  tf: ChartTf;
  overlays: ChartOverlays;
  menu: "asset" | "tf" | "indicators" | "draw" | "objects" | "levels" | null;
  favs: AssetId[];
  levelsOn: { zone: boolean; sl: boolean; tp1: boolean; tp2: boolean };
  freeze: FrozenChartLevels | null;
  chartRef: RefObject<CandleChartHandle | null>;
  hudEl: RefObject<HTMLSpanElement | null>;
  onBackToList: () => void;
  onAsset: (id: AssetId) => void;
  onTf: (tf: ChartTf) => void;
  onOverlays: (o: ChartOverlays) => void;
  onMenu: (m: "asset" | "tf" | "indicators" | "draw" | "objects" | "levels" | null) => void;
  onFavs: (fn: (prev: AssetId[]) => AssetId[]) => void;
  onLevels: (v: { zone: boolean; sl: boolean; tp1: boolean; tp2: boolean }) => void;
}) {
  const query = useQuery({
    queryKey: ["chart-series", assetId, tf],
    queryFn: () => getChartSeries({ data: { assetId, tf } }),
    staleTime: 20_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const analysis = snapshot?.assets.find((a) => a.id === assetId) ?? null;
  const series = query.data;
  const live = useChartLive(series);
  useEffect(() => {
    return subscribeLiveQuotes(() => {
      const p = liveQuotesSnapshot()[assetId];
      if (p != null) live.nudgeLast(p);
    });
  }, [assetId, live.nudgeLast]);
  const starred = favs.includes(assetId);
  const seedClose =
    live.key === `${assetId}:${tf}`
      ? (live.bars.at(-1)?.close ?? series?.candles.at(-1)?.close ?? null)
      : (series?.candles.at(-1)?.close ?? null);
  const liveStatus: LiveStatus = series
    ? !series.sessionOpen
      ? "closed"
      : live.status
    : "connecting";
  const freezeActive = activeFrozenOverlay(freeze, assetId, tf);
  const freezeLevels = freezeActive ? chartSetupLevelsFromFrozen(freezeActive) : null;
  const hasSetup = freezeLevels != null || (analysis != null && hasChartableSetup(analysis));
  const focusSetup = freezeLevels != null || hasSetup;
  const sourceBits = series
    ? [series.instrumentKind === "proxy" ? "PROXY" : "NATIVO", series.source].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="atalaya-charts relative flex h-full min-h-0 flex-col" data-chart-workspace="1">
      <div className="atalaya-charts-toolbar">
        <div className="atalaya-charts-head flex items-center gap-1">
          <button
            type="button"
            onClick={onBackToList}
            className="flex size-11 items-center justify-center rounded-[var(--radius-md)] text-muted"
            aria-label="Volver"
          >
            <ChevronLeft className="size-5" />
          </button>
          <p className="atalaya-charts-title flex-1 text-sm font-medium tracking-wide">GRÁFICO</p>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-[var(--radius-md)] text-muted"
            aria-label={starred ? "Quitar de favoritos" : "Añadir a favoritos"}
            onClick={() =>
              onFavs((prev) =>
                prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
              )
            }
          >
            <Star className={starred ? "size-4 fill-wait text-wait" : "size-4"} />
          </button>
        </div>

        <div className="atalaya-charts-pickers mt-1 flex items-center gap-1.5">
          <Picker
            open={menu === "asset"}
            label={assetId}
            menuWidth="asset"
            onToggle={() => onMenu(menu === "asset" ? null : "asset")}
            onClose={() => onMenu(null)}
          >
            {ASSETS.map((a) => (
              <PickerItem
                key={a.id}
                active={a.id === assetId}
                title={a.label}
                detail={CHART_ASSET_BLURB[a.id]}
                onClick={() => onAsset(a.id)}
              />
            ))}
          </Picker>
          <Picker
            open={menu === "tf"}
            label={chartTfLabel(tf)}
            onToggle={() => onMenu(menu === "tf" ? null : "tf")}
            onClose={() => onMenu(null)}
          >
            {CHART_TFS.map((t) => (
              <PickerItem key={t.id} active={t.id === tf} title={t.label} onClick={() => onTf(t.id)} />
            ))}
          </Picker>
          {series ? (
            <LivePrice
              assetId={assetId}
              digits={series.digits}
              seed={seedClose}
              seedSpot={analysis?.priceSpot ?? null}
              subscribe={live.subscribe}
            />
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-muted"
            aria-label="Actualizar gráfico"
            disabled={query.isFetching}
            onClick={() => {
              void query.refetch();
              live.reconnect();
            }}
          >
            <RefreshCw className={query.isFetching ? "size-4 animate-spin" : "size-4"} />
          </button>
        </div>

        <p
          data-chart-live-status={liveStatus}
          className="atalaya-charts-status mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] tabular text-subtle"
          title={series?.proxyNote ?? sourceBits}
        >
          <span className={`size-1.5 shrink-0 rounded-full ${LIVE_DOT[liveStatus]}`} />
          <span ref={hudEl} data-chart-ohlc className="min-w-0 truncate" />
          {freezeLevels ? (
            <span className={freezeLevels.direction === "buy" ? "shrink-0 text-buy" : "shrink-0 text-sell"}>
              {freezeLevels.direction === "buy" ? "LARGO" : "CORTO"}{" "}
              {setupStateCaption(freezeLevels.state)} · CONGELADO
            </span>
          ) : hasSetup && analysis?.setup ? (
            <span className={analysis.setup.direction === "buy" ? "shrink-0 text-buy" : "shrink-0 text-sell"}>
              {analysis.setup.direction === "buy" ? "LARGO" : "CORTO"}{" "}
              {setupStateCaption(analysis.setupState === "wait" ? analysis.setup.state : analysis.setupState)}
            </span>
          ) : freeze && freeze.assetId === assetId && freeze.tf !== tf ? (
            <span className="shrink-0 text-subtle">Niveles del episodio en {chartTfLabel(freeze.tf)}</span>
          ) : (
            <span className={`shrink-0 ${LIVE_CLASS[liveStatus]}`}>{LIVE_LABEL[liveStatus]}</span>
          )}
          {series?.instrumentKind === "proxy" ? (
            <span className="shrink-0 text-wait">
              {assetId === "XAUUSD" ? "velas PROXY XAUUSDT" : "PROXY"}
            </span>
          ) : null}
        </p>
      </div>

      <div className="atalaya-chart-pane">
        {query.isLoading && !series ? (
          <div className="flex h-full items-center justify-center px-6">
            <p className="text-sm text-muted">Cargando gráfico…</p>
          </div>
        ) : series?.error ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-wait">Error de red: {series.error}</p>
          </div>
        ) : !series?.candles.length ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-wait">Sin datos disponibles para este activo y temporalidad.</p>
          </div>
        ) : (
          <CandleChart
            key={`${series.assetId}-${series.tf}`}
            ref={chartRef}
            series={series}
            overlays={overlays}
            analysis={freeze && freeze.assetId === assetId ? null : analysis}
            frozenLevels={freezeLevels}
            focusSetup={focusSetup}
            subscribeTick={live.subscribe}
            getBars={live.getBars}
            hudEl={hudEl.current}
            visibleLevels={levelsOn}
          />
        )}
      </div>

      <div className="atalaya-charts-tools">
        <IconTool
          active={menu === "indicators"}
          label="Indicadores"
          onClick={() => onMenu(menu === "indicators" ? null : "indicators")}
        >
          <Activity className="size-4" />
        </IconTool>
        <IconTool
          active={menu === "draw"}
          label="Dibujar"
          onClick={() => onMenu(menu === "draw" ? null : "draw")}
        >
          <Pencil className="size-4" />
        </IconTool>
        <IconTool
          active={menu === "objects"}
          label="Objetos"
          onClick={() => onMenu(menu === "objects" ? null : "objects")}
        >
          <Layers className="size-4" />
        </IconTool>
        <IconTool
          active={menu === "levels"}
          label="Niveles"
          onClick={() => onMenu(menu === "levels" ? null : "levels")}
        >
          <SlidersHorizontal className="size-4" />
        </IconTool>
        <IconTool
          active={false}
          label="Centrar en el precio actual"
          dataAttr="chart-center"
          onClick={() => chartRef.current?.centerNow()}
        >
          <Crosshair className="size-4" />
        </IconTool>
        <IconTool
          active={false}
          label="Ajustar vista al setup"
          dataAttr="chart-reset"
          onClick={() => chartRef.current?.resetView()}
        >
          <Maximize2 className="size-4" />
        </IconTool>
      </div>

      {menu === "indicators" ? (
        <Panel title="Indicadores" onClose={() => onMenu(null)}>
          <p className="mb-3 text-xs text-subtle">Solo visuales. No cambian T1–T8, calidad ni riesgo.</p>
          <Toggle label="EMA20" on={overlays.ema20} onChange={(v) => onOverlays({ ...overlays, ema20: v })} />
          <Toggle label="EMA50" on={overlays.ema50} onChange={(v) => onOverlays({ ...overlays, ema50: v })} />
          <Toggle label="EMA200" on={overlays.ema200} onChange={(v) => onOverlays({ ...overlays, ema200: v })} />
          <Toggle label="RSI" on={overlays.rsi} onChange={(v) => onOverlays({ ...overlays, rsi: v })} />
          <Toggle
            label="Volumen"
            on={overlays.volume}
            onChange={(v) => onOverlays({ ...overlays, volume: v })}
            disabled={series ? !series.volumeAvailable : false}
          />
          <Toggle label="MACD" on={false} onChange={() => {}} disabled />
          <Toggle label="ATR" on={false} onChange={() => {}} disabled />
          {series && !series.volumeAvailable ? (
            <p className="mt-2 text-xs text-wait">Volumen no disponible en esta serie.</p>
          ) : null}
        </Panel>
      ) : null}

      {menu === "draw" ? (
        <Panel title="Dibujar" onClose={() => onMenu(null)}>
          <p className="text-sm text-muted">No disponible. El dibujo no está activo en esta versión.</p>
        </Panel>
      ) : null}

      {menu === "objects" ? (
        <Panel title="Objetos" onClose={() => onMenu(null)}>
          <ObjectsFromEngine analysis={analysis} freeze={freezeActive} tf={tf} />
        </Panel>
      ) : null}

      {menu === "levels" ? (
        <Panel title="Niveles del setup" onClose={() => onMenu(null)}>
          <p className="mb-3 text-xs text-subtle">Solo mostrar u ocultar. No recalcula V1.</p>
          <Toggle label="Zona" on={levelsOn.zone} onChange={(v) => onLevels({ ...levelsOn, zone: v })} />
          <Toggle label="SL" on={levelsOn.sl} onChange={(v) => onLevels({ ...levelsOn, sl: v })} />
          <Toggle label="TP1" on={levelsOn.tp1} onChange={(v) => onLevels({ ...levelsOn, tp1: v })} />
          <Toggle label="TP2" on={levelsOn.tp2} onChange={(v) => onLevels({ ...levelsOn, tp2: v })} />
        </Panel>
      ) : null}
    </div>
  );
}

function LivePrice({
  assetId,
  digits,
  seed,
  seedSpot,
  subscribe,
}: {
  assetId: AssetId;
  digits: number;
  seed: number | null;
  seedSpot: number | null;
  subscribe: (fn: TickHandler) => () => void;
}) {
  const proxyRef = useRef<HTMLSpanElement>(null);
  const spotRef = useRef<HTMLSpanElement>(null);
  const delayRef = useRef<HTMLSpanElement>(null);
  const isXau = assetId === "XAUUSD";

  useEffect(() => {
    const writeProxy = (n: number) => {
      if (proxyRef.current) proxyRef.current.textContent = formatPrice(n, digits);
    };
    const writeSpot = (n: number | null, delayed: boolean) => {
      if (spotRef.current) spotRef.current.textContent = n == null ? "—" : formatPrice(n, digits);
      if (delayRef.current) delayRef.current.hidden = !delayed;
    };
    const spotNow = () => liveXauSpot() ?? seedSpot;
    const delayedNow = () => {
      const at = liveXauSpotAt();
      return at > 0 && !xauSpotIsFresh(at, Date.now());
    };
    const q0 = liveQuotesSnapshot()[assetId];
    if (q0 != null) writeProxy(q0);
    else if (seed != null) writeProxy(seed);
    if (isXau) writeSpot(spotNow(), delayedNow());
    const offLive = subscribeLiveQuotes(() => {
      const q = liveQuotesSnapshot()[assetId];
      if (q != null) writeProxy(q);
      if (isXau) writeSpot(spotNow(), delayedNow());
    });
    const offBar = subscribe((c) => {
      if (liveQuotesSnapshot()[assetId] != null) return;
      writeProxy(c.close);
    });
    return () => {
      offLive();
      offBar();
    };
  }, [subscribe, digits, seed, seedSpot, assetId, isXau]);

  const q0 = liveQuotesSnapshot()[assetId];
  const shown = q0 ?? seed;
  const spot0 = isXau ? (liveXauSpot() ?? seedSpot) : null;
  const delayed0 = isXau && liveXauSpotAt() > 0 && !xauSpotIsFresh(liveXauSpotAt(), Date.now());

  if (isXau) {
    return (
      <div className="min-w-0 flex-1 truncate text-right font-mono tabular leading-tight">
        <p className="text-sm font-medium">
          <span ref={spotRef} data-chart-spot>
            {spot0 != null ? formatPrice(spot0, digits) : "—"}
          </span>
          <span className="ml-1 text-[10px] font-medium tracking-wide text-subtle">SPOT</span>
        </p>
        <p className="text-[10px] text-wait">
          <span ref={proxyRef} data-chart-price data-chart-live={q0 != null ? "1" : "0"}>
            {shown != null ? formatPrice(shown, digits) : ""}
          </span>
          <span className="ml-1 font-medium tracking-wide">PROXY</span>
        </p>
        <span ref={delayRef} hidden={!delayed0} className="block text-[10px] font-medium tracking-wide text-wait">
          RETRASADO
        </span>
      </div>
    );
  }

  return (
    <p
      data-chart-price
      data-chart-live={q0 != null ? "1" : "0"}
      className="min-w-0 flex-1 truncate text-right font-mono text-sm tabular"
    >
      <span ref={proxyRef}>{shown != null ? formatPrice(shown, digits) : ""}</span>
    </p>
  );
}

function ObjectsFromEngine({
  analysis,
  freeze,
  tf,
}: {
  analysis: AnalysisSnapshot["assets"][number] | null;
  freeze: FrozenChartLevels | null;
  tf: ChartTf;
}) {
  if (freeze) {
    const lv = chartSetupLevelsFromFrozen(freeze);
    return (
      <ul className="space-y-1.5 text-sm" data-chart-objects="freeze">
        <li>
          Estado:{" "}
          {lv.state === "entry"
            ? "ENTRADA — análisis, no orden"
            : lv.state === "pending"
              ? "TRIGGER PENDIENTE — no es orden"
              : "MAPA — no es orden"}
          {" · congelada"}
        </li>
        <li>{lv.direction === "buy" ? "COMPRA / LARGO" : "VENTA / CORTO"}</li>
        <li>
          Zona {lv.labelZone}
        </li>
        <li>SL {lv.labelSl}</li>
        <li>TP1 {lv.labelTp1}</li>
        {lv.labelTp2 ? <li>TP2 {lv.labelTp2}</li> : null}
        <li className="text-xs text-subtle">
          Niveles del episodio {freeze.episodeId.slice(0, 8)}… en {chartTfLabel(tf)}. El gráfico no
          recalcula V1.
        </li>
      </ul>
    );
  }
  if (!analysis) {
    return <p className="text-sm text-muted">Sin análisis cargado.</p>;
  }
  if (!hasChartableSetup(analysis) || !analysis.setup) {
    return (
      <p className="text-sm text-wait">
        {analysis.waitReason ?? "ESPERAR — no hay zona ni entrada que dibujar."}
      </p>
    );
  }
  const s = analysis.setup;
  const d = analysis.digits;
  const shownState = analysis.setupState === "wait" ? s.state : analysis.setupState;
  return (
    <ul className="space-y-1.5 text-sm">
      <li>
        Estado:{" "}
        {shownState === "entry"
          ? "ENTRADA — análisis, no orden"
          : shownState === "pending"
            ? "TRIGGER PENDIENTE — no es orden"
            : "MAPA — no es orden"}
        {analysis.setupState === "wait" ? " · congelada" : ""}
      </li>
      <li>{s.direction === "buy" ? "COMPRA / LARGO" : "VENTA / CORTO"}</li>
      <li>
        Zona {formatMaybe(s.zone.low, d)} – {formatMaybe(s.zone.high, d)}
      </li>
      <li>SL {formatMaybe(s.stopLoss, d)}</li>
      <li>TP1 {formatMaybe(s.takeProfit1, d)}</li>
      {s.takeProfit2 != null ? <li>TP2 {formatMaybe(s.takeProfit2, d)}</li> : null}
      <li className="text-xs text-subtle">Valores del motor. El gráfico no recalcula.</li>
    </ul>
  );
}

function formatMaybe(n: number, digits: number): string {
  return n.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function Picker({
  open,
  label,
  onToggle,
  onClose,
  children,
  menuWidth = "default",
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
  menuWidth?: "default" | "asset";
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-11 min-w-16 items-center gap-1 rounded-[var(--radius-md)] bg-elevated px-3 text-sm font-medium shadow-[var(--shadow-border)]"
      >
        {label}
        <ChevronDown className="size-3.5 text-muted" />
      </button>
      {open ? (
        <>
          <button type="button" className="fixed inset-0 z-20" aria-label="Cerrar menú" onClick={onClose} />
          <div
            className={
              menuWidth === "asset"
                ? "absolute top-12 left-0 z-30 max-h-[min(24rem,70vh)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-[var(--radius-md)] bg-elevated p-1.5 shadow-[var(--shadow-border)]"
                : "absolute top-12 left-0 z-30 max-h-60 min-w-40 overflow-y-auto rounded-[var(--radius-md)] bg-elevated p-1 shadow-[var(--shadow-border)]"
            }
          >
            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PickerItem({
  active,
  onClick,
  title,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        detail
          ? active
            ? "flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-sm)] bg-surface px-3 py-2.5 text-left"
            : "flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left"
          : active
            ? "flex h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] bg-surface px-3 text-left"
            : "flex h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-left"
      }
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-medium ${active ? "text-fg" : "text-muted"}`}>{title}</span>
        {detail ? <span className="mt-0.5 block text-xs leading-snug text-muted">{detail}</span> : null}
      </span>
      <span className={`w-4 shrink-0 text-center text-sm ${active ? "text-buy" : "text-transparent"}`} aria-hidden={!active}>
        ✓
      </span>
    </button>
  );
}

function IconTool({
  active,
  onClick,
  children,
  label,
  dataAttr,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  label: string;
  dataAttr?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-chart-reset={dataAttr === "chart-reset" ? "1" : undefined}
      data-chart-center={dataAttr === "chart-center" ? "1" : undefined}
      className={
        active
          ? "flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] bg-surface text-[10px] font-medium"
          : "flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] text-[10px] text-muted"
      }
    >
      {children}
    </button>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-x-0 bottom-12 z-20 border-t border-border bg-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium tracking-wider text-muted uppercase">{title}</p>
        <button type="button" onClick={onClose} className="h-11 px-2 text-xs text-muted">
          Cerrar
        </button>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span className={disabled ? "text-subtle" : ""}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={
          on
            ? "h-6 w-10 rounded-full bg-buy disabled:opacity-40"
            : "h-6 w-10 rounded-full bg-elevated shadow-[var(--shadow-border)] disabled:opacity-40"
        }
      >
        <span className={on ? "ml-5 block size-5 rounded-full bg-fg" : "ml-0.5 block size-5 rounded-full bg-muted"} />
      </button>
    </label>
  );
}
