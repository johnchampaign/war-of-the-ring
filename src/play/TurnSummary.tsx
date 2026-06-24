// "While your opponent played…" — when control returns to you, a dismissable
// summary of everything that happened since you last had control (the opponent's
// actions and their public consequences). Uses the redacted turn log (public
// entries + your own side-tagged ones), so it never leaks hidden info. Best suited
// to async PvP (you return once and catch up); in rapid vs-AI/hotseat play it pops
// each time the AI acts — easy to dismiss.
import { useState } from 'react';
import type { GameState, Side } from '../engine/types';
import { FACE } from './DiceTray';
import { CardZoom } from './HandStrip';

const KIND_COLOR: Record<string, string> = {
  combat: '#e6857f', army: '#d8cfa8', muster: '#9cc77a', hunt: '#e6a3d0',
  fellowship: '#e6b85a', event: '#9fb6e6', politics: '#cbb',
};

/** Small chip for the action die a logged step spent (so "which die" is visible). */
function DieChip({ face }: { face: string }) {
  const f = FACE[face] ?? { label: face, bg: '#555' };
  return <span style={{ background: f.bg, color: '#fff', borderRadius: 4, padding: '0 5px', fontSize: 9, fontWeight: 700, flexShrink: 0, alignSelf: 'flex-start', marginTop: 1 }}>{f.label}</span>;
}

export function TurnSummary({ view, yourTurn, you }: { view: GameState; yourTurn: boolean; you: Side | null }) {
  const [dismissed, setDismissed] = useState(-1);
  // A logged card play the player tapped to enlarge — so they can read the card the
  // opponent (or AI) just played, including its "Play if…" legality, full-screen.
  const [zoom, setZoom] = useState<string | null>(null);
  // The client marks where the events the viewer didn't cause begin (oppLogStart).
  const start = (view as unknown as { oppLogStart?: number }).oppLogStart;
  const items = (typeof start === 'number' && view.log.length > start) ? view.log.slice(start) : [];

  // Show only on the viewer's turn, once per new block, never over a live decision.
  if (!yourTurn || items.length === 0 || start === dismissed || view.pendingChoice || view.pendingCombat) return null;
  const dismiss = () => setDismissed(start!);
  const oppName = you === 'fp' ? 'Shadow' : you === 'shadow' ? 'Free Peoples' : 'the opponent';

  return (
    <>
      <div style={backdrop} onClick={dismiss}>
        <div style={card} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>
            While you waited, {oppName} took {items.length} action{items.length === 1 ? '' : 's'}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, textAlign: 'left', maxHeight: '55vh', overflowY: 'auto' }}>
            {items.map((e, i) => (
              <li key={i} style={{ fontSize: 13, padding: '3px 0', borderBottom: '1px solid #2a2418', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: KIND_COLOR[e.kind] ?? '#998', width: 58, marginTop: 1 }}>{e.kind}</span>
                {e.die && <DieChip face={e.die} />}
                <span style={{ flex: 1 }}>{e.msg}</span>
                {/* If this entry was a card play, let the player enlarge that card to read
                    its effect and "Play if…" legality (card plays are open information). */}
                {e.card && <button style={viewCardBtn} onClick={() => setZoom(e.card!)} title="View this card">🔍 card</button>}
              </li>
            ))}
          </ul>
          <button style={btn} onClick={dismiss}>Continue</button>
        </div>
      </div>
      {/* Rendered outside the recap backdrop so closing the enlarged card doesn't also
          dismiss the recap (the zoom has its own click-to-close backdrop). */}
      {zoom && <CardZoom id={zoom} onClose={() => setZoom(null)} />}
    </>
  );
}

const viewCardBtn: React.CSSProperties = { flexShrink: 0, alignSelf: 'flex-start', marginTop: 1, fontSize: 10, padding: '1px 6px', background: '#2e2a1f', color: '#d8cfa8', border: '1px solid #5a4a2a', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' };
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.62)', display: 'grid', placeItems: 'center', zIndex: 56 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '16px 22px', borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 340, maxWidth: 520, boxShadow: '0 8px 40px #000' };
const btn: React.CSSProperties = { marginTop: 12, padding: '7px 22px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14, display: 'block', marginLeft: 'auto' };
