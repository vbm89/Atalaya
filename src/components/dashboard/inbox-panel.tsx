import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { getWatchInbox } from "@/lib/watch/watch.fn";
import { formatMadridClock } from "@/lib/watch/clock";
import { inboxItemKey, inboxStateLabel, type InboxItem } from "@/lib/watch/inbox";
import { loadReadKeys, markInboxRead } from "@/lib/watch/inbox-read";
import type { AssetId } from "@/lib/trading/types";
import { cn } from "@/lib/utils";

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
  const [read, setRead] = useState<Set<string>>(() => loadReadKeys());
  const rows: InboxItem[] = q.data ?? [];
  const unread = rows.filter((r) => !read.has(inboxItemKey(r))).length;

  return (
    <section className="rounded-[var(--radius-lg)] bg-elevated px-4 py-3 shadow-[var(--shadow-border)]" data-inbox>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wider text-muted uppercase">Bandeja</p>
          <p className="mt-0.5 text-sm text-subtle">
            Últimos 20 eventos. Independiente del Push de iOS
            {unread ? ` · ${unread} sin leer` : ""}.
          </p>
        </div>
        <Bell className="mt-0.5 size-4 text-muted" />
      </div>
      {q.isLoading ? (
        <p className="mt-3 text-sm text-subtle">Cargando avisos…</p>
      ) : !rows.length ? (
        <p className="mt-3 text-sm text-subtle">
          Todavía no hay avisos. Si el Push falla, el evento aparece aquí igual.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {rows.map((row) => {
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
                  className="flex min-h-11 w-full items-start justify-between gap-3 rounded-[var(--radius-md)] bg-surface px-3 py-2 text-left"
                  data-inbox-item={row.episodeId}
                  data-inbox-read={isRead ? "1" : "0"}
                >
                  <span>
                    <span className={cn("block text-sm", isRead ? "font-medium" : "font-semibold")}>
                      {row.assetId} · {inboxStateLabel(row.toState)}
                    </span>
                    <span className="mt-0.5 block text-xs text-subtle">
                      {row.direction === "buy" ? "COMPRA" : "VENTA"} ·{" "}
                      {row.live ? "vigente" : "caducado"}
                      {row.notified ? " · Push enviado" : " · solo bandeja"}
                      {isRead ? "" : " · no leído"}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular text-muted">
                    {formatMadridClock(row.atMs)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
