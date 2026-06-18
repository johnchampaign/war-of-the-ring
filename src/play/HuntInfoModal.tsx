// "How the Hunt works" — an informational dialog (opened from the on-board Hunt
// indicator) that lays out the current Hunt state and EVERY modifier: the dice the
// Shadow rolls, the box bonus, the re-roll sources (Shadow Stronghold / Army /
// Nazgûl in the Ring-bearers' region — shown concretely only while revealed, since
// the location is hidden otherwise), the Mordor-track auto-draw, and the Guide /
// card effects. Pure reference; reads only public state.
import type { GameState } from '../engine/types';
import { huntRerollSources } from '../engine/hunt';
import { CorruptionLine } from './huntView';
import mapData from '../../assets/map.json';

export function HuntInfoModal({ view, onClose }: { view: GameState; onClose: () => void }) {
  const fs = view.fellowship;
  const box = view.hunt.box;
  const dice = Math.min(5, box);
  const bonus = view.hunt.fpDiceInBox ?? 0;
  const onMordor = fs.mordor !== null;
  // Concrete re-roll sources only when revealed (location is public then); otherwise
  // describe them generically so we never leak the hidden position.
  const src = !fs.hidden ? huntRerollSources(view) : null;
  const srcList = src ? [src.stronghold && 'a Shadow Stronghold', src.army && 'a Shadow Army', src.nazgul && 'a Nazgûl'].filter(Boolean) as string[] : [];

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 14, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>⊙ The Hunt for the Ring</div>

        <div style={box1}>
          <Row k="Hunt Box" v={`${box} die${box === 1 ? '' : 'ce'}`} note={onMordor ? 'on the Mordor Track — see below' : `the Shadow rolls ${dice} (max 5) when the Fellowship moves`} />
          {bonus > 0 && <Row k="Box bonus" v={`+${bonus}`} note="Free Peoples dice in the box — added to every Hunt die" />}
          <Row k="Progress" v={onMordor ? `Mordor ${fs.mordor}/5` : `${fs.progress} step${fs.progress === 1 ? '' : 's'}`} />
          <Row k="Fellowship" v={fs.hidden ? '🙈 Hidden' : '🔴 Revealed'} note={fs.hidden ? 'free to move' : 'must hide (Character die) before moving again'} />
        </div>
        <CorruptionLine current={fs.corruption} />

        <Section title="When the Fellowship moves">
          {onMordor
            ? 'On the Mordor Track there is no roll — one Hunt tile is drawn automatically every move (the special tiles are now in the pool), and standing still costs +1 Corruption.'
            : `The Shadow rolls ${dice} Hunt ${dice === 1 ? 'die' : 'dice'} (the number in the Hunt Box, capped at 5). Each die hits on a 6+ — a natural 1 always misses${bonus ? `; the +${bonus} box bonus is added to every die` : ''}. Every success draws one Hunt tile.`}
        </Section>

        <Section title="Re-rolls (location modifiers)">
          The Shadow re-rolls one failed Hunt die for <b>each</b> of these in the Ring-bearers' region: a <b>Shadow-controlled Stronghold</b>, a <b>Shadow Army</b>, and a <b>Nazgûl</b> (or the Witch-king).
          {src
            ? (srcList.length
                ? <div style={{ marginTop: 4, color: '#e88' }}>Right now at {regionName(view, fs.location)}: {srcList.join(', ')} → <b>{srcList.length} re-roll{srcList.length === 1 ? '' : 's'}</b>.</div>
                : <div style={{ marginTop: 4, color: '#9c9' }}>None apply at {regionName(view, fs.location)} right now.</div>)
            : <div style={{ marginTop: 4, color: '#998', fontStyle: 'italic' }}>(The exact sources are shown only while the Fellowship is revealed — its location is hidden otherwise.)</div>}
        </Section>

        <Section title="Tiles & damage">
          A drawn tile is its <b>Hunt damage</b> (added to Corruption — Shadow wins at 12). Some tiles also <b>Reveal</b> the Fellowship. <b>Eye</b> tiles deal damage equal to the successes; <b>die</b> tiles roll for it. On the Mordor Track the <b>special tiles</b> are live (some stop the Fellowship or deal heavy damage); a few Free Peoples tiles instead <b>heal</b> Corruption.
        </Section>

        <Section title="Other modifiers">
          The <b>Guide</b> can soften the Hunt — Gollum suppresses a numbered tile's Reveal; a Hobbit Guide can separate to reduce damage by 1. On-table cards matter too: <b>Flocks of Crebain</b> (+1 to all Hunt dice), the <b>Balrog</b> (an extra tile), and Free-Peoples defences (Wizard's Staff, Mithril Coat).
        </Section>

        <button style={btn} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0', fontSize: 13 }}>
      <span style={{ color: '#998', minWidth: 86 }}>{k}</span>
      <b>{v}</b>
      {note && <span style={{ color: '#887', fontSize: 12 }}>— {note}</span>}
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: '#e6b85a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#d8d0bc', lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}
const regionName = (_view: GameState, id: string): string => (mapData as any).regions[id]?.name ?? id;

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.72)', display: 'grid', placeItems: 'center', zIndex: 75 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 12, border: '1px solid #5a4a2a', width: 480, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 8px 40px #000' };
const box1: React.CSSProperties = { background: '#15110b', border: '1px solid #2a2418', borderRadius: 8, padding: '8px 10px' };
const btn: React.CSSProperties = { marginTop: 14, padding: '8px 20px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
