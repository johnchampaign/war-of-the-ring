// The Army-move picker (rulebook p.27-28, p.31): after choosing a move, an attack or
// an advance, the player chooses WHO goes — all of the Army or part of it.
//
// It asks the engine's ONE set of Army-movement rules (armies.ts: armyMoveOffer and
// armySelectionReason) for every kind of move, so what it greys out, what it explains
// and what it lets through are exactly what the engine will accept. It used to keep
// its own copy of each rule per kind — the politics greying existed for moves but not
// attacks, the already-moved cap for an Army die's second move but not for cards, the
// Character-die escort nowhere — and every fix to one kind left the others behind
// (player reports 4f0z2o2y1t2d3y6v, hppnre6r525e7n97, 543r3s3u1012175v,
// 1x5m1f3d44734l0o, 3i096w3f0b1e6r2j, 405e1k232p3h3j4m, 382m030i1j5w3d57).
import { useState } from 'react';
import type { GameState, Nation, Side } from '../engine/types';
import type { MoveSel, WotrAction } from '../adapter/wotrAction';
import { sideOfNation, nationName } from '../engine/data';
import { sortieForce, advanceRules } from '../engine/combat';
import { armyMoveOffer, armySelectionReason, cardAttackFighters, type ArmyMoveRules, type Force } from '../engine/armies';
import { charName } from './charInfo';
import mapData from '../../assets/map.json';

const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;

export type MovePickerKind = 'moveArmy' | 'armyMove2' | 'attack' | 'eventAttack' | 'eventMove' | 'holdBack' | 'advance' | 'besiegerAdvance' | 'relieveAdvance';

// The engine's reasons, said shorter where the picker has less room. Anything not
// listed is shown as the engine words it.
const HINTS: Record<string, string> = {
  'A rearguard must contain at least one unit': 'Leaders or Characters left behind need at least one unit to stay with them — keep a unit back, or send them into the attack',
  'The attacking army must keep at least one unit': 'The attacking Army needs at least one unit',
  'At least one Army unit must move.': 'At least one unit must move',
  'Free Peoples Leaders can never be left in a region without combat units (p.27) — this move empties the region, so its Leaders must go with the Army.':
    'Free Peoples Leaders can never be left without a unit — keep a unit back with them, or take them along',
};

