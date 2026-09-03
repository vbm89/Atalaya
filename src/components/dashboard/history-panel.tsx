import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleHelp, ListFilter, UserRound } from "lucide-react";
import { getWatchHistory, getWatchEpisode } from "@/lib/watch/watch.fn";
import { historyCardModel } from "@/lib/watch/history-view";
import { ASSETS } from "@/lib/trading/assets";
import type { AssetId } from "@/lib/trading/types";
import type { HistoryRow } from "@/lib/watch/store";
import { EpisodeMemory } from "./episode-memory";

type DirectionFilter = "all" | "buy" | "sell";
type OutcomeFilter = "all" | "tp1" | "tp2" | "sl" | "expired" | "pending";

const OUTCOME_FILTERS: { id: OutcomeFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "tp1", label: "TP1" },
  { id: "tp2", label: "TP2" },
  { id: "sl", label: "SL" },
  { id: "expired", label: "Expirada" },
  { id: "pending", label: "Pendiente" },
];

function ChartMixIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      <path
        d="M4 16.5 8.2 13l2.4 1.8L16 9.2l4 2.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d="M7 8v2.2M7 14.6V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="5.6" y="10.2" width="2.8" height="4.4" rx="0.5" fill="currentColor" />
      <path d="M12 6.5v2M12 13.8V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="10.6" y="8.5" width="2.8" height="5.3" rx="0.5" fill="currentColor" />
      <path d="M17 7.2v1.8M17 13.2V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="15.6" y="9" width="2.8" height="4.2" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function outcomeBadgeClass(cls: string): string {
  if (cls.includes("buy")) return "bg-buy-dim text-buy";
  if (cls.includes("sell")) return "bg-sell-dim text-sell";
  if (cls.includes("wait")) return "bg-wait-dim text-wait";
  return "bg-surface text-muted";
}

function HistoryRowCard({
  row,
  journalOpen,
  onOpenEpisode,
  onViewChart,
  onWhy,
  onToggleJournal,
}: {
  row: HistoryRow;
  journalOpen: boolean;
  onOpenEpisode: (episodeId: string, assetId: AssetId) => void;
  onViewChart: (episodeId: string, assetId: AssetId) => void;
  onWhy?: (row: HistoryRow) => void;
  onToggleJournal: (episodeId: string) => void;
}) {
  const card = historyCardModel(row);
  const buy = row.episode.direction === "buy";
  const side = buy ? "BUY" : "SELL";
  const meta = [
    `Abrió como ${card.signalOpened}`,
    card.quality ? `calidad ${card.quality}` : null,
    card.rr ? `R:R ${card.rr}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <article
        className="atalaya-history-card"
        data-history-episode={card.episodeId}
        data-history-outcome={card.outcome}
        data-direction={row.episode.direction}
      >
        <button
          type="button"
          className="w-full px-3.5 pt-3 pb-2.5 text-left"
          onClick={() => onOpenEpisode(card.episodeId, card.assetId)}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium tracking-wide">
              {card.assetId}
              <span className="text-subtle"> · </span>
              <span className={buy ? "text-buy" : "text-sell"}>{side}</span>
              <span className="text-subtle"> · </span>
              <span className="text-muted">{card.timeframe}</span>
            </p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide ${outcomeBadgeClass(card.outcomeCls)}`}
            >
              {card.outcome}
            </span>
          </div>
          <p className="mt-1 text-xs leading-snug text-muted">{meta}</p>
          <p className="mt-0.5 font-mono text-[11px] tabular text-subtle">
            {card.openedStamp}
            {card.closedStamp ? ` → ${card.closedStamp}` : ""}
          </p>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <div>
              <p className="text-[10px] font-medium tracking-[0.14em] text-muted uppercase">Entrada</p>
              <p className="mt-0.5 font-mono text-sm tabular text-fg">{card.entry}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium tracking-[0.14em] text-sell uppercase">SL</p>
              <p className="mt-0.5 font-mono text-sm tabular text-sell">{card.sl}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium tracking-[0.14em] text-buy uppercase">TP1</p>
              <p className="mt-0.5 font-mono text-sm tabular text-buy">{card.tp1}</p>
            </div>
          </div>
          {card.tp2 ? (
            <p className="mt-1 font-mono text-[11px] tabular text-buy">TP2 {card.tp2}</p>
          ) : null}
          <p className="mt-2 text-[11px] leading-snug text-subtle">{card.wick}</p>
        </button>

        <div
          className="atalaya-history-actions"
          role="group"
          aria-label={`Acciones de ${card.assetId}`}
        >
          {onWhy ? (
            <button
              type="button"
              data-explain-why={card.episodeId}
              aria-label="Ver por qué"
              title="Por qué"
              className="atalaya-history-action"
              onClick={() => onWhy(row)}
            >
              <CircleHelp className="size-4" />
            </button>
          ) : (
            <span className="atalaya-history-action pointer-events-none opacity-30" />
          )}
          <button
            type="button"
            data-history-chart={card.episodeId}
            aria-label="Ver gráfico"
            title="Gráfico"
            className="atalaya-history-action"
            onClick={() => onViewChart(card.episodeId, card.assetId)}
          >
            <ChartMixIcon className="size-4" />
          </button>
          <button
            type="button"
            data-history-journal={card.episodeId}
            aria-label={journalOpen ? "Ocultar diario humano" : "Abrir diario humano"}
            title="Diario humano"
            aria-expanded={journalOpen}
            className={journalOpen ? "atalaya-history-action is-active" : "atalaya-history-action"}
            onClick={() => onToggleJournal(card.episodeId)}
          >
            <UserRound className="size-4" />
          </button>
        </div>

        {journalOpen ? <EpisodeMemory episodeId={card.episodeId} /> : null}
      </article>
    </li>
  );
}

