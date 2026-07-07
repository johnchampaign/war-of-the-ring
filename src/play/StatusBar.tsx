// Top status bar: turn / phase / seat, victory points, the Ring track, dice.
import { useState } from 'react';
import type { GameState } from '../engine/types';
import { charName, charDef } from './charInfo';
import eventCards from '../../assets/event-cards.json';

// Deck type per card id (for the hand pill's Character/Strategy split).
const CARD_DECK = new Map<string, string>((eventCards as { cards: { id: string; deck: string }[] }).cards.map((c) => [c.id, c.deck]));
/** "3C+2S" — Character/Strategy counts for a hand of real ids or 'hidden-*' placeholders. */
function handSplit(hand: string[] | undefined): string {
  let ch = 0, st = 0;
  for (const id of hand ?? []) {
    const deck = id === 'hidden-character' ? 'Character' : id === 'hidden-strategy' ? 'Strategy' : CARD_DECK.get(id);
    if (deck === 'Character') ch++; else st++;
  }
  return `${ch}C+${st}S`;
}

// A browsable roster of everyone currently in the Fellowship (Ira #4): click the
// companion pill to open it; hover a name to show that character's card in the
// inspector. The Guide is marked. Gollum (when Guide) is included even if not in the
// companions array.
function FellowshipRoster({ guide, companions, onHoverChar }: { guide: string; companions: string[]; onHoverChar?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ids = companions.includes(guide) ? companions : [guide, ...companions];
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill, border: 'none', cursor: 'pointer', font: 'inherit', color: '#e9e1cc' }}
        title="Browse the Fellowship — hover a name to see the card">
        {companions.length} companion{companions.length === 1 ? '' : 's'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={roster} onMouseLeave={() => onHoverChar?.(null)}>
          {ids.length === 0 && <div style={{ color: '#998', fontSize: 12 }}>No companions remain.</div>}
          {ids.map((id) => {
            const d = charDef(id);
            const isGuide = id === guide;
            return (
              <div key={id} onMouseEnter={() => onHoverChar?.(id)}
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 6px', borderRadius: 5, cursor: 'help', background: isGuide ? '#2c2616' : 'transparent' }}>
                <span style={{ fontWeight: 600, color: isGuide ? '#ffd86a' : '#e9e1cc' }}>{isGuide ? '★ ' : ''}{charName(id)}</span>
                {d && <span style={{ color: '#b9b29c', fontSize: 11 }}>Lvl {d.level === 'inf' ? '∞' : d.level}{d.leadership ? ` · Lead ${d.leadership}` : ''}</span>}
              </div>
            );
          })}
          <div style={{ color: '#776', fontSize: 10, marginTop: 4, borderTop: '1px solid #2a2418', paddingTop: 4 }}>★ = Guide · hover a name for its card</div>
        </div>
      )}
    </span>
  );
}

// Characters on the map (both sides' separated Companions + Minions — public info).
// Hover a name to read that character's card (player report: "is there a way to
// display Minion cards when you're the FP?").
function OnMapRoster({ view, onHoverChar }: { view: GameState; onHoverChar?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(view.characters?.inPlay ?? {});
  if (entries.length === 0) return null;
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill, border: 'none', cursor: 'pointer', font: 'inherit', color: '#e9e1cc' }}
        title="Characters on the map (Companions and Minions) — hover a name for its card">
        On the map {entries.length} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={roster} onMouseLeave={() => onHoverChar?.(null)}>
          {entries.map(([id, region]) => {
            const d = charDef(id);
            return (
              <div key={id} onMouseEnter={() => onHoverChar?.(id)}
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 6px', borderRadius: 5, cursor: 'help' }}>
                <span style={{ fontWeight: 600 }}>{charName(id)}</span>
                <span style={{ color: '#b9b29c', fontSize: 11 }}>{String(region)}{d ? ` · Lvl ${d.level === 'inf' ? '∞' : d.level}${d.leadership ? ` · Lead ${d.leadership}` : ''}` : ''}</span>
              </div>
            );
          })}
          <div style={{ color: '#776', fontSize: 10, marginTop: 4, borderTop: '1px solid #2a2418', paddingTop: 4 }}>Hover a name for its character card</div>
        </div>
      )}
    </span>
  );
}

