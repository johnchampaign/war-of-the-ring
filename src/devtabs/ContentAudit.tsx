// Content-audit dev route (#content). Renders EVERY authored content item —
// 96 event cards, companions/upgrades/minions, hunt tiles — through the live data
// pipeline, with each event card's sliced art beside its parsed text so crop/text
// mismatches are obvious. Plus an automated render-check that flags structural
// problems (dup ids, missing fields, dangling sheet/region/upgrade refs). This is
// the single highest-leverage tool for catching authoring bugs across the catalog.
import { useMemo, useState } from 'react';
import { useCardArt } from '../play/artCache';
import eventCardsJson from '../../assets/event-cards.json';
import charactersJson from '../../assets/characters.json';
import huntTilesJson from '../../assets/hunt-tiles.json';
import assetUrlsJson from '../../assets/asset-urls.json';

const CARDS = (eventCardsJson as { cards: any[] }).cards;
const CHARS = charactersJson as any;
const TILES = huntTilesJson as any;
// companions/upgrades/minions are id-keyed objects, not arrays.
const COMPANIONS: [string, any][] = Object.entries(CHARS.companions ?? {});
const SHEETS = (assetUrlsJson as { sheets: Record<string, unknown> }).sheets;

type Tab = 'cards' | 'companions' | 'tiles' | 'checks';

export function ContentAudit() {
  const [tab, setTab] = useState<Tab>('checks');
  const [q, setQ] = useState('');
  const problems = useMemo(() => runChecks(), []);

  return (
    <div style={{ minHeight: '100vh', background: '#0c0a07', color: '#e9e1cc', fontFamily: 'system-ui', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Content audit</h2>
        <a href="#" style={{ color: '#998' }}>← app</a>
        {(['checks', 'cards', 'companions', 'tiles'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...tabBtn, ...(tab === t ? tabOn : {}) }}>
            {t === 'checks' ? `Checks${problems.length ? ` (${problems.length})` : ' ✓'}` : t}
          </button>
        ))}
        {(tab === 'cards' || tab === 'companions') && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…" style={search} />
        )}
        <span style={{ color: '#776', fontSize: 12 }}>
          {CARDS.length} cards · {COMPANIONS.length} companions · {TILES.standard.length} standard tiles
        </span>
      </div>

      {tab === 'checks' && <Checks problems={problems} />}
      {tab === 'cards' && <Cards q={q} />}
      {tab === 'companions' && <Companions q={q} />}
      {tab === 'tiles' && <Tiles />}
    </div>
  );
}

// ---------- render-check ----------

interface Problem { kind: string; where: string; detail: string }
function runChecks(): Problem[] {
  const out: Problem[] = [];
  const seen = new Map<string, number>();
  for (const c of CARDS) {
    seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
    if (!c.name) out.push({ kind: 'card', where: c.id, detail: 'missing name' });
    if (!c.eventText && !c.combat?.text) out.push({ kind: 'card', where: c.id, detail: 'no event text AND no combat effect' });
    if (!c.side) out.push({ kind: 'card', where: c.id, detail: 'missing side' });
    if (!c.deck) out.push({ kind: 'card', where: c.id, detail: 'missing deck' });
    if (c.initiative == null) out.push({ kind: 'card', where: c.id, detail: 'missing initiative' });
    if (!SHEETS[String(c.sheetId)]) out.push({ kind: 'card', where: c.id, detail: `sheetId ${c.sheetId} not in asset-urls` });
    const r = c.region;
    if (!Array.isArray(r) || r.length !== 4 || r.some((n: number) => typeof n !== 'number' || n < 0 || n > 1)) {
      out.push({ kind: 'card', where: c.id, detail: `bad region ${JSON.stringify(r)}` });
    }
  }
  for (const [id, n] of seen) if (n > 1) out.push({ kind: 'card', where: id, detail: `duplicate id (${n}×)` });

  const upgradeIds = new Set(Object.keys(CHARS.upgrades ?? {}));
  for (const [id, c] of COMPANIONS) {
    const where = c.name ?? id;
    if (!c.abilities?.length && !c.guide) out.push({ kind: 'companion', where, detail: 'no abilities and no guide text' });
    if (typeof c.level !== 'number' || c.level < 0 || c.level > 3) out.push({ kind: 'companion', where, detail: `level out of range: ${c.level}` });
    if (c.upgradeTo && !upgradeIds.has(c.upgradeTo)) out.push({ kind: 'companion', where, detail: `upgradeTo '${c.upgradeTo}' not in upgrades` });
  }

  const tileSum = (arr: any[]) => arr.reduce((s, t) => s + (t.count ?? 1), 0);
  const stdSum = tileSum(TILES.standard);
  if (TILES.counts?.standard != null && stdSum !== TILES.counts.standard) {
    out.push({ kind: 'tile', where: 'standard', detail: `count sum ${stdSum} ≠ declared ${TILES.counts.standard}` });
  }
  return out;
}

