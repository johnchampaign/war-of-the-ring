# A Fellowship-plan state machine for the FP AI — design & evaluation groundwork

Status: **stage 1 (RUN) tried and reverted, 2026-08-16** — see the result section. Design approved 2026-08-15. Nothing is currently built;
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
| *(baseline at d1795a1, 2026-08-16)* | *630*   | *810*         | *43.8%*   | median 15 turns |
| RUN state, ≤2 steps to entrance   | 752       | **397**       | 43.3%  | reverted (median 11) |
| RUN state, ≤2 steps & Corr ≤6     | 760       | **425**       | 44.0%  | reverted (median 11) |

One conclusion: everything that makes the Fellowship move MORE OFTEN collapses the
game into a Ring race, because the push score competes globally against every other
FP action. The single success removed an *obstacle* (a deadlock) without changing
healthy-game move frequency. The remaining failures players observe — no multi-turn
run at Mordor, Will die burned instead of crowning Aragorn, no Elven-Ring endgame
dash — are all *sequencing* failures. Hence: a plan.

## Stage 1 result: RUN, as designed, fails (2026-08-16)

Built exactly as below — pure function, distance-to-entrance trigger, four biases
(push 88, Elven Ring 70 for the missing Character die, Companion trade from
Corruption 6, entrance-declare beats rest-heal). Two 2000-game A/Bs against a fresh
baseline at HEAD (table above). The machine did what it was built to do — Mordor
entries 1225→1598, mean entry turn 11.2→9.0, stalled pre-Mordor turns 54%→44% —
and the game became a Ring race decided at median turn 11: military wins halved,
corruption deaths +45%, FP unchanged. A Corruption gate barely moved anything, so
the collapse is not "corrupted Fellowships dashing"; it is the *frequency* of RUN.

Why: the trigger window is not narrow. Minas Tirith is 3 regions from Minas Morgul,
Osgiliath 2, so "≤2 steps after banked Progress" is true for most of the FP's
mid-game staging turns. That reproduces the reverted per-action experiments almost
exactly — a fifth data point for the same lesson.

What this rules out / what remains (for the next stage's design, not tried):
- Any RUN trigger keyed on distance alone. A real dash also needs *tempo*: the
  Character dice in hand this turn (public), an Elven Ring available, Companions
  left to absorb, and the Hunt box low. A conjunction of those is genuinely rare.
- Decomposing the four biases (4 more soaks) would tell which one drives the
  collapse; the push-to-88 is the prime suspect given every prior result.
- Building HEAL / BANK first instead: they *reduce* move frequency (rest turns,
  banking without declaring), so they cannot fail this way, and RUN may only be
  safe once HEAL exists to bring Corruption down before the dash.

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
