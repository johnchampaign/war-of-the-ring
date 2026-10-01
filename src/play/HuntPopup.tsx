// Informational popup for the Hunt for the Ring. Shows the full picture, not just
// the result: how many dice were in the Hunt Box, the actual die faces rolled (and
// any re-rolls), how many successes, and every tile drawn (including 0/blank).
// The engine records draws in hunt.draws (each with an incrementing seq and the
// roll that produced it); the highest seq shown is tracked by PlayPage (so the
// opponent's "while you waited" recap can wait for this result to be acknowledged
// — report: an unsuccessful Hunt was buried by the AI recap the instant it
// resolved). Hunt-damage CHOICES are handled by the DecisionModal; this waits
// until no choice is pending.
import type { GameState } from '../engine/types';
import { huntResolutionPending } from '../engine/hunt';
import { RollLine, CorruptionLine, HuntTileFace } from './huntView';

/** Is there a Hunt result the player hasn't clicked through yet? Suppressed only
 *  while a hunt-RESOLUTION choice is open (the DecisionModal shows that with its own
 *  Hunt context). For other pending choices — notably the reveal-and-move prompt a
 *  catch triggers — the result still shows, so the player sees the dice and the tile
 *  that caught them before placing the figure. */
export const huntResultPending = (view: GameState, seen: number): boolean =>
  (view.hunt.draws ?? []).some((d) => d.seq > seen) && !huntResolutionPending(view);

export function HuntPopup({ view, seen, onSeen }: { view: GameState; seen: number; onSeen: (seq: number) => void }) {
  const draws = view.hunt.draws ?? [];
  if (!huntResultPending(view, seen)) return null;
  // One popup per independent draw: a Hunt roll's tiles together, but a tile some other
  // source drew (a Stronghold reveal, an Event card, the Balrog) in a popup of its own,
  // queued one after the other. They used to share one popup under whichever roll came
  // first (player reports 0u1q454220715m2b, 4t3r27062w29120h).
  const unseen = draws.filter((d) => d.seq > seen);
  const keyOf = (d: (typeof draws)[number]) => d.source ?? JSON.stringify(d.roll ?? null);
  const firstKey = keyOf(unseen[0]!);
  const fresh: typeof unseen = [];
  for (const d of unseen) { if (keyOf(d) !== firstKey) break; fresh.push(d); }
  const maxSeq = Math.max(...fresh.map((d) => d.seq));
  const dismiss = () => onSeen(maxSeq);
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
        {!roll && fresh[0]!.source && !fresh.every((d) => d.discarded) && (
          <div style={{ fontSize: 13, color: '#cbbf9a' }}>
            {fresh[0]!.source.startsWith('revealed ')
              ? <>The Fellowship was {fresh[0]!.source} — a Shadow Stronghold: one tile is drawn, with no Hunt roll.</>
              : <><b>{fresh[0]!.source}</b>: a tile is drawn directly, with no Hunt roll.</>}
          </div>
        )}
        {fresh.every((d) => d.discarded) ? (
          <div style={{ margin: '12px 0 4px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#9cc77a' }}>{fresh[0]!.source}: the tile drawn was {fresh[0]!.value === 'eye' ? 'an Eye' : 'a Free Peoples special tile'} — discarded without effect.</div>
            {/* A tile that does nothing is still a tile that came out of the bag, and the
                player wants to SEE it, exactly as they see every other draw (player
                report 6m4w0z462s3a1n0s). */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, margin: '8px 0 2px' }}>
              {fresh.map((d) => <HuntTileFace key={d.seq} draw={d} />)}
            </div>
            {/* Stated per tile kind, not as a base-game-only generalization (player report 0l5o3w4k2y5t6s33). */}
            <div style={{ fontSize: 11, color: '#887', marginTop: 3 }}>{fresh[0]!.value === 'eye' ? (fresh[0]!.source?.startsWith('revealed ')
              // A reveal through a Shadow Stronghold is not an Event card (player report 6z10320k4z2o0k24).
              ? 'Eye tiles drawn because of a Shadow Stronghold presence are discarded without effect.'
              : 'Eye tiles drawn by Event cards are discarded without effect.') : `Free Peoples special tiles drawn by ${fresh[0]!.source} are discarded without effect.`}</div>
          </div>
        ) : fresh.every((d) => d.miss) ? (
          <div style={{ margin: '12px 0 4px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#9cc77a' }}>The Hunt missed — no tile drawn.</div>
            <div style={{ fontSize: 11, color: '#887', marginTop: 3 }}>The Shadow rolled but scored no successes (a die must reach 6+ after the box bonus).</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, margin: '10px 0 2px' }}>
              {fresh.length === 1 ? 'Tile drawn from the bag' : `${fresh.length} tiles drawn from the bag`}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, margin: '6px 0' }}>
              {fresh.filter((d) => !d.miss).map((d) => <HuntTileFace key={d.seq} draw={d} />)}
            </div>
            {/* The impact on the track — the downstream OUTCOME of the tile above. */}
            <div style={{ fontSize: 11, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, margin: '8px 0 0' }}>Result</div>
            <CorruptionLine current={view.fellowship.corruption} />
          </>
        )}
        {revealed && (
          <div style={{ marginTop: 10, padding: '8px 10px', background: '#a83232', color: '#fff', borderRadius: 8, fontSize: 13, lineHeight: 1.4 }}>
            🔴 <b>The Fellowship has been revealed!</b><br />
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
