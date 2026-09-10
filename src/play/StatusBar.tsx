// Top status bar: turn / phase / seat, victory points, the Ring track, dice.
import type { WotrAction } from '../adapter/wotrAction';
import { describeAction } from './actionText';
import { phaseLabel } from './names';
import { useLayoutEffect, useRef, useState } from 'react';
import type { GameState } from '../engine/types';
import { charName, charDef, isMinion } from './charInfo';
import { STANDARD_TILE_LIST, SPECIAL_TILE_BY_CARD, EVENT_BY_ID, type HuntTileDef } from '../engine/data';
import eventCards from '../../assets/event-cards.json';

/** Keeps a status-bar dropdown inside the window. The panels are left-anchored to
 *  their pill by default; for a pill near the right edge that pushed the panel past
 *  the viewport, which gave the whole PAGE a horizontal scrollbar, and the scrollbar
 *  in turn shoved the right-hand column's layout around (player report 2r2g). When
 *  left-anchoring would overflow and right-anchoring fits, we flip. Measured off the
 *  ANCHOR (the wrapping span), never off the panel's own placement, so the decision
 *  can't oscillate. */
function useEdgeFlip(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    if (!open) { setFlip(false); return; }
    const measure = () => {
      const el = ref.current;
      const anchor = el?.parentElement?.getBoundingClientRect();
      if (!el || !anchor) return;
      const w = el.offsetWidth;
      setFlip(anchor.left + w > window.innerWidth - 8 && anchor.right - w > 8);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);
  return { ref, flipStyle: (flip ? { left: 'auto', right: 0 } : {}) as React.CSSProperties };
}

// Human label for a Hunt tile ("3, reveal" / "Eye" / "die, stop").
function tileLabel(t: HuntTileDef | undefined): string {
  if (!t) return '?';
  const v = t.value === 'eye' ? 'Eye' : t.value === 'die' ? 'die roll' : String(t.value);
  return v + (t.reveal ? ', reveal' : '') + (t.stop ? ', stop' : '');
}

