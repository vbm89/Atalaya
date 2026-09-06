export type EvidenceStatus = "INSUFFICIENT" | "DESCRIPTIVE" | "EXPLORATORY" | "CONFIRMATORY";

export interface EvidenceInput {
  cases: number;
  extraTestN?: number | null;
  hasTrainTestSplit?: boolean;
  predefined?: boolean;
  contaminationFree?: boolean;
}

export interface EvidenceDecision {
  status: EvidenceStatus;
  reason: string;
}

/** Conservative gate: this module classifies evidence only; it never promotes a rule. */
export function classifyShadowEvidence(input: EvidenceInput): EvidenceDecision {
  if (!Number.isFinite(input.cases) || input.cases < 1) {
    return { status: "INSUFFICIENT", reason: "No hay casos evaluables." };
  }
  if ((input.extraTestN ?? 0) < 30) {
    return { status: "INSUFFICIENT", reason: "extraTestN < 30: todavía no hay muestra TEST mínima." };
  }
  if (!input.hasTrainTestSplit || !input.predefined || !input.contaminationFree) {
    return { status: "EXPLORATORY", reason: "Hay muestra suficiente, pero falta completar las garantías de TRAIN/TEST y/o predefinición." };
  }
  return { status: "CONFIRMATORY", reason: "La muestra y las garantías metodológicas mínimas están presentes; requiere revisión humana antes de cualquier promoción." };
}