function Checks({ problems }: { problems: Problem[] }) {
  if (!problems.length) return <p style={{ color: '#7c7', marginTop: 20 }}>✓ All content passes the structural checks — no dup ids, missing fields, or dangling sheet/region/upgrade references.</p>;
  return (
    <table style={{ marginTop: 16, borderCollapse: 'collapse', fontSize: 13 }}>
      <thead><tr style={{ color: '#998', textAlign: 'left' }}><th style={th}>kind</th><th style={th}>where</th><th style={th}>problem</th></tr></thead>
      <tbody>
        {problems.map((p, i) => (
          <tr key={i}><td style={td}>{p.kind}</td><td style={{ ...td, color: '#e6b85a' }}>{p.where}</td><td style={td}>{p.detail}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- event cards ----------

function Cards({ q }: { q: string }) {
  const ql = q.toLowerCase();
  const list = CARDS.filter((c) => !ql || `${c.name} ${c.side} ${c.deck} ${c.eventText} ${c.combat?.text}`.toLowerCase().includes(ql));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12, marginTop: 16 }}>
      {list.map((c) => <CardRow key={c.id} c={c} />)}
    </div>
  );
}

function CardRow({ c }: { c: any }) {
  const art = useCardArt(c.id);
  const sideCol = c.side === 'Shadow' ? '#5a2222' : '#1f3a5a';
  return (
    <div style={{ display: 'flex', gap: 10, background: '#15110b', border: '1px solid #2a2418', borderRadius: 8, padding: 10 }}>
      {art
        ? <img src={art} alt={c.name} style={{ width: 96, height: 'auto', alignSelf: 'flex-start', borderRadius: 4, flexShrink: 0 }} />
        : <div style={{ width: 96, height: 134, background: sideCol, borderRadius: 4, flexShrink: 0, display: 'grid', placeItems: 'center', color: '#aaa', fontSize: 10, textAlign: 'center', padding: 4 }}>no art<br />(download in lobby)</div>}
      <div style={{ minWidth: 0, fontSize: 12.5 }}>
        <div style={{ fontWeight: 700 }}>{c.name} <span style={{ color: '#887', fontWeight: 400 }}>· {c.id}</span></div>
        <div style={{ color: '#998', fontSize: 11 }}>{c.side} · {c.deck} · init {c.initiative}{c.playableVia ? ` · via ${c.playableVia}` : ''}</div>
        {c.precondition && <p style={pStyle}><b style={{ color: '#caa' }}>Precondition:</b> {c.precondition}</p>}
        {c.eventText && <p style={pStyle}><b style={{ color: '#9c9' }}>Event:</b> {c.eventText}</p>}
        {c.combat?.title && <p style={pStyle}><b style={{ color: '#e6857f' }}>Combat — {c.combat.title}:</b> {c.combat.precondition ? `(${c.combat.precondition}) ` : ''}{c.combat.text}</p>}
        {c.discardCondition && <p style={{ ...pStyle, color: '#a87' }}><b>Discard:</b> {c.discardCondition}</p>}
      </div>
    </div>
  );
}

// ---------- companions ----------

function Companions({ q }: { q: string }) {
  const ql = q.toLowerCase();
  const minions = Object.entries(CHARS.minions ?? {}).map(([id, m]: any) => ({ id, ...m, _group: 'Minion' }));
  const upgrades = Object.entries(CHARS.upgrades ?? {}).map(([id, m]: any) => ({ id, ...m, _group: 'Upgrade' }));
  const gollum = CHARS.gollum ? [{ id: 'gollum', ...CHARS.gollum, _group: 'Gollum' }] : [];
  const all = [...COMPANIONS.map(([id, c]) => ({ id, ...c, _group: 'Companion' })), ...gollum, ...upgrades, ...minions];
  const list = all.filter((c) => !ql || `${c.name} ${c.title} ${c.guide} ${(c.abilities ?? []).map((a: any) => a.name + a.text).join(' ')}`.toLowerCase().includes(ql));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, marginTop: 16 }}>
      {list.map((c, i) => (
        <div key={i} style={{ background: '#15110b', border: '1px solid #2a2418', borderRadius: 8, padding: 10, fontSize: 12.5 }}>
          <div style={{ fontWeight: 700 }}>{c.name} <span style={{ color: '#887', fontWeight: 400, fontSize: 11 }}>· {c._group}</span></div>
          {c.title && <div style={{ color: '#998', fontSize: 11, fontStyle: 'italic' }}>{c.title}</div>}
          <div style={{ color: '#998', fontSize: 11, margin: '2px 0' }}>
            {c.level != null && `level ${c.level}`}{c.leadership != null && ` · leadership ${c.leadership}`}{c.nation && c.nation !== 'any' ? ` · ${c.nation}` : ''}{c.startsInFellowship ? ' · starts in Fellowship' : ''}{c.upgradeTo ? ` · →${c.upgradeTo}` : ''}
          </div>
          {c.guide && <p style={pStyle}><b style={{ color: '#9bd' }}>Guide:</b> {c.guide}</p>}
          {(c.abilities ?? []).map((a: any, j: number) => <p key={j} style={pStyle}><b style={{ color: '#caa' }}>{a.name}:</b> {a.text}</p>)}
        </div>
      ))}
    </div>
  );
}

