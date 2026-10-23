// Action-dice pool, shown as labeled face chips (clearer than the status-bar text
// run-on). Your unspent dice are prominent; the opponent's are smaller. Action dice
// are open information once rolled, so both pools are shown. Spent dice this round
// (usedDice) are listed dimmed so you can see what you've already done.
import { useState } from 'react';
import type { GameState, Side, DieFace } from '../engine/types';
import { poolSize } from '../engine/dice';
import type { WotrAction } from '../adapter/wotrAction';
import { ElvenRings } from './StatusBar';

export const FACE: Record<string, { label: string; bg: string }> = {
  character: { label: 'Char', bg: '#3a6ea5' },
  army: { label: 'Army', bg: '#8a5a2b' },
  muster: { label: 'Muster', bg: '#4a7a3a' },
  armyMuster: { label: 'Army/Mus', bg: '#6a6a30' },
  event: { label: 'Event', bg: '#6a3a7a' },
  will: { label: 'Will', bg: '#b58a2b' },        // Will of the West (FP wildcard)
  eye: { label: 'Eye', bg: '#a83232' },          // Shadow Eye → Hunt Box
};

function Chip({ face, dim, selected, onClick }: { face: string; dim?: boolean; selected?: boolean; onClick?: () => void }) {
  const f = FACE[face] ?? { label: face, bg: '#555' };
  const style: React.CSSProperties = {
    // One box for the clickable <button> and the inert <span>: the same font, line
    // height and border, so a die keeps its size when the tray stops taking clicks
    // mid-Action (player report 505p390k4o102e4a: the dice grew while a card resolved).
    background: f.bg, color: '#fff', borderRadius: 5, padding: '3px 7px', fontSize: 12, fontWeight: 600,
    fontFamily: 'inherit', lineHeight: '16px', display: 'inline-block', boxSizing: 'border-box',
    opacity: dim ? 0.4 : 1, whiteSpace: 'nowrap',
    border: selected ? '2px solid #ffe08a' : '2px solid transparent',
    boxShadow: selected ? '0 0 6px #ffd86a' : undefined,
  };
  if (onClick) return <button type="button" onClick={onClick} style={{ ...style, cursor: 'pointer' }}>{f.label}</button>;
  return <span style={style}>{f.label}</span>;
}

function Pool({ title, dice, used, mine, selectedDie, onSelectDie, toRoll, inAction }: { title: string; dice: DieFace[]; used: DieFace[]; mine: boolean; selectedDie?: DieFace | null; onSelectDie?: (f: DieFace | null) => void; toRoll?: string; inAction?: DieFace | null }) {
  // The die paying for an Action still under way (a second Army move pending, a battle
  // running) stays selected until the Action ends, whether the player picked it or the
  // page did; nothing else can be picked meanwhile (player report 6b0u2t1l4w535d1d).
  const spentAt = inAction ? used.lastIndexOf(inAction) : -1;
  const clickable = mine && !!onSelectDie && dice.length > 0 && spentAt < 0;
  // Only the die actually clicked glows, not every die showing that face, and the
  // others keep full colour: dimming them made them look like dice already spent
  // this turn (player report 094l0v3y5s383718). The filter is still by face — any
  // die of a face does the same things. A face chosen by the page rather than a click
  // lights the first die showing it.
  const [picked, setPicked] = useState(-1);
  const glowAt = selectedDie ? (dice[picked] === selectedDie ? picked : dice.indexOf(selectedDie)) : -1;
  return (
    <div style={{ marginBottom: mine ? 6 : 0 }}>
      <div style={{ fontSize: 11, color: '#998', marginBottom: 3 }}>
        {/* Before the Action Roll the pool is EMPTY but not "0 left": say how many
            dice are about to be rolled instead (player request: they were counting
            figures on the board to work it out — it is public information, p.19). */}
        {title} — {toRoll ?? `${dice.length} ${dice.length === 1 ? 'die' : 'dice'} left`}
        {clickable && <span style={{ color: '#cb8', marginLeft: 6 }}>{selectedDie ? '· click again to show all' : '· click a die to see its actions'}</span>}
        {spentAt >= 0 && <span style={{ color: '#cb8', marginLeft: 6 }}>· finishing this Action</span>}
      </div>
      {/* At least one die's height, so "none yet" holds the row the dice will fill
          (player report 4e1w466p1k400s36). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 26, alignItems: 'center' }}>
        {dice.length === 0 && used.length === 0 && <span style={{ color: '#776', fontSize: 12, fontStyle: 'italic' }}>none yet</span>}
        {dice.map((d, i) => clickable
          ? <Chip key={`u${i}`} face={d} selected={i === glowAt} onClick={() => { setPicked(i); onSelectDie!(i === glowAt ? null : d); }} />
          : <Chip key={`u${i}`} face={d} />)}
        {used.map((d, i) => i === spentAt ? <Chip key={`s${i}`} face={d} selected /> : <Chip key={`s${i}`} face={d} dim />)}
      </div>
    </div>
  );
}

export function DiceTray({ view, you, selectedDie, onSelectDie, inActionDie, only, ringActions, onAction }: { view: GameState; you: Side | null; selectedDie?: DieFace | null; onSelectDie?: (f: DieFace | null) => void;
  /** Your Elven Ring uses, offered behind your Rings (beside your dice). */
  ringActions?: WotrAction[]; onAction?: (a: WotrAction) => void;
  /** The die spent on your Action that is still being resolved. */
  inActionDie?: DieFace | null;
  /** One pool alone: the opponent's sits with their hand above the actions, yours with
   *  your hand below them (player report 0e4z5e1m4z4p3t32). */
  only?: 'mine' | 'opp' }) {
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
    <div style={only ? { ...panel, borderBottom: 'none' } : panel}>
      {/* Each side's Elven Rings sit with its dice: yours above your dice, the
          opponent's below theirs (player report 3f0y4s3x0z1a4b3n). */}
      {only !== 'opp' && <div style={{ marginBottom: 6 }}><ElvenRings view={view} side={me} actions={ringActions} onAction={onAction} dropUp /></div>}
      {only !== 'opp' && <Pool title={`Your dice (${name(me)})`} dice={view.dice[me]} used={used[me]} mine selectedDie={selectedDie} onSelectDie={onSelectDie} toRoll={toRoll(me)} inAction={inActionDie} />}
      {only !== 'mine' && <Pool title={`${name(opp)} dice`} dice={view.dice[opp]} used={used[opp]} mine={false} toRoll={toRoll(opp)} />}
      {only !== 'mine' && <div style={{ marginTop: 6 }}><ElvenRings view={view} side={opp} /></div>}
    </div>
  );
}

const panel: React.CSSProperties = { padding: 8, background: '#1a160f', borderBottom: '1px solid #2a2418', fontFamily: 'system-ui', flexShrink: 0 };
