# A Fellowship-plan state machine for the FP AI — design & evaluation groundwork

Status: **stage 2 (HEAL) shipped 2026-08-16; stages 1 (RUN) and 3 (BANK) tried and reverted** — see the result sections. Design approved 2026-08-15. HEAL is live in `src/ai/wotrAI.ts` (`fellowshipPlan`);
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
| *(baseline, 2 seed families pooled)* | *1279*  | *1618*        | *43.6%*   | 4000 games, median 15 |
| HEAL state, exit at Corr ≤2       | +8.0%     | −11.8%        | 44.6%  | not shipped (Ring short of +10%) |
| **HEAL state, exit at Corr ≤1 (shipped)** | **+14.6%** | **−18.9%** | **46.3%** | **kept by John's call** (median 13) |
| BANK state (on HEAL; Corr ≤3, gates >2 steps) | −7.7% | +14.5% | 45.6% | reverted (Mordor entries −6%) |

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

## Stage 2 result: HEAL, shipped (2026-08-16)

Built per the design: pure function — pre-Mordor, standing in an unconquered FP
City/Stronghold, Corruption ≥ 4 (or ≥ 2 with no Progress banked, i.e. it rested
here last turn — hysteresis without memory). While HEAL: `moveFellowship` scores
5 (a move is a Hunt roll that undoes the rest, and the next in-place declare
throws the Progress away regardless) and the rest-declare keeps firing down to
the exit threshold. Two seed families × 2000 games each, both agreeing tightly:

- exit ≤ 2: Ring +8.0%, military −11.8%, FP +1.0 pt — inside the military bar,
  short of the Ring bar.
- exit ≤ 1: Ring +14.6% (728 / 738 vs 630 / 649), military −18.9%, corruption
  deaths +10.7%, FP 43.6% → 46.3%, median 15 → 13, Mordor entries +12%, gates zero.

What HEAL does is convert military-decided games into Ring-decided games nearly
1:1 (pooled: Ring-decided +305, military-decided −303) with the FP taking a
growing share of them (FP wins +108). Resting longer converts more. So no exit
threshold clears both bars — they pull opposite ways for a heal-only change. The
call went to John: **ship exit ≤ 1**. The ±15% military bar was written to catch
*collapse* (the reverted experiments took military 810 → 30–271); −19% with the
army game intact and median 13 is not that, and the Ring lift addresses the
standing player complaint. First Fellowship change ever to raise Ring wins
without collapsing the military game — because it LOWERS move frequency.

Criteria note for later stages: the FP-window criterion (48–52%) was written
against a 50.0% baseline; fidelity work since (Great Host timing etc.) moved the
baseline to ~43.6%, so it should be read as "moves toward 50, never away".

## Stage 3 result: BANK, reverted (2026-08-16)

Built as the doc says, with one gate learned from `b845127`: BANK only while
Corruption ≤ 3 and the nearest entrance is > 2 steps beyond banked Progress; in
BANK the distance-buying mid-journey declare is suppressed (heal-declares and
entrance-declares untouched). Two seed families × 2000 games on top of the shipped
HEAL, both agreeing: Ring 1466 → 1353 (−7.7%), Mordor entries −6%, military
+14.5%, FP 46.3% → 45.6%, median 13 → 14. Push-declares halved, so it fired as
designed. Same finding as the blanket ban, now with the Corruption gate: the
distance declares are not a leak, they are the *walk* — each moves the figure a
heal-spot closer, and hoarding Progress means fewer Mordor entries, not safer
ones. BANK as a "don't declare" state is falsified twice; a future BANK would
have to mean something else (e.g. WHICH declares to prefer, not whether).

## Two Hunt-choice fixes, shipped (2026-08-20)

Not plan-machine states — two *correct-play* fixes, each raised by a player report,
each fixing a decision the AI was making badly rather than changing how often the
Fellowship moves. Isolated A/Bs, 2 seed families × 1000 games per arm:

