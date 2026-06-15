// Focused overlay for the "you must decide now" moments the engine pauses on:
// an interactive battle (combat-card play, casualty choice, continue/retreat) and
// the Hunt damage choice. These are the PendingChoice kinds the combat/hunt
// sub-machines emit; surfacing them as a modal (instead of buried buttons) makes
// the mid-resolution decisions legible. The modal only shows for the player who
// owns the choice; the opponent sees a passive "resolving battle…" note.
import { useState } from 'react';
import { describeAction, isDecisionAction } from './actionText';
import { useCardArt } from './artCache';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import mapData from '../../assets/map.json';
import eventCards from '../../assets/event-cards.json';

const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;
const cardName = (id: string): string => (eventCards as any).cards.find((c: any) => c.id === id)?.name ?? id;
const sideName = (s: Side) => (s === 'fp' ? 'Free Peoples' : 'Shadow');

const CHOICE_TITLE: Record<string, string> = {
  combatCard: 'Play a Combat Card?',
  combatCasualties: 'Choose your casualties',
  combatContinue: 'Continue the attack?',
  combatRetreat: 'Retreat or stand?',
  retreatTo: 'Retreat — choose a destination',
  huntDamage: 'The Hunt strikes!',
  huntPreventDraw: 'Prevent the Hunt tile draw? (you won’t see it)',
  huntRedraw: 'Redraw the Hunt tile?',
  siegeWithdraw: 'Withdraw into the siege, or fight in the open?',
  bonusDraw: 'The Palantír of Orthanc — draw a card',
  lureChoice: 'Lure of the Ring — the Ring tempts a Companion',
};

export function DecisionModal({ view, you, actions, onAction, yourTurn }: {
  view: GameState; you: Side; actions: WotrAction[]; onAction: (a: WotrAction) => void; yourTurn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const pc = view.pendingCombat;
  const choice = view.pendingChoice;
  const decisions = actions.filter(isDecisionAction);

  // Show only when there's a live decision (battle in progress, or a decision the
  // viewer owns). If a battle is up but it's the opponent's call, show a wait note.
  if (!pc && decisions.length === 0) return null;
  const mine = yourTurn && decisions.length > 0;

  const click = async (a: WotrAction) => { setBusy(true); try { await onAction(a); } finally { setBusy(false); } };

  return (
    <div style={backdrop}>
      <div style={modal}>
        {pc && <CombatHeader pc={pc} />}
        {choice && <div style={{ fontSize: 16, fontWeight: 700, margin: '10px 0 4px' }}>{CHOICE_TITLE[choice.kind] ?? choice.kind}</div>}
        {choice?.kind === 'huntDamage' && <HuntDetail data={(choice as any).data} />}
        {choice?.kind === 'huntRedraw' && <TileDetail tile={(choice as any).data?.tile} />}

        {mine ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {decisions.map((a, i) => <DecisionButton key={i} action={a} disabled={busy} onClick={() => click(a)} />)}
          </div>
        ) : (
          <div style={{ color: '#cc9', marginTop: 12 }}>Waiting for {sideName(pc ? (choice?.owner ?? pc.attacker) : you)} to decide…</div>
        )}
      </div>
    </div>
  );
}

function CombatHeader({ pc }: { pc: NonNullable<GameState['pendingCombat']> }) {
  return (
    <div style={{ borderBottom: '1px solid #443', paddingBottom: 8 }}>
      <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1 }}>
        {pc.fortified ? '⚔ Siege' : '⚔ Battle'} — Round {pc.round + 1}
      </div>
      <div style={{ fontSize: 15, marginTop: 2 }}>
        <b style={{ color: pc.attacker === 'fp' ? '#7fb6e6' : '#e6857f' }}>{sideName(pc.attacker)}</b> attacks{' '}
        <b>{rName(pc.to)}</b> <span style={{ color: '#998' }}>(from {rName(pc.from)})</span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
        <Hits label="Attacker hits" n={pc.atkHits} />
        <Hits label="Defender hits" n={pc.defHits} />
      </div>
      {(pc.attackerCard || pc.defenderCard) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          {pc.attackerCard && <PlayedCard id={pc.attackerCard} who="Attacker" />}
          {pc.defenderCard && <PlayedCard id={pc.defenderCard} who="Defender" />}
        </div>
      )}
    </div>
  );
}

function Hits({ label, n }: { label: string; n: number }) {
  return <div style={{ fontSize: 12, color: '#bba' }}>{label}: <b style={{ color: n ? '#e88' : '#9a9' }}>{n}</b></div>;
}

function PlayedCard({ id, who }: { id: string; who: string }) {
  const art = useCardArt(id);
  return (
    <div style={{ fontSize: 11, color: '#aa9', textAlign: 'center' }}>
      <div>{who}: {cardName(id)}</div>
      {art && <img src={art} alt={cardName(id)} style={{ height: 80, borderRadius: 3, marginTop: 2 }} />}
    </div>
  );
}

function TileDetail({ tile }: { tile?: { value: number | string; reveal?: boolean; stop?: boolean } }) {
  if (!tile) return null;
  const dmg = typeof tile.value === 'number' ? `${tile.value} Hunt damage`
    : tile.value === 'eye' ? 'an Eye (Shadow draws Hunt dice for damage)' : 'a die — rolled for damage';
  return (
    <div style={{ fontSize: 13, color: '#e9b', margin: '4px 0 2px' }}>
      You drew: <b>{dmg}</b>{tile.reveal ? ' · Reveal' : ''}{tile.stop ? ' · Stop' : ''}. Redraw it, or keep it?
    </div>
  );
}

function HuntDetail({ data }: { data?: { damage?: number; reveal?: boolean } }) {
  if (!data) return null;
  return (
    <div style={{ fontSize: 13, color: '#e9b', margin: '4px 0 2px' }}>
      Hunt damage: <b>{data.damage ?? '?'}</b>{data.reveal ? ' · the Fellowship will be revealed' : ''}.
      Choose how the Ring-bearers absorb it.
    </div>
  );
}

function DecisionButton({ action, disabled, onClick }: { action: WotrAction; disabled: boolean; onClick: () => void }) {
  // Combat-card choices get the card thumbnail (the combat box is on the event card).
  const cardId = action.kind === 'playCombatCard' ? action.cardId : null;
  const art = useCardArt(cardId);
  return (
    <button onClick={onClick} disabled={disabled} style={dbtn}>
      {art && <img src={art} alt="" style={{ height: 56, borderRadius: 3, display: 'block', marginBottom: 4 }} />}
      {describeAction(action)}
    </button>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.72)', display: 'grid', placeItems: 'center', zIndex: 50 };
const modal: React.CSSProperties = { background: '#211c14', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 12, border: '1px solid #5a4a2a', maxWidth: 560, boxShadow: '0 8px 40px #000' };
const dbtn: React.CSSProperties = { background: '#7a1f1f', color: '#fff', border: '1px solid #944', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', fontSize: 13, minWidth: 110 };
