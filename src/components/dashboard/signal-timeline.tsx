import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import type { AssetAnalysis, AssetId, SetupState } from "@/lib/trading/types";
import { getWatchEpisodeEvents, getWatchHistory, getWatchSnapshots } from "@/lib/watch/watch.fn";
import { setupStateEs } from "@/lib/watch/memory";
import { cn } from "@/lib/utils";
import type { FrozenChartLevels } from "@/lib/chart/setup-overlay";
import {
  buildSignalTimeline,
  formatTimelineHm,
  resolveTimelineEpisodeId,
  type TimelineTone,
} from "@/lib/watch/signal-timeline";

export function SignalTimeline({
  assetId,
  asset,
  freeze,
  episodeId,
}: {
  assetId: AssetId;
  asset: AssetAnalysis | null;
  freeze?: FrozenChartLevels | null;
  episodeId?: string | null;
}) {
  const snapsQ = useQuery({
    queryKey: ["watch-snapshots"],
    queryFn: () => getWatchSnapshots(),
    staleTime: 15_000,
    retry: 0,
  });
  const histQ = useQuery({
    queryKey: ["watch-history"],
    queryFn: () => getWatchHistory(),
    staleTime: 20_000,
    retry: 0,
  });

  const snapId = snapsQ.data?.find((s) => s.assetId === assetId)?.episodeId;
  const openHistId = histQ.data?.find(
    (r) => r.episode.assetId === assetId && r.episode.closedAtMs == null,
  )?.episode.episodeId;

  const focusedId = resolveTimelineEpisodeId(freeze?.episodeId, episodeId, snapId, openHistId);

  const eventsQ = useQuery({
    queryKey: ["watch-episode-events", focusedId],
    queryFn: () => getWatchEpisodeEvents({ data: { episodeId: focusedId! } }),
    enabled: Boolean(focusedId),
    staleTime: 15_000,
    retry: 0,
  });

  const events = useMemo(
    () =>
      buildSignalTimeline({
        assetId,
        episodeId: focusedId,
        events: eventsQ.data ?? [],
        history: histQ.data ?? [],
      }),
    [assetId, focusedId, eventsQ.data, histQ.data],
  );

  const loading = snapsQ.isLoading || histQ.isLoading || (Boolean(focusedId) && eventsQ.isLoading);
  const current: SetupState | null = freeze?.state ?? asset?.setupState ?? null;
  const eventsFailed = Boolean(focusedId) && eventsQ.isError;

  return (
    <section
      className="atalaya-timeline-wrap"
      data-signal-timeline={assetId}
      data-timeline-episode={focusedId ?? ""}
    >
      <div className="px-1">
        <h3 className="text-[17px] font-semibold tracking-tight">Timeline — {assetId}</h3>
        <p className="mt-0.5 text-xs text-subtle">Evolución de la señal en el tiempo</p>
      </div>

      {loading ? (
        <p className="mt-3 px-1 text-sm text-subtle">Cargando timeline…</p>
      ) : !focusedId ? (
        <div className="mt-3 px-1" data-timeline-empty="no-episode">
          <p className="text-sm text-subtle">Sin episodio concreto. El Timeline no inventa una historia.</p>
          {current && current !== "wait" ? (
            <p className="mt-1 text-xs text-muted">Estado actual: {setupStateEs(current)}.</p>
          ) : null}
        </div>
      ) : eventsFailed ? (
        <p className="mt-3 px-1 text-sm text-subtle" data-timeline-empty="error">
          No se pudieron leer los eventos V1 de este episodio. No se reconstruye.
        </p>
      ) : !events.length ? (
        <p className="mt-3 px-1 text-sm text-subtle" data-timeline-empty="no-events">
          Sin transiciones V1 registradas para este episodio. No se reconstruye.
        </p>
      ) : (
        <ol className="atalaya-timeline mt-3">
          {events.map((ev, i) => {
            const last = i === events.length - 1;
            return (
              <li
                key={ev.id}
                className={cn("atalaya-timeline-item", last && "is-last")}
                data-tone={ev.tone}
                data-timeline-kind={ev.kind}
              >
                <div className="atalaya-timeline-when">
                  <span className="atalaya-timeline-clock" aria-hidden="true">
                    <Clock strokeWidth={2.25} />
                  </span>
                  <time className="atalaya-timeline-time" dateTime={new Date(ev.atMs).toISOString()}>
                    {formatTimelineHm(ev.atMs)}
                  </time>
                </div>
                <div className="atalaya-timeline-axis">
                  <span className={cn("atalaya-timeline-dot", `is-${ev.tone}`)} />
                  {!last ? <span className="atalaya-timeline-rail" /> : null}
                </div>
                <div className="min-w-0 pb-0.5">
                  <p className={cn("text-sm font-semibold leading-tight", toneClass(ev.tone))}>{ev.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-subtle">{ev.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {focusedId && !loading ? (
        <p className="atalaya-timeline-note" data-timeline-unregistered="1">
          BOS 4H, zona de origen y T2 no aparecen: V1 no los registra como eventos con hora.
        </p>
      ) : null}
    </section>
  );
}

function toneClass(tone: TimelineTone): string {
  if (tone === "buy") return "text-buy";
  if (tone === "sell") return "text-sell";
  if (tone === "wait") return "text-wait";
  if (tone === "map") return "text-cyan";
  return "text-muted";
}
