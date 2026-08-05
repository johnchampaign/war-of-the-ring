#!/usr/bin/env node
// merge-play-via.mjs — Bake each event card's PLAY-VIA icon (the die type printed in
// the card's upper corner) into assets/event-cards.json. Re-runnable.
//
// Rulebook p.21-22: a Character die plays a *Character* Event card, an Army die an
// *Army* Event card, a Muster die a *Muster* Event card; an Event (Palantír) die
// plays any card regardless of type. Before this table the engine approximated the
// icon from the DECK, which conflated the Army and Muster icons inside the Strategy
// decks (a Muster-icon card was wrongly playable with an Army die and vice versa).
//
// Source: the War of the Ring Almanac's card index, which prints the icon letter and
// collector number for every base-game card ("Paths of the Woses" A 11, "Threats and
// Promises" M 5, "Nazgûl Search" C 9). Transcribed here so the merge is reproducible
// without the (gitignored, publisher-owned) PDF. All 48 Character-deck cards carry
// the Character icon; the Strategy decks split Army/Muster.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** id -> die face that can play the card besides an Event/Palantír die. */
const PLAY_VIA = {
  'fp-char-01': 'character',      // Elven Cloaks
  'fp-char-02': 'character',      // Elven Rope
  'fp-char-03': 'character',      // Phial of Galadriel
  'fp-char-04': 'character',      // Smeagol Helps Nice Master
  'fp-char-05': 'character',      // Mithril Coat and Sting
  'fp-char-06': 'character',      // Axe and Bow
  'fp-char-07': 'character',      // Horn of Gondor
  'fp-char-08': 'character',      // Wizard's Staff
  'fp-char-09': 'character',      // Athelas
  'fp-char-10': 'character',      // There is Another Way
  'fp-char-11': 'character',      // I Will Go Alone
  'fp-char-12': 'character',      // Bilbo's Song
  'fp-char-13': 'character',      // Mirror of Galadriel
  'fp-char-14': 'character',      // Challenge of the King
  'fp-char-15': 'character',      // Gwaihir the Windlord
  'fp-char-16': 'character',      // We Prove the Swifter
  'fp-char-17': 'character',      // There and Back Again
  'fp-char-18': 'character',      // The Eagles are Coming!
  'fp-char-19': 'character',      // The Ents Awake: Treebeard
  'fp-char-20': 'character',      // The Ents Awake: Huorns
  'fp-char-21': 'character',      // The Ents Awake: Entmoot
  'fp-char-22': 'character',      // Dead Men of Dunharrow
  'fp-char-23': 'character',      // House of the Stewards
  'fp-char-24': 'character',      // The Grey Company
  'fp-str-01': 'army',            // The Last Battle
  'fp-str-02': 'army',            // A Power too Great
  'fp-str-03': 'army',            // The Power of Tom Bombadil
  'fp-str-04': 'muster',          // Book of Mazarbul
  'fp-str-05': 'army',            // The Spirit of Mordor
  'fp-str-06': 'army',            // Faramir's Rangers
  'fp-str-07': 'muster',          // Fear! Fear! Foes!
  'fp-str-08': 'muster',          // Wisdom of Elrond
  'fp-str-09': 'muster',          // The Red Arrow
  'fp-str-10': 'army',            // Help Unlooked For
  'fp-str-11': 'army',            // Paths of the Woses
  'fp-str-12': 'army',            // Through a Day and a Night
  'fp-str-13': 'muster',          // Cirdan's Ships
  'fp-str-14': 'muster',          // Guards of the Citadel
  'fp-str-15': 'muster',          // Celeborn's Galadhrim
  'fp-str-16': 'muster',          // Riders of Theoden
  'fp-str-17': 'muster',          // Grimbeorn the Old, Son of Beorn
  'fp-str-18': 'muster',          // Imrahil of Dol Amroth
  'fp-str-19': 'muster',          // King Brand's Men
  'fp-str-20': 'muster',          // Swords in Eriador
  'fp-str-21': 'muster',          // Kindred of Glorfindel
  'fp-str-22': 'muster',          // Dain Ironfoot's Guard
  'fp-str-23': 'muster',          // Eomer, Son of Eomund
  'fp-str-24': 'muster',          // Thranduil's Archers
  'sh-char-01': 'character',      // Shelob's Lair
  'sh-char-02': 'character',      // The Ring is Mine!
  'sh-char-03': 'character',      // On, On They Went
  'sh-char-04': 'character',      // Give it to Uss!
  'sh-char-05': 'character',      // Orc Patrol
  'sh-char-06': 'character',      // Isildur's Bane
  'sh-char-07': 'character',      // Foul Thing from the Deep
  'sh-char-08': 'character',      // Candles of Corpses
  'sh-char-08b': 'character',     // The Nazgul Strike!
  'sh-char-09': 'character',      // Nazgul Search
  'sh-char-10': 'character',      // Cruel Weather
  'sh-char-12': 'character',      // Morgul Wound
  'sh-char-13': 'character',      // Lure of the Ring
  'sh-char-14': 'character',      // The Breaking of the Fellowship
  'sh-char-15': 'character',      // Worn with Sorrow and Toil
  'sh-char-16': 'character',      // Flocks of Crebain
  'sh-char-17': 'character',      // Balrog of Moria
  'sh-char-18': 'character',      // The Lidless Eye
  'sh-char-19': 'character',      // Dreadful Spells
  'sh-char-20': 'character',      // Grond, Hammer of the Underworld
  'sh-char-21': 'character',      // The Palantir of Orthanc
  'sh-char-22': 'character',      // Wormtongue
  'sh-char-23': 'character',      // The Ringwraiths Are Abroad
  'sh-char-24': 'character',      // The Black Captain Commands
  'sh-str-01': 'army',            // Return to Valinor
  'sh-str-02': 'army',            // The Fighting Uruk-hai
  'sh-str-03': 'army',            // Denethor's Folly
  'sh-str-04': 'army',            // The Day Without Dawn
  'sh-str-05': 'muster',          // Threats and Promises
  'sh-str-06': 'muster',          // Stormcrow
  'sh-str-07': 'army',            // Shadows Gather
  'sh-str-08': 'army',            // The Shadow Lengthens
  'sh-str-09': 'army',            // The Shadow is Moving
  'sh-str-10': 'army',            // Corsairs of Umbar
  'sh-str-11': 'muster',          // Rage of the Dunlendings
  'sh-str-12': 'muster',          // Return of the Witch-king
  'sh-str-13': 'army',            // Half-orcs and Goblin-men
  'sh-str-14': 'army',            // Olog-hai
  'sh-str-15': 'army',            // Hill-Trolls
  'sh-str-16': 'muster',          // A New Power is Rising
  'sh-str-17': 'muster',          // Many Kings to the Service of Mordor
  'sh-str-18': 'muster',          // The King is Revealed
  'sh-str-19': 'muster',          // Shadows on the Misty Mountains
  'sh-str-20': 'muster',          // Orcs Multiplying Again
  'sh-str-21': 'muster',          // Hordes From the East
  'sh-str-22': 'muster',          // Monsters Roused
  'sh-str-23': 'muster',          // Musterings of Long-planned War
  'sh-str-24': 'muster',          // Pits of Mordor
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const path = join(repoRoot, 'assets', 'event-cards.json');
const ec = JSON.parse(readFileSync(path, 'utf8'));

const missing = [];
for (const c of ec.cards) {
  const via = PLAY_VIA[c.id];
  if (!via) { missing.push(c.id); continue; }
  c.playableVia = via;
}
if (missing.length) throw new Error(`No play-via icon for: ${missing.join(', ')}`);

ec._meta.playableViaNote = "playableVia is the die face printed in the card's upper corner — the non-Event die that can play it (rulebook p.21-22). Transcribed from the Almanac card index by merge-play-via.mjs; every card is ALSO playable with an Event/Palantir die (and, for the Free Peoples, a Will of the West).";
writeFileSync(path, JSON.stringify(ec, null, 2) + '\n');
console.log(`playableVia set on ${ec.cards.length} cards.`);
