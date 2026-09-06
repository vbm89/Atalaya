import type { AssetId, SetupState } from "../trading/types";
import { missingParts } from "./explain";
import type { LearningCase } from "./case";

/**
 * Presentation-only: why V1 did not give ENTRY.
 * Source of ENTRY = hadV1Entry (signal_events.to_state === 'entry').
 * Source of gates = freeze.missingForEntry captured at episode birth (V1 text).
 * Does not use outcome / SL / TP / EXPIRADA. Does not change P5 or V1.
 */

export const NON_ENTRY_NOTE =
  "Motivos según missingForEntry congelado al nacer el setup. No es look-ahead. SL/EXPIRADA no explican la no-entrada.";

export const GATE_HITS_NOTE =
  "Los conteos por gate son veces que el gate estaba faltando. Un setup con varios filtros cuenta en varios gates.";

export type NonEntryGateId =
  | "armed"
  | "t2"
  | "vol15"
  | "vol4h"
  | "bias4h"
  | "news"
  | "late"
  | "session";

export interface NonEntryGateDef {
  id: NonEntryGateId;
  label: string;
  snippet: string;
}

/** Exact V1 fragments from engine.ts missing[] / MAP missingForEntry. */
export const NON_ENTRY_GATES: readonly NonEntryGateDef[] = [
  { id: "armed", label: "Salida 15M de zona (MAP)", snippet: "salida 15M de la zona a favor" },
  { id: "t2", label: "T2 / trigger", snippet: "cierre 15M de fallo de aceptación o rechazo" },
  { id: "vol15", label: "Volumen 15M", snippet: "volumen 15M insuficiente" },
  { id: "vol4h", label: "Volumen 4H", snippet: "volumen 4H muerto" },
  { id: "bias4h", label: "Sesgo 4H", snippet: "sesgo 4H intacto" },
  { id: "news", label: "Noticias", snippet: "noticia de alto impacto próxima" },
  { id: "late", label: "Late", snippet: "señal tardía" },
  { id: "session", label: "Subyacente cerrado", snippet: "mercado del subyacente cerrado" },
];

export interface NonEntryRow {
  episodeId: string;
  assetId: AssetId;
  direction: "buy" | "sell";
  openedState: SetupState;
  missingForEntry: string | null;
  gates: NonEntryGateId[];
  unknownParts: string[];
  /** Freeze text missing or no known V1 fragment. */
  unknown: boolean;
}

export interface NonEntryReport {
  total: number;
  exclusiveSingle: number;
  exclusiveMultiple: number;
  unknown: number;
  gateHits: Record<NonEntryGateId, number>;
  rows: NonEntryRow[];
  notice: string;
  hitsNote: string;
}

function classifyGates(raw: string | null): { gates: NonEntryGateId[]; unknownParts: string[] } {
  const parts = missingParts(raw);
  const gates: NonEntryGateId[] = [];
  const unknownParts: string[] = [];
  for (const part of parts) {
    const hit = NON_ENTRY_GATES.find((g) => part.includes(g.snippet));
    if (hit) {
      if (!gates.includes(hit.id)) gates.push(hit.id);
    } else {
      unknownParts.push(part);
    }
  }
  return { gates, unknownParts };
}

export function classifyNonEntry(c: LearningCase): NonEntryRow | null {
  if (c.hadV1Entry === true) return null;
  const { gates, unknownParts } = classifyGates(c.missingForEntry);
  const unknown = gates.length === 0;
  return {
    episodeId: c.episodeId,
    assetId: c.assetId,
    direction: c.direction,
    openedState: c.openedState,
    missingForEntry: c.missingForEntry,
    gates,
    unknownParts,
    unknown,
  };
}

export function explainNonEntries(cases: readonly LearningCase[]): NonEntryReport {
  const rows: NonEntryRow[] = [];
  const gateHits = Object.fromEntries(NON_ENTRY_GATES.map((g) => [g.id, 0])) as Record<
    NonEntryGateId,
    number
  >;
  let exclusiveSingle = 0;
  let exclusiveMultiple = 0;
  let unknown = 0;

  for (const c of cases) {
    const row = classifyNonEntry(c);
    if (!row) continue;
    rows.push(row);
    if (row.unknown) unknown += 1;
    else if (row.gates.length === 1) exclusiveSingle += 1;
    else exclusiveMultiple += 1;
    for (const id of row.gates) gateHits[id] += 1;
  }

  return {
    total: rows.length,
    exclusiveSingle,
    exclusiveMultiple,
    unknown,
    gateHits,
    rows,
    notice: NON_ENTRY_NOTE,
    hitsNote: GATE_HITS_NOTE,
  };
}

export function exampleChecks(row: NonEntryRow): Array<{ id: NonEntryGateId; label: string; missing: boolean }> {
  return NON_ENTRY_GATES.map((g) => ({
    id: g.id,
    label: g.label,
    missing: row.gates.includes(g.id),
  }));
}
