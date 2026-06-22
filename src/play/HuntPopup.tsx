// Informational popup for the Hunt for the Ring. Shows the full picture, not just
// the result: how many dice were in the Hunt Box, the actual die faces rolled (and
// any re-rolls), how many successes, and every tile drawn (including 0/blank).
// The engine records draws in hunt.draws (each with an incrementing seq and the
// roll that produced it); this tracks the highest seq shown so each new hunt pops
// exactly once. Hunt-damage CHOICES are handled by the DecisionModal; this waits
// until no choice is pending.
import { useState } from 'react';
import type { GameState } from '../engine/types';
import { RollLine, CorruptionLine, HuntTileFace } from './huntView';

export function HuntPopup({ view }: { view: GameState }) {
  const draws = view.hunt.draws ?? [];
  const [seen, setSeen] = useState(0);
  const fresh = draws.filter((d) => d.seq > seen);
  // Suppress only while a hunt-RESOLUTION choice is open (the DecisionModal shows
  // that with its own Hunt context). For other pending choices — notably the
  // reveal-and-move prompt that a catch triggers — still show the result, so the
  // player sees the dice and the tile that caught them before placing the figure.
  const HUNT_RESOLUTION_CHOICES = new Set(['huntDamage', 'huntPreventDraw', 'huntRedraw', 'crebain']);
  if (fresh.length === 0 || (view.pendingChoice && HUNT_RESOLUTION_CHOICES.has(view.pendingChoice.kind))) return null;
  const maxSeq = Math.max(...fresh.map((d) => d.seq));
  const dismiss = () => setSeen(maxSeq);
  const roll = fresh.find((d) => d.roll)?.roll;
  // A drawn tile revealed the Fellowship — call it out loudly. The reveal is shown
  // either once it's flipped, or while the reveal-and-move prompt is still pending
  // (a catch with Progress defers the flip until the figure is placed).
  const revealed = fresh.some((d) => d.reveal) && (!view.fellowship.hidden || view.pendingChoice?.kind === 'revealMove');

  return (
    <div style={backdrop} onClick={dismiss}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>
          ⊙ The Hunt for the Ring
        </div>
        {roll && <RollLine roll={roll} />}
        <div style={{ fontSize: 11, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, margin: '10px 0 2px' }}>
          {fresh.length === 1 ? 'Tile drawn from the bag' : `${fresh.length} tiles drawn from the bag`}
        </div>
        {fresh.length === 1 && roll && !roll.mordor && (
          <div style={{ fontSize: 10.5, color: '#776e58', marginBottom: 2 }}>
            a successful Hunt draws exactly one tile — your {roll.successes} success{roll.successes === 1 ? '' : 'es'} only decided that you drew
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, margin: '6px 0' }}>
          {fresh.map((d) => <HuntTileFace key={d.seq} draw={d} />)}
        </div>
        {/* The impact on the track — the downstream OUTCOME of the tile above. */}
        <div style={{ fontSize: 11, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, margin: '8px 0 0' }}>Result</div>
        <CorruptionLine current={view.fellowship.corruption} />
        {revealed && (
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#a83232', color: '#fff', borderRadius: 8, fontSize: 13, lineHeight: 1.4 }}>
            🔴 <b>The Fellowship has been REVEALED!</b><br />
            It can't move again until you <b>hide it</b> with a Character die. (You'll place it on the board now.)
          </div>
        )}
        <button style={btn} onClick={dismiss}>OK</button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 55 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '16px 22px', borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 300, maxWidth: 440, boxShadow: '0 8px 40px #000', textAlign: 'center' };
const btn: React.CSSProperties = { marginTop: 12, padding: '7px 22px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
