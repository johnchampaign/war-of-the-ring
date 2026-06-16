// Renders the current player's legal actions as labeled buttons. The UI only ever
// offers actions the engine returned (illegal moves are impossible to attempt).
import { useState } from 'react';
import type { WotrAction } from '../adapter/wotrAction';
import type { GameState } from '../engine/types';
import { useCardArt } from './artCache';
import { describeAction, actionDie } from './actionText';
import { FACE } from './DiceTray';
import type { Hover } from './HoverPreview';

/** Small colour-coded chip marking which action die this action spends (matches the
 *  DiceTray colours), so the cost is visible at a glance. */
function DieTag({ face }: { face: string }) {
  const f = FACE[face] ?? { label: face, bg: '#555' };
  return <span style={{ background: f.bg, color: '#fff', borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{f.label}</span>;
}

/** What an action references for the hover inspector (a Companion/Minion or a card). */
function actionHover(a: WotrAction): Hover {
  if ((a.kind === 'changeGuide' || a.kind === 'separateCompanion' || a.kind === 'companionMuster') && a.companion) return { kind: 'character', id: a.companion };
  if (a.kind === 'eventTarget' && a.companion) return { kind: 'character', id: a.companion };
  if (a.kind === 'bringMinion') return { kind: 'character', id: a.minion };
  if (a.kind === 'playEvent') return { kind: 'card', id: a.cardId };
  return null;
}

export function ActionPanel({ actions, onAction, onHover, yourTurn, gameOver, view }: {
  actions: WotrAction[]; onAction: (a: WotrAction) => void; onHover?: (h: Hover) => void; yourTurn: boolean; gameOver: boolean; view: GameState;
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
      {actions.map((a, i) => <ActionButton key={i} action={a} disabled={busy} onClick={() => click(a)} onHover={onHover} />)}
      {actions.length === 0 && <div style={{ color: '#999' }}>No actions.</div>}
    </div>
  );
}

// A normal action button. For "Play event" it shows the card-art thumbnail (when
// downloaded) so the player sees what they're playing, not just the title.
function ActionButton({ action, disabled, onClick, onHover }: { action: WotrAction; disabled: boolean; onClick: () => void; onHover?: (h: Hover) => void }) {
  const cardId = action.kind === 'playEvent' ? action.cardId : null;
  const art = useCardArt(cardId);
  const target = actionHover(action);
  const hov = target && onHover ? { onMouseEnter: () => onHover(target), onMouseLeave: () => onHover(null) } : {};
  const die = actionDie(action);
  return (
    <button disabled={disabled} onClick={onClick} {...hov} style={{ ...btn, display: 'flex', alignItems: 'center', gap: 8 }}>
      {die && <DieTag face={die} />}
      {art && <img src={art} alt="" style={{ height: 48, borderRadius: 3, flexShrink: 0 }} />}
      <span style={{ minWidth: 0 }}>{describeAction(action)}</span>
    </button>
  );
}

const panel: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 12, background: '#211c14', color: '#eee', fontFamily: 'system-ui' };
const btn: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', margin: '3px 0', padding: '7px 10px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
