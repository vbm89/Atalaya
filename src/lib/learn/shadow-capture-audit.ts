import type { EpisodeDraft, SignalEventDraft } from "../watch/episode";
import type { EpisodeFreeze } from "../watch/freeze";
import type { EntryGates } from "../watch/entry-gates";
import { v1EntryPrice } from "../watch/post-entry";

/**
 * freeze.volumeRatio15 = snapshot of AssetAnalysis at birth.
 * entryGates.volume15 = V1 gate from missingForEntry.
 * Never classify gates with freeze.volumeRatio15.
 */
export const VOLUME_SNAPSHOT_VS_GATE =
  "freeze.volumeRatio15 is the analysis snapshot. entryGates.volume15 is the V1 gate. They are not interchangeable.";

const VOLUME_4H_SNIPPET = "volumen 4H muerto";
const OUTCOMES = new Set(["tp1", "tp2", "sl", "expired", "pending", "none"]);
const MAP_NULL_GATES = [
  "t2",
  "volume15",
  "volume4h",
  "bias4h",
  "news",
  "late",
  "underlyingClosed",
] as const;

export interface ShadowCaptureAuditRow {
  episodeId: string;
  ok: boolean;
  issues: string[];
  skipped: string[];
}

export interface ShadowCaptureAuditReport {
  episodes: number;
  ok: number;
  invalid: number;
  notCheckable: number;
  issues: Array<{ episodeId: string; issue: string }>;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: unknown): value is number {
  return finiteNumber(value) && value > 0;
}

function hasEntryEvent(events: readonly SignalEventDraft[]): boolean {
  return events.some((ev) => ev.toState === "entry");
}

function missingHas4h(raw: string | null | undefined): boolean {
  return (raw ?? "").includes(VOLUME_4H_SNIPPET);
}

function gateIssues(freeze: EpisodeFreeze): { issues: string[]; skipped: string[] } {
  const gates = freeze.entryGates;
  if (gates == null) {
    return {
      issues: [],
      skipped: ["entryGates ausente — histórico no comprobable"],
    };
  }
  const issues: string[] = [];
  if (freeze.setupState === "map") {
    if (gates.armed !== false) issues.push("MAP debe capturar armed=false");
    for (const key of MAP_NULL_GATES) {
      if (gates[key] !== null) issues.push(`MAP no debe inventar ${key}`);
    }
  }
  if (freeze.setupState === "pending") {
    if (gates.armed !== true) issues.push("PENDING debe capturar armed=true");
    // Absence of the 4H snippet is not evidence the gate passed.
    if (gates.volume4h === true && !missingHas4h(freeze.missingForEntry)) {
      issues.push("PENDING volume4h=true sin evidencia de evaluación 4H");
    }
  }
  if (freeze.setupState === "entry") {
    if (gates.armed !== true) issues.push("ENTRY debe capturar armed=true");
    if (gates.t2 !== true) issues.push("ENTRY debe capturar t2=true");
    if (gates.volume15 !== true) issues.push("ENTRY debe capturar volume15=true");
    // V1 only lists 4H when vol4h was evaluable and dead. Absence ≠ passed.
    if (gates.volume4h === true && !missingHas4h(freeze.missingForEntry)) {
      issues.push("ENTRY volume4h=true sin evidencia de evaluación 4H");
    }
    if (gates.bias4h !== true) issues.push("ENTRY debe capturar bias4h=true");
    if (gates.news !== true) issues.push("ENTRY debe capturar news=true");
    if (gates.late !== true) issues.push("ENTRY debe capturar late=true");
    if (gates.underlyingClosed !== true) issues.push("ENTRY debe capturar underlyingClosed=true");
  }
  return { issues, skipped: [] };
}

function freezeIssues(freeze: EpisodeFreeze | null): { issues: string[]; skipped: string[] } {
  if (!freeze) return { issues: ["episode_freeze ausente"], skipped: [] };
  const issues: string[] = [];
  if (!finitePositive(freeze.capturedAtMs)) issues.push("capturedAtMs inválido");
  if (freeze.timeframe !== "15m") issues.push("timeframe distinto de 15m");
  if (freeze.volumeAvailable15 === true && freeze.volumeRatio15 != null && !finiteNumber(freeze.volumeRatio15)) {
    issues.push("volumeRatio15 no finito pese a estar disponible");
  }
  if (freeze.volumeAvailable4h === true && freeze.volumeRatio4h != null && !finiteNumber(freeze.volumeRatio4h)) {
    issues.push("volumeRatio4h no finito pese a estar disponible");
  }
  const gates = gateIssues(freeze);
  return { issues: [...issues, ...gates.issues], skipped: gates.skipped };
}

