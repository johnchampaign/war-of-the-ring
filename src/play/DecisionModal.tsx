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

const CARD = new Map<string, any>((eventCards as { cards: any[] }).cards.map((c) => [c.id, c]));
const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;
const cardName = (id: string): string => CARD.get(id)?.name ?? id;
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
  whiteRider: 'The White Rider — forfeit Gandalf’s Leadership to negate all Nazgûl Leadership?',
  balrog: 'Balrog of Moria — discard it to draw an extra Hunt tile?',
  crebain: 'Flocks of Crebain — discard for +1 to all Hunt dice this roll?',
  bonusDraw: 'The Palantír of Orthanc — draw a card?',
  guideDraw: 'Gandalf the Grey — draw a card?',
  sorcererDraw: 'The Witch-king’s Sorcery — draw a card?',
  lureChoice: 'Lure of the Ring — the Ring tempts a Companion',
  removeExcess: 'Over the 10-unit stacking limit — remove the excess',
};

export function DecisionModal({ view, you, actions, onAction, yourTurn }: {
  view: GameState; you: Side; actions: WotrAction[]; onAction: (a: WotrAction) => void; yourTurn: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [hoverCard, setHoverCard] = useState<string | null>(null);
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
        {choice?.kind === 'removeExcess' && <RemoveExcessDetail view={view} data={(choice as any).data} />}

        {mine ? (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {decisions.map((a, i) => <DecisionButton key={i} action={a} disabled={busy} onClick={() => click(a)} onHover={setHoverCard} />)}
            </div>
            <CardBlurb id={hoverCard} />
          </>
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

function RemoveExcessDetail({ view, data }: { view: GameState; data?: { region?: string } }) {
  const region = data?.region;
  if (!region) return null;
  const r = view.regions[region];
  const total = r ? Object.values(r.units).reduce((n, u) => n + u!.regular + u!.elite, 0) : 0;
  const over = Math.max(0, total - 10);
  return (
    <div style={{ fontSize: 13, color: '#e9b', margin: '4px 0 2px' }}>
      <b>{rName(region)}</b> holds {total} units (limit 10). Choose <b>{over}</b> unit{over === 1 ? '' : 's'} to remove —
      they return to reinforcements and can be recruited again later.
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

function DecisionButton({ action, disabled, onClick, onHover }: { action: WotrAction; disabled: boolean; onClick: () => void; onHover?: (id: string | null) => void }) {
  // Combat-card choices get the card thumbnail (the combat box is on the event card).
  const cardId = action.kind === 'playCombatCard' ? action.cardId : null;
  const art = useCardArt(cardId);
  const hov = cardId && onHover ? { onMouseEnter: () => onHover(cardId), onMouseLeave: () => onHover(null) } : {};
  return (
    <button onClick={onClick} disabled={disabled} style={dbtn} {...hov}>
      {art && <img src={art} alt="" style={{ height: 56, borderRadius: 3, display: 'block', marginBottom: 4 }} />}
      {describeAction(action)}
    </button>
  );
}

// Describes the hovered combat card (its Combat box is what matters here, plus the
// Event text for context) inside the modal, since the modal covers the inspector.
function CardBlurb({ id }: { id: string | null }) {
  const def = id ? CARD.get(id) : null;
  return (
    <div style={blurb}>
      {def ? (
        <>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{def.name} <span style={{ color: '#aa9', fontWeight: 400 }}>· {def.side} · init {def.initiative ?? '–'}</span></div>
          {def.combat?.title && <div style={{ fontSize: 12, margin: '3px 0' }}><b>Combat — {def.combat.title}:</b> {def.combat.text}</div>}
          {def.eventText && <div style={{ fontSize: 12, color: '#c9c2ad', margin: '3px 0' }}><b>Event:</b> {def.eventText}</div>}
        </>
      ) : (
        <span style={{ color: '#776', fontStyle: 'italic' }}>Hover a card to read its effect.</span>
      )}
    </div>
  );
}

// Anchor near the top (not vertically centred) so the card blurb growing on hover
// extends the modal DOWNWARD instead of re-centring it — otherwise the buttons slide
// out from under the cursor and you can't click them.
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.72)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '7vh', boxSizing: 'border-box', zIndex: 50 };
const modal: React.CSSProperties = { background: '#211c14', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 12, border: '1px solid #5a4a2a', maxWidth: 560, maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 8px 40px #000' };
const dbtn: React.CSSProperties = { background: '#7a1f1f', color: '#fff', border: '1px solid #944', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', fontSize: 13, minWidth: 110 };
// Reserve enough height for a typical combat card so the modal barely changes size on
// hover (the top-anchor already keeps the buttons fixed even if it does grow).
const blurb: React.CSSProperties = { marginTop: 10, padding: '8px 10px', background: '#1a160f', border: '1px solid #3a342a', borderRadius: 6, minHeight: 96, color: '#e9e1cc' };
