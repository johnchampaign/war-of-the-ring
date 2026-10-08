#!/usr/bin/env vite-node
// probe-triage-1008.mjs — the 2026-10-08 report batch:
//
//  - Event-card rolls log their dice, in one sentence shape: "Dreadful Spells scores
//    3 hits on the Free Peoples Army in moria [5 5 5]" (report 1v3t0v4f3i0q484r).
//  - Stormcrow's loss is logged as "Stormcrow banishes an Elves Regular in …", BEFORE
//    the capture it causes (report 6b674j562o2h4d17).
//  - The Shadow's private log names the two cards paid to remove Tom Bombadil / A Power
//    too Great (report 230p5v6l444c4l26).
//  - Regression guards for two reports that turned out to be working as intended:
//    the defender is offered a retreat before EVERY round, not just the first
//    (report brdocqife38bttzx), and Grond is playable with the Witch-king among the
//    besiegers of Helm's Deep (report tngys8qlp0cizl6c).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import '../src/engine/handlers/index.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { startBattle, combatStep } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
function bare(seed) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.cards.fp.hand = []; s.cards.shadow.hand = [];
  s.phase = 'actionResolution'; s.pendingChoice = null; s.pendingCombat = null;
  return s;
}
const msgs = (s) => s.log.map((e) => e.msg);

console.log('\n=== Event-card rolls log their dice ===');
{
  const s = bare(11);
  s.regions['moria'].units = { elves: { regular: 5, elite: 0 } };
  s.regions['dimrill-dale'].nazgul = 3; s.regions['dimrill-dale'].units = { sauron: { regular: 1, elite: 0 } };
  const h = getHandler('sh-char-19');
  h.applyTarget(s, 'shadow', { region: 'moria' });
  const line = msgs(s).find((m) => m.startsWith('Dreadful Spells')) ?? '';
  check('Dreadful Spells sentence + dice', /^Dreadful Spells scores \d+ hits? on the Free Peoples Army in moria \[\d( \d){2}\]$/.test(line), line);
}
{
  const s = bare(12);
  s.regions['north-ithilien'].units = { sauron: { regular: 5, elite: 0 } };
  getHandler('fp-str-06').applyTarget(s, 'fp', { region: 'north-ithilien' });
  const all = msgs(s);
  const i = all.findIndex((m) => m.startsWith("Faramir's Rangers"));
  check("Faramir's Rangers sentence + dice", /^Faramir's Rangers score \d+ hits? on the Shadow Army in north-ithilien \[\d \d \d\]$/.test(all[i] ?? ''), all[i]);
  check('logged before any casualty line', all.slice(0, i).every((m) => !/casualt|eliminated/i.test(m)));
}
{
  const s = bare(13);
  s.regions['dagorlad'].units = { sauron: { regular: 3, elite: 0 }, southrons: { regular: 2, elite: 0 } };
  getHandler('fp-str-05').applyTarget(s, 'fp', { region: 'dagorlad' });
  const line = msgs(s).find((m) => m.startsWith('The Spirit of Mordor')) ?? '';
  check('Spirit of Mordor sentence + dice', /^The Spirit of Mordor scores \d+ hits? on the Shadow Army in dagorlad \[\d( \d){4}\]$/.test(line), line);
}

console.log('\n=== Stormcrow banishes, before the capture ===');
{
  const s = bare(14);
  s.regions['lorien'].siegeBox = { units: { elves: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  s.regions['lorien'].units = { sauron: { regular: 3, elite: 0 } };
  s.regions['lorien'].besieged = true;
  s.currentPlayer = 'fp';
  s.pendingChoice = { owner: 'fp', kind: 'stormcrowLoss', data: { nation: 'elves' } };
  const t = wotrAdapter.applyAction(s, { kind: 'stormcrowLoss', region: 'lorien', nation: 'elves', figure: 'regular' }, 'fp');
  const all = msgs(t);
  const i = all.findIndex((m) => m.startsWith('Stormcrow banishes'));
  check('wording', all[i] === 'Stormcrow banishes an Elves Regular in lorien', all[i]);
  const cap = all.findIndex((m) => /captures lorien/.test(m));
  check('the banishment reads before the capture', i >= 0 && cap > i, `banish@${i} capture@${cap}`);
}

console.log('\n=== Removing a table card names the cards paid ===');
{
  const s = bare(15);
  const strat = 'sh-str-01'; // Return to Valinor (Army icon)
  const char = 'sh-char-13'; // Lure of the Ring
  s.cards.shadow.hand = [strat, char];
  s.cards.fp.table = ['fp-str-03'];
  s.currentPlayer = 'shadow'; s.dice.shadow = ['muster'];
  const t = wotrAdapter.applyAction(s, { kind: 'forceDiscardCard', cardId: 'fp-str-03', via: 'cards', discardStrategy: strat, discardCharacter: char, die: 'muster' }, 'shadow');
  const own = t.log.find((e) => e.side === 'shadow' && /^You discard/.test(e.msg))?.msg ?? '';
  check('private line names both cards and why', own === 'You discard Return to Valinor and Lure of the Ring (to remove The Power of Tom Bombadil)', own);
}

console.log('\n=== The defender may retreat before every round ===');
{
  let offers = 0, rounds = 0;
  for (let seed = 1; seed < 40 && offers < 2; seed++) {
    let s = bare(seed);
    s.nations.isengard.step = 0; s.nations.rohan.step = 0;
    s.regions['orthanc'].units = { isengard: { regular: 1, elite: 0 } };
    s.regions['fords-of-isen'].units = { rohan: { regular: 0, elite: 5 } };
    startBattle(s, 'shadow', 'orthanc', 'fords-of-isen');
    offers = 0; rounds = 0;
    for (let i = 0; i < 60 && s.pendingCombat; i++) {
      if (!s.pendingChoice) { combatStep(s); if (!s.pendingChoice) continue; }
      const ch = s.pendingChoice;
      const legal = wotrAdapter.legalActions(s, ch.owner);
      let act = legal[0];
      if (ch.kind === 'combatContinue') act = legal.find((a) => a.cont === true || a.continue === true) ?? legal[0];
      if (ch.kind === 'combatRetreat') {
        rounds++;
        if (legal.some((a) => a.retreat === true)) offers++;
        act = legal.find((a) => a.retreat === false);
        if (rounds >= 2) break;
      }
      s = wotrAdapter.applyAction(s, act, ch.owner);
    }
  }
  check('retreat offered in round 1 AND round 2', offers >= 2, `offers=${offers} rounds=${rounds}`);
}

console.log('\n=== Grond with the Witch-king besieging Helm\'s Deep ===');
{
  const s = bare(16);
  const r = s.regions['helms-deep'];
  r.siegeBox = { units: { rohan: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  r.units = { isengard: { regular: 3, elite: 1 } };
  r.characters = ['witch-king'];
  r.besieged = true;
  s.characters.entered.push('witch-king');
  s.nations.isengard.step = 0;
  s.cards.shadow.hand = ['sh-char-20'];
  s.currentPlayer = 'shadow'; s.dice.shadow = ['character'];
  const legal = wotrAdapter.legalActions(s, 'shadow');
  check('Grond is playable', legal.some((a) => a.kind === 'playEvent' && a.cardId === 'sh-char-20'), legal.map((a) => a.kind).join(','));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
