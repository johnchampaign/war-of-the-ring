// Action-dice pool, shown as labeled face chips (clearer than the status-bar text
// run-on). Your unspent dice are prominent; the opponent's are smaller. Action dice
// are open information once rolled, so both pools are shown. Spent dice this round
// (usedDice) are listed dimmed so you can see what you've already done.
import type { GameState, Side, DieFace } from '../engine/types';

const FACE: Record<string, { label: string; bg: string }> = {
  character: { label: 'Char', bg: '#3a6ea5' },
  army: { label: 'Army', bg: '#8a5a2b' },
  muster: { label: 'Muster', bg: '#4a7a3a' },
  armyMuster: { label: 'Army/Mus', bg: '#6a6a30' },
  event: { label: 'Event', bg: '#6a3a7a' },
  will: { label: 'Will', bg: '#b58a2b' },        // Will of the West (FP wildcard)
  eye: { label: 'Eye', bg: '#a83232' },          // Shadow Eye → Hunt Box
};

function Chip({ face, dim }: { face: string; dim?: boolean }) {
  const f = FACE[face] ?? { label: face, bg: '#555' };
  return (
    <span style={{ background: f.bg, color: '#fff', borderRadius: 5, padding: '3px 7px', fontSize: 12, fontWeight: 600, opacity: dim ? 0.4 : 1, whiteSpace: 'nowrap' }}>{f.label}</span>
  );
}

function Pool({ title, dice, used, mine }: { title: string; dice: DieFace[]; used: DieFace[]; mine: boolean }) {
  return (
    <div style={{ marginBottom: mine ? 6 : 0 }}>
      <div style={{ fontSize: 11, color: '#998', marginBottom: 3 }}>{title} — {dice.length} {dice.length === 1 ? 'die' : 'dice'} left</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {dice.length === 0 && used.length === 0 && <span style={{ color: '#776', fontSize: 12, fontStyle: 'italic' }}>none yet</span>}
        {dice.map((d, i) => <Chip key={`u${i}`} face={d} />)}
        {used.map((d, i) => <Chip key={`s${i}`} face={d} dim />)}
      </div>
    </div>
  );
}

export function DiceTray({ view, you }: { view: GameState; you: Side | null }) {
  const me: Side = you === 'shadow' ? 'shadow' : 'fp';
  const opp: Side = me === 'fp' ? 'shadow' : 'fp';
  const name = (s: Side) => (s === 'fp' ? 'Free Peoples' : 'Shadow');
  const used = view.usedDice ?? { fp: [], shadow: [] };
  return (
    <div style={panel}>
      <Pool title={`Your dice (${name(me)})`} dice={view.dice[me]} used={used[me]} mine />
      <Pool title={`${name(opp)} dice`} dice={view.dice[opp]} used={used[opp]} mine={false} />
    </div>
  );
}

const panel: React.CSSProperties = { padding: 8, background: '#1a160f', borderBottom: '1px solid #2a2418', fontFamily: 'system-ui', flexShrink: 0 };