// Drawn Hunt tiles + special-tile status (player request, twice: "display played
// Hunt tiles somewhere — relevant info for a FP player deciding to move"). All of
// this is open information: drawn tiles are public, and the pool contents are
// deducible from the fixed tile mix minus the drawn ones.
function HuntTilesBrowser({ view }: { view: GameState }) {
  const [open, setOpen] = useState(false);
  const { ref, flipStyle } = useEdgeFlip(open);
  const h = view.hunt;
  const drawn = (h.drawn ?? []).map((i) => tileLabel(STANDARD_TILE_LIST[i]));
  const specialsDrawn = (h.specialsDrawn ?? []).map((id) => `${tileLabel(SPECIAL_TILE_BY_CARD[id])} (${EVENT_BY_ID[id]?.name ?? id})`);
  const inPlay = (h.specialsInPlay ?? []).map((id) => `${tileLabel(SPECIAL_TILE_BY_CARD[id])} (${EVENT_BY_ID[id]?.name ?? id})`);
  const inPool = (h.specialsInPool ?? []).map((id) => `${tileLabel(SPECIAL_TILE_BY_CARD[id])} (${EVENT_BY_ID[id]?.name ?? id})`);
  const total = drawn.length + specialsDrawn.length;
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill, border: 'none', cursor: 'pointer', font: 'inherit', color: '#e9e1cc' }}
        title="Hunt tiles drawn so far (they return when the pool reshuffles), plus special tiles in play / in the pool">
        Hunt tiles {total} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div ref={ref} style={{ ...roster, ...flipStyle, ...wide }}>
          <div style={{ fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5 }}>Drawn (out of the bag)</div>
          {total === 0 && <div style={{ color: '#998', fontSize: 12, padding: '2px 6px' }}>No tiles drawn yet.</div>}
          {[...drawn, ...specialsDrawn].map((s, i) => <div key={i} style={{ fontSize: 12, padding: '1px 6px' }}>{s}</div>)}
          {inPlay.length > 0 && <>
            <div style={{ fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>Special tiles in play (enter the bag on Mordor)</div>
            {inPlay.map((s, i) => <div key={i} style={{ fontSize: 12, padding: '1px 6px' }}>{s}</div>)}
          </>}
          {inPool.length > 0 && <>
            <div style={{ fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>Special tiles in the bag</div>
            {inPool.map((s, i) => <div key={i} style={{ fontSize: 12, padding: '1px 6px' }}>{s}</div>)}
          </>}
          <div style={{ color: '#776', fontSize: 10, marginTop: 4, borderTop: '1px solid #2a2418', paddingTop: 4 }}>Drawn standard tiles reshuffle back in when the bag empties.</div>
        </div>
      )}
    </span>
  );
}

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
  const { ref, flipStyle } = useEdgeFlip(open);
  const ids = companions.includes(guide) ? companions : [guide, ...companions];
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill, border: 'none', cursor: 'pointer', font: 'inherit', color: '#e9e1cc' }}
        title="Browse the Fellowship — hover a name to see the card">
        {companions.length} companion{companions.length === 1 ? '' : 's'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div ref={ref} style={{ ...roster, ...flipStyle }} onMouseLeave={() => onHoverChar?.(null)}>
          {ids.length === 0 && <div style={{ color: '#998', fontSize: 12 }}>No companions remain.</div>}
          {ids.map((id) => {
            const d = charDef(id);
            const isGuide = id === guide;
            return (
              <div key={id} onMouseEnter={() => onHoverChar?.(id)}
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 6px', borderRadius: 5, cursor: 'help', background: isGuide ? '#2c2616' : 'transparent' }}>
                <span style={{ fontWeight: 600, color: isGuide ? '#ffd86a' : '#e9e1cc' }}>{isGuide ? '★ ' : ''}{charName(id)}</span>
                {d && <span style={{ color: '#b9b29c', fontSize: 11 }}>Level {d.level === 'inf' ? '∞' : d.level}{d.leadership ? ` · Leadership ${d.leadership}` : ''}</span>}
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
  const { ref, flipStyle } = useEdgeFlip(open);
  const entries = Object.entries(view.characters?.inPlay ?? {});
  if (entries.length === 0) return null;
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill, border: 'none', cursor: 'pointer', font: 'inherit', color: '#e9e1cc' }}
        title="Characters on the map (Companions and Minions) — hover a name for its card">
        On the map {entries.length} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div ref={ref} style={{ ...roster, ...flipStyle }} onMouseLeave={() => onHoverChar?.(null)}>
          {entries.map(([id, region]) => {
            const d = charDef(id);
            return (
              <div key={id} onMouseEnter={() => onHoverChar?.(id)}
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 6px', borderRadius: 5, cursor: 'help' }}>
                <span style={{ fontWeight: 600 }}>{charName(id)}</span>
                <span style={{ color: '#b9b29c', fontSize: 11 }}>{String(region)}{d ? ` · Level ${d.level === 'inf' ? '∞' : d.level}${d.leadership ? ` · Leadership ${d.leadership}` : ''}` : ''}</span>
              </div>
            );
          })}
          <div style={{ color: '#776', fontSize: 10, marginTop: 4, borderTop: '1px solid #2a2418', paddingTop: 4 }}>Hover a name for its character card</div>
        </div>
      )}
    </span>
  );
}

// Characters removed from play — eliminated Companions and Minions (player report,
// twice: "would it be possible for lost companions/minions to be listed somewhere for
// confirmation/reference purposes?"). Casualties are open information on the tabletop:
// the figure comes off the board where both players can see it.
function FallenRoster({ view, onHoverChar }: { view: GameState; onHoverChar?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const { ref, flipStyle } = useEdgeFlip(open);
  const ids = view.characters?.eliminated ?? [];
  if (ids.length === 0) return null;
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill, border: 'none', cursor: 'pointer', font: 'inherit', color: '#e9b0a8' }}
        title="Companions and Minions eliminated so far (out of the game) — hover a name for its card">
        ☠ Fallen {ids.length} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div ref={ref} style={{ ...roster, ...flipStyle }} onMouseLeave={() => onHoverChar?.(null)}>
          {ids.map((id) => {
            const d = charDef(id);
            const shadow = isMinion(id);
            return (
              <div key={id} onMouseEnter={() => onHoverChar?.(id)}
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 6px', borderRadius: 5, cursor: 'help' }}>
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: shadow ? '#e6857f' : '#7fa8e6' }}>{shadow ? 'SH' : 'FP'}</span>
                <span style={{ fontWeight: 600, color: '#c9bfae', textDecoration: 'line-through' }}>{charName(id)}</span>
                {d && <span style={{ color: '#8d8677', fontSize: 11 }}>Level {d.level === 'inf' ? '∞' : d.level}{d.leadership ? ` · Leadership ${d.leadership}` : ''}</span>}
              </div>
            );
          })}
          <div style={{ color: '#776', fontSize: 10, marginTop: 4, borderTop: '1px solid #2a2418', paddingTop: 4 }}>Eliminated figures never return · hover a name for its card</div>
        </div>
      )}
    </span>
  );
}

