#!/usr/bin/env vite-node
// probe-card-targets-on-board.mjs — Event-card RECRUITS and card-granted ARMY MOVES
// are board flows (the muster menu / click-army-then-destination), not modal picks
// or list buttons (player report 2s3p6y0x000k6b70: "Event card recruitment should
// use that interface ... likewise all movement affected by Event cards").
//
// Two halves: the predicates on hand-built shapes, and a sweep over real games
// proving that real cards actually produce those shapes (so the board path is not
// a dead letter) and that nothing becomes unreachable.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { panelShowsAction, BOARD_PATH } from '../src/play/panelFilter.ts';
import { isCardRecruitTarget, isCardArmyMoveTarget, eventChoiceInModal, isDecisionAction } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const view = startGame(createGame({ seed: 3 }));

console.log('\n=== shapes: what goes where ===');
const recruit = { kind: 'eventTarget', card: 'fp-str-14', region: 'edoras', nation: 'rohan', figure: 'regular', slot: 1 };
const done = { kind: 'eventTarget', card: 'fp-str-14', done: true };
const move = { kind: 'eventTarget', card: 'sh-str-11', from: 'morannon', to: 'dagorlad', mode: 'move' };
const cardAttack = { kind: 'eventTarget', card: 'sh-char-23', from: 'dagorlad', to: 'osgiliath', mode: 'attack' };
const assault = { kind: 'eventTarget', card: 'sh-char-14', from: 'minas-tirith', to: 'minas-tirith', mode: 'attack' };
const strike = { kind: 'eventTarget', card: 'sh-char-19', region: 'osgiliath' };
// A region-only pick the HANDLER flags as a recruitment (Shadows on the Misty
// Mountains, Hordes From the East, Many Kings, Pits of Mordor).
const regionRecruit = { kind: 'eventTarget', card: 'sh-str-19', region: 'moria', mode: 'recruit' };
const sep = { kind: 'eventTarget', card: 'fp-str-11', region: 'lorien', companion: 'legolas' };
check('a card recruit is a board muster', isCardRecruitTarget(recruit) && !panelShowsAction(recruit, [recruit, done], view));
check('...and does not open the modal', !eventChoiceInModal([recruit, done]));
check('the "done" option of the same card stays a button', panelShowsAction(done, [recruit, done], view));
check('a card army move is a board move', isCardArmyMoveTarget(move) && !panelShowsAction(move, [move, done], view));
check('a card attack with a destination is a board move too', isCardArmyMoveTarget(cardAttack) && !panelShowsAction(cardAttack, [cardAttack], view));
check('a card siege ASSAULT (from === to) is neither — it keeps its button', !isCardArmyMoveTarget(assault) && panelShowsAction(assault, [assault], view));
check('a region-only pick (Dreadful Spells) is still a modal pick', !isCardRecruitTarget(strike) && eventChoiceInModal([strike]));
check('a region-only pick FLAGGED as a recruit is a board muster', isCardRecruitTarget(regionRecruit) && !panelShowsAction(regionRecruit, [regionRecruit], view) && !eventChoiceInModal([regionRecruit]));
check('a companion placement is neither (it has its own board path)', !isCardRecruitTarget(sep) && !isCardArmyMoveTarget(sep));

console.log('\n=== real games: cards do produce these shapes, and nothing is stranded ===');
{
  let recruits = 0, moves = 0, stranded = 0, actions = 0;
  const seenCards = new Set();
  for (let g = 1; g <= 8; g++) {
    const rng = new Rng(g * 104729);
    let s = startGame(createGame({ seed: g * 104729 }));
    for (let n = 0; n < 20000 && !wotrAdapter.result(s); n++) {
      const actor = wotrAdapter.currentActor(s); if (!actor) break;
      const legal = wotrAdapter.legalActions(s, actor); if (!legal.length) break;
      for (const a of legal) {
        actions++;
        if (isCardRecruitTarget(a)) { recruits++; seenCards.add(a.card); }
        if (isCardArmyMoveTarget(a)) { moves++; seenCards.add(a.card); }
        if (!(panelShowsAction(a, legal, s) || isDecisionAction(a) || !!BOARD_PATH[a.kind])) stranded++;
      }
      s = wotrAdapter.applyAction(s, chooseAction(s, actor, legal, rng), actor);
    }
  }
  check('card recruit targets occur in play', recruits > 0, `${recruits} over ${actions} legal actions`);
  check('card army-move targets occur in play', moves > 0, `${moves}; cards: ${[...seenCards].join(', ')}`);
  check('no legal action is off every surface', stranded === 0, `${stranded} stranded`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
