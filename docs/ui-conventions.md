# UI conventions

Patterns the play screen keeps consistent. Check this before adding a new
board-driven step, so it looks like the ones players already know. (Started for player
report 20735e000s6b3s1d: "think carefully about what the green vs. orange highlights
represent, then apply that pattern consistently and document it somewhere".)

## Region highlights: green and orange

| colour | meaning | examples |
|---|---|---|
| **green** outline (`highlights.sources`) | *pick what to act with* — a click here starts something | an Army you can move or attack with; a Settlement you can muster in; a region holding a Character or Nazgûl you can move; a green Army for the second Army move |
| **orange** outline, thicker (`highlights.destinations`) | *pick where the thing already chosen goes* — a click here finishes the step | where the selected Army can move or attack; where a Character, Nazgûl or Companion group can go; a separation's landing; an Event card's target; a **Minion entering play**; **Gandalf the White's entry**; the Fellowship's **declare** or **reveal** spot; a **retreat** (and the Eagles' refuge) |
| **yellow** outline | the region you have selected | the Army whose move you are planning |
| **gold ★** banner on a region | an orange destination that also **rouses a Nation** | a separation into a passive Nation's City |

The test is the question being asked. "Which of your things?" is green. "Where does
it go?" is orange — even when nothing on the board was clicked first, because the
thing was chosen another way (a panel button, a card, the game itself: Gandalf the
White arriving, the Ring-bearers being revealed, an Army having to fall back).

Code: `PlayPage.tsx` builds `highlights` (every placement set joins `charGoals`, which
become destinations); `Board.tsx` draws them.

## Instruction banners

- **The map banner, at the foot of the board**, names a pick the board is waiting
  for: what is being placed or moved, and what to click. There is one, and every
  board pick uses it — Minion entry and retreats used to put a second, brown banner at
  the top of the screen. A card roll that leads into the pick (a retreat after The
  Spirit of Mordor or the Dead Men) shows its dice inside it.
- **The side panel** shows a green "Map" line for each kind of board action open
  right now ("Move or attack — click a highlighted region." — the tag says where, so
  the line never adds "on the map"), and a brown
  ⚑ note when the game is waiting on a board click with nothing to choose in the
  panel.
- The brown ⚠ message on the map is a refusal ("why can't I do that?"); click it to
  dismiss.

## Being in the middle of an Action

Once a step is committed — the game is waiting on a board click (Gandalf the White's
entry, a reveal, a retreat), or a panel button started a placement (bringing a Minion
into play with more than one possible region) — the side panel clears down to that one
step, and the die paying for it stays picked out in your tray. A placement started from
the panel is the one kind that can still be backed out of: click anywhere else on the
map, and the die is released again.

## Event cards

While an Event card is resolving and its next step is a click on the map, the side
panel shows **one** green "Map" line naming the card and what to click ("The
Ringwraiths Are Abroad: click a region with Nazgûl, then where they fly."). It does not show the Action-die lines ("Move or attack",
"Muster"): those describe what a die could do, and the die is already spent on the
card. Steps the card asks for in the panel (a Nation, a yes/no) stay panel buttons.
Player report 675k70191l1c724t: The Ringwraiths Are Abroad showed "No actions" while
other cards showed the die's "Move or attack".
A card whose next step is ONE region click — striking an Army (The Spirit of Mordor,
the Eagles…) or Cruel Weather's region — is named by the **map banner** instead, like
declaring the Fellowship, and the panel shows only a brown ⚑ "Finish the card first"
note (player report 5u216m0a0x3v0362).
