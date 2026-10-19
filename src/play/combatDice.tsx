// The combat dice, drawn as dice — a hit in gold, a miss in dark. Shared by the
// battle MODAL (live, round by round) and the end-of-battle summary, because the
// reporter of 2p2w0k6c5m2p6z4n was right that one of them had the good display and
// the other had "super tiny text": "How about if we replace the existing Combat roll
// info in the modal with the (superior) Battle summary one".

import type { CardRoll } from '../engine/types';
import eventCards from '../../assets/event-cards.json';

export type Roll = { dice: number[]; rerolls: number[]; target: number; rerollTarget?: number };

// A combat die: a hit is a 6, or ≥ the to-hit target (never a 1).
export function CDie({ n, target }: { n: number; target: number }) {
  const hit = n === 6 || (n !== 1 && n >= target);
  return (
    <span style={{
      display: 'inline-grid', placeItems: 'center', width: 22, height: 22, margin: '0 2px',
      borderRadius: 4, fontSize: 13, fontWeight: 700,
      background: hit ? '#caa84b' : '#2a2418', color: hit ? '#1a1408' : '#b9b09a',
      border: `1px solid ${hit ? '#e6c869' : '#4a4332'}`,
    }}>{n}</span>
  );
}

export function RollRow({ label, roll, color }: { label: string; roll?: Roll; color: string }) {
  if (!roll || (roll.dice.length === 0 && roll.rerolls.length === 0)) return null;
  // A Combat card can bonus the Combat roll and the Leader re-roll separately, so
  // the re-roll may hit on a different number — label it when it differs.
  const rt = roll.rerollTarget ?? roll.target;
  return (
    <div style={{ margin: '3px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
      <span style={{ width: 64, fontSize: 12, color }}>{label}</span>
      <span style={{ fontSize: 11, color: '#887', marginRight: 4 }}>(hits {roll.target}+)</span>
      {roll.dice.map((n, i) => <CDie key={i} n={n} target={roll.target} />)}
      {/* The re-roll's threshold always shows, so the attacker's and defender's dice line
          up (player report 4v3z1s6a6e5a5234). */}
      {roll.rerolls.length > 0 && <span style={{ color: '#887', margin: '0 4px', fontSize: 11 }}>re-roll ({rt}+)</span>}
      {roll.rerolls.map((n, i) => <CDie key={`r${i}`} n={n} target={rt} />)}
    </div>
  );
}


/** A Combat card's extra attack — Sudden Strike, Charge, Durin's Bane before the
 *  Combat roll; We Come to Kill, Onslaught after casualties — drawn as dice like the
 *  roll itself, and Great Host's automatic hit as a line. They used to show only in
 *  the log, so their hits seemed to come from nowhere (player report 562h455s6y5o363v). */
export function CardRollRows({ rolls, round }: { rolls?: CardRoll[]; round?: number }) {
  if (!rolls?.length) return null;
  return (
    <>
      {rolls.map((r, i) => {
        const title = CARD_TITLE.get(r.card) ?? 'Combat card';
        const color = r.side === 'fp' ? '#7fb6e6' : '#e6857f';
        // The round is named only when it differs from the roll shown above it (a
        // pre-combat attack in the next round, before that round's dice are thrown).
        const when = `${r.when === 'before' ? 'before the Combat roll' : 'after casualties'}${round !== undefined && r.round !== round ? `, round ${r.round + 1}` : ''}`;
        return (
          <div key={i} style={{ margin: '3px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }} data-testid="card-roll">
            <span style={{ fontSize: 12, color, marginRight: 4 }}>{title}</span>
            <span style={{ fontSize: 11, color: '#887', marginRight: 4 }}>({when}{r.dice.length ? `, hits ${r.target}+` : ''})</span>
            {r.dice.length
              ? r.dice.map((n, j) => <CDie key={j} n={n} target={r.target} />)
              : null}
            <span style={{ fontSize: 12, color: r.hits ? '#e6c869' : '#998', marginLeft: 4 }}>
              {r.dice.length ? `→ ${r.hits} hit${r.hits === 1 ? '' : 's'}` : `${r.hits} automatic hit${r.hits === 1 ? '' : 's'}`}
            </span>
          </div>
        );
      })}
    </>
  );
}

const CARD_TITLE = new Map<string, string>((eventCards as { cards: { id: string; name: string; combat?: { title?: string } }[] }).cards
  .map((c) => [c.id, c.combat?.title ?? c.name]));
