# Self-play training — plan and build log

Status: **iteration 0 running** (John, 2026-11-21: "Do both — start the self-play
training"; the other half is a local CWOTR sparring partner, below). Companion to
`ai-search-plan.md`, whose conclusion motivates this.

## Why

The playout search (`search.ts`) gained 10–15 points against whichever policy its
playouts used for the opponent. Against an opponent it did not model, it gained only
~6 points, and that gain was not significant. Its playouts are our heuristic, so the
search inherits that heuristic's picture of the game. The tournament leaders play
nothing like it.

What we need is a position judgement that is not "what would our heuristic do next".
That means a learned value, improved by playing with it and learning again.

## The loop (approximate policy iteration)

1. **Generate:** self-play with the current player, plus variety: human-like FP in
   30% of games, and per-side noise (0–35% of top-level decisions taken at random
   from the heuristic top 3). Record every turn start and ~12% of mid-turn
   decisions. `scripts/selfplay-gen.mjs`.
2. **Train:** a value net on all positions so far, labelled with the real winner.
   `scripts/train-value-net.mjs`; `--init` warm-starts from the previous net.
3. **Play:** `netPlayer.ts`, one ply scored by the net. Each of the heuristic's top
   8 moves is applied on 8 shared determinizations (no peeking, as in `search.ts`).
   Pending choices (both sides) are resolved by the heuristic until the game is back
   at an ordinary decision. Then the net scores the position. There is no playout
   of the opponent's turn: the net judges it.
4. **Measure:** paired A/Bs on the usual seeds, against both the heuristic and the
   human-like FP, and against CWOTR once the bridge exists. Every gate stays 0.
5. Repeat from 1, generating with the new player (`selfplay-gen --net`).

## The pieces

- `src/ai/encode.ts`: 1,353 small-integer inputs (Uint8, ~1.3 KB per position).
  - Per region, 12 channels: FP regulars, elites, leaders, characters; Shadow
    regulars, elites, Nazgûl, minions; control; siege; the Fellowship's last-known
    location.
  - Globals: turn, phase, dice left by face, the Hunt box and pool mix, Elven Rings,
    Fellowship tracks, characters, politics, reinforcements, card counts, VP.
  - Public information only.
  - Bump `ENCODING_VERSION` on any layout change. Stored data and nets check it.
- `src/ai/valueNet.ts`: an MLP, 1,353 → 128 → 32 → P(Shadow wins).
  - Inputs are scaled by 1/std but not centred, so the many empty region channels
    stay zero and the first layer is a sparse sum.
  - Pure TS, ~50 µs per position.
- Training is plain mini-batch Adam in JS: ~70 s per epoch per million positions.
  The last 10% of the last file is held out, by whole games.

## Budget (one core, the shared locks)

| step | cost |
|---|---|
| heuristic self-play | ~0.1 s/game, ~25 positions/game |
| net self-play (both sides, 6 × 4) | ~6 s/game |
| net player in an A/B (one side, 8 × 8) | ~3 s/game |

CWOTR's C engine self-plays ~1,000 games/s on 9 threads. We are far slower, so we
lean on variety from cheap heuristic games for iteration 0 and spend net
self-play only where it changes the data.

## CWOTR as a sparring partner

CWOTR (`behindmedia/CWOTR`, public, **no licence**) is used to measure only: it is
never vendored, copied or shipped. Its `proto/bridge` referees a game on its own C
engine and speaks the WotR Bot Protocol (`behindmedia/wotr-protocol`, spec CC BY
4.0) to one outside bot over stdin/stdout. Its repo ships no trained weights, so we
train it locally (`bin/wotr train`).

To play it we need our own protocol client. PR #1 is a third-party one; we write
ours from the spec instead.

### Our protocol client (`src/protocol/`, `scripts/protocol-bot.mjs`)

- `names.ts`: the protocol vocabulary mapped to our ids. The differences are:
  - `gandalf-the-grey` / `-white`;
  - `-strat-` card ids;
  - `rovanion`;
  - special Hunt tiles keyed by their card;
  - standard tiles by value and reveal.
- `viewToState.ts`: a protocol view → our GameState. The opponent's hidden cards
  are markers, as in our redacted views. Feed it to `determinize`.
- `decide.ts`: answers each `decide`, in this order:
  1. **A queued plan.** At ACTION, FELLOWSHIP_PHASE and HUNT_ALLOCATION our chooser
     picks one of our actions. That action is matched to the referee's option, and
     the protocol's later steps for the same action (army, units, attack, recruit,
     characters) are queued as a plan.
  2. **A rebuilt battle.** Combat card, casualty, cease, retreat, siege and extend
     questions: `pendingCombat` and the pending choice are rebuilt from the view's
     `battle`, then our chooser answers.
  3. **Our engine's own pending choices.** Hunt damage, reveal, hand discards and
     Guide.
  4. **Our engine's follow-ups.** A second army, a second recruit or more
     characters are answered by playing our action forward in a private copy.
  5. **Simple rules**, for card questions and advance, with option 0 as the last
     resort.
- `scripts/protocol-replay.mjs`: feeds recorded referee logs through the client
  offline. On 6 tournament games: 2,109 decisions, 0 view errors, 0 answers off the
  list, ~99% of first steps matched.
- `scripts/spar-cwotr.mjs`: runs games against CWOTR's `proto/bridge referee`.

Building CWOTR here takes local Makefile copies:
- gcc (no clang);
- `-iquote` (its `src/features.h` shadows glibc's);
- `-D_GNU_SOURCE`;
- `touch src/data.c src/data.h` (otherwise make reruns its generator against a
  sibling checkout of our repo).

## Build log

- **2026-11-21:** CWOTR built and training locally: 400 iterations × 320 games,
  2 threads. The client plays it end to end. First games, against the *untrained*
  CWOTR (`prior`, its strategy-guide formula), went to the Shadow almost every
  time whichever side we had. Our Free Peoples lose to corruption around turn 10,
  so the Free Peoples side is where to look.
- **2026-11-21:** encode / valueNet / netPlayer / selfplay-gen / train-value-net
  built. Smoke-tested: the inference module matches the trainer exactly, and the net
  controller runs gate-clean. Iteration 0 is running: 40,000 noisy-heuristic games
  (seeds 1,000,001+) → `net0`, then A/Bs on f1.
