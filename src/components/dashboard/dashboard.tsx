import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, House, BarChart3, CalendarDays, BookOpen, GraduationCap, Ellipsis, Settings, Download } from "lucide-react";
import { getMarketAnalysis } from "@/lib/market/analysis.fn";
import { getWatchHealth, getWatchEpisode, getWatchSnapshots, type WatchEpisodeView } from "@/lib/watch/watch.fn";
import type { AnalysisSnapshot, AssetAnalysis, AssetId } from "@/lib/trading/types";
import { formatClock } from "@/lib/utils";
import type { SnapshotDraft } from "@/lib/watch/episode";
import { Skeleton } from "@/components/ui/skeleton";
import { MarketTile } from "./asset-card";
import { BestOpportunityCard, FeedStatus } from "./home-feed";
import { AssetSheet } from "./asset-sheet";
import { CalendarList } from "./calendar-list";
import { AccountPanel, useAccountSettings, useCosts } from "./account-panel";
import { ChartsScreen, type ChartIntent } from "@/components/charts/charts-screen";
import { hasChartableSetup, SETUP_CHART_TF, chartIntentFromAnalysis, frozenLevelsFromEpisode, type StudyClock } from "@/lib/chart/setup-overlay";
import { PullRefresh } from "./pull-refresh";
import { getAsset } from "@/lib/trading/assets";
import {
  foldAssetWatch,
  foldWatchBook,
  setupsEqual,
  watchBooksEqual,
  type AssetWatch,
  type WatchBook,
} from "@/lib/watch/memory";
import { readWatchBook, writeWatchBook } from "@/lib/watch/persist";
import { useWatchLoop } from "@/lib/watch/use-watch-loop";
import { parseWatchLink } from "@/lib/watch/link";
import { AlertsPanel } from "./alerts-panel";
import { HistoryPanel } from "./history-panel";
import { ExplainSheet } from "./explain-sheet";
import { LearnPanel } from "./learn-panel";
import { explainFromAnalysis, explainFromHistory, type ExplainView } from "@/lib/learn/explain";
import type { HistoryRow } from "@/lib/watch/store";
import { InboxPanel } from "./inbox-panel";
import { sheetJournalEpisodeId } from "@/lib/memory/journal";

const CACHE_KEY = "atalaya:last-analysis:v5";
const QUERY_KEY = ["market-analysis"] as const;
const HEALTH_KEY = ["watch-health"] as const;
const SNAPS_KEY = ["watch-snapshots"] as const;

function readCache(): AnalysisSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AnalysisSnapshot) : null;
  } catch {
    return null;
  }
}

function writeCache(data: AnalysisSnapshot) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

function useLocalNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function HeaderClock() {
  const now = useLocalNow();
  return (
    <time
      dateTime={now ? now.toISOString() : undefined}
      className="font-mono text-xs tabular text-subtle"
    >
      {now ? formatClock(now) : "—"}
    </time>
  );
}

function overlayAssetsEqual(a: AssetAnalysis[], b: AssetAnalysis[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id || x.setupState !== y.setupState || x.waitReason !== y.waitReason) return false;
    if (!setupsEqual(x.setup, y.setup)) return false;
  }
  return true;
}

function applyServerTruth(
  assets: AssetAnalysis[],
  snaps: SnapshotDraft[] | undefined,
  stale: boolean,
): AssetAnalysis[] {
  if (stale || !snaps?.length) return assets;
  const byId = new Map(snaps.map((s) => [s.assetId, s]));
  let changed = false;
  const next = assets.map((a) => {
    const s = byId.get(a.id);
    if (!s) return a;
    const setupState = s.state;
    const setup = s.state === "wait" ? null : (s.setup ?? a.setup);
    const waitReason = s.waitReason ?? a.waitReason;
    if (a.setupState === setupState && a.waitReason === waitReason && setupsEqual(a.setup, setup)) {
      return a;
    }
    changed = true;
    return {
      ...a,
      setupState,
      setup,
      waitReason,
    };
  });
  return changed ? next : assets;
}

