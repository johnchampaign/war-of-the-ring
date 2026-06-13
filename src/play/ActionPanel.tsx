// Renders the current player's legal actions as labeled buttons. The UI only ever
// offers actions the engine returned (illegal moves are impossible to attempt).
import { useState } from 'react';
import type { WotrAction } from '../adapter/wotrAction';
import type { GameState } from '../engine/types';
import mapData from '../../assets/map.json';
import eventCards from '../../assets/event-cards.json';

const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;
const cardName = (id: string): string => (eventCards as any).cards.find((c: any) => c.id === id)?.name ?? id;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeAction(a: WotrAction): string {
  switch (a.kind) {
    case 'skipFellowshipPhase': return 'Skip the Fellowship phase';
    case 'declareFellowship': return `Declare Fellowship (toward ${rName(a.target)})`;
    case 'enterMordor': return 'Enter Mordor';
    case 'allocateHunt': return `Allocate ${a.dice} Hunt ${a.dice === 1 ? 'die' : 'dice'}`;
    case 'moveFellowship': return 'Move the Fellowship';
    case 'hideFellowship': return 'Hide the Fellowship';
    case 'separateCompanion': return `Separate ${cap(a.companion)}`;
    case 'bringUpgrade': return a.which === 'aragorn' ? 'Crown Aragorn (Will of the West)' : 'Summon Gandalf the White';
    case 'drawEvent': return `Draw a ${a.deck} Event card`;
    case 'playEvent': return `Play "${cardName(a.cardId)}"`;
    case 'diplomaticAction': return `Diplomacy: advance ${cap(a.nation)}`;
    case 'recruitUnit': return `Recruit ${cap(a.nation)} in ${rName(a.region)}`;
    case 'bringMinion': return `Bring ${a.minion} into play`;
    case 'moveArmy': return `Move army ${rName(a.from)} → ${rName(a.to)}`;
    case 'attack': return `Attack ${rName(a.to)} (from ${rName(a.from)})`;
    case 'skipDie': return `Discard a ${a.face} die`;
    case 'pass': return 'Pass';
    case 'playCombatCard': return a.cardId ? `Combat card: ${cardName(a.cardId)}` : 'No combat card';
    case 'chooseCasualties': return a.plan === 'regularsFirst' ? 'Lose Regulars first' : 'Reduce Elites first';
    case 'combatContinue': return a.cont ? 'Continue the attack' : 'Cease the attack';
    case 'combatRetreat': return a.retreat ? 'Retreat' : 'Stand and fight';
    case 'huntDamage': return a.mode === 'corruption' ? 'Take Corruption' : a.mode === 'guide' ? 'Sacrifice the Guide' : 'Sacrifice a random Companion';
    default: return JSON.stringify(a);
  }
}

const PRIORITY = new Set(['playCombatCard', 'chooseCasualties', 'combatContinue', 'combatRetreat', 'huntDamage']);

export function ActionPanel({ actions, onAction, yourTurn, gameOver, view }: {
  actions: WotrAction[]; onAction: (a: WotrAction) => void; yourTurn: boolean; gameOver: boolean; view: GameState;
}) {
  const [busy, setBusy] = useState(false);
  const click = async (a: WotrAction) => { setBusy(true); try { await onAction(a); } finally { setBusy(false); } };

  if (gameOver) {
    return <div style={panel}><h3>Game over</h3><p>{view.winner === 'fp' ? 'Free Peoples' : 'Shadow'} wins — {view.winReason}</p></div>;
  }
  if (!yourTurn) return <div style={panel}>Waiting for the other player…</div>;

  const choice = view.pendingChoice;
  const priority = actions.filter((a) => PRIORITY.has(a.kind));
  const normal = actions.filter((a) => !PRIORITY.has(a.kind));

  return (
    <div style={panel}>
      {choice && <div style={{ fontWeight: 700, marginBottom: 6 }}>Decision: {choice.kind}</div>}
      {priority.length > 0 && <div style={{ marginBottom: 8 }}>{priority.map((a, i) => (
        <button key={i} disabled={busy} onClick={() => click(a)} style={{ ...btn, background: '#7a1f1f' }}>{describeAction(a)}</button>
      ))}</div>}
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {normal.map((a, i) => (
          <button key={i} disabled={busy} onClick={() => click(a)} style={btn}>{describeAction(a)}</button>
        ))}
        {actions.length === 0 && <div style={{ color: '#999' }}>No actions.</div>}
      </div>
    </div>
  );
}

const panel: React.CSSProperties = { width: 320, padding: 12, background: '#211c14', color: '#eee', fontFamily: 'system-ui', overflow: 'hidden' };
const btn: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', margin: '3px 0', padding: '7px 10px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 5, cursor: 'pointer', fontSize: 13 };
