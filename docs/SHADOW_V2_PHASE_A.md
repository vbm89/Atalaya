# Shadow V2 — Phase A

Research-only replay over the frozen V1 history. This document is not a production specification.

## Invariants

- V1 remains the source of truth for live signals.
- No import from `engine.ts`, `signals.ts`, `structure.ts`, `risk.ts`, `outcome.ts` or `xau-spot.ts` is used by the Shadow replay.
- No Shadow module is imported by the watch tick.
- `MAPA → PENDING → ENTRADA` remains an observed V1 state machine. Shadow candidates are labels in the research layer and never become live signals.
- Candidate generation has no access to stored outcomes, first-touch labels, MFE/MAE, post-mortems or journal data.

## Historical inputs

The read-only loader consumes:

- `signal_episodes` for the frozen setup, opening slot and episode lifetime;
- `signal_events` for the observed V1 `ENTRY` transition;
- `episode_tape_bars` for 15M/1H/4H lookback and forward bars;
- `signal_outcomes` only as post-hoc agreement evidence, never as a candidate feature.

`episode_context` is intentionally not used to manufacture missing market events. Historical news/closed-market flags are consumed only from the immutable episode freeze where present.

## Hypotheses

- `BASELINE_V1`: first observed V1 transition to `entry`.
- `VOLUME_RELAXED`: preserve trigger geometry and non-relaxed gates, remove the 15M trigger-volume threshold.
- `TRIGGER_RELAXED`: preserve volume and non-relaxed gates, replace fail-accept/reject with a zone retest.
- `VOLUME_AND_TRIGGER_RELAXED`: remove both of those gates.

A relaxed candidate is emitted at the first qualifying 15M decision point for an observed V1 opportunity. The study therefore does **not** claim to discover maps that V1 never persisted.

## Outcome protocol

Outcomes are calculated after candidate generation, from forward 15M tape only:

- wick touch of SL/TP1/TP2;
- SL wins if SL and a TP are touched on the same candle;
- no future candle is used to create or classify a candidate;
- an episode with no touch and a recorded close is `expired`, not success or failure;
- a still-open episode without enough future tape is `pending` and is not a decided result.

## Walk-forward

The current phase uses fixed hypotheses, so there are no fitted thresholds. A chronological 70/30 TRAIN/TEST cut is reported. TRAIN is descriptive/calibration-only; TEST never feeds candidate generation or changes the rules.

## Evidence gates

The success rate denominator is `TP1 + TP2 + SL`. `EXPIRADA` remains separate. Wilson 95% intervals are reported. A small sample is not treated as evidence of improvement.

The final decision rule is deliberately conservative: additional candidates must improve opportunity count without materially reducing success, remain stable in TEST and across assets/periods, and pass the leakage/integrity checks. Otherwise V1 remains unchanged.

## Execution

Run with a configured research database:

```bash
npm run shadow:replay
```

The runner is read-only. It does not insert or update any database table.

Phase B (sweep/reclaim and FVG retest on the same frozen maps) is documented in [SHADOW_V2_PHASE_B.md](./SHADOW_V2_PHASE_B.md). It does not change these invariants.