// Browsable discard piles (player report: "no way to see the discarded or used
// cards"). Played/discarded cards are open information; hand-limit discards are
// face down — shown as type-only. Newest first. Hover a name for the card.
const CARD_NAME = new Map<string, string>((eventCards as { cards: { id: string; name: string }[] }).cards.map((c) => [c.id, c.name]));
function DiscardBrowser({ view, onHoverCard }: { view: GameState; onHoverCard?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const rows: { side: string; label: string; id: string | null; played: number }[] = [];
  // Global play order comes from the log: each card play logs an entry with `.card`
  // (player report: discards should be sorted in order played, not grouped by player).
  // Face-down (hand-limit) discards log no card id, so they can't be interleaved —
  // they sink to the oldest end, keeping their pile order.
  const playedAt = new Map<string, number>();
  (view.log ?? []).forEach((e, i) => { if (e.card) playedAt.set(e.card, i); });
  for (const side of ['fp', 'shadow'] as const) {
    const p = view.cards?.[side];
    if (!p) continue;
    const sideName = side === 'fp' ? 'FP' : 'SH';
    const at = (id: string | null) => (id != null ? playedAt.get(id) ?? -1 : -1);
    for (const id of [...(p.discard?.character ?? []), ...(p.discard?.strategy ?? [])]) {
      rows.push({ side: sideName, label: CARD_NAME.get(id) ?? id, id, played: at(id) });
    }
    for (const id of p.discardFaceDown ?? []) {
      const label = id.startsWith('hidden') ? `face-down ${id === 'hidden-character' ? 'Character' : 'Strategy'} card`
        : `${CARD_NAME.get(id) ?? id} (face down — only you see this)`;
      rows.push({ side: sideName, label, id: id.startsWith('hidden') ? null : id, played: at(id.startsWith('hidden') ? null : id) });
    }
    for (const id of p.table ?? []) rows.push({ side: sideName, label: `${CARD_NAME.get(id) ?? id} (in play on the table)`, id, played: at(id) });
  }
  rows.sort((a, b) => b.played - a.played); // newest play first; unlogged (face-down) last
  const total = rows.length;
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill, border: 'none', cursor: 'pointer', font: 'inherit', color: '#e9e1cc' }}
        title="Browse discarded / played / on-table Event cards (open information)">
        Discards {total} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={{ ...roster, maxHeight: 300, overflowY: 'auto', width: 300 }} onMouseLeave={() => onHoverCard?.(null)}>
          {total === 0 && <div style={{ color: '#998', fontSize: 12 }}>No cards discarded yet.</div>}
          {rows.map((r, i) => (
            <div key={i} onMouseEnter={() => r.id && onHoverCard?.(r.id)}
              style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 6px', borderRadius: 5, cursor: r.id ? 'help' : 'default' }}>
              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: r.side === 'FP' ? '#7fa8e6' : '#e6857f' }}>{r.side}</span>
              <span style={{ fontSize: 12, color: r.id ? '#e9e1cc' : '#998' }}>{r.label}</span>
            </div>
          ))}
          <div style={{ color: '#776', fontSize: 10, marginTop: 4, borderTop: '1px solid #2a2418', paddingTop: 4 }}>Hover a name for its card · hand-limit discards are face down (type only)</div>
        </div>
      )}
    </span>
  );
}

