import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AssetAnalysis, AssetId, SetupState } from "@/lib/trading/types";
import { getWatchHistory, getWatchInbox } from "@/lib/watch/watch.fn";
import { formatMadridClock } from "@/lib/watch/clock";
import { setupStateEs } from "@/lib/watch/memory";
import { inboxStateLabel } from "@/lib/watch/inbox";
import { cn } from "@/lib/utils";
import type { FrozenChartLevels } from "@/lib/chart/setup-overlay";

export interface TimelineEvent {
  id: string;
  atMs: number;
  title: string;
  detail: string;
  tone: "buy" | "sell" | "wait" | "map" | "muted" | "cyan";
}

function toneForState(state: SetupState): TimelineEvent["tone"] {
  if (state === "entry") return "buy";
  if (state === "pending") return "wait";
  if (state === "map") return "map";
  return "muted";
}

function captionForState(state: SetupState): { title: string; detail: string } {
  if (state === "entry") return { title: "ENTRADA", detail: "Se registra la entrada. Análisis, no orden." };
  if (state === "pending") return { title: "PENDING", detail: "Condiciones casi completas." };
  if (state === "map") return { title: "MAPA", detail: "Zona en vigilancia." };
  return { title: "ESPERAR", detail: "Sin setup vigente." };
}

function outcomeEvent(outcome: string | null, atMs: number | null): TimelineEvent | null {
  if (!outcome || atMs == null) return null;
  if (outcome === "tp1") return { id: "tp1", atMs, title: "TP1", detail: "Primer objetivo alcanzado.", tone: "buy" };
  if (outcome === "tp2") return { id: "tp2", atMs, title: "TP2", detail: "Segundo objetivo alcanzado.", tone: "buy" };
  if (outcome === "sl") return { id: "sl", atMs, title: "SL", detail: "Stop alcanzado.", tone: "sell" };
  if (outcome === "expired") return { id: "exp", atMs, title: "Expirada", detail: "Cerrada sin toque de SL ni TP.", tone: "muted" };
  return null;
}

export function timelineFromReal(args: {
  assetId: AssetId;
  asset: AssetAnalysis | null;
  freeze: FrozenChartLevels | null;
  inbox: Array<{
    episodeId: string;
    assetId: AssetId;
    toState: SetupState;
    atMs: number;
    live: boolean;
  }>;
  history: Array<{
    episode: { episodeId: string; assetId: AssetId; openedAtMs: number; openedState: SetupState };
    outcome: string | null;
    firstTouch: string | null;
    firstTouchAtMs: number | null;
  }>;
}): TimelineEvent[] {
  const episodeId = args.freeze?.episodeId ?? null;
  const events: TimelineEvent[] = [];

  const inbox = args.inbox
    .filter((r) => r.assetId === args.assetId && (!episodeId || r.episodeId === episodeId))
    .slice()
    .sort((a, b) => a.atMs - b.atMs);

  for (const row of inbox) {
    const cap = captionForState(row.toState);
    events.push({
      id: `${row.episodeId}-${row.toState}-${row.atMs}`,
      atMs: row.atMs,
      title: cap.title,
      detail: cap.detail,
      tone: toneForState(row.toState),
    });
  }

  const hist = args.history.filter((r) => r.episode.assetId === args.assetId);
  const focused = episodeId ? hist.find((r) => r.episode.episodeId === episodeId) : hist[0];
  if (focused) {
    const open = captionForState(focused.episode.openedState);
    if (!events.some((e) => e.atMs === focused.episode.openedAtMs)) {
      events.push({
        id: `${focused.episode.episodeId}-open`,
        atMs: focused.episode.openedAtMs,
        title: open.title,
        detail: `Se abre como ${setupStateEs(focused.episode.openedState)}.`,
        tone: toneForState(focused.episode.openedState),
      });
    }
    const oc = outcomeEvent(focused.firstTouch ?? focused.outcome, focused.firstTouchAtMs);
    if (oc) events.push(oc);
  }

  if (!events.length && args.asset) {
    events.push({
      id: "live-state",
      atMs: Date.parse(args.asset.lastDataAt ?? args.asset.marketTime ?? "") || Date.now(),
      title: captionForState(args.asset.setupState).title,
      detail: args.asset.waitReason ?? captionForState(args.asset.setupState).detail,
      tone: toneForState(args.asset.setupState),
    });
  }

  events.sort((a, b) => a.atMs - b.atMs);
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.title}-${Math.round(e.atMs / 1000)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function SignalTimeline({
  assetId,
  asset,
  freeze,
}: {
  assetId: AssetId;
  asset: AssetAnalysis | null;
  freeze?: FrozenChartLevels | null;
}) {
  const inboxQ = useQuery({
    queryKey: ["watch-inbox"],
    queryFn: () => getWatchInbox(),
    staleTime: 15_000,
    retry: 0,
  });
  const histQ = useQuery({
    queryKey: ["watch-history"],
    queryFn: () => getWatchHistory(),
    staleTime: 20_000,
    retry: 0,
  });

  const events = useMemo(
    () =>
      timelineFromReal({
        assetId,
        asset,
        freeze: freeze ?? null,
        inbox: inboxQ.data ?? [],
        history: histQ.data ?? [],
      }),
    [assetId, asset, freeze, inboxQ.data, histQ.data],
  );

  if (inboxQ.isLoading || histQ.isLoading) {
    return <p className="px-1 text-sm text-subtle">Cargando timeline…</p>;
  }
  if (!events.length) {
    return (
      <p className="px-1 text-sm text-subtle">
        Sin eventos registrados todavía. La timeline usa transiciones reales de V1, no se reconstruye.
      </p>
    );
  }

  return (
    <ol className="atalaya-timeline" data-signal-timeline={assetId}>
      {events.map((ev, i) => (
        <li key={ev.id} className="atalaya-timeline-item" data-tone={ev.tone}>
          <p className="atalaya-timeline-time">{formatMadridClock(ev.atMs).slice(0, 5)}</p>
          <span className={cn("atalaya-timeline-dot", `is-${ev.tone}`)} />
          {i < events.length - 1 ? <span className="atalaya-timeline-rail" /> : null}
          <div>
            <p className={cn("text-sm font-semibold", toneClass(ev.tone))}>{ev.title}</p>
            <p className="mt-0.5 text-xs leading-snug text-subtle">{ev.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function toneClass(tone: TimelineEvent["tone"]): string {
  if (tone === "buy") return "text-buy";
  if (tone === "sell") return "text-sell";
  if (tone === "wait") return "text-wait";
  if (tone === "map") return "text-map";
  if (tone === "cyan") return "text-cyan";
  return "text-muted";
}

export { inboxStateLabel };
