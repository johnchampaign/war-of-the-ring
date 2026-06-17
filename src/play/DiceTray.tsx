// Action-dice pool, shown as labeled face chips (clearer than the status-bar text
// run-on). Your unspent dice are prominent; the opponent's are smaller. Action dice
// are open information once rolled, so both pools are shown. Spent dice this round
// (usedDice) are listed dimmed so you can see what you've already done.
import type { GameState, Side, DieFace } from '../engine/types';

export const FACE: Record<string, { label: string; bg: string }> = {
  character: { label: 'Char', bg: '#3a6ea5' },
  army: { label: 'Army', bg: '#8a5a2b' },
  muster: { label: 'Muster', bg: '#4a7a3a' },
  armyMuster: { label: 'Army/Mus', bg: '#6a6a30' },
  event: { label: 'Event', bg: '#6a3a7a' },
  will: { label: 'Will', bg: '#b58a2b' },        // Will of the West (FP wildcard)
  eye: { label: 'Eye', bg: '#a83232' },          // Shadow Eye → Hunt Box
};

function Chip({ face, dim, selected, dimmed, onClick }: { face: string; dim?: boolean; selected?: boolean; dimmed?: boolean; onClick?: () => void }) {
  const f = FACE[face] ?? { label: face, bg: '#555' };
  const style: React.CSSProperties = {
    background: f.bg, color: '#fff', borderRadius: 5, padding: '3px 7px', fontSize: 12, fontWeight: 600,
    opacity: dim ? 0.4 : dimmed ? 0.45 : 1, whiteSpace: 'nowrap',
    border: selected ? '2px solid #ffe08a' : onClick ? '2px solid transparent' : undefined,
    boxShadow: selected ? '0 0 6px #ffd86a' : undefined,
  };
  if (onClick) return <button type="button" onClick={onClick} style={{ ...style, cursor: 'pointer' }}>{f.label}</button>;
  return <span style={style}>{f.label}</span>;
}

function Pool({ title, dice, used, mine, selectedDie, onSelectDie }: { title: string; dice: DieFace[]; used: DieFace[]; mine: boolean; selectedDie?: DieFace | null; onSelectDie?: (f: DieFace | null) => void }) {
  const clickable = mine && !!onSelectDie && dice.length > 0;
  return (
    <div style={{ marginBottom: mine ? 6 : 0 }}>
      <div style={{ fontSize: 11, color: '#998', marginBottom: 3 }}>
        {title} — {dice.length} {dice.length === 1 ? 'die' : 'dice'} left
        {clickable && <span style={{ color: '#cb8', marginLeft: 6 }}>{selectedDie ? '· click again to show all' : '· click a die to see its actions'}</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {dice.length === 0 && used.length === 0 && <span style={{ color: '#776', fontSize: 12, fontStyle: 'italic' }}>none yet</span>}
        {dice.map((d, i) => clickable
          ? <Chip key={`u${i}`} face={d} selected={selectedDie === d} dimmed={!!selectedDie && selectedDie !== d} onClick={() => onSelectDie!(selectedDie === d ? null : d)} />
          : <Chip key={`u${i}`} face={d} />)}
        {used.map((d, i) => <Chip key={`s${i}`} face={d} dim />)}
      </div>
    </div>
  );
}

export function DiceTray({ view, you, selectedDie, onSelectDie }: { view: GameState; you: Side | null; selectedDie?: DieFace | null; onSelectDie?: (f: DieFace | null) => void }) {
  const me: Side = you === 'shadow' ? 'shadow' : 'fp';
  const opp: Side = me === 'fp' ? 'shadow' : 'fp';
  const name = (s: Side) => (s === 'fp' ? 'Free Peoples' : 'Shadow');
  const used = view.usedDice ?? { fp: [], shadow: [] };
  return (
    <div style={panel}>
      <Pool title={`Your dice (${name(me)})`} dice={view.dice[me]} used={used[me]} mine selectedDie={selectedDie} onSelectDie={onSelectDie} />
      <Pool title={`${name(opp)} dice`} dice={view.dice[opp]} used={used[opp]} mine={false} />
    </div>
  );
}

const panel: React.CSSProperties = { padding: 8, background: '#1a160f', borderBottom: '1px solid #2a2418', fontFamily: 'system-ui', flexShrink: 0 };
