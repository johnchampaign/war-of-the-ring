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
| card army moves traverse their route, capturing what they enter (`handlers/index.ts` moveAllUnits + `armies.ts` quietCardPath) | 609→608, 672→674 | 741→741, 750→751 | **shipped** 2026-09-11; a rules fix, not a strength change — the quiet default route captures nothing, so play is unchanged within noise (≤2 games of 2000 in all four families), gates zero |
| Corsairs of Umbar moves BEFORE the battle (`handlers/index.ts` sh-str-10 + `combat.ts` mustAdvance) | 606→606, 671→671 | 729→729, 769→768 | **shipped** 2026-09-13; a rules fix. Three of the four families came back byte-identical and the fourth differs by one game, which says the AI seldom plays this card into a contested coast — the correctness rests on `probe-corsairs-landing.mjs`, not on this soak |
| Event cards recruit to the maximum extent — no Done mid-recruit, no empty picks, Pits of Mordor places a lone Regular (`handlers/index.ts` noDone on recruit handlers) | 605→608, 665→669 | 725→727, 772→773 | **shipped** 2026-09-14; a rules fix (John: follow the rules, report 4f0y2f2r4k315b68). Baseline re-measured at c8ad617 because two siege commits landed since the last soak; every family within 4 games, gates zero |
| Dreadful Spells' casualty question survives the card's cleanup (`wotrAdapter.ts` eventTarget keeps a raised choice; `combat.ts` thenChoice) | 811→816, 824→819 | 882→889, 898→901 | **shipped** 2026-10-03 (7de53fe), measured 2026-10-08 against 2379096; a rules fix — the card silently dealt no damage whenever the Free Peoples had a casualty choice, and lost besieged Companions (report fdx2xl3oo40orw9h, replayed from the uploaded log). Every family within 7 games, gates zero. Shipped before measuring because players were losing figures; the run was interrupted by a power-off on 10-04 and resumed |
| Army-movement consolidation, stages 1–4: one set of move/attack rules, every advance "all or part", card multi-move arrivals, card-attack and assault rearguards, plus the Shadow AI splitting card moves that would overstack (`armies.ts` shared rules, `combat.ts` advanceRules, `handlers/index.ts`, `wotrAI.ts` cardMoveFit) | 832→821, 834→841 | 911→897, 890→891 | **shipped** 2026-10-09 (92d1c5d…9e166b6), measured against 3bc45c2; mostly rules fixes. Mixed signs, every family within 14 games (one standard error is about 22 per 2,000), so no measurable change in strength. The first exp run surfaced two offered-then-refused actions: an advance out of a siege lifting it before the rearguard rejoined, and an empty Nation entry barring a card route. Both were fixed in 9e166b6 and re-measured; all gates are zero |
| Nazgûl card moves go where they act — the Fellowship's region, else a region on its road to the nearest Mordor entrance within two steps, else the staged Army, else stop; and the Mordor Track counts as no region (`wotrAI.ts` chooseEventTarget, moveCharacterScore, chooseCharMove via `fellowshipRegion`) | 820→863, 841→872 | 890→946, 898→902 | **shipped** 2026-10-10, measured against db96a84; reports 2e1j445d0m3s5g4b, lkr5oqkt18zy6twe, 1s2m3o0a0s6k232v (Nazgûl fanned into every neighbouring region, most off the Fellowship's road, and around Morannon once the Fellowship was on the Track). Shadow up in all four families, three by about two standard errors or more; gates zero |
| Shadow battle casualties: an Army of five or fewer units reduces an Elite rather than removing a Regular (keeps its dice); siege attackers keep Regulars-first (`wotrAI.ts` combatCasualties) | 863→867, 872→857 | 946→964, 902→920 | **shipped** 2026-10-10, measured against 60e1e12; report 0r0z4m1t2b260556. Heuristic families within noise (+4, −15), the human-like yardstick +18 in both; gates zero |
| The Shadow holds the sieges it lays: a besieging Army that strikes out and wins stays (open ground) or advances only part, leaving the garrison's size plus one (onto an enemy Settlement); walking the field Army out of a siege is charged for lifting it (`wotrAI.ts` advanceChoice, armyMoveScore via `besiegedGarrison`) | 863→860, 872→892 | 946→945, 902→897 | **shipped** 2026-10-10, measured against 60e1e12; report q0vopcx9p3bcejso (in and out of an FP-held Orthanc, never assaulting). A behaviour fix rather than a strength change: every family within noise, gates zero. `probe-ai-siege-and-stacking.mjs` pins the advance |
| Shared-bonus Combat cards (Deadly Strife, Desperate Battle: "both Armies add N") are played only when the Shadow rolls more Combat dice than the Free Peoples (`wotrAI.ts` combatCard) | 863→895, 872→863 | 946→957, 902→922 | **shipped** 2026-10-10, measured against 60e1e12; report u5johl1hyn1y7jck (Deadly Strife played outnumbered). Shadow up in three of four families; gates zero |
| Shadow stops throwing units away to the stacking limit: Event recruits go where they fit, Musterings of Long-planned War / A New Power is Rising and Voice of Saruman are priced for the units a full stack would lose, a whole-Army move that would overstack sends only what fits, and joining a siege stack it would overflow no longer scores as a capture (`wotrAI.ts` chooseEventTarget, playEvent, sarumanMuster, maybeFitStack, armyMoveScore) | 863→855, 872→912, f3 860→884 | 946→895, 902→917, f3 927→961 | **shipped** 2026-10-10, measured against 60e1e12; report 3t5w710l563l4s4t. Shadow overstack removals in 150 self-play games: 50 → 2. The human-like f1 dip (−51) did not hold up: a third family (`--seed-offset 200000`) was run for both, and the three-family totals are +56 (heuristic) and −2 (human-like) per 6000 games — noise; gates zero |

