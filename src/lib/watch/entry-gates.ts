import type { SetupState } from "../trading/types";

/**
 * Structured snapshot of V1 ENTRY gates from outputs V1 already produced
 * (setup.state + setup.missingForEntry). Never recomputes volume/trigger/news.
 */
export interface EntryGates {
  armed: boolean | null;
  t2: boolean | null;
  volume15: boolean | null;
  volume4h: boolean | null;
  bias4h: boolean | null;
  news: boolean | null;
  late: boolean | null;
  underlyingClosed: boolean | null;
}

const SNIPPETS = {
  armed: "salida 15M de la zona a favor",
  t2: "cierre 15M de fallo de aceptación o rechazo",
  volume15: "volumen 15M insuficiente",
  volume4h: "volumen 4H muerto",
  bias4h: "sesgo 4H intacto",
  news: "noticia de alto impacto próxima",
  late: "señal tardía",
  underlyingClosed: "mercado del subyacente cerrado",
} as const;

function missingParts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/^Falta:\s*/i, "")
    .replace(/\.\s*$/, "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
}

function passed(parts: string[], snippet: string): boolean {
  return !parts.some((p) => p.includes(snippet));
}

const UNEVALUATED: EntryGates = {
  armed: false,
  t2: null,
  volume15: null,
  volume4h: null,
  bias4h: null,
  news: null,
  late: null,
  underlyingClosed: null,
};

const ALL_PASSED: EntryGates = {
  armed: true,
  t2: true,
  volume15: true,
  volume4h: true,
  bias4h: true,
  news: true,
  late: true,
  underlyingClosed: true,
};

/** MAP: only armed is known (false). PENDING: missing[] is the full V1 list. ENTRY: all passed. */
export function captureEntryGates(
  state: SetupState | null | undefined,
  missingForEntry: string | null | undefined,
): EntryGates | undefined {
  if (state === "map") return { ...UNEVALUATED, armed: false };
  if (state === "entry") return { ...ALL_PASSED };
  if (state !== "pending") return undefined;
  if (missingForEntry == null || missingForEntry.trim() === "") {
    return {
      armed: true,
      t2: null,
      volume15: null,
      volume4h: null,
      bias4h: null,
      news: null,
      late: null,
      underlyingClosed: null,
    };
  }
  const parts = missingParts(missingForEntry);
  return {
    armed: true,
    t2: passed(parts, SNIPPETS.t2),
    volume15: passed(parts, SNIPPETS.volume15),
    volume4h: passed(parts, SNIPPETS.volume4h),
    bias4h: passed(parts, SNIPPETS.bias4h),
    news: passed(parts, SNIPPETS.news),
    late: passed(parts, SNIPPETS.late),
    underlyingClosed: passed(parts, SNIPPETS.underlyingClosed),
  };
}
