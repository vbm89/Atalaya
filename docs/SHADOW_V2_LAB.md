# Shadow V2 — laboratorio (captura, historial, integridad, sesgo)

Research-only. Does not change V1. Complements [Phase A](./SHADOW_V2_PHASE_A.md) and [Phase B](./SHADOW_V2_PHASE_B.md).

## Captura causal

`episode_freeze.entryGates` is a **write-once photograph** of V1 outputs at episode birth (`setup.state` + `missingForEntry`).

- MAP: `armed=false`, other gates `null`.
- PENDING: `armed=true`; always-evaluated gates from V1 snippets; `volume4h` is `false` only if V1 listed `volumen 4H muerto`, otherwise `null`.
- ENTRY: always-evaluated gates passed; `volume4h` stays `null` unless V1 listed a 4H evaluation. Absence of the snippet is not evidence it passed.
- `underlyingClosed` in freeze comes from V1 `dataStatus === "session_closed"`, not from `market-session.ts`.
- PENDING→ENTRY does **not** rewrite `episode_freeze` (`ON CONFLICT` updates only `current_state` / `closed_at`; fold keeps `prev.freeze`).

`signal_outcomes.details.postEntry` is written only when `signal_events.to_state='entry'` exists. MAP/PENDING never get `postEntry`. Old rows without these fields stay loadable. No backfill.

Identity (`entryAtMs`, `entrySlot`, `entryPrice`) is write-once from the first ENTRY event. `firstTouch` and terminal `outcome` (`sl`/`tp1`/`tp2`/`expired`) never recede: a later tick that lost the touch bar from the feed window must keep the stored photograph. MFE/MAE may rise while `pending` and must not fall because the window shrank. `upsertOutcome` may replace `details` with `{rule}` while V1 outcome is still pending; the tick reads `postEntry` **before** that write and merges it back.

After each successful tick, missing freeze / 15M tape / context on **born** episodes is logged with `repair: false`. Nothing is auto-repaired.

## Historial

Two buckets, `hadV1Entry === true` only from `signal_events.to_state='entry'`:

- **Operaciones V1** — ENTRY / TP1 / TP2 / SL / EXPIRADA as trades.
- **Setups que no entraron** — MAPA / PENDIENTE. A wick that tagged SL/TP is `toque técnico`, never `Operación: SL`.

Each card shows `ENTRY V1: SÍ` or `NO`. Shadow EXTRA candidates are not listed here.

## Estado del laboratorio (Más)

Read-only SELECT on existing tables. Missing fields render **No disponible**. Does not generate signals, write Neon, or run Shadow replay. Last replay / extraTestN stay unavailable until a persisted replay exists (it does not).

## Guardas contra sesgo

1. Chronological TRAIN/TEST (70/30 by `openedAtMs`). TEST is not used to pick parameters.
2. Variants are frozen before evaluation. Changing a hypothesis after seeing TEST makes it a **new** hypothesis that needs a clean TEST. That promotion path is **not implemented**.
3. EXTRA and OVERLAP stay disjoint. `BASELINE_V1` uses real ENTRY events only.
4. Outcome is causal (`t >= decisionSlot`).
5. `extraTestN < 30` → `INSUFFICIENT`, even at 100% WR. Never “ganadora”.
6. No hyperopt, no iterative TEST search, no ML.
7. Labels: `INSUFFICIENT` / `DESCRIPTIVE` / `EXPLORATORY` / `CONFIRMATORY`.
   `CONFIRMATORY` is **never assigned** today (`confirmatoryAllowed: false`).
8. `variantsEvaluated` is the frozen variant count.

## Promoción futura (documentada, no implementada)

A future promotion to V1 would require at least:

- EXTRA TEST decidido ≥ 30
- comparison against V1
- WR difference acceptable
- expectancy not clearly worse
- TRAIN/TEST behaviour consistent
- evidence on more than one asset
- parameters predefined before TEST
- no TEST contamination
- human review

Until then: **SEGUIR ACUMULANDO**.
