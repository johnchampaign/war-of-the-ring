#!/usr/bin/env vite-node
// probe-panel-board-split.mjs — two player reports, 2026-09-10:
//
//   6y3j4u31164n1c5r: "You can already attack a Stronghold from the 'What do you want
//     to move?' modal, so, for consistency with regular attacks, let's remove the
//     duplicated option from the Action list in the right side panel."
//   2j4j710i000x3k0b: "You can already play figures using the 'What do you want to
//     move?' modal… and because some Characters have a massive list of valid regions
//     which clogs up the list of Actions, let's remove the duplicated options from the
//     Action list (that is, the 'Bring {character} into play in {region}' Actions)."
//
// Removing a button is only safe if the board really does reach the action, so the
// headline check is not "is it gone" but: OVER FULL GAMES, every legal action is
// reachable from SOMEWHERE. There are exactly three surfaces — the action list, the
// decision modal (mid-combat / mid-Hunt prompts, `isDecisionAction`), and a documented
// path in BOARD_PATH. An action on none of them is one the player cannot take.
//
// It also pins the two specific removals, and the two look-alikes that must NOT be
// removed with them: bringUpgrade (crowning Aragorn / Gandalf the White) and
// sarumanMuster carry no region, so they have no board path and must stay buttons.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { panelShowsAction, BOARD_PATH, isSpatial } from '../src/play/panelFilter.ts';
import { describeAction, isDecisionAction } from '../src/play/actionText.ts';

/** The three surfaces an action can be offered on. */
const reachable = (a, legal, state) =>
  panelShowsAction(a, legal, state) || isDecisionAction(a) || !!BOARD_PATH[a.kind];

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const GAMES = arg('--games', 6);
const MAX_ACTIONS = 20000;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// --- 1. the property: nothing legal is unreachable --------------------------------
console.log(`\n=== every legal action is reachable (list, decision modal, or board), ${GAMES} full games ===`);
{
  const unreachable = new Map();       // kind -> one example label
  const seen = { panel: new Map(), board: new Map(), modal: new Map() };
  let actions = 0, games = 0;

  for (let g = 1; g <= GAMES; g++) {
    const rng = new Rng(g * 7919);
    let state = startGame(createGame({ seed: g * 7919 }));
    for (let n = 0; n < MAX_ACTIONS; n++) {
      if (wotrAdapter.result(state)) break;
      const actor = wotrAdapter.currentActor(state);
      if (!actor) break;
      const legal = wotrAdapter.legalActions(state, actor);
      if (!legal.length) break;
      for (const a of legal) {
        actions++;
        const tally = panelShowsAction(a, legal, state) ? seen.panel
          : isDecisionAction(a) ? seen.modal : seen.board;
        tally.set(a.kind, (tally.get(a.kind) ?? 0) + 1);
        if (!reachable(a, legal, state) && !unreachable.has(a.kind)) {
          let label; try { label = describeAction(a); } catch { label = JSON.stringify(a); }
          unreachable.set(a.kind, label);
        }
      }
      state = wotrAdapter.applyAction(state, chooseAction(state, actor, legal, rng), actor);
    }
    games++;
  }

  check(`played ${games} games / ${actions} offered actions`, games === GAMES && actions > 5000, `${actions} actions`);
  check('no legal action is off every surface (list / modal / board)', unreachable.size === 0,
    unreachable.size ? [...unreachable].map(([k, l]) => `${k} ("${l}")`).join(', ') : '');
  // Both halves must actually be exercised, or the check above passes by never looking.
  check('the list was exercised', seen.panel.size > 5, `${seen.panel.size} kinds`);
  check('the board paths were exercised', seen.board.size > 3, `${seen.board.size} kinds`);
  check('the decision modal was exercised', seen.modal.size > 3, `${seen.modal.size} kinds`);
  for (const kind of ['attack', 'moveArmy', 'recruitUnit']) {
    check(`${kind} was offered and is board-driven`, seen.board.has(kind) && !seen.panel.has(kind));
  }
  console.log(`    list kinds : ${[...seen.panel.keys()].sort().join(', ')}`);
  console.log(`    board kinds: ${[...seen.board.keys()].sort().join(', ')}`);
  console.log(`    modal kinds: ${[...seen.modal.keys()].sort().join(', ')}`);
}

// --- 2. the two removals, and the two look-alikes that stay ----------------------
console.log('\n=== the two reported duplicates are gone from the list ===');
{
  const view = startGame(createGame({ seed: 4 }));
  const shows = (a, legal = [a]) => panelShowsAction(a, legal, view);

  const assault = { kind: 'attack', from: 'minas-tirith', to: 'minas-tirith' };
  check('a siege assault (attack from === to) is NOT a button', !shows(assault));
  check('…and it is spatial, so the board owns it', isSpatial(assault));
  check('…with a documented board path', !!BOARD_PATH.attack, BOARD_PATH.attack);

  const minion = { kind: 'bringMinion', minion: 'witch-king', region: 'morannon' };
  check('"Bring the Witch-king into play in Morannon" is NOT a button', !shows(minion));
  check('…with a documented board path', !!BOARD_PATH.bringMinion, BOARD_PATH.bringMinion);

  // The look-alikes. Both are region-less, so there is nothing on the map to click.
  check('crowning Aragorn IS still a button', shows({ kind: 'bringUpgrade', which: 'aragorn' }));
  check('Gandalf the White IS still a button', shows({ kind: 'bringUpgrade', which: 'gandalf-white' }));
  check('the Voice of Saruman muster IS still a button', shows({ kind: 'sarumanMuster', mode: 'recruit' }));
  check('a plain attack on an enemy region is still board-only', !shows({ kind: 'attack', from: 'morannon', to: 'minas-tirith' }));
  check('Pass is still a button', shows({ kind: 'pass' }));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