export function StatusBar({ view, you, onHoverChar, onHoverCard, trailing }: { view: GameState; you: string | null; onHoverChar?: (id: string | null) => void; onHoverCard?: (id: string | null) => void; trailing?: React.ReactNode }) {
  const fs = view.fellowship;
  return (
    <div style={bar}>
      <span style={pill}>Turn {view.turn}</span>
      <span style={pill}>Phase: {view.phase}</span>
      <span style={pill}>You: {you === 'fp' ? 'Free Peoples' : you === 'shadow' ? 'Shadow' : '—'}</span>
      <span style={{ ...pill, background: '#2f4f9e' }}>FP VP {view.victoryPoints.fp}</span>
      <span style={{ ...pill, background: '#a83232' }}>Shadow VP {view.victoryPoints.shadow}</span>
      <span style={{ ...pill, background: '#6b2d2d' }}>Corruption {fs.corruption}/12</span>
      <span style={pill}>Fellowship: {fs.mordor !== null ? `Mordor ${fs.mordor}/5` : `progress ${fs.progress}`}</span>
      <span style={fs.hidden ? { ...pill, background: '#274027', color: '#bfe6bf' } : { ...pill, background: '#a83232', color: '#fff', fontWeight: 700 }}
        title={fs.hidden ? 'The Fellowship is hidden — you may move it.' : 'The Fellowship is REVEALED — it cannot move until you hide it again (a Character die).'}>
        {fs.hidden ? '🙈 Hidden' : '🔴 REVEALED'}
      </span>
      <span style={pill}>Guide: <span
        onMouseEnter={() => onHoverChar?.(fs.guide)} onMouseLeave={() => onHoverChar?.(null)}
        style={{ textDecoration: 'underline dotted', cursor: 'help' }}>{charName(fs.guide)}</span></span>
      <FellowshipRoster guide={fs.guide} companions={fs.companions} onHoverChar={onHoverChar} />
      <OnMapRoster view={view} onHoverChar={onHoverChar} />
      <span style={pill} title="Shadow dice in the Hunt Box (allocated + Eyes). FP dice added this turn (from moving the Fellowship) each add +1 to every Hunt die.">
        Hunt box {view.hunt.box}{view.hunt.fpDiceInBox ? ` · +${view.hunt.fpDiceInBox} FP` : ''}
      </span>
      <span style={pill} title="Event cards in hand, split Character/Strategy. The opponent's cards are hidden, but their card BACKS (deck type) are open information on the tabletop.">
        🂠 FP {handSplit(view.cards?.fp?.hand)} · Shadow {handSplit(view.cards?.shadow?.hand)}
      </span>
      <DiscardBrowser view={view} onHoverCard={onHoverCard} />
      <span style={pill} title="The three Elven Rings. Held by the Free Peoples; when the FP use one it flips to the Shadow (who may then use it once), after which it is spent.">
        Elven Rings:{' '}
        {view.elvenRings.map((r, i) => (
          <span key={i} style={{ fontSize: 14, margin: '0 1px', color: r === 'fp' ? '#7fd0ff' : r === 'shadow' ? '#e6857f' : '#6a6458' }}
            title={r === 'fp' ? 'Free Peoples' : r === 'shadow' ? 'flipped to Shadow' : 'used (spent)'}>
            {r === 'used' ? '◇' : '◈'}
          </span>
        ))}
        <span style={{ color: '#998', marginLeft: 4 }}>
          ({view.elvenRings.filter((r) => r === 'fp').length} FP · {view.elvenRings.filter((r) => r === 'shadow').length} SH · {view.elvenRings.filter((r) => r === 'used').length} used)
        </span>
      </span>
      {/* Dice are shown in the DiceTray (right column) — not duplicated here. */}
      {trailing}
    </div>
  );
}

const bar: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: '#15110b', color: '#eee', fontFamily: 'system-ui', fontSize: 12, alignItems: 'center' };
const pill: React.CSSProperties = { background: '#33302a', padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' };
const roster: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 70, background: '#1c1710', border: '1px solid #5a4a2a', borderRadius: 8, padding: 6, minWidth: 200, boxShadow: '0 8px 30px #000', whiteSpace: 'nowrap' };
