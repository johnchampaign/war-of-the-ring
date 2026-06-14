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
- **Settlements**: Town, City, Stronghold. **Fortifications**: Osgiliath, Fords
  of Isen (p.10–11). City = 1 VP to the opponent if captured; Stronghold = 2 VP
  (p.11, p.44).
- **Settlement control**: starts with the region's nation. Captured → opponent's
  Settlement Control marker (p.32). "Unconquered" = controlled by original owner
  (p.11).
- **Army** = all friendly Army units + Leaders + Characters in one region (p.8,
  p.26). May mix nations. **Stacking limit 10** Army units per region (5 if
  besieged inside a Stronghold) (p.8, p.26, p.31).

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
  (`activateNation` gains a `trigger` arg so Rohan stays passive unless roused by an
  appropriate Companion or an attack on/capture of Edoras/Helm's Deep; politics.ts).
  **Deviation:** declaring the Fellowship in a region does not activate that Nation in this
  engine, so Wormtongue's "declared in Edoras/Helm's Deep" exception is moot. Worn with
  Sorrow's "you may" is auto-applied (always to the Shadow's benefit).
- **Handlers** (`handlers/index.ts`, ~92/96 implemented): each registered card
  applies its effect; unimplemented cards aren't offered. **Interactive cards**
  (those whose effect needs a player-chosen target) use an `EventHandler.targets`/
  `applyTarget` pair: playing pauses with an `eventTarget` PendingChoice, the
  player picks from the enumerated targets, then the effect applies (e.g.
  *Cruel Weather* = move the Fellowship to an adjacent region; *Corsairs of Umbar*;
  *Shadows Gather*). Minor approximations are noted per card (Corsairs' "coastal"
  set; Shadows Gather's path-traversal reduced to distance).
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
  Stronghold unless besieged) enforced. **Deviation:** one die moves ONE
  piece/Nazgûl-group to one destination (the rulebook lets one die move ALL
  eligible characters, each to its own region) — keeps the action space tractable
  and avoids stripping army leadership wholesale.
- **Character card** fields (p.25): Level, activatable Nation, Guide ability,
  out-of-Fellowship ability, Leadership, action-die bonus symbol. Gandalf,
  Aragorn, Merry, Pippin can activate **any** FP nation (p.34).

---

## 6. Armies: muster & movement (p.26–28)

### Recruiting (Muster die or event) (p.26–27)
Bring reinforcements to a **free** City/Town/Stronghold of an **At-War** nation.
One Muster die yields one of: 2 Regulars (2 settlements) / 2 Leaders / 1 Regular
+1 Leader / **1 Elite**. The two figures from a 2-figure muster go to **separate**
settlements (p.26). Cannot recruit in enemy-controlled or besieged settlement, or
beyond available figures. Nazgûl recruit only in Sauron Strongholds (p.26). Event
cards may recruit even in not-yet-At-War nations or besieged Strongholds
(card-specific) (p.27).

### Movement (p.27–28)
- **Army die**: move up to **2 different** armies one region each (can't move the
  same army twice). **Character die**: move **1** army that contains ≥1
  Leader/Character.
- Destination must be **free for movement** (no enemy army; enemy-controlled
  settlement OK if no enemy army). Moving through an enemy-controlled settlement
  **captures** it (p.28). Stacking checked after all sub-moves (p.28).
- Non-At-War nation's units can't cross **another nation's** border (even
  friendly); see §8.
- No moving the same figure twice in one action; can't pick up/drop along
  multi-region event moves (p.27). Splitting allowed (leave rearguard); a
  Character-die move that splits must keep ≥1 Leader/Character with the movers
  (p.27).

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
4. **Remove casualties**: per hit, opponent removes 1 Regular **or** reduces 1
   Elite→Regular (replacement); for every 2 hits may instead remove 1 Elite (p.30).
   Attacker chooses his removals first (p.30). FP casualties are permanent &
   stored away from reinforcements; SH casualties recycle (p.30).
