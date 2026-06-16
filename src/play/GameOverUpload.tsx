// When a game finishes, offer to upload its log to help tune the AI. The log is
// the public turn log (moves + outcomes) — no personal data. Posts to the
// /api/gamelog endpoint, which stores it as a 'wotr-gamelog' report. From the dev
// client (different origin) it posts to the deployed endpoint (CORS-open there).
import { useState } from 'react';
import type { GameState, Side } from '../engine/types';

// On the deployed site, post same-origin; from the local dev client (no Functions
// runtime) post to the deployed, CORS-open endpoint instead.
const isLocalDev = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
const ENDPOINT = (isLocalDev ? 'https://war-of-the-ring.pages.dev' : '') + '/api/gamelog';

export function GameOverUpload({ view, you, gameOver, clientBuild }: {
  view: GameState; you: Side | null; gameOver: boolean; clientBuild?: string;
}) {
  const [stage, setStage] = useState<'offer' | 'uploading' | 'done' | 'error' | 'dismissed'>('offer');
  if (!gameOver || !view.winner || stage === 'dismissed') return null;

  const winnerName = view.winner === 'fp' ? 'Free Peoples' : 'Shadow';
  const upload = async () => {
    setStage('uploading');
    try {
      const message = `GAME COMPLETE — ${winnerName} wins (${view.winReason ?? '?'}). Uploaded for AI tuning. (turns: ${view.turn})`;
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ you, turns: view.turn, message, log: view.log ?? [], clientBuild }),
      });
      setStage(res.ok ? 'done' : 'error');
    } catch { setStage('error'); }
  };

  return (
    <div style={backdrop}>
      <div style={card}>
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 4, color: view.winner === 'fp' ? '#7fb6e6' : '#e6857f' }}>
          {winnerName} win!
        </div>
        <div style={{ fontSize: 14, color: '#cbb', marginBottom: 14 }}>{view.winReason}</div>

        {stage === 'done' ? (
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
        {(stage === 'done' || stage === 'error') && (
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
