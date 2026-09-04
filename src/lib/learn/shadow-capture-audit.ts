import type { EpisodeDraft, SignalEventDraft } from "../watch/episode";
import type { EpisodeFreeze } from "../watch/freeze";
import type { EntryGates } from "../watch/entry-gates";

export interface ShadowCaptureAuditRow {
  episodeId: string;
  ok: boolean;
  issues: string[];
}

export interface ShadowCaptureAuditReport {
  episodes: number;
  ok: number;
  invalid: number;
  issues: Array<{ episodeId: string; issue: string }>;
}

function finitePositive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function gateIssues(freeze: EpisodeFreeze): string[] {
  const gates = freeze.entryGates;
  if (gates == null) return ["entryGates ausente"];
  const issues: string[] = [];
  if (freeze.setupState === "map" && gates.armed !== false) {
    issues.push("MAP debe capturar armed=false");
  }
  if (freeze.setupState === "pending" && gates.armed !== true) {
    issues.push("PENDING debe capturar armed=true");
  }
  if (freeze.setupState === "entry") {
    if (gates.armed !== true) issues.push("ENTRY debe capturar armed=true");
    if (gates.t2 !== true) issues.push("ENTRY debe capturar t2=true");
    if (gates.volume15 !== true) issues.push("ENTRY debe capturar volume15=true");
    if (gates.volume4h !== true) issues.push("ENTRY debe capturar volume4h=true como gate no bloqueante");
    if (gates.bias4h !== true) issues.push("ENTRY debe capturar bias4h=true");
    if (gates.news !== true) issues.push("ENTRY debe capturar news=true");
    if (gates.late !== true) issues.push("ENTRY debe capturar late=true");
    if (gates.underlyingClosed !== true) issues.push("ENTRY debe capturar underlyingClosed=true");
  }
  return issues;
}

function freezeIssues(freeze: EpisodeFreeze | null): string[] {
  if (!freeze) return ["episode_freeze ausente"];
  const issues: string[] = [];
  if (!finitePositive(freeze.capturedAtMs)) issues.push("capturedAtMs inválido");
  if (freeze.timeframe !== "15m") issues.push("timeframe distinto de 15m");
  if (freeze.volumeAvailable15 === true && freeze.volumeRatio15 != null && !Number.isFinite(freeze.volumeRatio15)) {
    issues.push("volumeRatio15 no finito pese a estar disponible");
  }
  if (freeze.volumeAvailable4h === true && freeze.volumeRatio4h != null && !Number.isFinite(freeze.volumeRatio4h)) {
    issues.push("volumeRatio4h no finito pese a estar disponible");
  }
  issues.push(...gateIssues(freeze));
  return issues;
}

function eventIssues(episode: EpisodeDraft, events: readonly SignalEventDraft[]): string[] {
  const issues: string[] = [];
  for (const ev of events) {
    if (ev.episodeId !== episode.episodeId) issues.push("evento con episodeId incorrecto");
    if (!finitePositive(ev.atMs)) issues.push("evento con atMs inválido");
    if (!Number.isFinite(ev.slot) || ev.slot <= 0) issues.push("evento con slot inválido");
    if (ev.slot < episode.openedSlot) issues.push("evento anterior al openedSlot");
  }
  const entries = events.filter((ev) => ev.toState === "entry");
  if (entries.length > 1) issues.push("más de un evento ENTRY");
  for (const ev of entries) {
    if (ev.slot < episode.openedSlot) issues.push("ENTRY anterior al openedSlot");
    if (ev.atMs < episode.openedAtMs) issues.push("ENTRY anterior a openedAtMs");
  }
  return issues;
}

export function auditShadowCapture(
  episode: EpisodeDraft,
  events: readonly SignalEventDraft[] = [],
  postEntry: Record<string, unknown> | null = null,
): ShadowCaptureAuditRow {
  const issues = [
    ...freezeIssues(episode.freeze),
    ...eventIssues(episode, events),
  ];

  if (postEntry != null) {
    const entryAtMs = postEntry.entryAtMs;
    const entrySlot = postEntry.entrySlot;
    const entryPrice = postEntry.entryPrice;
    if (!finitePositive(entryAtMs)) issues.push("postEntry.entryAtMs inválido");
    if (!Number.isFinite(entrySlot) || entrySlot <= 0) issues.push("postEntry.entrySlot inválido");
    if (entrySlot < episode.openedSlot) issues.push("postEntry.entrySlot anterior al openedSlot");
    if (entryAtMs < episode.openedAtMs) issues.push("postEntry.entryAtMs anterior a openedAtMs");
    if (!Number.isFinite(entryPrice)) issues.push("postEntry.entryPrice inválido");
    if (!["tp1", "tp2", "sl", "expired", "pending", "none"].includes(String(postEntry.outcome))) {
      issues.push("postEntry.outcome desconocido");
    }
  }

  return { episodeId: episode.episodeId, ok: issues.length === 0, issues };
}

export function auditShadowCaptureBatch(
  rows: Array<{ episode: EpisodeDraft; events?: SignalEventDraft[]; postEntry?: Record<string, unknown> | null }>,
): ShadowCaptureAuditReport {
  const issues: Array<{ episodeId: string; issue: string }> = [];
  let ok = 0;
  for (const row of rows) {
    const result = auditShadowCapture(row.episode, row.events ?? [], row.postEntry ?? null);
    if (result.ok) ok += 1;
    else for (const issue of result.issues) issues.push({ episodeId: result.episodeId, issue });
  }
  return { episodes: rows.length, ok, invalid: rows.length - ok, issues };
}

/** Kept exported for focused tests without exposing capture internals. */
export type { EntryGates };
