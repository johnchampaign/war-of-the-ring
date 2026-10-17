#!/usr/bin/env vite-node
// probe-triage-1017.mjs — fixes from the 2026-10-17 triage run.
//  - 39286h4r3n566t01: a Shadow Stronghold tile owed by a Reveal is drawn after the
//    action's own Ring-victory check; a 12th Corruption from it must still end the
//    game at once, not on the next player's action.
//  - 542d4c6j3o1z5o3n: The White Rider is logged, and Sudden Strike's Leadership dice
//    leave out the Leadership Gandalf forfeited for it.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';
import { startBattle, combatStep, resolvePlayCombatCard, resolveWhiteRider } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== Stronghold tile on a Reveal takes the Ring-bearers to 12 ===');
const s0 = startGame(createGame({ seed: 7 }));
Object.assign(s0.fellowship, { location: 'morannon', progress: 1, hidden: true, mordor: null, corruption: 10, companions: [], guide: 'gollum' });
for (const c of Object.values(s0.characters ?? {})) if (c && c.location === 'fellowship') c.location = 'eliminated';
// Only tiles worth 2+ in the bag, so the one owed tile is decisive.
s0.hunt.pool = STANDARD_TILE_LIST.map((t, i) => [t, i]).filter(([t]) => typeof t.value === 'number' && t.value >= 2).map(([, i]) => i);
s0.hunt.drawn = [];
s0.pendingChoice = { owner: 'fp', kind: 'revealMove' };
const r = wotrAdapter.tryApplyAction(s0, { kind: 'revealMove', target: 'gorgoroth' }, 'fp');
check('the reveal move is accepted', r.ok, r.ok ? '' : r.error);
const s = r.ok ? r.state : s0;
check('the tile was drawn', /Morannon/.test((s.hunt.draws ?? []).at(-1)?.source ?? ''), (s.hunt.draws ?? []).at(-1)?.source);
check('Corruption reached 12', s.fellowship.corruption >= 12, String(s.fellowship.corruption));
check('the Shadow wins immediately', s.winner === 'shadow' && s.phase === 'gameOver', `${s.winner} / ${s.phase}`);

function suddenStrike(forfeit) {
  const s = startGame(createGame({ seed: 5 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.sauron.step = 0; s.nations.north.step = 0;
  s.regions['dale'].units = { north: { regular: 3, elite: 0 } };
  s.regions['dale'].leaders = 2;
  s.regions['dale'].characters = ['gandalf-white'];
  if (s.characters?.['gandalf-white']) s.characters['gandalf-white'].location = 'dale';
  s.regions['northern-rhovanion'].units = { sauron: { regular: 5, elite: 0 } };
  s.regions['northern-rhovanion'].nazgul = 2;
  s.cards.shadow.hand = [];
  s.cards.fp.hand = ['fp-char-14'];
  startBattle(s, 'shadow', 'northern-rhovanion', 'dale');
  let asked = false;
  for (let i = 0; i < 60 && s.pendingCombat; i++) {
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'whiteRider') { asked = true; resolveWhiteRider(s, forfeit); continue; }
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? null : 'fp-char-14'); continue; }
    break;
  }
  const msgs = s.log.map((e) => e.msg ?? '');
  const line = msgs.find((m) => m.includes('additional attack (before the Combat roll)')) ?? '';
  const dice = (line.match(/\[([^\]]*)\]/)?.[1] ?? '').split(' ').filter(Boolean).length;
  return { asked, dice, line, rode: msgs.some((m) => m.includes('rides forth as The White Rider')) };
}
{
  console.log('\n=== Sudden Strike with Gandalf the White and 2 Leaders ===');
  const kept = suddenStrike(false);
  check('The White Rider is offered', kept.asked);
  check('without the forfeit: 3 Leadership dice', kept.dice === 3, kept.line);
  check('...and no White Rider line', !kept.rode);
  const gone = suddenStrike(true);
  check('with the forfeit: 2 Leadership dice', gone.dice === 2, gone.line);
  check('The White Rider is logged', gone.rode);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
