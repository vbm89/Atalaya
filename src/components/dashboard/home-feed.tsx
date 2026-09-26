import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, Star } from "lucide-react";
/**
 * HOME feed. Presentation of the existing analysis. Does not run Shadow or capture.
 * See docs/HOME_SHELL.md.
 */
import { useEffect, useState } from "react";
import type { AnalysisSnapshot, AssetAnalysis, AssetId, CalendarEvent, SetupState } from "@/lib/trading/types";
import { cn, formatPrice } from "@/lib/utils";
import { displayEntryPrice } from "@/lib/chart/labels";
import { DataLampChip } from "./data-lamp";
import { formatCountdown, formatMadridClock } from "@/lib/watch/clock";
import { nextWatchEvalMs } from "@/lib/watch/schedule";
import { watchLamp, worstDataLamp, watchGlyph, type WatchLampSnap } from "@/lib/watch/feed-lamp";
import { countOperableEntries, marketSessionKind } from "@/lib/watch/market-session";
import { AssetMark, ASSET_SUBTITLE } from "./marks";
import { Sparkline } from "./sparkline";

export function greetingFor(now: Date | null): string {
  if (!now) return "Hola";
  const h = now.getHours();
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
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

export function BestOpportunityCard({
  snapshot,
  asset,
  presentedId,
  presentedNote,
  onDetail,
}: {
  snapshot: AnalysisSnapshot;
  asset: AssetAnalysis | null;
  presentedId?: AssetId | null;
  presentedNote?: string;
  onDetail: () => void;
}) {
  const setup = asset?.setup ?? null;
  const state: SetupState = asset?.setupState ?? "wait";
  const isEntry = state === "entry" && setup != null;
  const shownId = presentedId === undefined ? snapshot.bestOpportunityId ?? null : presentedId;
  const note = presentedNote ?? snapshot.bestOpportunityNote;
  const updated = Date.parse(snapshot.generatedAt);
  const stateLabel =
    state === "pending" ? "TRIGGER PENDIENTE" : state === "entry" ? "ENTRADA" : state === "map" ? "MAPA" : "ESPERAR";
  const qualityBars = setup?.quality === "alta" ? 4 : 3;

  return (
    <section
      className="atalaya-best atalaya-markets-span"
      data-best-opportunity={shownId ?? "none"}
      data-operable-opportunity={shownId && isEntry ? shownId : "none"}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-wait uppercase">
          <Star className="size-3.5 fill-wait" />
          Mejor oportunidad ahora
        </p>
        <p className="text-[10px] text-subtle">
          {Number.isFinite(updated) ? `Actualizado ${formatMadridClock(updated)}` : "Actualizado —"}
        </p>
      </div>
      {!asset || !setup ? (
        <div className="atalaya-empty mt-3">
          <p className="text-sm font-medium">Sin entradas activas</p>
          <p className="mt-1 text-sm leading-snug text-subtle">
            {note || "Atalaya está vigilando el mercado."}
          </p>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <AssetMark id={asset.id} size="sm" />
              <div className="min-w-0">
                <p className="text-lg font-semibold tracking-tight">{asset.label}</p>
                <p className="text-xs text-subtle">{ASSET_SUBTITLE[asset.id]}</p>
              </div>
            </div>
            <span className={cn("atalaya-state-pill", state === "pending" && "is-pending", state === "entry" && "is-entry")}>
              {stateLabel}
            </span>
          </div>
          <span
            className={cn(
              "atalaya-dir",
              setup.direction === "buy" ? "is-buy" : "is-sell",
            )}
          >
            {setup.direction === "buy" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
            {setup.direction === "buy" ? "COMPRA" : "VENTA"}
          </span>
          <dl className="atalaya-levels">
            <div>
              <dt>Entrada</dt>
              <dd data-entry-px>
                {formatPrice(displayEntryPrice(setup.direction, setup.zone.low, setup.zone.high), asset.digits)}
              </dd>
            </div>
            <div>
              <dt>SL</dt>
              <dd className="is-sl">{formatPrice(setup.stopLoss, asset.digits)}</dd>
            </div>
            <div>
              <dt>TP1</dt>
              <dd className="is-tp">{formatPrice(setup.takeProfit1, asset.digits)}</dd>
            </div>
            <div>
              <dt>TP2</dt>
              <dd className="is-tp">{setup.takeProfit2 == null ? "—" : formatPrice(setup.takeProfit2, asset.digits)}</dd>
            </div>
          </dl>
          <div className="atalaya-quality-row">
            <div>
              <p>R:R</p>
              <p className="atalaya-rr">{formatRatio(setup.riskReward)}</p>
            </div>
            <div>
              <p>Calidad {setup.quality}</p>
              <span className="atalaya-bars" aria-hidden>
                {Array.from({ length: 4 }, (_, i) => (
                  <span key={i} className={i < qualityBars ? "is-on" : ""} />
                ))}
              </span>
            </div>
          </div>
          <div className="atalaya-hero-spark mt-3">
            <Sparkline values={asset.sparkline} positive={setup.direction === "buy"} variant="area" />
          </div>
          <button type="button" onClick={onDetail} className="atalaya-detail-btn mt-3">
            Ver detalle
            <ChevronRight className="size-4" />
          </button>
          <p className="sr-only">Oportunidades. Solo ENTRY con mercado abierto. PENDING y MAPA no son operaciones.</p>
        </div>
      )}
    </section>
  );
}

function todayLabel(events: CalendarEvent[], now: Date | null): string {
  const n = eventsToday(events, now);
  return n === 1 ? "1 evento hoy" : `${n} eventos hoy`;
}

function eventsToday(events: CalendarEvent[], now: Date | null): number {
  if (!now) return events.length;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now);
  return events.filter((event) => {
    const t = Date.parse(event.at);
    return Number.isFinite(t) && fmt.format(new Date(t)) === today;
  }).length;
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `1 : ${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}`;
}

const SESSION_CLOCKS = [
  { city: "Londres", zone: "Europe/London", open: 8, close: 17 },
  { city: "Nueva York", zone: "America/New_York", open: 8, close: 17 },
  { city: "Tokio", zone: "Asia/Tokyo", open: 9, close: 18 },
  { city: "Sídney", zone: "Australia/Sydney", open: 8, close: 17 },
] as const;

function deskOpen(zone: string, open: number, close: number, now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (weekday === "Sat" || weekday === "Sun" || !Number.isFinite(hour)) return false;
  return hour >= open && hour < close;
}

export function FeedStatus({
  assets,
  lastEvalMs,
  visible,
  watching,
  server,
  events = [],
  onCalendar,
}: {
  assets: AssetAnalysis[];
  lastEvalMs: number | null;
  visible: boolean;
  watching: boolean;
  server: (WatchLampSnap & { lastEvalMs?: number | null; nextEvalMs?: number | null }) | null;
  events?: CalendarEvent[];
  onCalendar?: () => void;
}) {
  const now = useLocalNow();
  const nextMs = now
    ? server && !server.stale
      ? server.nextEvalMs ?? nextWatchEvalMs(now.getTime())
      : nextWatchEvalMs(now.getTime())
    : null;
  const remain = now && nextMs ? nextMs - now.getTime() : null;
  const nowMs = now?.getTime() ?? Date.now();
  const data = worstDataLamp(
    assets.map((a) => ({
      dataStatus: a.dataStatus,
      dataStatusLabel: a.dataStatusLabel,
      lastDataAt: a.lastDataAt,
      price: a.id === "XAUUSD" ? a.priceSpot : a.price,
    })),
  );
  const watch = watchLamp(
    {
      lastStatus: server?.lastStatus,
      lastOkMs: server?.lastOkMs,
      stale: server?.stale ?? true,
      watchSecretConfigured: server?.watchSecretConfigured ?? false,
    },
    nowMs,
  );
  const entries = countOperableEntries(assets);
  const openMarkets = assets.filter((a) => marketSessionKind({ id: a.id, dataStatus: a.dataStatus }) === "open").length;
  const operativo = watch.lamp === "ok" && data.lamp === "ok";

  return (
    <section className="atalaya-markets-span" data-watch-status={watching ? "active" : visible ? "busy" : "background"}>
      <div className="atalaya-session-row">
        <p className="sr-only">{greetingFor(now)}. Mercado en vigilancia. {assets.length} activos. {openMarkets} mercados abiertos. {entries} oportunidades activas.</p>
        <div className="atalaya-session-grid">
          {SESSION_CLOCKS.map((clock) => {
            const open = now ? deskOpen(clock.zone, clock.open, clock.close, now) : false;
            return (
              <div key={clock.city} className="atalaya-session-pill">
                <p className="text-[9px] tracking-wide text-subtle uppercase">{clock.city}</p>
                <p className={cn("mt-1 flex items-center gap-1 text-[10px] font-semibold", open ? "text-buy" : "text-sell")}>
                  <span className={cn("atalaya-session-dot", open ? "is-open" : "is-closed")} />
                  {open ? "Abierto" : "Cerrado"}
                </p>
              </div>
            );
          })}
        </div>
        <button type="button" className="atalaya-calendar-chip" onClick={onCalendar}>
          <CalendarDays className="atalaya-cal-icon" />
          <span className="min-w-0">
            <p className="text-[11px] font-medium">Calendario</p>
            <p className="text-[10px] text-subtle">{todayLabel(events, now)}</p>
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-muted" />
        </button>
      </div>
      <div className="sr-only" data-watch-lamps>
        <span
          className={cn(
            "atalaya-status-dot",
            !operativo && (watch.lamp === "error" || data.lamp === "unavailable" ? "is-bad" : "is-warn"),
          )}
        />
        <p className="text-[11px] font-medium tracking-wider uppercase">
          {operativo ? "Sistema operativo" : watch.label}
        </p>
        <DataLampChip lamp={data.lamp} label={data.label} note={data.note} />
        <DataLampChip lamp={watch.lamp} label={watch.label} />
      </div>
      <p className="sr-only" data-watch-eval>
        {visible ? (watching ? "Tiempo real · cierre 15M" : "Evaluando…") : "Segundo plano · no vigila"}
        {entries ? ` · ${entries} ENTRADA` : ""}
        {" · "}
        <span data-last-eval>{lastEvalMs ? formatMadridClock(lastEvalMs) : "—"}</span>
        {" · "}
        <span data-countdown>{visible && remain != null ? formatCountdown(remain) : "—"}</span>
      </p>
      <p className="sr-only" data-watch-server>
        Último tick{" "}
        <span data-server-tick>
          {server?.lastEvalMs ? formatMadridClock(server.lastEvalMs) : "sin tick"}
        </span>
        {" · "}
        <span data-server-status>{watchGlyph(watch.lamp)}</span>
      </p>
      {server && !server.watchSecretConfigured ? (
        <p className="mt-1 text-xs text-wait" data-watch-secret-missing>
          Vigilancia 24/7: falta el secreto del servidor.
        </p>
      ) : server?.stale ? (
        <p className="mt-1 text-xs text-wait" data-watch-stale>
          Vigilancia del servidor retrasada (más de 20 min).
        </p>
      ) : null}
    </section>
  );
}
