// Uploading a game's log to help tune the AI. The log is the public turn log (moves
// + outcomes) — no personal data. Posts to /api/gamelog, stored as a 'wotr-gamelog'
// report. Two entry points share one uploader:
//   • UploadLogButton — a floating button (beside Log/Report), available ANY time so
//     a game that never reaches a natural end can still be uploaded mid-game. This is
//     why uploads were ~never happening: testers rarely play to a clean game-over.
//   • GameOverUpload — the end-of-game prompt, which now SKIPS the offer if the log
//     was already uploaded (via the button) this game.
import { useState } from 'react';
import type { GameState, Side } from '../engine/types';

// On the deployed site, post same-origin; from the local dev client (no Functions
// runtime) post to the deployed, CORS-open endpoint instead.
const isLocalDev = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
const ENDPOINT = (isLocalDev ? 'https://war-of-the-ring.pages.dev' : '') + '/api/gamelog';

/** POST the current game log to the AI-tuning endpoint. Works mid-game or at the end.
 *  Returns true on success. */
export async function uploadGameLog(view: GameState, you: Side | null, clientBuild?: string): Promise<boolean> {
  try {
    const winner = view.winner === 'fp' ? 'Free Peoples' : view.winner === 'shadow' ? 'Shadow' : null;
    const message = winner
      ? `GAME COMPLETE — ${winner} wins (${view.winReason ?? '?'}). Uploaded for AI tuning. (turns: ${view.turn})`
      : `GAME IN PROGRESS — uploaded for AI tuning (turn ${view.turn}, ${view.phase}).`;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ you, turns: view.turn, message, log: view.log ?? [], clientBuild }),
    });
    return res.ok;
  } catch { return false; }
}

/** Floating "Upload log" button — beside the Log/Report buttons; usable any time. */
export function UploadLogButton({ view, you, clientBuild, uploaded, onUploaded, style }: {
  view: GameState; you: Side | null; clientBuild?: string; uploaded: boolean; onUploaded: () => void; style?: React.CSSProperties;
}) {
  const [stage, setStage] = useState<'idle' | 'uploading' | 'error'>('idle');
  const done = uploaded; // shared with the end-game prompt so each game uploads once
  const click = async () => {
    if (done || stage === 'uploading') return;
    setStage('uploading');
    const ok = await uploadGameLog(view, you, clientBuild);
    if (ok) { onUploaded(); setStage('idle'); } else setStage('error');
  };
  const label = stage === 'uploading' ? '⏳ Uploading…' : done ? '✓ Log sent' : stage === 'error' ? '⚠ Retry upload' : '⬆ Upload log';
  return (
    <button onClick={click} disabled={done || stage === 'uploading'}
      title={done ? 'This game’s log has been uploaded — thank you!' : 'Upload this game’s log to help tune the AI (no personal data)'}
      style={{ position: 'fixed', bottom: 10, right: 200, zIndex: 40, padding: '6px 12px', fontSize: 13, borderRadius: 18, boxShadow: '0 2px 8px #0008',
        background: done ? '#26331f' : '#3a3326', color: done ? '#9cc77a' : '#f0e9d8', border: `1px solid ${done ? '#3f5a32' : '#5a4a2a'}`,
        cursor: done ? 'default' : 'pointer', ...style }}>
      {label}
    </button>
  );
}

export function GameOverUpload({ view, you, gameOver, clientBuild, uploaded, onUploaded }: {
  view: GameState; you: Side | null; gameOver: boolean; clientBuild?: string; uploaded: boolean; onUploaded: () => void;
}) {
  const [stage, setStage] = useState<'offer' | 'uploading' | 'done' | 'error' | 'dismissed'>('offer');
  if (!gameOver || !view.winner || stage === 'dismissed') return null;

  const winnerName = view.winner === 'fp' ? 'Free Peoples' : 'Shadow';
  // If the log was already uploaded this game (via the button), don't re-prompt.
  const alreadyDone = uploaded || stage === 'done';
  const upload = async () => {
    setStage('uploading');
    const ok = await uploadGameLog(view, you, clientBuild);
    if (ok) { onUploaded(); setStage('done'); } else setStage('error');
  };

  return (
    <div style={backdrop}>
      <div style={card}>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4, color: view.winner === 'fp' ? '#7fb6e6' : '#e6857f' }}>
          {winnerName} win!
        </div>
        <div style={{ fontSize: 14, color: '#cbb', marginBottom: 14 }}>{view.winReason}</div>

        {alreadyDone ? (
          <div style={{ color: '#9cc77a', fontSize: 14 }}>Thanks — log uploaded. It helps tune the AI.</div>
        ) : stage === 'error' ? (
          <div style={{ color: '#e9a', fontSize: 13 }}>Couldn't upload (offline, or the server isn't reachable). No worries — the game's still over.</div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#bba', marginBottom: 12, lineHeight: 1.45 }}>
              Help improve the AI by uploading this game's log? It's just the moves and the result — no personal data.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={upload} disabled={stage === 'uploading'} style={primary}>{stage === 'uploading' ? 'Uploading…' : 'Upload log'}</button>
              <button onClick={() => setStage('dismissed')} style={ghost}>No thanks</button>
            </div>
          </>
        )}
        {(alreadyDone || stage === 'error') && (
          <button onClick={() => setStage('dismissed')} style={{ ...ghost, marginTop: 12 }}>Close</button>
        )}
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.7)', display: 'grid', placeItems: 'center', zIndex: 80 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '20px 26px', borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 320, maxWidth: 460, boxShadow: '0 8px 40px #000', textAlign: 'center' };
const primary: React.CSSProperties = { padding: '8px 18px', fontSize: 14, background: '#2f4f9e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' };
const ghost: React.CSSProperties = { padding: '8px 16px', fontSize: 14, background: 'transparent', color: '#a98', border: '1px solid #553', borderRadius: 6, cursor: 'pointer' };
