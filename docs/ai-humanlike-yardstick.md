# The human-like Free Peoples yardstick

A scripted Free Peoples opponent (`src/ai/humanlikeFP.ts`, tournament controller
`--fp humanlike`) that plays the way the uploaded human games say humans play
against our Shadow AI. It is the **second gate** for Shadow-AI changes. John
approved it on 2026-09-10.

## Why

Three Shadow experiments in a row measured one way against the heuristic Free
Peoples and the other way against people:

| experiment | vs heuristic FP (self-play) | in the human logs |
|---|---|---|
| wake-price waiver (attack a resting Fellowship's neighbours) | lost the Ring game, reverted | the resting Fellowship is the most common human pattern |
| wide garrison term (muster into 1–2-unit Strongholds) | −60 / −96 of 2000, reverted | 44 of 107 human wins stormed a one-unit garrison |
| zero Hunt dice before Mordor | measured correct | humans reach Mordor at turn 7 with 3 Corruption |

The heuristic FP is a tuned racer: it never parks to heal, never storms a lone
garrison, never dawdles. Self-play therefore cannot see the behaviours humans
exploit, and a gate built only on it rejects exactly the fixes that matter.

## Calibration (121 human-FP games vs the AI Shadow, uploaded 2026-08-25..09-10)

| habit | measured | rule in the yardstick |
|---|---|---|
| rest-declare in a friendly City/Stronghold | median Corruption 2 at the declare | rest-declare in place at Corruption ≥ 2 |
| leave the rest | median Corruption 1 | the Fellowship does not move while resting until Corruption ≤ 1 |
| enter Mordor | median Corruption 2.5; 82% at ≤ 4 | never enter above 4 while a heal spot is reachable; else wait |
| attack a one-unit defender | 169 of ~340 human attacks | a 3+ stack adjacent to an enemy VP Settlement held by ≤ 1 unit storms it; a 3+ stack within two regions marches toward one |

Everything else defers to the heuristic FP (`chooseAction`), so the yardstick is
a pure function of the redacted view like every controller. It is a
**measurement tool**: it never ships as a difficulty and is not tuned to win.
Probe: `scripts/probe-humanlike-fp.mjs` (in `npm test`).

## What it is not

It is not a human. The 60-game smoke at 7cc8d26 gave Shadow 28/60 (47%) against
it, versus ~29% against the heuristic FP — the yardstick is *weaker overall*
(it enters Mordor at turn 9.7, not 7.9, and hands the Shadow 10-VP military wins)
and *stronger only on the three habits above*. Humans beat the AI 88% because
they are also better at cards, Hunt avoidance and combat, none of which this
scripts. So the yardstick's win rate is not a strength measure; its value is
differential: a Shadow change that punishes parking or defends lone garrisons
should show a gain HERE that self-play cannot show.

## Protocol (supersedes the single-gate rule for Shadow changes)

Measure every Shadow-AI change on both opponents, two seed families each:

1. `--fp heuristic` (self-play): **no regression** beyond noise (±22 games / 2000).
2. `--fp humanlike`: **no regression**, and for a change aimed at a human habit
   (Hunt pacing, garrisons, punishing a parked Fellowship) a **gain of ≥ 40 games /
   2000 in both families** — the same +2-point bar family noise allows here.
3. Hygiene gates zero on both; read the win-reason mix, not just the total.

Ship when both gates hold. Record the numbers in the commit message.

## Baseline (Shadow AI at 1cd3ea2, yardstick with the turn-30 cap, 2000 games per family)

| family | FP wins | Shadow wins | Ring destroyed | corrupted | Shadow 10-VP | FP 4-VP | Mordor entries (mean turn) |
|---|---|---|---|---|---|---|---|
| f1 (offset 0) | 1360 | 640 | 1310 | 515 | — | — | 1870 (8.6) |
| f2 (offset 100000) | 1311 | 689 | 1262 | 532 | — | — | 1853 (8.6) |

Hygiene gates zero in both. For comparison the same Shadow scores ~540-600 / 2000
against the heuristic FP — the yardstick is the weaker opponent overall (see
"What it is not"), so the gate is differential: a Shadow change must not lose
ground here and, when aimed at a human habit, must gain >= 40 in both families.

## Build log

- 2026-09-10 — module, controller, probe. 60-game smoke: FP 32 / Shadow 28,
  Mordor entries 47/60 at mean turn 9.7, heal-declares 76 (vs ~750/2000 in
  self-play, i.e. ~3× as many per game), gates zero.
- 2026-09-10 — first 2000-game baseline had ONE timed-out game: the "hold at the
  gate above Corruption 4" rule waited forever with no heal spot in reach and a
  Shadow that never hunts a stationary Fellowship. Now it holds only when it can
  fall back to a haven; otherwise it defers (enters). Re-run clean — the table above.
- 2026-09-10 — hunt-the-approach A/B, the first two-gate measurement: seed 926 of
  the human-like family ran to turn 1020. Replayed (`scripts/replay-seed.mjs`):
  the yardstick's rest/step habit oscillated forever against a Shadow that hunts
  the road (heal to 1, step out, take a hit, step back). No human game in the
  calibration set runs past 25 turns, so the habits now switch off after turn 30
  (`HABITS_UNTIL_TURN`) and the heuristic finishes the game; seed 926 ends at
  turn 34. Baseline re-measured with the cap: 640 / 689 (table above; within one
  game of the uncapped numbers).

## Experiments under the two gates

| change | vs heuristic FP (f1, f2) | vs yardstick (f1, f2) | verdict |
|---|---|---|---|
| hunt the approach — 2 Hunt dice while the Fellowship is hidden, on the road, within 6 of the Morannon (`wotrAI.ts` huntAllocation) | 543→606, 597→673 | 640→737, 689→731 | **shipped** 2026-09-10; corruption wins up in all four families |

