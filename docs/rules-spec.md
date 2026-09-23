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
  **Drúadan Forest IS a Gondor region** (no Settlement) — Almanac, *Boromir*: "the
  Gondor region … can be a Settlement or in a region without a Settlement icon (i.e.,
  Drúadan Forest, Erech, or Anfalas)". The map data had it neutral, letting a
  not-At-War Rohan Army walk in. Player report 4h564p406i0b6l11 (2026-09-16); probe:
  `probe-rules-batch-0916`.
- **Reveal destinations** (p.39): the revealed Fellowship's move "can never end in a
  region containing a Free Peoples Stronghold or City controlled by the Free Peoples"
  — a Settlement of a *Free Peoples Nation* that is uncaptured (Almanac: "an
  unconquered Free Peoples City or Stronghold"). A Shadow Stronghold the Free Peoples
  have captured (Moria) is not one, so the Fellowship may end there. Player report
  51605i2q17082f2s; `probe-rules-batch-0916`.
- **Stormcrow** (sh-str-06): when the Fellowship/Companions stand in more than one
  qualifying Nation, the Shadow player chooses (Almanac); the Free Peoples then choose
  the Leader or unit lost. **Book of Mazarbul / Fear! Fire! Foes! / There and Back
  Again** rouse or advance a Nation only from an uncaptured trigger region (Almanac:
  no activation "if the Companion ends movement at a captured … region"). Player
  reports 2r3060480g063o5c, 3a3e73174f1m1s4b; `probe-rules-batch-0916`.
- **Settlements**: Town, City, Stronghold. **Fortifications**: Osgiliath, Fords
  of Isen (p.10–11). City = 1 VP to the opponent if captured; Stronghold = 2 VP
  (p.11, p.44).
- **Settlement control**: starts with the region's nation. Captured → opponent's
  Settlement Control marker (p.32). "Unconquered" = controlled by original owner
  (p.11). A **Fortification is never captured and never carries a control marker** —
  it is not a Settlement (p.10), so it is worth no VP and nothing flips when an enemy
  Army walks in. `captureIfEnemySettlement` used to stamp one on Osgiliath / Fords of
  Isen anyway, which drew a control diamond on the map over two regions that cannot be
  controlled (player report 1c0k225r21493a52, 2026-09-10). The map now draws no
  settlement marker on a Fortification at all. `probe-nazgul-muster-and-fortifications`.
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

### The Witch-king is a Nazgûl on event cards (2026-08-31)

FAQ: the Witch-king counts as a Nazgûl for every event-card reference unless the
card differentiates with the "Minion" title. **Dreadful Spells** now counts him
toward its dice (and he alone can enable it), capped at the card's printed max
of 5 — a player counting his own figures caught the short roll. **Residual:**
*The Eagles are Coming!* still uses the figure-only count; extending the FAQ
reading there would let the Eagles ELIMINATE the Witch-king (permanently — he
never re-musters), a materially bigger ruling left unchanged pending its own
verification.

### Printed discard clauses missing from the transcription (2026-08-24)

The TTS-mod card transcription (`assets/event-cards.json`) omits the italic
discard clauses on two on-table Shadow cards; both were found by a player with
the physical cards and confirmed against card scans / BGG:

- **Wormtongue (sh-char-22):** "You must discard this card from the table as soon
  as Rohan is activated, or if Saruman is eliminated." Modelled in
  `TABLE_CONDITIONS` — the card now holds only while Saruman is in play AND Rohan
  is still passive.
- **Worn with Sorrow and Toil (sh-char-15):** "discard this card from the table if
  the Fellowship is declared in a City or Stronghold controlled by the Free
  Peoples." Event-triggered in `declareFellowship` (the same branch as the
  rest-heal, which tests exactly that condition), not a prune condition — the
  trigger is the declare itself.

