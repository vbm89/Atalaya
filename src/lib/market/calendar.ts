import type { AssetId, CalendarEvent, Importance } from "@/lib/trading/types";
import { fetchJson } from "./http";

interface FfEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}

function importanceOf(raw: string | undefined): Importance | null {
  const v = (raw ?? "").toLowerCase();
  if (v === "high") return "alta";
  if (v === "medium") return "media";
  if (v === "low") return "baja";
  return null;
}

function mapAssets(title: string, country: string): AssetId[] {
  const t = title.toLowerCase();
  const assets = new Set<AssetId>();
  const usd = country === "USD" || country === "US" || country === "All" || country === "";
  const oil =
    /oil|crude|wti|inventor|eia|api|opec|petroleum|crude stocks/i.test(t);
  const goldish =
    /gold|cpi|inflation|fed|fomc|interest rate|pce|nfp|payroll|jackson|powell|symposium/i.test(
      t,
    );
  const risk =
    /cpi|nfp|payroll|fomc|fed|gdp|pmi|interest rate|unemployment|pce|jackson|powell|symposium/i.test(
      t,
    );

  if (oil) assets.add("WTI");
  if (usd && (goldish || risk)) {
    assets.add("XAUUSD");
    assets.add("US100");
    assets.add("BTCUSD");
  }
  if (usd && oil) {
    assets.add("US100");
  }
  if (country === "CNY" && /pmi|gdp/i.test(t)) {
    assets.add("US100");
    assets.add("WTI");
    assets.add("XAUUSD");
  }
  if (usd && assets.size === 0 && (goldish || risk || /jackson|fed/i.test(t))) {
    assets.add("XAUUSD");
    assets.add("US100");
    assets.add("BTCUSD");
    assets.add("WTI");
  }
  return [...assets];
}

export async function fetchCalendar(): Promise<{
  events: CalendarEvent[];
  note: string;
}> {
  const res = await fetchJson<FfEvent[]>(
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    { timeoutMs: 12000, retries: 1 },
  );
  if (!res.ok || !Array.isArray(res.data)) {
    return {
      events: [],
      note: "Calendario económico no disponible en esta actualización.",
    };
  }
  const now = Date.now() - 3 * 60 * 60 * 1000;
  const events: CalendarEvent[] = [];
  for (const e of res.data) {
    if (!e.title || !e.date) continue;
    const imp = importanceOf(e.impact);
    const notable =
      /jackson|powell|fomc|nfp|cpi|opec|pib|gdp/i.test(e.title);
    if ((imp === "baja" || imp == null) && !notable) continue;
    const at = new Date(e.date);
    if (Number.isNaN(at.getTime())) continue;
    if (at.getTime() < now) continue;
    const assets = mapAssets(e.title, e.country ?? "");
    if (assets.length === 0 && e.country !== "USD" && e.country !== "All") continue;
    events.push({
      id: `${e.date}-${e.title}`,
      title: e.title,
      country: e.country ?? "",
      at: at.toISOString(),
      impact: imp ?? "media",
      forecast: e.forecast || null,
      previous: e.previous || null,
      assets: assets.length ? assets : ["US100", "XAUUSD", "BTCUSD", "WTI"],
    });
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const sliced = events.slice(0, 14);
  return {
    events: sliced,
    note:
      sliced.length === 0
        ? "No hay eventos de impacto medio/alto en los próximos días (fuente: calendario Forex Factory)."
        : "Fuente: calendario semanal de Forex Factory. Solo se muestran eventos de impacto medio o alto.",
  };
}
