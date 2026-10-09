#!/usr/bin/env vite-node
// probe-advance-keeps-siege.mjs — a besieging Army that attacks OUT of its siege and
// advances still holds the siege with its rearguard. The soak caught the advance
// asking "is anyone still besieging?" before the rearguard had rejoined: the field
// looked empty, the siege was lifted and the garrison stepped out, and then the
// rearguard landed beside it — Dwarves sharing Erebor with a Sauron Elite.
// Also pins the companion fix from the same soak: a card route ignores a Nation listed
// with zero units (an empty North entry barred Through a Day and a Night's route).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const sides = (r) => new Set(Object.entries(r.units).filter(([, u]) => u.regular + u.elite > 0).map(([n]) => ['sauron', 'isengard', 'southrons'].includes(n) ? 'shadow' : 'fp'));
const SH = ['sauron', 'isengard', 'southrons'];

for (const how of ['whole', 'part']) {
  console.log(`\n=== a besieger attacks out, wins and advances (${how}) — the rearguard keeps the siege ===`);
  let s = startGame(createGame({ seed: 31 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['army']; s.dice.shadow = [];
  for (const n of ['north', 'dwarves', 'sauron']) { s.nations[n].active = true; s.nations[n].step = 0; }
  s.cards.fp.hand = []; s.cards.shadow.hand = [];
  // Erebor: a Sauron Elite boxed inside; the Free Peoples besiege it with North and Dwarves.
  const e = s.regions['erebor'];
  e.units = { north: { regular: 3, elite: 0 }, dwarves: { regular: 2, elite: 0 } };
  e.leaders = 0; e.characters = []; e.control = 'shadow'; e.besieged = true;
  e.siegeBox = { units: { sauron: { regular: 0, elite: 1 } }, leaders: 0, nazgul: 0, characters: [] };
  // Dale: one Sauron Regular, sure to fall.
  s.regions['dale'].units = { sauron: { regular: 1, elite: 0 } }; s.regions['dale'].characters = []; s.regions['dale'].leaders = 0;
  const atk = { kind: 'attack', from: 'erebor', to: 'dale', die: 'army', rearguard: { units: { dwarves: { regular: 2 } } } };
  const res = wotrAdapter.tryApplyAction(s, atk, 'fp');
  check('the attack with a Dwarf rearguard is accepted', res.ok, res.reason ?? '');
  if (!res.ok) continue;
  s = res.state;
  for (let i = 0; i < 40 && s.pendingChoice?.kind !== 'advanceChoice'; i++) {
    const actor = wotrAdapter.currentActor(s); if (!actor) break;
    const legal = wotrAdapter.legalActions(s, actor);
    const pick = legal.find((a) => a.kind === 'continueAttack' && a.cont) ?? legal.find((a) => a.kind === 'retreat' && a.retreat === false) ?? legal.find((a) => /pass|skip|noCard/i.test(a.kind) || a.card === null) ?? legal[0];
    s = wotrAdapter.applyAction(s, pick, actor);
  }
  check('the Free Peoples are asked whether to advance', s.pendingChoice?.kind === 'advanceChoice', s.pendingChoice?.kind ?? 'none');
  if (s.pendingChoice?.kind !== 'advanceChoice') continue;
  const north = s.regions['erebor'].units.north?.regular ?? 0;
  const adv = how === 'whole' ? { kind: 'advanceChoice', advance: true } : { kind: 'advanceChoice', advance: true, move: { units: { north: { regular: Math.max(1, north - 1) } } } };
  s = wotrAdapter.applyAction(s, adv, 'fp');
  const er = s.regions['erebor'];
  check('Erebor is still under siege', er.besieged === true && !!er.siegeBox, `besieged=${er.besieged}`);
  check('the Sauron Elite is still in the box', er.siegeBox?.units?.sauron?.elite === 1, JSON.stringify(er.siegeBox));
  check('the open field holds only Free Peoples units', !sides(er).has('shadow') && (er.units.dwarves?.regular ?? 0) === 2, JSON.stringify(er.units));
}

console.log('\n=== a card route ignores a Nation listed with no units ===');
{
  let s = startGame(createGame({ seed: 31 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['event']; s.dice.shadow = [];
  s.nations.north.active = false;
  // Dale: one Elven Elite with Gandalf, plus an EMPTY North entry left from a lost unit.
  s.regions['dale'].units = { north: { regular: 0, elite: 0 }, elves: { regular: 0, elite: 1 } };
  s.regions['dale'].characters = ['gandalf-white']; s.regions['dale'].leaders = 0;
  s.cards.fp.hand = ['fp-str-12'];
  const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-str-12');
  check('Through a Day and a Night is playable', !!play);
  if (play) {
    s = wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'fp');
    const offers = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'eventTarget' && a.from === 'dale' && a.to && a.to !== 'dale');
    const refused = offers.map((o) => [o.to, wotrAdapter.tryApplyAction(s, o, 'fp')]).filter(([, r]) => !r.ok);
    check(`every offered move from Dale is accepted (${offers.length} offered)`, offers.length > 0 && refused.length === 0,
      refused.map(([t, r]) => `${t}: ${r.reason}`).join(' | '));
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