- **Threats and Promises (sh-str-05):** "You must discard this card from the table
  as soon as a Free Peoples Nation advances on the Political Track either due to an
  attack or due to a Companion's special ability." Present in the transcription but
  never wired, so the card sat on the table through the very attacks it was meant to
  end *(player report, 2026-08-28: "Threats and Promises can't be discarded" — the
  Shadow attacked Rivendell, the Elves advanced, and the card stayed)*. Now
  event-triggered inside `advancePolitical`, which takes a `trigger` argument
  (`viaAttack` from `onArmyAttacked` — and from there alone, since a **capture** is not
  an attack: a battle capture is preceded by the attack that already advanced the Nation
  and discarded the card, while a walk-in occupation of an undefended Settlement never
  was an attack; `viaCompanion` from the adapter's `companionMuster` action). An Event card that advances a Nation is neither
  of the named routes and does **not** discard it.

Covered by `scripts/probe-table-discards.mjs` and
`scripts/probe-siege-recruit-and-card-clauses.mjs`.

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
  undefended Edoras/Helm's Deep, is *not* an attack and does not rouse Rohan.
  **`viaAttack` lives only on the attack itself** (`onArmyAttacked`, fired from
  `startBattle`): a **capture** never carries it, because an attack is what *starts* a
  battle and is orthogonal to who ends up holding the Settlement — by the time the winner
  advances in, the attack has already fired its own political reaction and taken
  Wormtongue off the table *(player report 6d1g1o4l2d4r0a3q, 2026-09-20)*. The one case
  the capture flag had been covering by accident is now handled where it belongs: the
  card's attack exception names the **region**, so a Shadow attack on Edoras/Helm's Deep
  rouses Rohan even when the Army defending there holds no Rohan units
  (`wormtongueRousedByAttackAt`, persistent.ts; activation only — Rohan's own Army was
  not attacked, so its track does not advance).
  `scripts/probe-capture-not-attack.mjs`.
  Wormtongue's third exception — "the Fellowship being declared in Edoras or Helm's Deep" —
  is live: `declareFellowship` activates with `viaDeclare`, which the card lets through at
  exactly those two regions, and rousing Rohan then discards the card by its own printed
  clause. (Until 2026-09-20 this engine did not activate a Nation on a declare at all, so
  the exception was moot; report 1y222s09436d5q0z.) Worn with Sorrow's "you may" is
  auto-applied (always to the Shadow's benefit).
- **FP force-discard of a Shadow table card** (`persistent.ts` `fpForceDiscardMethods`,
  adapter `forceDiscardCard`): two Shadow "play on the table" cards let the FP player
  spend an action to discard them — *The Palantír of Orthanc* (sh-char-21: a Will of the
  West die, OR any Action die + one Elven Ring) and *Denethor's Folly* (sh-str-03: a Will
  of the West die, OR any Action die if Gandalf or Aragorn is in Minas Tirith). The die
  spent IS the action (p.22); the Elven Ring flips FP→Shadow and counts against the
  one-Ring-per-turn limit (p.21). **Deviation:** a Will of the West *is* "any Action
  die result", so RAW it could pay the second clause too — but each card already has a
  Will clause, so that buys the identical discard for a strictly higher price (an
  Elven Ring on top, for the Palantír). The second clause is therefore offered only
  when a **non-Will** die can pay it, and its die-picker leaves the Will die out; the
  engine refuses a Will die there as well, so the list and the rule agree. A dominated
  duplicate is not a genuine player choice (player report 2r1d613t4d3l6631);
  `scripts/probe-rules-batch-0917.mjs`. All other table cards discard only on a ceased
  play condition (`pruneTableCards`), never by an opponent's action.
- **Handlers** (`handlers/index.ts`, all 96/96 implemented): each registered card
  applies its effect; unimplemented cards aren't offered. **Interactive cards**
  (those whose effect needs a player-chosen target) use an `EventHandler.targets`/
  `applyTarget` pair: playing pauses with an `eventTarget` PendingChoice, the
  player picks from the enumerated targets, then the effect applies (e.g.
  *Cruel Weather* = move the Fellowship to an adjacent region; *Corsairs of Umbar*;
  *Shadows Gather*). Minor approximations are noted per card (Corsairs' "coastal"
  set).
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
  Settlement (p.10). For those four Hunt-condition cards, "a **Free Peoples**
  Settlement" means one belonging to a Free Peoples **Nation**, not one the Free Peoples
  currently controls: the Almanac says the restriction "applies even if the Settlement
  has been captured by the Shadow player (the remnant of that captured Settlement offers
  the Fellowship some ability to hide from effects like this)", and conversely "a
  captured Shadow Stronghold offers no protection from this card as it is not a Free
  Peoples Settlement". `fellowshipInFpSettlement` reads `sideOfNation(REGIONS[loc].nation)`;
  it used to read the control marker, which got both halves backwards *(player report,
  2026-08-28: "Candles of Corpses can't be played while the fellowship are in a
  settlement")*.
  "Play if"/"Play on the table if" preconditions gate play (`canPlay`) for *The Last
  Battle*, *Denethor's Folly*, and *The Palantír of Orthanc* like every other
  precondition card — previously they could be played with the condition unmet and
  `pruneTableCards` discarded them for no effect on the next transition (two player
  reports: the FP AI wasted The Last Battle; a player wasted the Palantír before
  mustering Saruman).
  A card with **no printed "Play if" line** is a different case: p.23 says the actions
  on an Event card are mandatory, but "it can happen that the effects of an Event card
  cannot be fully applied. In this case, the card can still be played, and its effects
  are applied to the maximum extent possible" (the *Imrahil of Dol Amroth* example: no
  Leader in reinforcements → only the unit is recruited). So `canPlay` for such a card
  gates on **any** half of the text being applicable, not all of it. *Faramir's Rangers*
  (fp-str-06) is the worked case: it used to require a Shadow Army in Osgiliath / N. or
  S. Ithilien, which locked it out of the opening position entirely, but the Almanac
  says it "may be used if no Shadow Army is in North Ithilien or South Ithilien just to
  perform the final recruitment action, but only if a Free Peoples Army is currently
  standing in Osgiliath" — so it is now playable for either half, and the target machine
  skips straight to the Osgiliath recruit when there is nothing to shoot at *(player
  report, 2026-09-03: "Faramir's Rangers can be played without a shadow army in
  Ithilien")*. That recruit is **one Gondor unit AND one Gondor Leader** per the card
  text; the Leader (no choice to make, and not subject to stacking) rides along in
  `finalize`, or in `apply` when the unit half has no legal target at all.
  Regression: `scripts/probe-faramir-rangers.mjs`.
  **The whole "Then, …" family reviewed as one** *(player report 476n3s6q0c1i2c2w,
  2026-09-20: "some cards have a construction where there is a separate clause
  independent of the first")*. The rule is the OR of the clauses, never the AND. Six of
  the nine the reporter listed were already right — *Faramir's Rangers* (fp-str-06),
  *Book of Mazarbul* (fp-str-04) and *Fear! Fire! Foes!* (fp-str-07, both via
  `moveCompanionsCard`'s `… || rousing`), *The Red Arrow* (fp-str-09, `Rohan can advance
  || Edoras recruitable`), *I Will Go Alone* (fp-char-11, whose printed "Play if at
  least one Companion is in the Fellowship" **is** the first clause) and *Stormcrow*
  (sh-str-06, whose forced FP loss survives a Nation already at the top of the track).
  Three were not:
  - ***There Is Another Way*** (fp-char-10) had no `canPlay` at all, so it could be spent
    on nothing whatever: no Corruption to heal and no Gollum guiding. Now
    `corruption > 0 || isGollumGuide`.
  - ***The Grey Company*** (fp-char-24) demanded an upgradeable Regular on top of its
    printed "Play if Strider/Aragorn is with a Free Peoples Army", although "Then, draw
    two Strategy Event cards" is reason enough on its own (the Almanac says exactly that
    of *King Brand's Men*'s draw). Now the printed condition alone.
  - ***There and Back Again*** (fp-char-17) could only be played to separate somebody,
    yet its rouse reads where Gimli and Legolas **are**, not where the card put them —
    so with one of them already standing in an uncaptured Dale / Erebor / Woodland Realm
    it is playable with an empty Fellowship. `separateViaCard` grew an `always` hook
    (the independent clause, run exactly once on **every** exit from `finalize`,
    including the fizzle paths — which is also what stops the rouse double-advancing the
    track when the card's own move is what lands Gimli in Erebor) and an `extraPlay`
    hook (that clause as its own reason to play).
  `scripts/probe-then-clause-play.mjs`.
  **The pure heals join them** *(player report 0k6e6n2c6m6g153q, 2026-09-22)*.
  ***Athelas*** (fp-char-09) and ***Bilbo's Song*** (fp-char-12) are nothing but a heal,
  so at zero Corruption they spend an Action die and the card to remove nothing — Athelas
  even rolls three dice to do it. Both now need `corruption > 0`, the same strengthening
  *There Is Another Way* already carried.
  ***The Ents Awake*** (fp-char-19/20/21) is the other shape of the same problem
  *(player report 0o183f33230m5g4v)*: its printed condition ("Gandalf the White is in play
  and a Companion is in Fangorn") can be met with nothing for the Ents to do. It needs one
  of its three live clauses — a Shadow Army in Orthanc (field **or** siege box) to hit,
  Saruman in Orthanc to eliminate (the lone-Saruman play stays legal, report 4u10), or the
  free Character card its last clause grants, which in turn needs Gandalf the White in
  Fangorn or a Rohan region **and** another Character card in hand to spend it on.
  `scripts/probe-card-play-conditions.mjs`.
  **Not an exception:** a "null effect" card is *not* made playable by Gandalf the Grey
  guiding. Drawing through his ability costs the same Event die as the "Draw an Event
  card" action and additionally spends the card, so it is strictly worse — there is no
  play to protect.
  **A recruitment card with nothing to recruit is still playable for the rest of its
  text.** Almanac, "Points common to all Free Peoples recruitment cards": "These cards
  may still be played if recruitment is impossible (e.g., if the required Settlement has
  been captured or if no units are left in reinforcements); just follow the other
  instructions on the card in that case (such as the card draw for *King Brand's Men*)."
  So `recruitChoiceCard`'s default `canPlay` also passes on a placeable Leader or on the
  card's `then`/`apply` rider, and *King Brand's Men* (fp-str-19) no longer gates on Dale
  being free — it just skips the recruit and draws. Two supporting fixes came with it:
  `playEvent` now runs `finalize` when a card resolves with **no targets at all** (that
  path used to drop the rider silently, which is why *Faramir's Rangers* had to place its
  Leader from `apply`), and the Leader half of `recruitChoiceCard` goes through
  `recruitable` so it can't be smuggled into an enemy-captured Settlement. A besieged
  Stronghold's five-unit cap (p.31) binds ARMY UNITS only, so a full garrison still takes
  Imrahil's Gondor Leader. *(Player report 550r3w1c6s3v3b28 — Kindred of Glorfindel stuck
  in hand with Rivendell besieged and the Elven reinforcements empty; the besieged half of
  that rule was already right.)* Regression:
  `scripts/probe-shadowfax-and-recruit-riders.mjs`.
  **Multi-target cards** (`EventHandler.repeat = N`, e.g. *The Shadow Lengthens* = 2,
  *The Shadow is Moving* = 4) re-prompt the same `eventTarget` choice up to N times:
  the choice persists (`data.left`/`data.applied`), `targets(state, side, applied)`
  recomputes the legal set each step (excluding a just-moved Army via `applied`), and
  a synthetic `{done:true}` option lets the player stop early once ≥1 target is applied
  (cards read "up to"). The card is held out of hand until the loop ends, then discarded.
  **Recruitment is not "up to".** A card that says "Recruit …" recruits to the maximum
  extent possible, and the Almanac is explicit that "choosing to partially recruit,
  leaving one unit behind in reinforcements is not permitted when playing an Event
  card". Those handlers set `noDone` (the named-region helper `recruitChoiceCard`,
  *Many Kings to the Service of Mordor*, *Pits of Mordor*, and *Faramir's Rangers*'
  "Then … recruit"; `placeChoiceCard` already did), and their `targets` offer only
  picks that place something, so the loop ends by itself when reinforcements or room
  run out. *Pits of Mordor* places one Regular where only one fits or remains, instead
  of refusing the pair. Cards that print "up to" or "may" keep `done` — *Rage of the
  Dunlendings*' follow-up moves. *Hill-trolls* prints "Replace **two**" (Card Text
  Reference), not "up to", so it has no Done either and ends when no Sauron Regular or
  reinforcement Elite is left; a besieged garrison's Regulars count *(player reports
  3b156u441e4m3i6a, 3n4q1b5m6n5y4d2g)*. A **Muster Action die** may still
  recruit partially (Almanac), so its second-recruit step keeps its Done *(player
  report 4f0y2f2r4k315b68; John, 2026-09-14: follow the rules)*.
  Regression: `scripts/probe-event-recruit-no-done.mjs`.

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
  onward. **The besieged-Stronghold seal is enforced on both halves.** p.24 gives a
  Companion (and, p.25, the Mouth of Sauron) a second Stronghold rule beside the
  enemy-Stronghold one: "they can never leave or enter a region containing a
  **friendly** Stronghold besieged by an enemy Army". Only the enemy half was coded,
  so a Companion could walk into a Minas Tirith the Shadow was besieging — landing in
  the open field, which in this siege model belongs to the *besieger*. `canLand` now
  refuses that landing (Character-die move, group move and separation alike; the
  garrison already lives in the siege box, so the "leave" half needed no code), the
  **Nazgûl stay exempt** (p.25: the FP-Stronghold rule is "the only restriction" on
  their flight), and the exception the two cards print — *Gwaihir the Windlord* /
  *We Prove the Swifter*, "this movement is allowed to end in a Stronghold under
  siege" — rides in as `RangeOpts.siegeOk`. A Companion separating **inside** an
  already-besieged Stronghold simply stays there (he may not leave either), so the
  origin region is always a legal destination. `scripts/probe-nazgul-to-siege.mjs`.
  *(Found while checking a player report that a Nazgûl could not join an Army
  conducting a siege — that flight is legal and was, and still is, offered.)*
  No residual — character movement is now fully RAW.
- **Where a figure STANDS in a besieged region (`figureForce`) — fixed 2026-09-14.** A
  player report put the principle exactly right: *"figures inside a Stronghold under
  siege are in fact in the region containing the Stronghold for all observable purposes.
  The distinction of figures being inside or outside the Stronghold does not necessarily
  make so much sense, except for … visually displaying those figures."* Our model splits
  a besieged region in two — garrison in `region.siegeBox`, besieger in the open field —
  and every site that reached past that split straight to `region.characters` /
  `region.nazgul` picked the wrong force. Symptoms, all reported: a Nazgûl flying into a
  besieged Orthanc landed with the **FP besiegers**; Saruman mustered there "joined the
  Free Peoples Army"; the **Witch-king** could not enter at all (his "Shadow Army with a
  Sauron unit" condition read the field, which is the enemy's); *Gwaihir* / *We Prove the
  Swifter* dropped Companions into the besieger's arms; Companions separating inside did
  the same; and boxed figures were invisible to every enumerator, which grounded the
  Nazgûl who ARE free to fly out (p.25: the FP-Stronghold rule is "the only restriction"
  on their flight). `armies.ts` now exports **`figureForce(state, id, side)`** — the box
  when `side` is the one under siege there, else the open field — and it is the single
  seam for placing or finding a figure. (It differs from `armyForceOf`, which answers
  "does `side` have an ARMY here?" and returns null when it has none: a lone Character
  entering a friendly Stronghold whose garrison is down to zero units still belongs
  inside. Which side is boxed is decided by the box's units, falling back to the
  Stronghold's controller — p.33, the garrison keeps control while the besieger holds
  the field.) Minion entry (`minions.ts`) reads `armyForceOf` for the Witch-king's
  condition and places through `figureForce`; separation (`placeSeparatedCompanion` /
  `placeSeparatedGroup` / Gandalf the White) and both halves of the Character-die move
  place through it too.
  **Consequence: the "may never LEAVE" half now needs stating outright.** p.24/p.25 seal
  a Companion (and the Mouth of Sauron) both ways — "they can never leave or enter a
  region containing a **friendly** Stronghold besieged by an enemy Army" — and we used
  to get LEAVE for free, because a boxed figure was invisible and so unpickable. That
  accident is gone, so `canLeave` states the rule, `movablePieces` drops a sealed figure
  from the offer entirely, and `characterDestinations` returns an empty set for one
  (a player reported the modal lighting up destinations for a Gandalf boxed in Moria and
  then silently refusing the move). Nazgûl and the Witch-king are exempt; the Mouth is
  not. Gwaihir / *We Prove the Swifter*'s `siegeOk` is an ENTER exception only — the card
  says "allowed to **end** in a Stronghold under siege" — so it does not unseal leaving.
  The board draws boxed Characters below the region anchor in the same dashed-gold ring
  the boxed army badges wear; they used to render nowhere at all.
  **Shadowfax reads the travelling party, not the region left behind.** Gandalf the
  White "can move up to 4 regions if he is alone or accompanied by only one Hobbit
  Companion" — "accompanied" is about who rides WITH him. `rangeOf` used to count every
  Companion standing in his origin region, so a Gandalf setting out alone from a region
  that also held Boromir and Legolas was capped at his printed Level 3 *(player report
  0s3m315p1k6m6d3u)*. The moving group now travels in `RangeOpts.group` (defaulting to
  the figure on its own), so `moveCompanionGroup`, the board's destination highlighting
  and the card-driven group moves all measure the same company. Regression:
  `scripts/probe-shadowfax-and-recruit-riders.mjs`.
  **Gandalf the White may enter a BESIEGED Elven Stronghold.** His card says "place
  Gandalf the White in Fangorn or in an **unconquered** Elven Stronghold" — unconquered,
  not "free of enemy units", and a besieged Stronghold is still unconquered (p.33: the
  garrison keeps control until it is actually captured). `gandalfWhiteCandidates` carried
  an extra `armySide !== 'shadow'` test the card never prints, and since a besieged
  region's open field holds the BESIEGER it fired on exactly the case the card allows —
  the White could not come to the aid of a besieged Lórien. A Shadow Army can only stand
  in an unconquered Elven Stronghold's region by besieging it, so dropping the test lets
  nothing else in. (Aragorn's crowning was already right: his card's test is likewise
  "that Settlement is unconquered".)
  `scripts/probe-siege-figure-force.mjs`.
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
beyond available figures. Nazgûl recruit only in Sauron Strongholds **and only once
Sauron is At War** — p.26's At-War gate covers every recruited figure, and a Nazgûl is
a Sauron Leader. `recruit()` had the gate; `canRecruitNazgul` was missing it, so a
Muster die could fly in a Nazgûl on turn 1 (player report 1f2q456i4h3b470x,
2026-09-10: "While Nazgûl aren't beholden to Diplomacy rules like Free Peoples
Leaders, they still require the Sauron Nation to be At War"). Nazgûl remain exempt
from the FP-Leaders-need-units rule, which names Free Peoples Leaders only.
`probe-nazgul-muster-and-fortifications`. Event cards may recruit even in
not-yet-At-War nations or besieged Strongholds (card-specific) (p.27).
**A Muster action does as much as it can.** p.27's *Imrahil* example ("its effects are
applied to the maximum extent possible") is the general shape, and the Almanac applies
it to **The Voice of Saruman** by name — "if any of North Dunland, or South Dunland are
captured when this ability is used, do not recruit into the captured region(s)". Its
*upgrade* half ("replace two Isengard Regulars in Orthanc with two Elites") used to need
two Regulars **and** two spare Elites before it was offered at all; it now needs one of
each and replaces as many as it can, like the recruit half already did (player report
476j5r1l0m093n25, `scripts/probe-rules-batch-0917b.mjs`). The ability still requires
Saruman in play and an unbesieged, Shadow-held Orthanc (Almanac).

#### Event-card recruits at a besieged Stronghold (p.28, p.33)

Rulebook p.28 ("Using an Event card to recruit troops") allows the recruit "even if
… the region includes a Stronghold under siege", and p.33 adds that during a siege the
region "is considered free for the besieging player, while the Stronghold itself
remain[s] controlled by the player under siege". Our siege model keeps the **besieger**
in `region.units` and the **garrison** in `region.siegeBox`, so a single region holds
two stacks with two different limits. `eventRecruitTarget(state, region, side)` picks
the one that belongs to the recruiting side and reports its cap — the box at
`SIEGE_LIMIT` 5 (p.31), the open field at `STACKING_LIMIT` 10 — and `recruitable`,
`placeUnits`, `placeForce`, `recruitChoiceCard` and `placeChoiceCard` all route through
it. Before this, every one of those read the open field for both sides, so **Imrahil of
Dol Amroth** and **Celeborn's Galadhrim** were unplayable while their own Stronghold was
besieged and **Olog-hai** could not reinforce a siege *(three player reports,
2026-08-27/29)*. "A region where a Shadow Army is present" (Olog-hai / Half-orcs) and
"a coastal region containing a Free Peoples Army" (Círdan's Ships) now read
`armyForceOf`, so a boxed garrison counts as an Army present, per the Almanac ("It is
possible for the Free Peoples to recruit by a card at a Stronghold both when a Shadow
Army is inside a Stronghold that is besieged by a Free Peoples Army, or when a Free
Peoples Army is under siege inside a Stronghold"). Riders of Théoden likewise looks for
its Companion inside the box.

**Éomer, Son of Éomund (fp-str-23) is the Almanac's named exception** — its printed text
requires a *free* region, so a besieged Free Peoples garrison may **not** recruit with
it (it may still recruit into a Stronghold its own Army is besieging).

**Deviation:** the Almanac lets a garrison over-recruit past five and then choose which
units to put back ("first, fully perform the recruitment … and then remove units (from
any Nation in that Stronghold)"), which can be used to trade a Regular for an Elite. The
engine simply caps the recruit at five rather than raising a remove-which-unit prompt.

Covered by `scripts/probe-siege-recruit-and-card-clauses.mjs`.

### Movement (p.27–28)
- **Army die**: move up to **2 different** armies one region each (can't move the
  same army twice). **Character die**: move **1** army that contains ≥1
  Leader/Character.
- **Impassable borders are the adjacency list's silence.** The printed map draws the
  mountain walls and coastlines as black bars; this port has no such data — a border
  is crossable iff the two regions appear in each other's `adjacency` (assets/map.json,
  extracted from the rulebook map, which is the authority). Nothing on screen said so,
  so a player could not tell a wall from a border until they picked up a unit and saw
  the legal destinations light up *(player report, 2026-09-06: "The default map doesn't
  show impassable borders, making it hard to plan your moves until after you have
  selected a unit for moving")*. **Hovering any region now rings its true neighbours**
  (`Board.tsx`, dashed cyan; the hovered region in white), so a region that touches the
  hovered one but stays unringed is across an impassable border. Drawn as one overlay
  above the region groups so it can never repaint or hide a functional move-highlight,
  and skipped for regions that already carry one. Deliberately *not* the geometric
  approach (stroking the shared polygon edge of two touching-but-not-adjacent regions):
  only 158 of the map's 1113 polygon vertices are shared exactly, so the polygons are
  not a shared-edge topology and the bars would have to be inferred with a distance
  tolerance.
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
   **Leadership itself is uncapped** — p.28: "Leadership determines the maximum number of
   dice that may be rolled in the Leader re-roll, up to a maximum of five dice." The cap
   applies to the re-roll only, after every forfeit and penalty (`forceLeadership` used to
   cap at 5, so Leadership 6 minus Gandalf the White's forfeited point re-rolled 4 —
   player report 3m0d0h6u2b0v5c0k).
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
   (player report). **Where the Regular comes from (p.30, 2026-09-16):** "the Regular
   unit can be taken from the previous casualties (if any). Otherwise … from the
   available reinforcements, if able. … If no Regular units are available in either
   … the Elite unit cannot be replaced and is eliminated without further effect." The
   FP casualty pile is not a field — FP figures leave the game no other way, so
   `fpRegularCasualties` derives it as (setup board + setup pool) − (board + siege
   boxes + stashed rearguard + pool). Shadow casualties ARE the reinforcements. With
   no Regular anywhere the Elite is simply eliminated (it used to conjure a Regular),
   which is also the "remove an Elite outright" way to press a siege.
   `scripts/probe-leadership-activation-hunt-cards.mjs`, `scripts/probe-figure-conservation.mjs`.
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
   **"Free region" is the strict sense, not "free for the purposes of Army
   movement."** A region is free for a player when it holds **no enemy Army *and* no
   enemy-controlled Settlement**; an enemy Stronghold is nonetheless free for the
   player whose Army besieges it (p.10). Army *movement* has the looser licence — it
   may enter an empty enemy Settlement — and retreats were sharing that test, so an
   empty enemy-held Town was offered as somewhere to fall back to *(player report
   5u4q1y0m5o1y6l4m: Westemnet, a Shadow-controlled Rohan Town)*. `freeRegion()` in
   `armies.ts` is the strict test and `freeAdjacentRegions()` (every retreat, the
   pre-combat *Scouts* retreat included — the Almanac's own examples "apply to the
   'Scouts' Combat card") now uses it. `scripts/probe-retreat-and-gollum.mjs`.
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
  A card that resolves AFTER a pre-combat retreat never resolves at all: *Scouts*
  (initiative 1) takes the Free Peoples Army out of the battle before anybody
  rolls, so a slower card is revealed and discarded but grants nothing **and
  costs nothing** (`outrunByPreCombatRetreat`). This used to be true of the
  effects but not of the *cost*: the `cardCost` step runs before the pre-combat
  pipeline, so *Dread and Despair* (initiative 3) was sized, announced and applied
  ahead of *Scouts* — player report, 2026-09-06: "Scouts resolves at initiative 1
  … thus the Shadow player doesn't get a chance to resolve the effects of their
  Combat card. That's the expected behavior, but now Dread and Despair resolved
  first." `scripts/probe-siege-destination-and-initiative.mjs`.

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

**Shadow army-movement cards into a besieged region (p.33) — fixed.** *Shadows
Gather* and *The Shadow Lengthens* end "in a region already occupied by another
Shadow Army (that must not be under siege)". The engine's siege model puts the
GARRISON in `siegeBox` and leaves the BESIEGER in the region's open field, and
`armySide` reads the open field only — so a Shadow Army these cards can see in a
besieged region is always the one doing the besieging (a legal destination, exactly
as `moveBlockReason` already allows for a plain Army move under the same 10-unit
field limit), while a Shadow Army genuinely under siege never appears as a source or
a destination at all. Both handlers tested `regions[to].besieged`, which banned
precisely the legal case and could never catch the illegal one *(player report,
2026-09-06: "I cannot use it to move an army from Moria to Lorien. I have an army in
Lorien besieging the elves. I am not under siege myself, so it should be legal")*.
The test is gone, and `moveAllUnits` now calls `liftSiegeIfAbandoned` on the SOURCE
so a card that marches a besieger out ends the siege on the spot rather than waiting
for `advance()`'s sweep. `scripts/probe-siege-destination-and-initiative.mjs`.

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
  A Companion moving **with an Army** ends his movement as well, so every Army-move path
  (die moves and splits, card-driven moves, the post-battle advance) runs
  `activateOnCompanionLand` too (player report 420q1y1h5p0l1q6s: Strider marched an Army
  into The Shire and the North stayed passive). Retreats do not — a retreat is not a move.
  The "**or enters play**" half is easy to lose, because the two Companions it applies
  to arrive by a Will of the West die rather than by moving. `bringUpgrade` now runs the
  same `activateOnCompanionLand` check the movement paths use: **crowning Aragorn**
  activates the Nation of the City/Stronghold he is crowned in — always Gondor, since
  Minas Tirith / Dol Amroth / Pelargir are the only legal spots (Almanac: "If Gondor is
  not activated, it will be activated when Aragorn is brought into play") — and
  **Gandalf the White** arriving in an Elven Stronghold rouses the Elves. Strider
  cannot do this ("He cannot activate Gondor … until after he is crowned"), so the
  crowning is the moment it has to fire, and it never did *(player report, 2026-08-27:
  "Aragorn does not activate Gondor")*.
  `scripts/probe-siege-recruit-and-card-clauses.mjs`.
- **Advance** one step toward At War via a **Muster (Diplomatic)** action or
  events. **Automatic** advance: each time the nation's army is attacked (1/battle)
  *and* its nation becomes active; each time one of its settlements is captured
  (p.34).
- **Non-belligerent** (not At War) restrictions: units may move within/outside
  own borders but **never across another nation's border**; cannot **attack**
  (can defend); cannot be recruited via Muster die. Retreat-from-battle may cross
  a border as an exception (p.35).
- Characters/Minions/Nazgûl are effectively always At War (p.35).
- **A MIXED stack is not frozen — the At-War half moves and the rest stays.** p.27 lets
  a player move "all or some of the units" of an Army, so a Nation that cannot cross a
  border only pins *its own* figures, never the Army around them. The destination
  enumerator asked the **strict** question (`moveBlockReason`, which speaks for the whole
  stack), so a mixed Army was offered **no destination at all** across a foreign border:
  an Elven/North Army in Vale of the Carnen with the North still on the track could not
  be moved into East Rhûn, and the only hint told the player to "split off only its
  At-War units" — which the move interface cannot be asked for until a destination has
  been picked *(player report 615m5q0t090g205d)*. The offer is the **permissive** question
  now (`canMoveSomeArmy`/`partialMoveBlockReason`, `armies.ts`), matching what the ranged
  card-move enumerators already do; a bare whole-army move takes exactly the figures
  allowed across, logs which Nation stayed and why, and the picker hides the barred
  Nations' units instead of letting a player tick figures that would be left behind. A
  selection that names a barred Nation is still refused, and a stack with **no** At-War
  Nation still has nowhere to go. `scripts/probe-partial-at-war-move.mjs`.
- **Open: Free Peoples Leaders are not yet per-Nation.** A Leader figure belongs to a
  Nation and is bound by the same diplomatic restrictions as its units, so an Army whose
  Elves are At War and whose North is not should send the Elven Leader and hold the North
  Leader back *(player report 154q2f5e406s6g32)*. The engine models a region's Leaders as
  a bare count (`leaders: number`), so it cannot tell them apart: every Leader currently
  travels with the movers. Closing this means giving Leaders a Nation everywhere they are
  stored (region, siege box, rearguard) and is a schema change.

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
  is the *Balrog of Moria* card's own text ("declared or revealed" through Moria) —
  and since that text names **both**, the Balrog is asked on the **reveal** path too,
  not just the declare path (player report 3m4a0q4l643g1s2s). **Standing still in
  Moria counts as well**, though the card's own text doesn't say so: the Almanac adds
  "or remains stationary in Moria" to *both* halves and spells it out — "although
  'remains stationary' is not mentioned, it also meets the condition … e.g. if the
  Fellowship is standing in Moria and a card like 'Orc Patrol' causes the Fellowship
  to reveal there", and "if the Ring-bearers figure is standing in Moria, the Free
  Peoples player may choose to declare there … allowing the Shadow player to use the
  in play 'Balrog of Moria' card" (player report 120x4a0f6n4k4m14). The traced path
  always starts where the Fellowship stood, so a zero-step declare or reveal at Moria
  still fires; the zero-**Progress** reveal never reaches the placement step at all
  (nothing to place), so `beginReveal` raises the card itself. **Standing still in a
  Shadow-held Shadow Stronghold owes its tile on a reveal too** — p.39 lists "moves
  through, moves from, moves into, **or remains stationary in**" — so the zero-Progress
  reveal draws it in `beginReveal` (behind the Balrog when both apply), matching the
  `revealMove` path, whose traced path already starts at the old position (player
  report 4y720k5x4n5t4755; an earlier note here said standing still owed nothing —
  wrong). On a reveal
  the Balrog is asked **before**
  the Stronghold tiles and carries them with it (they draw once it is answered),
  because the first tile that opens an FP damage choice drops the draws behind it
  (D12) — and Moria is itself a Shadow Stronghold, so asking the tiles first would
  have swallowed the card's one-shot in exactly the case it exists for.
  `scripts/probe-rules-batch-0917.mjs`.
  Declaring does **not** end the Fellowship phase: the FP may then change the Guide
  or, if the figure now sits at Morannon/Minas Morgul, **enter Mordor this same
  phase** (p.43: enter Mordor "after fully resolving the declaration"). It is,
  however, **once per turn** — the phase staying open is not a licence to declare
  again. `flags.fellowshipDeclaredThisTurn` (reset in phase 1) drops the
  `declareFellowship` actions after the first and makes a forced repeat throw;
  without it the FP could re-declare in place and heal 1 Corruption *each time*
  (player report 4r4z: five declarations at Dale in one Fellowship phase took
  Corruption from 5 to 0). `scripts/probe-declare-once.mjs`.
- **A declare ACTIVATES the Nation.** "If the Fellowship is declared in a City or
  Stronghold of a Free Peoples Nation, that Nation is activated ... and the Ring-bearers
  may be healed" (p.19), listed again among the activation triggers on p.34. The Almanac's
  declare walkthrough (Ring-bearers entry) ties the two to the *same* condition: an
  **unconquered** FP City/Stronghold grants heal **and** activation, a conquered one grants
  neither — so `declareFellowship` activates inside the existing heal branch
  (`fellowship.ts`). Activation only; a declare never *advances* the Political Track.
  The activation is tagged `viaDeclare` so Wormtongue can honour its own exception (see
  the persistent-card section). Until 2026-09-20 the engine skipped the activation
  entirely — player report 1y222s09436d5q0z. `scripts/probe-declare-activates.mjs`.
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
- **"Take Them Alive!" (Meriadoc / Peregrin)**: "If he is eliminated while in the
  Fellowship, immediately place him in play again as if he was just separated from
  the Fellowship. This special ability cannot be used if the Fellowship is on the
  Mordor Track." It applies to **every** elimination from the Fellowship, and the
  Hunt is where the Hobbits are actually spent — but the Hunt kept its own local copy
  of the casualty code (to avoid a `fellowship`↔`hunt` import cycle) and that copy
  removed them from the game. Both paths now set `flags.takenAlive`, and the Hobbit
  still absorbs his Level in damage: the ability replaces the *elimination*, not the
  casualty. Where he lands is the FP's choice, so it is the ordinary `separateMove`
  prompt — origin and range (**Progress + Level**) are frozen at the instant of the
  casualty, because a Reveal later in the same Hunt resets Progress to 0, and the
  prompt is raised by `advance()` once the Hunt (and any Reveal move) has finished
  resolving. The prompt carries `solo`, so no other Companion may leave with him.
  On the Mordor Track the ability is off and he is eliminated as normal.
  *(Player report 506t, 2026-08-25: "I sacrificed a random and got Pippin (-1)…
  he should have been placed on the board as tho separated… Instead he was
  eliminated.")* `scripts/probe-ents-and-take-them-alive.mjs`.
- **Multiple tiles** (Stronghold path + Balrog card etc.): resolve the
  reveal-causing tile fully first, then event tiles, then the Stronghold tile
  (p.41).
- **The reveal is the LAST step of a tile, and the Guide who is standing there then is
  the one who acts.** The Almanac's Hunt order is: (1) an on-table protection card,
  (2) the Guide's abilities *then* an optional casualty — "if this results in a new
  Guide, then repeat this step with the new Guide's abilities", (3) any remaining
  damage as Corruption, (4) "Reveal the Fellowship if required. If Gollum is the Guide,
  he may ignore a 'reveal' icon but only on standard numbered tiles." Two consequences
  the engine now honours:
  - **Gollum's ignore-the-icon is evaluated at step 4, not when the tile is drawn.**
    Sacrificing the last Companion mid-Hunt makes Gollum the Guide, and his ignore then
    applies to the tile already on the table — the Almanac's own worked example.
    *(Player report l61v0rpyl8vhrpcl: "when sacrificing guide, the next guide ability
    should be active. This works with the Hobbits, but not Gollum's ignore-reveal.")*
    The `huntDamage` choice carries the tile's **reveal icon** and whether it was a
    numbered tile, and re-asks the question at every step instead of carrying a decided
    `reveal` flag. Eye tiles and red Shadow Special tiles always reveal.
  - **Gollum's reveal-to-reduce is a FULL reveal**, applied at step 4 like any other:
    the FP moves the Ring-bearers up to their Progress (never into an FP-controlled
    City/Stronghold) and Progress resets to 0 (p.39). It used to flip `hidden` in place
    — the figure never moved and the Progress was never spent *(player report
    484g5d6e162t361o)*. The Almanac confirms the movement is part of it: Gollum "cannot
    use his ability to reveal the Fellowship in Lórien … due to the restriction on
    revealing into an unconquered Free Peoples City or Stronghold", a restriction that
    only bites on the reveal *move*. Being his own reveal, his ignore cannot cancel it,
    and he cannot spend it twice. `scripts/probe-retreat-and-gollum.mjs`.

---

## 11. Entering Mordor & the Mordor Track (p.43)

- **Gorgoroth, Barad-dûr and Nurn are ordinary regions for the Ring-bearers'
  figure.** The Mordor Track's circles sit on top of Gorgoroth but "the Mordor Track
  is not considered a part of the Gorgoroth region" (p.44) — the Track is orthogonal
  to the map, and nothing in the rules bars the figure from those three regions. We
  used to exclude all three from every declaration and reveal, on the theory that a
  figure standing inside Mordor was stranded off the Track (report 681l). It is not:
  Gorgoroth is adjacent to both entrances, so the figure can always walk back out to
  Morannon or Minas Morgul and enter Mordor from there. Pointless to go there, but
  legal, and it matters for Free Peoples military play *(player report
  6v2x723i4d2d6t12)*. `scripts/probe-retreat-and-gollum.mjs`.
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
- **Log wording:** the move logs "Fellowship moves on the Mordor Track" and the step
  is named only after the tile is drawn ("advances to Mordor step N", or "is stopped
  — still on Mordor step N" for a Stop tile). The step number is not knowable before
  the draw, and printing it beforehand named the step being *left*: the first move in
  Mordor read "step 0" while the track, the Hunt Box and the status area all showed 1
  *(player report, 2026-08-20)*. `scripts/probe-mordor-final-step.mjs`.
- Companions can **never** separate on the Mordor Track; anything that would
  separate eliminates instead (p.43). The rule names special abilities and Event cards
  explicitly ("either as a result of using Action dice or **as the effect of special
  abilities or Event cards**"), so both still *work* on the Track — they just remove the
  Companion from the game (`removeCompanionOnMordorTrack`) instead of placing him:
  - **Separation Event cards** (I Will Go Alone fp-char-11, Gwaihir fp-char-15, We Prove
    the Swifter fp-char-16, There and Back Again fp-char-17) are playable on the Track,
    and so is the Shadow's **The Breaking of the Fellowship** (sh-char-14): the FP still
    picks which Companions leave, and each is removed from play instead of placed
    *(player report, 2026-09-08; `scripts/probe-breaking-on-mordor-track.mjs`)*.
    The card has no destination step there, so the player picks who leaves and stops;
    the card's own effect still happens — the Almanac on "I Will Go Alone": "This card
    may be played on the Mordor Track, but separating Companions from the Fellowship
    here simply removes them from play (**but the Corruption healing takes effect**)",
    and on Gwaihir: "sometimes done to bring Gollum into play for his Guide abilities".
    Stopping with **nobody** picked is not offered — the separation is what the card
    costs. *(Player report, 2026-08-26: "I wanted to use [E] to play 'i will go alone'
    but it won't let me; probably because i'm in mordor and AI thinks I can't separate
    companions there.")*
  - **The Hobbit Guide's damage reduction** likewise works on the Track. Routing the
    player to a Companion casualty instead is *not* equivalent: only **one** casualty is
    allowed per Hunt (p.42) while Guide separations chain (Almanac: "the Free Peoples
    player decides to separate the Hobbit who is Guide to reduce damage by 1, and then,
    as the remaining Hobbit becomes the Guide, he can separate also"). *(Player report,
    2026-08-28: "You can seperate the 2 Hobbits in a row and negate 2 damage if they are
    guides. This works also even if you kill off a level 2 companion.")*
  - **"Take Them Alive!" is the exception** — its own card text bars it on the Track, so
    a Hobbit taken as a *casualty* there is still eliminated outright.
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

### Card clauses corrected from player reports (2026-09-23)

- **"The Last Battle" (fp-str-01)** — the printed card carries a discard clause the
  TTS-mod transcription *does* record but the engine never enforced: "You must discard
  this card from the table as soon as the Fellowship is declared or revealed." The two
  halves need different seams. **Revealed** is a *state*, so it joins the card's row in
  `TABLE_CONDITIONS` (persistent.ts) and `pruneTableCards` sweeps it at the next
  transition. **Declared** is a *momentary trigger* — a declaration leaves the
  Fellowship Hidden (p.19) — so it fires inside `declareFellowship` (fellowship.ts),
  next to Worn with Sorrow and Toil. Using the once-per-turn declare *flag* as a prune
  condition instead would have made the card unplayable for the rest of any turn the
  Fellowship had already declared in, which the clause does not say
  *(player report 29253u1e62620w31)*.
- **A printed discard clause that already holds is also a play condition.** Playing
  The Last Battle onto a **revealed** Fellowship, or Wormtongue (sh-char-22) onto an
  **already-active** Rohan, puts the card on the table only for the very next sweep to
  take it off again — a die and a card burned for nothing. Both are now gated in
  `canPlay`, the same strengthening *The Last Battle*, *Denethor's Folly* and *The
  Palantír of Orthanc* already carry for their "Play on the table if" lines (same
  report). A card whose clause has **not** yet fired is unaffected: a Fellowship that
  declared earlier this turn is Hidden again by definition, so The Last Battle may be
  played again in that same turn.
- **Table-card discards now say WHY in the card's own words.** `pruneTableCards`
  returns a reason string instead of a bare boolean, so the log reads "The Last Battle
  is discarded — the Fellowship is revealed" or "Wormtongue is discarded — Rohan is
  activated" rather than the generic "its play condition no longer holds (p.22)", which
  was wrong for a printed clause that is not a play condition at all.
- **"Captain of the West" is cumulative.** "Adds 1 to the Combat Strength of a Free
  Peoples Army with this Companion (**cumulative if more Captains of the West are in
  the battle**) up to a maximum of 5 Combat dice" (Almanac, the Companion entries;
  rulebook p.34 for Gandalf's copy of the ability). `rollHits` gave a flat +1 for
  "any Captain present", so Aragorn and Gimli standing together bought exactly what
  Gimli bought alone *(player report 3m4h5z6n0o395041)*. It now counts them. The
  five-dice cap (p.28) is unchanged and still applied after the bonus, and Meriadoc
  and Peregrin are **not** Captains (Almanac). *Words of Power* cancels **one chosen
  Companion's** abilities for the round, so its `enemyCaptainCancel` now removes one
  Captain from the count rather than erasing the whole bonus — closer to the card, and
  the natural seat for the target pick when that is modelled (report 5644674x3b5n2m6i,
  still open). `scripts/probe-rules-batch-0923.mjs`.
- **A card-recruited Nazgûl obeys the recruiting restrictions.** "All newly recruited
  figures … can only be placed in a **free** City, Town, or Stronghold" and "you cannot
  muster or recruit troops in a Settlement controlled by the enemy" (p.26) — nothing in
  those lines exempts Leaders. The card handlers placed Nazgûl by writing straight into
  `region.nazgul`, so *The King is Revealed* (sh-str-18) conjured one into a Minas
  Morgul the Free Peoples had captured, even as the same card's five Regulars were
  (correctly) refused *(player report 33010827046r0g39)*. All three card recruits —
  The King is Revealed, *Shadows on the Misty Mountains* (sh-str-19) and *The Black
  Captain Commands* (sh-char-24) — now go through `cardRecruitNazgul`, which gates on
  `recruitable` and lands the figure in the stack `eventRecruitTarget` names, so under
  a siege the garrison gets it **in the Stronghold Box** and the besieger gets it in the
  open field (Almanac, "Points common to all … recruitment cards"). The King is
  Revealed's unit count now reads its room from that same stack, too: it was measuring
  the region's open field, which under a siege holds the **besieger**, so the whole
  five-Regular recruit failed silently there.

### Card clauses corrected from player reports (2026-09-12)

- **"The Grey Company" (fp-char-24)** — "Eliminate one Regular unit to recruit one Elite
  unit of the same Nation." A **Free Peoples** unit that is eliminated is a *casualty*:
  it leaves the game. The Almanac says so twice for this card — "it goes into casualties,
  and not into reinforcements" — and we were handing the Regular back to the
  reinforcement pool to be recruited again *(player report 06295o08124a2l57)*.
- **"Through a Day and a Night" (fp-str-12)** — "Move the Army containing the
  Companion(s)". A split may leave units behind, but "at least one Companion must move
  along with the Army" (Almanac). This one let the Army march off and leave every
  Companion at home *(player report 0c2d6s4y07386h19)*. `scripts/probe-card-move-split.mjs`.
  **The clause belongs to this card alone.** *Paths of the Woses* moves "a Free Peoples
  Army from any one Rohan region" and names no figure at all, but carried the same check
  — and threw it with *Through a Day and a Night*'s name on the message, so a perfectly
  legal Rohan split was refused under another card's rule *(player report
  1b1c5q54732v1a22)*. Removed. `scripts/probe-card-play-conditions.mjs`.
- **Card moves that state a RANGE need a legal ROUTE, not a short distance.**
  *Shadows Gather* ("move one Shadow Army up to three regions … the traversed regions
  must be free for the purposes of Army movement"), *The Shadow Lengthens* (same clause,
  two regions) and *Through a Day and a Night* ("the regions must be free for the
  purposes of Army movement") were enumerated by plain region-step **distance** over the
  bare map. Distance is not reach: an Army walled in behind an enemy Army was offered as
  both an origin and a destination — Helm's Deep, whose only exits are the Fords of Isen
  and Westemnet, was listed for a hop to Orthanc while a Rohan Army held the Fords
  *(player report 4e6f6u1a5y3q381q, which reports Mount Gundabad the same way)* — and a
  Free Peoples Army walked Lórien → Moria straight through the Shadow units in Dimrill
  Dale *(player report y1hvvsejg6wgibm0)*. All three now enumerate with
  `cardMoveReach` (`armies.ts`), a BFS over the same per-step test the route validator
  and the quiet-route search use (`cardStepBlocked`: no enemy Army, no Shadow bar, and
  no Nation crossing another's borders before it is At War). The enumerators ask the
  **permissive** form of the diplomatic test — p.28 lets an Army split before a card
  move, so a step barred to one travelling Nation is still open to another — and the
  strict form is applied to whoever actually goes, when the move is applied.
  `moveAllUnits` now **refuses** a ranged move with no route at all, instead of quietly
  teleporting the Army when every way round was walled off.
  `scripts/probe-card-move-reach.mjs`.
- **Card moves that state NO range move DIRECTLY — deviation closed the other way.**
  *Paths of the Woses* moves an Army "from any one Rohan region … **directly** to Minas
  Tirith", *Corsairs of Umbar* "from Umbar to a Gondor coastal region", *Dead Men of
  Dunharrow* Companions "to Erech, Lamedon or Pelargir", *Rage of the Dunlendings* units
  "**to** this region". None names a range or a traversal clause, so there is no route:
  the figures leave one region and arrive in the other, and nothing in between is
  entered, captured or roused. The engine invented a quiet route for them anyway, which
  both woke Nations nobody marched through and made the map demand a walkable path to a
  destination the card reaches by fiat *(player report 1u1f45154m472g67)*. Such targets
  now carry `direct: true`: `moveAllUnits` skips the route, and the board hands them back
  to the plain click-the-destination flow instead of asking for a trace.
  **Residual closed (2026-09-23).** *Paths of the Woses* allows an origin "including a
  Stronghold under siege", and the enumerator now offers it: `wosesMoves` reads the
  garrison through `armyForceOf` (the siege box when the FP is the besieged side), and
  every card mover takes its source from `figureForce` rather than the region, so the
  figures that march out are the boxed ones. `liftSiegeIfAbandoned` ends the siege
  behind them and the handler then calls `captureIfEnemySettlement` for the besieger —
  a Stronghold whose whole garrison walks away falls to the Army already standing in
  the region. A **partial** march leaves units in the box, so the siege (and the
  Settlement's ownership) stands. The same `figureForce` seam fixes `charRegion`, which
  searched only the open field and therefore declared every besieged Companion "not in
  play" for card preconditions — *House of the Stewards* went dead the moment Boromir
  was shut inside Minas Tirith *(player reports 36323l0a702k6m17, 6x6f3v1h1y5r3k4u)*.
  Event-card recruits into a besieged Stronghold go to the garrison under its 5-unit cap
  (p.28, p.31), measured through `eventRecruitTarget`.
  `scripts/probe-besieged-card-clauses.mjs`.
- **Dead Men of Dunharrow (fp-char-22) is three choices, as printed.** "Play if
  Strider/Aragorn is in a Rohan region (including a Stronghold under siege). Move
  Strider/Aragorn (and any number of Companions in the same region) to Erech, Lamedon or
  Pelargir. … You may then recruit up to three Gondor Regular units in that region,
  taking control if necessary." The origin is looked for in the siege box too — the card
  used to be unplayable with Aragorn inside a besieged Helm's Deep *(report
  0k5q531m3c4d3x5z)*. Each other Companion standing with him is an optional map pick
  (Almanac: "Any number of Companions with Strider/Aragorn may move along with him");
  the destination is a map click *(reports 4r2y2p2l2e3g3p1h, 6d31266k0u535r11)*. A
  Shadow Army at the destination is **attacked** (Almanac: "this card is an 'attack'
  and so affects the Political Track"), takes a die of hits and retreats or is destroyed.
  The recruit is a 0–3 choice made after that roll ("may … up to" — the maximum-extent
  rule binds "Recruit …" cards, not this one), and recruiting none takes no control of a
  Shadow-held Settlement *(report 2s1q5z4f2d0j2y16; Almanac: with no Gondor Regulars
  available "the Free Peoples player does not take control of it")*.
  **Residual deviations:** the struck Army's casualties still auto-resolve
  Regulars-first and its retreat goes to the first free adjacent region, where the
  Shadow player should choose both. `scripts/probe-dead-men.mjs`.
- **"Rage of the Dunlendings" (sh-str-11) recruits in a *free region*.** The card says
  "Recruit two Isengard Regular units in a **free region** adjacent to North or South
  Dunland", and a free region (p.10) is stricter than the general Event-card recruit
  test: no enemy Army in it and no Settlement the enemy controls. The generic
  `recruitable` helper was used instead, which p.28/p.33 open to a **besieged**
  Stronghold — free for the *besieging* player, never for the side boxed inside it. With
  a Free Peoples Army camped in Moria's open field (Moria is adjacent to South Dunland)
  the card therefore recruited into the boxed Isengard garrison and then walked the
  Dunland units into the open field, where they joined the besiegers *(player report
  1q2j5e5y0c2l5q4q)*. One `freeRegion` test closes both halves.
  `scripts/probe-card-move-reach.mjs`.
- **"Rage of the Dunlendings" runs on the MAP, both halves.** Its recruit pick carried no
  `mode`, so it stayed a panel button instead of the highlighted-Settlement muster menu
  every other card recruit uses; and its consolidation picks carried `region` instead of
  `to`, so they were not card Army moves either — the board never lit them, and the card
  walked **one unit per pick** with no say over Regular vs Elite *(player reports
  0g40604w245d6w3q, 4z4d6h18592c546r; John's standing call of 2026-09-10, "Event cards
  use the map")*. The recruit pick is now `mode: 'recruit'` and each source is
  `{ from, to, mode: 'move', direct: true }` — a real card Army move, so it takes the
  click-army-then-destination flow and the p.28 split picker. Two new fields carry the
  card's own limits into that picker: `nation` ("up to four **Isengard** units", so the
  Sauron troops sharing a Dunland are not on offer) and `count` (how many figures the
  four-unit budget still allows). The engine re-derives both when it applies the pick, so
  an over-wide selection is trimmed rather than trusted, and it writes back what actually
  moved. `scripts/probe-rage-of-the-dunlendings.mjs`.

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
| D5 | Battle resolution (p.29-32) | Interactive: combat-card play each round, casualty selection, cease/retreat | `combat.ts` is an INTERACTIVE sub-machine: **combat-card play EVERY round** (each side, a real 'combatCard' PendingChoice gated by the card's **"Play if…" precondition** — `combatPrecondMet` covers the modelled cards' precondition patterns; `combatCards.ts` maps ~30 combat titles to roll/re-roll/max-dice/extra-attack/extra-hit/cancel/negate mods), casualty selection, cease/continue, and retreat are all real prompts. **Cancels are now initiative-aware** (`cardInitiative`: a cancel removes the enemy card only if it resolves first — attacker needs strictly lower initiative, defender wins ties), and **Mûmakil** is modelled with both of its effects (rollBonus at init 3 + a `bonusHitIfOutscore` hit at init 5); its "more total hits" test is taken AT initiative 5 (`outscoreBonusHits`, Almanac): No Quarter / Nameless Wood hits count only when the Free Peoples defend (ties resolve the defender first), Confusion '1's count for the Free Peoples, and Shield-wall / Heroic Death (initiative 6) never affect it — it used to compare the totals after their cancellations (report 4i562s26251v1y26, `scripts/probe-mumakil-initiative.mjs`). **Forfeit-Leadership and elimination effects are now modelled:** *Mighty Attack* forfeits a Companion's Leadership (`ownLeadershipPenalty`) to turn a miss into a `guaranteedHit`; *Blade of Westernesse* spends a hit to `eliminateMinion`; *Fateful Strike* `eliminateNazgulIfHit` (Nazgûl → reinforcements); *Heroic Death* is a real prompt (`heroicDeath` step/PendingChoice, after the roll and before casualties): the Free Peoples may sacrifice a Leader to cancel one hit, a Companion in the battle to cancel up to his Level, or no one (Card Text Reference; it used to spend a Leader silently, never offered a Companion, and cancelled for free when only a Companion was present — reports rfibkew6mp9hi2fi, 0m181w0r2w4b2z25; `scripts/probe-heroic-death.mjs`). **Deviation:** a Companion always cancels the most hits he can (min of his Level and the hits scored) — cancelling fewer can never help his owner, so it isn't asked. Only the opponent's rolled hits can be cancelled, not Confusion's self-inflicted '1's. Residual: when *Black Breath* is played against it in the same round both resolve at initiative 6, and Black Breath's elimination is applied first. **Pre-combat timing cards are modelled in initiative order** (`resolvePreCombat`, lower-first/defender-ties): *Scouts* (`retreatBeforeCombat`) retreats the FP defender before the roll; *Durin's Bane* (`preCombatAttackDice`: 3 dice, hits on 4+) rolls a special attack first — reproducing the rulebook's own example (Scouts@1 resolves before Durin's Bane@2, so the FP army escapes). **All combat-card effect classes are now modelled.** **Words of Power** (sh-char-15/18/23) cancels one enemy Companion's Leadership (`enemyLeadershipPenalty`) and Captain-of-the-West die bonus (`enemyCaptainCancel`) for the round; **Black Breath** (sh-char-08b/12) — on a scoring round — additionally eliminates the highest-Level enemy Companion whose Level ≤ the round's hits, else one FP Leader (`blackBreath`, auto-targeted in the owner's favour like the other combat-card eliminations; the "re-roll specifically scored" condition is approximated by "the round scored ≥1 hit"). **Combat-roll vs Leader re-roll bonuses are now distinguished** (player report): the cards name the two rolls separately, so `rollBonus` applies ONLY to the Combat roll and `rerollBonus` ONLY to the Leader re-roll — *Valour*/*Servant of the Secret Fire*/*Devilry of Orthanc*/*Ents Rage*/*Cruel as Death*/*Relentless Assault*/*Mumakil* are Combat-roll-only, *They Are Terrible* is re-roll-only, *It Is a Gift*/*One for the Dark Lord* are both; the enemy to-hit penalty (*Advantageous Position*) likewise hits the Combat roll only. **Confusion is NOT a to-hit penalty** — it was modelled as one, but its text reads "every unmodified die result of '1' in the Shadow player's Combat roll scores one hit against the Shadow Army. Any such result cannot be rolled again during the Shadow player's Leader re-roll." It is now `enemyOnesBackfire`: each raw 1 wounds the ROLLER's own Army (added after cancellation — the hit is scored by the card, not by the opponent's dice) and is excluded from the Leader re-roll pool. `scripts/probe-combat-card-cost-prompt.mjs`. **"Both Armies" cards are symmetric** (`symmetricBonus`): *Deadly Strife* (+2) and *Desperate Battle* (+1) now lift BOTH sides rolls, not just the owners. **Stated Leadership forfeits are charged:** *Cruel as Death* costs 2 Nazgul Leadership, *They Are Terrible* 1, and *Dread and Despair* is modelled as its real effect — forfeit 1 Nazgul Leadership so the enemy rolls one fewer **Combat die** (min 1), not a worse to-hit. **Variable-size effects — two fixed, three still open.** *Andúril* now scales with the figure present: Strider forfeits Leadership 1 to convert one missed die, Aragorn forfeits 2 to convert up to two (no prompt needed — forfeiting Aragorn costs his full Leadership either way, so converting two is never worse). *Foul Stench* is now the CONDITION its text states — the FP Leader re-roll is cancelled only when Nazgûl Leadership >= total FP Leadership, evaluated at roll time from both Forces; it used to fire unconditionally. Both covered by `scripts/probe-combat-card-costs.mjs`. **Nazgûl Leadership means the Nazgûl's** (one per Nazgûl, two for the Witch-king — never the Mouth of Sauron's or Saruman's; `nazgulLeadership` in `combat.ts`): it gates *Cruel as Death* (2+), *Dread and Despair*, *Foul Stench* and *They Are Terrible* (1+), caps what *Dread and Despair* may forfeit, and is what *Foul Stench* compares against the FP total (report 1q195n1v414a1u27). **The White Rider negates it for the whole battle**, so none of those four can be played once Gandalf the White forfeits (Almanac, Gandalf the White: the Shadow "cannot play any card that requires Nazgûl Leadership when this ability is in use"); *Black Breath* and *Words of Power* need only a Nazgûl present and stay playable. **The Witch-king's Sorcerer draw comes when the first Combat round is completely over** — after casualties, the cease/continue and retreat decisions (and a siege's Elite reduction to press on), before any advance after combat (Almanac, the Witch-king; p.29 "Combat cards are always discarded as soon as the Combat round is over"). It used to be asked the moment the card was played (report 295c2a6x452j1573); if he is eliminated in that round there is no draw. `scripts/probe-sorcerer-timing.mjs`. **Variable-cost cards are now paid for (`combatCardCost` PendingChoice).** A card whose size the owner chooses declares a `VariableCost` (kind / timing / cap / min) and the sub-machine stops to collect it: a `cardCost` step before the roll, and an `onslaught` step after casualties for the one card paid then. Until it is answered the card grants NOTHING, so an unanswered prompt can never leak the old free effect — but note the prompt has to be *reached*: `resolvePlayCombatCard` used to send the round from 'defenderCard' straight to 'beginRound', so the `cardCost` step was only ever entered through combatStep's own fall-through (i.e. when the defender had NO playable card). Whenever the defender actually answered, a variable-size card was played, discarded and did nothing (player report). Fixed — the defender's card now advances to 'cardCost'. `scripts/probe-combat-card-cost-prompt.mjs`; the amount is stored per round (`atkCardCost`/`defCardCost`, cleared with the round's cards). Offers are capped by what the payer actually has — self-hits never exceed units-minus-one (no self-annihilation mid-round), a Leadership forfeit never exceeds the Leadership held — and a side with nothing to spend is charged 0 rather than shown a dead option. *Relentless Assault*: up to 2 self-inflicted hits, +1 to the Combat roll per hit. *Dread and Despair*: forfeit **one or more** Nazgûl Leadership (0 is clamped up to 1 — the card is not optional once played); the FP rolls one fewer Combat die per point, min 1. *Onslaught*: up to 4 self-inflicted hits **after** casualties, then one die per hit scoring on **4+** (not the 5+ the old flat extra-attack modifier used; that modifier — `extraAttackDice`/`extraAttackFrom`, and the `extra` dice it recorded on a CombatRoll — was removed in full once the three additional-attack cards moved to their own pre-combat / post-casualty steps, player report 162o1y5e5d2q0g14). **Brave Stand is sized by the battle, not by a cost:** "the Shadow player rolls one die less in his Combat roll **for each Companion in the battle** (to a minimum of one)" — it was a flat three-dice cap (`maxDiceEnemy`), which is a different card; it now counts the Companions in the owner's Force as `enemyDiceReduction` (player report 640i6h2s51023q4w, `scripts/probe-rules-batch-0917b.mjs`). **Deviation:** the casualty allocation for the self-hits and for Onslaught's counter-attack auto-resolves Regulars-first, matching the other card-driven eliminations. Covered by `scripts/probe-combat-card-costs.mjs`. **Residual simplifications:** the initiative-ordered pipeline is implemented for the timing cards specifically (other effects are commutative mods, so order is immaterial); the defender now **chooses the retreat destination** when more than one free adjacent region exists (`retreatTo` choice; a single destination still auto-resolves). Truly-minor residuals: playing *Mighty Attack* commits its `guaranteedHit` (the card text gives no separate decline); pre-combat-attack casualties auto-resolve (no casualty prompt); a 15-round safety backstop (set far above any real battle's length — it only guarantees the sub-machine can't loop forever, never cuts a genuine fight short); unrecognized combat-card preconditions default to playable (all modelled cards' preconditions ARE handled). | D5 essentially closed — only the listed residual simplifications remain. |
| D6 | Hunt damage (p.41-42) | FP chooses casualty vs Corruption; re-roll conditions | Now INTERACTIVE: `hunt.ts` prompts FP (PendingChoice 'huntDamage') to absorb as Corruption or lose the Guide / a random Companion (excess → Corruption); Guide reassigns (Gollum if none). Re-roll conditions (Shadow Stronghold / Army / Nazgûl in the region) modelled. **Guide Hunt abilities are now applied** as `huntDamage` options: Meriadoc/Peregrin may separate to reduce damage −1 (`reduceSeparate`, via separateCompanion — Guide reassigns); Gollum suppresses a numbered tile's Reveal (passive) and may reveal to reduce damage −1 (`reduceReveal`); reductions re-prompt until absorbed. (Adding these FP defenses moved the heuristic soak toward balance — FP wins 101→137 of 300 — exactly the skew-closes-by-fidelity dynamic.) **On-table damage-REDUCTION cards are wired** (`reduceCard`): *Axe and Bow* (Gimli/Legolas) and *Horn of Gondor* (Boromir) play on the table via their `onTable` handlers, then may be discarded during the Hunt for −1 damage. **Special Hunt tiles now enter the pool on Mordor:** the 8 special-tile Event cards (fp-char-01–04, sh-char-01–04) put a tile `specialsInPlay`; `enterMordor` moves them to `specialsInPool`; `drawTile` draws across the standard + special pools (reshuffling both via `specialsDrawn`). FP tiles (Phial −2, Sméagol −1) heal, Shadow tiles (Shelob's Lair, The Ring is Mine!, etc.) add damage/stop. **With this, the heuristic soak is essentially balanced — FP 153 / Shadow 147 of 300** (from 102/198 before the Hunt-fidelity work — the skew closed by faithfulness, not tuning). **The draw-intercepting on-table cards are wired** via a small resumable flow: *Wizard's Staff* (Gandalf-grey) prompts a BLIND `huntPreventDraw` before the tile (discard to skip the draw entirely); *Mithril Coat and Sting* prompts `huntRedraw` after the tile is seen (discard to return it to the pool and draw a second). Both also intercept an **Event-card tile draw by the Shadow** (Orc Patrol, Isildur's Bane, Foul Thing from the Deep, The Nazgûl Strike!, Balrog of Moria, a reveal through a Shadow Stronghold) — Almanac: "whether due to a Hunt or Event card or any other reason" (player report 3c40715a001e0r00). **Deviation:** on such a draw Mithril Coat is not offered for a tile that is discarded without effect anyway (an Eye / Free Peoples special), since redrawing can never help. **D6 is fully closed** — every Hunt-damage / Guide / on-table / special-tile rule is now modelled. **Every −1 reduction now logs itself** with its running total, and the closing line states the Corruption actually taken: a long Hunt (redraw → Companion casualty → Guide ability) used to end on a bare "corruption N" that mentioned neither Gollum's reveal nor the Hobbit-Guide separation, so the player could not check the arithmetic. *(Player report 2o5h0p0s: "the log made no mention of Gollum's ability".)* | — closed. **AI casualty policy (`wotrAI.ts`):** the RAW options are the Guide or a random Companion, and the Guide is always the highest-Level Companion left — so the AI takes the **Guide** whenever the hit is at least as large as his Level (nothing is wasted, and it is the biggest reduction on offer) or whenever a random draw could still leave the Ring-bearers dead at 12; a hit *smaller* than his Level spends a cheap random body instead. *(Player report, 2026-08-20: 6 damage at 7 Corruption drew Merry for −1 and lost the game — Strider, the Guide, would have absorbed 3.)* `scripts/probe-ai-hunt-choices.mjs`. |

| D7 | Event-card *riders* (the secondary "you may also…" clauses) | Optional follow-on moves / free card plays | Now modelled, except one sliver | **Rage of the Dunlendings** (sh-str-11): recruits 2 Isengard, then the player may move **up to 4 Isengard units** there from N/S Dunland (interactive `targets`/`repeat`). **The Ents Awake** (fp-char-19/20/21): if Gandalf the White is in Fangorn or a Rohan region, the FP may play **one Character Event without an Action die** (`fpFreeCharEventThisTurn` flag, consumed by the next FP Character-Event play — a slight timing relaxation from "immediately" to "as the next action"). **There Is Another Way** (fp-char-10): heals 1, then (Gollum as Guide) offers a real choice — **hide** (if revealed), **move** (if hidden, following normal movement rules), or **decline**. The *move* triggers a full Hunt: it runs via a new handler `finalize` hook that fires AFTER the card is discarded and the turn passed, so the Hunt's follow-up `huntDamage` choice survives the eventTarget cleanup instead of being clobbered. **D7 fully closed.** |

| D8 | Muster die recruiting (p.26) | One Muster die buys 2 Regulars / 2 Leaders·Nazgûl / 1 Regular + 1 Leader·Nazgûl / 1 Elite, and **the two figures of any two-figure muster go to separate Settlements** | **Fully modelled (RAW).** The first figure is placed, then a `musterSecond` choice places the second in a **different** Settlement (or declines for the lesser single muster); the two figures may belong to **different Nations**. The Shadow's "Leader/Nazgûl" figure musters a **Nazgûl into a free Sauron Stronghold** (`recruitNazgul`). | — closed (was a same-Settlement / no-Nazgûl-muster simplification; now RAW). |
| D9 | Army movement (p.27–28) | One Army die moves up to **2 different** armies one region each; a moving army may **split** (leave a rearguard) | **Fully modelled (RAW).** An Army die moves a first army, then an `armyMove2` choice may move a **second, different** army with the same die (a Character die still moves only one). **Splitting** is supported: `moveArmySplit` + the `move` selection on `moveArmy`/`armyMove2` move only chosen units/Leaders/Nazgûl/Characters, enforcing ≥1 unit, the stacking/siege cap, the not-At-War border rule, "FP Leaders can't be stranded with no units," and "a Character-die split must take ≥1 Leader/Character." The UI exposes splitting via a per-move picker (move whole army or a portion). | — closed. The heuristic AI now **uses the optional second move** (`chooseArmyMove2`, when a different army makes progress) and **garrison-splits** (`maybeSplitGarrison`: leaves a one-unit garrison when vacating a threatened VP Settlement). *(Fixing this surfaced a real RAW bug — `moveArmySplit`'s Character-die leader requirement omitted Nazgûl, wrongly rejecting a Shadow Nazgûl-stack split; now fixed.)* AI still attacks with its whole At-War force (no voluntary attack-rearguard — that would weaken the attack); the mandatory not-At-War rearguard is always enforced. |
| D11 | Splitting an attacking Army (p.28) | The attacker may split into an attacking Army and a **rearguard** that takes no part (each needs ≥1 unit); not-At-War figures **must** stay in the rearguard; a Character-die attack's attacking force needs ≥1 Leader/Character | **Fully modelled (RAW).** `attack` takes an optional `rearguard` selection; `startBattle` holds it aside from the origin region for the battle and `finishCombat` restores it there (it never advances). `attackError` enforces ≥1 attacking unit, the "rearguard needs ≥1 unit" rule, and the Character-die Leader/Character requirement; **not-At-War units are auto-forced into the rearguard** (`fullRearguard`). The UI exposes it via the same picker in "attack" mode (unselected figures become the rearguard). **A Character die may also initiate an attack** with one army that has a Leader/Nazgûl/Character (offered in `legalActions`, spends the Character die), mirroring the Character-die move. | — closed. AI attacks with its whole At-War force (doesn't voluntarily split) — AI-strength, not a rules gap. |
| D10 | Besieged Stronghold limits (p.31–32) | Garrison in the siege box capped at 5 units (Leaders unlimited); can't muster into a besieged Settlement | **Fully modelled (RAW).** When a Stronghold comes under siege the garrison is capped at **5 Army units** — excess removed (Regulars first) and recycled to reinforcements (`enforceSiegeCap`, `SIEGE_LIMIT`). Mustering into a besieged Stronghold is blocked for Muster-die recruits (`recruit()` checks `besieged`), while Event-card recruits may (p.27). Reinforcing a siege by movement is capped at 5 in `canMoveArmy`. | — closed. |

| D12 | Fellowship revealed by the Hunt (p.39) | On reveal, the FP moves the figure up to Progress regions (its choice; never ending in an FP City/Stronghold), resets Progress, flips to Revealed; **+1 Hunt tile per Shadow Stronghold the traced path crosses** | **Fully modelled (RAW).** On reveal `beginReveal` raises a `revealMove` choice; the **FP picks the destination on the board** (within Progress, never an FP-controlled City/Stronghold — **including staying where it is**: the reveal moves "as described" for a declaration, "equal to or less than" the Progress, p.38; player report 5n1h4h4b3p2b3b32, `scripts/probe-reveal-stay.mjs`), the figure moves there, Progress resets, Revealed. **A Hunt tile is drawn per Shadow Stronghold on the traced path** (`extraHunt`), restoring the cost of revealing through Moria/Mordor. **Gollum's reduce-damage *reveal* is now a full reveal too** (figure-move + Progress reset, at the tile's reveal step — player report 484g5d6e162t361o), and **his ignore-the-icon is asked with the Guide who is standing there at that step**, so a mid-Hunt casualty that promotes him applies it to the tile already drawn (player report l61v0rpyl8vhrpcl). Minor residual: if one Stronghold's tile opens an FP damage choice, any further Strongholds' tiles defer (same as declaration). | — closed. (AI routes toward Morannon and can eat avoidable Stronghold Hunts — an AI-strength gap, not a rules one; a human picks the path.) |

| D13 | "Move any or all Companions/Nazgûl" cards | Move separated Companions / Nazgûl freely, then a conditional effect | **Companion-move cards fully modelled.** *Book of Mazarbul* (fp-str-04) and *Fear! Fire! Foes!* (fp-str-07): the FP moves any/all separated Companions — interactively (pick a Companion, board-click its destination, repeat, or move none) — then if a Companion is in Erebor/Ered Luin (resp. The Shire/Bree) the Dwarves (resp. North) are roused to War (`moveCompanionsCard`, with a not-At-War-guarded rouse checked before AND after the moves). *(This also fixed a real bug: fp-str-04 previously roused the Dwarves UNCONDITIONALLY, skipping the "if a Companion is in Erebor/Ered Luin" check.)* **Nazgûl-reveal cards now fully modelled too.** *Nazgûl Search* (sh-char-09) and *The Nazgûl Strike!* (sh-char-08b): the Shadow moves any or all of the Nazgûl — interactively (pick a Nazgûl group's region, board-click its destination with FLY range, repeat across groups, or move none) — then if at least one Nazgûl shares the Fellowship's region the conditional effect fires: sh-char-09 reveals the Fellowship; sh-char-08b rolls an extra Hunt (`moveNazgulCard`, with the conditional run once in `finalize`). **Both Nazgûl cards are gated ONLY on their printed condition** — "Play if the Fellowship is on step 1 or higher on the Fellowship Track" — plus a Nazgûl existing to move. The reveal/Hunt half is an EFFECT, not a requirement (p.22: effects are "applied to the maximum extent possible"), so the very common play of using either card purely to REPOSITION the Nazgûl is legal. *(Player report 3i1v1v: they were additionally gated on a Nazgûl being able to reach the Fellowship — and, for sh-char-09, on the Fellowship being Hidden — which blocked that play entirely.)* **And sh-char-09's reveal is a real reveal:** it calls `beginReveal`, so the FP must move the figure up to its Progress and the Progress resets to 0 (p.39), exactly like a Hunt reveal — the choice survives because `finalize` runs after the eventTarget resolver clears the card's own pending choice. *(Player report 3k733e: the Fellowship stayed put with its Progress intact.)* `scripts/probe-play-via.mjs`. **sh-char-08b's printed choice is now offered** — "discard one FP Character Event card from the table or roll for the Hunt" raises a real `nazgulStrike` choice for the Shadow whenever both branches are live (no FP Character table card → the Hunt fires directly, so it is never a one-answer question). `scripts/probe-nazgul-strike.mjs`. **"Any or ALL of the Nazgûl" now means a SUBSET of a stack on every card.** *The Ringwraiths Are Abroad* (sh-char-23) and *The Black Captain Commands* (sh-char-24) build their own target lists and still flew the whole stack, while the Character die and the `moveNazgulCard` cards had long asked "how many?"; the same figures thus obeyed two different rules depending on how you moved them. `nazgulFlyTargets` now fans a Nazgûl group out to one target per count on all four cards (the Witch-king is one figure, so no count). *(Player report 0j1x6h3r: "Played Ringwraiths are Abroad … It didn't let me choose how many of them to move.")* **Each Nazgûl flies once — not each region once.** The cards used to block a whole region after any fly from or into it, so flying the Witch-king out of Mount Gundabad on *The Black Captain Commands* pinned the Nazgûl he left behind, and a stack could not split two ways. `unmovedNazgul` now counts the figures that have not yet flown on this card (the stack minus those that landed there); the map no longer offers a "move them all together" pick for Nazgûl figures, which only Companions can do. `scripts/probe-nazgul-card-fly.mjs`. *(Player report 2m6j6f1z5w07390y.)* **And the Witch-king is a Nazgûl on these two cards as well (p.25).** *Nazgûl Search* and *The Nazgûl Strike!* enumerated plain Nazgûl stacks only, so the one figure they could not move was the Witch-king — even though their own reveal/Hunt clause already checks his region for the Fellowship, and the other two Nazgûl cards have always flown him. He is offered as a pick (once per card, no count — he is one figure) and the play condition counts him, so a board where he is the last Ringwraith standing no longer refuses the card. *(Player report 5vw7t8btxx0r2dq7.)* **And the "or MOVE" branch of the separation cards is modelled.** *Gwaihir the Windlord* (fp-char-15) and *We Prove the Swifter* (fp-char-16) print "Separate from the Fellowship, **or move**, one Companion or one group of Companions" — that second branch used to be waved off as "folded into the Character-die move", which is wrong on three counts: it costs an **Event** die instead of a Character die, it carries the card's range bonus (Level-as-4 / +2 regions), and with an **empty Fellowship it is the only playable branch at all**. `separateViaCard({ mapMove: true })` now offers on-map Companions as picks tagged with their region (`from`); same-region Companions may join the travelling group (range = the highest Level, p.24) and `finalize` routes the `from`-tagged branch through `moveCompanionGroup`. *I Will Go Alone* (fp-char-11) and *There and Back Again* (fp-char-17) print no such clause and stay separate-only. `scripts/probe-companion-card-move.mjs`. *(Player report 4964174f: "T8: Wanted to spend [E] to play Gwaihir, but was not allowed" — five Companions on the map, none in the Fellowship.)* | Fully closed — D13's last residual (the discard branch) landed with John's call D. |

| D15 | Splitting an Army moved by an **Event card** (p.28, "Using an Event Card to Move Armies": "it is possible to split the Army before moving") | The player may define the moving Army as a subset before a card-driven move | **Modelled (RAW).** The `eventTarget` action carries an optional `move` MoveSelection; every card mover (Shadows Gather, The Shadow Lengthens, The Shadow is Moving, Corsairs of Umbar's move branch, Paths of the Woses, Through a Day and a Night, Nazgûl-led moves) passes it to `moveAllUnits`, whose split half (`moveSelectedUnits`) applies a **sanitized** subset: own-side Nations/figures only, clamped to what's present, never Saruman, and a Nazgûl-led split keeps its escort with the movers (≥1 Nazgûl, or the **Witch-king** when the Army qualifies through him alone — forcing a Nazgûl unconditionally asked for a figure that was not in the stack, so a Witch-king-led split marched off and left him behind). The composition rules are a **refusal**, not a silent correction: `cardSplitBlockReason` rejects a selection that moves no unit or that would leave a Free Peoples Leader in a region with no combat units (p.27). Both used to be answered quietly — an empty tick-list moved the WHOLE Army, and a stranding selection dragged the Leaders along regardless — so the player's selection was overruled with no message anywhere *(player report 2w0k3j4k1q026q3r)*. The split picker now asks the same question for a card move that it already asked for a die move, so the refusal is shown before the click, with the same wording. The UI routes card-move picks through the same split picker as normal moves (whole army remains the default). Player report 5i0w4b0 asked for this. `scripts/probe-card-move-split.mjs`. **Residuals:** target enumeration still requires the WHOLE army to fit the destination's stacking limit (a destination only a subset could legally join isn't offered); card ATTACKS take the whole force (no card-attack rearguard); the AI always moves the whole stack (an AI-strength gap, not a rules one). | — closed, with the listed residuals. |
| D14 | Casualties inflicted by **direct-damage Event cards** (p.30 casualty rule) | The **owner** of the losing units chooses each removal: eliminate 1 Regular **or** reduce 1 Elite to a Regular | **Interactive for the cards resolved in a single `apply` step** — the owner gets a real `eventCasualties` choice (now allocated ONE HIT AT A TIME — see §7 step 4) whenever a genuine choice remains, exactly like combat casualties (`queueOrApplyEventCasualties` / `resolveCasualtyStep`). **Return to Valinor** (sh-str-01, FP Elves), **The Ents Awake** (fp-char-19/20/21, Orthanc — Nazgûl/Minions eliminated with the Army in the follow-up), and **Dreadful Spells** (sh-char-19, FP Army) are covered. **Residual:** three cards that inflict casualties from **inside the interactive target-selection machine** — **Dead Men of Dunharrow** (fp-char-11/…), **Faramir's Rangers** (fp-str-06), and **The Spirit of Mordor** (fp-str-05) — still auto-resolve **Regulars-first** (via the legacy batch-plan `applyCasualties`), because the `eventTarget` resolver clears the pending choice on completion (deferring mid-target would need the same `pendingCombat`-style hand-off attacks use). The absorption order only matters when the target army holds both Regulars and Elites and survives; the auto-choice matches the standard "keep the Elites" heuristic. | Mostly closed; the 3 target-machine cards, and **Return to Valinor**'s multi-region spread, remain on the batch plan (documented Regulars-first / one-plan-for-all auto-resolution). |
| D15 | **Besieged Armies as Event-card targets** (p.31; Almanac "Dreadful Spells" C 19 / "The Ents Awake") | A besieged Army is still **in its region** — only its units sit in the Stronghold Box. Cards that do not say "attack" may therefore be played against it. If such a card eliminates the whole garrison, the Army standing in the region **captures the Stronghold immediately**; Companions/Minions inside are **unaffected** (it is not an attack) and end up in the region | **Fully modelled (RAW).** `armyForceOf(state, region, side)` returns the side's open-field Army **or** its boxed garrison, and every "is there an Army of X here?" event predicate reads it (`fpArmyNearNazgul`, and so **Dreadful Spells** sh-char-19 + **The Eagles are Coming!** fp-char-18 — either end may be the boxed force, per the Almanac's "the Nazgûl do not need to be with the besieging Army"). `queueOrApplyEventCasualties` routes the hits to that same Force (`boxed` on the `eventCasualties` choice) so a card aimed at a garrison can never wound the **besieger**. Dreadful Spells lifts the box's Characters aside before the hits land and a `siegeFall` `CasualtyThen` puts them back — into the box if the garrison held, into the region (with the Stronghold captured, no attack-activation) if it fell. `scripts/probe-dreadful-spells-siege.mjs` covers it. **The Ents Awake** (fp-char-19/20/21) was the one card left reading the open field alone: it tested `armySide(state, 'orthanc') === 'shadow'`, so with the **Free Peoples besieging Orthanc** the Isengard garrison and Saruman sat unseen in the box and the card fizzled with "Orthanc holds no Shadow Army" *(player report 4u10, 2026-08-25: "0r, 1e, Saruman didn't count? Wasted 2 dice and 1 card")*. It now reads `armyForceOf`, checks the box for a lone Saruman, and carries `boxed` into its `entsAwake` follow-up so a wiped garrison ends the siege and hands the Stronghold to the besieging Army (p.32). **It is an attack:** with a Shadow Army in Orthanc (field or box) each Ents card is an "attack" and so affects the Political Track (Almanac, "The Ents Awake" — the same reading as Dead Men of Dunharrow; report 6n0a3p246d0r5k4h); eliminating a lone Saruman is not. `scripts/probe-ents-and-take-them-alive.mjs` covers it. **Deviation from "prompt for every choice":** the card names no Nazgûl force, so when several qualify for the chosen victim the engine takes the **fullest** stack — more Nazgûl is strictly more dice at a target the player already picked, so there is no decision to make. **WHICH Free Peoples Army is hit is now a real `eventTarget` prompt** (it used to be whichever qualifying Army came first in region order — a besieger at Minas Tirith could find itself hitting Lórien). | — closed (player report, 2026-08-15: "Minas Tirith under siege … wanted to use [E] to play Dreadful Spells, but it won't let me"). |

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