function eventIssues(episode: EpisodeDraft, events: readonly SignalEventDraft[]): string[] {
  const issues: string[] = [];
  for (const ev of events) {
    if (ev.episodeId !== episode.episodeId) issues.push("evento con episodeId incorrecto");
    if (!finitePositive(ev.atMs)) issues.push("evento con atMs inválido");
    if (!finiteNumber(ev.slot) || ev.slot <= 0) issues.push("evento con slot inválido");
    if (ev.slot < episode.openedSlot) issues.push("evento anterior al openedSlot");
  }
  const entries = events.filter((ev) => ev.toState === "entry");
  if (entries.length > 1) issues.push("más de un evento ENTRY");
  for (const ev of entries) {
    if (ev.slot < episode.openedSlot) issues.push("ENTRY anterior al openedSlot");
    if (ev.atMs < episode.openedAtMs) issues.push("ENTRY anterior a openedAtMs");
  }
  const claimsEntry =
    episode.currentState === "entry" ||
    episode.openedState === "entry" ||
    episode.freeze?.setupState === "entry";
  if (claimsEntry && entries.length === 0) {
    issues.push("ENTRY sin evento to_state=entry");
  }
  return issues;
}

function postEntryIssues(
  episode: EpisodeDraft,
  events: readonly SignalEventDraft[],
  postEntry: Record<string, unknown>,
): string[] {
  const issues: string[] = [];
  if (!hasEntryEvent(events)) issues.push("postEntry sin evento ENTRY");

  const entryAtMs = postEntry.entryAtMs;
  const entrySlot = postEntry.entrySlot;
  const entryPrice = postEntry.entryPrice;
  if (!finitePositive(entryAtMs)) issues.push("postEntry.entryAtMs inválido");
  if (!finiteNumber(entrySlot) || entrySlot <= 0) issues.push("postEntry.entrySlot inválido");
  if (finiteNumber(entrySlot) && entrySlot < episode.openedSlot) {
    issues.push("postEntry.entrySlot anterior al openedSlot");
  }
  if (finiteNumber(entryAtMs) && entryAtMs < episode.openedAtMs) {
    issues.push("postEntry.entryAtMs anterior a openedAtMs");
  }
  if (!finiteNumber(entryPrice)) issues.push("postEntry.entryPrice inválido");
  if (finiteNumber(entryPrice)) {
    const expected = v1EntryPrice(episode.direction, episode.zoneLow, episode.zoneHigh);
    if (entryPrice !== expected) issues.push("postEntry.entryPrice incoherente con zona/dirección");
  }
  if (postEntry.firstTouchAtSec != null) {
    if (!finiteNumber(postEntry.firstTouchAtSec)) issues.push("postEntry.firstTouchAtSec inválido");
    else if (finiteNumber(entrySlot) && postEntry.firstTouchAtSec < entrySlot) {
      issues.push("postEntry.firstTouchAtSec anterior al entrySlot");
    }
  }
  if (postEntry.mfe != null && !finiteNumber(postEntry.mfe)) issues.push("postEntry.mfe inválido");
  if (postEntry.mae != null && !finiteNumber(postEntry.mae)) issues.push("postEntry.mae inválido");
  if (!OUTCOMES.has(String(postEntry.outcome))) issues.push("postEntry.outcome desconocido");
  return issues;
}

/** Snapshot-only: freeze + events + postEntry already captured. No future candles. */
export function auditShadowCapture(
  episode: EpisodeDraft,
  events: readonly SignalEventDraft[] = [],
  postEntry: Record<string, unknown> | null = null,
): ShadowCaptureAuditRow {
  const freeze = freezeIssues(episode.freeze);
  const issues = [...freeze.issues, ...eventIssues(episode, events)];
  if (postEntry != null) issues.push(...postEntryIssues(episode, events, postEntry));
  return {
    episodeId: episode.episodeId,
    ok: issues.length === 0,
    issues,
    skipped: freeze.skipped,
  };
}

export function auditShadowCaptureBatch(
  rows: Array<{ episode: EpisodeDraft; events?: SignalEventDraft[]; postEntry?: Record<string, unknown> | null }>,
): ShadowCaptureAuditReport {
  const issues: Array<{ episodeId: string; issue: string }> = [];
  let ok = 0;
  let notCheckable = 0;
  for (const row of rows) {
    const result = auditShadowCapture(row.episode, row.events ?? [], row.postEntry ?? null);
    if (result.skipped.length > 0 && result.issues.length === 0) notCheckable += 1;
    if (result.ok) ok += 1;
    else for (const issue of result.issues) issues.push({ episodeId: result.episodeId, issue });
  }
  return { episodes: rows.length, ok, invalid: rows.length - ok, notCheckable, issues };
}

/**
 * Persistence write-once: ON CONFLICT must not rewrite episode_freeze.
 * The auditor does not execute SQL; it only inspects the upsert text.
 */
export function freezeWriteOnceSqlIntact(sql: string): boolean {
  const idx = sql.toLowerCase().indexOf("on conflict (episode_id) do update set");
  if (idx < 0) return false;
  return !/episode_freeze/i.test(sql.slice(idx));
}

export type { EntryGates };
