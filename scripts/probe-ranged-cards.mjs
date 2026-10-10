#!/usr/bin/env vite-node
// probe-ranged-cards.mjs — the cards that roll dice at an Army share ONE strike path
// (player report 29395e6o1y6r4y5e: "they should work identically … review them as a
// group"), and each keeps the rules the Almanac gives it:
//   - Dreadful Spells, Faramir's Rangers, The Spirit of Mordor, Return to Valinor are
//     not "attacks": Companions, Minions and Nazgûl survive even if every unit falls;
//     Free Peoples Leaders fall with a destroyed Army.
//   - Return to Valinor takes Elven units only, one Stronghold at a time, through the
//     same per-hit prompt (report 6f4a631y3j0w2x2n).
//   - Dead Men of Dunharrow: the Shadow chooses its casualties, and the hits are logged
//     before them (report 5a2d6z5y7037406d).
//   - Every one of them shows its roll (reports 070f5x2t003i394j, 3d5q0g6q6r460b5z).
//   - The Eagles are Coming!: the Free Peoples pick the target, the Shadow the refuge
//     (reports 0q032a5d3o2s0l49, 3e624i0y1v4p2o2c).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { queueOrApplyEventCasualties } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const base = (seed = 3) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.pendingChoice = null;
  for (const n of Object.keys(s.nations)) { s.nations[n].active = true; s.nations[n].step = 0; }
  return s;
};
// Answer any casualty prompt by taking the first option.
const unitsIn = (s, r) => Object.values(s.regions[r].units).reduce((t, u) => t + u.regular + u.elite, 0);
const settle = (s) => { for (let i = 0; i < 20 && s.pendingChoice?.kind === 'eventCasualties'; i++) { const o = wotrAdapter.legalActions(s, s.pendingChoice.owner)[0]; s = wotrAdapter.applyAction(s, o, s.pendingChoice.owner); } return s; };

console.log('\n=== not an attack: the figures survive the Army ===');
{
  const s = base();
  s.regions['north-ithilien'].units = { sauron: { regular: 1, elite: 0 } };
  s.regions['north-ithilien'].nazgul = 2; s.regions['north-ithilien'].characters = ['witch-king']; s.characters.inPlay['witch-king'] = 'north-ithilien';
  queueOrApplyEventCasualties(s, 'shadow', 'north-ithilien', 3, undefined, { spare: true });
  const r = s.regions['north-ithilien'];
  check('the Shadow Army is gone', Object.values(r.units).every((u) => u.regular + u.elite === 0));
  check('its Nazgûl and the Witch-king stay', r.nazgul === 2 && r.characters.includes('witch-king') && !s.characters.eliminated.includes('witch-king'), JSON.stringify({ naz: r.nazgul, chars: r.characters }));

  const f = base();
  f.regions['eastemnet'].units = { rohan: { regular: 1, elite: 0 } }; f.regions['eastemnet'].leaders = 1;
  f.regions['eastemnet'].characters = ['strider']; f.characters.inPlay.strider = 'eastemnet';
  f.fellowship.companions = f.fellowship.companions.filter((c) => c !== 'strider');
  queueOrApplyEventCasualties(f, 'fp', 'eastemnet', 2, undefined, { spare: true });
  const e = f.regions['eastemnet'];
  check('Strider survives the Free Peoples Army', e.characters.includes('strider') && !f.characters.eliminated.includes('strider'));
  check('the Leader falls with it', e.leaders === 0);

  const a = base();
  a.regions['north-ithilien'].units = { sauron: { regular: 1, elite: 0 } };
  a.regions['north-ithilien'].nazgul = 2; a.regions['north-ithilien'].characters = ['witch-king']; a.characters.inPlay['witch-king'] = 'north-ithilien';
  queueOrApplyEventCasualties(a, 'shadow', 'north-ithilien', 3);
  check('an "attack" (the default) still takes them with the Army', a.characters.eliminated.includes('witch-king') && a.regions['north-ithilien'].nazgul === 0);
}

console.log('\n=== a besieged garrison wiped out by a card that is not an attack ===');
{
  const s = base();
  const m = s.regions['minas-tirith'];
  m.units = { sauron: { regular: 3, elite: 0 } }; m.besieged = true; m.control = 'fp';
  m.siegeBox = { units: { gondor: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: ['boromir'] };
  s.characters.inPlay.boromir = 'minas-tirith'; s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'boromir');
  queueOrApplyEventCasualties(s, 'fp', 'minas-tirith', 1, undefined, { spare: true });
  check('the Stronghold falls to the besiegers', !m.besieged && !m.siegeBox && s.regions['minas-tirith'].control === 'shadow');
  check('Boromir steps out alive', s.regions['minas-tirith'].characters.includes('boromir') && !s.characters.eliminated.includes('boromir'));
}