// ---------- hunt tiles ----------

function Tiles() {
  const groups: [string, any[]][] = [
    ['Standard pool', TILES.standard],
    ['Special — Fellowship', TILES.specialFellowship ?? []],
    ['Special — Shadow', TILES.specialShadow ?? []],
  ];
  return (
    <div style={{ marginTop: 16 }}>
      {groups.map(([label, arr]) => (
        <div key={label} style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 6px' }}>{label} <span style={{ color: '#776', fontSize: 12, fontWeight: 400 }}>({arr.reduce((s, t) => s + (t.count ?? 1), 0)})</span></h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {arr.map((t, i) => (
              <div key={i} style={{ background: '#15110b', border: '1px solid #2a2418', borderRadius: 6, padding: '6px 10px', fontSize: 12, minWidth: 120 }}>
                <b style={{ color: t.value === 'eye' ? '#e6857f' : '#e6b85a' }}>{t.value === 'eye' ? '👁 Eye' : `${t.value} damage`}</b>
                {t.count ? <span style={{ color: '#887' }}> ×{t.count}</span> : null}
                <div style={{ color: '#998', fontSize: 11 }}>{t.reveal ? 'reveals' : 'no reveal'}{t.id ? ` · ${t.id}` : ''}{t.special ? ` · ${t.special}` : ''}</div>
                {t.text && <div style={{ fontSize: 11, marginTop: 2 }}>{t.text}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const tabBtn: React.CSSProperties = { padding: '4px 10px', fontSize: 13, background: '#2a2418', color: '#bba', border: '1px solid #443', borderRadius: 14, cursor: 'pointer', textTransform: 'capitalize' };
const tabOn: React.CSSProperties = { background: '#7a5230', color: '#fff', borderColor: '#7a5230' };
const search: React.CSSProperties = { background: '#14110b', color: '#f0e9d8', border: '1px solid #443', borderRadius: 6, padding: '4px 8px', fontSize: 13 };
const th: React.CSSProperties = { padding: '4px 12px', borderBottom: '1px solid #443' };
const td: React.CSSProperties = { padding: '3px 12px', borderBottom: '1px solid #1e1a12' };
const pStyle: React.CSSProperties = { margin: '3px 0', lineHeight: 1.35 };
