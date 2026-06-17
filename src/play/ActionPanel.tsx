// Renders the current player's legal actions as labeled buttons. The UI only ever
// offers actions the engine returned (illegal moves are impossible to attempt).
import { useState } from 'react';
import type { WotrAction } from '../adapter/wotrAction';
import type { GameState } from '../engine/types';
import { useCardArt } from './artCache';
import { describeAction, actionDie, dieOptions } from './actionText';
import { FACE } from './DiceTray';
import type { Hover } from './HoverPreview';
import type { Side, DieFace } from '../engine/types';

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

export function ActionPanel({ actions, onAction, onHover, yourTurn, gameOver, view, you, boardActions = 0, selectedDie, onClearDie, compact }: {
  actions: WotrAction[]; onAction: (a: WotrAction) => void; onHover?: (h: Hover) => void; yourTurn: boolean; gameOver: boolean; view: GameState; you: Side | null; boardActions?: number; selectedDie?: DieFace | null; onClearDie?: () => void; compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const click = async (a: WotrAction) => { setBusy(true); try { await onAction(a); } finally { setBusy(false); } };

  if (gameOver) {
    return <div style={panel}><h3>Game over</h3><p>{view.winner === 'fp' ? 'Free Peoples' : 'Shadow'} wins — {view.winReason}</p></div>;
  }
  if (!yourTurn) return <div style={panel}>Waiting for the other player…</div>;

  // Pass is promoted to a prominent top button (Ira #8) so it's never lost in the list.
  const pass = actions.find((a) => a.kind === 'pass');
  const rest = actions.filter((a) => a.kind !== 'pass');
  const sel = selectedDie ?? null;
  const faceLabel = sel ? (FACE[sel]?.label ?? sel) : null;

  // Combat/hunt decisions are handled by the DecisionModal; this list is the
  // ordinary action menu (the caller filters those out before passing actions).
  return (
    <div style={panel}>
      {sel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 6px', fontSize: 12, color: '#e8dcb8' }}>
          <span>Actions for the <DieTag face={sel} /> die:</span>
          <button onClick={onClearDie} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #5a4a2a', color: '#cb8', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>← show all dice</button>
        </div>
      )}
      {pass && (
        <button disabled={busy} onClick={() => click(pass)}
          style={{ display: 'block', width: '100%', textAlign: 'center', margin: compact ? '0 0 4px' : '0 0 8px', padding: compact ? '4px 10px' : '9px 10px', background: '#4a3a1a', color: '#ffe08a', border: '1px solid #7a5f24', borderRadius: 6, cursor: 'pointer', fontSize: compact ? 12 : 14, fontWeight: 700 }}>
          Pass (do nothing this turn)
        </button>
      )}
      {/* Army moves/attacks live on the MAP (not in this list) — point the player there. */}
      {boardActions > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#23341f', border: '1px solid #4a6a3a', borderRadius: 5, padding: '6px 9px', margin: '3px 0', fontSize: 12, color: '#cfe6c0' }}>
          <span style={{ background: FACE.army.bg, color: '#fff', borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 700 }}>Army</span>
          <span>Move or attack on the map — click a <b style={{ color: '#9f9' }}>green</b> army.</span>
        </div>
      )}
      {rest.map((a, i) => <ActionButton key={i} action={a} disabled={busy} onClick={click} onHover={onHover}
        options={you ? dieOptions(a, view, you) : []} forceDie={sel} compact={compact} />)}
      {rest.length === 0 && boardActions === 0 && (
        <div style={{ color: '#999' }}>{sel ? `No ${faceLabel} actions — pick another die or Pass.` : 'No actions.'}</div>
      )}
    </div>
  );
}

// A normal action button. For "Play event" it shows the card-art thumbnail (when
// downloaded). When more than one die could pay for the action, the first click opens
// a die-picker (the player chooses which to spend); one option submits directly.
function ActionButton({ action, disabled, onClick, onHover, options, forceDie, compact }: { action: WotrAction; disabled: boolean; onClick: (a: WotrAction) => void; onHover?: (h: Hover) => void; options: DieFace[]; forceDie?: DieFace | null; compact?: boolean }) {
  const [picking, setPicking] = useState(false);
  const cardId = action.kind === 'playEvent' ? action.cardId : null;
  const art = useCardArt(cardId);
  const target = actionHover(action);
  const hov = target && onHover ? { onMouseEnter: () => onHover(target), onMouseLeave: () => onHover(null) } : {};
  const die = actionDie(action);
  // When the player has pre-selected a die that can pay for this action, spend it
  // directly (no per-action die-picker) — the choice was already made up top.
  const forced = forceDie && options.includes(forceDie) ? forceDie : null;
  const ambiguous = !forced && options.length > 1;
  const onMain = () => {
    if (forced) onClick({ ...action, die: forced } as WotrAction);
    else if (ambiguous) setPicking((p) => !p);
    else onClick(action);
  };
  const bstyle = compact ? { ...btn, margin: '1px 0', padding: '2px 9px', fontSize: 12 } : btn;
  return (
    <div>
      <button disabled={disabled} onClick={onMain} {...hov} style={{ ...bstyle, display: 'flex', alignItems: 'center', gap: 8 }}>
        {(forced ?? die) && <DieTag face={(forced ?? die)!} />}
        {art && <img src={art} alt="" style={{ height: compact ? 30 : 48, borderRadius: 3, flexShrink: 0 }} />}
        <span style={{ minWidth: 0 }}>{describeAction(action)}</span>
        {ambiguous && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#cb8' }}>choose die ▸</span>}
      </button>
      {picking && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 0 6px 10px' }}>
          <span style={{ fontSize: 11, color: '#998', alignSelf: 'center' }}>spend:</span>
          {options.map((f) => (
            <button key={f} disabled={disabled} onClick={() => { setPicking(false); onClick({ ...action, die: f } as WotrAction); }}
              style={{ cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}><DieTag face={f} /></button>
          ))}
        </div>
      )}
    </div>
  );
}

const panel: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 12, background: '#211c14', color: '#eee', fontFamily: 'system-ui' };
const btn: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', margin: '3px 0', padding: '7px 10px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
