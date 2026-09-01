import { useQuery } from "@tanstack/react-query";
import { getWatchHistory, getWatchEpisode } from "@/lib/watch/watch.fn";
import { historyCardModel } from "@/lib/watch/history-view";
import type { AssetId } from "@/lib/trading/types";
import type { HistoryRow } from "@/lib/watch/store";
import { EpisodeMemory } from "./episode-memory";

export function HistoryPanel({
  onOpenEpisode,
  onViewChart,
  onWhy,
}: {
  onOpenEpisode: (episodeId: string, assetId: AssetId) => void;
  onViewChart: (episodeId: string, assetId: AssetId) => void;
  onWhy?: (row: HistoryRow) => void;
}) {
  const q = useQuery({
    queryKey: ["watch-history"],
    queryFn: () => getWatchHistory(),
    staleTime: 20_000,
    retry: 0,
  });
  const rows = q.data ?? [];

  if (q.isLoading) {
    return <p className="mt-4 text-sm text-subtle">Cargando historial…</p>;
  }
  if (q.isError) {
    return (
      <p className="mt-4 text-sm text-sell">
        No se ha podido leer el historial del servidor. No se inventan episodios.
      </p>
    );
  }
  if (!rows.length) {
    return (
      <p className="mt-4 text-sm text-subtle">
        Todavía no hay episodios reales. El historial se llena cuando el servidor evalúa V1
        (cierre M15). No se simulan señales.
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-2" data-history-list>
      {rows.map((row) => {
        const card = historyCardModel(row);
        return (
          <li key={card.episodeId}>
            <article
              className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]"
              data-history-episode={card.episodeId}
              data-history-outcome={card.outcome}
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => onOpenEpisode(card.episodeId, card.assetId)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    {card.assetId} · {card.direction} · {card.timeframe}
                  </p>
                  <p className={`text-xs font-medium ${card.outcomeCls}`}>{card.outcome}</p>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Abrió como {card.signalOpened}
                  {card.signalNow !== card.signalOpened ? ` · ahora ${card.signalNow}` : ""}
                  {" · "}
                  {card.kind}
                  {card.quality ? ` · calidad ${card.quality}` : ""}
                  {card.rr ? ` · R:R ${card.rr}` : ""}
                </p>
                <p className="mt-1 font-mono text-xs tabular text-subtle">
                  {card.openedStamp}
                  {card.closedStamp ? ` → ${card.closedStamp}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Entrada {card.entry} · Zona {card.zone} · SL {card.sl} · TP1 {card.tp1}
                  {card.tp2 ? ` · TP2 ${card.tp2}` : ""}
                </p>
                <p className="mt-1 text-xs leading-snug text-subtle">{card.wick}</p>
                <p className="mt-1 text-[11px] tracking-wide text-subtle uppercase">
                  {card.disclaimer}
                </p>
              </button>
              {onWhy ? (
                <button
                  type="button"
                  data-explain-why={card.episodeId}
                  className="mt-2 min-h-11 w-full rounded-[var(--radius-md)] bg-surface text-sm font-medium"
                  onClick={() => onWhy(row)}
                >
                  ¿Por qué?
                </button>
              ) : null}
              <button
                type="button"
                className="mt-2 min-h-11 w-full rounded-[var(--radius-md)] bg-surface text-sm font-medium"
                onClick={() => onViewChart(card.episodeId, card.assetId)}
              >
                VER GRÁFICO
              </button>
              <EpisodeMemory
                episodeId={card.episodeId}
                allowJournal={row.episode.openedState === "entry" || row.episode.currentState === "entry"}
              />
            </article>
          </li>
        );
      })}
    </ul>
  );
}

export async function loadHistoryEpisode(episodeId: string) {
  return getWatchEpisode({ data: { episodeId } });
}
