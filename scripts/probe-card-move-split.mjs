#!/usr/bin/env vite-node
// probe-card-move-split.mjs — deviation D15 closed: an Army moved by an Event card
// may be SPLIT before moving (rulebook p.28, "Using an Event Card to Move Armies":
// "it is possible to split the Army before moving"). The eventTarget action carries
// an optional MoveSel; moveAllUnits applies a sanitized subset, falling back to the
// whole Army when the clamped selection moves nothing.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Fresh board with two Shadow armies placed for Shadows Gather (≤3 regions apart). */
function board() {
  const state = startGame(createGame({ seed: 3 }));
  state.regions['dol-guldur'].units = { sauron: { regular: 4, elite: 2 } };
  state.regions['dol-guldur'].nazgul = 1;
  state.regions['north-dunland'].units = {}; // clear noise between the two armies
  return state;
}

// --- a split moves only the selected subset ---------------------------------------
{
  console.log('\n=== Shadows Gather: split — 2R move, the rest hold ===');
  const state = board();
  const t = getHandler('sh-str-07').targets(state, 'shadow').find((x) => x.from === 'dol-guldur');
  check('a Dol Guldur move is offered', !!t, JSON.stringify(t));
  getHandler('sh-str-07').applyTarget(state, 'shadow', { ...t, move: { units: { sauron: { regular: 2 } } } });
  const src = state.regions['dol-guldur'], dst = state.regions[t.to];
  check('2 Regulars arrive', (dst.units.sauron?.regular ?? 0) >= 2);
  check('the remainder holds Dol Guldur', src.units.sauron?.regular === 2 && src.units.sauron?.elite === 2,
    JSON.stringify(src.units));
  check('the unselected Nazgûl stays behind', src.nazgul === 1);
}

// --- the selection is sanitized (clamped); an empty one is REFUSED ------------------
{
  console.log('\n=== sanitization: over-ask clamps; a no-unit selection is refused ===');
  const s1 = board();
  const t1 = getHandler('sh-str-07').targets(s1, 'shadow').find((x) => x.from === 'dol-guldur');
  getHandler('sh-str-07').applyTarget(s1, 'shadow', { ...t1, move: { units: { sauron: { regular: 99 } }, nazgul: 5 } });
  check('an over-ask clamps to what exists (4R + the 1 Nazgûl move)',
    !s1.regions['dol-guldur'].units.sauron?.regular && s1.regions['dol-guldur'].units.sauron?.elite === 2 && s1.regions['dol-guldur'].nazgul === 0,
    JSON.stringify({ units: s1.regions['dol-guldur'].units, nazgul: s1.regions['dol-guldur'].nazgul }));

  // It used to move the WHOLE Army instead, so an empty tick-list was read as "move
  // everything" — the player's selection overruled with no message (2w0k3j4k1q026q3r).
  const s2 = board();
  const t2 = getHandler('sh-str-07').targets(s2, 'shadow').find((x) => x.from === 'dol-guldur');
  let emptyRefused = false;
  try { getHandler('sh-str-07').applyTarget(s2, 'shadow', { ...t2, move: { units: {} } }); } catch { emptyRefused = true; }
  check('a selection with no units is refused', emptyRefused);
  check('and the Army has not budged',
    s2.regions['dol-guldur'].units.sauron?.regular === 4 && s2.regions['dol-guldur'].nazgul === 1,
    JSON.stringify(s2.regions['dol-guldur'].units));
}

// --- FP Leaders are never stranded unitless on a card-move split -------------------
{
  console.log('\n=== Through a Day and a Night: a full vacate takes the FP Leaders along ===');
  const state = startGame(createGame({ seed: 3 }));
  // An FP Army with a Companion (the card's requirement) plus 2 Leaders.
  state.regions['edoras'].units = { rohan: { regular: 2, elite: 0 } };
  state.regions['edoras'].leaders = 2;
  state.regions['edoras'].characters = ['boromir'];
  const t = getHandler('fp-str-12').targets(state, 'fp').find((x) => x.from === 'edoras');
  check('an Edoras move is offered', !!t, JSON.stringify(t));
  // "Move the Army containing the Companion(s)" — the Almanac spells it out: "at least
  // one Companion must move along with the Army". A split that leaves every Companion
  // behind is not this card (player report 0c2d6s4y07386h19).
  let refused = false;
  try { getHandler('fp-str-12').applyTarget(state, 'fp', { ...t, move: { units: { rohan: { regular: 2 } }, leaders: 0 } }); }
  catch { refused = true; }
  check('a split with no Companion among the movers is refused', refused);
  // The selection vacates every unit but claims to leave the Leaders behind — p.27 says
  // FP Leaders can never stand without units, so the selection is impossible and is now
  // REFUSED (it used to drag the Leaders along without a word, 2w0k3j4k1q026q3r).
  let strandRefused = false;
  try { getHandler('fp-str-12').applyTarget(state, 'fp', { ...t, move: { units: { rohan: { regular: 2 } }, leaders: 0, characters: ['boromir'] } }); }
  catch { strandRefused = true; }
  check('a split that would strand the Leaders is refused', strandRefused);
  check('and nothing moved', state.regions['edoras'].leaders === 2 && state.regions['edoras'].units.rohan?.regular === 2);
  // Taking them along is the legal answer.
  getHandler('fp-str-12').applyTarget(state, 'fp', { ...t, move: { units: { rohan: { regular: 2 } }, leaders: 2, characters: ['boromir'] } });
  check('taking the Leaders along is allowed',
    state.regions['edoras'].leaders === 0 && state.regions[t.to].leaders === 2,
    `left behind: ${state.regions['edoras'].leaders}, arrived: ${state.regions[t.to].leaders}`);
  check('the selected Companion travels with the Army',
    !state.regions['edoras'].characters.includes('boromir') && state.regions[t.to].characters.includes('boromir'),
    `edoras: ${JSON.stringify(state.regions['edoras'].characters)}, ${t.to}: ${JSON.stringify(state.regions[t.to].characters)}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
