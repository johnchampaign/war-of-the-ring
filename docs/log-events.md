# Log events (log-format v2)

WotR's `state.log` uses the framework's structured log format
(`GameLogEntry` from `digital-boardgame-framework` >= 0.42.0), extended in
`src/engine/types.ts` (`LogEntry`) with WotR extras. Every entry flows
through the single choke point `log()` in `src/engine/log.ts`, which uses
`appendGameLog` — stamping a monotonic `seq` (stable across capping), the
current `turn` and `phase`, and capping the in-state log at 500 entries.

Entry shape:

- `seq` — monotonic event index (survives capping)
- `turn`, `phase` — stamped at append time
- `side` — `null` = public; a side = the entry is about/for that side
- `secret` — `true` on side-private entries (only that side sees them in
  redacted views; `src/adapter/redact.ts` filters on this)
- `kind`, `msg` — event id + UI rendering
- `payload` — structured data on high-value events (below)
- WotR extras stamped by the adapter dispatch: `die` (action die spent),
  `actor` (acting player, public), `card` (event/combat card id for hover)

## Kinds currently emitted

| kind | meaning | payload |
| --- | --- | --- |
| `setup` | game created (first entry) | — |
| `roll` | action-dice roll at turn start | `{ fp: DieFace[], shadow: DieFace[], eyes: number, huntBox: number }` |
| `pass` | a player passes their action | — |
| `event` | event-card play/draw/discard and card effects | — |
| `combat` | battle declaration, combat cards, round dice, casualties, eliminations, outcome | declaration: `{ from, to, attacker, attackerForce, defenderForce, siege, sortie }` — each force as `"2R, 5E, Saruman (5 dice, Leadership 5)"`, read after the rearguard split so it names the force that actually fights (armies are public, and players asked to be able to audit a battle's dice and re-rolls); round dice: `{ round, region, attacker: { dice, rerolls, target, hits }, defender: { … } }`; battle end: `{ from, to, attacker, rounds, atkLosses, defLosses, captured, siege, outcome }` |
| `hunt` | hunt rolls, tile draws, hunt damage / corruption | hunt roll: `{ level, bonus, dice: number[], rerolls: number[], successes }` |
| `fellowship` | fellowship movement, hiding, guide changes, companion separation | — |
| `army` | army movement / attacks-adjacent moves | — |
| `muster` | recruitment and reinforcement placement | — |
| `politics` | political-track advancement / nation activation | — |
| `victory` | victory declaration | — |
| `undo` | an undo was applied | — |

## Two standing invariants (both came from players auditing the log)

- **Every card that enters a hand is logged** — turn-start draws, an Event die
  spent to draw, a card whose own text draws, Gandalf the Grey's Guide draw, the
  Palantír bonus draw, the Witch-king's Sorcerer draw. The line names the deck
  and the reason, never the card (identity stays secret); `logCardDraw()` in
  `src/engine/log.ts` is the choke point, and there are exactly three places a
  card is pushed into a hand. Drawing used to be silent, so a hand that grew
  mid-turn was unexplainable — a player found the Free Peoples playing more
  cards than they had drawn, and neither he nor we could reconstruct it (it was
  King Brand's Men, whose text draws a Strategy card). Guarded by
  `scripts/probe-card-accounting.mjs`.
- **Every Hunt tile drawn outside the normal Fellowship-move Hunt names its
  cause** — `extraHunt(state, { source })`. Sources today: an Event card's own
  name, `Balrog of Moria`, and `revealed through <Stronghold>`. A player
  declared in Lórien, took 3 Corruption and reported a Hunt that "shouldn't have
  happened"; it was the Balrog firing on a path through Moria, with nothing in
  the log saying so. Guarded by `scripts/probe-hunt-attribution.mjs`. The Hunt
  Box allocation and the end of the Fellowship phase are logged for the same
  reason: both were silent phase steps that made a later Hunt look spontaneous.

Secret (`side`-tagged, `secret: true`) entries today: a combat-card play
before the reveal (`combat`, `src/engine/combat.ts`) and a face-down
hand-limit discard (`event`, `src/adapter/wotrAdapter.ts`).

When adding a new kind or payload, add a row here (house rule — see Star
Wars Rebellion's `docs/log-events.md` for the reference style).