// Browsable discard piles (player report: "no way to see the discarded or used
// cards"). Played/discarded cards are open information; cards discarded from a
// hand (hand limit, Worn with Sorrow, the A Power too Great payment) are face
// down — shown as type-only. Newest first. Hover a name for the card.
const CARD_NAME = new Map<string, string>((eventCards as { cards: { id: string; name: string }[] }).cards.map((c) => [c.id, c.name]));
function DiscardBrowser({ view, onHoverCard }: { view: GameState; onHoverCard?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const { ref, flipStyle } = useEdgeFlip(open);
  const rows: { side: string; label: string; id: string | null; played: number }[] = [];
  // Global play order comes from the log: each card play logs an entry with `.card`
  // (player report: discards should be sorted in order played, not grouped by player).
  // Face-down discards log no public card id, so they can't be interleaved —
  // they sink to the oldest end, keeping their pile order.
  const playedAt = new Map<string, number>();
  (view.log ?? []).forEach((e, i) => { if (e.card) playedAt.set(e.card, i); });
  for (const side of ['fp', 'shadow'] as const) {
    const p = view.cards?.[side];
    if (!p) continue;
    const sideName = side === 'fp' ? 'Free Peoples' : 'Shadow';
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
        <div ref={ref} style={{ ...roster, ...flipStyle, ...wide }} onMouseLeave={() => onHoverCard?.(null)}>
          {total === 0 && <div style={{ color: '#998', fontSize: 12 }}>No cards discarded yet.</div>}
          {rows.map((r, i) => (
            <div key={i} onMouseEnter={() => r.id && onHoverCard?.(r.id)}
              style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 6px', borderRadius: 5, cursor: r.id ? 'help' : 'default' }}>
              <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: r.side === 'Free Peoples' ? '#7fa8e6' : '#e6857f' }}>{r.side}</span>
              <span style={{ fontSize: 12, color: r.id ? '#e9e1cc' : '#998' }}>{r.label}</span>
            </div>
          ))}
          <div style={{ color: '#776', fontSize: 10, marginTop: 4, borderTop: '1px solid #2a2418', paddingTop: 4 }}>Hover a name for its card · cards discarded from a hand are face down (type only)</div>
        </div>
      )}
    </span>
  );
}

export function StatusBar({ view, you, onHoverChar, onHoverCard, trailing, elvenActions = [], onAction }: { view: GameState; you: string | null; onHoverChar?: (id: string | null) => void; onHoverCard?: (id: string | null) => void; elvenActions?: WotrAction[]; onAction?: (a: WotrAction) => void; trailing?: React.ReactNode }) {
  const fs = view.fellowship;
  return (
    <div style={bar}>
      <span style={pill}>Turn {view.turn}</span>
      <span style={pill}>Phase: {phaseLabel(view.phase)}</span>
      <span style={pill}>You: {you === 'fp' ? 'Free Peoples' : you === 'shadow' ? 'Shadow' : '—'}</span>
      <span style={{ ...pill, background: '#2f4f9e' }}>Free Peoples VP {view.victoryPoints.fp}</span>
      <span style={{ ...pill, background: '#a83232' }}>Shadow VP {view.victoryPoints.shadow}</span>
      <span style={{ ...pill, background: '#6b2d2d' }}>Corruption {fs.corruption}/12</span>
      <span style={pill}>Fellowship: {fs.mordor !== null ? `Mordor ${fs.mordor}/5` : `progress ${fs.progress}`}</span>
      <span style={fs.hidden ? { ...pill, background: '#274027', color: '#bfe6bf' } : { ...pill, background: '#a83232', color: '#fff', fontWeight: 700 }}
        title={fs.hidden ? 'The Fellowship is hidden — you may move it.' : 'The Fellowship is revealed — it cannot move until you hide it again (a Character die).'}>
        {/* The red chip, the red pip and the bold weight already carry the emphasis;
            ALL CAPS on top of them was just shouting (player report 050o5k5s1h5s2w24). */}
        {fs.hidden ? '🙈 Hidden' : '🔴 Revealed'}
      </span>
      <span style={pill}>Guide: <span
        onMouseEnter={() => onHoverChar?.(fs.guide)} onMouseLeave={() => onHoverChar?.(null)}
        style={{ textDecoration: 'underline dotted', cursor: 'help' }}>{charName(fs.guide)}</span></span>
      <FellowshipRoster guide={fs.guide} companions={fs.companions} onHoverChar={onHoverChar} />
      <OnMapRoster view={view} onHoverChar={onHoverChar} />
      <FallenRoster view={view} onHoverChar={onHoverChar} />
      <span style={pill} title="Shadow dice in the Hunt Box (allocated + Eyes). Free Peoples dice added this turn (from moving the Fellowship) each add +1 to every Hunt die.">
        Hunt box {view.hunt.box}{view.hunt.fpDiceInBox ? ` · +${view.hunt.fpDiceInBox} Free Peoples` : ''}
      </span>
      <span style={pill} title="Event cards in hand, split Character/Strategy. The opponent's cards are hidden, but their card BACKS (deck type) are open information on the tabletop.">
        🂠 Free Peoples {handSplit(view.cards?.fp?.hand)} · Shadow {handSplit(view.cards?.shadow?.hand)}
      </span>
      <DiscardBrowser view={view} onHoverCard={onHoverCard} />
      <HuntTilesBrowser view={view} />
      <ElvenRingsPill view={view} actions={elvenActions} onAction={onAction} />
      {/* Dice are shown in the DiceTray (right column) — not duplicated here. */}
      {trailing}
    </div>
  );
}

