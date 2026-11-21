# Sampled look-ahead search — plan and build log

Status: **prototype, measured: gains vs modelled opponents only** (direction chosen by John 2026-11-20). Code:
`src/ai/search.ts`, `src/ai/valueModel.ts` + `valueWeights.json`,
`scripts/fit-value.mjs`, `scripts/probe-search.mjs`. The shipped in-game AI is
unchanged until an A/B shows a win on both seed families.

## Why

The WotR Bot Protocol tournament `bt-134a8c982a09a4e7` (400 games, 40 per pair,
turn cap 20) ranked our heuristic AI fourth of five: 0/40 against "Normal"
(Rust) and 3/40 against AlphaWOTR, even with Hambot, ahead of Greedy only. The
logs show why: we spent **29 ms** per decision; both leaders spent **~1.1 s**
of the 2 s allowance searching. The heuristic is at its tuning ceiling
(`ai-1ply-evaluator.md`), and its 1-ply successor failed its bar (+2 vs +10)
because its hand-set evaluator mostly re-derived the heuristic.

Incorporating the other bots is not open to us: CWOTR has no licence, and the
others are not published. So we build our own search, with two changes from the
1-ply attempt:

1. **Look further.** Play each candidate out to the start of the next turn with
   the heuristic on both sides, rather than stopping after the immediate cascade.
2. **Learn the leaf value.** Fit P(Shadow wins) to self-play outcomes instead of
   hand-setting the weights.

## What it is

For an action-resolution decision (spending a die, playing a card, passing), the
heuristic's top `cands` actions (`topCandidates` in `wotrAI.ts`, with the same
refinements `chooseAction` applies) are each played on `samples` determinized
copies of the position. All candidates share the same copies (common random
numbers), which is what lets a few dozen samples separate them. A playout runs the
heuristic for both sides to the start of turn `turn + horizon` or the game's end,
and is scored by the value model. The heuristic's pick stands unless a challenger's
mean beats it by `margin`.

Pending choices, the Hunt allocation and the Fellowship phase stay with the
heuristic for now.

### Hidden information (no peeking)

This follows the same rule as the 1-ply evaluator. Each copy starts from the
actor's **redacted view** (`materializeView`). Every hidden thing is then re-dealt:

- the opponent's hand, draw piles and face-down discards, drawn from the cards of
  their decks that are not public;
- the actor's own draw order, reshuffled;
- the dice, from a fresh seed;
- the Shadow's opening plan roll, re-rolled when the Free Peoples search.

`probe-search.mjs` holds this in place. Swapping the opponent's real hand and draw
piles and changing the live RNG must leave the candidates' mean scores
*bit-identical*.

### The value model

A logistic regression over 39 public features: the evaluator's breakdown terms,
plus VP, corruption, Mordor progress, distance to Mordor, companions, the
Hunt-pool make-up, hand sizes, nations at war, and threatened Settlements. It is
trained on turn-start snapshots, because those are the only positions it is asked
about.

Fit `2026-11-20`: 6000 self-play games (half against the human-like FP), 74,981
positions, every 5th game held out.

| held-out log-loss | base rate | `evaluate()` | model |
|---|---|---|---|
| all turns | 0.692 | 0.681 | **0.646** (acc 0.611) |
| turns 1–3 | 0.694 | 0.698 | 0.688 |
| turns 7–9 | 0.693 | 0.674 | 0.621 |
| turns 10+ | 0.689 | 0.667 | 0.616 |

The early game is mostly dice and hidden cards, so early values are close to the
base rate. Refit (`npx vite-node scripts/fit-value.mjs`) after any change to the
heuristic or the engine that moves play noticeably. The model throws if the
feature list and the weights disagree.

## Cost

Measured on the dev machine:

| step | time |
|---|---|
| heuristic decision | ~0.4 ms (legal + choose + apply) |
| in-place playout to the next turn | ~10–40 ms |
| searched decision at 4 × 24 | **~0.4 s** |

At 4 × 24 there are about 57 searched decisions per Shadow game, so an A/B game
takes ~21 s against the heuristic's 0.1 s. The tournament allows 2 s per
decision on one core. Use `budgetMs`: it stops sampling once the budget is spent,
after a minimum of 4 samples.

## Measurement

The baseline is the heuristic. Shared seeds, `scripts/tournament.mjs --per-game`,
and a paired sign test over seeds whose winner changed
(`~/wotr-1101/srch/paired.py`). As always, every gate counter must be 0.

