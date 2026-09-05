import { useState } from "react";
import type { AssetAnalysis, AssetId } from "@/lib/trading/types";
import type { FrozenChartLevels } from "@/lib/chart/setup-overlay";
import { ExplainInline } from "./explain-sheet";
import { explainFromAnalysis } from "@/lib/learn/explain";
import { SignalSummary } from "./signal-summary";
import { SignalTimeline } from "./signal-timeline";
import { SetupPanel } from "./setup-panel";
import { EpisodeMemory } from "./episode-memory";
import { useAccountSettings, useCosts } from "./account-panel";
import type { AssetWatch } from "@/lib/watch/memory";
import { cn } from "@/lib/utils";
import { ClosedPendingNotice } from "./session-state";
import { episodeMarketView } from "@/lib/watch/market-session";

const TABS = [
  { id: "resumen", label: "Resumen" },
  { id: "why", label: "¿Por qué?" },
  { id: "timeline", label: "Timeline" },
  { id: "details", label: "Detalles" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function MarketDock({
  assetId,
  asset,
  freeze,
  watch,
  episodeId,
  onWhy,
}: {
  assetId: AssetId;
  asset: AssetAnalysis | null;
  freeze?: FrozenChartLevels | null;
  watch?: AssetWatch | null;
  episodeId?: string | null;
  onWhy?: () => void;
}) {
  const [tab, setTab] = useState<TabId>("resumen");
  const [account] = useAccountSettings();
  const [costs] = useCosts();
  const explain = asset ? explainFromAnalysis(asset) : null;
  const market = asset
    ? episodeMarketView({
        id: asset.id,
        setupState: freeze?.state ?? asset.setupState,
        dataStatus: asset.dataStatus,
      })
    : null;

  return (
    <section className="atalaya-market-dock">
      <div className="atalaya-signal-tabs" role="tablist" aria-label="Información de la señal">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={cn("atalaya-signal-tab", tab === t.id && "is-active")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="atalaya-market-dock-body" role="tabpanel">
        {asset && market?.closedPending ? (
          <div className="pb-3">
            <ClosedPendingNotice
              id={asset.id}
              setupState={freeze?.state ?? asset.setupState}
              dataStatus={asset.dataStatus}
            />
          </div>
        ) : null}
        {tab === "resumen" ? <SignalSummary asset={asset} freeze={freeze} /> : null}
        {tab === "why" ? (
          explain ? (
            <ExplainInline view={explain} />
          ) : (
            <p className="text-sm text-subtle">Sin análisis cargado para explicar.</p>
          )
        ) : null}
        {tab === "timeline" ? (
          <SignalTimeline assetId={assetId} asset={asset} freeze={freeze} episodeId={episodeId} />
        ) : null}
        {tab === "details" ? (
          asset ? (
            <div className="space-y-3">
              <SetupPanel
                asset={asset}
                watch={watch}
                account={account}
                costs={costs[asset.id]}
                onWhy={onWhy}
              />
              {episodeId ? <EpisodeMemory episodeId={episodeId} /> : null}
              <p className="text-xs leading-relaxed text-subtle">{asset.technicalSummary}</p>
            </div>
          ) : (
            <p className="text-sm text-subtle">Sin ficha de detalles.</p>
          )
        ) : null}
      </div>
    </section>
  );
}
