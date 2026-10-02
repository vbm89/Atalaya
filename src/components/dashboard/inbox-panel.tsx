import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWatchInbox, getWatchHistory } from "@/lib/watch/watch.fn";
import { formatMadridClock } from "@/lib/watch/clock";
import { inboxItemKey, inboxPushLabel, inboxResultLabel, inboxStateLabel, inboxTradeStatus, presentInboxEntries, type InboxItem } from "@/lib/watch/inbox";
import { loadReadKeys, markInboxRead } from "@/lib/watch/inbox-read";
import type { AssetAnalysis, AssetId, DataStatus } from "@/lib/trading/types";
import { ASSETS } from "@/lib/trading/assets";
import { marketSessionKind } from "@/lib/watch/market-session";
import { cn } from "@/lib/utils";

type Filter = "all" | "entry" | "result" | "system";

function timeAgo(atMs: number, now: number): string {
  const d = Math.max(0, now - atMs);
  if (d < 45_000) return "Hace un momento";
  if (d < 3600_000) return `Hace ${Math.max(1, Math.round(d / 60_000))} min`;
  if (d < 86400_000) return `Hace ${Math.max(1, Math.round(d / 3600_000))} h`;
  return formatMadridClock(atMs);
}

export function InboxPanel({
  assets,
  onOpen,
}: {
  assets?: Pick<AssetAnalysis, "id" | "dataStatus" | "label">[] | null;
  onOpen: (episodeId: string, assetId: AssetId) => void;
}) {
  const q = useQuery({
    queryKey: ["watch-inbox"],
    queryFn: () => getWatchInbox(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 0,
  });
  const hist = useQuery({
    queryKey: ["watch-history"],
    queryFn: () => getWatchHistory(),
    staleTime: 20_000,
    retry: 0,
  });
  const [read, setRead] = useState<Set<string>>(() => loadReadKeys());
  const [filter, setFilter] = useState<Filter>("all");
  const rows: InboxItem[] = q.data ?? [];
  const entries = useMemo(() => presentInboxEntries(rows), [rows]);
  const unread = entries.filter((r) => !read.has(inboxItemKey(r))).length;
  const now = Date.now();
  const sessionById = useMemo(() => {
    const map = new Map<AssetId, DataStatus | undefined>();
    for (const a of assets ?? []) map.set(a.id, a.dataStatus);
    return map;
  }, [assets]);

  const outcomeByEpisode = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const row of hist.data ?? []) map.set(row.episode.episodeId, row.outcome);
    return map;
  }, [hist.data]);

  const visibleInbox = entries.filter((r) => {
    const result = inboxResultLabel(outcomeByEpisode.get(r.episodeId));
    if (filter === "result") return result != null;
    if (filter === "system") return false;
    return true;
  });

  return (
    <section className="space-y-3" data-inbox>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Alertas</h2>
        <p className="mt-0.5 text-sm text-subtle">
          Estado actual del mercado y eventos registrados
          {unread ? ` · ${unread} sin leer` : ""}
        </p>
      </div>

      <MarketStatusBlock sessionById={sessionById} />

      <div>
        <h3 className="text-sm font-semibold tracking-tight">Eventos recientes</h3>
        <p className="mt-0.5 text-xs text-subtle">
          Eventos registrados. No son necesariamente el estado actual.
        </p>
      </div>
      <div className="atalaya-chip-row">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>Todas</Chip>
        <Chip active={filter === "entry"} onClick={() => setFilter("entry")}>Entradas</Chip>
        <Chip active={filter === "result"} onClick={() => setFilter("result")}>Resultados</Chip>
        <Chip active={filter === "system"} onClick={() => setFilter("system")}>Sistema</Chip>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-subtle">Cargando avisos…</p>
      ) : !visibleInbox.length ? (
        <p className="text-sm text-subtle">
          {filter === "result"
            ? "Sin resultados registrados todavía."
            : "Todavía no hay avisos. Si el Push falla, el evento aparece aquí igual."}
        </p>
      ) : (
        <ul className="space-y-1">
          {visibleInbox.map((row) => {
            const key = inboxItemKey(row);
            const isRead = read.has(key);
            const session = marketSessionKind({ id: row.assetId, dataStatus: sessionById.get(row.assetId) });
            const result = inboxResultLabel(outcomeByEpisode.get(row.episodeId));
            const status = inboxTradeStatus(row.live);
            return (
              <li key={row.episodeId}>
                <button
                  type="button"
                  onClick={() => {
                    setRead(markInboxRead(row, read));
                    onOpen(row.episodeId, row.assetId);
                  }}
                  className="atalaya-alert-row"
                  data-inbox-item={row.episodeId}
                  data-inbox-read={isRead ? "1" : "0"}
                  data-inbox-kind="entry"
                  data-entry-status={status}
                  data-entry-result={result ?? ""}
                  data-asset-session={session}
                  data-operable={row.live ? "1" : "0"}
                >
                  <span className={cn("atalaya-alert-dot", result === "SL" ? "bg-sell" : "bg-buy")} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className={cn("block text-sm", isRead ? "font-medium" : "font-semibold")}>
                      {row.assetId}
                    </span>
                    <span className="mt-0.5 block text-xs text-subtle">
                      {row.direction === "buy" ? "BUY" : "SELL"}
                      {" · "}
                      {status}
                      {result ? ` · ${result}` : ""}
                      {isRead ? "" : " · no leído"}
                    </span>
                    <span className="sr-only">{inboxStateLabel(row.toState)} · {inboxPushLabel(row)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-subtle">{timeAgo(row.atMs, now)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MarketStatusBlock({
  sessionById,
}: {
  sessionById: Map<AssetId, DataStatus | undefined>;
}) {
  return (
    <section className="atalaya-market-status" data-market-status>
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Estado del mercado</h3>
        <p className="mt-0.5 text-xs text-subtle">Ahora. Independiente de los eventos registrados.</p>
      </div>
      <ul className="atalaya-market-status-grid">
        {ASSETS.map((meta) => {
          const kind = marketSessionKind({ id: meta.id, dataStatus: sessionById.get(meta.id) });
          return (
            <li
              key={meta.id}
              className={cn(
                "atalaya-market-status-row",
                kind === "open" && "is-open",
                kind === "closed" && "is-closed",
                kind === "unknown" && "is-unknown",
              )}
              data-asset={meta.id}
              data-market-session={kind}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{meta.label}</span>
                <span className="block truncate text-[10px] text-subtle">{meta.name}</span>
              </span>
              <span
                className={cn(
                  "atalaya-badge",
                  kind === "open" && "atalaya-badge-open",
                  kind === "closed" && "atalaya-badge-closed",
                  kind === "unknown" && "atalaya-badge-unknown",
                )}
              >
                <span
                  className={cn(
                    "atalaya-session-dot",
                    kind === "open" && "is-open",
                    kind === "closed" && "is-closed",
                    kind === "unknown" && "is-unknown",
                  )}
                  aria-hidden
                />
                {kind === "closed" ? "CERRADO" : kind === "open" ? "ABIERTO" : "NO DISPONIBLE"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? "atalaya-chip is-active" : "atalaya-chip"}
    >
      {children}
    </button>
  );
}
