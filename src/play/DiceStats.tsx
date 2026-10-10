// End-of-game dice statistics for both players (player report zfi5pzt828h4v6xq: "at
// the end have a statistics of dice distribution for both players"). Everything here
// is read back from the public game log — the Action rolls, every battle's Combat
// rolls and re-rolls, and the Hunt rolls — so it is open information.
import type { GameState, Side } from '../engine/types';
import { FACE } from './DiceTray';

type Counts = number[]; // index 1..6
const blank = (): Counts => [0, 0, 0, 0, 0, 0, 0];
const SIDES: Side[] = ['fp', 'shadow'];
const ACTION_FACES: Record<Side, string[]> = {
  fp: ['character', 'army', 'muster', 'armyMuster', 'event', 'will'],
  shadow: ['character', 'army', 'muster', 'armyMuster', 'event', 'eye'],
};

export interface DiceTally {
  action: Record<Side, Record<string, number>>;
  combat: Record<Side, Counts>;
  hunt: Counts;
}

/** Tally every logged roll. Entries from before a payload carried the rolling side
 *  (older games' battles) are simply skipped. */
export function tallyDice(view: GameState): DiceTally {
  const t: DiceTally = { action: { fp: {}, shadow: {} }, combat: { fp: blank(), shadow: blank() }, hunt: blank() };
  const add = (c: Counts, ds: unknown) => { if (Array.isArray(ds)) for (const d of ds) if (typeof d === 'number' && d >= 1 && d <= 6) c[d]!++; };
  for (const e of view.log ?? []) {
    const p = (e as { payload?: Record<string, unknown> }).payload;
    if (!p) continue;
    if (e.kind === 'roll') {
      for (const s of SIDES) if (Array.isArray(p[s])) for (const f of p[s] as string[]) t.action[s][f] = (t.action[s][f] ?? 0) + 1;
      if (typeof p.eyes === 'number' && p.eyes > 0) t.action.shadow.eye = (t.action.shadow.eye ?? 0) + p.eyes;
    } else if (e.kind === 'combat') {
      const atk = p.attackerSide as Side | undefined;
      if (atk && p.attacker && p.defender) {
        const def: Side = atk === 'fp' ? 'shadow' : 'fp';
        const a = p.attacker as { dice?: number[]; rerolls?: number[] }, d = p.defender as { dice?: number[]; rerolls?: number[] };
        add(t.combat[atk], a.dice); add(t.combat[atk], a.rerolls);
        add(t.combat[def], d.dice); add(t.combat[def], d.rerolls);
      } else if ((p.side === 'fp' || p.side === 'shadow') && Array.isArray(p.dice)) add(t.combat[p.side as Side], p.dice);
    } else if (e.kind === 'hunt' && Array.isArray(p.dice)) {
      add(t.hunt, p.dice); add(t.hunt, p.rerolls);
    }
  }
  return t;
}

const total = (c: Counts) => c.reduce((a, b) => a + b, 0);
const mean = (c: Counts) => { const n = total(c); return n ? c.reduce((a, k, i) => a + k * i, 0) / n : 0; };

/** One row of six bars, 1 to 6, each scaled to the row's largest count. */
function Spread({ c, color }: { c: Counts; color: string }) {
  const max = Math.max(1, ...c.slice(1));
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 52, marginTop: 2 }}>
      {[1, 2, 3, 4, 5, 6].map((v) => (
        <div key={v} title={`${v}: ${c[v]}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: 22 }}>
          <span style={{ fontSize: 9, color: '#998' }}>{c[v]}</span>
          <div style={{ width: 14, height: Math.round(24 * c[v]! / max), minHeight: c[v] ? 2 : 0, background: color, borderRadius: 2 }} />
          <span style={{ fontSize: 10, color: '#cbb', fontWeight: 700 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function DiceStats({ view }: { view: GameState }) {
  const t = tallyDice(view);
  const name = (s: Side) => (s === 'fp' ? 'Free Peoples' : 'Shadow');
  const color = (s: Side) => (s === 'fp' ? '#5f8fd0' : '#d0605a');
  return (
    <div style={{ textAlign: 'left', fontSize: 12, color: '#e9e1cc' }} data-testid="dice-stats">
      <div style={sub}>Action dice rolled</div>
      {SIDES.map((s) => (
        <div key={s} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', margin: '3px 0' }}>
          <span style={{ width: 84, color: color(s), fontWeight: 700 }}>{name(s)}</span>
          {ACTION_FACES[s].filter((f) => t.action[s][f]).map((f) => (
            <span key={f} style={{ background: FACE[f]?.bg ?? '#555', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>
              {FACE[f]?.label ?? f} ×{t.action[s][f]}
            </span>
          ))}
        </div>
      ))}
      <div style={sub}>Combat dice (with re-rolls)</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        {SIDES.map((s) => (
          <div key={s}>
            <div style={{ color: color(s), fontWeight: 700, marginBottom: 2 }}>{name(s)} <span style={{ color: '#998', fontWeight: 400 }}>· {total(t.combat[s])} dice · average {mean(t.combat[s]).toFixed(2)}</span></div>
            <Spread c={t.combat[s]} color={color(s)} />
          </div>
        ))}
      </div>
      {total(t.hunt) > 0 && <>
        <div style={sub}>Hunt dice (Shadow)</div>
        <div style={{ color: '#998', marginBottom: 2 }}>{total(t.hunt)} dice · average {mean(t.hunt).toFixed(2)}</div>
        <Spread c={t.hunt} color="#c98ab0" />
      </>}
    </div>
  );
}

const sub: React.CSSProperties = { fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, margin: '10px 0 3px' };