// The Elven Rings pill. Using a Ring is not an Action — it costs no die and precedes
// the action — so its uses live here, behind the pill, instead of padding out the
// action list (player report 5f1r022l2q5t0p0b: "a giant list in the Action panel").
function ElvenRingsPill({ view, actions, onAction }: { view: GameState; actions: WotrAction[]; onAction?: (a: WotrAction) => void }) {
  const [open, setOpen] = useState(false);
  const { ref, flipStyle } = useEdgeFlip(open);
  const usable = actions.length > 0 && !!onAction;
  const counts = { fp: view.elvenRings.filter((r) => r === 'fp').length, shadow: view.elvenRings.filter((r) => r === 'shadow').length, used: view.elvenRings.filter((r) => r === 'used').length };
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => usable && setOpen((o) => !o)}
        style={{ ...pill, border: usable ? '1px solid #7fd0ff' : 'none', cursor: usable ? 'pointer' : 'default', font: 'inherit', color: '#e9e1cc' }}
        title={usable ? 'You may use an Elven Ring before your action — click to choose' : 'The three Elven Rings. Held by the Free Peoples; when they use one it flips to the Shadow (who may then use it once), after which it is spent.'}>
        Elven Rings:{' '}
        {view.elvenRings.map((r, i) => (
          <span key={i} style={{ fontSize: 14, margin: '0 1px', color: r === 'fp' ? '#7fd0ff' : r === 'shadow' ? '#e6857f' : '#6a6458' }}
            title={r === 'fp' ? 'Free Peoples' : r === 'shadow' ? 'flipped to Shadow' : 'used (spent)'}>
            {r === 'used' ? '◇' : '◈'}
          </span>
        ))}
        <span style={{ color: '#998', marginLeft: 4 }}>({counts.fp} Free Peoples · {counts.shadow} Shadow · {counts.used} used)</span>
        {usable && <span style={{ marginLeft: 4 }}>{open ? '▴' : '▾'}</span>}
      </button>
      {open && usable && (
        <div ref={ref} style={{ ...roster, ...flipStyle }}>
          <div style={{ color: '#b9b29c', fontSize: 11, marginBottom: 4 }}>Use a Ring (before your action, no die spent):</div>
          {actions.map((a, i) => (
            <button key={i} onClick={() => { setOpen(false); onAction?.(a); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', margin: '2px 0', padding: '4px 8px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 5, cursor: 'pointer', font: 'inherit', fontSize: 12 }}>
              {describeAction(a)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

const bar: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: '#15110b', color: '#eee', fontFamily: 'system-ui', fontSize: 12, alignItems: 'center' };
const pill: React.CSSProperties = { background: '#33302a', padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' };
// Panels wrap their text (they used to be `nowrap`, so a long row overflowed the
// panel sideways and grew it a horizontal scrollbar of its own — report 2r2g) and
// are capped at the window width so they can never be the thing that overflows.
const roster: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 70, background: '#1c1710', border: '1px solid #5a4a2a', borderRadius: 8, padding: 6, minWidth: 200, maxWidth: 'calc(100vw - 16px)', boxShadow: '0 8px 30px #000', whiteSpace: 'normal', overflowWrap: 'anywhere' };
// The two long-list panels (Hunt tiles, Discards) scroll vertically only.
const wide: React.CSSProperties = { width: 'min(300px, calc(100vw - 16px))', maxHeight: 300, overflowY: 'auto', overflowX: 'hidden' };
