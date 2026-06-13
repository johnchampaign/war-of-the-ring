#!/usr/bin/env vite-node
// verify-setup.mjs — Build the initial state via the engine and assert it is
// rules-correct: component counts (on-board + reinforcements = box totals),
// decks, Fellowship, Hunt Pool, politics, Elven Rings. Run: npm run verify:setup
import { createGame, BASE_DICE } from '../src/engine/setup.ts';
import { FP_NATIONS, SHADOW_NATIONS } from '../src/engine/types.ts';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.error(`  FAIL ${name} ${extra}`); failures++; }
};

const g = createGame({ seed: 1 });

// --- component counts: on-board + reinforcements == box totals -----------
const tot = { regular: 0, elite: 0, leader: 0, nazgul: 0 };
for (const r of Object.values(g.regions)) {
  for (const u of Object.values(r.units)) { tot.regular += u.regular; tot.elite += u.elite; }
  tot.leader += r.leaders;
  tot.nazgul += r.nazgul;
}
const reinf = { regular: 0, elite: 0, leader: 0, nazgul: 0 };
for (const n of Object.values(g.reinforcements)) {
  reinf.regular += n.regular; reinf.elite += n.elite; reinf.leader += n.leader; reinf.nazgul += n.nazgul ?? 0;
}
console.log('Component counts (on-board / reinforcements / total):');
console.log(`  regular ${tot.regular}/${reinf.regular}/${tot.regular + reinf.regular}, ` +
  `elite ${tot.elite}/${reinf.elite}/${tot.elite + reinf.elite}, ` +
  `leader ${tot.leader}/${reinf.leader}/${tot.leader + reinf.leader}, ` +
  `nazgul ${tot.nazgul}/${reinf.nazgul}/${tot.nazgul + reinf.nazgul}`);
check('total Regulars = 117', tot.regular + reinf.regular === 117);
check('total Elites = 48', tot.elite + reinf.elite === 48);
check('total Leaders = 20', tot.leader + reinf.leader === 20);
check('total Nazgûl = 8', tot.nazgul + reinf.nazgul === 8);
check('on-board Regulars = 71', tot.regular === 71, `got ${tot.regular}`);
check('on-board Nazgûl = 4', tot.nazgul === 4);

// --- Fellowship ----------------------------------------------------------
check('Ring-bearers in Rivendell', g.fellowship.location === 'rivendell');
check('7 starting Companions', g.fellowship.companions.length === 7, `got ${g.fellowship.companions.length}`);
check('Guide is Gandalf the Grey', g.fellowship.guide === 'gandalf-grey');
check('Fellowship hidden, progress 0, corruption 0',
  g.fellowship.hidden && g.fellowship.progress === 0 && g.fellowship.corruption === 0);
check('not on Mordor track', g.fellowship.mordor === null);

// --- Hunt / rings --------------------------------------------------------
check('Hunt Pool has 16 standard tiles', g.hunt.pool.length === 16, `got ${g.hunt.pool.length}`);
check('3 Elven Rings, all FP', g.elvenRings.length === 3 && g.elvenRings.every((r) => r === 'fp'));

// --- Event decks ---------------------------------------------------------
for (const side of ['fp', 'shadow']) {
  const p = g.cards[side];
  check(`${side} character deck = 24`, p.draw.character.length === 24, `got ${p.draw.character.length}`);
  check(`${side} strategy deck = 24`, p.draw.strategy.length === 24, `got ${p.draw.strategy.length}`);
  check(`${side} hand empty at setup`, p.hand.length === 0);
}

// --- Politics ------------------------------------------------------------
check('Elves active at setup', g.nations.elves.active);
check('all Shadow nations active', SHADOW_NATIONS.every((n) => g.nations[n].active));
check('Dwarves/Gondor/North/Rohan passive',
  ['dwarves', 'gondor', 'north', 'rohan'].every((n) => !g.nations[n].active));
check('political steps in 1..3', [...FP_NATIONS, ...SHADOW_NATIONS].every((n) => g.nations[n].step >= 1 && g.nations[n].step <= 3));

// --- Dice baseline + determinism + serializability -----------------------
check('FP base dice 4, Shadow 7', BASE_DICE.fp === 4 && BASE_DICE.shadow === 7);
const g2 = createGame({ seed: 1 });
check('deterministic (same seed => identical state)', JSON.stringify(g) === JSON.stringify(g2));
const g3 = createGame({ seed: 2 });
check('different seed => different deck order', JSON.stringify(g.cards) !== JSON.stringify(g3.cards));
check('state JSON round-trips', JSON.stringify(JSON.parse(JSON.stringify(g))) === JSON.stringify(g));

console.log(failures === 0 ? '\nverify-setup OK' : `\nverify-setup FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
