# The 1-ply evaluator — spec and evaluation groundwork

Status: **spec** (direction approved 2026-08-30; side-ownership per the 3+2
coordination decision — this is Shadow-lane work, but the evaluator itself is
side-agnostic). Nothing here is built yet. Companion doc to
`ai-fellowship-plan.md`, which carries the campaign-plan layer this composes with.

## Why (the evidence, briefly)

The heuristic AI weighs one action at a time with hand-tuned weights, and the
record says that architecture is at its ceiling:

- Per-action weight tuning is **0-for-4** (recorded beside `moveFellowship`).
- What works is structural: HEAL (+14.6% Ring), the campaign plans, and a long
  tail of blunder guards — garrison splits, advance-garrisons, staging — each of
  which is a hand-written special case for a consequence the scorer cannot see.
- The uploaded-game corpus (530 games): humans beat both sides ~88%. The
  exploit-class holes are now mostly closed; what remains is play quality.
- Every blunder-guard shipped this month (garrison, advance, staging, Nazgûl
  stacking) would have been found *automatically* by a chooser that could see
  one action ahead: all four are cases where the resulting position is obviously
  worse than an alternative's.

The evaluator replaces "score the action" with "**simulate the action, score the
position it produces**" — one ply, no opponent modelling.

## What it is

For each legal action: apply it to a **determinized copy** of the state,
auto-resolve the immediate cascade (a battle's rounds, a Hunt's damage chain)
using the existing heuristic choosers as the in-simulation policy for BOTH
sides' forced decisions, then score the resulting state with a single
hand-written `evaluate(state, side): number`. Pick the argmax. Chance nodes
(dice, tiles) are sampled K times per candidate and averaged.

Measured cost (2026-09-02, dev machine, mid-game turn 6): `tryApplyAction`
(clone + apply) = **0.41 ms**. A 60-option decision at K=3 ≈ **73 ms**; a
300-option worst case ≈ 370 ms. Budgets: local/browser play < 1 s per decision
(fine, browsers ~2-3× slower); the Linode worker (online seats) has seconds;
tournament soaks slow ~50-100× vs the heuristic — an evaluator A/B is ~500
games/family overnight, not 2000 in 7 minutes. Plan A/Bs accordingly.

## Hidden information — the load-bearing design

The engine's `applyAction` needs full state; the AI must not peek (same
contract as the heuristic: public info only). Simulating on the TRUE state
would leak three ways: the real RNG (foreseeing actual dice), the deck order
(foreseeing draws), and the Hunt bag / opponent hand.

Rule: **the simulation state is built from the AI's own redacted view**
(`viewFor` — hidden things are absent by construction), with the holes filled
by plausible stand-ins:

- `rngState` → seeded from the AI's tie-break Rng (`rng.next()`), fresh per
  sample. Different samples = different dice. NEVER the live `rngState`.
- own draw decks → the AI knows which cards it has SEEN (public discards, its
  hand); the unseen remainder is shuffled placeholders. For 1-ply, a drawn
  placeholder card scores as "a card in hand" (the eval values hand size, not
  identity).
- opponent hand → placeholders; irrelevant at 1-ply except combat-card
  *presence*, which the in-sim heuristic policy already treats abstractly.
- Hunt bag → rebuilt from the public tile ledger (drawn tiles are public;
  `specialsInPlay/…Pool` are public), shuffled with the sample's rng.

The redaction leak-gate already asserts the view hides these, so building from
the view makes not-cheating a structural property rather than a discipline.
A `probe-evaluator-no-peek` must assert the chooser's decision is unchanged
when the true hidden state is scrambled behind an identical view.

## The evaluation function

One function, public state only, both sides (score symmetric: `eval(s, fp) =
-eval(s, shadow)` is NOT required — each side scores its own win progress).
First version reuses the measured heuristics as *state* features rather than
action scores:

- Victory: ±∞-ish terms for won/lost; VP captured vs threshold (FP 4 / SH 10),
  with the wakePrice ledger as a discount on prospective (not held) VP.