export function HistoryPanel({
  onOpenEpisode,
  onViewChart,
  onWhy,
}: {
  onOpenEpisode: (episodeId: string, assetId: AssetId) => void;
  onViewChart: (episodeId: string, assetId: AssetId) => void;
  onWhy?: (row: HistoryRow) => void;
}) {
  const [journalEpisodeId, setJournalEpisodeId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assetFilter, setAssetFilter] = useState<AssetId | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");

  const q = useQuery({
    queryKey: ["watch-history"],
    queryFn: () => getWatchHistory(),
    staleTime: 20_000,
    retry: 0,
  });
  const rows = q.data ?? [];
  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (assetFilter !== "all" && row.episode.assetId !== assetFilter) return false;
      if (directionFilter !== "all" && row.episode.direction !== directionFilter) return false;
      if (outcomeFilter !== "all" && row.outcome !== outcomeFilter) return false;
      return true;
    });
  }, [rows, assetFilter, directionFilter, outcomeFilter]);
  const activeFilters =
    (assetFilter !== "all" ? 1 : 0) +
    (directionFilter !== "all" ? 1 : 0) +
    (outcomeFilter !== "all" ? 1 : 0);

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
    <div className="mt-4" data-history-list>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs tabular text-subtle">
          {filtered.length === rows.length
            ? `${rows.length} episodios`
            : `${filtered.length} de ${rows.length}`}
        </p>
        <button
          type="button"
          data-history-filter
          aria-expanded={filtersOpen}
          aria-label="Filtrar historial"
          className={
            filtersOpen || activeFilters
              ? "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] bg-buy-dim px-3 text-xs font-medium text-buy"
              : "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] bg-elevated px-3 text-xs font-medium text-muted shadow-[var(--shadow-border)]"
          }
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <ListFilter className="size-3.5" />
          Filtrar
          {activeFilters ? <span className="tabular">{activeFilters}</span> : null}
        </button>
      </div>

      {filtersOpen ? (
        <div className="mt-3 space-y-3 rounded-[var(--radius-lg)] bg-elevated px-3 py-3 shadow-[var(--shadow-border)]">
          <div>
            <p className="text-[10px] font-medium tracking-[0.14em] text-subtle uppercase">Activo</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <FilterChip active={assetFilter === "all"} onClick={() => setAssetFilter("all")}>
                Todos
              </FilterChip>
              {ASSETS.map((a) => (
                <FilterChip
                  key={a.id}
                  active={assetFilter === a.id}
                  onClick={() => setAssetFilter(a.id)}
                >
                  {a.id}
                </FilterChip>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-[0.14em] text-subtle uppercase">Dirección</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <FilterChip active={directionFilter === "all"} onClick={() => setDirectionFilter("all")}>
                Todas
              </FilterChip>
              <FilterChip active={directionFilter === "buy"} onClick={() => setDirectionFilter("buy")}>
                BUY
              </FilterChip>
              <FilterChip active={directionFilter === "sell"} onClick={() => setDirectionFilter("sell")}>
                SELL
              </FilterChip>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-[0.14em] text-subtle uppercase">Resultado</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {OUTCOME_FILTERS.map((f) => (
                <FilterChip
                  key={f.id}
                  active={outcomeFilter === f.id}
                  onClick={() => setOutcomeFilter(f.id)}
                >
                  {f.label}
                </FilterChip>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {filtered.length ? (
        <ul className="mt-3 space-y-2.5">
          {filtered.map((row) => (
            <HistoryRowCard
              key={row.episode.episodeId}
              row={row}
              journalOpen={journalEpisodeId === row.episode.episodeId}
              onOpenEpisode={onOpenEpisode}
              onViewChart={onViewChart}
              onWhy={onWhy}
              onToggleJournal={(id) => setJournalEpisodeId((prev) => (prev === id ? null : id))}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-subtle">Ningún episodio con este filtro.</p>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={
        active
          ? "min-h-8 rounded-full bg-buy-dim px-2.5 text-[11px] font-medium text-buy"
          : "min-h-8 rounded-full bg-surface px-2.5 text-[11px] font-medium text-muted"
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export async function loadHistoryEpisode(episodeId: string) {
  return getWatchEpisode({ data: { episodeId } });
}