| arm                   | FP%      | Ring | Corr deaths | military | Mordor entries | peak Corr | median |
|-----------------------|----------|------|-------------|----------|----------------|-----------|--------|
| baseline (`33223c4`)  | 46.4     | 726  | 541         | 733      | 1297           | 8.1       | 14     |
| reveal-move tie-break | 50.2     | 845  | 554         | 601      | 1439           | 8.1       | 13     |
| Mordor casualties     | 52.5     | 849  | **414**     | 737      | 1297           | 7.5       | 14     |
| **both (shipped)**    | **55.5** | 951  | 446         | 603      | 1439           | 7.4       | 13     |

**Reveal-move tie-break.** The reveal PARKS the figure, and the Hunt re-rolls against
wherever it stands until the next declaration — so the destination is a multi-turn
commitment, not a step. The old rule was distance-to-Morannon only, and ties (there
are always several) fell to action-list order. Now: distance first, then no re-roll
source standing in the region, then nothing adjacent that can walk in, then near a
rest-heal. It buys no safety with distance, yet Mordor entries rose 11% — a figure
parked out of re-roll range simply gets to move.

**Companions are currency on the Mordor Track.** A Companion in the Fellowship can
never be separated again once on the Track (p.43), so its only remaining use is
soaking Hunt damage; the old policy hoarded them until Corruption 8+ and the
Fellowship died with a full escort. Now it takes the casualty on every hit, spending
the Guide (the highest Level left) on a 3+ so nothing spills. Corruption deaths −23%
with military wins untouched (737 vs 733) — this one converts deaths into Ring wins
and touches nothing else.

Both are outside the plan-machine acceptance band (FP 48–52%, military ±15%), and
that band does not apply: it was written to stop *strategy* experiments from being
justified by win rate alone. These are cases where the AI had a strictly better legal
move available and did not take it, so the swing is the size of the mistake being
removed, and the answer to a now-stronger FP AI is a stronger Shadow AI — not a
dumber Free Peoples one. Pinned by `scripts/probe-ai-hunt-choices.mjs`.

## Mordor-entry gating: tried and rejected on measurement (2026-08-24)

Raised by a player report (Shadow seat): *"if you are at 6 corruption, no
companions, you ought to abandon the ring game and push for a military win —
does the AI calculate its odds?"* It does not: `enterMordor` is taken
unconditionally the moment it is legal. Two gates were built and A/B'd, 1000
games x 2 seed families per arm, against a 1089/2000 (54.5%) baseline at
`78fb514`:

| arm                                   | FP wins | Ring | FP military | Corr deaths | Mordor entries |
|---------------------------------------|---------|------|-------------|-------------|----------------|
| baseline (`78fb514`)                  | 1089    | 1004 | 85          | 360         | 1416           |
| refuse at Corruption >= 8             | 1090    | 1004 | 86          | 351         | 1406           |
| refuse at <=1 Companion & Corr >= 3   | 1083    | 986  | 96          | 333         | 1363           |

Neither ships. The Corruption gate is inert — it changes the death certificate
(corruption deaths -9, Shadow military +9) and not the result. The Companion
gate does exactly what the report asks and *loses by doing it*: FP military wins
+11, Ring wins -18.

**The reason is the finding.** The FP AI's military conversion is 85/2000 =
**4.2%**; 92% of its wins are the Ring. So there is no military game to pivot
*to*, and a 20%-odds Mordor run is still the better bet than the board. Any
future "abandon the Ring" logic is blocked on making FP military play strong
enough to be worth pivoting to — that is the real gap the report found.

Entry telemetry (1390 entries / 2000 games) also **inverts the report's
premise** — Corruption is the weaker predictor, the escort is the stronger one:

| Corruption at entry | Ring win % |     | Companions at entry | Ring win % |
|---------------------|------------|-----|---------------------|------------|
| 0-2                 | 85-88%     |     | 0                   | 19%        |
| 5                   | 63%        |     | 1                   | 39%        |
| 7                   | 49%        |     | 3                   | 67%        |
| 9+                  | 0-14%      |     | 6                   | 74%        |

Corruption 7 with 6 Companions wins the Ring 75% of the time; Corruption 3 with
<=1 Companion wins it 0%. So "6 Corruption is hopeless" is false, but the
reporter was pointing at the right *variable* — bodies to soak the Track. A
future experiment worth more than entry-gating: value Companions higher
pre-Mordor (discourage separations that strip the escort), since the escort is
what the run is actually made of.

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
