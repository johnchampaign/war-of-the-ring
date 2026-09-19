#!/usr/bin/env vite-node
// probe-rules-batch-0919.mjs — two fixes from player reports.
//
// A. A Fellowship revealed while STANDING STILL in a Shadow-held Shadow Stronghold
//    owes that Stronghold's Hunt tile: p.39 "if the Fellowship moves through, moves
//    from, moves into, or remains stationary in a Shadow Stronghold still controlled
//    by the Shadow player, then a Hunt tile is immediately drawn" (report
//    4y720k5x4n5t4755). The no-Progress reveal never reaches the placement step, so
//    `beginReveal` has to draw it.
// B. With no Regular left to replace it, "reducing" an Elite eliminates it (p.30), so
//    once two hits are open that option is dominated by the 2-hit removal and is not
//    offered; with one hit it stays (report 6q6h2i1o102a2m6k).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { beginReveal } from '../src/engine/hunt.ts';
import { casualtyOptions, eliteHasReplacement } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function hiddenAt(at, progress = 0) {
  const s = startGame(createGame({ seed: 7 }));
  s.fellowship.location = at; s.fellowship.progress = progress;
  s.fellowship.hidden = true; s.fellowship.mordor = null;
  s.pendingChoice = null;
  // No Wizard's Staff / Mithril Coat interruptions: the probe wants the plain draw.
  s.cards.fp.table = [];
  return s;
}
const draws = (s) => (s.hunt.draws ?? []).length;

// --- A1. stationary, no Progress, in Shadow-held Dol Guldur: one tile ----------------
{
  console.log('\n=== revealed standing still in Dol Guldur (no Progress) ===');
  const s = hiddenAt('dol-guldur');
  beginReveal(s);
  check('the Fellowship is revealed', s.fellowship.hidden === false);
  check('a Stronghold Hunt tile was drawn', draws(s) === 1, `draws=${draws(s)}`);
}
// --- A2. stationary in an ordinary region: no tile ------------------------------------
{
  console.log('\n=== revealed standing still in the open: no tile ===');
  const s = hiddenAt('rivendell');
  beginReveal(s);
  check('revealed', s.fellowship.hidden === false);
  check('no tile drawn', draws(s) === 0, `draws=${draws(s)}`);
}
// --- A3. already revealed: not a new reveal, no tile -----------------------------------
{
  console.log('\n=== already revealed in Dol Guldur: no tile ===');
  const s = hiddenAt('dol-guldur'); s.fellowship.hidden = false;
  beginReveal(s);
  check('no tile drawn', draws(s) === 0, `draws=${draws(s)}`);
}
// --- A4. Moria with the Balrog on the table: card first, carrying Moria's tile ----------
{
  console.log('\n=== standing still in Moria with the Balrog in play ===');
  const s = hiddenAt('moria');
  s.cards.shadow.table.push('sh-char-17');
  beginReveal(s);
  check('the Shadow is asked about the Balrog', s.pendingChoice?.kind === 'balrog');
  check('no tile yet', draws(s) === 0);
  check("Moria's Stronghold tile rides with the choice",
    JSON.stringify(s.pendingChoice?.data?.strongholds) === '["moria"]', JSON.stringify(s.pendingChoice?.data));
}

// --- B. Elite options ---------------------------------------------------------------------
{
  console.log('\n=== Elite with no replacement Regular ===');
  const s = startGame(createGame({ seed: 4 }));
  s.reinforcements.sauron.regular = 0;
  const f = { units: { sauron: { regular: 0, elite: 2 } }, leaders: 0, nazgul: 0, characters: [] };
  check('no replacement for a Sauron Elite', !eliteHasReplacement(s, 'sauron', 'shadow'));
  const two = casualtyOptions(f, 2, { state: s, side: 'shadow' }).map((o) => o.step);
  check('two hits: only the 2-hit removal', two.join() === 'removeElite', two.join());
  const one = casualtyOptions(f, 1, { state: s, side: 'shadow' }).map((o) => o.step);
  check('one hit: the Elite can still take it', one.join() === 'reduceElite', one.join());
  s.reinforcements.sauron.regular = 1;
  const back = casualtyOptions(f, 2, { state: s, side: 'shadow' }).map((o) => o.step);
  check('with a Regular available both are offered', back.includes('reduceElite') && back.includes('removeElite'), back.join());
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
