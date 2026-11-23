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

- **2026-11-23, the leader's remaining habits, all rejected.** These ran on the
  shipped code (453a7bd, Voice at half weight) against a fresh baseline: 2000
  games × f1 / f2. Base Shadow wins were 867 / 899 vs the heuristic FP and
  1156 / 1142 vs the human-like FP. Base FP wins vs the heuristic Shadow were
  1133 / 1101. Every gate counter was 0 in all 28 runs.

  | change | result (f1 / f2) | flips | verdict |
  |---|---|---|---|
  | Shadow draws (score 30, not 12) at ≤ 4 cards | Shadow 881 / 890 heur, 1125 / 1114 human-like | +560 −555 heur, +611 −670 human-like | flat, slightly worse vs human-like |
  | FP declares at Progress ≥ 2, gain ≥ 2 | FP 1104 / 1111 | +244 −263 | flat to worse |
  | FP declares at Progress ≥ 1, gain ≥ 1 | FP 1097 / 1114 | +386 −409 | flat to worse |
  | FP Elven Ring → Character die while hidden (40) | FP 1150 / 1123 | +916 −877 (z ≈ 0.9) | flat, as on 2026-11-07 |

  - No change shipped and none went to CWOTR.
  - The declare knobs did change play. Push-declares went from ~1,600 per 1,000
    games to ~2,000 (Progress 2) and ~2,550 (Progress 1). The extra declares
    won nothing.
  - Of Normal's habits, only the Voice of Saruman difference paid in our game.
- **2026-11-23, testing the leader's habits as heuristic changes.** Each habit got a
  paired A/B: 2000 games × 2 seed families × both FP yardsticks, Shadow wins, base
  826 / 801 against the heuristic FP and 1111 / 1093 against the human-like FP.

  | change | heuristic FP | human-like FP | verdict |
  |---|---|---|---|
  | Hunt: 1 die before Mordor | 706 / 702 | 1024 / 1026 | loses (z −2.2 to −4.2) |
  | Hunt: 1 die in Mordor | 760 / 752 | 1072 / 1041 | loses (z −2.4 to −4.5) |
  | Voice of Saruman off | 850 / 873 | 1108 / 1131 | +131, one dip |
  | Voice of Saruman at half weight | 847 / 867 | 1134 / 1121 | **+138, up in all four; shipped** |

  - Against CWOTR, half weight was neutral: 63 → 60 of 90 Shadow games, z −0.48.
    `spar-cwotr.mjs --side sh` plays only our-Shadow seeds.
  - A leader's habit is a hypothesis, not a fix. Normal's light Hunt works inside
    Normal's game, not ours.
  - The soak also caught an offered-then-refused card move (sh-str-09 into Lórien
    under A Power too Great), now fixed.
- **2026-11-21, vs CWOTR (trained locally, 400 × 320 games), 60 seeds, our side
  alternating:**

  | our bot | as FP | as Shadow | total |
  |---|---|---|---|
  | heuristic, client v1 | 14/30 | 27/30 | 41/60 |
  | heuristic, client v2 | **21/30** | 26/30 | 47/60 |
  | search `--search-mix 0.5`, client v2 | 22/30 | 20/30 | 42/60 |

  The client changes from v1 to v2 count (FP z 2.11):
  - Hunt-damage reductions are mapped.
  - An unmatched pick asks our AI for its next choice instead of taking option 0.
  - The Fellowship phase falls back to `done`.
  - Card questions get defaults.

  Against an opponent it does not model, the playout search did not help: 47 → 42
  overall, z −1.09; as Shadow z −1.90. This is the same verdict as A/B 5 in
  `ai-search-plan.md`. Our local CWOTR is weaker than the tournament's (that one
  drew 20–20 with us), but it is an honest yardstick that is not us.
- **2026-11-21, iteration 0 (`net0`: 40k noisy-heuristic games, 1.1M positions,
  h1 128):**
  - Held-out log-loss was 0.629 against a base rate of 0.693, after the first
    epoch. Every later epoch overfit: train 0.48, held-out up to 0.81. With 40k
    games of labels the net memorises games, not positions.
  - Paired A/Bs:

    | player | vs | heuristic | `net0` |
    |---|---|---|---|
    | net Shadow (margin 0.02) | heuristic FP | 86 | 87 |
    | net Shadow (margin 0.02) | human-like FP | 116 | 93 (z −2.41) |
    | net FP (margin 0.02) | heuristic Shadow | 114 | 98 (z −1.62) |
    | net Shadow (margin 0.08) | human-like FP | 116 | 107 |
    | net FP (margin 0.08) | heuristic Shadow | 114 | 114 |

  - At margin 0.02 the net overruled half of the decisions it saw, and lost. At
    0.08 it was neutral. A better predictor of the winner is not yet a better
    judge *between candidate moves*.
  - `net0b`: 100k games, 40% of positions, h1 64, L2 1e-4. Held-out 0.645, and
    no longer overfitting (train 0.60). Margin 0.08:

    | player | vs | heuristic | `net0b` | z |
    |---|---|---|---|---|
    | net Shadow | human-like FP | 116 | 109 | −0.73 |
    | net FP | heuristic Shadow | 114 | 118 | 0.43 |
    | net Shadow | heuristic FP | 86 | 99 | 1.52 |

    Neutral within noise. **Iteration 0 gives no player gain.**
  - Generating iteration 1 with the net player costs ~6 s/game, so ~17 h per
    10k games on one core. With no gain from iteration 0, the loop is parked.
- **2026-11-21, where the leaders differ (`scripts/protocol-agree.mjs`).** At
  Normal's (1st place) decisions in the tournament logs, our heuristic picks the
  same option 42% of the time as FP and 24% as Shadow.
  - Shadow, commonest differences:
    - Normal recruits with Muster dice where we take Voice of Saruman.
    - Normal puts **1** Hunt die where we put 2.
    - Normal draws a card where we play one.
  - FP, commonest differences:
    - Normal draws where we play.
    - Normal recruits.
    - Normal **declares** where we end the Fellowship phase.
    - Normal uses Elven Rings.

  These are hypotheses for heuristic A/Bs, measured against both yardsticks and
  CWOTR. They do not show that Normal is right at each decision.

  The tool also found a client bug: with no die named, the client took the first
  matching die, often a Will of the West. It now pays as our engine does: plain
  face, then Army/Muster, Will last.
- **2026-11-21:** CWOTR built and training locally: 400 iterations × 320 games,
  2 threads. The client plays it end to end. First games, against the *untrained*
  CWOTR (`prior`, its strategy-guide formula), went to the Shadow almost every
  time whichever side we had. Our Free Peoples lose to corruption around turn 10,
  so the Free Peoples side is where to look.
- **2026-11-21:** encode / valueNet / netPlayer / selfplay-gen / train-value-net
  built. Smoke-tested: the inference module matches the trainer exactly, and the net
  controller runs gate-clean. Iteration 0 is running: 40,000 noisy-heuristic games
  (seeds 1,000,001+) → `net0`, then A/Bs on f1.
