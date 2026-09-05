import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleHelp, UserRound } from "lucide-react";
import { getWatchHistory, getWatchEpisode } from "@/lib/watch/watch.fn";
import { historyBuckets, historyCardModel } from "@/lib/watch/history-view";
import { episodeMarketView } from "@/lib/watch/market-session";
import { ASSETS } from "@/lib/trading/assets";
import type { AssetId } from "@/lib/trading/types";
import type { HistoryRow } from "@/lib/watch/store";
import { EpisodeMemory } from "./episode-memory";
import { AssetMark } from "./marks";
import { SessionKindBadge } from "./session-state";
import { cn } from "@/lib/utils";

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
  if (cls.includes("buy")) return "atalaya-badge atalaya-badge-entry";
  if (cls.includes("sell")) return "atalaya-badge atalaya-badge-sell";
  if (cls.includes("wait")) return "atalaya-badge atalaya-badge-wait";
  return "atalaya-badge atalaya-badge-muted";
}

function stateBadgeClass(state: string): string {
  if (state === "ENTRY") return "atalaya-badge atalaya-badge-entry";
  if (state === "PENDING") return "atalaya-badge atalaya-badge-wait";
  if (state === "MAPA") return "atalaya-badge atalaya-badge-map";
  return "atalaya-badge atalaya-badge-muted";
}

function resultR(row: HistoryRow, rr: string | null): string | null {
  if (row.hadV1Entry !== true) return null;
  if (row.outcome === "sl") return "−1,00R";
  if (row.outcome === "tp1" || row.outcome === "tp2") return rr ? `+${rr}R` : null;
  return null;
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
  const rLabel = resultR(row, card.rr);
  const date = card.openedStamp.replace(/,?\s+\d{2}:\d{2}:\d{2}$/, "");
  const live =
    row.episode.closedAtMs == null && row.episode.currentState !== "wait";
  const showOutcomeBadge = card.isTradeOutcome || (card.outcome.startsWith("toque técnico") || card.outcome === "EXPIRADA");
  const market = live
    ? episodeMarketView({
        id: row.episode.assetId,
        setupState: row.episode.currentState,
      })
    : null;

  return (
    <li>
      <article
        className={cn("atalaya-history-card", market?.closedPending && "is-market-closed")}
        data-history-episode={card.episodeId}
        data-history-outcome={card.outcome}
        data-history-entry-v1={card.hadV1Entry ? "yes" : "no"}
        data-direction={row.episode.direction}
        data-market-session={market?.session ?? ""}
        data-operable={market ? (market.operable ? "1" : "0") : ""}
      >
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3.5 pt-3 pb-2.5 text-left"
          onClick={() => onOpenEpisode(card.episodeId, card.assetId)}
        >
          <AssetMark id={card.assetId} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-wide">{card.assetId}</p>
            <p className="mt-0.5 font-mono text-[11px] tabular text-subtle">{date}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <span className={buy ? "text-xs font-semibold text-buy" : "text-xs font-semibold text-sell"}>{side}</span>
              <span className={stateBadgeClass(card.episodeState)}>{card.episodeState}</span>
              <span className="atalaya-badge atalaya-badge-muted">ENTRY V1: {card.entryV1Label}</span>
              {showOutcomeBadge ? (
                <span className={card.isTradeOutcome ? outcomeBadgeClass(card.outcomeCls) : "atalaya-badge atalaya-badge-muted"}>
                  {card.outcome}
                </span>
              ) : null}
              {market?.session === "closed" ? <SessionKindBadge kind="closed" compact /> : null}
            </div>
            <p className="font-mono text-[11px] tabular text-subtle">
              {card.rr ? `R:R ${card.rr}` : ""}
              {rLabel ? `  ${rLabel}` : ""}
            </p>
            {market?.caption ? (
              <p className="max-w-[12.5rem] text-right text-[10px] leading-snug text-subtle">
                {market.caption}
              </p>
            ) : card.setupCaption && !card.hadV1Entry ? (
              <p className="max-w-[12.5rem] text-right text-[10px] leading-snug text-subtle">
                {card.setupCaption}
              </p>
            ) : null}
          </div>
          <span className="text-subtle">›</span>
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
  const [assetFilter, setAssetFilter] = useState<AssetId | "all">("all");

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
      return true;
    });
  }, [rows, assetFilter]);

  if (q.isLoading) {
    return (
      <div className="mt-2">
        <h2 className="text-xl font-semibold tracking-tight">Historial</h2>
        <p className="mt-4 text-sm text-subtle">Cargando historial…</p>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="mt-2">
        <h2 className="text-xl font-semibold tracking-tight">Historial</h2>
        <p className="mt-4 text-sm text-sell">
          No se ha podido leer el historial del servidor. No se inventan episodios.
        </p>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="mt-2">
        <h2 className="text-xl font-semibold tracking-tight">Historial</h2>
        <p className="mt-0.5 text-sm text-subtle">
          Episodios registrados. MAPA y PENDING no son operaciones ejecutadas.
        </p>
        <p className="mt-4 text-sm text-subtle">
          Todavía no hay episodios reales. El historial se llena cuando el servidor evalúa V1
          (cierre M15). No se simulan señales.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2" data-history-list>
      <h2 className="text-xl font-semibold tracking-tight">Historial</h2>
      <p className="mt-0.5 text-sm text-subtle">
        Episodios registrados. MAPA y PENDING no son operaciones ejecutadas.
      </p>
      <div className="atalaya-chip-row mt-3">
        <FilterChip active={assetFilter === "all"} onClick={() => setAssetFilter("all")}>
          Todas
        </FilterChip>
        {ASSETS.map((a) => (
          <FilterChip key={a.id} active={assetFilter === a.id} onClick={() => setAssetFilter(a.id)}>
            {a.id}
          </FilterChip>
        ))}
      </div>
      <p className="mt-2 text-xs tabular text-subtle">
        {filtered.length === rows.length
          ? `${rows.length} episodios`
          : `${filtered.length} de ${rows.length}`}
      </p>

      {filtered.length ? (
        <HistoryBuckets
          rows={filtered}
          journalEpisodeId={journalEpisodeId}
          onOpenEpisode={onOpenEpisode}
          onViewChart={onViewChart}
          onWhy={onWhy}
          onToggleJournal={(id) => setJournalEpisodeId((prev) => (prev === id ? null : id))}
        />
      ) : (
        <p className="mt-3 text-sm text-subtle">Ningún episodio con este filtro.</p>
      )}
    </div>
  );
}

