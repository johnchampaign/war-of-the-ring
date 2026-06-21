// The action vocabulary — one variant per player decision the engine surfaces.
// (First playable slice: Fellowship/Hunt + dice spending. Army/combat/muster/
// event-play actions are added in later increments.)
import type { Deck, DieFace, Nation, RegionId } from '../engine/types';

/** A split-move figure selection: only these figures move (rulebook p.27). */
export type MoveSel = {
  units?: Partial<Record<Nation, { regular?: number; elite?: number }>>;
  leaders?: number;
  nazgul?: number;
  characters?: string[];
};

export type WotrAction =
  // Fellowship phase (FP) — one action ends the phase.
  | { kind: 'skipFellowshipPhase' }
  | { kind: 'declareFellowship'; target: RegionId }
  // Where the Ring-bearers figure moves when the Hunt reveals the Fellowship (FP's
  // choice, up to Progress; never an FP City/Stronghold). Resolves a 'revealMove' choice.
  | { kind: 'revealMove'; target: RegionId }
  | { kind: 'enterMordor' }
  // Hunt Allocation phase (Shadow).
  | { kind: 'allocateHunt'; dice: number }
  // Action Resolution (current player) — each consumes one die unless noted. `die`
  // (optional) is the player's explicit pick of WHICH die to spend when more than one
  // would do (the die-picker); omitted = the engine auto-picks (specific die first,
  // preserving Will of the West).
  | { kind: 'moveFellowship'; die?: DieFace }   // FP, Character die
  | { kind: 'hideFellowship'; die?: DieFace }   // FP, Character die (Strider: any die)
  | { kind: 'separateCompanion'; companion: string; die?: DieFace }
  // Board-click destination for the Companion being separated (within Progress+Level).
  // Separating a group: `companion` (no target) ADDS that Companion to the group;
  // `target` (no companion) PLACES the whole group at that region.
  | { kind: 'separateMove'; companion?: string; target?: RegionId }
  | { kind: 'changeGuide'; companion: string } // Fellowship phase: pick the Guide (FP breaks Level ties)
  | { kind: 'companionMuster'; companion: string; nation: Nation; die?: DieFace } // companion ability: any die advances their Nation
  | { kind: 'sarumanMuster'; mode: 'recruit' | 'upgrade'; die?: DieFace } // Voice of Saruman: recruit in every Isengard Settlement, or upgrade 2 Orthanc Regulars to Elites
  | { kind: 'bringUpgrade'; which: 'aragorn' | 'gandalf-white' } // FP, Will of the West
  | { kind: 'drawEvent'; deck: Deck; die?: DieFace } // Event die
  | { kind: 'playEvent'; cardId: string; die?: DieFace } // Event die: play a card from hand
  | { kind: 'diplomaticAction'; nation: Nation; die?: DieFace } // Muster die: advance political track
  // Muster die: place the FIRST figure of a recruit. `then` (when present) means a
  // second figure of that type follows — placed in a SEPARATE Settlement via the
  // 'recruitSecond' choice (rules-spec §6). Exactly one of regular/elite/leader/nazgul is 1.
  | { kind: 'recruitUnit'; nation: Nation; region: RegionId; regular: number; elite: number; leader?: number; nazgul?: number; then?: 'regular' | 'leader'; die?: DieFace }
  // The second figure of a two-figure muster (separate Settlement), or decline it.
  | { kind: 'recruitSecond'; nation?: Nation; region?: RegionId; figure?: 'regular' | 'leader'; done?: boolean }
  | { kind: 'bringMinion'; minion: 'witch-king' | 'saruman' | 'mouth-of-sauron'; region: RegionId; die?: DieFace } // Muster die (Shadow)
  // Army die (may move a 2nd army via armyMove2). `move` (when present) is a SPLIT:
  // only the listed figures move, the rest stay behind (rulebook p.27).
  | { kind: 'moveArmy'; from: RegionId; to: RegionId; move?: MoveSel; die?: DieFace }
  // The optional SECOND army move of one Army die (a different army), or decline it.
  | { kind: 'armyMove2'; from?: RegionId; to?: RegionId; move?: MoveSel; done?: boolean }
  // Resolve an over-the-10-limit merge: pick one excess figure to remove (rulebook p.26).
  | { kind: 'removeExcess'; nation: Nation; figure: 'regular' | 'elite' }
  // Army die. `rearguard` (optional) is the split: figures left OUT of the battle
  // (rulebook p.28). Not-At-War units are forced into the rearguard automatically.
  | { kind: 'attack'; from: RegionId; to: RegionId; rearguard?: MoveSel; die?: DieFace }
  | { kind: 'skipDie'; face: DieFace } // discard a die, no effect
  | { kind: 'pass' }             // yield to opponent, no die spent
  // Interactive combat sub-machine (resolving a PendingChoice).
  | { kind: 'playCombatCard'; cardId: string | null } // play a combat card (or none)
  | { kind: 'chooseCasualties'; plan: 'regularsFirst' | 'elitesFirst' }
  | { kind: 'combatContinue'; cont: boolean }  // attacker: continue or cease
  | { kind: 'combatRetreat'; retreat: boolean } // defender: retreat or stand
  | { kind: 'retreatTo'; region: RegionId }     // defender: chosen retreat destination
  | { kind: 'siegeWithdraw'; withdraw: boolean } // defender: withdraw into the siege or fight
  | { kind: 'whiteRider'; forfeit: boolean } // FP: forfeit Gandalf the White's Leadership to negate Nazgûl Leadership
  | { kind: 'balrog'; use: boolean } // Shadow: discard Balrog of Moria to draw an extra Hunt tile
  | { kind: 'crebain'; use: boolean } // Shadow: discard Flocks of Crebain for +1 to all Hunt dice this roll
  | { kind: 'useElvenRing'; from: DieFace; to: DieFace } // change one unused die's face via an Elven Ring
  // Move an independent character via a Character die: 'nazgul' (a region's
  // Nazgûl group), a Minion id, or a separated Companion id.
  // `count` (Nazgûl only) moves part of a stack; omit to move the whole group.
  | { kind: 'moveCharacter'; char: string; from: RegionId; to: RegionId; die?: DieFace; count?: number }
  // Stop the Character-die move chain (RAW: one die may move all eligible characters).
  | { kind: 'charMove2'; done: true }
  // Follow-up target choice for an interactive event card (fields per card).
  | { kind: 'eventTarget'; card: string; from?: RegionId; to?: RegionId; region?: RegionId; nation?: Nation; companion?: string; mode?: 'move' | 'attack' | 'hide' | 'none' | 'recruit'; figure?: 'regular' | 'elite'; slot?: number; eye?: boolean; done?: boolean }
  // Stormcrow (FP responds): choose which unit of the targeted Nation to eliminate.
  | { kind: 'stormcrowLoss'; region: RegionId; nation: Nation; figure: 'regular' | 'elite' }
  // The Breaking of the Fellowship (FP responds): choose which Companion to separate.
  | { kind: 'breakingSep'; companion: string }
  // Over the 6-card hand limit: choose which Event card to discard (to its deck).
  | { kind: 'discardCard'; card: string }
  // Palantír of Orthanc bonus draw (Shadow): a deck to draw from, or 'none' to decline.
  | { kind: 'bonusDraw'; deck: 'character' | 'strategy' | 'none' }
  // Gandalf the Grey Guide draw (FP): take the matching-deck card, or decline.
  | { kind: 'guideDraw'; draw: boolean }
  // Witch-king Sorcerer draw (Shadow): take the matching-deck card after a combat card, or decline.
  | { kind: 'sorcererDraw'; draw: boolean }
  // Lure of the Ring (FP responds): take Corruption equal to the Companion's Level, or eliminate him.
  | { kind: 'lureChoice'; mode: 'corruption' | 'eliminate' }
  // Hunt damage resolution (FP): absorb as Corruption, lose a Companion, or use a
  // damage-reduction ability (separate the Hobbit Guide / Gollum reveal).
  | { kind: 'huntDamage'; mode: 'corruption' | 'guide' | 'random' | 'reduceSeparate' | 'reduceReveal' | 'reduceCard' }
  // On-table Hunt interceptions (FP): Wizard's Staff (prevent the draw) and
  // Mithril Coat (redraw the drawn tile).
  | { kind: 'huntPreventDraw'; prevent: boolean }
  | { kind: 'huntRedraw'; redraw: boolean };
