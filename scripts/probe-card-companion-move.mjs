#!/usr/bin/env vite-node
// probe-card-companion-move.mjs — Gwaihir the Windlord / We Prove the Swifter can MOVE
// Companions already on the map, and that pick is made on the board now: click their
// region, choose from the menu (player report 6f03724h00040z3r). The panel buttons for
// it are gone, so this pins the sequence the board drives — pick one or more
// Companions, then click a destination — and that the panel/board split leaves none of
// it stranded.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { panelShowsAction, BOARD_PATH } from '../src/play/panelFilter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
// The predicate PlayPage uses to put a card's Companion move on the board.
import { isCardCompanionMove } from '../src/play/panelFilter.ts';

const setup = () => {
  const s = startGame(createGame({ seed: 121 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['event', 'character']; s.dice.shadow = [];
  s.fellowship.companions = []; s.fellowship.guide = 'gollum';   // only the MOVE branch is live
  for (const [c, r] of [['legolas', 'lorien'], ['gimli', 'lorien'], ['boromir', 'minas-tirith']]) {
    s.characters.inPlay[c] = r; s.regions[r].characters.push(c);
  }
  s.cards.fp.hand = ['fp-char-15'];
  const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-char-15');
  return wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'fp');
};

console.log('\n=== the move is a board click, not a button ===');
{
  const s = setup();
  const legal = wotrAdapter.legalActions(s, 'fp');
  const moves = legal.filter(isCardCompanionMove);
  check('the card offers the three Companions\' moves', new Set(moves.map((a) => a.companion)).size === 3, `${moves.length} moves`);
  check('none of them is a panel button', moves.every((a) => !panelShowsAction(a, legal, s)));
  check('...and the board path is documented for them', !!BOARD_PATH.eventTarget);
  check('each names the region to click', moves.every((a) => !!a.from), JSON.stringify([...new Set(moves.map((a) => a.from))]));
}

console.log('\n=== one Companion: click his region, then a destination ===');
{
  let s = setup();
  const dests = wotrAdapter.legalActions(s, 'fp').filter(isCardCompanionMove).filter((a) => a.companion === 'legolas');
  check('destinations are offered for him', dests.length > 0, `${dests.length} regions`);
  const to = dests.find((a) => a.region === 'carrock') ?? dests[0];
  s = wotrAdapter.applyAction(s, to, 'fp');
  check(`Legolas stands in ${to.region}`, s.regions[to.region].characters.includes('legolas'), s.characters.inPlay['legolas']);
  check('...and left Lórien', !s.regions['lorien'].characters.includes('legolas'));
  check('Gimli stayed', s.characters.inPlay['gimli'] === 'lorien');
  check('the card finished (no choice left hanging)', s.pendingChoice === null, s.pendingChoice?.kind ?? 'none');
}

console.log('\n=== both together: one action names the group ===');
{
  let s = setup();
  const lor = wotrAdapter.legalActions(s, 'fp').filter(isCardCompanionMove).filter((a) => a.from === 'lorien');
  check('two Companions share Lórien', new Set(lor.map((a) => a.companion)).size === 2, [...new Set(lor.map((a) => a.companion))].join(','));
  const to = lor.find((a) => a.companion === 'legolas');
  s = wotrAdapter.applyAction(s, { ...to, group: ['legolas', 'gimli'] }, 'fp');   // what the picker submits
  const there = s.regions[to.region].characters;
  check(`both travelled to ${to.region}`, there.includes('legolas') && there.includes('gimli'), there.join(','));
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
