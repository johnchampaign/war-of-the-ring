// Renders the current player's legal actions as labeled buttons. The UI only ever
// offers actions the engine returned (illegal moves are impossible to attempt).
import { useState } from 'react';
import type { WotrAction } from '../adapter/wotrAction';
import type { GameState } from '../engine/types';
import { useCardArt } from './artCache';
import { describeAction } from './actionText';

export function ActionPanel({ actions, onAction, yourTurn, gameOver, view }: {
  actions: WotrAction[]; onAction: (a: WotrAction) => void; yourTurn: boolean; gameOver: boolean; view: GameState;
}) {
  const [busy, setBusy] = useState(false);
  const click = async (a: WotrAction) => { setBusy(true); try { await onAction(a); } finally { setBusy(false); } };

  if (gameOver) {
    return <div style={panel}><h3>Game over</h3><p>{view.winner === 'fp' ? 'Free Peoples' : 'Shadow'} wins — {view.winReason}</p></div>;
  }
  if (!yourTurn) return <div style={panel}>Waiting for the other player…</div>;

  // Combat/hunt decisions are handled by the DecisionModal; this list is the
  // ordinary action menu (the caller filters those out before passing actions).
  return (
    <div style={panel}>
      {actions.map((a, i) => <ActionButton key={i} action={a} disabled={busy} onClick={() => click(a)} />)}
      {actions.length === 0 && <div style={{ color: '#999' }}>No actions.</div>}
    </div>
  );
}

// A normal action button. For "Play event" it shows the card-art thumbnail (when
// downloaded) so the player sees what they're playing, not just the title.
function ActionButton({ action, disabled, onClick }: { action: WotrAction; disabled: boolean; onClick: () => void }) {
  const cardId = action.kind === 'playEvent' ? action.cardId : null;
  const art = useCardArt(cardId);
  if (art) {
    return (
      <button disabled={disabled} onClick={onClick} style={{ ...btn, display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src={art} alt="" style={{ height: 48, borderRadius: 3, flexShrink: 0 }} />
        <span>{describeAction(action)}</span>
      </button>
    );
  }
  return <button disabled={disabled} onClick={onClick} style={btn}>{describeAction(action)}</button>;
}

const panel: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 12, background: '#211c14', color: '#eee', fontFamily: 'system-ui' };
const btn: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', margin: '3px 0', padding: '7px 10px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
