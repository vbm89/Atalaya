const MADRID = "Europe/Madrid";

export type SessionName = "asia" | "londres" | "ny" | "solape" | "fuera";

export interface MadridStamp {
  date: string;
  time: string;
  weekday: string;
  hour: number;
  minute: number;
}

function partsAt(ms: number): MadridStamp | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const hour = Number(bag.hour);
  const minute = Number(bag.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return {
    date: `${bag.day}/${bag.month}/${bag.year}`,
    time: `${bag.hour}:${bag.minute}`,
    weekday: bag.weekday ?? "PENDIENTE",
    hour,
    minute,
  };
}

/** Asia 00:00–08:59, Londres 09:00–17:59, NY 14:30–22:59, solape 14:30–17:59 (Europe/Madrid). */
export function sessionFromStamp(stamp: MadridStamp): SessionName {
  const mins = stamp.hour * 60 + stamp.minute;
  const inLondon = mins >= 9 * 60 && mins < 18 * 60;
  const inNy = mins >= 14 * 60 + 30 && mins < 23 * 60;
  if (inLondon && inNy) return "solape";
  if (inLondon) return "londres";
  if (inNy) return "ny";
  if (mins < 9 * 60) return "asia";
  return "fuera";
}

export function madridStamp(ms: number): MadridStamp | null {
  return partsAt(ms);
}

export function sessionLabel(name: SessionName): string {
  if (name === "londres") return "Londres";
  if (name === "ny") return "NY";
  if (name === "solape") return "Solape Londres/NY";
  if (name === "asia") return "Asia";
  return "Fuera de sesión";
}