function overlayAsset(asset: AssetAnalysis, focus: WatchEpisodeView | null): AssetAnalysis {
  if (!focus || focus.assetId !== asset.id || !focus.setup) return asset;
  return {
    ...asset,
    setup: focus.setup,
    setupState: focus.live ? focus.state : "wait",
    waitReason: focus.live ? asset.waitReason : focus.waitReason,
  };
}

function studyClocksEqual(
  a: Partial<Record<AssetId, StudyClock>>,
  b: Partial<Record<AssetId, StudyClock>>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const k of keys) {
    const id = k as AssetId;
    const x = a[id];
    const y = b[id];
    if (!x || !y || x.openedAtMs !== y.openedAtMs || x.closedAtMs !== y.closedAtMs) return false;
  }
  return true;
}

function overlayWatch(
  asset: AssetAnalysis,
  local: AssetWatch | null | undefined,
  focus: WatchEpisodeView | null,
): AssetWatch | null {
  if (!focus || focus.assetId !== asset.id) return local ?? null;
  if (focus.live && focus.setup) {
    return foldAssetWatch(
      null,
      { id: asset.id, setupState: focus.state, setup: focus.setup, waitReason: null },
      Date.now(),
    );
  }
  return {
    id: asset.id,
    phase: "expired",
    currentState: "wait",
    previousState: focus.setup?.state ?? "entry",
    transition: null,
    liveSetup: null,
    expiredSetup: focus.setup,
    expiredFromState: focus.setup?.state ?? "entry",
    expiredAt: focus.closedAtMs,
    expiredReason: focus.waitReason,
    evaluatedAt: Date.now(),
  };
}

