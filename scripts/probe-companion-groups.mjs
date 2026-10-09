#!/usr/bin/env vite-node
// probe-companion-groups.mjs — ONE set of Companion-group rules (charMove.ts
// companionGroup*): any subset of the Companions in a region travels together at the
// highest Level in it (p.24), and what the picker lights up is exactly what the engine
// accepts. Player reports 3a1z26454w0x6c38 ("I can't move Companions as a group other
// than All Companions and single Companions"), 186w6s0a051h4534, 231u2i4l5p19426w.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { companionGroupLeader, companionGroupRange, companionGroupDestinations, companionGroupBlockReason } from '../src/engine/charMove.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = (comps, where = 'edoras') => {
  const s = startGame(createGame({ seed: 12 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['character']; s.dice.shadow = ['army'];
  for (const c of comps) {
    s.fellowship.companions = s.fellowship.companions.filter((x) => x !== c);
    s.characters.inPlay[c] = where; s.regions[where].characters.push(c);
  }
  if (!s.fellowship.companions.includes(s.fellowship.guide)) s.fellowship.guide = s.fellowship.companions[0];
  return s;
};

console.log('\n=== the group moves at its highest Level ===');
{
  const s = board(['strider', 'legolas', 'peregrin']);
  check('Strider, Legolas and Pippin: Strider leads, range 3', companionGroupLeader(s, 'edoras', ['legolas', 'peregrin', 'strider']) === 'strider' && companionGroupRange(s, 'edoras', ['legolas', 'peregrin', 'strider']) === 3);
  check('Legolas and Pippin: range 2', companionGroupRange(s, 'edoras', ['legolas', 'peregrin']) === 2);
  check('Pippin alone: range 1', companionGroupRange(s, 'edoras', ['peregrin']) === 1);
  const far = companionGroupDestinations(s, 'fp', 'edoras', ['strider', 'peregrin']);
  const near = companionGroupDestinations(s, 'fp', 'edoras', ['peregrin']);
  check('Pippin reaches further with Strider than alone', far.length > near.length && near.every((r) => far.includes(r)), `${near.length} vs ${far.length}`);
  check('an empty group explains itself', /at least one/.test(companionGroupBlockReason(s, 'fp', 'edoras', 'osgiliath', []) ?? ''));
}

console.log('\n=== Shadowfax reads the company Gandalf the White keeps ===');
{
  const s = board(['gandalf-white', 'peregrin', 'strider']);
  check('alone: 4', companionGroupRange(s, 'edoras', ['gandalf-white']) === 4);
  check('with one Hobbit: 4', companionGroupRange(s, 'edoras', ['gandalf-white', 'peregrin']) === 4);
  check('with Strider: 3', companionGroupRange(s, 'edoras', ['gandalf-white', 'strider']) === 3);
}

console.log('\n=== what the picker offers is what the engine accepts, for every subset ===');
{
  const comps = ['strider', 'legolas', 'peregrin'];
  const subsets = [];
  for (let m = 1; m < 8; m++) subsets.push(comps.filter((_, i) => m & (1 << i)));
  let offered = 0, refused = [];
  for (const group of subsets) {
    const s = board(comps);
    const dests = new Set(companionGroupDestinations(s, 'fp', 'edoras', group));
    const leader = companionGroupLeader(s, 'edoras', group);
    for (const to of Object.keys(s.regions)) {
      if (to === 'edoras') continue;
      const act = { kind: 'moveCharacter', char: leader, from: 'edoras', to, die: 'character', ...(group.length > 1 ? { chars: group } : {}) };
      const res = wotrAdapter.tryApplyAction(s, act, 'fp');
      if (dests.has(to)) {
        offered++;
        if (!res.ok) refused.push(`${group.join('+')}→${to}: ${res.reason}`);
        else {
          const moved = group.every((c) => res.state.characters.inPlay[c] === to);
          const stayed = comps.filter((c) => !group.includes(c)).every((c) => res.state.characters.inPlay[c] === 'edoras');
          if (!moved || !stayed) refused.push(`${group.join('+')}→${to}: wrong figures moved`);
        }
      } else if (res.ok) refused.push(`${group.join('+')}→${to}: accepted but not offered`);
    }
  }
  check(`offer and engine agree on all 7 subsets (${offered} offered moves)`, refused.length === 0, refused.slice(0, 4).join(' | '));
}

const playCard = (s, card) => {
  s.dice.fp = ['event', 'muster', 'character']; s.cards.fp.hand = [card];
  const p = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === card);
  return p ? wotrAdapter.applyAction(s, { ...p, die: p.die ?? 'event' }, 'fp') : null;
};

console.log('\n=== Fear! Fire! Foes! moves Companions exactly as a Character die does ===');
{
  let s = playCard(board(['strider', 'legolas', 'peregrin']), 'fp-str-07');
  check('the card is playable and asks for a move', !!s && s.pendingChoice?.kind === 'eventTarget');
  if (s) {
    const offers = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'eventTarget' && a.companion && a.region);
    check('every offer is a one-step move with a starting region (no "separate" pick step)', offers.length > 0 && offers.every((a) => a.from === 'edoras'), `${offers.length} offers`);
    const groupDests = companionGroupDestinations(s, 'fp', 'edoras', ['strider', 'peregrin']);
    const farForPippin = groupDests.find((r) => !companionGroupDestinations(s, 'fp', 'edoras', ['peregrin']).includes(r));
    const bad = wotrAdapter.tryApplyAction(s, { kind: 'eventTarget', card: 'fp-str-07', companion: 'peregrin', from: 'edoras', region: farForPippin }, 'fp');
    check('Pippin alone may not go where only Strider\'s company takes him', !bad.ok && /out of reach/.test(bad.reason ?? ''), bad.reason);
    const res = wotrAdapter.tryApplyAction(s, { kind: 'eventTarget', card: 'fp-str-07', companion: 'strider', from: 'edoras', region: farForPippin, group: ['strider', 'peregrin'] }, 'fp');
    check('Strider and Pippin go there together', res.ok && res.state.characters.inPlay.strider === farForPippin && res.state.characters.inPlay.peregrin === farForPippin && res.state.characters.inPlay.legolas === 'edoras', res.reason);
    if (res.ok) {
      s = res.state;
      const again = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'eventTarget' && a.companion && a.region);
      check('only Legolas may still move under the card', again.length > 0 && again.every((a) => a.companion === 'legolas'), [...new Set(again.map((a) => a.companion))].join(','));
      const twice = wotrAdapter.tryApplyAction(s, { kind: 'eventTarget', card: 'fp-str-07', companion: 'strider', from: farForPippin, region: 'edoras' }, 'fp');
      check('a Companion who moved may not move again', !twice.ok && /already moved/.test(twice.reason ?? ''), twice.reason);
    }
  }
}

