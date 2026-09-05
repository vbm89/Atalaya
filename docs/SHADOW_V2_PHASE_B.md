# Shadow V2 — Phase B

Research-only. Does not change V1. Complements [Phase A](./SHADOW_V2_PHASE_A.md).

Phase A asked whether relaxing V1 volume/trigger gates on persisted maps adds entries. Phase B asks whether two **different triggers** on the same frozen V1 maps add EXTRA opportunities without using V1 ENTRY as a label.

## Invariants (unchanged)

- V1 remains the live source of truth.
- Shadow does not import `engine.ts`, `signals.ts`, `structure.ts`, `risk.ts`, `outcome.ts` or `xau-spot.ts`.
- Watch tick does not import Shadow.
- `BASELINE_V1` is the first `signal_events.to_state = 'entry'`. MAP/PENDING outcomes are not trades.
- Candidate generation is outcome-blind. SL/TP/MFE/MAE are computed after the decision close.
- Neon access is SELECT + `BEGIN READ ONLY` / `ROLLBACK`.

## Universes

- **V1 TRADE CASES**: episodes with a real ENTRY event.
- **SETUP CASES**: every persisted map (MAP + PENDING + ENTRY).
- **EXTRA**: Phase B candidate on an episode with no V1 ENTRY.
- **OVERLAP**: Phase B candidate on an episode V1 did enter. Never counted as extra.

## ZONE_SWEEP_RECLAIM

Same 15M candle, after the V1 opened slot:

1. Wick overlaps the frozen V1 zone.
2. Wick extends **beyond** the directional outer edge by `depth × zoneWidth`.
   - BUY: `low < zoneLow - depth`.
   - SELL: `high > zoneHigh + depth`.
3. Close is back inside `[zoneLow, zoneHigh]`.
4. Direction is the frozen V1 setup direction.
5. Decision = close of that candle. Later candles are not used to create it.

Depth variants, frozen before TEST:

| variant | depth |
|---|---|
| `ZONE_SWEEP_RECLAIM_MIN` | 0 (any strict pierce) |
| `ZONE_SWEEP_RECLAIM_MID` | 0.25 × zone width |
| `ZONE_SWEEP_RECLAIM_WIDE` | 0.50 × zone width |

Kept from V1, evaluated at decision close: news (`highImpact`), session (`underlyingClosed` / `dataStatus`), late, 4H bias from **closed** 4H bars, 15M volume ≥ 1 vs prior 20, invalidation (wick already took it → no candidate). Volume/trigger gates of Phase A are **not** relaxed here.

Does **not** require V1 arming. That is the extra-on-MAP question.

## FVG_RETEST

1. **Detect** a 3-candle 15M FVG using only closed bars. Candle 3 must close at or after the V1 opened slot. The FVG range must overlap the frozen V1 zone and match V1 direction.
   - BUY full: `A.high < C.low`. Partial: body of C clears `A.high` but the wick overlaps it.
   - SELL full: `A.low > C.high`. Partial: body of C clears `A.low` but the wick overlaps it.
2. **Retest** is a later 15M candle. The formation candle cannot be the retest. A full fill of the gap before the retest kills that FVG.
3. **Decision** = close of the retest candle.
4. **Outcome** uses 15M bars with `t >= decisionSlot` (the retest bar itself is excluded).

Variants, frozen before TEST:

| variant | formation | retest |
|---|---|---|
| `FVG_RETEST_FULL` | full 3-candle gap | wick touches the gap |
| `FVG_RETEST_PARTIAL` | partial (body gap, wick overlap) | wick touches the gap |
| `FVG_RETEST_STRICT` | full 3-candle gap | close inside the gap |

Same context gates as sweep/reclaim. Same invalidation rule.

## Outcome

Identical to Phase A: wick-first-touch after the decision close, SL wins same bar, TP1 before TP2, expired if the episode closed without a touch, pending if still open. Expectancy uses frozen V1 entry/SL/TP (`SL = -1R`). MFE/MAE are measured on the same subsequent bars, not on the decision bar.

Stored `signal_outcomes` of MAP/PENDING are never the Shadow outcome.

## TRAIN / TEST / evidence

Chronological 70/30 on episode `openedAtMs`. TRAIN does not pick thresholds. `extraTestN >= 30` remains the sufficiency floor. Below that the recommendation is `INSUFFICIENT`, including a 100% WR on a handful of extras.