export function Dashboard() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"markets" | "calendar" | "charts" | "history" | "learn" | "settings">("markets");
  const [moreOpen, setMoreOpen] = useState(false);
  const [openId, setOpenId] = useState<AssetId | null>(null);
  const [chartIntent, setChartIntent] = useState<ChartIntent | null>(null);
  const [chartBrowse, setChartBrowse] = useState(0);
  const [account, setAccount] = useAccountSettings();
  const [costs, setCosts] = useCosts();
  const [book, setBook] = useState<WatchBook>({});
  const [episodeFocus, setEpisodeFocus] = useState<WatchEpisodeView | null>(null);
  const [explainView, setExplainView] = useState<ExplainView | null>(null);
  const snapshotRef = useRef<AnalysisSnapshot | undefined>(undefined);
  const studyClockRef = useRef<Partial<Record<AssetId, StudyClock>>>({});

  useEffect(() => {
    const cached = readCache();
    if (cached && !qc.getQueryData(QUERY_KEY)) {
      qc.setQueryData(QUERY_KEY, cached);
    }
  }, [qc]);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getMarketAnalysis({ data: { force: false } }),
    staleTime: Infinity,
    refetchOnReconnect: false,
    retry: 1,
  });

  const health = useQuery({
    queryKey: HEALTH_KEY,
    queryFn: () => getWatchHealth(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 0,
  });

  const snaps = useQuery({
    queryKey: SNAPS_KEY,
    queryFn: () => getWatchSnapshots(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 0,
  });

  useEffect(() => {
    if (query.data) writeCache(query.data);
  }, [query.data]);

  const refresh = useMutation({
    mutationFn: () => getMarketAnalysis({ data: { force: true } }),
    onSuccess: (data) => {
      qc.setQueryData(QUERY_KEY, data);
      writeCache(data);
      void qc.invalidateQueries({ queryKey: HEALTH_KEY });
      void qc.invalidateQueries({ queryKey: SNAPS_KEY });
      void qc.invalidateQueries({ queryKey: ["watch-inbox"] });
    },
  });
  const refreshMutateRef = useRef(refresh.mutate);
  refreshMutateRef.current = refresh.mutate;

  const serverStale = health.data?.stale ?? true;
  const serverSnaps = snaps.data;
  const snapshot = useMemo((): AnalysisSnapshot | undefined => {
    if (!query.data) return undefined;
    const assets = applyServerTruth(query.data.assets, serverSnaps, serverStale);
    const next: AnalysisSnapshot =
      assets === query.data.assets ? query.data : { ...query.data, assets };
    const prev = snapshotRef.current;
    if (
      prev &&
      next.generatedAt === prev.generatedAt &&
      overlayAssetsEqual(next.assets, prev.assets)
    ) {
      return prev;
    }
    return next;
  }, [query.data, serverSnaps, serverStale]);
  snapshotRef.current = snapshot;
  const lastEvalMs = (() => {
    if (!snapshot?.generatedAt) return null;
    const t = Date.parse(snapshot.generatedAt);
    return Number.isFinite(t) ? t : null;
  })();
  const busy = query.isLoading || refresh.isPending;
  const runEval = useCallback(() => {
    refresh.mutate();
  }, [refresh]);
  const { visible } = useWatchLoop({
    lastEvalMs,
    busy,
    onEval: runEval,
  });

  const onChartBack = useCallback(() => {
    setTab("markets");
    setChartIntent(null);
  }, []);
  const onChartRefresh = useCallback(() => {
    refreshMutateRef.current();
  }, []);

  const chartSnapshot = useMemo((): AnalysisSnapshot | undefined => {
    if (!snapshot) return undefined;
    if (!episodeFocus) return snapshot;
    let changed = false;
    const assets = snapshot.assets.map((a) => {
      const next = overlayAsset(a, episodeFocus);
      if (next !== a) changed = true;
      return next;
    });
    return changed ? { ...snapshot, assets } : snapshot;
  }, [snapshot, episodeFocus]);

  const studyClockByAsset = useMemo((): Partial<Record<AssetId, StudyClock>> => {
    const out: Partial<Record<AssetId, StudyClock>> = {};
    for (const s of snaps.data ?? []) {
      if (s.openedAtMs != null && Number.isFinite(s.openedAtMs) && s.openedAtMs > 0) {
        out[s.assetId] = { openedAtMs: s.openedAtMs, closedAtMs: s.closedAtMs ?? null };
      }
    }
    if (episodeFocus && episodeFocus.openedAtMs > 0) {
      out[episodeFocus.assetId] = {
        openedAtMs: episodeFocus.openedAtMs,
        closedAtMs: episodeFocus.closedAtMs,
      };
    }
    const prev = studyClockRef.current;
    if (studyClocksEqual(prev, out)) return prev;
    studyClockRef.current = out;
    return out;
  }, [snaps.data, episodeFocus]);

  useEffect(() => {
    if (!snapshot) return;
    const t = Date.parse(snapshot.generatedAt);
    const now = Number.isFinite(t) ? t : Date.now();
    setBook((prev) => {
      const base = Object.keys(prev).length ? prev : readWatchBook(now);
      const next = foldWatchBook(base, snapshot.assets, now);
      if (watchBooksEqual(next, base)) return Object.is(base, prev) ? prev : base;
      writeWatchBook(next);
      return next;
    });
  }, [snapshot]);

  const applyWatchLink = useCallback(async (search: string) => {
    const link = parseWatchLink(search);
    if (!link) return;
    try {
      const view = await getWatchEpisode({ data: { episodeId: link.episodeId } });
      if (!view || view.assetId !== link.assetId) return;
      setEpisodeFocus(view);
      setOpenId(view.assetId);
      setTab("markets");
    } catch {
      /* keep local view */
    }
  }, []);

  useEffect(() => {
    void applyWatchLink(window.location.search);
  }, [applyWatchLink]);

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type !== "ATALAYA_OPEN" || !data.url) return;
      try {
        const u = new URL(data.url, window.location.origin);
        void applyWatchLink(u.search);
        window.history.replaceState(null, "", u.pathname + u.search);
      } catch {
        /* ignore */
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [applyWatchLink]);

  const loading = (query.isFetching && !snapshot) || refresh.isPending;
  const rawOpen = snapshot?.assets.find((a) => a.id === openId) ?? null;
  const openAsset = rawOpen ? overlayAsset(rawOpen, episodeFocus) : null;
  const sheetOpen = openId != null;
  const snapForOpen = openId && snaps.data ? snaps.data.find((s) => s.assetId === openId) : undefined;
  const journalEpisodeId =
    openId != null
      ? sheetJournalEpisodeId({
          assetId: openId,
          setupState: openAsset?.setupState ?? snapForOpen?.state ?? "wait",
          snapshotEpisodeId: snapForOpen?.episodeId ?? null,
          focus: episodeFocus
            ? {
                assetId: episodeFocus.assetId,
                episodeId: episodeFocus.episodeId,
                live: episodeFocus.live,
              }
            : null,
        })
      : null;
  const error =
    refresh.error instanceof Error
      ? refresh.error.message
      : query.error instanceof Error
        ? query.error.message
        : null;

  const openSetupChart = (id: AssetId) => {
    const row = snapshot?.assets.find((a) => a.id === id);
    const shown = row ? overlayAsset(row, episodeFocus) : null;
    if (!shown || !hasChartableSetup(shown)) return;
    const fromFocus =
      episodeFocus && episodeFocus.assetId === id
        ? { openedAtMs: episodeFocus.openedAtMs, closedAtMs: episodeFocus.closedAtMs }
        : null;
    const fromSnap = snaps.data?.find((s) => s.assetId === id);
    const clock: StudyClock | null =
      fromFocus ??
      (fromSnap?.openedAtMs != null
        ? { openedAtMs: fromSnap.openedAtMs, closedAtMs: fromSnap.closedAtMs ?? null }
        : null);
    const intent = chartIntentFromAnalysis(shown, clock);
    if (!intent) return;
    setOpenId(null);
    setChartIntent(intent);
    setTab("charts");
    const episodeId = fromSnap?.episodeId;
    if (clock?.openedAtMs || !episodeId) return;
    void getWatchEpisode({ data: { episodeId } }).then((view) => {
      if (!view || view.assetId !== id) return;
      setChartIntent((prev) => {
        if (!prev?.freeze || prev.assetId !== id) return prev;
        return {
          ...prev,
          freeze: {
            ...prev.freeze,
            openedAtMs: view.openedAtMs,
            closedAtMs: view.closedAtMs,
          },
        };
      });
    });
  };

  return (
    <div className="atalaya-shell" data-chrome={tab === "charts" ? "chart" : "home"}>
      {tab !== "charts" ? (
      <header className="atalaya-header">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-wider text-muted uppercase">Terminal</p>
            <h1 className="atalaya-title text-2xl font-semibold tracking-tight">Atalaya</h1>
          </div>
          <div className="flex items-center gap-0.5">
            <HeaderClock />
            <button
              type="button"
              aria-label="Actualizar análisis"
              title="Actualizar análisis"
              disabled={loading}
              onClick={() => refresh.mutate()}
              className="flex size-11 items-center justify-center rounded-[var(--radius-md)] text-muted disabled:opacity-50"
            >
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            </button>
          </div>
        </div>
        <p className="atalaya-header-sub mt-1 text-xs text-subtle">
          Tiempo real · XAU · BTC · US100 · WTI
        </p>
      </header>
      ) : null}

      <div className="atalaya-stage">
        {tab === "charts" ? (
          <ChartsScreen
            key={chartIntent ? `i-${chartIntent.nonce}` : `l-${chartBrowse}`}
            snapshot={chartSnapshot}
            intent={chartIntent}
            studyClockByAsset={studyClockByAsset}
            onBack={onChartBack}
            onRefresh={onChartRefresh}
          />
        ) : (
          <PullRefresh
            className="atalaya-home"
            onRefresh={() => refresh.mutate()}
            enabled={!sheetOpen}
            data-home-scroll
            inert={sheetOpen || undefined}
            aria-hidden={sheetOpen}
          >
            {snapshot ? (
              <FeedStatus
                assets={snapshot.assets}
                lastEvalMs={lastEvalMs}
                visible={visible}
                watching={!busy && visible}
                server={health.data ?? null}
              />
            ) : (
              <Skeleton className="h-14 rounded-[var(--radius-lg)]" />
            )}

            {error ? (
              <p className="mt-3 rounded-[var(--radius-md)] bg-sell-dim px-3 py-2 text-sm text-sell">
                No se pudo completar la actualización. Se mantienen los últimos datos reales
                disponibles.
              </p>
            ) : null}

            {tab === "markets" ? (
              <div className="atalaya-markets mt-4">
                {snapshot ? (
                  <BestOpportunityCard
                    snapshot={snapshot}
                    asset={(() => {
                      const row = snapshot.assets.find((a) => a.id === snapshot.bestOpportunityId);
                      return row ? overlayAsset(row, episodeFocus) : null;
                    })()}
                    onDetail={() => {
                      if (snapshot.bestOpportunityId) setOpenId(snapshot.bestOpportunityId);
                    }}
                  />
                ) : (
                  <Skeleton className="h-40 rounded-[var(--radius-lg)]" />
                )}
                <p className="atalaya-markets-label pt-1 text-xs font-medium tracking-wider text-muted uppercase">
                  Mercados
                </p>
                {snapshot
                  ? snapshot.assets.map((a) => {
                      const shown = overlayAsset(a, episodeFocus);
                      return (
                        <MarketTile
                          key={a.id}
                          asset={shown}
                          onOpen={() => setOpenId(a.id)}
                        />
                      );
                    })
                  : Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 rounded-[var(--radius-lg)]" />
                    ))}
                {!snapshot && loading ? (
                  <p className="atalaya-markets-label px-1 text-center text-sm text-muted">
                    Obteniendo precios y noticias reales…
                  </p>
                ) : null}
              </div>
            ) : tab === "learn" ? (
              <LearnPanel />
            ) : tab === "settings" ? (
              <div className="mt-4 space-y-3">
                <InboxPanel
                  onOpen={(episodeId, assetId) => {
                    void applyWatchLink(`?asset=${assetId}&episode=${episodeId}`);
                  }}
                />
                <AlertsPanel />
                <AccountPanel
                  value={account}
                  onChange={setAccount}
                  costs={costs}
                  onCostsChange={setCosts}
                />
              </div>
            ) : tab === "history" ? (
              <HistoryPanel
                onOpenEpisode={(episodeId, assetId) => {
                  void applyWatchLink(`?asset=${assetId}&episode=${episodeId}`);
                }}
                onViewChart={(episodeId, assetId) => {
                  void getWatchEpisode({ data: { episodeId } }).then((view) => {
                    if (!view || view.assetId !== assetId) return;
                    setEpisodeFocus(view);
                    setOpenId(null);
                    const freeze = frozenLevelsFromEpisode(view, getAsset(assetId).digits);
                    setChartIntent({
                      assetId,
                      tf: freeze?.tf ?? SETUP_CHART_TF,
                      nonce: Date.now(),
                      freeze,
                    });
                    setTab("charts");
                  });
                }}
                onWhy={(row: HistoryRow) => setExplainView(explainFromHistory(row))}
              />
            ) : (
              <div className="mt-4">
                {snapshot ? (
                  <CalendarList snapshot={snapshot} />
                ) : (
                  <Skeleton className="h-40 rounded-[var(--radius-lg)]" />
                )}
              </div>
            )}

            {snapshot ? (
              <p className="mt-6 pb-4 text-center text-xs leading-relaxed text-subtle">
                {snapshot.disclaimer}
                <br />
                Fuentes: {snapshot.source}
                {snapshot.errors.length
                  ? ` · Avisos: ${snapshot.errors.join(" · ")}`
                  : ""}
              </p>
            ) : null}
          </PullRefresh>
        )}

        <AssetSheet
          asset={openAsset}
          watch={
            openAsset
              ? overlayWatch(openAsset, openId ? book[openId] ?? null : null, episodeFocus)
              : null
          }
          open={sheetOpen}
          account={account}
          costs={openAsset ? costs[openAsset.id] : undefined}
          episodeId={journalEpisodeId}
          onOpenChange={(v) => {
            if (!v) setOpenId(null);
          }}
          onViewChart={
            openAsset && hasChartableSetup(openAsset)
              ? () => openSetupChart(openAsset.id)
              : undefined
          }
          onWhy={openAsset ? () => setExplainView(explainFromAnalysis(openAsset)) : undefined}
        />
        <ExplainSheet
          view={explainView}
          open={explainView != null}
          onClose={() => setExplainView(null)}
          onViewChart={
            explainView && explainView.assetId !== "—" && explainView.levels
              ? () => {
                  const id = explainView.assetId;
                  if (id === "—") return;
                  setExplainView(null);
                  openSetupChart(id);
                }
              : undefined
          }
        />
      </div>
      <nav className="atalaya-dock" aria-label="Navegación">
        <DockBtn
          active={tab === "markets"}
          label="Atalaya"
          onClick={() => {
            setTab("markets");
            setChartIntent(null);
            setMoreOpen(false);
          }}
        >
          <House className="size-4" />
        </DockBtn>
        <DockBtn
          active={tab === "charts"}
          label="Gráficos"
          onClick={() => {
            setOpenId(null);
            setChartIntent(null);
            setChartBrowse((n) => n + 1);
            setTab("charts");
            setMoreOpen(false);
          }}
        >
          <BarChart3 className="size-4" />
        </DockBtn>
        <DockBtn
          active={tab === "calendar"}
          label="Calendario"
          onClick={() => {
            setTab("calendar");
            setChartIntent(null);
            setMoreOpen(false);
          }}
        >
          <CalendarDays className="size-4" />
        </DockBtn>
        <DockBtn
          active={tab === "history"}
          label="Historial"
          onClick={() => {
            setTab("history");
            setChartIntent(null);
            setMoreOpen(false);
          }}
        >
          <BookOpen className="size-4" />
        </DockBtn>
        <DockBtn
          active={tab === "learn" || tab === "settings" || moreOpen}
          label="Más"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <Ellipsis className="size-4" />
        </DockBtn>
      </nav>
      {moreOpen ? (
        <div className="atalaya-more">
          <button type="button" className="atalaya-more-backdrop" aria-label="Cerrar" onClick={() => setMoreOpen(false)} />
          <div className="atalaya-more-panel">
            <p className="px-4 pb-2 text-xs font-medium tracking-wider text-muted uppercase">Más</p>
            <button
              type="button"
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm"
              onClick={() => {
                setTab("learn");
                setChartIntent(null);
                setMoreOpen(false);
              }}
            >
              <GraduationCap className="size-4 text-muted" />
              Aprendizaje
            </button>
            <button
              type="button"
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm"
              onClick={() => {
                setTab("settings");
                setChartIntent(null);
                setMoreOpen(false);
              }}
            >
              <Settings className="size-4 text-muted" />
              Ajustes
            </button>
            <a
              href="/atalaya-source-236.zip"
              download="atalaya-source-236.zip"
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm"
            >
              <Download className="size-4 text-muted" />
              Descargar código (ZIP)
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DockBtn({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex flex-1 flex-col items-center justify-center p-0 text-[10px] leading-none font-medium text-buy"
          : "flex flex-1 flex-col items-center justify-center p-0 text-[10px] leading-none text-muted"
      }
    >
      {children}
      {label}
    </button>
  );
}
