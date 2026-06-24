// Focused overlay for the "you must decide now" moments the engine pauses on:
// an interactive battle (combat-card play, casualty choice, continue/retreat) and
// the Hunt damage choice. These are the PendingChoice kinds the combat/hunt
// sub-machines emit; surfacing them as a modal (instead of buried buttons) makes
// the mid-resolution decisions legible. The modal only shows for the player who
// owns the choice; the opponent sees a passive "resolving battle…" note.
import { useState } from 'react';
import { describeAction, isDecisionAction } from './actionText';
import { RollLine, CorruptionLine, describeDraw, HuntTileFace } from './huntView';
import { HuntInfoModal } from './HuntInfoModal';
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
  preCombatRetreat: 'Retreat before combat — choose a destination',
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
  stormcrowLoss: 'Stormcrow — choose a unit to eliminate',
  breakingSep: 'The Breaking of the Fellowship — choose a Companion to separate',
  discardCard: 'Over the 6-card hand limit — choose a card to discard',
};

export function DecisionModal({ view, you, actions, onAction, yourTurn, undo }: {
  view: GameState; you: Side; actions: WotrAction[]; onAction: (a: WotrAction) => void; yourTurn: boolean;
  // When set, an Undo control is shown INSIDE the modal — the modal's backdrop
  // otherwise covers the status-bar Undo button, so a decision (e.g. Gandalf's
  // "draw a card?") would trap the player with no way to back out.
  undo?: { foreknowledge: boolean; onUndo: () => void };
}) {
  const [busy, setBusy] = useState(false);
  const [hoverCard, setHoverCard] = useState<string | null>(null);
  const [huntInfo, setHuntInfo] = useState(false);
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
        {choice?.kind === 'huntDamage' && <HuntDetail view={view} data={(choice as any).data} onExplain={() => setHuntInfo(true)}
          modes={decisions.filter((a) => a.kind === 'huntDamage').map((a) => (a as Extract<WotrAction, { kind: 'huntDamage' }>).mode)} />}
        {huntInfo && <HuntInfoModal view={view} onClose={() => setHuntInfo(false)} />}
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
        {undo && (
          <div style={{ marginTop: 12, borderTop: '1px solid #3a342a', paddingTop: 8, textAlign: 'right' }}>
            <button onClick={undo.onUndo} disabled={busy}
              title={undo.foreknowledge ? 'Undo back past this — you will have seen a random outcome (recorded)' : 'Undo your last action'}
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                background: undo.foreknowledge ? '#4a3a1a' : '#2c3a2c', color: undo.foreknowledge ? '#ffe08a' : '#cfe6c0',
                border: `1px solid ${undo.foreknowledge ? '#7a5f24' : '#3a5a3a'}` }}>
              ↶ Undo{undo.foreknowledge ? ' (reveals info)' : ''}
            </button>
          </div>
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

// The FULL Hunt context behind the damage decision, EXPLAINED step by step (not
// just numbers): where the dice came from, how many hit, what that drew, and why
// the damage is the tile's value (not the success count) — so the choice isn't
// made blind to what produced it. A link opens the full "how the Hunt works"
// dialog with every modifier.
function HuntDetail({ view, data, modes, onExplain }: { view: GameState; data?: { damage?: number; reveal?: boolean }; modes: string[]; onExplain: () => void }) {
  if (!data) return null;
  const draws = view.hunt.draws ?? [];
  const last = draws.length ? draws[draws.length - 1] : undefined;
  const roll = last?.roll ?? view.hunt.lastRoll ?? undefined;
  const numericTile = last && typeof last.value === 'number' && last.value > 0;
  const fieldRoll = roll && !roll.mordor;
  return (
    <div style={{ margin: '4px 0 2px' }}>
      {fieldRoll && (
        <div style={{ fontSize: 13, color: '#cbbf9a', marginBottom: 6 }}>
          The Shadow rolled <b>{roll!.level}</b> Hunt {roll!.level === 1 ? 'die' : 'dice'} — one per die in the Hunt&nbsp;Box
          {roll!.bonus ? <>, each <b>+{roll!.bonus}</b> from Free&nbsp;Peoples dice in the box</> : null}. A die hits on <b>6+</b>.
        </div>
      )}
      {roll && <RollLine roll={roll} />}
      {fieldRoll && (
        <div style={{ fontSize: 12, color: '#998', margin: '6px 0 0' }}>
          Modifiers: {roll!.bonus ? `+${roll!.bonus} box bonus` : 'no box bonus'};{' '}
          {roll!.rerolls.length
            ? `${roll!.rerolls.length} re-roll${roll!.rerolls.length === 1 ? '' : 's'} (a Shadow Stronghold / Army / Nazgûl with the Ring-bearers)`
            : 'no re-rolls'}.
        </div>
      )}
      {last && (
        <div style={{ margin: '8px 0 0' }}>
          <div style={{ fontSize: 13, color: '#e9b', marginBottom: 4 }}>
            {fieldRoll ? 'A success draws one Hunt tile — you drew:' : 'Tile drawn:'}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <HuntTileFace draw={last} />
            <div style={{ fontSize: 12, color: '#998', alignSelf: 'center' }}>
              {describeDraw(last)}.
              {numericTile && <> The damage is the <b>tile's value</b>, not the number of successes.</>}
            </div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 13, color: '#e9b', margin: '4px 0 0' }}>
        Hunt damage <b>{data.damage ?? '?'}</b>. Choose how the Ring-bearers absorb it.
      </div>
      {data.reveal && (
        <div style={{ margin: '6px 0 0', padding: '7px 9px', background: '#5a1f1f', border: '1px solid #a83232', borderRadius: 8, fontSize: 12.5, lineHeight: 1.45 }}>
          🔴 This tile <b>reveals the Fellowship</b> — that happens <b>no matter which option you pick</b>.
          {modes.includes('reduceReveal') && <> So <b>“Reveal the Fellowship (−1 damage)”</b> costs you nothing extra here (you're revealed either way) and saves 1 Corruption.</>}
        </div>
      )}
      <CorruptionLine current={view.fellowship.corruption} add={data.damage} />
      <button onClick={onExplain} style={{ marginTop: 6, fontSize: 12, background: 'none', border: 'none', color: '#9bb0c8', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
        ⓘ How the Hunt works
      </button>
    </div>
  );
}

function DecisionButton({ action, disabled, onClick, onHover }: { action: WotrAction; disabled: boolean; onClick: () => void; onHover?: (id: string | null) => void }) {
  // Card-referencing choices (play a Combat card, or pick a card to discard) get the
  // card thumbnail + hover preview so you can read what you're choosing.
  const cardId = action.kind === 'playCombatCard' ? action.cardId : action.kind === 'discardCard' ? action.card : null;
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
          {def.combat?.title && <div style={{ fontSize: 12, margin: '3px 0' }}>
            <b>Combat — {def.combat.title}:</b>{' '}
            {def.combat.precondition && <span style={req}>[{def.combat.precondition}] </span>}{def.combat.text}
          </div>}
          {(def.precondition || def.eventText) && <div style={{ fontSize: 12, color: '#c9c2ad', margin: '3px 0' }}>
            <b>Event:</b>{' '}
            {def.precondition && <span style={req}>[{def.precondition}] </span>}{def.eventText}
          </div>}
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
// "Play if…" requirement — amber italic so the precondition reads as a condition to
// check, distinct from the effect text (so you can judge a card before discarding it).
const req: React.CSSProperties = { color: '#d8b48c', fontStyle: 'italic' };
