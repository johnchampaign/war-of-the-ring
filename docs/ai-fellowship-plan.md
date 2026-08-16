# A Fellowship-plan state machine for the FP AI — design & evaluation groundwork

Status: **groundwork** (approved direction, 2026-08-15). Nothing here is built yet;
this document exists so the build starts from measurements and a falsifiable plan,
not from intuition — intuition has a measured 0-for-4 record on this problem.

## Why per-action scoring cannot solve this

The FP AI weighs one action at a time. Four experiments (all 2000-game A/Bs, all
recorded beside the code in `src/ai/wotrAI.ts`) established that no per-action
number buys foresight:

| experiment                        | Ring wins | military wins | FP%    | verdict |
|-----------------------------------|-----------|---------------|--------|---------|
| baseline (before heal fix)        | 671       | ~999          | 48.3%  | —       |
| flatten push curve (78−4x, fl.38) | 814       | **30**        | 40.7%  | reverted |
| Hunt-box awareness (free move=92) | 1071      | **271**       | 56.1%  | reverted |
| per-turn quota (1 die/turn @82)   | 1087      | **66**        | 54.5%  | reverted |
| **heal-deadlock fix (shipped)**   | **761**   | **849**       | **50.0%** | kept |

One conclusion: everything that makes the Fellowship move MORE OFTEN collapses the
game into a Ring race, because the push score competes globally against every other
FP action. The single success removed an *obstacle* (a deadlock) without changing
healthy-game move frequency. The remaining failures players observe — no multi-turn
run at Mordor, Will die burned instead of crowning Aragorn, no Elven-Ring endgame
dash — are all *sequencing* failures. Hence: a plan.

## The proposed machine

A small, explicit, public-information state machine that biases (never overrides)
the existing scorer. Three states plus a null:

- **BANK** — travel hidden, accumulate Progress. Entered when Corruption is
  manageable and the gates are out of reach. While banking: normal push curve;
  never declare except at an entrance.
- **HEAL** — sit in an unconquered FP City/Stronghold and rest-declare each turn.
  Entered when Corruption ≥ threshold and a heal-spot is the current location (or
  reachable within banked Progress at acceptable Hunt exposure). Exit when
  Corruption ≤ exit-threshold (hysteresis: enter ≥5, exit ≤2, tune by A/B).
- **RUN** — the endgame dash. Entered when a Mordor entrance is within banked
  Progress + expected moves this turn, or the military clock forces it (Shadow
  close to 10 VP). While running: push score outranks army actions, spend Elven
  Rings for Character dice, accept Companion sacrifices on Hunt damage.

The machine reads only public state (Corruption, Progress, declared position, Hunt
box, VP) — same information a human FP player has. It emits a single bias applied
to a handful of action kinds; the scorer still decides everything else, so the
army game keeps functioning in BANK and HEAL (the failure mode of all three
reverted experiments).

State is a pure function of the game state — recomputed each decision, **not**
stored — so no schema change, no save migration, no hidden AI memory.

## What "groundwork" means concretely

1. **Baseline telemetry first** (this commit): the tournament reports, per run —
   - Mordor entry rate and mean turn of entry
   - heal-declares and push-declares per game; mean Progress at push-declare
   - stalled Fellowship-turns (pre-Mordor turns ending with Progress 0 and no declare)
   - peak Corruption per game
   Without these, a plan-machine A/B could only be judged on win rate, which is too
   coarse — the quota experiment *raised* FP% while ruining the game.
2. **Acceptance criteria, fixed in advance** (vs the then-current baseline, 2000 games):
   - Ring wins up ≥10% AND military wins (both sides) within ±15% AND FP within 48–52%
   - Mordor entry rate up; stalled turns down; median game length within ±2 turns
   - all soak gates zero, as always
   Any criterion missed ⇒ the machine is reverted and the numbers recorded, same as
   the four experiments above.
3. **Build order**: telemetry → RUN state only (smallest, most likely to pay) →
   HEAL hysteresis → BANK last. One state per A/B; never two changes in one soak.

## Non-goals

- No search/lookahead, no opponent modeling, no hidden state.
- The Shadow AI is untouched throughout.
- No rules-engine changes ride along with any plan-machine commit.
