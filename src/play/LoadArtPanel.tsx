// First-run "add the card art" panel. We ship no publisher art; this offers a
// one-click opt-in to fetch the publicly-hosted Steam Workshop CDN sheets and
// slice the 96 event cards into the local IndexedDB cache (artCache.ts). Skipping
// keeps the text placeholders — the game is fully playable either way. Mirrors the
// load-art flow in the Rebellion / Tyrants / A&A ports.
import { useState } from 'react';
import {
  downloadAllArt, downloadBoardArt, clearArt, useArtLoaded, ART_SOURCE_NOTE,
  TOTAL_CARD_COUNT, SHEET_COUNT, type DownloadProgress,
} from './artCache';

export function LoadArtPanel() {
  const { loaded, meta, hasBoard } = useArtLoaded();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<DownloadProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null); setProg(null);
    try { await downloadAllArt(setProg); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); setProg(null); }
  };
  const addBoard = async () => {
    setBusy(true); setErr(null);
    try { await downloadBoardArt(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const drop = async () => { setBusy(true); try { await clearArt(); } finally { setBusy(false); } };

  const mb = meta ? (meta.totalBytes / 1e6).toFixed(1) : null;
  const pct = prog ? Math.round((prog.cardsDone / prog.cardsTotal) * 100) : 0;

  return (
    <div style={box}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Card art</div>
      {loaded ? (
        <>
          <div style={{ fontSize: 13, color: '#9c9' }}>
            ✓ {hasBoard ? 'Board map + ' : ''}{meta!.cardCount} cards cached ({mb} MB) — shown {hasBoard ? 'on the board & ' : ''}in hands.
          </div>
          {!hasBoard && (
            <button onClick={addBoard} disabled={busy} style={primary}>
              {busy ? 'Adding board map…' : 'Add board map (new)'}
            </button>
          )}
          <button onClick={drop} disabled={busy} style={ghost}>Remove cached art</button>
        </>
      ) : busy ? (
        <>
          <div style={{ fontSize: 13, color: '#cc9' }}>
            {prog?.phase === 'fetching' ? `Fetching sheet ${prog.sheetsDone + 1}/${prog.sheetsTotal}…`
              : prog ? `Slicing cards… ${prog.cardsDone}/${prog.cardsTotal}` : 'Starting…'}
          </div>
          <div style={bar}><div style={{ ...fill, width: `${pct}%` }} /></div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#bba' }}>
            Optional: load the real Middle-earth board map plus the {TOTAL_CARD_COUNT} event cards
            ({SHEET_COUNT} card sheets + 1 map, public hosts, one-time). Otherwise the game uses
            the placeholder board and text cards.
          </div>
          <button onClick={run} style={primary}>Download board &amp; card art</button>
        </>
      )}
      {err && <div style={{ color: '#e98', fontSize: 12, marginTop: 4 }}>⚠ {err}</div>}
      <div style={{ fontSize: 11, color: '#776', marginTop: 6 }}>{ART_SOURCE_NOTE}</div>
    </div>
  );
}

const box: React.CSSProperties = { marginTop: 18, textAlign: 'left', background: '#1a160f', padding: 14, borderRadius: 8 };
const primary: React.CSSProperties = { display: 'block', width: '100%', marginTop: 8, padding: '9px', fontSize: 14, background: '#7a5230', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' };
const ghost: React.CSSProperties = { marginTop: 8, padding: '5px 10px', fontSize: 12, background: 'transparent', color: '#a98', border: '1px solid #553', borderRadius: 5, cursor: 'pointer' };
const bar: React.CSSProperties = { height: 8, background: '#332b1e', borderRadius: 4, marginTop: 6, overflow: 'hidden' };
const fill: React.CSSProperties = { height: '100%', background: '#c9a24b', transition: 'width .2s' };
