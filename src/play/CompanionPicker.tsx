// The Companion-group picker (rulebook p.24): choose WHO travels together, then the
// destination on the map. "A group of Companions in the same region can be moved to a
// common destination at a distance equal to or less than the highest Level in the
// group" — a lone Companion is simply a group of one.
//
// One picker for every Companion move: a Character die, Fear! Fire! Foes!, Book of
// Mazarbul, We Prove the Swifter and Gwaihir the Windlord. It asks the engine's shared
// group rules (charMove.ts companionGroup*) so the range it states and the map it lights
// are the ones the engine will accept (player reports 3a1z26454w0x6c38,
// 186w6s0a051h4534, 231u2i4l5p19426w). Before it, a Character die offered one Companion
// or "all Companions together" and nothing in between, and the cards ran a different
// button-by-button flow worded as a "separation".
import { useState } from 'react';
import type { GameState, RegionId, Side } from '../engine/types';
import { companionGroupDestinations, companionGroupRange, type RangeOpts } from '../engine/charMove';
import { levelOf } from '../engine/data';
import { charName } from './charInfo';
import mapData from '../../assets/map.json';

const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;

export function CompanionPicker({ from, candidates, view, you, opts, title, onConfirm, onCancel }: {
  from: RegionId; candidates: string[]; view: GameState; you: Side;
  /** A card's range terms (We Prove the Swifter, Gwaihir); none for a Character die. */
  opts?: RangeOpts;
  /** Heading override, e.g. the card being played. */
  title?: string;
  onConfirm: (group: string[]) => void; onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates));
  const group = candidates.filter((c) => picked.has(c));
  const range = companionGroupRange(view, from, group, opts);
  const dests = companionGroupDestinations(view, you, from, group, opts);
  const error = !group.length ? 'Choose at least one Companion'
    : !dests.length ? 'This group has nowhere it may go from here'
    : null;
  const top = Math.max(0, ...group.map((c) => levelOf(c)));
  const shadowfax = group.includes('gandalf-white') && range > top;
  return (
    <div style={backdrop} onClick={onCancel}>
      <div style={card} onClick={(e) => e.stopPropagation()} data-testid="companion-picker">
        <h3 style={{ margin: '0 0 6px' }}>{title ?? 'Move Companions'} — from {rName(from)}</h3>
        <div style={{ fontSize: 12, color: '#bbb', marginBottom: 8 }}>
          Choose who travels together. A group moves as far as its highest Level (p.24); then click its destination on the map.
        </div>
        {candidates.map((c) => (
          <label key={c} style={row}>
            <input type="checkbox" name={`move-comp-${c}`} checked={picked.has(c)}
              onChange={(e) => { const s = new Set(picked); e.target.checked ? s.add(c) : s.delete(c); setPicked(s); }} />
            <span style={{ flex: 1 }}>{charName(c)}</span>
            <span style={{ fontSize: 11, color: '#998' }}>Level {levelOf(c)}</span>
          </label>
        ))}
        {group.length > 0 && (
          <div style={{ fontSize: 12, color: '#d8cfa8', marginTop: 8 }} data-testid="companion-picker-range">
            {group.length === 1 ? `${charName(group[0]!)} moves` : 'This group moves'} up to {range} region{range === 1 ? '' : 's'}
            {shadowfax ? ' — Shadowfax carries Gandalf the White further alone or with one Hobbit' : ''}.
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: '#f0a080', marginTop: 8 }} data-testid="companion-picker-error">{error}.</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button style={primary} disabled={!!error} onClick={() => onConfirm(group)}>Choose destination</button>
          <button style={ghost} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
const card: React.CSSProperties = { background: '#211c14', color: '#eee', padding: 16, borderRadius: 8, width: 320, maxHeight: '80vh', overflow: 'auto', fontFamily: 'system-ui', border: '1px solid #554' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '2px 0', cursor: 'pointer' };
const primary: React.CSSProperties = { flex: 1, padding: '7px 8px', background: '#4a5a3a', color: '#f0e9d8', border: '1px solid #6a7', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
const ghost: React.CSSProperties = { padding: '7px 10px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
