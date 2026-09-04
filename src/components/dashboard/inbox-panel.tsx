import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getWatchInbox, getWatchHistory } from "@/lib/watch/watch.fn";
import { formatMadridClock } from "@/lib/watch/clock";
import { inboxItemKey, inboxPushLabel, inboxStateLabel, type InboxItem } from "@/lib/watch/inbox";
import { loadReadKeys, markInboxRead } from "@/lib/watch/inbox-read";
import type { AssetId } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

type Filter = "all" | "entry" | "result" | "system";

function timeAgo(atMs: number, now: number): string {
  const d = Math.max(0, now - atMs);
  if (d < 45_000) return "Hace un momento";
  if (d < 3600_000) return `Hace ${Math.max(1, Math.round(d / 60_000))} min`;
  if (d < 86400_000) return `Hace ${Math.max(1, Math.round(d / 3600_000))} h`;
  return formatMadridClock(atMs);
}

function toneForInbox(row: InboxItem): string {
  if (row.toState === "entry") return "bg-buy";
  if (row.toState === "pending") return "bg-cyan";
  if (row.toState === "map") return "bg-map";
  return "bg-muted";
}

export function InboxPanel({
  onOpen,
}: {
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
  const unread = rows.filter((r) => !read.has(inboxItemKey(r))).length;
  const now = Date.now();

  const results = useMemo(() => {
    return (hist.data ?? [])
      .filter((r) => r.outcome === "tp1" || r.outcome === "tp2" || r.outcome === "sl")
      .map((r) => ({
        id: `res-${r.episode.episodeId}`,
        episodeId: r.episode.episodeId,
        assetId: r.episode.assetId,
        direction: r.episode.direction,
        title: (r.outcome ?? "").toUpperCase(),
        atMs: r.firstTouchAtMs ?? r.episode.closedAtMs ?? r.episode.openedAtMs,
        tone: r.outcome === "sl" ? "bg-sell" : "bg-buy",
      }));
  }, [hist.data]);

  const visibleInbox = rows.filter((r) => {
    if (filter === "entry") return r.toState === "entry";
    if (filter === "result") return false;
    if (filter === "system") return r.toState === "wait" || r.toState === "map";
    return true;
  });

  return (
    <section className="space-y-3" data-inbox>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Alertas</h2>
        <p className="mt-0.5 text-sm text-subtle">
          Notificaciones y eventos del sistema
          {unread ? ` · ${unread} sin leer` : ""}
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
      ) : filter === "result" ? (
        results.length ? (
          <ul className="space-y-1">
            {results.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.episodeId, row.assetId)}
                  className="atalaya-alert-row"
                >
                  <span className={cn("atalaya-alert-dot", row.tone)} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold">{row.title}</span>
                    <span className="block text-xs text-subtle">
                      {row.assetId} · {row.direction === "buy" ? "BUY" : "SELL"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-subtle">{timeAgo(row.atMs, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-subtle">Sin resultados registrados todavía.</p>
        )
      ) : !visibleInbox.length ? (
        <p className="text-sm text-subtle">
          Todavía no hay avisos. Si el Push falla, el evento aparece aquí igual.
        </p>
      ) : (
        <ul className="space-y-1">
          {visibleInbox.map((row) => {
            const key = inboxItemKey(row);
            const isRead = read.has(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => {
                    setRead(markInboxRead(row, read));
                    onOpen(row.episodeId, row.assetId);
                  }}
                  className="atalaya-alert-row"
                  data-inbox-item={row.episodeId}
                  data-inbox-read={isRead ? "1" : "0"}
                >
                  <span className={cn("atalaya-alert-dot", toneForInbox(row))} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className={cn("block text-sm", isRead ? "font-medium" : "font-semibold")}>
                      {inboxStateLabel(row.toState)}
                    </span>
                    <span className="mt-0.5 block text-xs text-subtle">
                      {row.assetId} · {row.direction === "buy" ? "BUY" : "SELL"}
                      {isRead ? "" : " · no leído"}
                    </span>
                    <span className="sr-only">{inboxPushLabel(row)}</span>
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
