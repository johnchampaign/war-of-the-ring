// Battle-outcome popup (player report: "show the battle outcome — dice and
// effect"). Pops once when a battle finishes (seq-tracked, like the HuntPopup),
// showing the final round's dice for each side (hits in gold), each side's losses,
// and the result. Combat is public info, so it shows for both players.
import type { GameState, Side } from '../engine/types';
import { RollRow } from './combatDice';
import mapData from '../../assets/map.json';

const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;
const sideName = (s: Side) => (s === 'fp' ? 'Free Peoples' : 'Shadow');

/** Is there a battle result the player hasn't clicked through yet? (PlayPage holds
 *  the cursor so the opponent's recap can wait for it.) */
export const battleResultPending = (view: GameState, seen: number): boolean =>
  !!view.lastBattle && view.lastBattle.seq > seen && !view.pendingChoice && !view.pendingCombat;

export function BattlePopup({ view, seen, onSeen, you }: { view: GameState; seen: number; onSeen: (seq: number) => void;
  /** The viewer's side, to colour the result as a win or a loss for THEM. */
  you?: Side | null }) {
  const b = view.lastBattle;
  // Wait until the battle is fully resolved and no other prompt is up.
  if (!b || !battleResultPending(view, seen)) return null;

  return (
    <div style={backdrop} onClick={() => onSeen(b.seq)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 6 }}>
          ⚔ {b.siege ? 'Siege' : 'Battle'} — {b.rounds} round{b.rounds === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 14, marginBottom: 8 }}>
          <b style={{ color: b.attacker === 'fp' ? '#7fb6e6' : '#e6857f' }}>{sideName(b.attacker)}</b> attacked{' '}
          <b>{rName(b.to)}</b> <span style={{ color: '#998' }}>(from {rName(b.from)})</span>
        </div>
        {/* The final round's dice. Earlier rounds show in the battle modal while a
            decision is open, but a round that needed no decision went by unseen — the
            battle simply ended (player reports 4m615j1m2h4p3r6b, 120y1m0p3h6f5h01). */}
        {(b.atkRoll || b.defRoll) && (
          <div style={{ margin: '6px 0' }} data-testid="battle-final-roll">
            <div style={{ fontSize: 11, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Round {b.rounds} roll</div>
            <RollRow label="Attacker" roll={b.atkRoll} color={b.attacker === 'fp' ? '#7fb6e6' : '#e6857f'} />
            <RollRow label="Defender" roll={b.defRoll} color={b.attacker === 'fp' ? '#e6857f' : '#7fb6e6'} />
          </div>
        )}
        <div style={{ fontSize: 13, margin: '8px 0', color: '#cbbf9a' }}>
          {/* UNITS REMOVED, which is not the same as hits scored: an Elite absorbs a
              hit by being reduced to a Regular and stays on the board (p.30). A player
              compared these against the log's hit counts and read the difference as a
              bug, so the label now says what is being counted. */}
          <span title="Units removed from the board. An Elite absorbing a hit is reduced to a Regular and is NOT removed, so this can be lower than the hits scored.">
            Units lost — Attacker: <b style={{ color: b.atkLosses ? '#e88' : '#9a9' }}>{b.atkLosses}</b> · Defender: <b style={{ color: b.defLosses ? '#e88' : '#9a9' }}>{b.defLosses}</b>
            <span style={{ color: '#776', fontSize: 11 }}> (an Elite reduced to a Regular is not a loss)</span>
          </span>
        </div>
        {/* Coloured from the VIEWER's side: green when you came out ahead, red when your
            opponent did, neutral when nobody did (player reports 036q6t2x10101p28,
            5j0r5a4k5b2t4q1l: a Free Peoples player storming Moria saw it in red). */}
        {(() => {
          const good = b.victor == null || !you ? null : b.victor === you;
          const tone = good === null ? { background: '#2e2a20', color: '#e6dcc0' } : good ? { background: '#1d3320', color: '#bfe6bf' } : { background: '#5a1f1f', color: '#ffb3b3' };
          return <div style={{ fontSize: 14, fontWeight: 700, padding: '6px 8px', borderRadius: 8, textAlign: 'center', ...tone }} data-testid="battle-outcome">{b.outcome}</div>;
        })()}
        <button style={btn} onClick={() => onSeen(b.seq)}>OK</button>
      </div>
    </div>
  );
}

// Above the turn-summary (z 56) so the player's OWN battle result is acknowledged
// FIRST, before the opponent's "while you waited" recap is revealed underneath.
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 58 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '16px 22px', borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 320, maxWidth: 460, boxShadow: '0 8px 40px #000' };
const btn: React.CSSProperties = { marginTop: 12, padding: '7px 22px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14, display: 'block', marginLeft: 'auto', marginRight: 'auto' };
