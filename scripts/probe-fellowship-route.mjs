#!/usr/bin/env vite-node
// probe-fellowship-route.mjs — the Fellowship's traced route is the SHORTEST path,
// tie-broken to cross the fewest Shadow Strongholds (and Moria while Balrog of Moria
// is on the table).
//
// The route is not cosmetic: a reveal costs one extra Hunt tile per Shadow Stronghold
// crossed (p.39) and the Balrog fires on a path through Moria, so walking through one
// when an equally short way round exists is a choice no player would make — but plain
// BFS made it (player report 384n5a5y63480b3g).
//
// Checked as PROPERTIES over every region pair rather than one hand-picked route, so
// the guarantee holds everywhere on the map, not just where someone thought to look.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { pathTo, fellowshipPath } from '../src/engine/fellowship.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const s = startGame(createGame({ seed: 111 }));
s.cards.shadow.table.push('sh-char-17'); // Balrog of Moria, so Moria counts as well
const harmful = new Set(Object.keys(s.regions).filter((id) =>
  (REGIONS[id]?.settlement === 'Stronghold' && ['sauron', 'isengard', 'southrons'].includes(REGIONS[id]?.nation)) || id === 'moria'));
/** Regions crossed as STEPPING STONES (the destination is always allowed). */
const crossings = (p) => p.slice(0, -1).filter((r) => harmful.has(r)).length;

const ids = Object.keys(REGIONS);
let pairs = 0, longer = 0, worse = 0, improved = 0, example = null, unreachable = 0;
for (const from of ids) {
  for (const to of ids) {
    if (from === to) continue;
    const plain = pathTo(from, to), route = fellowshipPath(s, from, to);
    if (!plain.length) { if (route.length) unreachable++; continue; }
    pairs++;
    if (route.length !== plain.length) longer++;
    const c0 = crossings(plain), c1 = crossings(route);
    if (c1 > c0) worse++;
    if (c1 < c0) { improved++; if (!example) example = { from, to, plain: plain.join(' → '), route: route.join(' → '), c0, c1 }; }
  }
}
console.log(`\n=== properties over all ${pairs} reachable region pairs ===`);
check('the traced route is never LONGER than the shortest path', longer === 0, `${longer} longer`);
check('it never crosses MORE harmful regions than the plain path', worse === 0, `${worse} worse`);
check('and on many pairs it crosses fewer (so the rule bites)', improved > 0, `${improved} pairs improved`);
check('a route exists wherever a plain path does', unreachable === 0);
if (example) console.log(`    e.g. ${example.from} → ${example.to}: ${example.c0} crossings [${example.plain}] becomes ${example.c1} [${example.route}]`);

console.log('\n=== a Shadow Stronghold may still be the DESTINATION ===');
{
  const target = 'dol-guldur';
  const route = fellowshipPath(s, 'rivendell', target);
  check('Dol Guldur is reachable as a destination', route[route.length - 1] === target, route.join(' → '));
}
console.log('\n=== an unavoidable crossing is still made (the Morannon is the only land gate) ===');
{
  const route = fellowshipPath(s, 'dagorlad', 'gorgoroth');
  check('the forced crossing is kept', route.includes('morannon'), route.join(' → '));
}
console.log('\n=== spare Progress is spent to dodge — the reporter\'s own example ===');
{
  // Rivendell to the far side of the Misty Mountains: the short way is through Moria,
  // and going round is LONGER, so only a Progress budget can buy the detour.
  const short = fellowshipPath(s, 'rivendell', 'dimrill-dale');
  check('with no budget the route still takes the short way through Moria', short.includes('moria'), short.join(' → '));
  let dodged = null;
  for (let budget = short.length; budget <= 12 && !dodged; budget++) {
    const r = fellowshipPath(s, 'rivendell', 'dimrill-dale', budget);
    if (r.length && !r.includes('moria')) dodged = { budget, r };
  }
  check('with Progress to spare it goes round instead', !!dodged, dodged ? `Progress ${dodged.budget}: ${dodged.r.join(' → ')}` : 'never dodged within 12');
  if (dodged) check('...and still ends where the player asked', dodged.r[dodged.r.length - 1] === 'dimrill-dale');
}

console.log('\n=== a budget is never overspent ===');
{
  let over = 0;
  for (const to of ids) {
    const d = pathTo('rivendell', to).length;
    if (!d) continue;
    for (const budget of [d, d + 1, d + 2]) {
      const r = fellowshipPath(s, 'rivendell', to, budget);
      if (r.length > budget) over++;
    }
  }
  check('no route exceeds the Progress it was given', over === 0, `${over} over budget`);
}

console.log('\n=== in play: declaring past Moria no longer wakes the Balrog when a way round exists ===');
{
  let g = startGame(createGame({ seed: 111 }));
  g.phase = 'fellowship'; g.currentPlayer = 'fp'; g.pendingChoice = null;
  g.cards.shadow.table.push('sh-char-17');
  g.fellowship.location = 'rivendell'; g.fellowship.progress = 6; g.fellowship.hidden = true;
  // A target the plain path reaches through Moria, but which has an equal way round.
  // With Progress 6 in hand, a target whose SHORT way is through Moria but which the
  // budget can reach round the mountains instead.
  const target = ids.find((to) => {
    const p = pathTo('rivendell', to);
    return p.length > 1 && p.length <= 6 && p.includes('moria') && to !== 'moria'
      && !fellowshipPath(g, 'rivendell', to, 6).includes('moria');
  });
  if (!target) { console.log('    (no such target on this map — the properties above still hold)'); }
  else {
    const dec = wotrAdapter.legalActions(g, 'fp').find((a) => a.kind === 'declareFellowship' && a.target === target);
    check(`a declare at ${target} is offered`, !!dec);
    if (dec) {
      g = wotrAdapter.applyAction(g, dec, 'fp');
      check('the figure landed where the player asked', g.fellowship.location === target, g.fellowship.location);
      check('the Balrog did not fire (the route went round Moria)', g.pendingChoice?.kind !== 'balrog', g.pendingChoice?.kind ?? 'none');
    }
  }
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
