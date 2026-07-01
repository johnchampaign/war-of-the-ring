// Split-move picker (rulebook p.27): after choosing an army move on the board, the
// player may move the WHOLE army or split it — moving only some units/Leaders/
// Nazgûl/Characters and leaving the rest behind. Defaults to "move all"; the engine
// validates the split rules (≥1 unit, FP Leaders can't be stranded, etc.).
import { useState } from 'react';
import type { GameState, Nation, Side } from '../engine/types';
import type { MoveSel, WotrAction } from '../adapter/wotrAction';
import { characterSide, sideOfNation } from '../engine/data';
import { charName } from './charInfo';
import mapData from '../../assets/map.json';

const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;

export function MovePicker({ from, to, kind, view, onConfirm, onCancel }: {
  from: string; to: string; kind: 'moveArmy' | 'armyMove2' | 'attack'; view: GameState;
  onConfirm: (a: WotrAction) => void; onCancel: () => void;
}) {
  const attackMode = kind === 'attack';
  const verb = attackMode ? 'Attack' : 'Move';
  const r = view.regions[from];
  const nations = (Object.keys(r.units) as Nation[]).filter((n) => (r.units[n]!.regular + r.units[n]!.elite) > 0);
  // Only the MOVING army's OWN Characters can travel with it — never an enemy Companion
  // who happens to share the region (e.g. one who separated into a besieged Stronghold).
  const armySide: Side = nations.length ? sideOfNation(nations[0]!) : 'fp';
  const myChars = r.characters.filter((c) => characterSide(c) === armySide);
  // Default selection = the whole Army (so an unchanged picker is a normal move).
  const [reg, setReg] = useState<Record<string, number>>(() => Object.fromEntries(nations.map((n) => [n, r.units[n]!.regular])));
  const [eli, setEli] = useState<Record<string, number>>(() => Object.fromEntries(nations.map((n) => [n, r.units[n]!.elite])));
  const [leaders, setLeaders] = useState(r.leaders);
  const [nazgul, setNazgul] = useState(r.nazgul);
  const [chars, setChars] = useState<Set<string>>(() => new Set(myChars));

  const totalUnits = nations.reduce((s, n) => s + (reg[n] ?? 0) + (eli[n] ?? 0), 0);
  const armyUnits = nations.reduce((s, n) => s + r.units[n]!.regular + r.units[n]!.elite, 0);
  // Merging onto a friendly army may push the destination over the 10-unit limit;
  // the excess is removed afterward (rulebook p.26). Warn so it isn't a surprise.
  const destUnits = !attackMode ? Object.values(view.regions[to]?.units ?? {}).reduce((s, u) => s + u!.regular + u!.elite, 0) : 0;
  const overAll = Math.max(0, destUnits + armyUnits - 10);
  const overSel = Math.max(0, destUnits + totalUnits - 10);
  const isWhole = totalUnits === armyUnits && leaders === r.leaders && nazgul === r.nazgul && chars.size === myChars.length;

  const buildSel = (): MoveSel => {
    const units: MoveSel['units'] = {};
    for (const n of nations) { const u: { regular?: number; elite?: number } = {}; if (reg[n]) u.regular = reg[n]; if (eli[n]) u.elite = eli[n]; if (u.regular || u.elite) units[n] = u; }
    const sel: MoveSel = { units };
    if (leaders) sel.leaders = leaders;
    if (nazgul) sel.nazgul = nazgul;
    if (chars.size) sel.characters = [...chars];
    return sel;
  };
  // For an attack, the selection is the ATTACKING force; the rearguard is the rest.
  const buildRearguard = (): MoveSel => {
    const units: MoveSel['units'] = {};
    for (const n of nations) { const rr = r.units[n]!.regular - (reg[n] ?? 0), re = r.units[n]!.elite - (eli[n] ?? 0); const u: { regular?: number; elite?: number } = {}; if (rr) u.regular = rr; if (re) u.elite = re; if (u.regular || u.elite) units[n] = u; }
    const rg: MoveSel = { units };
    if (r.leaders - leaders) rg.leaders = r.leaders - leaders;
    if (r.nazgul - nazgul) rg.nazgul = r.nazgul - nazgul;
    const left = myChars.filter((c) => !chars.has(c));
    if (left.length) rg.characters = left;
    return rg;
  };
  const make = (split: boolean): WotrAction =>
    kind === 'attack' ? { kind: 'attack', from, to, rearguard: split ? buildRearguard() : undefined }
      : kind === 'armyMove2' ? { kind: 'armyMove2', from, to, move: split ? buildSel() : undefined }
        : { kind: 'moveArmy', from, to, move: split ? buildSel() : undefined };

  const Step = ({ label, val, max, set }: { label: string; val: number; max: number; set: (v: number) => void }) => (
    <div style={row}>
      <span style={{ flex: 1 }}>{label}</span>
      <button style={step} disabled={val <= 0} onClick={() => set(val - 1)}>−</button>
      <span style={{ width: 28, textAlign: 'center' }}>{val}/{max}</span>
      <button style={step} disabled={val >= max} onClick={() => set(val + 1)}>+</button>
    </div>
  );

  return (
    <div style={backdrop} onClick={onCancel}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 6px' }}>{verb} {rName(from)} → {rName(to)}</h3>
        <div style={{ fontSize: 12, color: '#bbb', marginBottom: 8 }}>
          {attackMode ? 'Choose what attacks; the rest stays behind as the rearguard (not in the battle). Not-At-War units always stay.' : 'Choose what moves; the rest stays behind (split). Move all for a normal move.'}
        </div>
        {!attackMode && destUnits > 0 && (
          <div style={{ fontSize: 12, color: overAll || overSel ? '#f0d090' : '#9c9', marginBottom: 8 }}>
            {rName(to)} already holds {destUnits} unit{destUnits === 1 ? '' : 's'} (limit 10).
            {overAll > 0 && ` Move all → you'll remove ${overAll} excess.`}
            {overSel > 0 && overSel !== overAll && ` Move selected → remove ${overSel} excess.`}
          </div>
        )}
        {nations.map((n) => (
          <div key={n} style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: '#d8cfa8' }}>{cap(n)}</div>
            {r.units[n]!.regular > 0 && <Step label="Regulars" val={reg[n] ?? 0} max={r.units[n]!.regular} set={(v) => setReg({ ...reg, [n]: v })} />}
            {r.units[n]!.elite > 0 && <Step label="Elites" val={eli[n] ?? 0} max={r.units[n]!.elite} set={(v) => setEli({ ...eli, [n]: v })} />}
          </div>
        ))}
        {r.leaders > 0 && <Step label="Leaders" val={leaders} max={r.leaders} set={setLeaders} />}
        {r.nazgul > 0 && <Step label="Nazgûl" val={nazgul} max={r.nazgul} set={setNazgul} />}
        {myChars.map((c) => (
          <label key={c} style={{ ...row, cursor: 'pointer' }}>
            <input type="checkbox" checked={chars.has(c)} onChange={(e) => { const s = new Set(chars); e.target.checked ? s.add(c) : s.delete(c); setChars(s); }} />
            <span style={{ flex: 1 }}>{charName(c)}</span>
          </label>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button style={primary} onClick={() => onConfirm(make(false))}>{verb} all</button>
          <button style={primary} disabled={totalUnits < 1 || isWhole} onClick={() => onConfirm(make(true))}>{verb} selected</button>
          <button style={ghost} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
const card: React.CSSProperties = { background: '#211c14', color: '#eee', padding: 16, borderRadius: 8, width: 320, maxHeight: '80vh', overflow: 'auto', fontFamily: 'system-ui', border: '1px solid #554' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '2px 0' };
const step: React.CSSProperties = { width: 24, height: 24, background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 4, cursor: 'pointer' };
const primary: React.CSSProperties = { flex: 1, padding: '7px 8px', background: '#4a5a3a', color: '#f0e9d8', border: '1px solid #6a7', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
const ghost: React.CSSProperties = { padding: '7px 10px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
