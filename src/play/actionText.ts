// Pure helpers shared by the action UI: human-readable action labels and the
// decision-kind predicate. Kept in a non-component module so the component files
// (ActionPanel, DecisionModal) export only components — otherwise React Fast
// Refresh can't hot-update them ("incompatible export") and forces full reloads.
import type { WotrAction } from '../adapter/wotrAction';
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
    case 'huntDamage':
      switch (a.mode) {
        case 'corruption': return 'Take Corruption';
        case 'guide': return 'Sacrifice the Guide';
        case 'random': return 'Sacrifice a random Companion';
        case 'reduceSeparate': return 'Separate the Hobbit Guide (−1 damage)';
        case 'reduceReveal': return 'Reveal the Fellowship (−1 damage)';
      }
      return 'Resolve Hunt';
    default: return JSON.stringify(a);
  }
}

// The mid-resolution decisions surfaced in the DecisionModal (combat + hunt),
// kept out of the plain action-button list.
const DECISION_KINDS = new Set(['playCombatCard', 'chooseCasualties', 'combatContinue', 'combatRetreat', 'huntDamage']);
export const isDecisionAction = (a: WotrAction): boolean => DECISION_KINDS.has(a.kind);
