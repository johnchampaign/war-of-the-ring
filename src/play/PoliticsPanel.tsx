// Political track + victory points. Each of the 8 nations sits on a track; step 0
// is "At War" (its armies can attack / move freely). Passive nations (hollow
// marker) must be activated before they can reach At War. This mirrors the
// board's political track so the player can read war-readiness at a glance.
import type { GameState, Nation } from '../engine/types';
import { FP_NATIONS, SHADOW_NATIONS } from '../engine/types';

const NATION_COLOR: Record<Nation, string> = {
  dwarves: '#7a5230', elves: '#5fbf6a', gondor: '#2f4f9e', north: '#7fb6e6',
  rohan: '#2e7d4f', isengard: '#c9b037', sauron: '#a83232', southrons: '#d98a3d',
};
const NATION_LABEL: Record<Nation, string> = {
  dwarves: 'Dwarves', elves: 'Elves', gondor: 'Gondor', north: 'North', rohan: 'Rohan',
  sauron: 'Sauron', isengard: 'Isengard', southrons: 'Southrons',
};
const TRACK_MAX = 3; // display 3 → 2 → 1 → War

export function PoliticsPanel({ view }: { view: GameState }) {
  return (
    <div style={panel}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Politics</div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        <NationGroup view={view} nations={FP_NATIONS} label="Free Peoples" />
        <NationGroup view={view} nations={SHADOW_NATIONS} label="Shadow" />
      </div>
    </div>
  );
}

function NationGroup({ view, nations, label }: { view: GameState; nations: Nation[]; label: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      {nations.map((n) => <NationRow key={n} n={n} ns={view.nations[n]} />)}
    </div>
  );
}

function NationRow({ n, ns }: { n: Nation; ns: GameState['nations'][Nation] }) {
  const step = Math.min(ns.step, TRACK_MAX);
  const atWar = ns.step === 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: NATION_COLOR[n], flexShrink: 0,
        border: ns.active ? '1px solid #fff' : '1px solid #665', opacity: ns.active ? 1 : 0.5 }} />
      <span style={{ width: 64, fontSize: 11, color: atWar ? '#ffd23f' : '#ddd' }}>{NATION_LABEL[n]}</span>
      {/* Left-anchored progress bar toward War: filled cells = steps mobilized, so a
          nation advancing reads as "more progress", never as a row knocked out of
          alignment (the old single-moving-dot design). The rightmost cell is War. */}
      <div style={{ display: 'flex', gap: 2 }}>
        {Array.from({ length: TRACK_MAX + 1 }).map((_, i) => {
          const pos = TRACK_MAX - i;       // boxes 3,2,1 then 0 (War) on the right
          const atWar = pos === 0;
          const advanced = TRACK_MAX - step; // how far this nation has mobilized
          // Cumulative left-anchored fill: the start box is always filled, each step
          // toward War adds one cell; the War cell lights only when fully mobilized.
          const filled = atWar ? step === 0 : i <= advanced;
          return (
            <span key={i} title={atWar ? 'At War' : `${pos} step${pos === 1 ? '' : 's'} from War`} style={{
              width: 12, height: 12, borderRadius: atWar ? 2 : 6, fontSize: 8, lineHeight: '12px', textAlign: 'center',
              background: filled ? (atWar ? '#c0392b' : '#caa84b') : '#332b1e',
              color: filled ? '#fff' : '#776', border: atWar ? '1px solid #e6857f' : '1px solid #443',
            }}>{atWar ? '⚔' : ''}</span>
          );
        })}
      </div>
      {!ns.active && <span style={{ fontSize: 9, color: '#887' }}>passive</span>}
    </div>
  );
}

const panel: React.CSSProperties = { padding: '8px 10px', background: '#1a160f', borderBottom: '1px solid #2a2418', fontFamily: 'system-ui', color: '#eee' };