export function MovePicker({ from, to, kind, view, you, base, charOnly, onConfirm, onCancel }: {
  from: string; to: string; kind: MovePickerKind; view: GameState; you: Side;
  /** For kind 'eventMove' / 'armyMove2': the offered action this picker decorates with a
   *  selection (it carries the card's limits, or the second move's already-moved cap). */
  base?: WotrAction;
  /** Only a Character die can pay for this move or attack (the player picked one, or
   *  holds no other): the goers must then include a Leader or Character (p.28). */
  charOnly?: boolean;
  onConfirm: (a: WotrAction) => void; onCancel: () => void;
}) {
  // A card's attack is an attack like any other (player report 1o6s51234u6u4m30).
  const attackMode = kind === 'attack' || kind === 'eventAttack';
  const holdBackMode = kind === 'holdBack';
  const advanceMode = kind === 'advance' || kind === 'besiegerAdvance' || kind === 'relieveAdvance';
  // A card ATTACK that lands first (Corsairs of Umbar): the picker chooses who lands and
  // attacks; whoever stays behind sits out the battle.
  const landingAttack = kind === 'eventMove' && base?.kind === 'eventTarget' && base.mode === 'attack';
  const evBase = kind === 'eventMove' ? (base as Extract<WotrAction, { kind: 'eventTarget' }> | undefined) : undefined;

  // WHERE the figures come from. A SORTIE (p.32) is fought by the garrison in the siege
  // box; a garrison MARCHING OUT of its besieged Stronghold (Paths of the Woses) leaves
  // from the box too (player report 3a5p3i710y2h6u4a). Otherwise the region.
  const sortieBox = attackMode && from === to ? sortieForce(view, from, you) : null;
  const box = view.regions[from]?.siegeBox;
  const boxOurs = !!box && (Object.keys(box.units) as Nation[]).some((n) => sideOfNation(n) === you
    && ((box.units[n]?.regular ?? 0) + (box.units[n]?.elite ?? 0)) > 0);
  const marchOut = (kind === 'eventMove' || kind === 'moveArmy' || kind === 'armyMove2') && boxOurs ? box : null;
  const region: Force = (sortieBox ?? marchOut ?? view.regions[from]) as Force;

  // THE RULES for this kind of move — the same description the engine validates with.
  const rules: ArmyMoveRules | null = holdBackMode ? null
    : advanceMode ? (() => {
      // The advance's own record: the field battle's and the relief's are in the pending
      // choice; the siege advance reads the battle still on the table.
      const pc = view.pendingCombat;
      const data = (view.pendingChoice?.data ?? {}) as { rearguard?: NonNullable<GameState['pendingCombat']>['rearguard'] | null };
      const rg = kind === 'besiegerAdvance' ? pc?.rearguard ?? null : data.rearguard ?? null;
      return advanceRules(view, you, from, to, rg);
    })()
    : attackMode ? { kind: 'attack', side: you, force: region, viaCharacterDie: kind === 'attack' && !!charOnly,
      mustFight: kind === 'eventAttack' && base?.kind === 'eventTarget' ? cardAttackFighters(base.card) : undefined }
    : kind === 'armyMove2' ? { kind: 'move', side: you, force: region, to, movable: base?.kind === 'armyMove2' ? base.move : undefined }
    : kind === 'eventMove' ? {
      kind: 'move', side: you, force: region, to,
      // A card move may be narrower than "the Army": Rage of the Dunlendings moves "up
      // to four ISENGARD units" (player reports 0g40604w245d6w3q, 4z4d6h18592c546r).
      onlyNation: evBase?.nation, maxUnits: evBase?.count,
      escortCompanion: evBase?.card === 'fp-str-12' ? 'Through a Day and a Night' : undefined,
      movable: evBase?.movable,
    }
    : { kind: 'move', side: you, force: region, to, viaCharacterDie: !!charOnly };
  const offer = rules ? armyMoveOffer(view, rules) : null;
  const capped = !!rules && (rules.movable !== undefined || rules.maxUnits !== undefined || rules.onlyNation !== undefined);

  // Hold-back (p.31) is the one inversion: the Army has ALREADY advanced into `from`;
  // the counters choose who STAYS forward, and the rest marches back to `to`. A
  // Settlement the advance captured must keep a unit (the engine's holdBackMinimum).
  const holdBackMustHold = holdBackMode && view.regions[from]?.control === you;
  const own = (n: Nation) => sideOfNation(n) === you;
  const rows = offer ? offer.nations
    : (Object.keys(region.units) as Nation[]).filter((n) => own(n) && (region.units[n]!.regular + region.units[n]!.elite) > 0)
      .map((n) => ({ nation: n, regular: region.units[n]!.regular, elite: region.units[n]!.elite, reason: null as string | null }));
  const maxLeaders = offer ? offer.leaders : you === 'fp' ? region.leaders : 0;
  const maxNazgul = offer ? offer.nazgul : you === 'shadow' ? region.nazgul : 0;
  const charRows = offer ? offer.characters.filter((c) => !(rules!.kind === 'move' && c.id === 'saruman'))
    : region.characters.filter((c) => (you === 'fp') === !['witch-king', 'saruman', 'mouth-of-sauron'].includes(c) && c !== 'saruman').map((id) => ({ id, reason: null as string | null }));

  // Default = everyone who may go (within a card's unit budget).
  const initial = (): [Record<string, number>, Record<string, number>] => {
    const rr: Record<string, number> = {}, ee: Record<string, number> = {};
    let left = rules?.maxUnits ?? Infinity;
    for (const row of rows) {
      rr[row.nation] = Math.min(row.regular, left); left -= rr[row.nation]!;
      ee[row.nation] = Math.min(row.elite, left); left -= ee[row.nation]!;
    }
    return [rr, ee];
  };
  const [reg, setReg] = useState<Record<string, number>>(() => initial()[0]);
  const [eli, setEli] = useState<Record<string, number>>(() => initial()[1]);
  const [leaders, setLeaders] = useState(maxLeaders);
  const [nazgul, setNazgul] = useState(maxNazgul);
  const [chars, setChars] = useState<Set<string>>(() => new Set(charRows.filter((c) => !c.reason).map((c) => c.id)));

  const totalUnits = rows.reduce((s, r) => s + (reg[r.nation] ?? 0) + (eli[r.nation] ?? 0), 0);
  const offeredUnits = rows.reduce((s, r) => s + r.regular + r.elite, 0);
  const budgetLeft = rules?.maxUnits === undefined ? Infinity : Math.max(0, rules.maxUnits - totalUnits);
  // An untouched picker submits the plain action (the whole Army). A capped move always
  // states its selection: "the whole Army" is not what it offers.
  const isWhole = !capped && totalUnits === offeredUnits && leaders === maxLeaders && nazgul === maxNazgul
    && chars.size === charRows.filter((c) => !c.reason).length;

  const buildSel = (): MoveSel => {
    const units: MoveSel['units'] = {};
    for (const r of rows) { const u: { regular?: number; elite?: number } = {}; if (reg[r.nation]) u.regular = reg[r.nation]; if (eli[r.nation]) u.elite = eli[r.nation]; if (u.regular || u.elite) units[r.nation] = u; }
    const sel: MoveSel = { units };
    if (leaders) sel.leaders = leaders;
    if (nazgul) sel.nazgul = nazgul;
    if (chars.size) sel.characters = [...chars];
    return sel;
  };
  // An attack submits its REARGUARD (who stays); the hold-back submits who goes BACK.
  const buildStayers = (): MoveSel => {
    const units: MoveSel['units'] = {};
    for (const r of rows) {
      const have = region.units[r.nation]!;
      const rr = have.regular - (reg[r.nation] ?? 0), re = have.elite - (eli[r.nation] ?? 0);
      const u: { regular?: number; elite?: number } = {}; if (rr) u.regular = rr; if (re) u.elite = re; if (u.regular || u.elite) units[r.nation] = u;
    }
    const rg: MoveSel = { units };
    if (maxLeaders - leaders) rg.leaders = maxLeaders - leaders;
    if (maxNazgul - nazgul) rg.nazgul = maxNazgul - nazgul;
    const left = charRows.filter((c) => !c.reason && !chars.has(c.id)).map((c) => c.id);
    if (left.length) rg.characters = left;
    return rg;
  };

  // The ONE check, before the click.
  const raw = rules ? armySelectionReason(view, rules, buildSel())
    : holdBackMustHold && totalUnits < 1 ? 'At least one unit must hold the Settlement you just took' : null;
  const error = raw ? (HINTS[raw] ?? raw.replace(/\.$/, '')) : null;

  const make = (split: boolean): WotrAction =>
    kind === 'advance' ? { kind: 'advanceChoice', advance: true, move: split ? buildSel() : undefined }
      : kind === 'besiegerAdvance' ? { kind: 'besiegerAdvance', advance: true, move: split ? buildSel() : undefined }
      : kind === 'relieveAdvance' ? { kind: 'relieveAdvance', advance: true, move: split ? buildSel() : undefined }
      : kind === 'holdBack' ? { kind: 'advanceHoldBack', back: split ? buildStayers() : undefined }
      : kind === 'attack' ? { kind: 'attack', from, to, rearguard: split ? buildStayers() : undefined }
      : kind === 'eventAttack' ? { ...(base as Extract<WotrAction, { kind: 'eventTarget' }>), rearguard: split ? buildStayers() : undefined }
      : kind === 'eventMove' ? { ...(base as Extract<WotrAction, { kind: 'eventTarget' }>), move: split ? buildSel() : undefined }
        : kind === 'armyMove2' ? { kind: 'armyMove2', from, to, move: split ? buildSel() : undefined }
          : { kind: 'moveArmy', from, to, move: split ? buildSel() : undefined };

  const verb = sortieBox ? 'Sortie' : attackMode && from === to ? 'Assault' : attackMode ? 'Attack' : landingAttack ? 'Land and attack' : holdBackMode ? 'Keep forward'
    : kind === 'besiegerAdvance' ? 'Advance and lay siege' : advanceMode ? 'Advance' : 'Move';
  const intro = landingAttack ? `Choose what lands in ${rName(to)} and attacks; the rest stays in ${rName(from)} and sits out the battle.`
    : attackMode ? 'Choose what attacks; the rest stays behind as the rearguard (not in the battle).'
    : holdBackMode ? `Choose who stays in ${rName(from)}; everyone unticked marches back to ${rName(to)}.${holdBackMustHold ? ' At least one unit must hold the Settlement you just took.' : ' You may bring the whole Army back.'}`
    : kind === 'besiegerAdvance' ? `Choose who advances into ${rName(to)} and lays siege; the rest stays in ${rName(from)}.`
    : advanceMode ? `Choose who advances into ${rName(to)}; the rest stays in ${rName(from)}.`
    : rules?.maxUnits !== undefined ? `Choose what moves — this card moves up to ${rules.maxUnits} ${rules.onlyNation ? nationName(rules.onlyNation) + ' ' : ''}unit${rules.maxUnits === 1 ? '' : 's'}.`
    : 'Choose what moves.';

  // Merging onto a friendly Army may breach the 10-unit limit; the excess is removed
  // afterwards (p.26). Only said when the CURRENT selection overstacks.
  const destUnits = !attackMode && !landingAttack && !holdBackMode ? Object.entries(view.regions[to]?.units ?? {})
    .filter(([n]) => own(n as Nation)).reduce((s, [, u]) => s + u!.regular + u!.elite, 0) : 0;
  const overSel = Math.max(0, destUnits + totalUnits - 10);

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
        <div style={{ fontSize: 12, color: '#bbb', marginBottom: 8 }}>{intro}</div>
        {overSel > 0 && (
          <div style={{ fontSize: 12, color: '#f0d090', marginBottom: 8 }}>
            {rName(to)} already contains {destUnits} unit{destUnits === 1 ? '' : 's'} (limit 10). You'll remove {overSel} excess after moving.
          </div>
        )}
        {rows.map((r) => r.reason ? (
          // A Nation that may not take part stays — and the picker says why, in the rule's
          // own words (politics, already moved, the card's limit).
          <div key={r.nation} style={{ marginBottom: 4, opacity: 0.6 }} data-reason={r.reason}>
            <div style={{ fontWeight: 600, fontSize: 12, color: '#d8cfa8' }}>{nationName(r.nation)}</div>
            <div style={{ fontSize: 12, color: '#bbb' }}>
              {(region.units[r.nation]?.regular ?? 0) + (region.units[r.nation]?.elite ?? 0)} unit{(region.units[r.nation]?.regular ?? 0) + (region.units[r.nation]?.elite ?? 0) === 1 ? '' : 's'} stay — {r.reason.replace(/\.$/, '')}.
            </div>
          </div>
        ) : (
          <div key={r.nation} style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: '#d8cfa8' }}>{nationName(r.nation)}</div>
            {r.regular > 0 && <Step label="Regulars" val={reg[r.nation] ?? 0} max={Math.min(r.regular, (reg[r.nation] ?? 0) + budgetLeft)} set={(v) => setReg({ ...reg, [r.nation]: v })} />}
            {r.elite > 0 && <Step label="Elites" val={eli[r.nation] ?? 0} max={Math.min(r.elite, (eli[r.nation] ?? 0) + budgetLeft)} set={(v) => setEli({ ...eli, [r.nation]: v })} />}
          </div>
        ))}
        {/* Leaders, Nazgûl and Characters belong to no one Nation's heading — without
            their own they read as part of the last Nation listed (player report
            6n391x553q3c1b39). */}
        {rows.length > 0 && (maxLeaders > 0 || maxNazgul > 0 || charRows.length > 0) && (
          <div style={{ fontWeight: 600, fontSize: 12, color: '#d8cfa8', marginTop: 4 }}>{you === 'fp' ? 'Free Peoples' : 'Shadow'}</div>
        )}
        {maxLeaders > 0 && <Step label="Leaders" val={leaders} max={maxLeaders} set={setLeaders} />}
        {maxNazgul > 0 && <Step label="Nazgûl" val={nazgul} max={maxNazgul} set={setNazgul} />}
        {charRows.map((c) => (
          <label key={c.id} style={{ ...row, cursor: c.reason ? 'not-allowed' : 'pointer', opacity: c.reason ? 0.6 : 1 }} title={c.reason ?? undefined}>
            <input type="checkbox" name={`move-char-${c.id}`} disabled={!!c.reason} checked={chars.has(c.id)}
              onChange={(e) => { const s = new Set(chars); e.target.checked ? s.add(c.id) : s.delete(c.id); setChars(s); }} />
            <span style={{ flex: 1 }}>{charName(c.id)}{c.reason ? ` — ${c.reason.replace(/\.$/, '')}` : ''}</span>
          </label>
        ))}
        {error && <div style={{ fontSize: 12, color: '#f0a080', marginTop: 8 }} data-testid="move-picker-error">{error}.</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {/* ONE confirm button (player report 3t0a420x2k1t2m0g). An untouched picker
              submits the plain whole-Army action; change anything and it submits the
              selection. It is off whenever the shared rules refuse the selection. */}
          <button style={primary} disabled={!!error} onClick={() => onConfirm(make(!isWhole))}>{verb}</button>
          <button style={ghost} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 };
const card: React.CSSProperties = { background: '#211c14', color: '#eee', padding: 16, borderRadius: 8, width: 320, maxHeight: '80vh', overflow: 'auto', fontFamily: 'system-ui', border: '1px solid #554' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '2px 0' };
const step: React.CSSProperties = { width: 24, height: 24, background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 4, cursor: 'pointer' };
const primary: React.CSSProperties = { flex: 1, padding: '7px 8px', background: '#4a5a3a', color: '#f0e9d8', border: '1px solid #6a7', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
const ghost: React.CSSProperties = { padding: '7px 10px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
