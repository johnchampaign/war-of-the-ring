# War of the Ring (2nd Ed.) — Rules Spec

The engine implements **this document**, not the PDF directly. Page cites
(`p.NN`) refer to `WOTR001-Rulebook-EN-v24_1-web.pdf` (local only). This is the
base game, 2-player (Free Peoples = **FP**, Shadow = **SH**). Expansions and
3–4 player rules (p.45+) are out of scope.

> **Engine-deviation log** lives at the bottom (§14). Every place the digital
> engine departs from the printed rules — including the few *mechanical*
> auto-resolutions allowed under our "prompt for every genuine choice" policy —
> is recorded there, next to the rule it departs from.

---

## 1. Sides, pieces, and the board model

- **Two players.** FP commands Elves/Dwarves/Gondor/Rohan/North + the
  Fellowship; SH commands Sauron/Isengard/Southrons&Easterlings + Minions
  (p.3, p.8).
- **Regions** are the atomic map spaces. Adjacency is by shared white-line /
  river border. **Impassable** (thick black) borders are never adjacent. Seas/
  lakes are not regions (p.10). *The rulebook map is the authority on adjacency;
  the engine's `regions`/`adjacency` data is transcribed from it.*
- **Nations** (8): FP = Dwarves, Elves, Gondor, The North, Rohan; SH = Sauron,
  Isengard, Southrons & Easterlings (p.9). Each region belongs to ≤1 nation.
  A region's nation is the thick coloured border on the map (p.9), **not** who
  garrisons it. **Osgiliath is not a Gondor region** — it is the ruin of a Gondor
  city drawn outside Gondor's border, and neither are North/South Ithilien
  (Almanac, notes to *Challenge of the King* and *House of the Stewards*: "Note
  that Osgiliath is a ruin of a Gondor city, and so is not a Gondor region (even
  though Gondor units start the game in this region)"). Engine: `nation: null` +
  `setupNation: 'gondor'` in `assets/map.json`, so the 2 Gondor Regulars still set
  up there while every region-belongs-to-a-Nation rule (political activation on
  entry, the not-At-War border rule, "a Gondor region" card conditions, *The Last
  Battle*'s "outside of a Free Peoples Nation") treats it as neutral ground.
  **Attacking** the garrison still rouses Gondor — that trigger is "an Army
  containing units of that Nation is attacked" (p.35), which reads the units, not
  the ground. The other Fortification, **Fords of Isen, IS a Rohan region**.
  Player report (2026-08-13) corrected us on this; probe: `probe-osgiliath-neutral`.
- **Settlements**: Town, City, Stronghold. **Fortifications**: Osgiliath, Fords
  of Isen (p.10–11). City = 1 VP to the opponent if captured; Stronghold = 2 VP
  (p.11, p.44).
- **Settlement control**: starts with the region's nation. Captured → opponent's
  Settlement Control marker (p.32). "Unconquered" = controlled by original owner
  (p.11).
- **Army** = all friendly Army units + Leaders + Characters in one region (p.8,
  p.26). May mix nations. **Stacking limit 10** Army units per region (5 if
  besieged inside a Stronghold) (p.8, p.26, p.31).
  p.26 enforces the limit as an **end-of-action** obligation: "If, at the end of any
  action (for example, after moving or mustering troops), more than 10 units are in
  the same region, the excess units must be removed from the game by the controlling
  player" (they return to reinforcements and may re-enter later). Mustering and
  voluntary Army moves ask up front (`recruit`, `afterMove`), but an Army can also be
  pushed over involuntarily — chiefly by **retreating** (p.31) into a region that
  already holds a friendly Army, and also by card-driven moves and a lifting siege
  returning its garrison to the field. `enforceStackingLimit` in the adapter is the
  backstop for all of them: it runs at the end of every dispatched action and raises
  the same `removeExcess` prompt, so the controlling player still chooses the figures
  rather than the engine picking. Without it over-stacked Armies survived and attacked
  at full strength (player report: "sometimes enemy attacks with way more than 10
  units"). Regression-tested in `scripts/probe-stacking-leaders-victory.mjs`.
  **Open question (not yet decided):** p.27's army-movement list also says "After
  moving an Army into a region, you can not exceed the stacking limit of 10 units,"
  which reads as making an over-stacking *voluntary merge* illegal outright rather
  than legal-then-trimmed. The engine currently takes the p.26 reading for moves
  (allow, then prompt to remove). Both readings end at ≤10 units, so neither produces
  the reported bug; the difference is only whether the mover loses figures.

### Unit / leader / character taxonomy
- **Army units**: Regular or Elite, per nation (counts p.7). Elite can be
  "reduced" to a Regular of the same nation as a casualty step.
- **FP Leaders** (gray): never alone — must be with a friendly Army; removed if
  ever alone. No combat strength; add Leadership. Any FP Leader can lead any FP
  nation's units (p.8).
- **Nazgûl** (SH leaders, incl. Witch-king): act as leaders but may move alone
  anywhere (flying), ignore enemy armies; cannot solo-enter an FP-controlled
  Stronghold unless a SH army besieges it (p.8). Witch-king counts as a Nazgûl
  for all card text unless named (p.24).
- **Characters**: Companions (FP) and Minions (SH) — unique figure + card, move
  ignoring enemy armies (p.8). Gollum is special (Guide when Ring-bearers alone)
  (p.8).
- **Reinforcement pools**: Army units & Nazgûl are recyclable (casualties return
  to reinforcements). All **Characters, FP Leaders, and FP units** eliminated are
  **permanently** out (p.26, p.30).

---

## 2. Setup (p.14–17)

Key initial state the engine seeds:
- Ring-bearers in **Rivendell**. Fellowship Progress + Corruption both on **0**;
  Progress **Hidden** side up (p.14 steps 2–3).
- All 7 Companions (Gandalf the Grey on top) in the **Guide box**; Gandalf the
  Grey is starting Guide. Aragorn–Heir, Gandalf the White, Gollum set aside
  (p.14 step 4).
- 3 Elven Rings in FP box, "Ring" side up (p.14 step 6).
- Minion cards (Witch-king, Saruman, Mouth of Sauron) set aside (p.14 step 7).
- Event decks: split each side's cards into **Character** and **Strategy** decks
  by back, shuffle separately (p.14 step 8). 96 cards = 4 decks × 24.
- **Hunt Pool**: 16 standard (beige) tiles in the cup; 8 special (blue
  Fellowship / red Shadow) set aside (p.14 step 9, p.40).
- **Action dice start**: SH 7 red, FP 4 blue. Remaining dice set aside (p.14
  step 10, p.18).
- **Political track** initial positions per nation, with Elves + all SH nations
  **Active**; other FP nations **Passive**. Exact box positions p.14 step 11 /
  p.34 diagram.
- Army setup per the diagrams (p.16–17) → encoded as `setup.ts` data tables
  (per-region starting units/leaders + per-nation reinforcement pools).

---

## 3. The game turn — six phases (p.18)

1. **Recover Action Dice & Draw Event Cards.** Each player recovers used dice,
   applies pending pool gains/losses, then **draws 2 cards (1 Character, 1
   Strategy)** (p.18, p.22). FP dice that were in the Hunt Box return to FP now
   (p.37).
2. **Fellowship Phase.** FP may **declare** Fellowship position; if declared in
   an FP City/Stronghold, may **heal** 1 Corruption and **activate** that nation;
   FP may change the **Guide** (p.18, p.38–39).
3. **Hunt Allocation.** SH places 0..N dice in the **Hunt Box** (N = Companions
   currently in Fellowship; Ring-bearers don't count). **Min 1 die** if FP put ≥1
   die in the Hunt Box last turn. SH may always place ≥1 even if N=0 (p.18,
   p.19). Hunt-box dice are **not** rolled.
4. **Action Roll.** Both roll their remaining pool. SH immediately moves all
   **Eye** results into the Hunt Box (p.18, p.19).
5. **Action Resolution.** Players **alternate**, FP first, spending **one die per
   action** (p.18, p.19). Detailed in §4–§11.
6. **Victory Check.** Check **Military** victory (§13). Ring-based victory ends
   the game *immediately* whenever it occurs, not only here (p.18, p.44).

### Action dice pool (p.18)
- SH 7 base → max 10 (+1 each as Saruman / Witch-king / Mouth of Sauron enter
  play). FP 4 base (+1 when Aragorn–Heir enters, +1 when Gandalf the White
  enters). Lose the bonus die if that character is eliminated. Gains/losses take
  effect **next** turn's Recover phase (p.19).

### Action die faces (p.19–21)
FP and SH share action *types* but different faces:
- **Character** (Sword): move/attack-with-leader; play Character event; **FP
  only**: Fellowship Progress, Hide Fellowship, Separate Companions, Move
  Companions; **SH only**: Move Minions. *(FP dice: 2 faces are Character;
  the Army action on FP dice only appears combined with Muster.)*
- **Army** (Banner): move ≤2 armies; attack; play Army event.
- **Muster** (Helmet): Diplomatic action (advance one friendly nation 1 step;
  FP nation must be active to reach At War); play Muster event; **At-War only**:
  Recruit reinforcements; **SH only**: bring a Minion into play.
- **Event** (Palantir): draw an event from a deck of choice; or play any event
  regardless of type.
- **Muster/Army** combined: choose a Muster or Army action.
- **Special**: FP = **Will of the West**; SH = **Eye of Sauron**.

### Will of the West (p.21, FP)
Before acting, FP may change a Will-of-the-West die to **any other result** and
use it; **or** use it to bring **Gandalf the White** or **Aragorn–Heir** into
play (per their cards). Cannot be changed *to* a Will-of-the-West.

### Eye of Sauron (p.19, SH)
All Eye results go to the Hunt Box (added during Action Roll, before
resolution). They are not spendable actions; they raise Hunt Level.

### Passing & skipping (p.19, p.21)
If a player has fewer unused dice than the opponent, he may **pass** (let the
opponent act). A player may also **skip** a die (discard it with no effect).
When one player is out of dice, the other resolves all remaining dice.

### Elven Rings (p.21)
3 counters, FP-owned, "Ring" side up. When eligible to act, a player may use a
Ring to **change one of his unused action dice to another result**, then take a
normal action. After FP uses a Ring, it flips to "Eye" and passes to SH; after
SH uses it, it's discarded. Limits: **one Ring per player per turn**; FP may not
change a die *to* Will-of-the-West; SH-used Ring that changes a die *to* an Eye
sends that die to the Hunt Box immediately (not an action); SH cannot change a
die already showing an Eye.

---

## 4. Event & Combat cards (p.22–23, p.29)

- Two decks per side: **Strategy** (army banner back) and **Character** (sword
  back). Hand max **6**; discard excess immediately (p.22).
- Draw 2 each turn (phase 1) and optionally via Event action (p.22). Depleted
  deck is **not reshuffled** (p.22).
- **Playing**: during Action Resolution, via an **Event (Palantir)** die, or via
  a die whose icon matches the card's upper-right symbol (p.22). Card text
  overrides standard rules; requirements gate play; effects mandatory, applied to
  max extent possible (p.22).
  **Modelled per card** — `playableVia` in `assets/event-cards.json`, baked in by
  `scripts/merge-play-via.mjs` from the Almanac's card index; `playFacesFor`
  (`engine/data.ts`) turns it into the die faces that can pay. All 48 Character-deck
  cards print the **Character** icon; the Strategy decks split **Army** (19) and
  **Muster** (29). The Army/Muster face covers either of the latter two, an Event die
  covers everything, a Will of the West covers everything for the FP, and the Mouth of
  Sauron's Messenger lets a Muster die pay for an Army-icon card once a turn. The icon
  die is spent in preference to the scarce Event die.
  *(Player report 1w592n. Before this the icon was approximated from the DECK, which
  conflated Army and Muster inside the Strategy decks — a Muster-icon card was wrongly
  playable with an Army die and vice versa.)* `scripts/probe-play-via.mjs`.
- "Play on the table" cards persist until their discard condition; if discarding
  costs a die, that counts as the action (p.22).
- **Combat cards**: every Event card has a bottom-half combat use. Played during
  a battle (does **not** cost an action) — see §7 (p.23, p.29).
- **Persistent "while in play" cards** (`src/engine/persistent.ts`): cards played to
  `cards[side].table` (`onTable`) whose effect keeps modifying the rules. Each query
  reads the table at the seam it governs — *The Last Battle* (FP move die skips the
  Hunt Box, hunt.ts), *A Power too Great* / *The Power of Tom Bombadil* (Shadow barred
  from moving into / attacking listed regions, armies.ts `canMoveArmy` + combat.ts
  `attackTargets`), *Threats and Promises* (FP can't advance a passive Nation via a
  Muster die, politics.ts `advanceableNations`), *Denethor's Folly* (FP can't use
  Combat cards in a Minas Tirith battle, combat.ts `playableCombatCards`). The handler
  applies only the immediate part (e.g. advancing the Nation, eliminating the Leader)
  and lets the card persist. Three more persistent cards carry their own machinery:
  *The Palantír of Orthanc* (after the Shadow plays an Event card, a `bonusDraw`
  PendingChoice lets it draw from either Shadow deck — captured before the play so the
  card can't trigger off itself; adapter `playEvent`/`eventTarget`), *Worn with Sorrow
  and Toil* (on a Fellowship-Companion casualty the Shadow discards an FP Character card,
  random from hand else from the table; hunt.ts `discardFpCharacterCard`), and *Wormtongue*
  (`activateNation` gains a `trigger` arg — carrying `viaAttack` — so Rohan stays passive
  unless roused by an appropriate Companion or a genuine **attack** on Edoras/Helm's Deep;
  politics.ts. A plain army move into those regions, or a walk-in occupation of an
  undefended Edoras/Helm's Deep, is *not* an attack and no longer rouses Rohan — the
  Wormtongue `viaAttack` flag is set only on the combat capture paths, `combat.ts`).
  **Deviation:** declaring the Fellowship in a region does not activate that Nation in this
  engine, so Wormtongue's "declared in Edoras/Helm's Deep" exception is moot. Worn with
  Sorrow's "you may" is auto-applied (always to the Shadow's benefit).
- **FP force-discard of a Shadow table card** (`persistent.ts` `fpForceDiscardMethods`,
  adapter `forceDiscardCard`): two Shadow "play on the table" cards let the FP player
  spend an action to discard them — *The Palantír of Orthanc* (sh-char-21: a Will of the
  West die, OR any Action die + one Elven Ring) and *Denethor's Folly* (sh-str-03: a Will
  of the West die, OR any Action die if Gandalf or Aragorn is in Minas Tirith). The die
  spent IS the action (p.22); the Elven Ring flips FP→Shadow and counts against the
  one-Ring-per-turn limit (p.21). All other table cards discard only on a ceased play
  condition (`pruneTableCards`), never by an opponent's action.
- **Handlers** (`handlers/index.ts`, all 96/96 implemented): each registered card
  applies its effect; unimplemented cards aren't offered. **Interactive cards**
  (those whose effect needs a player-chosen target) use an `EventHandler.targets`/
  `applyTarget` pair: playing pauses with an `eventTarget` PendingChoice, the
  player picks from the enumerated targets, then the effect applies (e.g.
  *Cruel Weather* = move the Fellowship to an adjacent region; *Corsairs of Umbar*;
  *Shadows Gather*). Minor approximations are noted per card (Corsairs' "coastal"
  set; Shadows Gather's path-traversal reduced to distance).
  *Corsairs of Umbar* follows its card text: moving onto a Free Peoples Army **starts
  a battle** (`startBattle` from Umbar, advancing on a win via the normal End of
  Battle rules) rather than merging, and the attack **cannot be ceased**
  (`PendingCombat.noCease` skips the continue/cease decision; the card's "unless the
  Free Peoples Army was already under siege" arm is inherent — a besieged region's
  open field holds the besieger, so the move is a plain merge with fellow besiegers).
  The stacking check applies only when merging with a friendly Army.
  Cards whose text reads "…containing a Settlement" (Éomer Son of Éomund, Many Kings)
  and the Hunt-condition cards reading "a Free Peoples Settlement" (Orc Patrol /
  Isildur's Bane / Foul Thing / Candles of Corpses) use `isSettlementRegion`, which
  excludes **Fortifications** (Osgiliath, Fords of Isen) — a Fortification is not a
  Settlement (p.10).
  "Play if"/"Play on the table if" preconditions gate play (`canPlay`) for *The Last
  Battle*, *Denethor's Folly*, and *The Palantír of Orthanc* like every other
  precondition card — previously they could be played with the condition unmet and
  `pruneTableCards` discarded them for no effect on the next transition (two player
  reports: the FP AI wasted The Last Battle; a player wasted the Palantír before
  mustering Saruman).
  **Multi-target cards** (`EventHandler.repeat = N`, e.g. *The Shadow Lengthens* = 2,
  *The Shadow is Moving* = 4) re-prompt the same `eventTarget` choice up to N times:
  the choice persists (`data.left`/`data.applied`), `targets(state, side, applied)`
  recomputes the legal set each step (excluding a just-moved Army via `applied`), and
  a synthetic `{done:true}` option lets the player stop early once ≥1 target is applied
  (cards read "up to"). The card is held out of hand until the loop ends, then discarded.

---

## 5. Characters: movement & play (p.24–25, p.37, p.39)

- **Companions** enter play only by **separating** from the Fellowship (§9), plus
  Gandalf the White / Aragorn–Heir via Will-of-the-West (p.24).
- **Minions** enter via a **Muster** die per their card (Witch-king/Mouth of
  Sauron/Saruman conditions on card) (p.24).
- **Move Characters** via a **Character** die: FP moves *all* Companions not in
  the Fellowship; SH moves *all* Nazgûl + Minions (p.24). Level-0 character can't
  move (p.24).
- Companions move ≤ their **Level** regions (group: ≤ highest Level); unaffected
  by enemy armies but **stop** on entering a SH-controlled Stronghold; can't
  enter a friendly Stronghold besieged by enemy; no impassable (p.24).
- Nazgûl fly anywhere (except into FP-controlled Stronghold unless besieged by
  SH). Saruman can never leave Orthanc; Mouth of Sauron moves ≤3 (p.24).
- **Implemented** (`charMove.ts`, `moveCharacter` action): a Character die moves
  independent characters — SH moves a Nazgûl group / Witch-king (fly) / Mouth
  (≤3); FP moves a separated Companion (≤ Level). Landing rule (no enemy
  Stronghold unless besieged) enforced. **RAW (closed):** one Character die moves
  **ALL** of a side's eligible characters, each once, to its own destination — the
  first `moveCharacter` spends the die, then a `charMove2` PendingChoice offers
  moving another not-yet-moved figure (or "done"), repeating until every figure has
  moved or the player stops (`CharMoveState` tracks what moved this die so nothing
  moves twice; the AI resolves the chain figure-by-figure, `chooseCharMove`). The
  UI continues the same board-click flow for each figure. **Nazgûl move per-figure
  too:** `moveCharacter` takes an optional `count`, so you can move *part* of a
  stack (the UI prompts "how many?" when a stack has >1 unmoved Nazgûl); the
  relay-guard tracks already-moved Nazgûl **per region** (`movedNazgul`), so the
  unmoved remainder of a split stack stays movable while a moved Nazgûl can't relay
  onward. No residual — character movement is now fully RAW.
- **Event cards that move Companions already on the map** (*Gwaihir the Windlord*,
  *We Prove the Swifter*) are a distinct action from the Character-die move: they
  spend an **Event** die, they grant the card's range bonus, and they are the card's
  only live branch when the Fellowship holds no Companions. See D13 in §14.
- **Character card** fields (p.25): Level, activatable Nation, Guide ability,
  out-of-Fellowship ability, Leadership, action-die bonus symbol. Gandalf,
  Aragorn, Merry, Pippin can activate **any** FP nation (p.34).

---

## 6. Armies: muster & movement (p.26–28)

### Recruiting (Muster die or event) (p.26–27)
Bring reinforcements to a **free** City/Town/Stronghold of an **At-War** nation.
One Muster die yields one of: 2 Regulars (2 settlements) / 2 Leaders / 1 Regular
+1 Leader / **1 Elite**. The two figures from a 2-figure muster go to **separate**
settlements (p.26). The FIRST figure's type never constrains the second: the
`recruitSecond` choice offers both Regulars and Leaders/Nazgûl, so placing a
Leader first still allows a Regular second (player report — it used to lock you
into a second Leader). Cannot recruit in enemy-controlled or besieged settlement, or
beyond available figures. Nazgûl recruit only in Sauron Strongholds (p.26). Event
cards may recruit even in not-yet-At-War nations or besieged Strongholds
(card-specific) (p.27).

### Movement (p.27–28)
- **Army die**: move up to **2 different** armies one region each (can't move the
  same army twice). **Character die**: move **1** army that contains ≥1
  Leader/Character.
- Who counts as that Leader/Character is ONE shared test, `charDieLeaders`
  (`armies.ts`), used by `legalActions`, both apply paths, `attackError`,
  `moveArmySplit` and the UI die-face hint — they must never disagree, or the UI
  offers an action the engine then refuses (the soak catches it as
  "illegal-accepted"). It counts the actor's **own** Leaders/Nazgûl/Characters
  (never an enemy Companion sharing the region) plus, while Saruman is in play,
  **each Isengard Elite** — "Servants of the White Hand: each Isengard Elite unit
  is considered to be a Leader as well as an Army unit for all movement and combat
  purposes." **Saruman himself counts for an attack but not for a move:** he can
  never leave Orthanc, so he cannot be the figure that joins a Character-die move,
  but "attacking units do not actually move into the region they are attacking"
  (p.28), so he leads an attack out of Orthanc perfectly well. (Player report: an
  Orthanc army with Saruman and two Isengard Elites was refused a Character-die
  attack — wrong on both counts. `scripts/probe-character-die-attack.mjs`.)
- Destination must be **free for movement** (no enemy army; enemy-controlled
  settlement OK if no enemy army). Moving through an enemy-controlled settlement
  **captures** it (p.28). Stacking checked after all sub-moves (p.28).
- Non-At-War nation's units can't cross **another nation's** border (even
  friendly); see §8.
- No moving the same figure twice in one action; can't pick up/drop along
  multi-region event moves (p.27). Splitting allowed (leave rearguard); a
  Character-die move that splits must keep ≥1 Leader/Character with the movers
  (p.27).
- **Engine hygiene — moves never carry enemy units.** Every whole-army mover
  (`moveArmy`, card moves via `moveAllUnits`, post-battle `advanceInto`, retreats
  via `moveStack`) moves only the acting side's Nations. No legal play puts both
  sides' units in one region's open field (a besieged garrison lives in the siege
  box), but a card bug once merged two Armies (Corsairs of Umbar) and subsequent
  moves then dragged the enemy's units along ("Gondor stole my Southron Army"
  report). Belt-and-braces: `sweepStrandedUnits` (armies.ts, run from `advance()`
  after every action) repairs any already-mixed region — the Army `armySide`
  recognizes stays, the stranded side's units leave the board the way casualties
  do (Shadow to reinforcements, FP removed), logged as a state repair.

---

## 7. Battles (p.28–32)

### Initiating (p.28)
Only a nation **At War** can *start* a battle. Attack an adjacent enemy army via
**Army** die (single army) or **Character** die (army must contain a
Leader/Character), or via event. Attacking units stay put during the battle;
only on winning may the attacker advance into the embattled region (p.28, p.31).
Attacker may split off a **rearguard** (not part of battle, can't be targeted/
chosen as casualties/advance) (p.28). All defenders are always in the battle.

### Combat round (p.29) — repeat until attacker ceases / defender retreats / wipe
1. **Play a Combat card** (optional; attacker declares first, then defender; chosen
   secretly, revealed simultaneously) (p.29).
2. **Combat roll**: each rolls dice = Combat Strength (= # Army units), **max 5**.
   Hit on **5–6** (p.30). (`1` always misses, `6` always hits, regardless of
   modifiers — p.30.)
3. **Leader re-roll**: re-roll failed dice up to **Leadership** (= # Leaders/
   Nazgûl + Character Leadership ratings), max 5; same hit number (p.30).
   The allowance is `min(Leadership, misses)` **fixed before any re-roll die is
   thrown** — it is not re-derived as the re-rolls land. `rollHits` once wrote it as
   the `for` condition while the body decremented the miss count on each successful
   re-roll, so every re-roll that HIT silently consumed one of the re-rolls still
   owed (player report: 3 misses with ample Leadership got only 2 re-roll dice).
   Regression-tested in `scripts/probe-leader-reroll.mjs`, which also asserts the
   sample actually contains re-rolls that hit — otherwise it would pass vacuously.
   Note Leadership counts each **Isengard Elite** while Saruman is in play
   ("Servants of the White Hand"), so an Orthanc stack is often at the cap of 5.
4a. **Automatic (dieless) hits** — *Great Host*'s "score one automatic hit" and the
   "+1 if you scored any" family — are added after the roll and **recorded on the roll**
   (`CombatRoll.auto`) so the log can name them: a line showing 4 hits behind 3 hits'
   worth of dice reads as a miscount otherwise (player report). The 2:1 comparison is
   made against the enemy **Force**, not the enemy region — in a siege the region holds
   the besieger, so measuring it compared an army with itself.
   **Great Host now resolves at its printed time** — the 2:1 comparison uses the
   post-casualty counts on both sides (onslaught step, `greatHostDone` latch), and the
   hit is absorbed through the normal per-casualty choice. The earlier deviation note
   here claimed the old mid-roll timing was "strictly conservative"; that was WRONG —
   the owner's own casualties can drop it below 2:1 (mid-roll granted a hit RAW would
   deny) just as enemy casualties can bring them within it (mid-roll denied a hit RAW
   would grant). Corrected when the timing was fixed.

4. **Remove casualties**: per hit, opponent removes 1 Regular **or** reduces 1
   Elite→Regular (replacement); for every 2 hits may instead remove 1 Elite (p.30).
   Attacker chooses his removals first (p.30). FP casualties are permanent &
   stored away from reinforcements; SH casualties recycle (p.30).
   **Reducing an Elite conserves figures** (`reduceElite`, every path — casualty
   choice, batch plan, pressing a siege assault): the Elite figure comes off the
   board (Shadow → reinforcements, FP → gone) and the replacement Regular is TAKEN
   FROM the reinforcements. It used to swap only the board figures, so the pool
   never lost the Regular nor regained the Elite — four siege extensions left
   Sauron with 40 Regulars in play out of 36 and four Trolls that existed nowhere
   (player report). Edge: if the pool holds no Regular the reduction still happens
   (RAW lets the FP draw from eliminated units; for the Shadow it is a documented
   deviation rather than a failed reduction). `scripts/probe-figure-conservation.mjs`.
   **Every attack — die-driven or card-driven — requires a unit of a Nation At War**
   (`hasAtWarUnit`; Help Unlooked For, Nazgûl-led/Witch-king Army cards, Corsairs,
   Grond/Uruk-hai assaults). Not-At-War units are forced into the rearguard, so an
   Army with none At War would otherwise "attack" with its Leaders alone (player
   report: a lone Leader attacked with 0 dice and died). `startBattle` also refuses
   a zero-unit attacking force outright.
   **Allocated ONE HIT AT A TIME** (`casualtyOptions` / `resolveCasualtyStep`): the
   `combatCasualties` / `eventCasualties` PendingChoice re-prompts until the hits are
   spent, so mixed allocations are expressible. It used to be a single
   `regularsFirst`/`elitesFirst` plan applied to the whole batch, which could not —
   a besieged {3R,3E} taking 3 hits could only become {3E} (3 dice) or {6R} (no Elite
   left to press the assault), never the {2R,2E} the rules allow (player report). The
   **two-hits-for-one-Elite** option did not exist at all before this. Which **Nation**
   loses the figure is part of the choice (p.30 — it is the owner's army to spend).
   Allocations that are FORCED (exactly one legal option) are applied silently by
   `absorbForced`, so the player is never asked to confirm a non-choice — note a lone
   Elite facing 2+ hits **is** a choice (reduce twice vs remove outright), and that an
   Elite costing 2 hits to remove means {1R,1E} genuinely survives 2 hits.
   Covered by `scripts/probe-casualty-choice.mjs`.
   **Casualties are simultaneous** — p.30 fixes only the *decision* order ("the
   attacker decides first"), and p.31 names "one **or both** Armies are completely
   eliminated" as an End of Battle outcome. So a wiped attacker's hits still land:
   `combatStep`'s "someone is wiped → end the battle" guard is skipped for the one
   transition into `defenderCasualties` (including after a casualty-choice pause),
   which is what makes a **mutual wipe** possible.
5. **Cease or retreat**: attacker may **cease** (survivors stay); else defender
   may **retreat** to an adjacent free region (p.30). Eliminating all Army units
   also removes that army's Leaders/Characters (p.30).
   **A retreat is not a casualty.** `finishCombat` reports each side's losses by
   diffing its unit count at battle start against what is still standing in the
   battle region — so an Army that marched off alive was booked as annihilated
   (player report: "if the defender army retreats, the prompt says the defender
   lost all units, instead of actual losses from the dice rolls" — 4 Regulars, 2
   killed, recap said 4). `pc.atkWithdrew` / `pc.defWithdrew` now record figures
   that leave the battlefield alive — by retreat here, or by a **pre-combat
   withdrawal** (*Scouts*), which had the same flaw — and the tally credits them
   back. The same flag keeps an emptied region from being announced as a
   wipe-out, and the outcome line names the retreat ("Shadow retreat — Free
   Peoples take Westemnet") so a captured region plus a loss count no longer
   reads as a massacre. `scripts/probe-retreat-losses.mjs`.

- Modifiers from cards/abilities add to the die result (clamped by the 1-miss/
  6-hit rule). Card **initiative** (bottom number) breaks timing ties; lower
  applied first; equal → defender's first (p.29). A Combat card with **multiple
  different-timing effects has one initiative per effect** — e.g. *Mûmakil* is
  printed "Initiative 3-5" (effect at 3, effect at 5), not a single value
  (p.29). Initiative 0 = resolves first (the *Daring Defiance* cancel cards).

### Fortifications & Cities (p.31)
First combat round only: attacker hits on **6+** (instead of 5+). Then normal.
This applies to a **City or Fortification ONLY** — p.31 gives Strongholds their own
section, and its *Fighting a Field Battle* clause says "a field battle is resolved
**normally** as described before." A Stronghold therefore grants **no to-hit penalty in a
field battle**; its protection is the retreat-into-siege option, and the 6+ that does
apply every round of a *siege battle* is p.32's, keyed on `pc.siege`. `pc.fortified` means
only "this Settlement grants the first-round 6-to-hit" and is set for City/Fortification
alone. (It previously included Stronghold, which wrongly handed the attacker a 6+ round 0
in a Stronghold field battle — and handed the same shield to a **besieger standing in the
open** when a relieving army attacked it.) "Defending in a field battle" combat-card
preconditions key on `!pc.siege`, RAW's actual sense of the term.
Locked down by `scripts/probe-tohit.mjs`, which pins all five cases: City field battle,
Stronghold field battle, siege assault, relief, and sortie.

### Strongholds & sieges (p.31–32)
Attacking a Stronghold: before each combat round defender chooses **field battle**
or **retreat into siege**. Retreating into siege → defenders go to the Stronghold
Box; attacker may advance into the region. **Siege battle**: attacker hits on
**6+**, defender 5+; lasts **one** round unless attacker reduces an Elite→Regular
to extend another round (p.32). Besieged stack max **5** (excess comes under
siege) (p.31). Siege ends if attacker leaves or either side is wiped (p.31).
**Sortie**: besieged army attacks besiegers as a field battle, forfeiting
Stronghold defense (p.32). **Relieving**: an outside army attacks the besiegers
normally; the besieged don't participate (p.32). The besieging player may move
new troops into the (free) region — movement, not attack (p.32).

**Implementation (combat.ts `siege` sub-machine).** When a Stronghold's controller
is attacked and isn't yet besieged, `startBattle` pauses with a `siegeWithdraw`
PendingChoice: **withdraw** sets `region.besieged` and ends the action with no
combat (the assault is a later action); **fight** runs a normal field battle.
Attacking an already-besieged Stronghold is a **siege assault** (`pc.siege`):
attacker hits on 6 every round, the defender cannot retreat, and the assault is
**round-capped** (`siegeRoundsLeft`, default 1) — after the cap the battle ends with
the siege still standing. Capturing (garrison destroyed) clears `besieged` and flips
control; the siege also lifts if the attacker is wiped. On withdrawal the besieger
**advances into the region's open field** (`resolveSiegeWithdraw` `moveStack`s it in,
without capturing — the boxed garrison still holds the Settlement), so an assault has
`from === to`. Extending the assault by reducing an Elite→Regular **is** modelled as a
real choice (`siegeExtend`, offered whenever the attacker still has an Elite).
*Grond* (sh-char-20) / *The Fighting Uruk-hai* (sh-str-02) set `siegeRounds:3` +
`fpCardLock` (FP gets no Combat card in siege round 0 unless a Companion is in the
Stronghold).

**Relieving a siege (p.32) — modelled.** An outside army attacking into a besieged
region fights the besieger in the open as a normal field battle (`startBattle`'s
`assault` needs `from === to`, so a relief attack isn't one); the boxed garrison takes
no part (`defForce` returns the region, not the box). When the besieger is destroyed or
retreats, `finishCombat` lifts the siege (the garrison returns to the field) and then
asks the reliever, via a `relieveAdvance` PendingChoice, whether to march in — p.32
permits the advance only once the besieging Army "is destroyed or retreats," and p.31
makes it optional ("**may** immediately move"). Declining is a real option: the region
is friendly, so there's nothing to capture, and joining the freed garrison can breach
the 10-unit limit (the advance chains into the normal `removeExcess` prompt). The
rearguard is restored to the origin region **after** the advance resolves, so it never
gets swept along (p.28). Covered by `scripts/probe-relief-advance.mjs`.
**Deviation:** RAW advances "all or part" of the Army; this advances all of it, matching
the field battle's advance — partial commitment is available before the battle via the
rearguard split (p.28).

**Sortie (p.32) — modelled.** The besieged garrison spends an Action die for battle and
attacks the besiegers in its own region. Like an assault this is `from === to`, but with
the roles mirrored: the **attacker** is boxed, so `startBattle` distinguishes the two by
who is acting (`armySide(to) !== attacker` ⇒ sortie) and sets `pc.boxed = attacker`.
`atkForce`/`atkCount` read the attacker from the box, the mirror of `defForce`/`defCount`.
It is a **field battle, not a siege battle**: `fortified: false`, so both sides hit on 5+
(p.32), there is no round cap, and the besieging defender may retreat as usual. The
rearguard is split out of, and restored into, the **siege box** — "left behind in the
Stronghold" (p.32). Outcomes:
- besiegers destroyed or retreated → the siege is broken and the garrison returns to the
  open field. A winning sortie "cannot advance outside of the region" — it is already in
  its own region, so nothing further moves;
- the sortie force wiped with the besieger still in the region → **the Stronghold falls**
  (p.32's second capture trigger, read from the defender's side of this battle) — but only
  if no rearguard survives, since p.32 needs *all* its defenders eliminated;
- the attacker ceases → RAW moves the sortie back inside; it never left the box in this
  model, so the siege simply carries on.

Covered by `scripts/probe-sortie.mjs`. The heuristic AI is offered sorties (~300 times per
40 games) but effectively never takes one: measured over those games the garrison is
stronger than the besieger in ~1% of opportunities and never by the 2× margin the AI
requires — sallying out of a Stronghold into a larger army forfeits the 6-to-hit defence
and loses the Settlement outright if the garrison dies. That is a strategic judgement, not
a gap; the path is exercised by the probe and by a sortie-biased random soak.

**Retreating into a siege, every round (p.31) — modelled.** "Before every combat round the
defender must choose to either fight a field battle or retreat into a siege," and an Army
defending a region containing a friendly Stronghold "may retreat into the Stronghold itself
at the beginning of **any** Combat round." The offer is therefore inserted by `combatStep`
ahead of each round's `attackerCard` step (`strongholdWithdrawAvailable`), not once at
battle start, and `pc.siegeWithdrawAsked` latches it **per round** — declining in round 0
does not waive the choice in round 1. Withdrawing mid-battle behaves exactly as it does
pre-battle (garrison to the box, capped at 5; besieger advances into the open field; siege
established; battle over), and `lastBattle` now records the rounds actually fought and both
sides' real losses instead of hard-coded zeros. Correctly withheld where RAW forbids it: a
besieged Army cannot retreat (assault), a sortie is already a siege battle, and the
Stronghold must be the *defender's*. Covered by `scripts/probe-siege-withdraw.mjs`.

**The besieger's advance is the attacker's call (p.31) — modelled.** "The region around
the Stronghold is left open to the enemy, who **may** immediately advance into the region.
**If** the attacking Army chooses to advance, the Stronghold is now considered under siege
and the battle is over." Withdrawing therefore boxes the garrison and pauses on a
`besiegerAdvance` PendingChoice. Advancing establishes the siege as before; **declining**
leaves nobody besieging, so per p.32 ("if no Army units are left behind, the Stronghold is
no longer under siege") the garrison merges straight back onto the open field and the
battle ends with the ground unchanged. The 5-unit garrison cap is applied only once the
advance happens — it bites when a Stronghold "comes under siege", and until then there is
no siege to cap.

**Level-0 Characters are left behind on a retreat (p.31) — modelled.** "If the retreating
Army contains a Character of Level 0, that Character is left behind in the region."
`moveStack` takes a `retreat` flag and filters `levelOf(c) === 0` on the four retreat
paths (pre-combat retreat x2, and the two retreat-destination resolvers), leaving the
besieger's advance unaffected. Level 0 is **Saruman and Gollum**, so this subsumes the
Saruman-specific "never leaves Orthanc" filter on retreats while stating the actual rule
rather than one figure's name.

### Capturing a settlement (p.32)
Captured when an enemy army enters a region with a City / Town / unoccupied
Stronghold, or when all defenders of a besieged Stronghold are eliminated **and the
besieging Army still has at least one unit remaining in the region** (p.32).
Both triggers require a surviving attacker, so a **mutual wipe takes no ground** —
`finishCombat` gates `captured` on `atkSurv > 0` in the field-battle *and* assault
branches, and the siege simply ends (p.31: "a siege ends if … at any time the
attacking or defending Army is completely eliminated"). Covered by
`scripts/probe-mutual-wipe.mjs`, which drives the casualty step directly (random
play effectively never reaches a mutual wipe).
Place Settlement Control marker; advance VP track (+1 City, +2 Stronghold).
Recapture by original owner removes the marker and reverses the VP (p.32, p.44).
Captured settlements can't muster or advance the political track (p.32).

### End of Battle (p.31) — advancing into the region you took
"If the defending Army is eliminated or retreats, the attacker **may** immediately
move **all or part** of the attacking Army into the embattled region" — and the FFG
FAQ confirms the advance itself is always optional. Fully modelled: a field-battle
win raises an `advanceChoice` PendingChoice BEFORE anyone moves. The winner advances
everything, a chosen subset (the split picker), or nothing at all — and the CAPTURE
resolves only when units actually enter (`resolveAdvanceChoice` →
`captureIfEnemySettlement(viaAttack)`), because p.32's capture triggers both require
an Army entering the region. Declining logs "hold position" and captures nothing, so
the battle-end line reports the military result ("defenders destroyed / retreat"),
never a capture it cannot yet know about. The rearguard held aside for the battle
(p.28) is restored to the origin only after the choice resolves, so an advance can
never sweep it along; a subset advance that vacates every FP unit drags the FP
Leaders with it (p.26). The AI advances everything (the old automatic behaviour).
This supersedes the interim hold-back model (advance all, then send figures back,
`holdBackMinimum` guarding captured Settlements): choosing BEFORE entry makes that
guard unnecessary, since a region never entered is never captured. The hold-back
resolver survives only for in-flight saves carrying an `advanceHoldBack` choice.
`scripts/probe-decline-advance.mjs` (including a legacy-resolver check).

---

## 8. Politics (p.34–35)

- **Political track** per nation; bottom step = **At War**. FP nations (except
  Elves) start **Passive**; a **passive** nation can never reach At War — it must
  be **activated** (flipped to Active) first (p.34).
- **Activate an FP nation** when: a region of it is entered by an enemy army; an
  army containing its units is attacked; Fellowship declared in its City/
  Stronghold; or an activating Companion ends movement / enters play in its
  City/Stronghold (p.34).
- **Advance** one step toward At War via a **Muster (Diplomatic)** action or
  events. **Automatic** advance: each time the nation's army is attacked (1/battle)
  *and* its nation becomes active; each time one of its settlements is captured
  (p.34).
- **Non-belligerent** (not At War) restrictions: units may move within/outside
  own borders but **never across another nation's border**; cannot **attack**
  (can defend); cannot be recruited via Muster die. Retreat-from-battle may cross
  a border as an exception (p.35).
- Characters/Minions/Nazgûl are effectively always At War (p.35).

---

## 9. The Fellowship (p.36–39)

- **Ring-bearers** figure marks **last known position**; **Fellowship Progress**
  counter (0–12 on the Fellowship Track) marks distance traveled since, and
  Hidden/Revealed state (p.36).
- **Corruption** 0–12; **12 ⇒ SH wins immediately** (p.36, p.44).
- **Guide**: highest-Level Companion in the Fellowship (FP breaks ties); starts
  Gandalf the Grey. Only the Guide's "Guide:" ability is active. Gollum becomes
  Guide if Ring-bearers are alone (p.37).
- **Moving the Fellowship** (Character die, FP only, or event): advance Progress
  **+1**, stay Hidden, then SH **Hunts** (§10). FP die used to move is placed in
  the **Hunt Box** (returned next turn); event-moves do **not** add the die
  (p.37). Each extra move in a turn makes the Hunt harder (+1 per FP die already
  in the Hunt Box) (p.37, p.41).
- **Declaring** (Fellowship phase, only if Hidden): move Ring-bearers figure ≤
  Progress regions from last known position; reset Progress to 0; stays Hidden
  (p.38). Used to heal / activate / satisfy card location. Declaring keeps the
  Fellowship **Hidden**, so it draws **no** Hunt tile — the "one tile per Shadow
  Stronghold on the traced path" rule fires **only when the Fellowship is
  Revealed** by the Shadow ("This drawing of a Hunt tile is done only if the
  Fellowship is revealed by the Shadow player", p.39), so it lives in the
  `revealMove` handler, not the declare path. The **only** tile drawn on a *declare*
  is the *Balrog of Moria* card's own text ("declared or revealed" through Moria).
  Declaring does **not** end the Fellowship phase: the FP may then change the Guide
  or, if the figure now sits at Morannon/Minas Morgul, **enter Mordor this same
  phase** (p.43: enter Mordor "after fully resolving the declaration"). It is,
  however, **once per turn** — the phase staying open is not a licence to declare
  again. `flags.fellowshipDeclaredThisTurn` (reset in phase 1) drops the
  `declareFellowship` actions after the first and makes a forced repeat throw;
  without it the FP could re-declare in place and heal 1 Corruption *each time*
  (player report 4r4z: five declarations at Dale in one Fellowship phase took
  Corruption from 5 to 0). `scripts/probe-declare-once.mjs`.
- **Revealed** (by successful Hunt or events): flip Progress to Revealed; FP must
  move the Ring-bearers figure (≤ Progress, never ending in an FP City/Stronghold)
  and reset to 0 (p.38). **A Revealed Fellowship cannot be moved** (via Character
  die) until **Hidden** again (p.38).
- **Hiding** (Character die or event): flip to Hidden. Using a Character die to
  hide does **not** also move that action; the die is not added to the Hunt Box
  (p.39). Must be Hidden to move.
- **Healing**: if **declared** in a non-enemy FP City/Stronghold during the
  Fellowship phase, remove 1 Corruption (min 0) (p.39). Once per turn, since the
  declaration itself is: "during the Fellowship phase of **each turn** it is
  possible to declare them in that region and heal one Corruption each time"
  (p.39) — each *turn*, not each declaration.
- **Separating Companions** (Character die; forbidden on Mordor Track): move the
  Companion(s) from the Fellowship Box to the Ring-bearers' region, then move ≤
  (Progress step + Companion Level) regions (group: highest Level) (p.39). Remove
  their cards/counters; appoint new Guide. **Separation is permanent** (p.39).

---

## 10. The Hunt for the Ring (p.40–43)

- **Hunt Pool**: 16 standard beige tiles (values 0–3, some with Eye / Reveal
  icons) + special tiles (blue FP / red SH) that enter only via events. When all
  pool tiles are used, return **standard** tiles only (not specials, not
  permanently-removed) (p.40).
- **Hunt roll** (each time the Fellowship moves): **Hunt Level** = # SH dice in
  the Hunt Box (allocated + Eyes). Roll that many Combat dice (**max 5**); each
  **6** = success; **+1 per FP die already in the Hunt Box** this turn; `1` always
  fails (p.40–41).
- **Re-rolls**: +1 re-rolled die each for: a SH-controlled Stronghold in the
  Ring-bearers' region; ≥1 SH Army unit there; ≥1 Nazgûl there (the conditions
  stack) (p.41). Re-rolls also get the +1 Hunt-box bonus.
- **Hunt damage** (on ≥1 success): draw 1 random tile. Numbered = damage; **Eye**
  = damage equals # successes rolled (0 if drawn for a Stronghold/event reveal,
  not a roll); **Reveal** icon ⇒ Fellowship revealed after other effects; negative
  special = subtract from Corruption (min 0); Die-icon special = roll a die for
  damage (p.40–42).
- **Resolving a successful Hunt** in order (p.41–42): (1) FP may use one "Play on
  the Table" event to cancel/reduce; (2) FP may use the Guide's ability; (3)
  remaining damage → FP may **take a casualty** (lose one Companion) to reduce
  damage by the eliminated Companion's Level, else (4) damage → **Corruption**.
  Excess over the casualty's Level still goes to Corruption; can't "wound" — a
  taken Companion is fully eliminated even if Level > damage (p.42).
- **Taking a casualty**: FP eliminates one Companion — FP chooses to lose the
  Guide or a **random** Companion (SH draws a face-down counter) (p.42).
  **Exactly ONE per Hunt.** p.42 says "he must eliminate one Companion" and that
  "any excess damage must still be taken as Corruption", so a second casualty is not
  a legal way to soak the remainder. The `huntDamage` choice carries a `casualty` flag
  once one has been spent: the casualty options drop out of `legalActions` and the
  engine refuses the action outright. Reduction *abilities* stay available after a
  casualty, because p.42 also allows a newly appointed Guide's ability to "be used
  immediately, if applicable". *(Player report: one tile ate Legolas, Gimli and
  Meriadoc.)* `scripts/probe-hunt-casualty-mordor.mjs`.
- **Multiple tiles** (Stronghold path + Balrog card etc.): resolve the
  reveal-causing tile fully first, then event tiles, then the Stronghold tile
  (p.41).

---

## 11. Entering Mordor & the Mordor Track (p.43)

- When the Fellowship is in **Morannon** or **Minas Morgul** during a Fellowship
  phase, FP **may** enter Mordor: Ring-bearers go to step **0** of the Mordor
  Track; Progress counter no longer advances on the Fellowship Track but still
  shows Hidden/Revealed. Rebuild a fresh Hunt Pool (Eye tiles drawn + specials in
  play; not permanently-removed) (p.43). *(2nd-ed: no longer requires declaring/
  being Hidden to enter — p.3.)*
- On the Mordor Track, **moving** the Fellowship draws a tile directly (no Hunt
  roll): Eye damage = # Hunt-Box dice; advance one Mordor step **unless** a Stop
  icon (then stay). Must still be **Hidden** to advance; if Revealed, hide first
  (p.43).
  Eye damage counts the Shadow dice in the box **plus Free Peoples dice "previously
  used for moving the Fellowship during the same turn"** — the die paying for *this*
  move is placed in the box only after the Hunt resolves (p.41, whose +1 example counts
  only earlier moves), so it never counts towards its own draw. There is **no 5-cap**
  here: that cap is on *rolled* Hunt dice (p.41) and in Mordor nothing is rolled.
  *(Player reports: "5 dice in the box dealt 6 damage"; "an Eye for 3 damage although
  there were only 2 dice in the box" — and, earlier, "2 Shadow + 1 FP die dealt 2".)*
  `scripts/probe-hunt-casualty-mordor.mjs`.
- If FP does **not** attempt to move/hide on the Mordor Track during Action
  Resolution, **+1 Corruption** automatically (p.43).
- Companions can **never** separate on the Mordor Track; anything that would
  separate eliminates instead (p.43).
- Completing all 5 Mordor steps reaches the **Crack of Doom** → FP wins (if
  Corruption < 12) (p.43, p.44). The step **draws its tile first**: the track
  advances, then that tile's damage is assigned (a real FP choice — Corruption or a
  Companion casualty), and only then is victory checked. A tile that takes the
  Ring-bearers to 12 on that very step wins the game for the **Shadow** (condition
  1 beats condition 2, §13). The engine therefore holds the Ring-victory check
  while a Hunt-resolution choice is open; declaring the win the instant the track
  hit step 5 stranded the damage prompt behind the game-over screen (player report)
  and could never lose to that 12th Corruption. Regression-tested in
  `scripts/probe-mordor-final-step.mjs`.

---

## 12. Corruption summary (p.42–43)

Added by: using the Ring vs Hunt damage; certain events. Removed by: healing in
a friendly City/Stronghold; certain abilities/events. **12 ⇒ SH wins
immediately** (p.43).

---

## 13. Victory (p.44)

Lower-numbered condition wins ties. Checked-immediately (Ring) conditions
override the end-of-turn (Military) ones.

1. **Ring — Corruption (SH):** Ring-bearers reach 12 Corruption ⇒ SH wins
   *immediately*.
2. **Ring — Destroy (FP):** Ring-bearers on Crack of Doom with <12 Corruption ⇒
   FP wins *immediately*.
3. **Military — Shadow:** at Victory Check, SH controls FP settlements worth
   **≥10 VP** ⇒ SH wins.
4. **Military — Free Peoples:** at Victory Check, FP controls SH settlements
   worth **≥4 VP** ⇒ FP wins.

VP from control: enemy City = 1, enemy Stronghold = 2 (p.44). The SH military
threshold is higher (10) because SH is the aggressor; conditions 3/4 only fire in
phase 6.

The tie rule is p.44 verbatim — "lower-numbered Victory conditions take precedence
over higher-numbered Victory conditions, if two or more are achieved on the same
turn" — so when **both** military thresholds are met at the same Victory Check the
**Shadow** takes it (condition 3 beats condition 4). `checkMilitaryVictory` tests
the two in that order for exactly this reason; do not reorder them. It once read the
other way and handed those games to the FP (player report: Shadow reached 11 VP the
turn the FP reached 4 and still lost). Regression-tested in
`scripts/probe-stacking-leaders-victory.mjs`.

---

## 14. Engine-deviation log

Our policy (CLAUDE.md): **prompt for every genuine player choice.** Only
*mechanical* steps with no decision are auto-resolved, deterministically under
the seeded `Rng`. Each deviation is listed here, next to its rule.

| # | Rule (page) | Printed behavior | Engine behavior | Why |
|---|---|---|---|---|
| D1 | Hunt tile draw (p.40) | Physically draw a random tile from an opaque cup | `Rng.draw` from the modeled Hunt Pool | Mechanical randomness; no choice. Pool contents are exact. |
| D2 | Event deck shuffle (p.14 step 8) | Physically shuffle | `Rng.shuffle` at setup / on (rare) reshuffle | Mechanical; deterministic under seed. |
| D3 | Random Companion casualty (p.42) | SH draws a face-down Companion counter | `Rng.pick` over the eligible Companion set | Mechanical when FP *chooses* "random" — FP still chooses guide-vs-random (a real prompt). |
| D4 | Combat/Hunt dice (p.30, p.41) | Roll physical d6 | `Rng.rollDie` | Mechanical. |
| D5 | Battle resolution (p.29-32) | Interactive: combat-card play each round, casualty selection, cease/retreat | `combat.ts` is an INTERACTIVE sub-machine: **combat-card play EVERY round** (each side, a real 'combatCard' PendingChoice gated by the card's **"Play if…" precondition** — `combatPrecondMet` covers the modelled cards' precondition patterns; `combatCards.ts` maps ~30 combat titles to roll/re-roll/max-dice/extra-attack/extra-hit/cancel/negate mods), casualty selection, cease/continue, and retreat are all real prompts. **Cancels are now initiative-aware** (`cardInitiative`: a cancel removes the enemy card only if it resolves first — attacker needs strictly lower initiative, defender wins ties), and **Mûmakil** is modelled with both of its effects (rollBonus at init 3 + a `bonusHitIfOutscore` hit at init 5). **Forfeit-Leadership and elimination effects are now modelled:** *Mighty Attack* forfeits a Companion's Leadership (`ownLeadershipPenalty`) to turn a miss into a `guaranteedHit`; *Blade of Westernesse* spends a hit to `eliminateMinion`; *Fateful Strike* `eliminateNazgulIfHit` (Nazgûl → reinforcements); *Heroic Death* `sacrificeLeaderToCancelHit`. **Pre-combat timing cards are modelled in initiative order** (`resolvePreCombat`, lower-first/defender-ties): *Scouts* (`retreatBeforeCombat`) retreats the FP defender before the roll; *Durin's Bane* (`preCombatAttackDice`: 3 dice, hits on 4+) rolls a special attack first — reproducing the rulebook's own example (Scouts@1 resolves before Durin's Bane@2, so the FP army escapes). **All combat-card effect classes are now modelled.** **Words of Power** (sh-char-15/18/23) cancels one enemy Companion's Leadership (`enemyLeadershipPenalty`) and Captain-of-the-West die bonus (`enemyCaptainCancel`) for the round; **Black Breath** (sh-char-08b/12) — on a scoring round — additionally eliminates the highest-Level enemy Companion whose Level ≤ the round's hits, else one FP Leader (`blackBreath`, auto-targeted in the owner's favour like the other combat-card eliminations; the "re-roll specifically scored" condition is approximated by "the round scored ≥1 hit"). **Combat-roll vs Leader re-roll bonuses are now distinguished** (player report): the cards name the two rolls separately, so `rollBonus` applies ONLY to the Combat roll and `rerollBonus` ONLY to the Leader re-roll — *Valour*/*Servant of the Secret Fire*/*Devilry of Orthanc*/*Ents Rage*/*Cruel as Death*/*Relentless Assault*/*Mumakil* are Combat-roll-only, *They Are Terrible* is re-roll-only, *It Is a Gift*/*One for the Dark Lord* are both; enemy to-hit penalties (*Advantageous Position*, *Confusion*) likewise hit the Combat roll only. **"Both Armies" cards are symmetric** (`symmetricBonus`): *Deadly Strife* (+2) and *Desperate Battle* (+1) now lift BOTH sides rolls, not just the owners. **Stated Leadership forfeits are charged:** *Cruel as Death* costs 2 Nazgul Leadership, *They Are Terrible* 1, and *Dread and Despair* is modelled as its real effect — forfeit 1 Nazgul Leadership so the enemy rolls one fewer **Combat die** (min 1), not a worse to-hit. **Variable-size effects — two fixed, three still open.** *Andúril* now scales with the figure present: Strider forfeits Leadership 1 to convert one missed die, Aragorn forfeits 2 to convert up to two (no prompt needed — forfeiting Aragorn costs his full Leadership either way, so converting two is never worse). *Foul Stench* is now the CONDITION its text states — the FP Leader re-roll is cancelled only when Nazgûl Leadership >= total FP Leadership, evaluated at roll time from both Forces; it used to fire unconditionally. Both covered by `scripts/probe-combat-card-costs.mjs`. **Variable-cost cards are now paid for (`combatCardCost` PendingChoice).** A card whose size the owner chooses declares a `VariableCost` (kind / timing / cap / min) and the sub-machine stops to collect it: a `cardCost` step before the roll, and an `onslaught` step after casualties for the one card paid then. Until it is answered the card grants NOTHING, so an unanswered prompt can never leak the old free effect; the amount is stored per round (`atkCardCost`/`defCardCost`, cleared with the round's cards). Offers are capped by what the payer actually has — self-hits never exceed units-minus-one (no self-annihilation mid-round), a Leadership forfeit never exceeds the Leadership held — and a side with nothing to spend is charged 0 rather than shown a dead option. *Relentless Assault*: up to 2 self-inflicted hits, +1 to the Combat roll per hit. *Dread and Despair*: forfeit **one or more** Nazgûl Leadership (0 is clamped up to 1 — the card is not optional once played); the FP rolls one fewer Combat die per point, min 1. *Onslaught*: up to 4 self-inflicted hits **after** casualties, then one die per hit scoring on **4+** (not the 5+ the old flat `extraAttackDice` used). **Deviation:** the casualty allocation for the self-hits and for Onslaught's counter-attack auto-resolves Regulars-first, matching the other card-driven eliminations. Covered by `scripts/probe-combat-card-costs.mjs`. **Residual simplifications:** the initiative-ordered pipeline is implemented for the timing cards specifically (other effects are commutative mods, so order is immaterial); the defender now **chooses the retreat destination** when more than one free adjacent region exists (`retreatTo` choice; a single destination still auto-resolves). Truly-minor residuals: playing *Mighty Attack* commits its `guaranteedHit` (the card text gives no separate decline); pre-combat-attack casualties auto-resolve (no casualty prompt); a 15-round safety backstop (set far above any real battle's length — it only guarantees the sub-machine can't loop forever, never cuts a genuine fight short); unrecognized combat-card preconditions default to playable (all modelled cards' preconditions ARE handled). | D5 essentially closed — only the listed residual simplifications remain. |
| D6 | Hunt damage (p.41-42) | FP chooses casualty vs Corruption; re-roll conditions | Now INTERACTIVE: `hunt.ts` prompts FP (PendingChoice 'huntDamage') to absorb as Corruption or lose the Guide / a random Companion (excess → Corruption); Guide reassigns (Gollum if none). Re-roll conditions (Shadow Stronghold / Army / Nazgûl in the region) modelled. **Guide Hunt abilities are now applied** as `huntDamage` options: Meriadoc/Peregrin may separate to reduce damage −1 (`reduceSeparate`, via separateCompanion — Guide reassigns); Gollum suppresses a numbered tile's Reveal (passive) and may reveal to reduce damage −1 (`reduceReveal`); reductions re-prompt until absorbed. (Adding these FP defenses moved the heuristic soak toward balance — FP wins 101→137 of 300 — exactly the skew-closes-by-fidelity dynamic.) **On-table damage-REDUCTION cards are wired** (`reduceCard`): *Axe and Bow* (Gimli/Legolas) and *Horn of Gondor* (Boromir) play on the table via their `onTable` handlers, then may be discarded during the Hunt for −1 damage. **Special Hunt tiles now enter the pool on Mordor:** the 8 special-tile Event cards (fp-char-01–04, sh-char-01–04) put a tile `specialsInPlay`; `enterMordor` moves them to `specialsInPool`; `drawTile` draws across the standard + special pools (reshuffling both via `specialsDrawn`). FP tiles (Phial −2, Sméagol −1) heal, Shadow tiles (Shelob's Lair, The Ring is Mine!, etc.) add damage/stop. **With this, the heuristic soak is essentially balanced — FP 153 / Shadow 147 of 300** (from 102/198 before the Hunt-fidelity work — the skew closed by faithfulness, not tuning). **The draw-intercepting on-table cards are wired** via a small resumable flow: *Wizard's Staff* (Gandalf-grey) prompts a BLIND `huntPreventDraw` before the tile (discard to skip the draw entirely); *Mithril Coat and Sting* prompts `huntRedraw` after the tile is seen (discard to return it to the pool and draw a second). **D6 is fully closed** — every Hunt-damage / Guide / on-table / special-tile rule is now modelled. **Every −1 reduction now logs itself** with its running total, and the closing line states the Corruption actually taken: a long Hunt (redraw → Companion casualty → Guide ability) used to end on a bare "corruption N" that mentioned neither Gollum's reveal nor the Hobbit-Guide separation, so the player could not check the arithmetic. *(Player report 2o5h0p0s: "the log made no mention of Gollum's ability".)* | — closed. |

| D7 | Event-card *riders* (the secondary "you may also…" clauses) | Optional follow-on moves / free card plays | Now modelled, except one sliver | **Rage of the Dunlendings** (sh-str-11): recruits 2 Isengard, then the player may move **up to 4 Isengard units** there from N/S Dunland (interactive `targets`/`repeat`). **The Ents Awake** (fp-char-19/20/21): if Gandalf the White is in Fangorn or a Rohan region, the FP may play **one Character Event without an Action die** (`fpFreeCharEventThisTurn` flag, consumed by the next FP Character-Event play — a slight timing relaxation from "immediately" to "as the next action"). **There Is Another Way** (fp-char-10): heals 1, then (Gollum as Guide) offers a real choice — **hide** (if revealed), **move** (if hidden, following normal movement rules), or **decline**. The *move* triggers a full Hunt: it runs via a new handler `finalize` hook that fires AFTER the card is discarded and the turn passed, so the Hunt's follow-up `huntDamage` choice survives the eventTarget cleanup instead of being clobbered. **D7 fully closed.** |

| D8 | Muster die recruiting (p.26) | One Muster die buys 2 Regulars / 2 Leaders·Nazgûl / 1 Regular + 1 Leader·Nazgûl / 1 Elite, and **the two figures of any two-figure muster go to separate Settlements** | **Fully modelled (RAW).** The first figure is placed, then a `musterSecond` choice places the second in a **different** Settlement (or declines for the lesser single muster); the two figures may belong to **different Nations**. The Shadow's "Leader/Nazgûl" figure musters a **Nazgûl into a free Sauron Stronghold** (`recruitNazgul`). | — closed (was a same-Settlement / no-Nazgûl-muster simplification; now RAW). |
| D9 | Army movement (p.27–28) | One Army die moves up to **2 different** armies one region each; a moving army may **split** (leave a rearguard) | **Fully modelled (RAW).** An Army die moves a first army, then an `armyMove2` choice may move a **second, different** army with the same die (a Character die still moves only one). **Splitting** is supported: `moveArmySplit` + the `move` selection on `moveArmy`/`armyMove2` move only chosen units/Leaders/Nazgûl/Characters, enforcing ≥1 unit, the stacking/siege cap, the not-At-War border rule, "FP Leaders can't be stranded with no units," and "a Character-die split must take ≥1 Leader/Character." The UI exposes splitting via a per-move picker (move whole army or a portion). | — closed. The heuristic AI now **uses the optional second move** (`chooseArmyMove2`, when a different army makes progress) and **garrison-splits** (`maybeSplitGarrison`: leaves a one-unit garrison when vacating a threatened VP Settlement). *(Fixing this surfaced a real RAW bug — `moveArmySplit`'s Character-die leader requirement omitted Nazgûl, wrongly rejecting a Shadow Nazgûl-stack split; now fixed.)* AI still attacks with its whole At-War force (no voluntary attack-rearguard — that would weaken the attack); the mandatory not-At-War rearguard is always enforced. |
| D11 | Splitting an attacking Army (p.28) | The attacker may split into an attacking Army and a **rearguard** that takes no part (each needs ≥1 unit); not-At-War figures **must** stay in the rearguard; a Character-die attack's attacking force needs ≥1 Leader/Character | **Fully modelled (RAW).** `attack` takes an optional `rearguard` selection; `startBattle` holds it aside from the origin region for the battle and `finishCombat` restores it there (it never advances). `attackError` enforces ≥1 attacking unit, the "rearguard needs ≥1 unit" rule, and the Character-die Leader/Character requirement; **not-At-War units are auto-forced into the rearguard** (`fullRearguard`). The UI exposes it via the same picker in "attack" mode (unselected figures become the rearguard). **A Character die may also initiate an attack** with one army that has a Leader/Nazgûl/Character (offered in `legalActions`, spends the Character die), mirroring the Character-die move. | — closed. AI attacks with its whole At-War force (doesn't voluntarily split) — AI-strength, not a rules gap. |
| D10 | Besieged Stronghold limits (p.31–32) | Garrison in the siege box capped at 5 units (Leaders unlimited); can't muster into a besieged Settlement | **Fully modelled (RAW).** When a Stronghold comes under siege the garrison is capped at **5 Army units** — excess removed (Regulars first) and recycled to reinforcements (`enforceSiegeCap`, `SIEGE_LIMIT`). Mustering into a besieged Stronghold is blocked for Muster-die recruits (`recruit()` checks `besieged`), while Event-card recruits may (p.27). Reinforcing a siege by movement is capped at 5 in `canMoveArmy`. | — closed. |

| D12 | Fellowship revealed by the Hunt (p.39) | On reveal, the FP moves the figure up to Progress regions (its choice; never ending in an FP City/Stronghold), resets Progress, flips to Revealed; **+1 Hunt tile per Shadow Stronghold the traced path crosses** | **Fully modelled (RAW).** On reveal `beginReveal` raises a `revealMove` choice; the **FP picks the destination on the board** (within Progress, never an FP-controlled City/Stronghold), the figure moves there, Progress resets, Revealed. **A Hunt tile is drawn per Shadow Stronghold on the traced path** (`extraHunt`), restoring the cost of revealing through Moria/Mordor. Minor residuals: Gollum's reduce-damage *reveal* reveals in place (no figure-move); and if one Stronghold's tile opens an FP damage choice, any further Strongholds' tiles defer (same as declaration). | — closed. (AI routes toward Morannon and can eat avoidable Stronghold Hunts — an AI-strength gap, not a rules one; a human picks the path.) |

| D13 | "Move any or all Companions/Nazgûl" cards | Move separated Companions / Nazgûl freely, then a conditional effect | **Companion-move cards fully modelled.** *Book of Mazarbul* (fp-str-04) and *Fear! Fire! Foes!* (fp-str-07): the FP moves any/all separated Companions — interactively (pick a Companion, board-click its destination, repeat, or move none) — then if a Companion is in Erebor/Ered Luin (resp. The Shire/Bree) the Dwarves (resp. North) are roused to War (`moveCompanionsCard`, with a not-At-War-guarded rouse checked before AND after the moves). *(This also fixed a real bug: fp-str-04 previously roused the Dwarves UNCONDITIONALLY, skipping the "if a Companion is in Erebor/Ered Luin" check.)* **Nazgûl-reveal cards now fully modelled too.** *Nazgûl Search* (sh-char-09) and *The Nazgûl Strike!* (sh-char-08b): the Shadow moves any or all of the Nazgûl — interactively (pick a Nazgûl group's region, board-click its destination with FLY range, repeat across groups, or move none) — then if at least one Nazgûl shares the Fellowship's region the conditional effect fires: sh-char-09 reveals the Fellowship; sh-char-08b rolls an extra Hunt (`moveNazgulCard`, with the conditional run once in `finalize`). **Both Nazgûl cards are gated ONLY on their printed condition** — "Play if the Fellowship is on step 1 or higher on the Fellowship Track" — plus a Nazgûl existing to move. The reveal/Hunt half is an EFFECT, not a requirement (p.22: effects are "applied to the maximum extent possible"), so the very common play of using either card purely to REPOSITION the Nazgûl is legal. *(Player report 3i1v1v: they were additionally gated on a Nazgûl being able to reach the Fellowship — and, for sh-char-09, on the Fellowship being Hidden — which blocked that play entirely.)* **And sh-char-09's reveal is a real reveal:** it calls `beginReveal`, so the FP must move the figure up to its Progress and the Progress resets to 0 (p.39), exactly like a Hunt reveal — the choice survives because `finalize` runs after the eventTarget resolver clears the card's own pending choice. *(Player report 3k733e: the Fellowship stayed put with its Progress intact.)* `scripts/probe-play-via.mjs`. **sh-char-08b's printed choice is now offered** — "discard one FP Character Event card from the table or roll for the Hunt" raises a real `nazgulStrike` choice for the Shadow whenever both branches are live (no FP Character table card → the Hunt fires directly, so it is never a one-answer question). `scripts/probe-nazgul-strike.mjs`. **"Any or ALL of the Nazgûl" now means a SUBSET of a stack on every card.** *The Ringwraiths Are Abroad* (sh-char-23) and *The Black Captain Commands* (sh-char-24) build their own target lists and still flew the whole stack, while the Character die and the `moveNazgulCard` cards had long asked "how many?"; the same figures thus obeyed two different rules depending on how you moved them. `nazgulFlyTargets` now fans a Nazgûl group out to one target per count on all four cards (the Witch-king is one figure, so no count). *(Player report 0j1x6h3r: "Played Ringwraiths are Abroad … It didn't let me choose how many of them to move.")* **And the "or MOVE" branch of the separation cards is modelled.** *Gwaihir the Windlord* (fp-char-15) and *We Prove the Swifter* (fp-char-16) print "Separate from the Fellowship, **or move**, one Companion or one group of Companions" — that second branch used to be waved off as "folded into the Character-die move", which is wrong on three counts: it costs an **Event** die instead of a Character die, it carries the card's range bonus (Level-as-4 / +2 regions), and with an **empty Fellowship it is the only playable branch at all**. `separateViaCard({ mapMove: true })` now offers on-map Companions as picks tagged with their region (`from`); same-region Companions may join the travelling group (range = the highest Level, p.24) and `finalize` routes the `from`-tagged branch through `moveCompanionGroup`. *I Will Go Alone* (fp-char-11) and *There and Back Again* (fp-char-17) print no such clause and stay separate-only. `scripts/probe-companion-card-move.mjs`. *(Player report 4964174f: "T8: Wanted to spend [E] to play Gwaihir, but was not allowed" — five Companions on the map, none in the Fellowship.)* | Fully closed — D13's last residual (the discard branch) landed with John's call D. |

| D15 | Splitting an Army moved by an **Event card** (p.28, "Using an Event Card to Move Armies": "it is possible to split the Army before moving") | The player may define the moving Army as a subset before a card-driven move | **Modelled (RAW).** The `eventTarget` action carries an optional `move` MoveSelection; every card mover (Shadows Gather, The Shadow Lengthens, The Shadow is Moving, Corsairs of Umbar's move branch, Paths of the Woses, Through a Day and a Night, Nazgûl-led moves) passes it to `moveAllUnits`, whose split half (`moveSelectedUnits`) applies a **sanitized** subset: own-side Nations/figures only, clamped to what's present, never Saruman, FP Leaders never stranded unitless, and a Nazgûl-led split keeps ≥1 Nazgûl with the movers. A selection that clamps to zero units degrades to the whole-army move. The UI routes card-move picks through the same split picker as normal moves (whole army remains the default). Player report 5i0w4b0 asked for this. `scripts/probe-card-move-split.mjs`. **Residuals:** target enumeration still requires the WHOLE army to fit the destination's stacking limit (a destination only a subset could legally join isn't offered); card ATTACKS take the whole force (no card-attack rearguard); the AI always moves the whole stack (an AI-strength gap, not a rules one). | — closed, with the listed residuals. |
| D14 | Casualties inflicted by **direct-damage Event cards** (p.30 casualty rule) | The **owner** of the losing units chooses each removal: eliminate 1 Regular **or** reduce 1 Elite to a Regular | **Interactive for the cards resolved in a single `apply` step** — the owner gets a real `eventCasualties` choice (now allocated ONE HIT AT A TIME — see §7 step 4) whenever a genuine choice remains, exactly like combat casualties (`queueOrApplyEventCasualties` / `resolveCasualtyStep`). **Return to Valinor** (sh-str-01, FP Elves), **The Ents Awake** (fp-char-19/20/21, Orthanc — Nazgûl/Minions eliminated with the Army in the follow-up), and **Dreadful Spells** (sh-char-19, FP Army) are covered. **Residual:** three cards that inflict casualties from **inside the interactive target-selection machine** — **Dead Men of Dunharrow** (fp-char-11/…), **Faramir's Rangers** (fp-str-06), and **The Spirit of Mordor** (fp-str-05) — still auto-resolve **Regulars-first** (via the legacy batch-plan `applyCasualties`), because the `eventTarget` resolver clears the pending choice on completion (deferring mid-target would need the same `pendingCombat`-style hand-off attacks use). The absorption order only matters when the target army holds both Regulars and Elites and survives; the auto-choice matches the standard "keep the Elites" heuristic. | Mostly closed; the 3 target-machine cards, and **Return to Valinor**'s multi-region spread, remain on the batch plan (documented Regulars-first / one-plan-for-all auto-resolution). |
| D15 | **Besieged Armies as Event-card targets** (p.31; Almanac "Dreadful Spells" C 19 / "The Ents Awake") | A besieged Army is still **in its region** — only its units sit in the Stronghold Box. Cards that do not say "attack" may therefore be played against it. If such a card eliminates the whole garrison, the Army standing in the region **captures the Stronghold immediately**; Companions/Minions inside are **unaffected** (it is not an attack) and end up in the region | **Fully modelled (RAW).** `armyForceOf(state, region, side)` returns the side's open-field Army **or** its boxed garrison, and every "is there an Army of X here?" event predicate reads it (`fpArmyNearNazgul`, and so **Dreadful Spells** sh-char-19 + **The Eagles are Coming!** fp-char-18 — either end may be the boxed force, per the Almanac's "the Nazgûl do not need to be with the besieging Army"). `queueOrApplyEventCasualties` routes the hits to that same Force (`boxed` on the `eventCasualties` choice) so a card aimed at a garrison can never wound the **besieger**. Dreadful Spells lifts the box's Characters aside before the hits land and a `siegeFall` `CasualtyThen` puts them back — into the box if the garrison held, into the region (with the Stronghold captured, no attack-activation) if it fell. `scripts/probe-dreadful-spells-siege.mjs` covers it. **Deviation from "prompt for every choice":** the card names no Nazgûl force, so when several qualify for the chosen victim the engine takes the **fullest** stack — more Nazgûl is strictly more dice at a target the player already picked, so there is no decision to make. **WHICH Free Peoples Army is hit is now a real `eventTarget` prompt** (it used to be whichever qualifying Army came first in region order — a besieger at Minas Tirith could find itself hitting Lórien). | — closed (player report, 2026-08-15: "Minas Tirith under siege … wanted to use [E] to play Dreadful Spells, but it won't let me"). |

*(Add rows here as implementation surfaces more. Genuine choices — casualty
removal selection, retreat decisions, combat-card play, declaring/revealing,
guide changes, separations, die allocation — remain real prompts and are NOT
listed here.)*

---

## 15. Open questions for the Reference rulebook / FAQ pass

To resolve against `WOTR001-Rulebook-Reference-EN-web.pdf` and
`WOTR001-FAQ_V1.2-EN-web.pdf` before/while coding the affected handler:
- Exact per-region adjacency + each region's nation/settlement type (transcribe
  the map; the Reference sheet may have a region list).
- Exact political-track box layout per nation (start positions, step counts).
- Per-card Event/Combat text (mined from `assets/asset-urls.json` + Reference).
- Character-card exact abilities (Levels, Guide vs out-of-Fellowship abilities,
  activatable nation, leadership, action-die bonus).
- Special Hunt tile exact values/icons and which events introduce them.
- Edge cases: simultaneous combat-card timing, multi-Stronghold reveal ordering,
  "Will of the West"/Elven-Ring interaction corner cases (FAQ).