## Build log

- **2026-11-20, A/B 1 (Shadow searches, f1, 200 seeds, 4 × 24, margin 0.03,
  horizon 1):** Shadow wins **86 → 102** (+8 points). Gates all 0. The search
  overruled the heuristic on 19% of searched decisions (2,331 of 11,982). The
  run had no per-game output, so it was unpaired (≈1.6 SE). A/B 2 adds the
  paired f2 run and the Free Peoples side.
- **2026-11-20, A/B 2 (paired, same settings):**

  | who searches | seeds | heuristic | search | flips won / lost | sign-test z |
  |---|---|---|---|---|---|
  | Shadow | f2 (100001–100200) | 76 | **102** | +57 / −31 | 2.77 |
  | Free Peoples | f1 (1–200) | 114 | **144** | +56 / −26 | 3.31 |

  Gates all 0 in both runs. The Free Peoples search overrules the heuristic more
  often than the Shadow does: 32% of 15,556 searched decisions against 19% of
  11,661. It also has more searched decisions, about 78 per game against 58, so
  its games take ~36 s against ~22 s. For FP A/Bs, use 25-game chunks to stay
  well inside the 30-minute lock cap. Together with A/B 1, all three runs gain
  8–15 points, so search beats the heuristic on both sides. The heuristic
  baseline was checked seed-for-seed against untouched `main`, which confirms
  the `topCandidates`/`refinePick` refactor changes nothing.

- **2026-11-20, A/B 3 (Shadow searches vs the human-like FP, f1, paired):**
  116 → 117, with flips +37 / −36 (z 0.12). **No gain.** The playouts model the
  opponent as our own heuristic, so against the heuristic the search's
  predictions are exact. Against anyone else they are wrong. Every tournament
  bot is "anyone else", so the A/B 2 gains may be largely self-exploitation.
  A/B 4 tests a mixed opponent model: on half the samples the FP plays the
  human-like policy in the playouts (`--search-mix 0.5`). The 1-ply evaluator
  FP (`--fp eval`) cannot serve as an independent test opponent: 4 games took 35
  minutes, and it never entered Mordor.

- **2026-11-21, A/B 4 (mixed opponent model, `--search-mix 0.5`, paired):**

  | vs | heuristic Shadow | pure search | mixed search | mixed vs heuristic |
  |---|---|---|---|---|
  | human-like FP (f1) | 116 | 117 | **140** | +51 / −27, z 2.72 |
  | heuristic FP (f2) | 76 | 102 | **97** | +52 / −31, z 2.31 |

  Modelling the opponent drives the gain: once the human-like policy is in the
  mix, the search beats it by +12 points, and it keeps most of its gain against
  the heuristic (102 vs 97, z −0.63, noise). The human-like policy is now *in*
  the model, though, so this is not yet a test against an unseen opponent.
  A/B 5 asks that question. The playout opponent is the heuristic with noise
  (half its decisions are uniform over its top 3; `--search-noise 0.5`), the
  human-like policy is left out, and the test opponent is the human-like FP.

- **2026-11-21, A/B 5 (noisy opponent model, `--search-noise 0.5`, paired):**
  vs the human-like FP, which is now *unseen*: 116 → **129** (+47 / −34, z 1.44,
  not significant). vs the heuristic: 76 → 82, well below the pure search's 102
  (z −2.26). Against an opponent the search does not model, the gain is small
  (~+6 points, unproven). A varied model is not a substitute for the right one.

  **What A/Bs 1–5 say together.** The search gains a lot (+10 to +15 points)
  against whichever policy the playouts use for the opponent, and little
  against anything else. The playouts are only as good as the heuristic.
  Against bots that play very differently, such as the tournament's Normal and
  AlphaWOTR, expect a few points, not the 0/40 → competitive swing we want.
  Closing that gap needs a stronger in-playout policy or opponent model: a
  learned policy from self-play, or a benchmark opponent that plays unlike us.
  The best setting for unknown opponents today is the mixed model
  (`--search-mix 0.5`), because it covers two different policies.

## Next

1. ~~Confirm on f2 (paired), then the FP side.~~ Done: a win on both.
2. Tune margin, samples and horizon. The 2 s budget leaves ~4× headroom on this
   machine.
3. Search the Fellowship-phase and Hunt decisions. The tournament losses are
   Ring-race losses as often as military ones.
4. Ship it as an opt-in "Strong" opponent (Linode worker / local), then decide
   whether it becomes the default.