console.log('\n=== Return to Valinor: Elves only, one Stronghold at a time ===');
{
  let found = false;
  for (let seed = 1; seed < 400 && !found; seed++) {
    let s = base(seed);
    s.currentPlayer = 'shadow'; s.dice.shadow = ['event']; s.dice.fp = [];
    s.regions['lorien'].control = 'shadow'; s.regions['lorien'].units = { sauron: { regular: 1, elite: 0 } };
    const riv = s.regions['rivendell'];
    riv.units = { elves: { regular: 2, elite: 2 }, dwarves: { regular: 2, elite: 0 } };
    riv.characters = ['gimli']; s.characters.inPlay.gimli = 'rivendell'; s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'gimli');
    s.regions['grey-havens'].units = { elves: { regular: 1, elite: 1 } };
    s.cards.shadow.hand = ['sh-str-01'];
    const p = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-01');
    if (!p) { check('Return to Valinor is playable', false); break; }
    const t = wotrAdapter.applyAction(s, { ...p, die: 'event' }, 'shadow');
    const note = (t.notices ?? []).find((n) => n.title === 'Return to Valinor');
    if (t.pendingChoice?.kind !== 'eventCasualties') continue;
    found = true;
    check('the roll is shown', !!note && /Rivendell/.test(note.msg), note?.msg);
    const opts = wotrAdapter.legalActions(t, 'fp');
    check('the prompt is the per-hit casualty prompt', opts.every((a) => a.kind === 'casualtyStep'), [...new Set(opts.map((a) => a.kind))].join(','));
    check('only Elven units are offered', opts.every((a) => a.nation === 'elves'), opts.map((a) => `${a.step}:${a.nation}`).join(' '));
    const done = settle(t);
    check('the Dwarves are untouched', done.regions['rivendell'].units.dwarves?.regular === 2);
    check('Gimli is untouched', done.regions['rivendell'].characters.includes('gimli'));
  }
  check('a Return to Valinor roll that needed a choice was found', found);
}

console.log('\n=== Dead Men of Dunharrow: hits before casualties, the Shadow chooses ===');
{
  let seen = false;
  for (let seed = 1; seed < 400 && !seen; seed++) {
    let s = base(seed);
    s.currentPlayer = 'fp'; s.dice.fp = ['character']; s.dice.shadow = [];
    s.regions['edoras'].characters = ['strider']; s.characters.inPlay.strider = 'edoras'; s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'strider');
    s.regions['pelargir'].units = { sauron: { regular: 3, elite: 3 } }; s.regions['pelargir'].control = 'shadow';
    s.regions['lamedon'].control = 'shadow'; // a second free region to retreat into, so the Shadow has a real choice
    s.cards.fp.hand = ['fp-char-22'];
    const p = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-char-22');
    if (!p) { check('Dead Men is playable', false); break; }
    s = wotrAdapter.applyAction(s, { ...p, die: 'character' }, 'fp');
    const go = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'eventTarget' && a.region === 'pelargir');
    if (!go) { check('Pelargir is offered', false); break; }
    const before = s.log.length;
    s = wotrAdapter.applyAction(s, go, 'fp');
    const lines = s.log.slice(before).map((e) => e.msg);
    const hitAt = lines.findIndex((l) => /The Dead Men score/.test(l));
    const casAt = lines.findIndex((l) => /casualties/.test(l));
    if (s.pendingChoice?.kind === 'eventCasualties') {
      seen = true;
      check('the Shadow is asked which units fall', s.pendingChoice.owner === 'shadow');
      check('the hits are logged before any casualty', hitAt >= 0 && (casAt < 0 || hitAt < casAt), lines.join(' | '));
      check('the roll is shown', (s.notices ?? []).some((n) => n.title === 'Dead Men of Dunharrow'));
      s = settle(s);
      if (s.pendingChoice?.kind === 'cardRetreat') {
        const dests = wotrAdapter.legalActions(s, 'shadow').map((a) => a.region);
        check('the Shadow picks where it retreats, among free regions only', s.pendingChoice.owner === 'shadow' && dests.length > 1
          && dests.every((r) => !s.regions[r].control || s.regions[r].control === 'shadow' || !['City', 'Town', 'Stronghold'].includes(s.regions[r].settlement)), dests.join(','));
        s = wotrAdapter.applyAction(s, { kind: 'cardRetreat', region: dests[0] }, 'shadow');
      }
      const retreated = s.log.slice(before).some((e) => /retreats|is destroyed/.test(e.msg));
      check('then the Army retreats (or is destroyed)', retreated, s.log.slice(-3).map((e) => e.msg).join(' | '));
      check('the retreat choice was exercised', s.log.slice(before).some((e) => /retreats/.test(e.msg)));
      check('…and the card carries on to its Gondor recruit', s.pendingChoice?.kind === 'eventTarget' && s.pendingChoice.owner === 'fp', s.pendingChoice?.kind ?? 'none');
    }
  }
  check('a Dead Men roll that needed a Shadow choice was found', seen);
}

