import { useEffect, useRef, useState, memo, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronLeft,
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
import { SETUP_CHART_TF, hasChartableSetup, setupStateCaption, activeStudyOverlay, chartSetupLevelsFromFrozen, type ChartIntent, type FrozenChartLevels, type StudyClock } from "@/lib/chart/setup-overlay";
import { CHART_ASSET_BLURB, displayEntryPrice } from "@/lib/chart/labels";
import { ASSETS } from "@/lib/trading/assets";
import type { AnalysisSnapshot, AssetId } from "@/lib/trading/types";
import { cn, formatPrice } from "@/lib/utils";
import { xauSpotIsFresh } from "@/lib/chart/quote-view";
import { CandleChart, type CandleChartHandle } from "./candle-chart";
import { LiveQuoteReadout } from "@/components/dashboard/live-quote-readout";
import { PullRefresh } from "@/components/dashboard/pull-refresh";
import { AssetMark, ASSET_SUBTITLE, AtalayaMark } from "@/components/dashboard/marks";
import { MarketDock } from "@/components/dashboard/market-dock";
import { Sparkline } from "@/components/dashboard/sparkline";
import { marketSessionKind, episodeMarketView } from "@/lib/watch/market-session";
import { SessionKindBadge } from "@/components/dashboard/session-state";


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
  studyClockByAsset,
  onMode,
  statusOk,
  statusLabel,
}: {
  snapshot: AnalysisSnapshot | undefined;
  intent: ChartIntent | null;
  onBack: () => void;
  onRefresh?: () => void;
  studyClockByAsset?: Partial<Record<AssetId, StudyClock>>;
  onMode?: (mode: "list" | "workspace") => void;
  statusOk?: boolean;
  statusLabel?: string;
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
  const [levelsOn, setLevelsOn] = useState({ entry: true, zone: true, sl: true, tp1: true, tp2: true });
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

  useEffect(() => {
    onMode?.(assetId == null ? "list" : "workspace");
  }, [assetId, onMode]);

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
      studyClock={assetId != null ? studyClockByAsset?.[assetId] ?? null : null}
      chartRef={chartRef}
      hudEl={hudEl}
      statusOk={statusOk}
      statusLabel={statusLabel}
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
  return (
    <PullRefresh className="atalaya-charts-list" data-chart-list="1" onRefresh={onRefresh ?? (() => {})} enabled={Boolean(onRefresh)}>
      <div className="atalaya-charts-list-head">
        <h1 className="text-xl font-semibold tracking-tight">Mercados</h1>
        <p className="mt-0.5 text-sm text-subtle">Vista rápida de los 4 activos vigilados</p>
      </div>
      <ul className="space-y-2">
        {ASSETS.map((a) => {
          const snap = snapshot?.assets.find((x) => x.id === a.id);
          const chg = snap?.dayChangePct;
          const up = chg == null ? null : chg >= 0;
          const state = snap?.setupState ?? "wait";
          const session = marketSessionKind({ id: a.id, dataStatus: snap?.dataStatus });
          const market = episodeMarketView({
            id: a.id,
            setupState: state,
            dataStatus: snap?.dataStatus,
          });
          return (
            <li key={a.id}>
              <div className="atalaya-market-row" data-operable={market.operable ? "1" : "0"} data-market-session={session}>
                <button type="button" onClick={() => onPick(a.id)} className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left">
                  <AssetMark id={a.id} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{a.label}</p>
                    <p className="truncate text-[11px] text-subtle">{ASSET_SUBTITLE[a.id]}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {session === "closed" ? <SessionKindBadge kind="closed" /> : null}
                      {state === "entry" ? <span className="atalaya-badge atalaya-badge-entry">ENTRY</span> : null}
                      {state === "pending" ? (
                        <span className={market.operable ? "atalaya-badge atalaya-badge-wait" : "atalaya-badge atalaya-badge-muted"}>
                          PENDING
                        </span>
                      ) : null}
                      {state === "map" ? (
                        <span className={market.operable ? "atalaya-badge atalaya-badge-map" : "atalaya-badge atalaya-badge-muted"}>
                          MAPA
                        </span>
                      ) : null}
                      {state === "wait" && session === "open" ? <span className="atalaya-badge atalaya-badge-muted">Vigilando</span> : null}
                    </div>
                  </div>
                  <div className="w-16 shrink-0">
                    <Sparkline values={snap?.sparkline ?? []} positive={up} />
                  </div>
                  <div className="text-right">
                    <LiveQuoteReadout
                      id={a.id}
                      digits={a.digits}
                      snapshotPrice={snap?.price}
                      snapshotSpot={snap?.priceSpot}
                      showSpotLabel={false}
                    />
                    <p className={cn("mt-0.5 font-mono text-[11px] tabular", up == null && "text-muted", up === true && "text-buy", up === false && "text-sell")}>
                      {chg == null ? "—" : `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(chg)}%`}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  className="flex size-11 items-center justify-center text-muted"
                  aria-label={favs.includes(a.id) ? "Quitar de favoritos" : "Añadir a favoritos"}
                  onClick={() => onFav(a.id)}
                >
                  <Star className={favs.includes(a.id) ? "size-4 fill-wait text-wait" : "size-4"} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </PullRefresh>
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
  studyClock,
  chartRef,
  hudEl,
  statusOk,
  statusLabel,
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
  levelsOn: { entry: boolean; zone: boolean; sl: boolean; tp1: boolean; tp2: boolean };
  freeze: FrozenChartLevels | null;
  studyClock?: StudyClock | null;
  chartRef: RefObject<CandleChartHandle | null>;
  hudEl: RefObject<HTMLSpanElement | null>;
  statusOk?: boolean;
  statusLabel?: string;
  onBackToList: () => void;
  onAsset: (id: AssetId) => void;
  onTf: (tf: ChartTf) => void;
  onOverlays: (o: ChartOverlays) => void;
  onMenu: (m: "asset" | "tf" | "indicators" | "draw" | "objects" | "levels" | null) => void;
  onFavs: (fn: (prev: AssetId[]) => AssetId[]) => void;
  onLevels: (v: { entry: boolean; zone: boolean; sl: boolean; tp1: boolean; tp2: boolean }) => void;
}) {
  const query = useQuery({
    queryKey: ["chart-series", assetId, tf],
    queryFn: () => getChartSeries({ data: { assetId, tf } }),
    staleTime: 20_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const analysis = snapshot?.assets.find((a) => a.id === assetId) ?? null;
  const market = episodeMarketView({
    id: assetId,
    setupState: freeze?.state ?? analysis?.setupState ?? "wait",
    dataStatus: analysis?.dataStatus,
  });
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
  const freezeForAsset = activeStudyOverlay(freeze, assetId);
  const freezeLevels = freezeForAsset
    ? chartSetupLevelsFromFrozen({
        ...freezeForAsset,
        openedAtMs: freezeForAsset.openedAtMs ?? studyClock?.openedAtMs ?? null,
        closedAtMs: freezeForAsset.closedAtMs ?? studyClock?.closedAtMs ?? null,
      })
    : null;
  const hasSetup = freezeLevels != null || (analysis != null && hasChartableSetup(analysis));
  const focusSetup = freezeLevels != null || hasSetup;
  const sourceBits = series
    ? [series.instrumentKind === "proxy" ? "PROXY" : "NATIVO", series.source].filter(Boolean).join(" · ")
    : "";

  const chg = analysis?.dayChangePct ?? null;
  const up = chg == null ? null : chg >= 0;
  const absChange =
    analysis && analysis.price != null && chg != null && chg !== -100
      ? analysis.price - analysis.price / (1 + chg / 100)
      : null;
  const MAIN_TFS: ChartTf[] = ["15m", "1h", "4h"];
  const tfPill = (id: ChartTf) => (id === "15m" ? "M15" : id === "1h" ? "1H" : id === "4h" ? "4H" : chartTfLabel(id));

  return (
    <div className="atalaya-charts relative flex h-full min-h-0 flex-col" data-chart-workspace="1">
      <div className="atalaya-charts-toolbar">
        <div className="atalaya-charts-head flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={onBackToList}
              className="flex size-9 items-center justify-center rounded-[var(--radius-md)] text-muted"
              aria-label="Volver"
            >
              <ChevronLeft className="size-5" />
            </button>
            <AtalayaMark className="size-6 text-cyan" />
            <p className="atalaya-charts-title text-[13px] font-semibold tracking-[0.16em] uppercase">Atalaya</p>
          </div>
          <div className="flex items-center gap-1">
            <span className={statusOk === false ? "atalaya-pill is-warn" : "atalaya-pill is-ok"}>
              <span className="atalaya-status-dot" />
              {statusLabel ?? "Operativo"}
            </span>
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-[var(--radius-md)] text-muted"
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
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-3 px-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <AssetMark id={assetId} size="lg" />
            <div className="min-w-0">
              <p className="text-lg font-semibold tracking-tight">{assetId}</p>
              <p className="text-xs text-subtle">{ASSET_SUBTITLE[assetId]}</p>
              <div className="mt-1">
                <SessionKindBadge kind={market.session} />
              </div>
            </div>
          </div>
          <div className="text-right">
            {series ? (
              <LivePrice
                assetId={assetId}
                digits={series.digits}
                seed={seedClose}
                seedSpot={analysis?.priceSpot ?? null}
                subscribe={live.subscribe}
                hero
              />
            ) : (
              <span className="font-mono text-2xl tabular">—</span>
            )}
            {chg != null ? (
              <p className={cn("mt-1 font-mono text-xs tabular", up ? "text-buy" : "text-sell")}>
                {absChange != null
                  ? `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(absChange)} (${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(chg)}%)`
                  : `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(chg)}%`}
              </p>
            ) : null}
          </div>
        </div>

        <div className="atalaya-tf-tabs mt-2.5">
          {MAIN_TFS.map((t) => (
            <button
              key={t}
              type="button"
              className={cn("atalaya-tf-tab", tf === t && "is-active")}
              onClick={() => onTf(t)}
            >
              {tfPill(t)}
            </button>
          ))}
          <Picker
            open={menu === "tf"}
            label={MAIN_TFS.includes(tf) ? "Más" : tfPill(tf)}
            onToggle={() => onMenu(menu === "tf" ? null : "tf")}
            onClose={() => onMenu(null)}
          >
            {CHART_TFS.map((t) => (
              <PickerItem key={t.id} active={t.id === tf} title={t.label} onClick={() => onTf(t.id)} />
            ))}
          </Picker>
        </div>

        <p
          data-chart-live-status={liveStatus}
          className="sr-only"
          title={series?.proxyNote ?? sourceBits}
        >
          <span className={`size-1.5 shrink-0 rounded-full ${LIVE_DOT[liveStatus]}`} />
          <span ref={hudEl} data-chart-ohlc className="min-w-0 truncate" />
          {freezeLevels ? (
            <span className={freezeLevels.direction === "buy" ? "shrink-0 text-buy" : "shrink-0 text-sell"}>
              {freezeLevels.direction === "buy" ? "COMPRA" : "VENTA"}{" "}
              {setupStateCaption(freezeLevels.state)}
            </span>
          ) : hasSetup && analysis?.setup ? (
            <span className={analysis.setup.direction === "buy" ? "shrink-0 text-buy" : "shrink-0 text-sell"}>
              {analysis.setup.direction === "buy" ? "COMPRA" : "VENTA"}{" "}
              {setupStateCaption(analysis.setupState === "wait" ? analysis.setup.state : analysis.setupState)}
            </span>
          ) : freeze && freeze.assetId === assetId && freeze.tf !== tf ? (
            <span className="shrink-0 text-subtle">Niveles del episodio en {chartTfLabel(freeze.tf)}</span>
          ) : (
            <span className={`shrink-0 ${LIVE_CLASS[liveStatus]}`}>{LIVE_LABEL[liveStatus]}</span>
          )}
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
            studyClock={studyClock ?? null}
            focusSetup={focusSetup}
            subscribeTick={live.subscribe}
            getBars={live.getBars}
            hudEl={hudEl.current}
            visibleLevels={levelsOn}
          />
        )}
      </div>

      <div className="atalaya-charts-tools hidden" hidden>
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

      <MarketDock
        assetId={assetId}
        asset={analysis}
        freeze={freezeForAsset}
        episodeId={freezeForAsset?.episodeId ?? null}
      />

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
          <ObjectsFromEngine analysis={analysis} freeze={freezeForAsset} tf={tf} />
        </Panel>
      ) : null}

      {menu === "levels" ? (
        <Panel title="Niveles del setup" onClose={() => onMenu(null)}>
          <p className="mb-3 text-xs text-subtle">Solo mostrar u ocultar. No recalcula V1.</p>
          <Toggle label="ENTRADA" on={levelsOn.entry} onChange={(v) => onLevels({ ...levelsOn, entry: v })} />
          <Toggle label="Zona de origen" on={levelsOn.zone} onChange={(v) => onLevels({ ...levelsOn, zone: v })} />
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
  hero,
}: {
  assetId: AssetId;
  digits: number;
  seed: number | null;
  seedSpot: number | null;
  subscribe: (fn: TickHandler) => () => void;
  hero?: boolean;
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
      <div className={hero ? "min-w-0" : "min-w-0 flex-1 truncate text-right font-mono tabular leading-tight"}>
        <p className={hero ? "font-mono text-2xl font-semibold tabular leading-none" : "text-sm font-medium"}>
          <span ref={spotRef} data-chart-spot>
            {spot0 != null ? formatPrice(spot0, digits) : "—"}
          </span>
          {hero ? null : <span className="ml-1 text-[10px] font-medium tracking-wide text-subtle">SPOT</span>}
        </p>
        {hero ? null : (
          <p className="text-[10px] text-wait">
            <span ref={proxyRef} data-chart-price data-chart-live={q0 != null ? "1" : "0"}>
              {shown != null ? formatPrice(shown, digits) : ""}
            </span>
            <span className="ml-1 font-medium tracking-wide">PROXY</span>
          </p>
        )}
        {hero ? (
          <span ref={proxyRef} data-chart-price data-chart-live={q0 != null ? "1" : "0"} className="sr-only">
            {shown != null ? formatPrice(shown, digits) : ""}
          </span>
        ) : null}
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
      className={hero ? "font-mono text-2xl font-semibold tabular leading-none" : "min-w-0 flex-1 truncate text-right font-mono text-sm tabular"}
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
        <li>{lv.direction === "buy" ? "COMPRA" : "VENTA"}</li>
        <li>ENTRADA V1 {lv.labelEntry}</li>
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
        {analysis.waitReason ?? "ESPERAR — no hay entrada que dibujar."}
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
      <li>{s.direction === "buy" ? "COMPRA" : "VENTA"}</li>
      <li>
        ENTRADA V1 {formatMaybe(displayEntryPrice(s.direction, s.zone.low, s.zone.high), d)}
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