- Fellowship: corruption, progress, distance-to-entrance, Mordor step, Hunt box,
  companions remaining (the HEAL/plan machine's inputs, reused verbatim).
- Military: per-army distance-to-campaign-objective (plan-aware via
  `planTargetFor`), garrisoned-VP-settlements count (the walk-in class),
  Leadership coverage of staging armies, units in reinforcements vs on board.
- Tempo: action dice remaining, cards in hand, nations' political steps.

Weights start from the current action-scorer's relative magnitudes and are
tuned ONLY through the A/B protocol — the 0-for-4 record is about tuning
*action* weights blind; state-eval weights get the same discipline, not a pass.

## Measurement protocol (fixed in advance)

Head-to-head, not self-play: the tournament harness already takes
`--fp/--shadow` controllers; add `eval` as a controller key.

Acceptance for v1 (each vs the same-seed heuristic mirror, two seed families,
gates zero as always; baseline hash recorded per the coordination rule):

1. `eval` Shadow vs heuristic FP: Shadow win rate ≥ heuristic-Shadow baseline
   **+10 points**.
2. `eval` FP vs heuristic Shadow: FP win rate ≥ baseline **+5 points** (the FP
   side is already the stronger heuristic; smaller bar).
3. eval-vs-eval: median game length within ±3 turns of baseline; no gate
   failures; no decision > 2 s in the soak's timing telemetry.
4. Any criterion missed → revert-and-record, per house rule.

Vs-human is the real target (per 3+2): ship behind a difficulty flag, watch the
uploaded-gamelog win rates. No flag flip to default until the corpus shows it.

## Where it runs

- **Local play**: in the browser as difficulty "Strong" beside "Standard"
  (budget above holds). The heuristic remains the default.
- **Online seats**: the Linode ai-worker (see `deploy/linode/README.md`) — the
  SWR pattern; Cloudflare's inline AI stays heuristic as the fallback. Worker
  build is its own workstream after v1 measures well locally.
- **Never**: Cloudflare request path (CPU limits), which is why the worker
  exists.

## Build order (one A/B-able stage each)

1. `evaluate(state, side)` + a harness flag to print eval traces for a replayed
   game (debuggability first — the fellowship-plan lesson).
2. Determinized `simulateAction(view, action, rng)` with the heuristic-policy
   cascade; `probe-evaluator-no-peek` + a determinism probe (same view+rng →
   same choice).
3. The chooser (`chooseActionEval`), tournament key `--fp/--shadow eval`,
   K tuned by measurement (start K=3; K=1 if latency bites).
4. Head-to-head A/B vs the acceptance bars. Ship as "Strong" or
   revert-and-record.
5. Linode worker plumbing (separate doc/commit series).

## Build log

- **Stage 1 (905b6e1)** — `evaluate()` + property probe + `eval-trace.mjs`.
  Sanity number: turn-8 eval sign predicts the winner in 53% of games — the
  meta is a Ring race decided by late dice; expect the evaluator's value in
  decision quality, not oracle judgment.
- **Stage 2 (869e04b)** — `simulateAction`/`simulateOutcome` built from the
  redacted view. The no-peek probe caught a fail-closed bug before commit
  (unbound adapter method → every sim refused → no-peek vacuously true).
  Measured 1.14 ms/simulation at 85 candidates.
- **Stage 3** — `chooseActionEval`, tournament key `eval`. Two lessons from
  the probes: (1) military victory is recorded at TURN END, so `winner` is
  null mid-turn — a reached threshold needed its own decisive term
  (`vp.*WinPending`, 5000) or the 10th VP scored only +50 over the 9th and
  sample noise chose a recruit over the winning capture; (2) the Army die's
  second move is part of the simulated cascade (played by the heuristic), so
  a probe with a decoy army tied because the heuristic walked the other army
  into the win. Timing: ~29 s/game with Shadow=eval at K=3 → 500 games/family
  ≈ 4 h; the stage-4 A/B (6 runs) is an overnight detached chain.

## Non-goals

- No opponent-move search (the opponent "responds" only inside forced cascades,
  played by the heuristic policy).
- No deeper search yet — MCTS/PIMC is the step after, and only if v1's ceiling
  demands it (async latency budget makes it viable later).
- No learned weights, no training data, no schema changes, no touching the
  FP-side heuristics beyond the shared eval (coordination rule).
