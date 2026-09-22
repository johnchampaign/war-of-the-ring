// Split-move picker (rulebook p.27): after choosing an army move on the board, the
// player may move the WHOLE army or split it — moving only some units/Leaders/
// Nazgûl/Characters and leaving the rest behind. Defaults to "move all"; the engine
// validates the split rules (≥1 unit, FP Leaders can't be stranded, etc.).
import { useState } from 'react';
import type { GameState, Nation, Side } from '../engine/types';
import type { MoveSel, WotrAction } from '../adapter/wotrAction';
import { characterSide, sideOfNation } from '../engine/data';
import { isAtWar } from '../engine/politics';
import { attackError, sortieForce } from '../engine/combat';
import { splitBlockReason } from '../engine/armies';
import { cardSplitBlockReason, cardMoveEscortReason } from '../engine/handlers';
import { charName } from './charInfo';
import mapData from '../../assets/map.json';

const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;

export function MovePicker({ from, to, kind, view, you, base, onConfirm, onCancel }: {
  from: string; to: string; kind: 'moveArmy' | 'armyMove2' | 'attack' | 'eventMove' | 'holdBack' | 'advance'; view: GameState; you: Side;
  /** For kind 'eventMove': the eventTarget action this picker decorates with a split
   *  selection (p.28 — an Army moved by an Event card may be split before moving). */
  base?: WotrAction;
  onConfirm: (a: WotrAction) => void; onCancel: () => void;
}) {
  const attackMode = kind === 'attack';
  // A card ATTACK that lands first (Corsairs of Umbar): the picker chooses who lands and
  // attacks; whoever stays behind sits out the battle. The destination's units are the
  // ENEMY Army being attacked, so they are no stacking concern here.
  const landingAttack = kind === 'eventMove' && base?.kind === 'eventTarget' && base.mode === 'attack';
  // Hold-back (p.31): the Army has ALREADY advanced into `from` (the captured region);
  // the tick-boxes choose who STAYS forward, and everyone unticked marches back to
  // `to` (the region attacked from) — the same inversion the attack rearguard uses.
  const holdBackMode = kind === 'holdBack';
  // A Settlement this advance put under our Control must keep a unit holding it; in
  // any other region the winner may pull the whole Army back (mirrors the engine's
  // holdBackMinimum).
  const holdBackMustHold = holdBackMode && view.regions[from]?.control === you;
  // SORTIE (p.32): our Army is the besieged garrison in the siege box, NOT the region —
  // the region holds the besieger we're attacking. Everything the picker offers (units,
  // Leaders, the rearguard left behind in the Stronghold) must come from the box.
  const sortieBox = attackMode && from === to ? sortieForce(view, from, you) : null;
  const verb = sortieBox ? 'Sortie' : attackMode ? 'Attack' : landingAttack ? 'Land and attack' : holdBackMode ? 'Keep forward' : kind === 'advance' ? 'Advance' : 'Move';
  const r = sortieBox ?? view.regions[from];
  // A card move may be narrower than "the Army": Rage of the Dunlendings moves "up to
  // four ISENGARD units" and nothing else, so the offer carries the Nation it moves
  // (`nation`) and how many figures are still allowed to travel (`count`). Without
  // those the picker offered the whole stack and the engine silently trimmed the
  // selection down to what the card allows (player reports 0g40604w245d6w3q,
  // 4z4d6h18592c546r).
  const evBase = kind === 'eventMove' ? (base as Extract<WotrAction, { kind: 'eventTarget' }> | undefined) : undefined;
  const evNation = evBase?.nation;
  const evLimit = evBase?.count;
  const nations = (Object.keys(r.units) as Nation[])
    .filter((n) => (r.units[n]!.regular + r.units[n]!.elite) > 0)
    .filter((n) => !evNation || n === evNation);
  // Only the MOVING army's OWN Characters can travel with it — never an enemy Companion
  // who happens to share the region (e.g. one who separated into a besieged Stronghold).
  const armySide: Side = nations.length ? sideOfNation(nations[0]!) : 'fp';
  // Saruman can never leave Orthanc (character card) — he may fight from it (attack
  // mode; the advance holds him) but is never offered as a mover.
  const myChars = r.characters.filter((c) => characterSide(c) === armySide && (attackMode || c !== 'saruman'));
  // Only the MOVING side's own Leader figures are on offer: FP Leaders for the Free
  // Peoples, Nazgûl for the Shadow. Nazgûl are not Army units, so a region holding
  // them is still "free" and a Free Peoples Army may sit there — the picker used to
  // show that region's Nazgûl as movable (player report), and moving one produced a
  // selection the engine flatly refuses (moveArmySplit: a split may only take its own
  // Leader figures). Same in mirror for FP Leaders under a Shadow Army.
  const maxLeaders = armySide === 'fp' ? r.leaders : 0;
  const maxNazgul = armySide === 'shadow' ? r.nazgul : 0;
  // A Nation not At War can never cross another Nation's border (p.27), so on an
  // ordinary Army move its units are not on offer at all — the move takes the At-War
  // half and leaves them standing. Showing them as movable let the player tick figures
  // the engine would then quietly leave behind (player report 615m5q0t090g205d).
  const destNation = (mapData as any).regions[to]?.nation as string | undefined;
  const moveMode = kind === 'moveArmy' || kind === 'armyMove2';
  const barred = (n: Nation) => moveMode && !isAtWar(view, n) && !!destNation && destNation !== n;
  const stayNations = nations.filter(barred);
  const goNations = nations.filter((n) => !barred(n));
  // Default selection = the whole Army (so an unchanged picker is a normal move).
  const capped = (): [Record<string, number>, Record<string, number>] => {
    const rr: Record<string, number> = {}, ee: Record<string, number> = {};
    let left = evLimit ?? Infinity;
    for (const n of nations) {
      if (barred(n)) { rr[n] = 0; ee[n] = 0; continue; }
      rr[n] = Math.min(r.units[n]!.regular, left); left -= rr[n]!;
      ee[n] = Math.min(r.units[n]!.elite, left); left -= ee[n]!;
    }
    return [rr, ee];
  };
  const [reg, setReg] = useState<Record<string, number>>(() => capped()[0]);
  const [eli, setEli] = useState<Record<string, number>>(() => capped()[1]);
  const [leaders, setLeaders] = useState(maxLeaders);
  const [nazgul, setNazgul] = useState(maxNazgul);
  const [chars, setChars] = useState<Set<string>>(() => new Set(myChars));

  const totalUnits = nations.reduce((s, n) => s + (reg[n] ?? 0) + (eli[n] ?? 0), 0);
  // What CAN travel — the barred Nations' units are not part of "the whole Army" for
  // this move, so an untouched picker still submits the plain whole-army action.
  const armyUnits = goNations.reduce((s, n) => s + r.units[n]!.regular + r.units[n]!.elite, 0);
  // Merging onto a friendly army may push the destination over the 10-unit limit;
  // the excess is removed afterward (rulebook p.26). Warn so it isn't a surprise.
  const destUnits = !attackMode && !landingAttack ? Object.values(view.regions[to]?.units ?? {}).reduce((s, u) => s + u!.regular + u!.elite, 0) : 0;
  const overAll = Math.max(0, destUnits + armyUnits - 10);
  const overSel = Math.max(0, destUnits + totalUnits - 10);
  // A capped card move always states its selection: "the whole Army" is not what the
  // card offers, so the bare action would mean something else.
  const isWhole = evLimit === undefined && totalUnits === armyUnits && leaders === maxLeaders && nazgul === maxNazgul && chars.size === myChars.length;
  const budgetLeft = evLimit === undefined ? Infinity : Math.max(0, evLimit - totalUnits);

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
    // The rearguard is what OUR army leaves behind — never the enemy figures standing
    // in the same region, which were never ours to hold back (see maxLeaders/maxNazgul).
    if (maxLeaders - leaders) rg.leaders = maxLeaders - leaders;
    if (maxNazgul - nazgul) rg.nazgul = maxNazgul - nazgul;
    const left = myChars.filter((c) => !chars.has(c));
    if (left.length) rg.characters = left;
    return rg;
  };
  // An attack split the engine would refuse (e.g. a rearguard of Leaders with no unit)
  // used to submit anyway and fail silently with only a console error (player report
  // 2r1m6q3i35365j1a). Check it here and say why, instead of letting the click vanish.
  // The Character-die Leader requirement depends on the die, so the engine still
  // owns that one.
  const SPLIT_HINTS: Record<string, string> = {
    'A rearguard must contain at least one unit': 'Leaders or Characters left behind need at least one unit to stay with them — keep a unit back, or send them into the attack',
    'The attacking army must keep at least one unit': 'The attacking Army needs at least one unit',
  };
  // The same goes for an ordinary Army move: the split rules (at least one unit moves;
  // Free Peoples Leaders never stay behind without a unit, p.27) are checked here, as
  // the attack's are, instead of being reported after the click (player report
  // 6l3g4j5c6s30290e).
  const MOVE_HINTS: Record<string, string> = {
    'At least one Army unit must move.': 'At least one unit must move',
    'Free Peoples Leaders can never be left in a region without combat units (p.27) — this move empties the region, so its Leaders must go with the Army.':
      'Free Peoples Leaders can never be left without a unit — keep a unit back with them, or take them along',
  };
  // A card move splits under the same composition rules (p.28), so the picker asks the
  // same question for it — the engine used to answer an impossible card split by
  // quietly moving the whole Army, with no message anywhere (player report
  // 2w0k3j4k1q026q3r). Only the composition half applies: a card move need not be
  // adjacent, and each card's own enumerator owns where it may land.
  const rawMoveError = !isWhole
    ? (moveMode ? splitBlockReason(view, from, to, you, buildSel())
      : kind === 'eventMove' && !landingAttack ? (cardMoveEscortReason(evBase?.card, buildSel()) ?? cardSplitBlockReason(view, from, armySide, buildSel()))
        : null)
    : null;
  const rawSplitError = attackMode && !isWhole ? attackError(view, from, you, buildRearguard()) : null;
  const splitError = rawSplitError ? (SPLIT_HINTS[rawSplitError] ?? rawSplitError)
    : rawMoveError ? (MOVE_HINTS[rawMoveError] ?? rawMoveError.replace(/\.$/, '')) : null;
  const make = (split: boolean): WotrAction =>
    kind === 'advance' ? { kind: 'advanceChoice', advance: true, move: split ? buildSel() : undefined }
      : kind === 'holdBack' ? { kind: 'advanceHoldBack', back: split ? buildRearguard() : undefined }
      : kind === 'attack' ? { kind: 'attack', from, to, rearguard: split ? buildRearguard() : undefined }
      : kind === 'eventMove' ? { ...(base as Extract<WotrAction, { kind: 'eventTarget' }>), move: split ? buildSel() : undefined }
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
          {landingAttack ? `Choose what lands in ${rName(to)} and attacks; the rest stays in ${rName(from)} and sits out the battle.`
            : attackMode ? 'Choose what attacks; the rest stays behind as the rearguard (not in the battle). Not-At-War units always stay.'
            : holdBackMode ? `Choose who stays in ${rName(from)}; everyone unticked marches back to ${rName(to)}.${holdBackMustHold ? ' At least one unit must hold the Settlement you just took.' : ' You may bring the whole Army back.'}`
              : evLimit !== undefined ? `Choose what moves — this card moves up to ${evLimit} ${evNation ? cap(evNation) + ' ' : ''}unit${evLimit === 1 ? '' : 's'}.`
              : stayNations.length ? `Choose what moves. ${stayNations.map(cap).join(' and ')} ${stayNations.length === 1 ? 'is' : 'are'} not At War and cannot cross into ${rName(to)}, so those units stay behind.` : 'Choose what moves.'}
        </div>
        {!attackMode && destUnits > 0 && (
          <div style={{ fontSize: 12, color: overAll || overSel ? '#f0d090' : '#9c9', marginBottom: 8 }}>
            {/* Only what the CURRENT selection does (player report 5j706y1s5j1w2r4n). */}
            {rName(to)} already contains {destUnits} unit{destUnits === 1 ? '' : 's'} (limit 10).
            {overSel > 0 && ` You'll remove ${overSel} excess after moving.`}
          </div>
        )}
        {goNations.map((n) => (
          <div key={n} style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: '#d8cfa8' }}>{cap(n)}</div>
            {r.units[n]!.regular > 0 && <Step label="Regulars" val={reg[n] ?? 0} max={Math.min(r.units[n]!.regular, (reg[n] ?? 0) + budgetLeft)} set={(v) => setReg({ ...reg, [n]: v })} />}
            {r.units[n]!.elite > 0 && <Step label="Elites" val={eli[n] ?? 0} max={Math.min(r.units[n]!.elite, (eli[n] ?? 0) + budgetLeft)} set={(v) => setEli({ ...eli, [n]: v })} />}
          </div>
        ))}
        {stayNations.map((n) => (
          <div key={n} style={{ marginBottom: 4, opacity: 0.6 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: '#d8cfa8' }}>{cap(n)}</div>
            <div style={{ fontSize: 12, color: '#bbb' }}>
              {r.units[n]!.regular + r.units[n]!.elite} unit{r.units[n]!.regular + r.units[n]!.elite === 1 ? '' : 's'} stay — {cap(n)} is not At War.
            </div>
          </div>
        ))}
        {maxLeaders > 0 && <Step label="Leaders" val={leaders} max={maxLeaders} set={setLeaders} />}
        {maxNazgul > 0 && <Step label="Nazgûl" val={nazgul} max={maxNazgul} set={setNazgul} />}
        {myChars.map((c) => (
          <label key={c} style={{ ...row, cursor: 'pointer' }}>
            <input type="checkbox" name={`move-char-${c}`} checked={chars.has(c)} onChange={(e) => { const s = new Set(chars); e.target.checked ? s.add(c) : s.delete(c); setChars(s); }} />
            <span style={{ flex: 1 }}>{charName(c)}</span>
          </label>
        ))}
        {splitError && <div style={{ fontSize: 12, color: '#f0a080', marginTop: 8 }}>{splitError}.</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {/* ONE confirm button. There used to be two — "{verb} all" and "{verb}
              selected" — but the default selection IS the whole Army, so the second was
              dead whenever the first was the obvious choice and vice versa (player
              report 3t0a420x2k1t2m0g: '"Move all" is the same as moving all selected
              figures, and that is already the default'). An untouched picker still
              submits the plain whole-army move (no split selection at all); touch a
              counter and the same button submits the split.
              Hold-back: keeping NOBODY forward is a legal answer (p.31's advance is
              optional) unless the advance captured the Settlement — every other picker
              still needs at least one moving unit. */}
          <button style={primary} disabled={!!splitError || (!isWhole && totalUnits < 1 && !(holdBackMode && !holdBackMustHold))}
            onClick={() => onConfirm(make(!isWhole))}>{verb}</button>
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
