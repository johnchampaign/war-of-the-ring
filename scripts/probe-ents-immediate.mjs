#!/usr/bin/env vite-node
// probe-ents-immediate.mjs — The Ents Awake: "If Gandalf the White is in Fangorn or a
// Rohan region, you may IMMEDIATELY play another Character Event card from your hand
// without using an Action die." The free play used to be a flag consumed by the FP's
// NEXT action, so the Shadow got a turn in between (player report 3n1e6o226t0f541b).
// Now a freeCharEvent choice is raised as soon as the card's own casualty choice (if
// any) is settled, and the Shadow does not act until it is answered.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const setup = () => {
  const s = startGame(createGame({ seed: 51 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['character', 'army']; s.dice.shadow = ['army', 'muster'];
  s.characters.entered.push('gandalf-white'); s.characters.inPlay['gandalf-white'] = 'fangorn';
  s.regions['fangorn'].characters.push('gandalf-white');
  s.regions['orthanc'].units = { isengard: { regular: 3, elite: 1 } };
  // Hand: The Ents Awake plus a few more Character cards off the deck, so at least
  // one is playable in this position (turn 1's two-card hand has only one Character).
  const fp = s.cards.fp;
  const deck = Object.values(fp).find((v) => v && typeof v === 'object' && Array.isArray(v.character) && v !== fp.discard);
  // (Kept at five cards: over six the hand-limit discard would interpose its own choice.)
  fp.hand = ['fp-char-19', ...fp.hand.filter((id) => id !== 'fp-char-19'), ...deck.character.splice(0, 3)];
  return s;
};
const drive = (s) => { // answer any SHADOW casualty choice the Ents hits raise
  let guard = 10;
  while (s.pendingChoice && s.pendingChoice.owner === 'shadow' && guard-- > 0) {
    const a = wotrAdapter.legalActions(s, 'shadow')[0];
    s = wotrAdapter.applyAction(s, a, 'shadow');
  }
  return s;
};

console.log('\n=== the free play is offered immediately, before the Shadow acts ===');
let s = setup();
const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-char-19');
check('The Ents Awake is playable', !!play);
s = drive(wotrAdapter.applyAction(s, { ...play, die: 'character' }, 'fp'));
check('a freeCharEvent choice is pending for the Free Peoples', s.pendingChoice?.kind === 'freeCharEvent' && s.pendingChoice.owner === 'fp', JSON.stringify(s.pendingChoice));
check('the Shadow has NOT been given the turn', wotrAdapter.currentActor(s) === 'fp', `actor ${wotrAdapter.currentActor(s)}`);
const legal = wotrAdapter.legalActions(s, 'fp');
const cards = legal.filter((a) => a.kind === 'playEvent');
check('the choice lists playable Character cards plus decline', cards.length > 0 && legal.some((a) => a.kind === 'freeCharEvent' && a.decline), `${cards.length} cards, ${legal.length} options`);
if (cards.length) {
  const diceBefore = s.dice.fp.length;
  s = drive(wotrAdapter.applyAction(s, cards[0], 'fp'));
  check('the card played without spending a die', s.dice.fp.length === diceBefore, `dice ${diceBefore} -> ${s.dice.fp.length}`);
  check('the free play is consumed', !s.flags.fpFreeCharEventThisTurn && !s.flags.fpFreeCharEventPrompt);
  check('...and now the Shadow acts', s.pendingChoice === null ? wotrAdapter.currentActor(s) === 'shadow' : true, `actor ${wotrAdapter.currentActor(s)}, pending ${s.pendingChoice?.kind ?? 'none'}`);
}

console.log('\n=== declining ends it — no free play later in the turn ===');
s = setup();
s = drive(wotrAdapter.applyAction(s, { ...wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-char-19'), die: 'character' }, 'fp'));
if (s.pendingChoice?.kind === 'freeCharEvent') {
  s = wotrAdapter.applyAction(s, { kind: 'freeCharEvent', decline: true }, 'fp');
  check('declined: flag cleared, Shadow to act', !s.flags.fpFreeCharEventThisTurn && wotrAdapter.currentActor(s) === 'shadow', `actor ${wotrAdapter.currentActor(s)}`);
} else check('prompt was raised', false, JSON.stringify(s.pendingChoice));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