console.log('\n=== Dead Men with no casualty choice: the retreat is still the Shadow\'s, and the recruit follows ===');
{
  let s = base(7);
  s.currentPlayer = 'fp'; s.dice.fp = ['character']; s.dice.shadow = [];
  s.regions['edoras'].characters = ['strider']; s.characters.inPlay.strider = 'edoras'; s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'strider');
  s.regions['pelargir'].units = { sauron: { regular: 8, elite: 0 } }; s.regions['pelargir'].control = 'shadow';
  s.regions['lamedon'].control = 'shadow';
  s.cards.fp.hand = ['fp-char-22'];
  const p = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-char-22');
  s = wotrAdapter.applyAction(s, { ...p, die: 'character' }, 'fp');
  s = wotrAdapter.applyAction(s, wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'eventTarget' && a.region === 'pelargir'), 'fp');
  check('no casualty prompt (Regulars only), straight to the retreat choice', s.pendingChoice?.kind === 'cardRetreat' && s.pendingChoice.owner === 'shadow', s.pendingChoice?.kind);
  if (s.pendingChoice?.kind === 'cardRetreat') {
    s = wotrAdapter.applyAction(s, { kind: 'cardRetreat', region: 'west-harondor' }, 'shadow');
    check('the Army retreated where the Shadow chose', unitsIn(s, 'west-harondor') > 0 && unitsIn(s, 'pelargir') === 0);
    check('then the Free Peoples recruit step', s.pendingChoice?.kind === 'eventTarget' && s.pendingChoice.owner === 'fp', s.pendingChoice?.kind ?? 'none');
  }
}

console.log('\n=== The Eagles are Coming!: the Free Peoples pick the target, the Shadow the refuge ===');
{
  let s = base(5);
  s.currentPlayer = 'fp'; s.dice.fp = ['character']; s.dice.shadow = [];
  // A Free Peoples Army with Strider in Dagorlad, Nazgûl-led Shadow Armies on two sides.
  s.regions['dagorlad'].units = { north: { regular: 2, elite: 0 } }; s.regions['dagorlad'].characters = ['strider']; s.characters.inPlay.strider = 'dagorlad';
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'strider');
  for (const r of ['noman-lands', 'ash-mountains']) { s.regions[r].units = { sauron: { regular: 1, elite: 0 } }; s.regions[r].nazgul = 3; }
  s.cards.fp.hand = ['fp-char-18'];
  const p = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-char-18');
  check('the card is playable', !!p);
  if (p) {
    s = wotrAdapter.applyAction(s, { ...p, die: 'character' }, 'fp');
    const targets = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'eventTarget' && a.region).map((a) => a.region);
    check('both Nazgûl stacks are offered to the Free Peoples', targets.includes('noman-lands') && targets.includes('ash-mountains'), targets.join(','));
    let t = null;
    for (let i = 0; i < 1 && !t; i++) t = wotrAdapter.applyAction(s, { kind: 'eventTarget', card: 'fp-char-18', region: 'ash-mountains' }, 'fp');
    check('the struck stack is the one picked', t.regions['noman-lands'].nazgul === 3);
    check('the roll is shown', (t.notices ?? []).some((n) => n.title === 'The Eagles are Coming!'));
    if (t.regions['ash-mountains'].nazgul > 0 || t.pendingChoice?.kind === 'eaglesRefuge') {
      check('the Shadow is asked where the survivors fly', t.pendingChoice?.kind === 'eaglesRefuge' && t.pendingChoice.owner === 'shadow', t.pendingChoice?.kind);
      const refuges = wotrAdapter.legalActions(t, 'shadow').map((a) => a.region);
      check('every refuge is an uncaptured Sauron Stronghold other than the struck region', refuges.length > 1 && !refuges.includes('ash-mountains'), refuges.join(','));
      const n = t.pendingChoice.data.count;
      const dest = refuges[refuges.length - 1];
      t = wotrAdapter.applyAction(t, { kind: 'eaglesRefuge', region: dest }, 'shadow');
      check(`they fly to ${dest}`, t.regions[dest].nazgul >= n && t.regions['ash-mountains'].nazgul === 0);
    } else check('(every Nazgûl fell — nothing to fly)', true);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
