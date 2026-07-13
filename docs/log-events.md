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
| `combat` | battle declaration, combat cards, round dice, casualties, eliminations, outcome | round dice: `{ round, region, attacker: { dice, rerolls, target, hits }, defender: { … } }`; battle end: `{ from, to, attacker, rounds, atkLosses, defLosses, captured, siege, outcome }` |
| `hunt` | hunt rolls, tile draws, hunt damage / corruption | hunt roll: `{ level, bonus, dice: number[], rerolls: number[], successes }` |
| `fellowship` | fellowship movement, hiding, guide changes, companion separation | — |
| `army` | army movement / attacks-adjacent moves | — |
| `muster` | recruitment and reinforcement placement | — |
| `politics` | political-track advancement / nation activation | — |
| `victory` | victory declaration | — |
| `undo` | an undo was applied | — |

Secret (`side`-tagged, `secret: true`) entries today: a combat-card play
before the reveal (`combat`, `src/engine/combat.ts`) and a face-down
hand-limit discard (`event`, `src/adapter/wotrAdapter.ts`).

When adding a new kind or payload, add a row here (house rule — see Star
Wars Rebellion's `docs/log-events.md` for the reference style).