function HistoryBuckets({
  rows,
  journalEpisodeId,
  onOpenEpisode,
  onViewChart,
  onWhy,
  onToggleJournal,
}: {
  rows: HistoryRow[];
  journalEpisodeId: string | null;
  onOpenEpisode: (episodeId: string, assetId: AssetId) => void;
  onViewChart: (episodeId: string, assetId: AssetId) => void;
  onWhy?: (row: HistoryRow) => void;
  onToggleJournal: (episodeId: string) => void;
}) {
  const { operations, setups } = historyBuckets(rows);
  return (
    <div className="mt-3 space-y-5">
      <section data-history-bucket="operations">
        <h3 className="text-sm font-semibold tracking-tight">Operaciones V1</h3>
        <p className="mt-0.5 text-xs text-subtle">
          Solo episodios con evento <span className="font-mono">to_state=entry</span>. Shadow no aparece aquí.
        </p>
        {operations.length ? (
          <ul className="mt-2 space-y-2.5">
            {operations.map((row) => (
              <HistoryRowCard
                key={row.episode.episodeId}
                row={row}
                journalOpen={journalEpisodeId === row.episode.episodeId}
                onOpenEpisode={onOpenEpisode}
                onViewChart={onViewChart}
                onWhy={onWhy}
                onToggleJournal={onToggleJournal}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-subtle">Ninguna operación V1 en esta ventana.</p>
        )}
      </section>
      <section data-history-bucket="setups">
        <h3 className="text-sm font-semibold tracking-tight">Setups que no entraron</h3>
        <p className="mt-0.5 text-xs text-subtle">
          MAPA y PENDIENTE. Un toque técnico de SL/TP no es una operación ejecutada.
        </p>
        {setups.length ? (
          <ul className="mt-2 space-y-2.5">
            {setups.map((row) => (
              <HistoryRowCard
                key={row.episode.episodeId}
                row={row}
                journalOpen={journalEpisodeId === row.episode.episodeId}
                onOpenEpisode={onOpenEpisode}
                onViewChart={onViewChart}
                onWhy={onWhy}
                onToggleJournal={onToggleJournal}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-subtle">Ningún setup sin entrada en esta ventana.</p>
        )}
      </section>
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
          ? "atalaya-chip is-active"
          : "atalaya-chip"
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