5. **Cease or retreat**: attacker may **cease** (survivors stay); else defender
   may **retreat** to an adjacent free region (p.30). Eliminating all Army units
   also removes that army's Leaders/Characters (p.30).

- Modifiers from cards/abilities add to the die result (clamped by the 1-miss/
  6-hit rule). Card **initiative** (bottom number) breaks timing ties; lower
  applied first; equal → defender's first (p.29). A Combat card with **multiple
  different-timing effects has one initiative per effect** — e.g. *Mûmakil* is
  printed "Initiative 3-5" (effect at 3, effect at 5), not a single value
  (p.29). Initiative 0 = resolves first (the *Daring Defiance* cancel cards).

### Fortifications & Cities (p.31)
First combat round only: attacker hits on **6+** (instead of 5+). Then normal.

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
control; the siege also lifts if the attacker is wiped. **Deviations:** (1) no
dual-occupancy — the besieger stays in its own region rather than occupying the open
ground (`besieged` flags "an adjacent enemy is besieging"); the withdraw choice is
offered once, pre-battle, not before every round. (2) Extending a siege by reducing
an Elite→Regular is not modelled (only the 1-round default and the card-driven
3-round assault exist). *Grond* (sh-char-20) / *The Fighting Uruk-hai* (sh-str-02)
set `siegeRounds:3` + `fpCardLock` (FP gets no Combat card in siege round 0 unless a
Companion is in the Stronghold). Sortie / relieve-by-outside-army are not yet modelled.

### Capturing a settlement (p.32)
Captured when an enemy army enters a region with a City / Town / unoccupied
Stronghold, or when all defenders of a besieged Stronghold are eliminated.
Place Settlement Control marker; advance VP track (+1 City, +2 Stronghold).
Recapture by original owner removes the marker and reverses the VP (p.32, p.44).
Captured settlements can't muster or advance the political track (p.32).

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
  (p.38). Used to heal / activate / satisfy card location. If path traced through
  a SH-controlled Stronghold, draw a Hunt tile per such Stronghold (p.38).
- **Revealed** (by successful Hunt or events): flip Progress to Revealed; FP must
  move the Ring-bearers figure (≤ Progress, never ending in an FP City/Stronghold)
  and reset to 0 (p.38). **A Revealed Fellowship cannot be moved** (via Character
  die) until **Hidden** again (p.38).
- **Hiding** (Character die or event): flip to Hidden. Using a Character die to
  hide does **not** also move that action; the die is not added to the Hunt Box
  (p.39). Must be Hidden to move.
- **Healing**: if **declared** in a non-enemy FP City/Stronghold during the
  Fellowship phase, remove 1 Corruption (min 0) (p.39).
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
- If FP does **not** attempt to move/hide on the Mordor Track during Action
  Resolution, **+1 Corruption** automatically (p.43).
- Companions can **never** separate on the Mordor Track; anything that would
  separate eliminates instead (p.43).
