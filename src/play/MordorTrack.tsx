// The Mordor Track, as an always-visible board overlay once the Ring-bearers
// enter Mordor. On the tabletop the Fellowship figure physically leaves the map
// and stands on the printed track, so "where am I?" is answered at a glance;
// digitally the figure was still sitting on Morannon/Minas Morgul with only a
// text pill saying "Mordor 3/5" (player report: "I found it difficult to keep
// track of where I was in the final turns"). This puts the Ring back on a track.
import type { GameState } from '../engine/types';
import { RingGlyph } from './RingIcon';

const STEPS = [0, 1, 2, 3, 4, 5];

export function MordorTrack({ view }: { view: GameState }) {
  const step = view.fellowship.mordor;
  if (step === null) return null;
  const CELL = 26, GAP = 3, PAD = 6;
  const w = STEPS.length * CELL + (STEPS.length - 1) * GAP;

  return (
    <div style={panel} title="The Mordor Track. Each Fellowship move advances one step and draws a Hunt tile automatically; standing still costs 1 Corruption. Step 5 is the Crack of Doom — reach it below 12 Corruption and the Ring is destroyed.">
      <div style={{ fontSize: 11, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 0.5, marginBottom: 4 }}>
        ▲ Mordor Track
      </div>
      <svg width={w} height={CELL + PAD} viewBox={`0 0 ${w} ${CELL + PAD}`} style={{ display: 'block' }}>
        {STEPS.map((s) => {
          const x = s * (CELL + GAP);
          const here = s === step;
          const past = s < step;
          const doom = s === 5;
          return (
            <g key={s}>
              <rect x={x} y={PAD} width={CELL} height={CELL} rx={5}
                fill={here ? '#4a3a12' : past ? '#2b2519' : doom ? '#3a1410' : '#221d14'}
                stroke={here ? '#e3bf47' : doom ? '#a8452e' : '#4a4332'} strokeWidth={here ? 2 : 1} />
              {here
                ? <RingGlyph cx={x + CELL / 2} cy={PAD + CELL / 2} r={7} />
                : <text x={x + CELL / 2} y={PAD + CELL / 2 + 4} fontSize={11} textAnchor="middle"
                    fill={doom ? '#e08a72' : past ? '#7d7460' : '#9a927c'}>{doom ? '☉' : s}</text>}
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 10, color: '#9bb0c8', marginTop: 3 }}>
        Step {step} of 5{step === 5 ? '' : ` · ${5 - step} to the Crack of Doom`}
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: 'absolute', bottom: 6, right: 6, zIndex: 5, textAlign: 'left',
  background: 'rgba(28,23,16,0.92)', color: '#e9e1cc', border: '1px solid #5a4a2a',
  borderRadius: 8, padding: '6px 8px', boxShadow: '0 2px 8px #0006', pointerEvents: 'none',
};
