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
      <div style={{ fontWeight: 600, fontSize: 13 }}>
        Politics <span style={{ fontSize: 9.5, fontWeight: 400, color: '#887' }}>· pool left to recruit: <b style={{ color: '#cbbf9a' }}>R</b>egular <b style={{ color: '#cbbf9a' }}>E</b>lite <b style={{ color: '#cbbf9a' }}>L</b>eader/<b style={{ color: '#cbbf9a' }}>N</b>azgûl</span>
      </div>
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
      {nations.map((n) => <NationRow key={n} n={n} ns={view.nations[n]} reinf={view.reinforcements[n]} />)}
    </div>
  );
}

// The reinforcement pool still available to recruit for a Nation. A 0 reads dim-red
// so a depleted pool (the usual reason "I can't recruit here" — every figure is
// already on the board) is obvious at a glance. Sauron shows Nazgûl; others a Leader.
function ReinfPips({ r }: { r: GameState['reinforcements'][Nation] }) {
  const cell = (label: string, val: number, title: string) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 1, fontSize: 10, color: val === 0 ? '#9a5a5a' : '#cdbf95' }}>
      <span style={{ fontSize: 7.5, color: '#7a7158', fontWeight: 700 }}>{label}</span>{val}
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', gap: 5, marginLeft: 'auto', paddingLeft: 4 }}>
      {cell('R', r.regular, 'Regular units left in the reinforcement pool')}
      {cell('E', r.elite, 'Elite units left in the reinforcement pool')}
      {r.nazgul != null ? cell('N', r.nazgul, 'Nazgûl available to recruit') : cell('L', r.leader, 'Leaders left in the reinforcement pool')}
    </span>
  );
}

function NationRow({ n, ns, reinf }: { n: Nation; ns: GameState['nations'][Nation]; reinf: GameState['reinforcements'][Nation] }) {
  const step = Math.min(ns.step, TRACK_MAX);
  const atWar = ns.step === 0;
  // flexWrap keeps the reinforcement pips (last child, marginLeft:auto) from clipping
  // off the right edge when this column is narrow (the FP/Shadow groups sit side by
  // side in a ~270px panel): the pips drop to a second line, still right-aligned, so a
  // Nation's reinforcement pool is never hidden (player report).
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '2px 0' }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: NATION_COLOR[n], flexShrink: 0,
        border: ns.active ? '1px solid #fff' : '1px solid #665', opacity: ns.active ? 1 : 0.5 }} />
      {/* flexShrink:0 keeps every label exactly 52px wide. Without it, rows that carry a
          "passive" tag flex-shrink the label ~3px narrower than active rows (e.g. Elves),
          so the progress tracks start at different x and the rows look misaligned. */}
      <span style={{ width: 52, flexShrink: 0, fontSize: 11, color: atWar ? '#ffd23f' : '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{NATION_LABEL[n]}</span>
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
      <ReinfPips r={reinf} />
    </div>
  );
}

const panel: React.CSSProperties = { padding: '8px 6px', background: '#1a160f', borderBottom: '1px solid #2a2418', fontFamily: 'system-ui', color: '#eee' };