- Completing all 5 Mordor steps reaches the **Crack of Doom** → FP wins (if
  Corruption < 12) (p.43, p.44).

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
| D5 | Battle resolution (p.29-32) | Interactive: combat-card play each round, casualty selection, cease/retreat | `combat.ts` is an INTERACTIVE sub-machine: **combat-card play EVERY round** (each side, a real 'combatCard' PendingChoice gated by the card's **"Play if…" precondition** — `combatPrecondMet` covers the modelled cards' precondition patterns; `combatCards.ts` maps ~30 combat titles to roll/re-roll/max-dice/extra-attack/extra-hit/cancel/negate mods), casualty selection, cease/continue, and retreat are all real prompts. **Cancels are now initiative-aware** (`cardInitiative`: a cancel removes the enemy card only if it resolves first — attacker needs strictly lower initiative, defender wins ties), and **Mûmakil** is modelled with both of its effects (rollBonus at init 3 + a `bonusHitIfOutscore` hit at init 5). **Forfeit-Leadership and elimination effects are now modelled:** *Mighty Attack* forfeits a Companion's Leadership (`ownLeadershipPenalty`) to turn a miss into a `guaranteedHit`; *Blade of Westernesse* spends a hit to `eliminateMinion`; *Fateful Strike* `eliminateNazgulIfHit` (Nazgûl → reinforcements); *Heroic Death* `sacrificeLeaderToCancelHit`. **Pre-combat timing cards are modelled in initiative order** (`resolvePreCombat`, lower-first/defender-ties): *Scouts* (`retreatBeforeCombat`) retreats the FP defender before the roll; *Durin's Bane* (`preCombatAttackDice`: 3 dice, hits on 4+) rolls a special attack first — reproducing the rulebook's own example (Scouts@1 resolves before Durin's Bane@2, so the FP army escapes). **All combat-card effect classes are now modelled.** **Residual simplifications:** the initiative-ordered pipeline is implemented for the timing cards specifically (other effects are commutative mods, so order is immaterial); the defender now **chooses the retreat destination** when more than one free adjacent region exists (`retreatTo` choice; a single destination still auto-resolves). Truly-minor residuals: playing *Mighty Attack* commits its `guaranteedHit` (the card text gives no separate decline); pre-combat-attack casualties auto-resolve (no casualty prompt); ≤5-round safety cap; unrecognized combat-card preconditions default to playable (all modelled cards' preconditions ARE handled). | D5 essentially closed — only the listed residual simplifications remain. |
| D6 | Hunt damage (p.41-42) | FP chooses casualty vs Corruption; re-roll conditions | Now INTERACTIVE: `hunt.ts` prompts FP (PendingChoice 'huntDamage') to absorb as Corruption or lose the Guide / a random Companion (excess → Corruption); Guide reassigns (Gollum if none). Re-roll conditions (Shadow Stronghold / Army / Nazgûl in the region) modelled. **Guide Hunt abilities are now applied** as `huntDamage` options: Meriadoc/Peregrin may separate to reduce damage −1 (`reduceSeparate`, via separateCompanion — Guide reassigns); Gollum suppresses a numbered tile's Reveal (passive) and may reveal to reduce damage −1 (`reduceReveal`); reductions re-prompt until absorbed. (Adding these FP defenses moved the heuristic soak toward balance — FP wins 101→137 of 300 — exactly the skew-closes-by-fidelity dynamic.) **On-table damage-REDUCTION cards are wired** (`reduceCard`): *Axe and Bow* (Gimli/Legolas) and *Horn of Gondor* (Boromir) play on the table via their `onTable` handlers, then may be discarded during the Hunt for −1 damage. **Special Hunt tiles now enter the pool on Mordor:** the 8 special-tile Event cards (fp-char-01–04, sh-char-01–04) put a tile `specialsInPlay`; `enterMordor` moves them to `specialsInPool`; `drawTile` draws across the standard + special pools (reshuffling both via `specialsDrawn`). FP tiles (Phial −2, Sméagol −1) heal, Shadow tiles (Shelob's Lair, The Ring is Mine!, etc.) add damage/stop. **With this, the heuristic soak is essentially balanced — FP 153 / Shadow 147 of 300** (from 102/198 before the Hunt-fidelity work — the skew closed by faithfulness, not tuning). **The draw-intercepting on-table cards are wired** via a small resumable flow: *Wizard's Staff* (Gandalf-grey) prompts a BLIND `huntPreventDraw` before the tile (discard to skip the draw entirely); *Mithril Coat and Sting* prompts `huntRedraw` after the tile is seen (discard to return it to the pool and draw a second). **D6 is fully closed** — every Hunt-damage / Guide / on-table / special-tile rule is now modelled. | — closed. |

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
