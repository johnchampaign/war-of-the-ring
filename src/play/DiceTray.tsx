// Action-dice pool, shown as labeled face chips (clearer than the status-bar text
// run-on). Your unspent dice are prominent; the opponent's are smaller. Action dice
// are open information once rolled, so both pools are shown. Spent dice this round
// (usedDice) are listed dimmed so you can see what you've already done.
import type { GameState, Side, DieFace } from '../engine/types';
import { poolSize } from '../engine/dice';

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

function Pool({ title, dice, used, mine, selectedDie, onSelectDie, toRoll }: { title: string; dice: DieFace[]; used: DieFace[]; mine: boolean; selectedDie?: DieFace | null; onSelectDie?: (f: DieFace | null) => void; toRoll?: string }) {
  const clickable = mine && !!onSelectDie && dice.length > 0;
  return (
    <div style={{ marginBottom: mine ? 6 : 0 }}>
      <div style={{ fontSize: 11, color: '#998', marginBottom: 3 }}>
        {/* Before the Action Roll the pool is EMPTY but not "0 left": say how many
            dice are about to be rolled instead (player request: they were counting
            figures on the board to work it out — it is public information, p.19). */}
        {title} — {toRoll ?? `${dice.length} ${dice.length === 1 ? 'die' : 'dice'} left`}
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
  // Pre-roll phases (recover / Fellowship / Hunt allocation): show the pool that
  // WILL be rolled — the FP's 4 (+Aragorn, +Gandalf the White), the Shadow's 7
  // (+each Minion) minus the dice already committed to the Hunt Box.
  const preRoll = view.phase === 'recover' || view.phase === 'fellowship' || view.phase === 'huntAllocation';
  const toRoll = (s: Side): string | undefined => {
    if (!preRoll) return undefined;
    const pool = poolSize(view, s);
    if (s === 'shadow' && view.hunt.box > 0) {
      const n = Math.max(0, pool - view.hunt.box);
      return `${n} ${n === 1 ? 'die' : 'dice'} to roll (${view.hunt.box} to the Hunt)`;
    }
    return `${pool} dice to roll`;
  };
  return (
    <div style={panel}>
      <Pool title={`Your dice (${name(me)})`} dice={view.dice[me]} used={used[me]} mine selectedDie={selectedDie} onSelectDie={onSelectDie} toRoll={toRoll(me)} />
      <Pool title={`${name(opp)} dice`} dice={view.dice[opp]} used={used[opp]} mine={false} toRoll={toRoll(opp)} />
    </div>
  );
}

const panel: React.CSSProperties = { padding: 8, background: '#1a160f', borderBottom: '1px solid #2a2418', fontFamily: 'system-ui', flexShrink: 0 };
