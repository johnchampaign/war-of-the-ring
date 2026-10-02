// A compact, always-visible Hunt status panel overlaid on the board: the Hunt Box
// (rendered as die icons — the dice the Shadow rolls when the Fellowship moves),
// the Corruption track (Shadow wins at 12), Progress, and hidden/revealed. Click it
// (or the ⓘ) for the full HuntInfoModal explaining every modifier. Glanceable
// pressure, legible BEFORE a Hunt fires.
import { useState } from 'react';
import type { GameState } from '../engine/types';
import { HuntInfoModal } from './HuntInfoModal';

export function HuntIndicator({ view }: { view: GameState }) {
  const [open, setOpen] = useState(false);
  const fs = view.fellowship;
  const box = view.hunt.box;
  const fpDice = view.hunt.fpDiceInBox;
  const onMordor = fs.mordor !== null;
  // Off the Mordor Track the Shadow rolls up to 5 Eye dice, each Free Peoples die in the
  // box adding +1, so the overlay shows the rolled dice and the number they hit on. On
  // the track nothing is rolled: an Eye tile's damage counts EVERY die in the box,
  // Free Peoples dice included, so all of them are shown (player report 381f5t1f3x4k1t08).
  const dice = onMordor ? box : Math.min(5, box);
  const hitOn = Math.max(2, 6 - fpDice);
  const corr = fs.corruption;
  const danger = corr >= 10;

  return (
    <>
      <button onClick={() => setOpen(true)} title="The Hunt for the Ring — click for how it works and the active modifiers" style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 0.5 }}>⊙ Hunt</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#887', border: '1px solid #4a4332', borderRadius: 8, width: 14, height: 14, lineHeight: '13px', textAlign: 'center' }}>ⓘ</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, margin: '3px 0', maxWidth: 140 }}
          title={onMordor ? `${box} Eye + ${fpDice} Free Peoples ${fpDice === 1 ? 'die' : 'dice'} in the Hunt Box — an Eye tile deals ${box + fpDice}` : `${dice} Hunt ${dice === 1 ? 'die' : 'dice'}, hitting on ${hitOn}+`}>
          {Array.from({ length: dice }).map((_, i) => (
            <span key={i} style={pip}>⚅</span>
          ))}
          {onMordor && Array.from({ length: fpDice }).map((_, i) => (
            <span key={`fp${i}`} style={{ ...pip, color: '#7fa6d6' }}>⚅</span>
          ))}
          {box === 0 && !(onMordor && fpDice > 0) && <span style={{ fontSize: 11, color: '#776' }}>empty</span>}
          {!onMordor && box > 5 && <span style={{ fontSize: 10, color: '#887' }}>+{box - 5}</span>}
        </div>
        {/* The to-hit number on its own line, not trailing the dice (player report 326g4536416k3q0g). */}
        {!onMordor && box > 0 && <div style={{ fontSize: 11, color: '#cbbf9a' }}>Hits on {hitOn}+</div>}
        {/* Corruption track. */}
        <div style={{ fontSize: 11, color: danger ? '#ff8a8a' : '#cbbf9a', fontWeight: danger ? 700 : 400 }}>
          Corruption {corr}/12
        </div>
        <div style={{ fontSize: 11, color: '#9bb0c8' }}>
          {fs.mordor !== null ? `Mordor ${fs.mordor}/5` : `Progress ${fs.progress}`}
        </div>
        {/* Spelled out: the status-bar chit that said this is gone (report 205g5s252m4n2f5t). */}
        <div style={{ fontSize: 11, color: fs.hidden ? '#bfe6bf' : '#ff8a8a', fontWeight: fs.hidden ? 400 : 700 }}
          title={fs.hidden ? 'The Fellowship is hidden — it may move.' : 'The Fellowship is revealed — it cannot move until it hides again (a Character die).'}>
          {fs.hidden ? '🙈 Hidden' : '🔴 Revealed'}
        </div>
      </button>
      {open && <HuntInfoModal view={view} onClose={() => setOpen(false)} />}
    </>
  );
}

const panel: React.CSSProperties = {
  position: 'absolute', top: 6, right: 6, zIndex: 5, textAlign: 'left',
  background: 'rgba(28,23,16,0.9)', color: '#e9e1cc', border: '1px solid #5a4a2a',
  borderRadius: 8, padding: '6px 8px', cursor: 'pointer', minWidth: 96, boxShadow: '0 2px 8px #0006',
};
const pip: React.CSSProperties = { fontSize: 16, color: '#caa84b', lineHeight: 1 };
