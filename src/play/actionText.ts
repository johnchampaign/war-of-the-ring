// Pure helpers shared by the action UI: human-readable action labels and the
// decision-kind predicate. Kept in a non-component module so the component files
// (ActionPanel, DecisionModal) export only components — otherwise React Fast
// Refresh can't hot-update them ("incompatible export") and forces full reloads.
import type { WotrAction } from '../adapter/wotrAction';
import mapData from '../../assets/map.json';
import eventCards from '../../assets/event-cards.json';
import { charName } from './charInfo';

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
    case 'separateCompanion': return `Separate ${charName(a.companion)}`;
    case 'changeGuide': return `Make ${charName(a.companion)} the Guide`;
    case 'companionMuster': return `${charName(a.companion)}: advance ${cap(a.nation)} (any die)`;
    case 'useElvenRing': return `Elven Ring: change a ${cap(a.from)} die to ${a.to === 'eye' ? 'an Eye (→ Hunt Box)' : cap(a.to)}`;
    case 'sarumanMuster': return a.mode === 'upgrade'
      ? 'Voice of Saruman: upgrade 2 Orthanc Regulars to Elites'
      : 'Voice of Saruman: recruit Isengard in every Settlement';
    case 'bringUpgrade': return a.which === 'aragorn' ? 'Crown Aragorn (Will of the West)' : 'Summon Gandalf the White';
    case 'drawEvent': return `Draw a ${a.deck} Event card`;
    case 'playEvent': return `Play "${cardName(a.cardId)}"`;
    case 'diplomaticAction': return `Diplomacy: advance ${cap(a.nation)}`;
    case 'recruitUnit': {
      const parts = [a.regular ? `${a.regular} Regular${a.regular > 1 ? 's' : ''}` : '', a.elite ? `${a.elite} Elite${a.elite > 1 ? 's' : ''}` : '', a.leader ? `${a.leader} Leader${a.leader > 1 ? 's' : ''}` : ''].filter(Boolean);
      return `Recruit ${parts.join(' + ')} ${cap(a.nation)} in ${rName(a.region)}`;
    }
    case 'bringMinion': return `Bring ${charName(a.minion)} into play`;
    case 'eventTarget': {
      if (a.done) return `${cardName(a.card)}: done`;
      const dest = a.companion ? charName(a.companion) : a.to ? rName(a.to) : a.region ? rName(a.region) : 'target';
      const verb = a.mode === 'attack' ? 'attack ' : a.mode === 'move' ? 'move ' : '';
      return `${cardName(a.card)}: ${verb}${a.from ? `${rName(a.from)} → ` : ''}${dest}`;
    }
    case 'moveCharacter': return `Move ${a.char === 'nazgul' ? 'Nazgûl' : charName(a.char)} ${rName(a.from)} → ${rName(a.to)}`;
    case 'moveArmy': return `Move army ${rName(a.from)} → ${rName(a.to)}`;
    case 'attack': return `Attack ${rName(a.to)} (from ${rName(a.from)})`;
    case 'skipDie': return `Discard a ${a.face} die`;
    case 'pass': return 'Pass';
    case 'playCombatCard': return a.cardId ? `Combat card: ${cardName(a.cardId)}` : 'No combat card';
    case 'chooseCasualties': return a.plan === 'regularsFirst' ? 'Lose Regulars first' : 'Reduce Elites first';
    case 'combatContinue': return a.cont ? 'Continue the attack' : 'Cease the attack';
    case 'combatRetreat': return a.retreat ? 'Retreat' : 'Stand and fight';
    case 'retreatTo': return `Retreat to ${rName(a.region)}`;
    case 'siegeWithdraw': return a.withdraw ? 'Withdraw into the siege' : 'Fight in the open';
    case 'whiteRider': return a.forfeit ? 'Forfeit Gandalf’s Leadership (negate Nazgûl)' : 'Keep Gandalf’s Leadership';
    case 'balrog': return a.use ? 'Discard Balrog of Moria — draw an extra Hunt tile' : 'Don’t use the Balrog';
    case 'crebain': return a.use ? 'Discard Flocks of Crebain — +1 to all Hunt dice' : 'Save Flocks of Crebain';
    case 'huntDamage':
      switch (a.mode) {
        case 'corruption': return 'Take Corruption';
        case 'guide': return 'Sacrifice the Guide';
        case 'random': return 'Sacrifice a random Companion';
        case 'reduceSeparate': return 'Separate the Hobbit Guide (−1 damage)';
        case 'reduceReveal': return 'Reveal the Fellowship (−1 damage)';
        case 'reduceCard': return 'Discard a table card (−1 damage)';
      }
      return 'Resolve Hunt';
    case 'bonusDraw': return a.deck === 'none' ? 'Palantír: don’t draw' : `Palantír: draw a ${cap(a.deck)} card`;
    case 'guideDraw': return a.draw ? 'Gandalf: draw a card' : 'Gandalf: don’t draw';
    case 'sorcererDraw': return a.draw ? 'Sorcerer: draw a card' : 'Sorcerer: don’t draw';
    case 'lureChoice': return a.mode === 'corruption' ? 'Lure: take Corruption' : 'Lure: eliminate the Companion';
    case 'huntPreventDraw': return a.prevent ? 'Discard Wizard’s Staff — no Hunt tile' : 'Let the Shadow draw';
    case 'huntRedraw': return a.redraw ? 'Discard Mithril Coat — redraw the tile' : 'Keep the drawn tile';
    default: return JSON.stringify(a);
  }
}

// The mid-resolution decisions surfaced in the DecisionModal (combat + hunt),
// kept out of the plain action-button list.
const DECISION_KINDS = new Set(['playCombatCard', 'chooseCasualties', 'combatContinue', 'combatRetreat', 'retreatTo', 'siegeWithdraw', 'whiteRider', 'balrog', 'crebain', 'huntDamage', 'huntPreventDraw', 'huntRedraw', 'bonusDraw', 'guideDraw', 'sorcererDraw', 'lureChoice']);
export const isDecisionAction = (a: WotrAction): boolean => DECISION_KINDS.has(a.kind);