console.log('\n=== We Prove the Swifter and Gwaihir carry their range terms into the group ===');
{
  for (const [card, want] of [['fp-char-16', 3], ['fp-char-15', 4]]) {
    const base = board(['legolas', 'peregrin']);
    base.fellowship.companions = []; base.fellowship.guide = 'gollum';
    const s = playCard(base, card);
    check(`${card} is playable with an empty Fellowship`, !!s);
    if (!s) continue;
    const offers = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'eventTarget' && a.from && a.region);
    const pip = offers.filter((a) => a.companion === 'peregrin').map((a) => a.region);
    const opts = card === 'fp-char-16' ? { extraMove: 2, siegeOk: true } : { levelOverride: 4, siegeOk: true };
    check(`Pippin alone reaches ${want} regions`, companionGroupRange(s, 'edoras', ['peregrin'], opts) === want && pip.length === companionGroupDestinations(s, 'fp', 'edoras', ['peregrin'], opts).length);
    const far = companionGroupDestinations(s, 'fp', 'edoras', ['legolas', 'peregrin'], opts).find((r) => !pip.includes(r)) ?? pip[0];
    const res = wotrAdapter.tryApplyAction(s, { kind: 'eventTarget', card, companion: 'legolas', from: 'edoras', region: far, group: ['legolas', 'peregrin'] }, 'fp');
    check('the group moves together under the card', res.ok && res.state.characters.inPlay.legolas === far && res.state.characters.inPlay.peregrin === far, res.reason);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
