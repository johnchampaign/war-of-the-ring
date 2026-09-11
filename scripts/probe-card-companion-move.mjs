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
/** The predicate PlayPage uses to put a card's Companion pick on the board. */
const isCardCharPick = (a) => a.kind === 'eventTarget' && !!a.from && !!a.companion && !a.region && !a.done;

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

console.log('\n=== the pick is a board click, not a button ===');
{
  const s = setup();
  const legal = wotrAdapter.legalActions(s, 'fp');
  const picks = legal.filter(isCardCharPick);
  check('the card asks which Companions travel', picks.length === 3, `${picks.length} picks`);
  check('none of them is a panel button', picks.every((a) => !panelShowsAction(a, legal, s)));
  check('...and the board path is documented for them', !!BOARD_PATH.eventTarget);
  check('each names the region to click', picks.every((a) => !!a.from), JSON.stringify(picks.map((a) => a.from)));
}

console.log('\n=== one Companion: pick, then click a destination ===');
{
  let s = setup();
  const pick = wotrAdapter.legalActions(s, 'fp').filter(isCardCharPick).find((a) => a.companion === 'legolas');
  s = wotrAdapter.applyAction(s, pick, 'fp');
  const dests = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'eventTarget' && a.region && a.companion === 'legolas');
  check('destinations are offered for him', dests.length > 0, `${dests.length} regions`);
  const to = dests.find((a) => a.region === 'carrock') ?? dests[0];
  s = wotrAdapter.applyAction(s, to, 'fp');
  check(`Legolas stands in ${to.region}`, s.regions[to.region].characters.includes('legolas'), s.characters.inPlay['legolas']);
  check('...and left Lórien', !s.regions['lorien'].characters.includes('legolas'));
  check('the card finished (no choice left hanging)', s.pendingChoice === null, s.pendingChoice?.kind ?? 'none');
}

console.log('\n=== both together: the group option submits each pick, then one destination ===');
{
  let s = setup();
  const group = wotrAdapter.legalActions(s, 'fp').filter(isCardCharPick).filter((a) => a.from === 'lorien');
  check('two Companions share Lórien', group.length === 2, group.map((a) => a.companion).join(','));
  for (const a of group) s = wotrAdapter.applyAction(s, a, 'fp');   // what the group menu entry does
  const dests = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'eventTarget' && a.region);
  check('a shared destination is offered', dests.length > 0, `${dests.length}`);
  const to = dests[0];
  s = wotrAdapter.applyAction(s, to, 'fp');
  const there = s.regions[to.region].characters;
  check(`both travelled to ${to.region}`, there.includes('legolas') && there.includes('gimli'), there.join(','));
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
