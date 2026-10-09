#!/usr/bin/env vite-node
// probe-triage-1009.mjs — Worn with Sorrow and Toil (sh-char-15), player reports
// 3r2z092k3w6c475c, 6q6o6a2e4a3k2a08 and 733j0g125g3n3r52:
//
//  1. "you may also discard one of the Free Peoples player's Character Event cards
//     from his hand (choosing it randomly) or from the table" — hand OR table is the
//     SHADOW's choice. It used to take from the hand whenever there was one.
//  2. The discard is the casualty's consequence, so it logs AFTER the elimination and
//     after the cards that leave with the Companion (Wizard's Staff etc.).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fpChars = Object.values(EVENT_BY_ID).filter((c) => c.side !== 'Shadow' && c.deck === 'Character').map((c) => c.id);

/** A Hunt casualty pending (3 damage, FP to choose), Worn with Sorrow on the table. */
function board({ hand, table }) {
  const s = startGame(createGame({ seed: 21 }));
  s.phase = 'actionResolution';
  s.cards.shadow.table.push('sh-char-15');
  const take = (id) => { for (const p of [s.cards.fp.hand, s.cards.fp.draw.character, s.cards.fp.draw.strategy]) { const i = p.indexOf(id); if (i >= 0) p.splice(i, 1); } };
  for (const id of [...hand, ...table]) take(id);
  s.cards.fp.hand = s.cards.fp.hand.filter((id) => EVENT_BY_ID[id]?.deck !== 'Character');
  s.cards.fp.hand.push(...hand);
  s.cards.fp.table.push(...table);
  s.fellowship.guide = 'gandalf-grey';
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 3, reveal: false, numbered: true } };
  return s;
}
const [A, B, C] = fpChars.filter((id) => !['fp-char-06', 'fp-char-07', 'fp-char-08'].includes(id));

console.log('\n=== 1. hand AND table: the Shadow chooses ===');
{
  const s = board({ hand: [A], table: [B, 'fp-char-08'] }); // Wizard's Staff leaves with Gandalf
  const t = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  check('Gandalf is eliminated', t.characters.eliminated.includes('gandalf-grey'));
  check('the Shadow is asked', t.pendingChoice?.kind === 'wornDiscard' && t.pendingChoice.owner === 'shadow', t.pendingChoice?.kind ?? 'none');
  const opts = wotrAdapter.legalActions(t, 'shadow');
  check('options: the hand (unnamed) and the tabled card', opts.length === 2 && opts.some((a) => !a.card) && opts.some((a) => a.card === B), JSON.stringify(opts));
  check('the FP hand stays hidden in the options', !opts.some((a) => a.card === A));
  const u = wotrAdapter.applyAction(t, { kind: 'wornDiscard', card: B }, 'shadow');
  check('the tabled card is discarded', !u.cards.fp.table.includes(B) && u.cards.fp.discard.character.includes(B));
  check('the hand card is kept', u.cards.fp.hand.includes(A));
  const msgs = u.log.map((e) => e.msg);
  const iElim = msgs.findIndex((m) => m.includes('Gandalf the Grey') && m.includes('eliminated'));
  const iStaff = msgs.findIndex((m) => m.startsWith("Wizard's Staff is discarded"));
  const iWorn = msgs.findIndex((m) => m.startsWith('Worn with Sorrow and Toil'));
  check('log order: casualty, then Wizard\'s Staff, then the Worn discard', iElim >= 0 && iElim < iStaff && iStaff < iWorn, `${iElim} ${iStaff} ${iWorn}`);
  const v = wotrAdapter.applyAction(t, { kind: 'wornDiscard' }, 'shadow');
  check('or: a random hand card is discarded face down', !v.cards.fp.hand.includes(A) && (v.cards.fp.discardFaceDown ?? []).includes(A) && v.cards.fp.table.includes(B));
}

console.log('\n=== 2. no real choice: resolved at once, in order ===');
{
  const s = board({ hand: [A, C], table: ['fp-char-08'] }); // the Staff leaves before Worn resolves
  const t = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  check('no prompt', t.pendingChoice?.kind !== 'wornDiscard', t.pendingChoice?.kind ?? 'none');
  check('one hand card went', t.cards.fp.hand.filter((id) => id === A || id === C).length === 1);
  const msgs = t.log.map((e) => e.msg);
  check('the Worn line follows the elimination', msgs.findIndex((m) => m.includes('eliminated')) < msgs.findIndex((m) => m.startsWith('Worn with Sorrow')));
}
{
  const s = board({ hand: [], table: [B] });
  const t = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  check('empty hand, one tabled card: it goes without a prompt', t.pendingChoice?.kind !== 'wornDiscard' && t.cards.fp.discard.character.includes(B));
}
{
  const s = board({ hand: [], table: [B, C] });
  const t = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  const opts = t.pendingChoice?.kind === 'wornDiscard' ? wotrAdapter.legalActions(t, 'shadow') : [];
  check('two tabled cards, empty hand: the Shadow picks which', opts.length === 2 && opts.every((a) => a.card), JSON.stringify(opts));
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
