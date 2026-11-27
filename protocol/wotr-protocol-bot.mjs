// A client of the WotR Bot Protocol (draft 0.1, https://github.com/behindmedia/wotr-protocol) for this game's AI:
// the heuristic `chooseAction` of src/ai/wotrAI.ts plays through any referee that speaks the protocol (another rules
// engine that runs the game, rolls the dice and draws the cards, and at each decision sends the deciding bot its view
// and the closed list of legal options; the bot answers with one option).
//
//   node protocol/wotr-protocol-bot.mjs                               # stdin/stdout: the referee's child process
//   node protocol/wotr-protocol-bot.mjs --connect wss://HOST/referee --token-file KEY [--reconnect] [--seek JSON]
//
// Needs Node 22.18 or later (it imports src/ as TypeScript with Node's own type stripping) and `npm ci`. No other
// dependency: the WebSocket client is built in (below). Changes no file of the game; adds no rules.
//
// How it works. The referee's rules are the authority. This engine follows the game in lock step: every choice of
// either side that the referee reports (the event stream) becomes this engine's action and is applied here, with the
// referee's dice, Hunt tiles and card draws fed into the framework Rng while it runs. At each of the bot's decisions
// outside any battle, Hunt or card (an Action, the Fellowship phase, the Hunt allocation, a hand-limit discard) the
// state is rebuilt from the referee's view instead, so nothing drifts for long. The AI then chooses from its side's
// redacted view as on the site; its action becomes the referee's option, step by step (the referee asks an Army move
// as the die, then the Army and its destination, then the units if not all). Where this engine asks nothing the
// referee asks, or the two engines part (a rules difference), the question gets a plain default answer, counted in
// the log. Every answer is one of the referee's options.
//
// Options: --connect URL, --token TOKEN or --token-file FILE (a match's seat token or an online bot's key),
// --reconnect (dial again after a drop, for good: an online bot), --seek JSON (the games an online bot takes, sent in
// its hello), --name NAME, --version-label TEXT (the version its hello gives), --seed N (the AI's tie-breaks; else
// each game's seed_bot), --chooser standard|eval|humanlike (which of his choosers: standard, the site's heuristic
// chooseAction; eval, his 1-ply evaluator chooseActionEval of src/ai/evalChooser.ts; humanlike, his scripted human-like
// Free Peoples chooseActionHumanlike of src/ai/humanlikeFP.ts, the heuristic as the Shadow), --verbose (every decision
// on stderr), --root DIR (the game's checkout; default: this file's parent folder). MIT, like the repository.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { randomBytes, createHash } from 'node:crypto';

const PROTOCOL = 'wotr-bot/0.1';
const NAME = "John Champaign's War of the Ring AI";

// --- Command line ---------------------------------------------------------------------------------------------------

// His choosers (src/ai/): the site's heuristic, his 1-ply evaluator and his human-like Free Peoples (the Shadow: the heuristic).
const CHOOSERS = ['standard', 'eval', 'humanlike'];

function parseArgs(argv) {
  const o = { connect: null, token: null, tokenFile: null, reconnect: false, seek: null, name: NAME, versionLabel: null, seed: null, chooser: 'standard', verbose: false, root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    switch (a) {
      case '--connect': o.connect = next(); break;
      case '--token': o.token = next(); break;
      case '--token-file': o.tokenFile = next(); break;
      case '--reconnect': o.reconnect = true; break;
      case '--seek': o.seek = JSON.parse(next()); break;
      case '--name': o.name = next(); break;
      case '--version-label': o.versionLabel = next(); break;
      case '--seed': o.seed = Number(next()); break;
      case '--chooser': o.chooser = next(); if (!CHOOSERS.includes(o.chooser)) throw new Error(`--chooser: ${CHOOSERS.join(', ')}, not ${o.chooser}`); break;
      case '--verbose': o.verbose = true; break;
      case '--root': o.root = next(); break;
      case '-h': case '--help':
        process.stderr.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 26).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default: throw new Error(`Unknown option ${a}`);
    }
  }
  return o;
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
let verbose = false;
const log = (...parts) => process.stderr.write(`${stamp()} ${parts.join(' ')}\n`);
const debug = (...parts) => { if (verbose) log(...parts); };

// --- The game's modules, imported as they are -----------------------------------------------------------------------
// src/ imports without extensions ("./types") and imports JSON without import attributes, as a bundler allows. Two
// hooks make plain Node do the same for files of this checkout; Node strips the TypeScript types itself.

let E = null; // the engine's modules, once loaded

export async function loadEngine(rootDir, chooser = 'standard') {
  if (E) return E;
  const root = resolvePath(rootDir ?? resolvePath(dirname(fileURLToPath(import.meta.url)), '..'));
  if (!existsSync(`${root}/src/adapter/wotrAdapter.ts`)) throw new Error(`${root} is not this game's checkout (no src/adapter/wotrAdapter.ts)`);
  const rootUrl = pathToFileURL(root).href;
  // Under a bundler's runner (vite-node, for the probe scripts) the imports resolve already: no hooks needed.
  if (!import.meta.env) {
    registerHooks({
      resolve(specifier, context, next) {
        if ((specifier.startsWith('.') || specifier.startsWith('/')) && context.parentURL?.startsWith(rootUrl)) {
          const path = fileURLToPath(new URL(specifier, context.parentURL));
          const isFile = existsSync(path) && statSync(path).isFile();
          if (!isFile) {
            for (const ext of ['.ts', '/index.ts']) {
              if (existsSync(path + ext)) return { url: pathToFileURL(path + ext).href, shortCircuit: true };
            }
          }
        }
        return next(specifier, context);
      },
      load(url, context, next) {
        if (url.startsWith(rootUrl) && url.endsWith('.json')) {
          return { format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')};`, shortCircuit: true };
        }
        return next(url, context);
      },
    });
  }
  // Under vite-node a plain path: it does not decode a file URL, so a checkout whose path holds a space ("%20") fails
  // to load there. Plain Node gets the URL.
  const mod = (p) => import(/* @vite-ignore */ import.meta.env ? `${root}/${p}` : pathToFileURL(`${root}/${p}`).href);
  const [adapter, redact, ai, data, dice, phases, setup, types, framework, combat] = await Promise.all([
    mod('src/adapter/wotrAdapter.ts'), mod('src/adapter/redact.ts'), mod('src/ai/wotrAI.ts'), mod('src/engine/data.ts'),
    mod('src/engine/dice.ts'), mod('src/engine/phases.ts'), mod('src/engine/setup.ts'), mod('src/engine/types.ts'),
    import('digital-boardgame-framework'), mod('src/engine/combat.ts'),
  ]);
  // The chooser (--chooser): his other two are imported only when asked for.
  let chooseAction = ai.chooseAction;
  if (chooser === 'eval') chooseAction = (await mod('src/ai/evalChooser.ts')).chooseActionEval;
  else if (chooser === 'humanlike') chooseAction = (await mod('src/ai/humanlikeFP.ts')).chooseActionHumanlike;
  if (typeof chooseAction !== 'function') throw new Error(`the game has no chooser ${chooser}`);
  E = {
    root, wotrAdapter: adapter.wotrAdapter, redact: redact.redactStateForViewer, chooseAction, chooser,
    data, dice, phases, createGame: setup.createGame, FP_NATIONS: types.FP_NATIONS, SHADOW_NATIONS: types.SHADOW_NATIONS,
    Rng: framework.Rng, followOptions: combat.followOptions, fpRegularCasualties: combat.fpRegularCasualties,
  };
  installRandomness();
  buildNames();
  return E;
}

// --- Names: the protocol's vocabulary against this engine's ids ----------------------------------------------------

export const N = {}; // filled by buildNames

function buildNames() {
  const { data } = E;
  const side = { FREE_PEOPLES: 'fp', SHADOW: 'shadow' };
  const nation = { DWARVES: 'dwarves', ELVES: 'elves', GONDOR: 'gondor', NORTH: 'north', ROHAN: 'rohan', ISENGARD: 'isengard', SAURON: 'sauron', SOUTHRONS_EASTERLINGS: 'southrons' };
  const face = { CHARACTER: 'character', ARMY: 'army', MUSTER: 'muster', ARMY_MUSTER: 'armyMuster', EVENT: 'event', WILL_OF_THE_WEST: 'will', EYE: 'eye' };
  const regionAlias = { 'northern-rovanion': 'northern-rhovanion', 'southern-rovanion': 'southern-rhovanion' };
  const charAlias = { 'gandalf-the-grey': 'gandalf-grey', 'gandalf-the-white': 'gandalf-white' };
  // Cards: the protocol's key is side, deck and printed number (fp-char-01, sh-strat-24); this catalog's ids are the
  // same with "str" for "strat", except one card numbered apart here.
  const cardAlias = { 'sh-char-11': 'sh-char-08b' };
  const cards = {};
  for (const s of ['fp', 'sh']) for (const d of ['char', 'strat']) for (let i = 1; i <= 24; i++) {
    const key = `${s}-${d}-${String(i).padStart(2, '0')}`;
    const id = cardAlias[key] ?? key.replace('-strat-', '-str-');
    if (!data.EVENT_BY_ID[id]) throw new Error(`No card ${id} for the protocol's ${key}`);
    cards[key] = id;
  }
  // Hunt tiles: the protocol's standard tiles in its order against the indices of STANDARD_TILE_LIST.
  const std = ['eye-1', 'eye-2', 'eye-3', 'eye-4', '3-1', '3-2', '3-3', '2-1', '2-2', '2r', '1-1', '1-2', '1r-1', '1r-2', '0r-1', '0r-2'];
  const label = (t) => `${t.value}${t.reveal ? 'r' : ''}`;
  const want = (k) => (k.startsWith('eye') ? 'eyer' : k.replace(/-\d$/, ''));
  const used = new Set();
  const tiles = {};
  for (const k of std) {
    const i = data.STANDARD_TILE_LIST.findIndex((t, j) => !used.has(j) && label(t) === want(k));
    if (i < 0) throw new Error(`No standard Hunt tile for ${k}`);
    used.add(i); tiles[k] = i;
  }
  const specials = {
    'elven-cloaks': 'fp-char-01', 'elven-rope': 'fp-char-02', 'phial-of-galadriel': 'fp-char-03', 'smeagol-helps-nice-master': 'fp-char-04',
    'shelobs-lair': 'sh-char-01', 'the-ring-is-mine': 'sh-char-02', 'on-on-they-went': 'sh-char-03', 'give-it-to-uss': 'sh-char-04',
  };
  for (const [k, card] of Object.entries(specials)) if (!data.SPECIAL_TILE_BY_CARD[card]) throw new Error(`No special Hunt tile for ${k}`);
  const back = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));
  Object.assign(N, {
    side: (s) => side[s] ?? s, pSide: (s) => back(side)[s],
    nation: (n) => nation[n] ?? n, pNation: (n) => back(nation)[n] ?? n,
    face: (f) => face[f] ?? f, pFace: (f) => back(face)[f] ?? f,
    region: (r) => regionAlias[r] ?? r, pRegion: (r) => back(regionAlias)[r] ?? r,
    char: (c) => charAlias[c] ?? c, pChar: (c) => back(charAlias)[c] ?? c,
    card: (c) => cards[c] ?? c, pCard: (c) => back(cards)[c] ?? c,
    stdTile: tiles, stdTileBack: back(tiles), special: specials, specialBack: back(specials),
    tile: (k) => (k in tiles ? tiles[k] : specials[k]),
    deck: (cardId) => (data.EVENT_BY_ID[cardId]?.deck === 'Character' ? 'character' : 'strategy'),
  });
}

// --- Randomness: while a step of the game runs here, its dice, tiles and picks are the referee's -------------------
// All randomness of the engine goes through the framework's Rng: rollDie(6) for every d6, pick(faces) for the Action
// dice, pick(...) of Companions or cards for random casualties, int(n) for a Hunt tile. While `forcing`, they answer
// from queues the referee's events fill; a draw with nothing queued means the referee has not drawn it yet: the step
// waits ("held") and runs again once it has.

const queues = { d6: [], faces: [], tiles: [], picks: [] };
const cardQueue = []; // { side, deck, card } (card null: a card of the opponent's, not shown)
let forcing = false;
let draws = [];
let tileState = null;
let probing = null;
// While `lenient`, a d6 or a card draw the referee never made (a rules difference: this engine rolls more dice for a
// card, draws a card the referee does not) is made up instead of waited for: a miss, the top of the pile.
let lenient = false;
let madeUp = 0;
class NeedsChance extends Error {}

function installRandomness() {
  const { Rng, dice } = E;
  const original = { int: Rng.prototype.int, rollDie: Rng.prototype.rollDie, pick: Rng.prototype.pick };
  const take = (queue, what) => {
    if (!queues[queue].length) {
      if (lenient && queue === 'd6') { madeUp++; return 1; }
      throw new NeedsChance(`this engine asks for ${what}, but the referee drew nothing more`);
    }
    return queues[queue].shift();
  };
  Rng.prototype.rollDie = function (sides) {
    if (!forcing) return original.rollDie.call(this, sides);
    if (sides !== 6) throw new NeedsChance(`a d${sides}`);
    const v = take('d6', 'a d6');
    draws.push({ kind: 'd6', value: v });
    return v;
  };
  Rng.prototype.pick = function (arr) {
    if (!forcing) return original.pick.call(this, arr);
    if (arr === dice.FP_DIE_FACES || arr === dice.SHADOW_DIE_FACES) {
      const f = take('faces', 'an Action die');
      const i = arr.indexOf(f);
      if (i < 0) throw new NeedsChance(`an Action die face ${f} that these dice do not have`);
      draws.push({ kind: 'face', value: f });
      return arr[i];
    }
    const want = take('picks', `a random pick from [${arr.join(', ')}]`);
    let i = arr.indexOf(want);
    // A random card of the opponent's hand that the referee names: one of the stand-ins here (swapped in below).
    if (i < 0 && typeof want === 'object' && want?.anyOf) i = arr.findIndex((x) => want.anyOf.includes(x));
    if (i < 0) throw new NeedsChance(`a random pick from [${arr.join(', ')}], but the referee picked ${JSON.stringify(want)}`);
    draws.push({ kind: 'pick', value: arr[i] });
    return arr[i];
  };
  Rng.prototype.int = function (n) {
    if (!forcing) return original.int.call(this, n);
    // Only the Hunt tile draw calls int directly here (rollDie and pick are replaced; shuffle runs at setup only).
    const want = take('tiles', 'a Hunt tile');
    const h = tileState.hunt;
    let i;
    if (typeof want === 'number') i = h.pool.indexOf(want);
    else { i = h.specialsInPool.indexOf(want); if (i >= 0) i += h.pool.length; }
    if (i < 0 || i >= n) throw new NeedsChance(`a Hunt tile, but the referee's tile ${want} is not in the pool [${h.pool.join(',')}] + [${h.specialsInPool.join(',')}]`);
    draws.push({ kind: 'tile', value: want });
    return i;
  };
  // The adapter's applyAction clones the state with JSON.parse(JSON.stringify(...)); the tile hook reads the Hunt Pool
  // of that clone, and a probe records the die an action spends on it.
  const parse = JSON.parse;
  class SpendRecorder extends Array {
    push(...items) { probing?.spent.push(...items); return super.push(...items); }
  }
  JSON.parse = function (text, reviver) {
    const r = parse(text, reviver);
    if (r && typeof r === 'object' && r.hunt && r.regions && r.fellowship) {
      if (forcing && tileState === null) tileState = r;
      if (probing && !probing.captured) {
        probing.captured = true;
        for (const s of ['fp', 'shadow']) r.usedDice[s] = SpendRecorder.from(r.usedDice[s] ?? []);
      }
    }
    return r;
  };
}

function clearQueues() {
  for (const k of Object.keys(queues)) queues[k].length = 0;
  cardQueue.length = 0;
}
const saveQueues = () => ({ q: Object.fromEntries(Object.entries(queues).map(([k, v]) => [k, [...v]])), c: [...cardQueue] });
function restoreQueues(saved) {
  for (const k of Object.keys(queues)) { queues[k].length = 0; queues[k].push(...saved.q[k]); }
  cardQueue.length = 0; cardQueue.push(...saved.c);
}

// Card draws: the engine takes the top of a draw pile, so the referee's cards go on top, in order, before each step.
function stackPiles(s) {
  for (const side of ['fp', 'shadow']) for (const deck of ['character', 'strategy']) {
    const want = cardQueue.filter((c) => c.side === side && c.deck === deck && c.card).map((c) => c.card);
    if (!want.length) continue;
    const pile = s.cards[side].draw[deck];
    s.cards[side].draw[deck] = [...want.filter((c) => pile.includes(c)), ...pile.filter((c) => !want.includes(c))];
  }
}

function dropDrawn(before, after) {
  for (const side of ['fp', 'shadow']) for (const deck of ['character', 'strategy']) {
    const now = new Set(after.cards[side].draw[deck]);
    for (const c of before.cards[side].draw[deck]) {
      if (now.has(c)) continue;
      let i = cardQueue.findIndex((q) => q.card === c);
      if (i < 0) i = cardQueue.findIndex((q) => q.side === side && q.deck === deck && !q.card);
      if (i >= 0) cardQueue.splice(i, 1);
    }
  }
}
/** A card the engine drew (from `before` to `after`) that the referee has not drawn: a draw not made there yet. */
function unqueuedDraw(before, after) {
  const left = [...cardQueue];
  for (const side of ['fp', 'shadow']) for (const deck of ['character', 'strategy']) {
    const now = new Set(after.cards[side].draw[deck]);
    for (const c of before.cards[side].draw[deck]) {
      if (now.has(c)) continue;
      let i = left.findIndex((q) => q.card === c);
      if (i < 0) i = left.findIndex((q) => q.side === side && q.deck === deck && !q.card);
      if (i < 0) return `${side} ${deck} card ${c}`;
      left.splice(i, 1);
    }
  }
  return null;
}

// --- The state from the referee's view ------------------------------------------------------------------------------

const MINIONS_AND_UPGRADES = ['aragorn', 'gandalf-white', 'witch-king', 'saruman', 'mouth-of-sauron', 'gollum'];
const PHASES = { RECOVER: 'recover', FELLOWSHIP: 'fellowship', HUNT_ALLOCATION: 'huntAllocation', ACTION_ROLL: 'actionRoll', ACTION_RESOLUTION: 'actionResolution', VICTORY_CHECK: 'victoryCheck' };

/**
 * This engine's state for the referee's `view` (the viewer's knowledge): the board, the Fellowship, politics, dice,
 * Hunt, cards. The opponent's hidden cards (hand, face-down discards, draw piles) are stand-ins: unseen cards of the
 * right deck, which the AI never reads (its view hides them, as on the site). `flags` are the per-turn flags the view
 * does not carry, from the event stream; `planRoll` the Shadow AI's campaign roll.
 */
export function stateFromView(view, flags = {}, planRoll = 0) {
  const { data, createGame, FP_NATIONS, SHADOW_NATIONS } = E;
  const s = createGame({ seed: 1 });
  const viewer = N.side(view.viewer);
  const other = viewer === 'fp' ? 'shadow' : 'fp';
  // Regions: the besieged side's figures are in the siege box, the besieger's in the region.
  for (const id of data.REGION_IDS) {
    const r = view.regions[N.pRegion(id)];
    const reg = { units: {}, leaders: 0, nazgul: 0, characters: [], control: null, besieged: false };
    if (r) {
      const besieged = r.siege ? N.side(r.siege) : null;
      const box = besieged ? { units: {}, leaders: 0, nazgul: 0, characters: [] } : null;
      for (const u of r.units) {
        const n = N.nation(u.nation);
        const into = besieged && data.sideOfNation(n) === besieged ? box : reg;
        if (u.unit === 'regular' || u.unit === 'elite') (into.units[n] ??= { regular: 0, elite: 0 })[u.unit] += u.n;
        else if (u.unit === 'leader') into.leaders += u.n;
        else if (u.unit === 'nazgul') into.nazgul += u.n;
      }
      for (const c of r.characters) {
        if (c === 'ring-bearers') continue;
        const id2 = N.char(c);
        (besieged && data.characterSide(id2) === besieged ? box : reg).characters.push(id2);
      }
      const def = data.REGIONS[id];
      const ctrl = r.control ? N.side(r.control) : null;
      const owner = def.nation ? data.sideOfNation(def.nation) : null;
      reg.control = !def.settlement || ctrl === owner ? null : ctrl;
      if (besieged) { reg.besieged = true; reg.siegeBox = box; }
    }
    s.regions[id] = reg;
  }
  for (const n of [...FP_NATIONS, ...SHADOW_NATIONS]) {
    const p = view.politics[N.pNation(n)];
    s.nations[n] = { step: p.step, active: p.active };
    const r = view.reinforcements[N.pNation(n)];
    s.reinforcements[n] = { regular: r.regular, elite: r.elite, leader: r.leader ?? 0, ...(n === 'sauron' ? { nazgul: r.nazgul ?? 0 } : {}) };
  }
  const f = view.fellowship;
  s.fellowship = {
    location: N.region(f.region), progress: f.progress, hidden: f.hidden, corruption: f.corruption,
    companions: f.companions.map(N.char).filter((c) => c !== 'gollum'), guide: N.char(f.guide), mordor: f.mordor ?? null,
  };
  s.characters = { inPlay: {}, eliminated: [], entered: [] };
  for (const [c, info] of Object.entries(view.characters)) {
    if (c === 'ring-bearers') continue;
    const id = N.char(c);
    if (info.where === 'region' && info.region) s.characters.inPlay[id] = N.region(info.region);
    if (info.where === 'eliminated') s.characters.eliminated.push(id);
    if (MINIONS_AND_UPGRADES.includes(id) && info.where !== 'not_in_play') s.characters.entered.push(id);
  }
  // Dice: the dice that moved the Fellowship are in the Hunt Box (fpDiceInBox) and among the used ones here.
  for (const side of ['fp', 'shadow']) {
    const ds = view.dice[N.pSide(side)] ?? [];
    s.dice[side] = ds.filter((d) => d.status === 'available' && d.face).map((d) => N.face(d.face));
    s.usedDice[side] = ds.filter((d) => (d.status === 'used' || (side === 'fp' && d.status === 'hunt_box')) && d.face).map((d) => N.face(d.face));
  }
  const h = view.hunt;
  const std = (zone) => (h[zone] ?? []).filter((k) => k in N.stdTile).map((k) => N.stdTile[k]);
  const spec = (zone) => (h[zone] ?? []).filter((k) => k in N.special).map((k) => N.special[k]);
  s.hunt = {
    box: h.box?.SHADOW ?? 0, fpDiceInBox: h.box?.FREE_PEOPLES ?? 0,
    pool: std('pool'), drawn: std('drawn'), specialsInPlay: spec('ready'), specialsInPool: spec('pool'), specialsDrawn: spec('drawn'),
  };
  const rings = view.elven_rings ?? {};
  s.elvenRings = [...Array(rings.FREE_PEOPLES ?? 0).fill('fp'), ...Array(rings.SHADOW ?? 0).fill('shadow')];
  while (s.elvenRings.length < 3) s.elvenRings.push('used');
  // Cards.
  const vc = view.cards;
  const byDeck = (ids) => ({ character: ids.filter((c) => N.deck(c) === 'character'), strategy: ids.filter((c) => N.deck(c) === 'strategy') });
  const mine = vc.hand.map(N.card), mineDown = vc.discarded_face_down.map(N.card);
  const discards = { fp: (vc.discards.FREE_PEOPLES ?? []).map(N.card), shadow: (vc.discards.SHADOW ?? []).map(N.card) };
  const table = { fp: (vc.on_table.FREE_PEOPLES ?? []).map(N.card), shadow: (vc.on_table.SHADOW ?? []).map(N.card) };
  {
    const known = new Set([...mine, ...mineDown, ...discards[viewer], ...table[viewer]]);
    s.cards[viewer] = {
      draw: { character: data.deckOf(viewer, 'character').filter((c) => !known.has(c)).sort(), strategy: data.deckOf(viewer, 'strategy').filter((c) => !known.has(c)).sort() },
      hand: mine, discard: byDeck(discards[viewer]), discardFaceDown: mineDown, table: table[viewer],
    };
  }
  {
    const known = new Set([...discards[other], ...table[other]]);
    const handBy = vc.opponent_hand_by_deck ?? {};
    const deckBy = vc.decks?.[N.pSide(other)] ?? {};
    const hand = [], down = [], draw = { character: [], strategy: [] };
    for (const deck of ['character', 'strategy']) {
      const unseen = data.deckOf(other, deck).filter((c) => !known.has(c)).sort();
      const nh = Math.min(handBy[deck] ?? 0, unseen.length);
      hand.push(...unseen.slice(0, nh));
      const nd = Math.min(deckBy[deck] ?? 0, unseen.length - nh);
      draw[deck] = unseen.slice(nh, nh + nd);
      down.push(...unseen.slice(nh + nd));
    }
    s.cards[other] = { draw, hand, discard: byDeck(discards[other]), discardFaceDown: down, table: table[other] };
  }
  s.victoryPoints = { fp: view.victory_points?.FREE_PEOPLES ?? 0, shadow: view.victory_points?.SHADOW ?? 0 };
  s.turn = view.turn;
  s.phase = PHASES[view.phase] ?? 'actionResolution';
  s.currentPlayer = N.side(view.active_side ?? view.to_act ?? 'FREE_PEOPLES');
  const used = view.elven_ring_used ?? {};
  s.flags = {
    fellowshipDeclaredOrMovedThisTurn: !!flags.fellowshipActed,
    fpUsedElvenRingThisTurn: !!used.FREE_PEOPLES,
    shadowUsedElvenRingThisTurn: !!used.SHADOW,
    huntMin1ThisTurn: !!h.shadow_must_hunt,
    mouthMusterUsedThisTurn: !!flags.messengerUsed,
    fellowshipDeclaredThisTurn: !!flags.declared,
    ...(flags.freeCharEvent ? { fpFreeCharEventThisTurn: true } : {}),
  };
  // The Free Peoples Regular casualties as the referee counts them: this engine derives them from its figure totals.
  casualtyOffset = {};
  E.followOptions.fpCasualtyOffset = null;
  for (const n of FP_NATIONS) {
    const derived = E.fpRegularCasualties(s, n);
    const real = view.casualties?.[N.pNation(n)]?.regular ?? derived;
    if (derived !== real) casualtyOffset[n] = derived - real;
  }
  s.shadowPlanRoll = planRoll;
  s.pendingChoice = null;
  s.pendingCombat = null;
  s.winner = null;
  s.winReason = null;
  s.log = [];
  s.notices = [];
  return s;
}

// --- The engine, step by step ---------------------------------------------------------------------------------------

/** Who decides what in `s`: the actor, the open choice's kind, the phase, the battle step, the legal actions. */
function pendingOf(s) {
  const { wotrAdapter } = E;
  const actor = wotrAdapter.currentActor(s);
  return {
    actor, kind: s.pendingChoice?.kind ?? null, phase: s.phase, step: s.pendingCombat?.step ?? null,
    legal: actor ? asFollowed(() => wotrAdapter.legalActions(s, actor)) : [], winner: s.winner,
  };
}

// While it follows the referee's game, his engine plays by the followed rules where they differ from its own
// (followOptions in src/engine/data.ts, each off in his own play; the comments there say what each changes):
// - askEveryCombatCard: every Combat card question asked, also of a side with no card (the referee's hidden passes:
//   new_game official_rules, hidden_passes not false);
// - ownSideLeadership: only a side's own Characters lend its Army Leadership (a Companion of no Nation standing with
//   a Shadow Army counted for the Shadow's re-roll);
// - scoutsIntoSiege: Scouts may withdraw into a siege, as its card says;
// - nazgulStrikeAsPrinted: The Nazgûl Strike!'s "may" is asked, and its Hunt is a Hunt roll;
// - rageStacksAfter: Rage of the Dunlendings moves its units whatever the stacking limit, the excess removed after;
// - everyNazgul: the "move any or all of the Nazgûl" cards have room for every Nazgûl;
// - forfeitedLeadership: Mighty Attack forfeits the chosen Companion's Leadership (forfeit, from the referee's answer);
// - countedRecruits: Many Kings / Pits of Mordor place the count the referee's player chose;
// - musterOverLimit: a Muster die may recruit into a full region, the excess removed after the action;
// - selfHitsAll: a Combat card's hits on its own Army may take all of it;
// - dreadfulFrom: Dreadful Spells is cast by the Army the referee's answer names;
// - hitsBeforeReroll: Mighty Attack's miss turned into a hit before the Leader re-roll, as its card says;
// - fpCasualtyOffset: the Free Peoples Regular casualties as the referee counts them (casualtyOffset, at a rebuild);
// - reduceAlways: an Elite may be reduced for one hit with no Regular to replace it (eliminated), as the referee offers;
// - noEffectChoices: a card's choice with no effect is offered (Wisdom of Elrond's Nation At War already);
// - printedCardRolls: Combat cards' rolls as printed (We Come to Kill's 5+, Mûmakil counting pre-Combat hits);
// - sarumanRecruitIn, playAsPlayed, revealStrongholds: set for one step only (the Voice of Saruman's Settlements, a
//   card played as the referee played it, the reveal path's Strongholds as the referee's option counts them).
let followHidden = false;
/** His engine's switches for following the referee's game (above): on while applying a step or listing its actions. */
function following(on) {
  E.followOptions.askEveryCombatCard = on && followHidden;
  E.followOptions.ownSideLeadership = on;
  E.followOptions.scoutsIntoSiege = on;
  E.followOptions.nazgulStrikeAsPrinted = on;
  E.followOptions.rageStacksAfter = on;
  E.followOptions.everyNazgul = on;
  E.followOptions.forfeitedLeadership = on ? forfeit : null;
  E.followOptions.countedRecruits = on;
  E.followOptions.musterOverLimit = on;
  E.followOptions.selfHitsAll = on;
  E.followOptions.dreadfulFrom = on;
  E.followOptions.hitsBeforeReroll = on;
  E.followOptions.fpCasualtyOffset = on ? casualtyOffset : null;
  E.followOptions.reduceAlways = on;
  E.followOptions.noEffectChoices = on;
  E.followOptions.printedCardRolls = on;
}
// Per Nation, the Free Peoples Regular casualties this engine derives beyond the referee's count (set at a rebuild).
let casualtyOffset = null;
// Mighty Attack's Companion forfeiting his Leadership this round, as the referee's answer named him (collapseCard).
let forfeit = null;
// The Action dice as the referee numbers them (the last view's): the Day Without Dawn's "Which die becomes an Eye?".
let viewDice = null;
// The battle as the bot's last view shows it (its attackers): a part-Army attack's rearguard (rearguardFromView).
let battleView = null;
const EYE_QUESTION = 'Which die becomes an Eye?';
const dieFace = (side, i, dice = viewDice) => dice?.[N.pSide(side)]?.find((x) => x.die === i)?.face ?? null;
const MIGHTY_ATTACK = new Set(['fp-char-06', 'fp-char-07']);
const leadershipOf = (c) => E.data.characterDef(c)?.leadership ?? 0;
/** `fn()` with the switches on (nested calls keep them on). */
function asFollowed(fn) {
  if (E.followOptions.ownSideLeadership) return fn();
  following(true);
  try { return fn(); } finally { following(false); }
}

/** `action` by `actor` applied to `state` with the referee's outcomes: { ok, state } or { ok: false, needsChance, reason }. */
function applyForced(state, action, actor) {
  const { wotrAdapter } = E;
  const saved = saveQueues();
  following(true);
  const before = JSON.parse(JSON.stringify(state));
  stackPiles(before);
  tileState = null;
  draws = [];
  forcing = true;
  try {
    const next = wotrAdapter.applyAction(before, action, actor);
    const early = unqueuedDraw(before, next);
    if (early && !lenient) throw new NeedsChance(`this engine draws a ${early}, but the referee drew nothing more`);
    if (early) madeUp++;
    dropDrawn(before, next);
    return { ok: true, state: next, draws };
  } catch (e) {
    restoreQueues(saved);
    return { ok: false, reason: String(e?.message ?? e), needsChance: e instanceof NeedsChance };
  } finally {
    forcing = false;
    tileState = null;
    following(false);
  }
}

/** The automatic phases (src/engine/phases.ts) run on `state` with the referee's outcomes. */
function advanceForced(state) {
  const saved = saveQueues();
  following(true);
  const s = JSON.parse(JSON.stringify(state));
  const before = JSON.parse(JSON.stringify(state));
  stackPiles(s);
  tileState = s;
  draws = [];
  forcing = true;
  try {
    E.phases.advance(s);
    const early = unqueuedDraw(before, s);
    if (early && !lenient) throw new NeedsChance(`this engine draws a ${early}, but the referee drew nothing more`);
    if (early) madeUp++;
    dropDrawn(before, s);
    return { ok: true, state: s };
  } catch (e) {
    restoreQueues(saved);
    return { ok: false, reason: String(e?.message ?? e), needsChance: e instanceof NeedsChance };
  } finally {
    forcing = false;
    tileState = null;
    following(false);
  }
}

/** The die face `action` would spend, without doing it (the engine picks the die when the action names none). */
function spentFace(state, action, actor) {
  probing = { spent: [], captured: false };
  try {
    E.wotrAdapter.applyAction(state, action, actor);
    return probing.spent[0] ?? null;
  } catch {
    return null;
  } finally {
    probing = null;
  }
}

/** `action` applied without the referee's outcomes (a look ahead on a copy), or null if the engine refuses it. */
function tryAhead(state, action, actor) {
  try {
    const r = E.wotrAdapter.tryApplyAction(state, action, actor);
    return r.ok ? r.state ?? E.wotrAdapter.applyAction(state, action, actor) : null;
  } catch {
    return null;
  }
}

/** Whether `action` is `legal` or a refinement of it (all of the legal action's fields, and maybe more). */
const refines = (action, legal) => Object.entries(legal).every(([k, v]) => JSON.stringify(action[k]) === JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const act = (kind, fields = {}) => {
  const a = { kind };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) a[k] = v;
  return a;
};
const other = (side) => (side === 'fp' ? 'shadow' : 'fp');

// --- Words: card answers matched by what they name ------------------------------------------------------------------
// A referee's answer to a card's question (`card_choice`) carries `answer`, its words joined by ':' or '>'
// (`minas-tirith>osgiliath`, `grey-havens:LEADER`, `hand`, `move`), in the protocol's vocabulary. An answer of this
// engine (`eventTarget` and the like) names regions, Nations, figures, Characters, cards; the two match when the
// referee's names nothing this engine's does not.

const CARD_KINDS = new Set([
  'eventTarget', 'stormcrowLoss', 'breakingSep', 'lureChoice', 'wornDiscard', 'nazgulStrike', 'bonusDraw', 'guideDraw',
  'sorcererDraw', 'freeCharEvent', 'cardRetreat', 'eaglesRefuge', 'combatKill', 'heroicDeath', 'wordsOfPower',
  'combatCardCost', 'crebain', 'balrog', 'huntPreventDraw', 'huntRedraw', 'preCombatRetreat',
]);
const IGNORED_FIELDS = new Set(['range', 'direct', 'movable', 'rearguard', 'move', 'slot', 'die']);
const NATION_WORDS = new Set(['dwarves', 'elves', 'gondor', 'north', 'rohan', 'isengard', 'sauron', 'southrons']);
const FIGURE_WORDS = new Set(['regular', 'elite', 'leader', 'nazgul']);
const FACE_WORDS = new Set(['army', 'muster', 'armyMuster', 'event', 'will', 'eye']);
const MITHRIL = 'fp-char-05';
/** The referee's decisions a card's question here may come to. */
const CARD_FLOW = new Set(['CARD_CHOICE', 'SEPARATE_COMPANIONS', 'JOIN_GROUP', 'ARMY_SELECTION', 'MOVE_COMPANIONS', 'MOVE_MINIONS', 'ARMY_MOVE', 'CHOOSE_ATTACK', 'RECRUIT']);
const WIZARDS_STAFF = 'fp-char-08';

function word(here) {
  if (E.data.REGIONS[here]) return N.pRegion(here);
  if (NATION_WORDS.has(here)) return N.pNation(here);
  if (E.data.EVENT_BY_ID[here]) return N.pCard(here);
  if (FIGURE_WORDS.has(here)) return here.toUpperCase();
  if (here === 'character' || here === 'strategy') return here.toUpperCase();
  if (here === 'none') return 'skip';
  if (FACE_WORDS.has(here)) return N.pFace(here);
  return N.pChar(here);
}

export function answerWords(a) {
  // The Nazgûl Strike!: the Hunt roll (no card named), or neither (`decline`, while following).
  if (a.kind === 'nazgulStrike' && !a.discard) return new Set([a.decline ? 'skip' : 'hunt']);
  const out = new Set();
  const add = (k, v) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach((x) => add(k, x)); return; }
    if (typeof v === 'string') out.add(word(v));
    else if (v === true) out.add(k === 'done' || k === 'decline' ? 'skip' : 'yes');
    else if (v === false) { out.add('no'); out.add('skip'); }
    else if (typeof v === 'number') out.add(String(v));
  };
  for (const [k, v] of Object.entries(a)) {
    if (k === 'kind' || IGNORED_FIELDS.has(k)) continue;
    if (k === 'card' && a.kind === 'eventTarget') continue; // the card being played, not an answer
    add(k, v);
  }
  if (a.kind === 'eventTarget' && (a.companion === 'nazgul' || a.companion === 'witch-king') && a.from) out.add('move');
  if (!out.size) out.add('skip');
  return out;
}
const refWords = (answer) => new Set(String(answer).split(/[:>]/));
const containsAll = (big, small) => [...small].every((w) => big.has(w));
const minus = (a, b) => [...a].filter((w) => !b.has(w));

/** Whether `answer` (x>…>b, or b alone) is the route of the card move `prev` (a>b) just before it: the same end. */
function isRouteAfter(answer, prev) {
  if (typeof answer !== 'string' || typeof prev !== 'string' || !prev.includes('>')) return false;
  const a = answer.split('>'), p = prev.split('>');
  if (a.length === 1) return a[0] === p[p.length - 1]; // "Straight to …": the destination alone
  return a[a.length - 1] === p[p.length - 1] && a[0] !== p[0];
}

/** Whether a referee answer naming a route fits this engine's answer `a` in order. */
function inOrder(answer, a) {
  if (!String(answer).includes('>')) return true;
  const parts = String(answer).split('>');
  const from = a.from ? N.pRegion(a.from) : null;
  const to = (a.to ?? a.region) ? N.pRegion(a.to ?? a.region) : null;
  if (from && parts[0] !== from) return false;
  if (to && parts[parts.length - 1] !== to) return false;
  if (Array.isArray(a.path) && parts.length > 2) {
    const path = a.path.map(N.pRegion);
    return same(parts.slice(1), path) || same(parts, path);
  }
  return true;
}

/** This engine's answer among `legal` for the referee's answer words: naming all of them and the least besides. */
function matchAnswer(answerOrWords, legal) {
  const isText = typeof answerOrWords === 'string';
  const ours = isText ? refWords(answerOrWords) : answerOrWords;
  const fits = legal.filter((a) => containsAll(answerWords(a), ours) && (!isText || inOrder(answerOrWords, a)));
  if (!fits.length) return null;
  const best = Math.min(...fits.map((a) => minus(answerWords(a), ours).length));
  return fits.find((a) => minus(answerWords(a), ours).length === best);
}

/** The words a referee option names (a card's answer, or a card's Army move or attack). */
function optionWords(o) {
  if (o.kind === 'card_choice' && o.answer != null) return refWords(o.answer);
  if (o.kind === 'army_move' || o.kind === 'attack') return new Set([o.from, o.to]);
  if (o.kind === 'move_companion') return new Set([o.character, o.to]);
  if (o.kind === 'separate') return new Set([o.character]);
  if (o.kind === 'separate_to') return new Set([o.to]);
  if (o.kind === 'end') return new Set(['skip']);
  return new Set();
}

// --- The referee's steps as this engine's actions ("collapse") -------------------------------------------------------
// The referee reports each answered decision (`choice`) with the events it caused; a run of them makes one action
// here (an Army die, then the Army and its destination, then the units: one `moveArmy`). `collapse` turns the first
// steps of the buffer into actions: { more } (wait for the next steps), { absorb: n } (no action here: this engine
// settles it by itself), { acts, n } or { fail }. An action may name the question it answers (`onlyIf`): it is made
// only when this engine asks that question then.

const step = (action, onlyIf = null, extra = {}) => ({ action, onlyIf, ...extra });
const ACTS = (acts, n, note) => ({ acts, n, note });
const has = (st, kind) => st.events.some((e) => e.kind === kind);

/** The figures that left `from` in `steps` (their army_moved and character_moved events), as a MoveSel. */
/**
 * The figures that go along as the referee's ARMY_SELECTION answers count them (a move selection); the Army units of
 * `from` it asked nothing about went along (the only legal count: an Army moves with a unit).
 */
function countedSel(steps, state = null, from = null) {
  const sel = { units: {} };
  const asked = new Set(steps.filter((st) => st.kind === 'ARMY_SELECTION' && st.opt.nation).map((st) => `${N.nation(st.opt.nation)}|${st.opt.unit}`));
  const side = steps[0]?.side;
  for (const [n, u] of Object.entries(state?.regions?.[from]?.units ?? {})) {
    if (E.data.sideOfNation(n) !== side) continue;
    for (const t of ['regular', 'elite']) if ((u?.[t] ?? 0) > 0 && !asked.has(`${n}|${t}`)) { sel.units[n] ??= {}; sel.units[n][t] = u[t]; }
  }
  for (const st of steps) {
    if (st.kind !== 'ARMY_SELECTION') continue;
    const o = st.opt;
    if (o.character) { if (o.count) (sel.characters ??= []).push(N.char(o.character)); continue; }
    if (o.unit === 'leader') sel.leaders = (sel.leaders ?? 0) + o.count;
    else if (o.unit === 'nazgul') sel.nazgul = (sel.nazgul ?? 0) + o.count;
    else { const n = N.nation(o.nation); sel.units[n] ??= {}; sel.units[n][o.unit] = (sel.units[n][o.unit] ?? 0) + o.count; }
  }
  return sel;
}

function movedSel(steps, from) {
  const sel = { units: {} };
  let leaders = 0, nazgul = 0;
  const chars = [];
  for (const st of steps) for (const e of st.events) {
    if (e.kind === 'army_moved' && e.from === N.pRegion(from)) {
      for (const p of e.pieces ?? []) {
        const n = N.nation(p.nation);
        if (p.unit === 'regular' || p.unit === 'elite') { sel.units[n] ??= {}; sel.units[n][p.unit] = (sel.units[n][p.unit] ?? 0) + p.count; }
        else if (p.unit === 'leader') leaders += p.count;
        else if (p.unit === 'nazgul') nazgul += p.count;
      }
      for (const c of e.characters ?? []) chars.push(N.char(c));
    }
    if (e.kind === 'character_moved' && e.from === N.pRegion(from) && e.character !== 'ring-bearers') chars.push(N.char(e.character));
  }
  if (leaders) sel.leaders = leaders;
  if (nazgul) sel.nazgul = nazgul;
  if (chars.length) sel.characters = [...new Set(chars)];
  return sel;
}

/**
 * The index of the last step of an Army's move, attack or advance chosen at `steps[start]`: its figures follow as
 * ARMY_SELECTION steps of the same side. Null while more of them may come (the next step is not known yet).
 */
function selectionEnd(steps, start, next) {
  const side = steps[start].side;
  let last = start + 1;
  while (last < steps.length && steps[last].kind === 'ARMY_SELECTION' && steps[last].side === side) last++;
  if (last === steps.length && (!next || (next.kind === 'ARMY_SELECTION' && next.side === side))) return null;
  return last - 1;
}

/** The attack's rearguard: the figures of `from` (in `state`) the selection steps left out. */
/** The figures of `from` that do not attack, by the referee's view of the battle (battleView), or null. */
function rearguardFromView(state, side, from, to, selections = []) {
  const b = battleView;
  if (!b || N.region(b.from ?? '') !== from || N.region(b.region ?? '') !== to || !Array.isArray(b.attackers)) return null;
  const r = state.regions[from];
  if (!r) return null;
  // (Characters: the view lists Army figures; a Character stays when the referee's answer kept him back.)
  const kept = selections.filter((st) => st.opt.character && st.opt.count === 0).map((st) => N.char(st.opt.character));
  const out = { units: {}, leaders: r.leaders ?? 0, nazgul: r.nazgul ?? 0, characters: kept };
  for (const [n, u] of Object.entries(r.units ?? {})) if (E.data.sideOfNation(n) === side) out.units[n] = { regular: u.regular ?? 0, elite: u.elite ?? 0 };
  for (const x of b.attackers) {
    const n = N.nation(x.nation);
    if (x.unit === 'regular' || x.unit === 'elite') { if (out.units[n]) out.units[n][x.unit] = Math.max(0, out.units[n][x.unit] - x.n); }
    else if (x.unit === 'leader') out.leaders = Math.max(0, out.leaders - x.n);
    else if (x.unit === 'nazgul') out.nazgul = Math.max(0, out.nazgul - x.n);
  }
  const any = Object.values(out.units).some((u) => u.regular + u.elite > 0) || out.leaders || out.nazgul || out.characters.length;
  return any ? out : null;
}

function rearguardOf(state, side, from, selections, withLeader = false) {
  const r = state.regions[from];
  if (!r) return undefined;
  const force = r.besieged && r.siegeBox && E.data.sideOfNation(Object.keys(r.siegeBox.units)[0] ?? (side === 'fp' ? 'gondor' : 'sauron')) === side ? r.siegeBox : r;
  const out = { units: {}, leaders: 0, nazgul: 0, characters: [] };
  let any = false;
  for (const st of selections) {
    const o = st.opt;
    if (o.character) {
      if (o.count === 0) { out.characters.push(N.char(o.character)); any = true; }
      continue;
    }
    const n = o.nation ? N.nation(o.nation) : null;
    const avail = st.ctx?.available ?? (o.unit === 'leader' ? force.leaders : o.unit === 'nazgul' ? force.nazgul : (force.units[n]?.[o.unit] ?? 0));
    const left = Math.max(0, avail - o.count);
    if (!left) continue;
    any = true;
    if (o.unit === 'leader') out.leaders += left;
    else if (o.unit === 'nazgul') out.nazgul += left;
    else { out.units[n] ??= { regular: 0, elite: 0 }; out.units[n][o.unit] += left; }
  }
  // Leaders the referee asked nothing about: they go along in an attack with a Leader (one must) and when no unit stays
  // (a Leader is never left alone); else they stay with the units left behind (they may not go: their Nation is not
  // "At War"; a free choice is asked).
  if (withLeader) return any ? out : undefined;
  const asked = new Set(selections.map((st) => `${st.opt.nation ? N.nation(st.opt.nation) : ''}|${st.opt.unit}`));
  const unitsLeft = Object.values(out.units).some((u) => u.regular + u.elite > 0) ||
    Object.entries(force.units ?? {}).some(([n, u]) => ['regular', 'elite'].some((t) => (u?.[t] ?? 0) > 0 && !asked.has(`${n}|${t}`)));
  if (force.leaders > 0 && unitsLeft && !selections.some((st) => st.opt.unit === 'leader')) { out.leaders += force.leaders; any = true; }
  return any ? out : undefined;
}

export function collapse(steps, here, state, next) {
  const f = steps[0];
  const o = f.opt;
  const side = f.side;
  const one = (a, onlyIf) => ACTS([step(a, onlyIf)], 1);
  // A forced step of the referee's (one option) that this engine settled by itself: it is not asking it any more.
  if (f.forced && !corresponds(here, { side: f.side, kind: f.kind, context: f.ctx, options: [o] }, f.inCard)) return { absorb: 1, note: `settled by this engine itself: ${f.kind}` };
  switch (f.kind) {
    // The official rules' Leader re-roll ("both players can re-roll"): this engine always re-rolls, without a question;
    // the referee's dice that follow are the re-roll's. A side that declines rolls none: this engine cannot follow it.
    case 'LEADER_REROLL':
      return o.answer === 'reroll' ? { absorb: 1 } : { fail: `${f.side} declined its Leader re-roll (this engine always re-rolls)` };
    case 'HUNT_ALLOCATION': {
      // This engine allocates by itself when only one number is allowed.
      const max = Math.max(0, ...here.legal.filter((a) => a.kind === 'allocateHunt').map((a) => a.dice));
      if (o.count <= max || here.phase !== 'huntAllocation') return ACTS([step(act('allocateHunt', { dice: o.count }), null, { phaseIf: 'huntAllocation' })], 1);
      // More Hunt dice than this engine allows off the Mordor Track (at most 5): written in, the phases go on.
      return ACTS([step(act('@patch', { path: ['hunt', 'box'], value: o.count })), step(act('@patch', { path: ['phase'], value: 'actionRoll' })), step(act('@advance'))], 1, `Hunt allocation of ${o.count} written in`);
    }
    case 'DISCARD_EXCESS_CARD':
      return one(act('discardCard', { card: o.hidden ? { hiddenDeck: o.deck } : N.card(o.card) }));
    case 'FELLOWSHIP_PHASE':
      switch (o.kind) {
        case 'declare': return one(act('declareFellowship', { target: N.region(o.region) }));
        case 'enter_mordor': return one(act('enterMordor'));
        case 'done': return here.phase === 'fellowship' && !here.kind ? one(act('skipFellowshipPhase')) : { absorb: 1 };
        case 'guide': {
          // Naming the Guide ends this engine's Fellowship phase: the referee's other steps of the phase go first.
          const end = steps.findIndex((s) => s.kind === 'FELLOWSHIP_PHASE' && s.opt.kind === 'done');
          if (end < 0) return next && !(next.kind === 'FELLOWSHIP_PHASE' && next.side === side) ? ACTS([step(act('changeGuide', { companion: N.char(o.character) }))], steps.length) : { more: true };
          const rest = [];
          for (const s of steps.slice(1, end)) {
            if (s.opt.kind === 'declare') rest.push(step(act('declareFellowship', { target: N.region(s.opt.region) })));
            else if (s.opt.kind === 'enter_mordor') rest.push(step(act('enterMordor')));
          }
          return ACTS([...rest, step(act('changeGuide', { companion: N.char(o.character) }))], end + 1);
        }
      }
      break;
    case 'CHOOSE_GUIDE':
      return ACTS([step(act('@patch', { path: ['fellowship', 'guide'], value: N.char(o.character) }))], 1, 'Guide among equals written in');
    case 'ACTION':
      switch (o.kind) {
        case 'pass': return one(act('pass'));
        case 'skip_die': return one(act('skipDie', { face: N.face(o.face) }));
        case 'elven_ring': return one(act('useElvenRing', { from: N.face(o.from), to: N.face(o.to) }));
        case 'use_die': return collapseDie(steps, here, state, next);
      }
      break;
    case 'ARMY_MOVE':
      if (o.kind === 'end') return f.inCard && here.kind === 'eventTarget' ? one(matchAnswer('skip', cardLegal(here)) ?? act('@noop')) : one(act('armyMove2', { done: true }), 'armyMove2');
      // Part of an Army in a card's move: the figures chosen go along (this engine's `move` selection of the target).
      if (here.kind === 'eventTarget' && o.all === false) {
        const a = cardLegal(here).find((x) => x.from === N.region(o.from) && x.to === N.region(o.to));
        if (a) {
          const end = selectionEnd(steps, 0, next);
          if (end === null) return { more: true };
          return ACTS([step({ ...a, move: movedSel(steps.slice(0, end + 1), N.region(o.from)) })], end + 1, "part of an Army in a card's move");
        }
      }
      if (here.kind === 'eventTarget') return cardChoices(steps, here, next, state);
      if (f.inCard && here.kind !== 'armyMove2') return cardArmyStepDone(steps, next);
      {
        const end = selectionEnd(steps, 0, next);
        if (end === null) return { more: true };
        return ACTS([step(act('armyMove2', { from: N.region(o.from), to: N.region(o.to), move: movedSel(steps.slice(0, end + 1), N.region(o.from)) }), 'armyMove2')], end + 1);
      }
    case 'CHOOSE_ATTACK':
      if (here.kind === 'eventTarget') return cardChoices(steps, here, next, state);
      return cardArmyStepDone(steps, next);
    case 'ARMY_SELECTION':
      return { absorb: 1, note: "figures of a card's move: this engine takes all" };
    case 'RECRUIT':
      if (o.kind === 'end') return one(act('recruitSecond', { done: true }), 'musterSecond');
      if (here.kind === 'eventTarget') return cardChoices(steps, here, next, state);
      return one(act('recruitSecond', { nation: recruitNation(o), region: N.region(o.region), figure: o.unit === 'regular' ? 'regular' : 'leader' }), 'musterSecond');
    case 'MOVE_COMPANIONS':
    case 'MOVE_MINIONS':
      // The end of such a card's Nazgûl moves: the card goes on (the referee asks its Army clause next).
      if (o.kind === 'end' && NAZGUL_THEN_ARMY.has(eventCardOf(here))) return { absorb: 1 };
      if (o.kind === 'end') return here.kind === 'eventTarget' ? one(matchAnswer('skip', cardLegal(here)) ?? act('@noop')) : one(act('charMove2', { done: true }), 'charMove2');
      if (here.kind === 'eventTarget') return o.kind === 'move_companion' ? cardCompanionMove(steps, here, next) : cardMinionMove(steps, here);
      return characterMove(steps, 0, null, next);
    case 'JOIN_GROUP':
      return { absorb: 1 };
    case 'SEPARATE_COMPANIONS':
      if (o.kind === 'separate') {
        if (here.kind === 'eventTarget') return one(matchAnswer(o.character, cardLegal(here)) ?? act('@noop'));
        return one(act('separateMove', { companion: N.char(o.character) }));
      }
      if (here.kind === 'eventTarget') {
        const legal = cardLegal(here);
        const pick = (state.fellowship.mordor !== null ? legal.find((a) => a.done) : null) ?? matchAnswer(o.to, legal) ?? legal.find((a) => a.done);
        return one(pick ?? act('@noop'));
      }
      {
        // The referee separates a group to one place (two Hobbit Guides who left at the same Hunt, say); this engine
        // asks each Companion's move: the same place for each, as long as it asks.
        const n = Math.max(1, f.events.find((e) => e.kind === 'companions_separated')?.characters?.length ?? 1);
        return ACTS(Array.from({ length: n }, () => step(act('separateMove', { target: N.region(o.to) }), 'separateMove')), 1);
      }
    case 'REMOVE_EXCESS_UNIT':
      // (Only while this engine still asks it: it removes the rest itself once the choice no longer matters.)
      if (here.kind === 'removeExcess') return one(act('removeExcess', { nation: N.nation(o.nation), figure: o.unit === 'elite' ? 'elite' : 'regular' }), 'removeExcess');
      return { absorb: 1, note: 'a unit over the stacking limit by the referee, not here' };
    case 'WHITE_RIDER': return one(act('whiteRider', { forfeit: o.kind === 'use' }), 'whiteRider');
    case 'FIELD_OR_SIEGE': return one(act('siegeWithdraw', { withdraw: o.kind === 'siege' }), 'siegeWithdraw');
    case 'COMBAT_CARD':
      return one(act('playCombatCard', { cardId: o.kind === 'none' ? null : o.hidden ? { hiddenDeck: o.deck } : N.card(o.card) }), 'combatCard');
    case 'CASUALTY': {
      const stepKind = o.unit === 'regular' ? 'removeRegular' : o.effect === 'reduce' ? 'reduceElite' : 'removeElite';
      const k = here.kind === 'eventCasualties' ? 'eventCasualties' : 'combatCasualties';
      const taken = f.events.find((e) => e.kind === 'casualty_taken' && !e.used);
      if (taken) taken.used = true; // this answer's casualty (a later one the referee took unasked: silentDefault)
      return one(act('casualtyStep', { step: stepKind, nation: N.nation(o.nation) }), k);
    }
    case 'CEASE_ATTACK': return one(act('combatContinue', { cont: o.kind === 'continue' }), 'combatContinue');
    case 'RETREAT':
      if (o.kind === 'stand') return one(act('combatRetreat', { retreat: false }), 'combatRetreat');
      return ACTS([step(act('combatRetreat', { retreat: true }), 'combatRetreat'), step(act('retreatTo', { region: N.region(o.region) }), 'retreatTo')], 1);
    case 'EXTEND_SIEGE': return one(act('siegeExtend', { extend: o.kind === 'extend' }), 'siegeExtend');
    case 'ADVANCE': {
      const k = ['advanceChoice', 'besiegerAdvance', 'relieveAdvance'].includes(here.kind) ? here.kind : 'advanceChoice';
      if (o.kind === 'stay') return one(act(k, { advance: false }), k);
      if (o.all !== false) return one(act(k, { advance: true }), k);
      const end = selectionEnd(steps, 0, next);
      if (end === null) return { more: true };
      const moved = steps.slice(0, end + 1).flatMap((x) => x.events).find((e) => e.kind === 'army_moved');
      if (!moved) return ACTS([step(act(k, { advance: false }), k)], end + 1); // nobody chosen to go
      return ACTS([step(act(k, { advance: true, move: movedSel(steps.slice(0, end + 1), N.region(moved.from)) }), k)], end + 1);
    }
    case 'GUIDE_ABILITY':
      // Declined, and the referee took the damage left as Corruption (corruption_changed with the step): here too.
      if (o.kind !== 'use' && here.kind === 'huntDamage' && f.events.some((e) => e.kind === 'corruption_changed') &&
        here.legal.some((a) => a.mode === 'corruption')) return one(act('huntDamage', { mode: 'corruption' }), 'huntDamage');
      if (o.kind !== 'use') return { absorb: 1 };
      return one(act('huntDamage', { mode: ['meriadoc', 'peregrin'].includes(state.fellowship.guide) ? 'reduceSeparate' : 'reduceReveal' }), 'huntDamage');
    case 'HUNT_CASUALTY': {
      const mode = o.kind === 'guide' ? 'guide' : o.kind === 'random' ? 'random' : 'corruption';
      // One Companion per tile (rulebook): what his Level did not absorb is Corruption at once at the referee
      // (corruption_changed with the step); this engine asks again: the rest as Corruption here too.
      if (mode !== 'corruption' && f.events.some((e) => e.kind === 'corruption_changed')) {
        return ACTS([step(act('huntDamage', { mode }), 'huntDamage'), step(act('huntDamage', { mode: 'corruption' }), 'huntDamage')], 1);
      }
      return one(act('huntDamage', { mode }), 'huntDamage');
    }
    case 'REVEAL_FELLOWSHIP':
      // The path's Shadow Strongholds (one Hunt tile each) when the referee's option names them (without, the path of
      // the fewest, as this engine takes it).
      return one(act('revealMove', { target: N.region(o.region), strongholds: o.strongholds }), 'revealMove');
    case 'CARD_CHOICE':
      return collapseCard(steps, here, state, next);
  }
  return { fail: `no action here for the referee's ${f.kind} ${JSON.stringify(o)}` };
}

const recruitNation = (o) => (o.unit === 'nazgul' ? 'sauron' : N.nation(o.nation));

function collapseDie(steps, here, state, next) {
  const f = steps[0];
  const o = f.opt;
  const face = N.face(o.face);
  const one = (a) => ACTS([step(a)], 1);
  switch (o.action) {
    case 'move_fellowship': return one(act('moveFellowship', { die: face }));
    case 'hide_fellowship': case 'hide_fellowship_strider': return one(act('hideFellowship', { die: face }));
    case 'draw_card': return one(act('drawEvent', { deck: o.deck, die: face }));
    case 'play_card': return one(act('playEvent', { cardId: N.card(o.card), die: face }));
    case 'diplomacy': return one(act('diplomaticAction', { nation: N.nation(o.nation), die: face }));
    case 'companion_politics': {
      const nation = { boromir: 'gondor', legolas: 'elves', gimli: 'dwarves' }[o.character];
      return one(act('companionMuster', { companion: N.char(o.character), nation, die: face }));
    }
    case 'play_companion':
      return ACTS([step(act('bringUpgrade', { which: N.char(o.character) })), step(act('placeGandalf', { region: N.region(o.region) }), 'placeGandalf')], 1);
    case 'play_minion': return one(act('bringMinion', { minion: N.char(o.character), region: N.region(o.region), die: face }));
    case 'voice_of_saruman': {
      // The Settlements the referee recruited in (its order when the Regulars run short; a full one too, trimmed after).
      const regions = o.upgrade ? undefined : f.events.filter((e) => e.kind === 'figure_recruited').map((e) => N.region(e.region));
      return one(act('sarumanMuster', { mode: o.upgrade ? 'upgrade' : 'recruit', die: face, regions }));
    }
    case 'force_discard': {
      const pay = (o.pay ?? []).map(N.card);
      // The Shadow's price for forcing "A Power too Great" / "The Power of Tom Bombadil" off (an Army and a Character
      // card) is discarded face down since 2026-10-31: the opponent's choice has `hidden` and no `pay`. Paid with cards
      // all the same, stand-ins of the two decks here (prepare), not with a die.
      const hiddenPay = !pay.length && !!o.hidden && !o.elven_ring;
      const via = pay.length || hiddenPay ? 'cards' : o.elven_ring ? 'ring' : !o.any_die ? 'will' : 'die';
      return one(act('forceDiscardCard', {
        cardId: N.card(o.card), via, die: face,
        discardStrategy: hiddenPay ? { hiddenDeck: 'strategy' } : pay.find((c) => N.deck(c) === 'strategy'),
        discardCharacter: hiddenPay ? { hiddenDeck: 'character' } : pay.find((c) => N.deck(c) === 'character'),
      }));
    }
    case 'recruit': {
      if (steps.length < 2) return { more: true };
      const r1 = steps[1].opt;
      if (steps[1].kind !== 'RECRUIT' || r1.kind !== 'recruit') return { fail: `a Muster die followed by ${steps[1].kind} ${r1.kind}` };
      // The second figure (or the end) is the referee's next RECRUIT step, made as recruitSecond when this engine asks it.
      return ACTS([step(act('recruitUnit', {
        nation: recruitNation(r1), region: N.region(r1.region),
        regular: r1.unit === 'regular' ? 1 : 0, elite: r1.unit === 'elite' ? 1 : 0,
        leader: r1.unit === 'leader' ? 1 : undefined, nazgul: r1.unit === 'nazgul' ? 1 : undefined,
        then: r1.unit === 'elite' ? undefined : r1.unit === 'regular' ? 'regular' : 'leader', die: face,
      }))], 2);
    }
    case 'move_armies': case 'move_army_with_leader': {
      if (steps.length < 2) return { more: true };
      const m = steps[1].opt;
      if (steps[1].kind !== 'ARMY_MOVE' || m.kind !== 'army_move') return { fail: `an Army die followed by ${steps[1].kind} ${m.kind}` };
      const end = selectionEnd(steps, 1, next);
      if (end === null) return { more: true };
      const sel = m.all === false ? movedSel(steps.slice(1, end + 1), N.region(m.from)) : undefined;
      return ACTS([step(act('moveArmy', { from: N.region(m.from), to: N.region(m.to), move: sel, die: face }))], end + 1);
    }
    case 'attack': case 'attack_with_leader': {
      if (steps.length < 2) return { more: true };
      const a = steps[1].opt;
      if (steps[1].kind !== 'CHOOSE_ATTACK' || a.kind !== 'attack') return { fail: `an attack die followed by ${steps[1].kind} ${a.kind}` };
      const end = selectionEnd(steps, 1, next);
      if (end === null) return { more: true };
      const from = N.region(a.from);
      // The figures left behind counted on the board as it is when the attack is made (steps may wait before it).
      const sels = steps.slice(2, end + 1).filter((s) => s.kind === 'ARMY_SELECTION');
      const attack = (st) => {
        // The attackers as the referee's view of the battle lists them, when the bot has it (exact); else counted.
        const listed = a.all === false ? rearguardFromView(st, f.side, from, N.region(a.to), sels) : null;
        const rearguard = a.all === false ? listed ?? rearguardOf(st, f.side, from, sels, o.action === 'attack_with_leader') : undefined;
        const x = act('attack', { from, to: N.region(a.to), rearguard, die: face });
        // Leaders kept back that this engine will not leave there (no unit of theirs stays here): they go along.
        if (rearguard?.leaders && !tryAhead(st, x, f.side)) {
          const r = { ...rearguard, leaders: 0 };
          const any = Object.values(r.units).some((u) => u.regular + u.elite > 0) || r.nazgul || r.characters.length;
          return act('attack', { from, to: N.region(a.to), rearguard: any ? r : undefined, die: face });
        }
        return x;
      };
      return ACTS([step(attack(state), null, { resolve: (h, st) => attack(st) })], end + 1);
    }
    case 'move_minions': case 'move_companions': {
      if (steps.length < 2) return { more: true };
      const r = characterMove(steps, 1, face, next);
      return r.acts ? { ...r, n: r.n + 1 } : r;
    }
    case 'separate_companions': {
      if (steps.length < 2) return { more: true };
      const c = steps[1].opt;
      if (c.kind !== 'separate') return { fail: `a separation die followed by ${c.kind}` };
      return ACTS([step(act('separateCompanion', { companion: N.char(c.character), die: face }))], 2);
    }
  }
  return { fail: `no action here for the die action ${o.action}` };
}

/** One Character move from `steps[start]`: a Nazgûl, a Minion, or a Companion with the group going along. */
function characterMove(steps, start, face, next) {
  const s = steps[start];
  const o = s.opt;
  switch (o.kind) {
    case 'select_nazgul': {
      if (steps.length < start + 2) return { more: true };
      const m = steps[start + 1].opt;
      if (m.kind !== 'move_nazgul') return { fail: `a Nazgûl chosen and then ${m.kind}` };
      return ACTS([step(act('moveCharacter', { char: 'nazgul', from: N.region(m.from), to: N.region(m.to), count: 1, die: face ?? undefined }))], 2);
    }
    case 'select_minion': {
      if (steps.length < start + 2) return { more: true };
      const m = steps[start + 1].opt;
      if (m.kind !== 'move_minion') return { fail: `a Minion chosen and then ${m.kind}` };
      return ACTS([step(act('moveCharacter', { char: N.char(m.character), from: N.region(m.from ?? o.from), to: N.region(m.to), die: face ?? undefined }))], 2);
    }
    case 'move_companion': {
      let end = -1;
      for (let i = start; i < steps.length; i++) if (has(steps[i], 'character_moved')) { end = i; break; }
      if (end < 0) {
        const after = steps[start + 1] ?? next;
        if (!after || (after.kind === 'JOIN_GROUP' && after.side === s.side)) return { more: true };
        end = steps.length - 1;
      }
      const moved = steps.slice(start, end + 1).flatMap((x) => x.events).filter((e) => e.kind === 'character_moved' && e.character !== 'ring-bearers');
      const group = [...new Set(moved.map((e) => N.char(e.character)))];
      return ACTS([step(act('moveCharacter', {
        char: N.char(o.character), from: N.region(o.from ?? moved[0]?.from), to: N.region(o.to),
        chars: group.length > 1 ? group : undefined, die: face ?? undefined,
      }))], end - start + 1);
    }
  }
  return { fail: `a Character move starting with ${o.kind}` };
}

/** This engine's answers to a card's question now. */
function cardLegal(here) {
  return here.legal.filter((a) => CARD_KINDS.has(a.kind) || (here.kind === 'freeCharEvent' && a.kind === 'playEvent'));
}

/** A card's Army move or attack the referee asks, with its figures, which this engine made with the card's answer. */
function cardArmyStepDone(steps, next) {
  let n = 1;
  while (n < steps.length && steps[n].kind === 'ARMY_SELECTION') n++;
  if (n === steps.length && next?.kind === 'ARMY_SELECTION' && next.side === steps[0].side) return { more: true };
  return { absorb: n, note: "a card's Army step this engine made with the card's answer" };
}

/** A card's move of one Nazgûl (or a Minion): this engine's two answers, the group's pick and its destination. */
function cardMinionMove(steps, here) {
  if (steps.length < 2) return { more: true };
  const m = steps[1].opt;
  let figure, from, to;
  if (m.kind === 'move_nazgul') { figure = 'NAZGUL'; from = m.from; to = m.to; }
  else if (m.kind === 'move_minion') { figure = m.character; from = m.from ?? steps[0].opt.from; to = m.to; }
  else return { fail: `a card's Nazgûl chosen and then ${m.kind}` };
  const pick = (words, destination) => (h) => {
    const legal = cardLegal(h);
    const fits = legal.filter((a) => containsAll(answerWords(a), words) && (a.region != null) === destination);
    fits.sort((a, b) => minus(answerWords(a), words).length - minus(answerWords(b), words).length);
    // The figure picked already (a card's "move" answer picked it): its destination is this engine's question now.
    if (!fits.length && !destination && legal.some((a) => a.region != null && a.from === N.region(from))) return act('@noop');
    return fits[0] ?? legal.find((a) => answerWords(a).has('skip')) ?? null;
  };
  const label = act('eventTarget', { note: `card move of ${figure} ${from}>${to}` });
  return ACTS([
    step(label, 'eventTarget', { resolve: pick(new Set([figure, from]), false) }),
    step(label, 'eventTarget', { resolve: pick(new Set([figure, from, to, ...(figure === 'NAZGUL' ? ['1'] : [])]), true) }),
  ], 2);
}

/** A card's move of a Companion and his group: one answer here once the group is known. */
function cardCompanionMove(steps, here, next) {
  const s = steps[0];
  let end = -1;
  for (let i = 0; i < steps.length; i++) if (has(steps[i], 'character_moved')) { end = i; break; }
  if (end < 0) {
    const after = steps[1] ?? next;
    if (!after || after.kind === 'JOIN_GROUP') return { more: true };
    end = steps.length - 1;
  }
  const words = new Set([s.opt.character, s.opt.to]);
  const legal = cardLegal(here).filter((a) => containsAll(answerWords(a), words));
  if (!legal.length) return { fail: `no answer here moves ${s.opt.character} to ${s.opt.to}` };
  const group = [...new Set(steps.slice(0, end + 1).flatMap((x) => x.events).filter((e) => e.kind === 'character_moved' && e.character !== 'ring-bearers').map((e) => N.char(e.character)))];
  // A move that names the Companion only (Gwaihir the Windlord's: the group first, then where): the referee's one answer
  // also says where, the second step here.
  const exact = legal.find((a) => a.region === N.region(s.opt.to) || a.to === N.region(s.opt.to));
  const base = exact ?? legal[0];
  const chosen = group.length > 1 ? { ...base, group } : base;
  const acts = [step(chosen)];
  if (!exact) {
    const to = N.region(s.opt.to);
    acts.push(step(act('@noop'), null, {
      resolve: (h) => h.kind === 'eventTarget' ? (cardLegal(h).find((a) => a.region === to || a.to === to) ?? act('@noop')) : act('@noop'),
    }));
  }
  return ACTS(acts, end + 1);
}

// Cards whose Nazgûl moves come before an Army clause (move two Armies or attack with one): this engine offers both at
// once and ends the card with its `done`; the referee asks the Nazgûl, their end, then the clause ("move", "attack",
// "skip").
const NAZGUL_THEN_ARMY = new Set(['sh-char-23', 'sh-char-24']);
/** The card this engine's open event target is for, or null. */
function eventCardOf(here) { return here.kind === 'eventTarget' ? here.legal.find((a) => a.kind === 'eventTarget')?.card ?? null : null; }

function collapseCard(steps, here, state, next) {
  const f = steps[0];
  const o = f.opt;
  const one = (a) => ACTS([step(a)], 1);
  const card = o.card ? N.card(o.card) : null;
  const skip = o.skip === true || o.answer === 'skip';
  // "How many Regulars in <region>?" (Many Kings to the Service of Mordor, Pits of Mordor, asked when the Regulars run
  // short): this engine recruits two in each region itself, no step of its own.
  // The count follows the region's answer: one target here, with its `count` (followOptions.countedRecruits).
  if ((o.card === 'sh-strat-17' || o.card === 'sh-strat-24') && o.count != null && o.region == null) return { absorb: 1 };
  if ((o.card === 'sh-strat-17' || o.card === 'sh-strat-24') && o.region && here.kind === 'eventTarget') {
    const t = cardLegal(here).find((a) => a.region === N.region(o.region));
    const c = steps[1];
    if (t && !c && next?.side === f.side && next.kind === 'CARD_CHOICE' && next.card === o.card) return { more: true };
    if (t && c?.kind === 'CARD_CHOICE' && c.opt.card === o.card && c.opt.count != null && c.opt.region == null) return ACTS([step({ ...t, count: c.opt.count })], 2);
    if (t) return ACTS([step(t)], 1);
  }
  // A bonus draw (Gandalf the Grey as Guide, the Palantír): `draw` options.
  if (o.kind === 'draw') {
    // The official rules let a "may draw" be declined: `skip`, no deck (this engine's "no").
    if (here.kind === 'bonusDraw') return one(act('bonusDraw', { deck: o.skip ? 'none' : o.deck }));
    if (here.kind === 'guideDraw') return one(act('guideDraw', { draw: !o.skip }));
    if (here.kind === 'sorcererDraw') return one(act('sorcererDraw', { draw: !o.skip }));
    if (o.skip) return { absorb: 1, note: 'a bonus draw declined that this engine does not ask' };
    const drawn = f.events.find((e) => e.kind === 'card_drawn');
    if (!drawn) return { absorb: 1, note: 'a bonus draw that drew nothing' };
    return ACTS([step(act('@draw', { side: N.side(drawn.side), deck: drawn.deck, card: drawn.card ? N.card(drawn.card) : null })), step(act('@advance'))], 1, 'a bonus draw this engine asked at another time, written into the hand');
  }
  // Mithril Coat and Sting, Wizard's Staff: at a Hunt tile.
  if (here.kind === 'huntRedraw') return one(act('huntRedraw', { redraw: !skip && card === MITHRIL }));
  if (here.kind === 'huntPreventDraw') return one(act('huntPreventDraw', { prevent: !skip && card === WIZARDS_STAFF }));
  if (f.ctx?.tile !== undefined || here.kind === 'huntDamage') {
    if (skip) return { absorb: 1 };
    return ACTS([step(act('huntDamage', { mode: 'reduceCard', card: N.card(o.answer ?? o.target_card ?? o.card) }), 'huntDamage')], 1);
  }
  if (here.kind === 'combatCardCost') {
    const amounts = here.legal.map((a) => a.amount).filter((x) => typeof x === 'number');
    const wanted = Number(o.count ?? o.answer);
    if (!amounts.length || Number.isNaN(wanted)) return { absorb: 1 };
    return one(act('combatCardCost', { amount: Math.min(Math.max(wanted, Math.min(...amounts)), Math.max(...amounts)) }));
  }
  // Scouts' withdrawal into the siege: this engine's pre-combat "retreat" to the Army's own region.
  if (here.kind === 'preCombatRetreat' && o.answer === 'siege') {
    const own = here.legal.find((a) => a.region === state.pendingCombat?.to);
    if (own) return one(own);
  }
  if (card && MIGHTY_ATTACK.has(card) && o.character) {
    return { absorb: 1, note: "Mighty Attack's forfeited Leadership, this round's" };
  }
  // Dreadful Spells' caster and target ("from>to"): the target here, cast from that Army (followOptions.dreadfulFrom).
  if (o.card === 'sh-char-19' && o.from && o.to && here.kind === 'eventTarget') {
    const t = cardLegal(here).find((a) => a.region === N.region(o.to));
    if (t) return one({ ...t, from: N.region(o.from) });
  }
  // Worn with Sorrow and Toil's discard: a random Character card of the hand, a tabled one, or none. This engine asks
  // it once the Hunt has resolved, often later than the referee: kept until it is asked.
  if (o.card === 'sh-char-15') {
    const a = skip ? act('wornDiscard', { decline: true }) : o.answer === 'hand' ? act('wornDiscard') : act('wornDiscard', { card: N.card(o.target_card ?? o.answer) });
    if (here.kind === 'wornDiscard') return one(a);
    return { absorb: 1, defer: { side: f.side, action: a }, note: "Worn with Sorrow and Toil's discard, for when this engine asks it" };
  }
  // A die turned into an Eye, named by its number: the die's face here.
  if (o.card === 'sh-char-18' && here.kind === 'eventTarget' && (o.count != null || skip)) {
    if (skip) return one(cardLegal(here).find((a) => a.done) ?? act('@noop'));
    const face = dieFace(f.side, o.count, f.dice); // the dice as they were when it was answered
    const a = face && cardLegal(here).find((x) => x.eye && x.face === N.face(face));
    if (a) return one(a);
  }
  if (f.inBattle && !CARD_KINDS.has(here.kind)) return { absorb: 1, note: "a Combat card's question this engine settles by itself" };
  // The Black Captain's "move the Nazgûl" clause: the moves that follow are this engine's picks (not one picked here).
  if (o.card === 'sh-char-24' && o.answer === 'move') {
    const after = steps[1] ?? next;
    if (!after) return { more: true };
    if (after.side === f.side && after.kind === 'MOVE_MINIONS') return { absorb: 1, note: "the Black Captain's Nazgûl clause" };
  }
  // A card's first clause declined, its second asked next (The Black Captain Commands: no Nazgûl, then the Army):
  // this engine's card goes on to the second one.
  if (skip && o.card === 'sh-char-24') {
    const after = steps[1] ?? next;
    if (!after) return { more: true };
    if (after.side === f.side && after.kind === 'CARD_CHOICE' && (after.opt?.card ?? after.card) === o.card) return { absorb: 1, note: "a card's first clause declined" };
  }
  if (o.answer === 'separate') return { absorb: 1 };
  if (f.route) return { absorb: 1, note: "a card move's route: this engine takes its own" };
  // A card's Army move whose figures moved with this answer (or with its ARMY_SELECTION steps after it): the move as
  // the referee made it, from where to where it went (its answer may name the destination only).
  if (here.kind === 'eventTarget' && o.answer != null && !skip) {
    let at = -1;
    for (let i = 0; i < steps.length; i++) {
      if (i > 0 && !(steps[i].kind === 'ARMY_SELECTION' && steps[i].side === f.side)) break;
      if (steps[i].events.some((e) => e.kind === 'army_moved' && N.side(e.side) === f.side)) { at = i; break; }
    }
    const e = at >= 0 ? steps[at].events.find((x) => x.kind === 'army_moved' && N.side(x.side) === f.side) : null;
    const t = e && cardLegal(here).find((a) => a.from === N.region(e.from) && (a.to ?? a.region) === N.region(e.to));
    if (t) {
      const sel = at > 0 ? movedSel(steps.slice(0, at + 1), t.from) : undefined;
      return ACTS([step(sel ? { ...t, move: sel } : t)], at + 1, 'a card move as the referee made it');
    }
  }
  if (!cardLegal(here).length) return { absorb: 1, note: `a card question this engine does not ask (${o.card})` };
  // A figure the card recruits in a region this engine fills by itself (A New Power is Rising's Dunland Regulars), asked
  // figure by figure: this engine has made it already, its own question is about another region.
  const recruited = f.events.find((e) => e.kind === 'figure_recruited');
  if (recruited) recruited.used = true; // this answer's own figure (later ones the referee recruited unasked: silentDefault)
  if (recruited && ['REGULAR', 'ELITE'].includes(o.answer) && !cardLegal(here).some((a) => a.region === N.region(recruited.region))) {
    return { absorb: 1, note: "a card's recruit this engine made by itself" };
  }
  return cardChoices(steps, here, next, state);
}

/**
 * The referee's answers to a card's questions (one or several in a row, for the same card) as this engine's one
 * answer: the one naming all the referee's answers name. When several fit and the referee asks a follow-up, wait.
 */
function cardChoices(steps, here, next, state = null) {
  const card = steps[0].opt.card ?? null;
  const sameCard = (s) => (s.kind === 'CARD_CHOICE' ? (s.opt.card ?? null) === card : ['ARMY_MOVE', 'CHOOSE_ATTACK', 'ARMY_SELECTION'].includes(s.kind) && s.inCard);
  let most = 1;
  while (most < steps.length && sameCard(steps[most])) most++;
  const legal = cardLegal(here);
  const answersOf = (k) => steps.slice(0, k).filter((s) => s.kind === 'CARD_CHOICE' && s.opt.answer != null).map((s) => s.opt.answer);
  const wordsOf = (k) => {
    const w = new Set();
    for (const s of steps.slice(0, k)) {
      if (s.kind === 'CARD_CHOICE' && s.opt.answer != null) refWords(s.opt.answer).forEach((x) => w.add(x));
      else if (s.opt.kind === 'army_move' || s.opt.kind === 'attack') { w.add(s.opt.from); w.add(s.opt.to); }
      // A card's Companion move in one answer (Gwaihir the Windlord: the Companion and where his group goes).
      else if (s.kind === 'CARD_CHOICE' && s.opt.kind === 'move_companion') { w.add(s.opt.character); w.add(s.opt.to); }
    }
    return w;
  };
  const fitsOf = (k) => legal.filter((a) => containsAll(answerWords(a), wordsOf(k)) && answersOf(k).every((x) => inOrder(x, a)));
  let k = 1;
  while (k < most) {
    const now = fitsOf(k);
    const exact = now.filter((a) => minus(answerWords(a), wordsOf(k)).length === 0);
    if (exact.length === 1 || now.length <= 1) break;
    if (!fitsOf(k + 1).length) break;
    k++;
  }
  const words = wordsOf(k);
  const fits = fitsOf(k);
  if (!fits.length) {
    // This engine's answers name less than the referee's ("a Leader" for a Leader of a Nation): the one naming the most.
    const lesser = legal.filter((a) => containsAll(words, answerWords(a)) && answersOf(k).every((x) => inOrder(x, a)));
    if (lesser.length) {
      const most2 = Math.max(...lesser.map((a) => answerWords(a).size));
      const chosen = lesser.find((a) => answerWords(a).size === most2);
      // What the referee's answer names beyond it (the destination of a Companion's move) is this engine's next step.
      const rest = [...words].filter((x) => !answerWords(chosen).has(x));
      const acts = [step(chosen)];
      if (rest.length) {
        acts.push(step(act('@noop'), null, {
          resolve: (h) => h.kind === 'eventTarget'
            ? (cardLegal(h).find((a) => rest.every((x) => answerWords(a).has(x))) ?? cardLegal(h).find((a) => rest.some((x) => answerWords(a).has(x))) ?? act('@noop'))
            : act('@noop'),
        }));
      }
      return ACTS(acts, k);
    }
    if (legal.length === 1 || answersOf(k).includes('siege')) return ACTS([step(legal[0])], k, 'a card answer this engine does not offer; its only one made');
    return { fail: `none of this engine's ${legal.length} answers fits the referee's ${[...words].join(',')}` };
  }
  // What an answer names beyond the referee's (a recruit's "recruit" is no word of the referee's when it names the region).
  const beyond = (a) => minus(answerWords(a), words).filter((w) => !(w === 'recruit' && a.region)).length;
  const least = Math.min(...fits.map(beyond));
  const best = fits.filter((a) => beyond(a) === least);
  const last = steps[k - 1];
  const after = steps[k] ?? next;
  if (k === steps.length && !after) return { more: true };
  if (k === steps.length && after && after.side === last.side && after.kind === 'ARMY_SELECTION') return { more: true };
  // (Several answers naming exactly the referee's: they differ in what the referee does not name, the first is made
  // now, so that this engine is up to date when the next move is asked.)
  if ((least > 0 || (best.length > 1 && after?.kind === 'CARD_CHOICE')) && k === steps.length && after && after.side === last.side &&
    (after.kind === 'ARMY_MOVE' || after.kind === 'CHOOSE_ATTACK' || (after.kind === 'CARD_CHOICE' && (after.card ?? after.opt?.card ?? null) === card))) return { more: true };
  // The figures that go along (ARMY_SELECTION after the move's answer, Rage of the Dunlendings' units): this engine's
  // `move` selection of the target.
  const chosen = best[0];
  if (chosen.from && steps[k]?.kind === 'ARMY_SELECTION' && steps[k].side === last.side) {
    const end = selectionEnd(steps, k - 1, next);
    if (end === null) return { more: true };
    // (An attack moves nothing before the battle, Corsairs of Umbar's landing: the selections' counts.)
    const moved = steps.slice(0, end + 1).some((x) => x.events.some((e) => e.kind === 'army_moved'));
    const move = moved ? movedSel(steps.slice(0, end + 1), chosen.from) : countedSel(steps.slice(k, end + 1), state, chosen.from);
    return ACTS([step({ ...chosen, move })], end + 1, "the figures of a card's move");
  }
  return ACTS([step(chosen)], k);
}

// --- This engine's action as the referee's options ("expand") -------------------------------------------------------
// The AI's action is one action here; the referee may ask it in several steps. A Plan answers each of the referee's
// decisions the action covers, one at a time (`answer(decision)`: the option, or null once the action is answered).

const pick = (options, pred) => options.find(pred) ?? null;
const faceIs = (o, face) => !face || o.face === N.pFace(face);
function useDie(options, face, pred) {
  return pick(options, (o) => o.kind === 'use_die' && faceIs(o, face) && pred(o)) ?? pick(options, (o) => o.kind === 'use_die' && pred(o));
}

/** How many of a selection's group go (an Army's split, an attack's rearguard, an advance). */
function countFor(d, sel, rearguard, leaders) {
  const counts = d.options.filter((o) => o.kind === 'count').map((o) => o.count);
  const c = d.context ?? {};
  const optOf = (n) => d.options.find((o) => o.kind === 'count' && o.count === n);
  const max = Math.max(...counts);
  if (!sel) return optOf(max);
  let named;
  const charOpt = d.options.find((o) => o.kind === 'count' && o.character);
  if (charOpt || c.character) {
    const ch = N.char(c.character ?? charOpt.character);
    const listed = (sel.characters ?? []).includes(ch);
    named = listed ? 1 : 0;
    const want = rearguard ? 1 - named : named;
    return optOf(want) ?? optOf(max);
  }
  const avail = c.available ?? max;
  if (c.unit === 'leader') { named = Math.min(avail, leaders.left); leaders.left -= named; }
  else if (c.unit === 'nazgul') named = sel.nazgul ?? 0;
  else named = sel.units?.[N.nation(c.nation)]?.[c.unit] ?? 0;
  let want = rearguard ? avail - named : named;
  if (!counts.includes(want)) want = counts.reduce((b, x) => (Math.abs(x - want) < Math.abs(b - want) ? x : b), counts[0]);
  return optOf(want);
}

export class Plan {
  constructor(action, face, side) {
    this.action = action;
    this.face = face;
    this.side = side;
    this.stage = 0;
    this.leaders = { left: action.move?.leaders ?? action.rearguard?.leaders ?? 0 };
    this.moved = 0;
    this.region = null; // a follow-up this engine asks next, looked ahead (Gandalf's region, a retreat's)
    this.words = null;
  }

  /** The option for decision `d`, or null when the action does not cover it (it is answered). */
  answer(d) {
    if (d.side !== N.pSide(this.side)) return null;
    const a = this.action;
    const ops = d.options;
    const k = d.kind;
    const first = this.stage === 0;
    let r = this.answer0(a, ops, k, first, d);
    // The next answer of a chain this engine asks right after (a card's Nazgûl, then where they fly).
    if (!r && this.chain?.length && this.stage > 0) {
      this.action = this.chain.shift();
      this.stage = 0;
      this.words = null;
      r = this.answer0(this.action, ops, k, true, d);
    }
    if (r) this.stage++;
    return r;
  }

  answer0(a, ops, k, first, d) {
    const F = this.face;
    switch (a.kind) {
      case 'skipFellowshipPhase': return k === 'FELLOWSHIP_PHASE' ? pick(ops, (o) => o.kind === 'done') : null;
      case 'declareFellowship': return first && k === 'FELLOWSHIP_PHASE' ? pick(ops, (o) => o.kind === 'declare' && o.region === N.pRegion(a.target)) : null;
      case 'enterMordor': return first && k === 'FELLOWSHIP_PHASE' ? pick(ops, (o) => o.kind === 'enter_mordor') : null;
      case 'changeGuide':
        if (k !== 'FELLOWSHIP_PHASE') return null;
        // Naming the Guide ends the phase here; the referee's phase goes on until it is ended.
        return first ? pick(ops, (o) => o.kind === 'guide' && o.character === N.pChar(a.companion)) : pick(ops, (o) => o.kind === 'done');
      case 'allocateHunt': {
        if (!first || k !== 'HUNT_ALLOCATION') return null;
        const opts = ops.filter((o) => o.kind === 'hunt_dice');
        return opts.find((o) => o.count === a.dice) ?? opts.reduce((b, o) => (Math.abs(o.count - a.dice) < Math.abs(b.count - a.dice) ? o : b), opts[0]) ?? null;
      }
      case 'discardCard': return first && k === 'DISCARD_EXCESS_CARD' ? pick(ops, (o) => o.kind === 'discard' && o.card === N.pCard(a.card)) : null;
      case 'pass': return first && k === 'ACTION' ? pick(ops, (o) => o.kind === 'pass') : null;
      case 'skipDie': return first && k === 'ACTION' ? pick(ops, (o) => o.kind === 'skip_die' && o.face === N.pFace(a.face)) : null;
      case 'useElvenRing': return first && k === 'ACTION' ? pick(ops, (o) => o.kind === 'elven_ring' && o.from === N.pFace(a.from) && o.to === N.pFace(a.to)) : null;
      case 'moveFellowship': return first && k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'move_fellowship') : null;
      case 'hideFellowship': return first && k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'hide_fellowship' || o.action === 'hide_fellowship_strider') : null;
      case 'drawEvent': return first && k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'draw_card' && o.deck === a.deck) : null;
      case 'playEvent':
        if (!first) return null;
        if (k === 'ACTION') return useDie(ops, F, (o) => o.action === 'play_card' && o.card === N.pCard(a.cardId));
        if (k === 'CARD_CHOICE') return pick(ops, (o) => o.answer === N.pCard(a.cardId) || o.target_card === N.pCard(a.cardId) || o.card_choice === N.pCard(a.cardId));
        return null;
      case 'diplomaticAction': return first && k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'diplomacy' && o.nation === N.pNation(a.nation)) : null;
      case 'companionMuster': return first && k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'companion_politics' && o.character === N.pChar(a.companion)) : null;
      case 'bringUpgrade': case 'placeGandalf': {
        if (!first || k !== 'ACTION') return null;
        const which = a.kind === 'placeGandalf' ? 'gandalf-the-white' : N.pChar(a.which);
        const region = a.kind === 'placeGandalf' ? a.region : this.region;
        const opts = ops.filter((o) => o.kind === 'use_die' && o.action === 'play_companion' && o.character === which);
        return opts.find((o) => region && o.region === N.pRegion(region) && faceIs(o, 'will')) ?? opts.find((o) => region && o.region === N.pRegion(region)) ?? opts[0] ?? null;
      }
      case 'bringMinion': return first && k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'play_minion' && o.character === N.pChar(a.minion) && o.region === N.pRegion(a.region)) : null;
      case 'sarumanMuster': return first && k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'voice_of_saruman' && !!o.upgrade === (a.mode === 'upgrade')) : null;
      case 'forceDiscardCard': {
        if (!first || k !== 'ACTION') return null;
        const pay = [a.discardStrategy, a.discardCharacter].filter(Boolean).map(N.pCard).sort();
        return useDie(ops, F, (o) => o.action === 'force_discard' && o.card === N.pCard(a.cardId) && !!o.elven_ring === (a.via === 'ring')
          && !!o.any_die === (a.via !== 'will') && same([...(o.pay ?? [])].sort(), pay));
      }
      case 'recruitUnit': {
        if (first) return k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'recruit') : null;
        if (k !== 'RECRUIT') return null;
        if (this.stage === 1) {
          const unit = a.nazgul ? 'nazgul' : a.leader ? 'leader' : a.elite ? 'elite' : 'regular';
          return pick(ops, (o) => o.kind === 'recruit' && o.region === N.pRegion(a.region) && o.unit === unit)
            ?? pick(ops, (o) => o.kind === 'recruit' && o.region === N.pRegion(a.region) && (unit === 'nazgul' ? o.unit === 'leader' : unit === 'leader' && o.unit === 'nazgul'));
        }
        // A single figure: the referee may ask for a second, this engine does not.
        return this.stage === 2 && !a.then ? pick(ops, (o) => o.kind === 'end') : null;
      }
      case 'recruitSecond': {
        if (!first || k !== 'RECRUIT') return null;
        if (a.done) return pick(ops, (o) => o.kind === 'end');
        return pick(ops, (o) => o.kind === 'recruit' && o.region === N.pRegion(a.region) && (a.figure === 'regular' ? o.unit === 'regular' : o.unit !== 'regular' && o.unit !== 'elite'));
      }
      case 'moveArmy': case 'armyMove2': {
        if (a.kind === 'moveArmy' && first) return k === 'ACTION' ? useDie(ops, F, (o) => o.action === (F === 'character' ? 'move_army_with_leader' : 'move_armies')) ?? useDie(ops, F, (o) => o.action === 'move_armies' || o.action === 'move_army_with_leader') : null;
        const moveStage = a.kind === 'moveArmy' ? 1 : 0;
        if (this.stage === moveStage) {
          if (k !== 'ARMY_MOVE') return null;
          if (a.done) return pick(ops, (o) => o.kind === 'end');
          const cands = ops.filter((o) => o.kind === 'army_move' && o.from === N.pRegion(a.from) && o.to === N.pRegion(a.to));
          const whole = cands.find((o) => o.all !== false), split = cands.find((o) => o.all === false);
          this.split = !!(a.move && split) || !whole;
          return this.split ? split ?? whole : whole;
        }
        if (k === 'ARMY_SELECTION' && this.split) return countFor(d, a.move ?? null, false, this.leaders);
        return null;
      }
      case 'attack': {
        if (first) return k === 'ACTION' ? useDie(ops, F, (o) => o.action === (F === 'character' ? 'attack_with_leader' : 'attack')) ?? useDie(ops, F, (o) => o.action === 'attack' || o.action === 'attack_with_leader') : null;
        if (this.stage === 1) {
          if (k !== 'CHOOSE_ATTACK') return null;
          const cands = ops.filter((o) => o.kind === 'attack' && o.from === N.pRegion(a.from) && o.to === N.pRegion(a.to));
          const whole = cands.find((o) => o.all !== false), split = cands.find((o) => o.all === false);
          this.split = !!(a.rearguard && split) || !whole;
          return this.split ? split ?? whole : whole;
        }
        if (k === 'ARMY_SELECTION' && this.split) return countFor(d, a.rearguard ?? null, true, this.leaders);
        return null;
      }
      case 'moveCharacter': {
        if (first && k === 'ACTION') return useDie(ops, F, (o) => o.action === (this.side === 'shadow' ? 'move_minions' : 'move_companions'));
        if (a.char === 'nazgul') {
          if (k !== 'MOVE_MINIONS') return null;
          const count = a.count ?? 99;
          const sel = pick(ops, (o) => o.kind === 'select_nazgul' && o.from === N.pRegion(a.from));
          const mv = pick(ops, (o) => o.kind === 'move_nazgul' && o.from === N.pRegion(a.from) && o.to === N.pRegion(a.to));
          if (mv) { this.moved++; return mv; }
          if (sel && this.moved < count) return sel;
          return null;
        }
        if (this.side === 'shadow') {
          if (k !== 'MOVE_MINIONS') return null;
          return pick(ops, (o) => o.kind === 'move_minion' && o.character === N.pChar(a.char) && o.to === N.pRegion(a.to))
            ?? (this.moved++ ? null : pick(ops, (o) => o.kind === 'select_minion' && o.character === N.pChar(a.char)));
        }
        if (k === 'MOVE_COMPANIONS' && !this.moved) { this.moved++; return pick(ops, (o) => o.kind === 'move_companion' && o.character === N.pChar(a.char) && o.to === N.pRegion(a.to)); }
        if (k === 'JOIN_GROUP') {
          const asked = N.char(d.context?.character ?? ops[0]?.character);
          const join = (a.chars ?? []).includes(asked);
          return pick(ops, (o) => o.kind === (join ? 'join' : 'stay'));
        }
        return null;
      }
      case 'charMove2': return first && (k === 'MOVE_MINIONS' || k === 'MOVE_COMPANIONS') ? pick(ops, (o) => o.kind === 'end') : null;
      case 'separateCompanion':
        if (first) return k === 'ACTION' ? useDie(ops, F, (o) => o.action === 'separate_companions') : null;
        return this.stage === 1 && k === 'SEPARATE_COMPANIONS' ? pick(ops, (o) => o.kind === 'separate' && o.character === N.pChar(a.companion)) : null;
      case 'separateMove':
        if (!first || k !== 'SEPARATE_COMPANIONS') return null;
        if (a.companion && !a.target) return pick(ops, (o) => o.kind === 'separate' && o.character === N.pChar(a.companion));
        return pick(ops, (o) => o.kind === 'separate_to' && o.to === N.pRegion(a.target));
      case 'removeExcess':
        return first && k === 'REMOVE_EXCESS_UNIT' ? pick(ops, (o) => o.kind === 'remove_unit' && o.nation === N.pNation(a.nation) && o.unit === a.figure) ?? pick(ops, (o) => o.kind === 'remove_unit' && o.nation === N.pNation(a.nation)) : null;
      // --- Battles ---
      case 'whiteRider': return first && k === 'WHITE_RIDER' ? pick(ops, (o) => o.kind === (a.forfeit ? 'use' : 'skip')) : null;
      case 'siegeWithdraw': return first && k === 'FIELD_OR_SIEGE' ? pick(ops, (o) => o.kind === (a.withdraw ? 'siege' : 'field')) : null;
      case 'playCombatCard': return first && k === 'COMBAT_CARD' ? (a.cardId ? pick(ops, (o) => o.kind === 'combat_card' && o.card === N.pCard(a.cardId)) : pick(ops, (o) => o.kind === 'none')) : null;
      case 'casualtyStep': {
        if (!first || k !== 'CASUALTY') return null;
        const unit = a.step === 'removeRegular' ? 'regular' : 'elite';
        const effect = a.step === 'reduceElite' ? 'reduce' : 'remove';
        return pick(ops, (o) => o.kind === 'casualty' && o.nation === N.pNation(a.nation) && o.unit === unit && o.effect === effect)
          ?? pick(ops, (o) => o.kind === 'casualty' && o.nation === N.pNation(a.nation) && o.unit === unit);
      }
      case 'combatContinue': return first && k === 'CEASE_ATTACK' ? pick(ops, (o) => o.kind === (a.cont ? 'continue' : 'cease')) : null;
      case 'combatRetreat':
        if (!first || k !== 'RETREAT') return null;
        if (!a.retreat) return pick(ops, (o) => o.kind === 'stand');
        return pick(ops, (o) => o.kind === 'retreat' && this.region && o.region === N.pRegion(this.region)) ?? pick(ops, (o) => o.kind === 'retreat');
      case 'retreatTo': return first && k === 'RETREAT' ? pick(ops, (o) => o.kind === 'retreat' && o.region === N.pRegion(a.region)) : null;
      case 'siegeExtend': return first && k === 'EXTEND_SIEGE' ? pick(ops, (o) => o.kind === (a.extend ? 'extend' : 'stop')) : null;
      case 'advanceChoice': case 'besiegerAdvance': case 'relieveAdvance': {
        if (first) {
          if (k !== 'ADVANCE') return null;
          if (!a.advance) return pick(ops, (o) => o.kind === 'stay');
          const whole = pick(ops, (o) => o.kind === 'advance' && o.all !== false), split = pick(ops, (o) => o.kind === 'advance' && o.all === false);
          this.split = !!(a.move && split) || !whole;
          return this.split ? split ?? whole : whole;
        }
        return k === 'ARMY_SELECTION' && this.split ? countFor(d, a.move ?? null, false, this.leaders) : null;
      }
      // --- The Hunt ---
      case 'huntDamage': {
        // The referee asks up to three questions: a table card against the tile, the Guide's ability, the casualty.
        if (k === 'CARD_CHOICE' && this.hunt0 !== 'card') {
          this.hunt0 = 'card';
          if (a.mode === 'reduceCard') return pick(ops, (o) => o.answer === N.pCard(a.card) || o.target_card === N.pCard(a.card) || o.card === N.pCard(a.card) && o.answer !== 'skip');
          return pick(ops, (o) => o.answer === 'skip' || o.skip === true);
        }
        if (k === 'GUIDE_ABILITY' && !this.huntGuide) {
          this.huntGuide = true;
          return pick(ops, (o) => o.kind === (a.mode === 'reduceSeparate' || a.mode === 'reduceReveal' ? 'use' : 'skip'));
        }
        if (k === 'HUNT_CASUALTY' && !this.huntCasualty && a.mode !== 'reduceSeparate' && a.mode !== 'reduceReveal' && a.mode !== 'reduceCard') {
          this.huntCasualty = true;
          return pick(ops, (o) => o.kind === (a.mode === 'guide' ? 'guide' : a.mode === 'random' ? 'random' : 'corruption'));
        }
        return null;
      }
      case 'revealMove': {
        if (!first || k !== 'REVEAL_FELLOWSHIP') return null;
        const opts = ops.filter((o) => o.kind === 'reveal' && o.region === N.pRegion(a.target));
        // This engine's route: the fewest Shadow Strongholds, then not through Moria.
        const least = Math.min(...opts.map((o) => o.strongholds ?? -1));
        const best = opts.filter((o) => (o.strongholds ?? -1) === least);
        return best.find((o) => !o.through_moria) ?? best[0] ?? null;
      }
      case 'huntRedraw': case 'huntPreventDraw': {
        if (!first || k !== 'CARD_CHOICE') return null;
        const card = a.kind === 'huntRedraw' ? MITHRIL : WIZARDS_STAFF;
        const use = a.kind === 'huntRedraw' ? a.redraw : a.prevent;
        return use ? pick(ops, (o) => (o.answer === N.pCard(card) || o.target_card === N.pCard(card))) : pick(ops, (o) => o.answer === 'skip' || o.skip === true);
      }
      case 'guideDraw': case 'sorcererDraw': case 'bonusDraw': {
        // The official rules let a "may draw" be declined (`skip`); before them this engine's "no" drew as well.
        if (!first || k !== 'CARD_CHOICE') return null;
        const decline = a.draw === false || a.deck === 'none';
        const skipOption = ops.find((o) => o.kind === 'draw' && o.skip === true);
        if (decline && skipOption) return skipOption;
        const draws = ops.filter((o) => o.kind === 'draw' && !o.skip);
        if (!draws.length) return null;
        return draws.find((o) => o.deck === a.deck) ?? draws[0];
      }
    }
    if (CARD_KINDS.has(a.kind)) return this.cardAnswer(a, d);
    return null;
  }

  /** A card's answer of this engine as the referee's card questions, with the follow-ups the one answer covers. */
  cardAnswer(a, d) {
    const ops = d.options;
    const k = d.kind;
    if (!this.words) {
      this.words = answerWords(a);
      this.progress = false;
      this.movedArmy = false;
    }
    const words = this.words;
    const companion = a.companion ? N.pChar(a.companion) : null;
    const region = a.region ? N.pRegion(a.region) : null;
    switch (k) {
      case 'SEPARATE_COMPANIONS':
        if (companion && !region) return pick(ops, (o) => o.kind === 'separate' && o.character === companion);
        if (region) return pick(ops, (o) => o.kind === 'separate_to' && o.to === region);
        if (words.has('skip')) { const only = ops.filter((o) => o.kind === 'separate_to'); return only.length === 1 ? only[0] : null; }
        return null;
      case 'JOIN_GROUP': {
        const asked = N.char(d.context?.character ?? ops[0]?.character);
        return pick(ops, (o) => o.kind === ((a.group ?? []).includes(asked) ? 'join' : 'stay'));
      }
      case 'ARMY_MOVE': case 'CHOOSE_ATTACK': {
        if (this.movedArmy || !a.from) return null;
        const to = a.to ?? a.region;
        if (!to) return null;
        const kind = k === 'ARMY_MOVE' ? 'army_move' : 'attack';
        const cands = ops.filter((o) => o.kind === kind && o.from === N.pRegion(a.from) && o.to === N.pRegion(to));
        const sel = k === 'ARMY_MOVE' ? a.move : a.rearguard;
        const whole = cands.find((o) => o.all !== false), split = cands.find((o) => o.all === false);
        this.split = !!(sel && split) || !whole;
        this.movedArmy = true;
        this.progress = true;
        this.words = new Set();
        return this.split ? split ?? whole : whole;
      }
      case 'ARMY_SELECTION':
        if (!this.progress) return null;
        return countFor(d, this.split ? (a.move ?? a.rearguard ?? null) : null, !!a.rearguard && !a.move, this.leaders);
      case 'MOVE_MINIONS': {
        if (this.progress && !this.minionLeft) return null;
        const figure = a.companion;
        if (!figure) {
          // The end of the card's moves: its answer is spent (the card's next question is another answer's).
          if (words.has('skip')) { this.progress = true; this.words = new Set(); return pick(ops, (o) => o.kind === 'end'); }
          if (a.from) return pick(ops, (o) => o.kind === 'end');
          return null;
        }
        const from = N.pRegion(a.from);
        if (!a.region) return figure === 'nazgul' ? pick(ops, (o) => o.kind === 'select_nazgul' && o.from === from) : pick(ops, (o) => o.kind === 'select_minion' && o.character === N.pChar(figure));
        if (figure === 'nazgul') {
          this.minionLeft ??= a.count ?? 1;
          const mv = pick(ops, (o) => o.kind === 'move_nazgul' && o.from === from && o.to === region);
          if (mv) { this.minionLeft--; this.progress = true; return mv; }
          return this.minionLeft > 0 ? pick(ops, (o) => o.kind === 'select_nazgul' && o.from === from) : null;
        }
        const mv = pick(ops, (o) => o.kind === 'move_minion' && o.character === N.pChar(figure) && o.to === region);
        if (mv) { this.minionLeft = 0; this.progress = true; return mv; }
        return pick(ops, (o) => o.kind === 'select_minion' && o.character === N.pChar(figure));
      }
      case 'MOVE_COMPANIONS': {
        if (this.progress) return null;
        if (!companion) return words.has('skip') ? pick(ops, (o) => o.kind === 'end') : null;
        const to = region ?? (a.to ? N.pRegion(a.to) : null);
        this.progress = true;
        this.words = new Set();
        return pick(ops, (o) => o.kind === 'move_companion' && o.character === companion && o.to === to);
      }
      case 'CARD_CHOICE': {
        if (this.progress && words.size === 0) return null;
        if (companion && region && a.from) {
          const mv = pick(ops, (o) => o.kind === 'move_companion' && o.character === companion && o.to === region);
          if (mv) { this.progress = true; this.words = new Set(); return mv; }
        }
        if (companion && !region) {
          const sep = pick(ops, (o) => o.answer === 'separate');
          if (sep) return sep;
        }
        const cards = ops.filter((o) => o.kind === 'card_choice' && o.answer != null);
        if (this.progress && d.context?.question === 'Which way?') {
          const path = Array.isArray(a.path) ? a.path.map(N.pRegion).join('>') : null;
          return cards.find((o) => o.answer === path || (path && path.endsWith(`>${o.answer}`))) ?? cards[0] ?? null;
        }
        const fits = cards.filter((o) => containsAll(words, refWords(o.answer)) && inOrder(o.answer, a));
        let choice = null;
        if (fits.length) {
          const best = Math.max(...fits.map((o) => refWords(o.answer).size));
          choice = fits.find((o) => refWords(o.answer).size === best);
        } else if (this.progress && cards.length && cards.every((o) => !Number.isNaN(Number(o.answer))) && ![...words].some((w) => !Number.isNaN(Number(w)))) {
          choice = cards.reduce((b, o) => (Number(o.answer) > Number(b.answer) ? o : b), cards[0]); // as many as it may
        } else {
          if (this.progress) return null;
          choice = cards.find((o) => containsAll(refWords(o.answer), words) && words.size && inOrder(o.answer, a)) ?? null;
        }
        if (!choice) return null;
        this.words = new Set(minus(words, refWords(choice.answer)));
        this.progress = true;
        return choice;
      }
      case 'COMBAT_CARD': case 'CASUALTY': return null;
    }
    return null;
  }
}

// --- Which of this engine's questions is the referee's --------------------------------------------------------------

/** Whether this engine's open decision `here` is the referee's decision `d` (the same procedure, the same side). */
export function corresponds(here, d, inCard) {
  if (here.actor !== N.side(d.side)) return false;
  const k = here.kind;
  if (CARD_KINDS.has(k) && inCard && CARD_FLOW.has(d.kind) && d.kind !== 'ARMY_SELECTION' && d.kind !== 'JOIN_GROUP') return true;
  switch (d.kind) {
    case 'FELLOWSHIP_PHASE': return !k && here.phase === 'fellowship';
    case 'HUNT_ALLOCATION': return !k && here.phase === 'huntAllocation';
    case 'ACTION': return (!k && here.phase === 'actionResolution') || k === 'placeGandalf';
    case 'DISCARD_EXCESS_CARD': return k === 'discardCard';
    case 'ARMY_MOVE': return k === 'armyMove2';
    case 'RECRUIT': return k === 'musterSecond';
    case 'REMOVE_EXCESS_UNIT': return k === 'removeExcess';
    case 'MOVE_MINIONS': case 'MOVE_COMPANIONS': return k === 'charMove2';
    case 'SEPARATE_COMPANIONS': return k === 'separateMove';
    case 'WHITE_RIDER': return k === 'whiteRider';
    case 'FIELD_OR_SIEGE': return k === 'siegeWithdraw';
    case 'COMBAT_CARD': return k === 'combatCard';
    case 'CASUALTY': return k === 'combatCasualties' || k === 'eventCasualties';
    case 'CEASE_ATTACK': return k === 'combatContinue';
    case 'RETREAT': return k === 'combatRetreat' || k === 'retreatTo';
    case 'EXTEND_SIEGE': return k === 'siegeExtend';
    case 'ADVANCE': case 'ARMY_SELECTION': return k === 'advanceChoice' || k === 'besiegerAdvance' || k === 'relieveAdvance';
    case 'GUIDE_ABILITY': case 'HUNT_CASUALTY': return k === 'huntDamage';
    case 'REVEAL_FELLOWSHIP': return k === 'revealMove';
    case 'CARD_CHOICE': {
      const card = d.context?.card ? N.card(d.context.card) : null;
      if (card === MITHRIL && k === 'huntRedraw') return true;
      if (card === WIZARDS_STAFF && k === 'huntPreventDraw') return true;
      if (d.context?.tile !== undefined) return k === 'huntDamage' || k === 'huntRedraw' || k === 'huntPreventDraw';
      if (d.options.some((o) => o.kind === 'draw')) return k === 'bonusDraw' || k === 'guideDraw' || k === 'sorcererDraw';
      return CARD_KINDS.has(k) || k === 'combatCardCost' || k === 'freeCharEvent';
    }
  }
  return false;
}

/** The answer to the referee's decision `d` when this engine has none for it: the only option, the one ending the procedure, else a plain default. */
export function defaultAnswer(d) {
  const ops = d.options;
  if (ops.length === 1) return ops[0];
  const find = (kind) => ops.find((o) => o.kind === kind);
  switch (d.kind) {
    case 'ARMY_SELECTION': return ops.reduce((b, o) => (o.count > b.count ? o : b), ops[0]);
    case 'ARMY_MOVE': case 'RECRUIT': case 'MOVE_MINIONS': case 'MOVE_COMPANIONS': return find('end') ?? ops[0];
    case 'FELLOWSHIP_PHASE': return find('done') ?? ops[0];
    case 'REMOVE_EXCESS_UNIT': return ops.find((o) => o.unit === 'regular') ?? ops[0];
    case 'COMBAT_CARD': return find('none') ?? ops[0];
    case 'CASUALTY': return ops.find((o) => o.unit === 'regular') ?? ops.find((o) => o.effect === 'reduce') ?? ops[0];
    case 'RETREAT': return find('stand') ?? ops[0];
    case 'CEASE_ATTACK': return find('continue') ?? ops[0];
    case 'HUNT_CASUALTY': return find('corruption') ?? ops[0];
    case 'GUIDE_ABILITY': case 'WHITE_RIDER': return find('skip') ?? ops[0];
    case 'ADVANCE': return find('advance') ?? ops[0];
    case 'JOIN_GROUP': return find('join') ?? ops[0];
    case 'CARD_CHOICE': {
      if (d.context?.card === 'sh-char-15') return ops.find((o) => o.answer === 'hand') ?? ops[0]; // Worn with Sorrow and Toil
      return ops.find((o) => o.answer === 'skip' || o.skip === true) ?? ops.find((o) => o.answer === '0') ?? ops[0];
    }
  }
  return ops[0];
}

// --- One game: the lock step and the decisions ----------------------------------------------------------------------

class Desync extends Error {}
const TOP_LEVEL = new Set(['ACTION', 'FELLOWSHIP_PHASE', 'HUNT_ALLOCATION']);
const ARMY_DIE_ACTIONS = new Set(['move_armies', 'attack', 'move_army_with_leader', 'attack_with_leader']);

/** A 32-bit seed from the referee's `seed_bot` (any size). */
const seed32 = (n) => Number(BigInt.asUintN(32, BigInt(Math.trunc(Number(n ?? 1)))));

export class Game {
  constructor(msg, opts = {}) {
    const { Rng, createGame } = E;
    this.id = msg.game;
    this.side = N.side(msg.side);
    this.clock = msg.clock ?? null;
    // The official rules (#1371): the Leader re-roll is asked after the Combat roll, so its dice come later.
    this.official = msg.official_rules === true;
    followHidden = this.official && msg.hidden_passes !== false;
    // A battle's second side's Combat roll, kept back until the first side's re-roll is known (combatStash).
    this.combatStash = null;
    const seed = seed32(opts.seed ?? msg.seed_bot ?? 1);
    this.rng = new Rng(seed);
    // The Shadow AI's campaign roll for the game, as its setup derives one from a seed (src/engine/setup.ts).
    this.planRoll = Math.abs(Math.imul(seed ^ 0x9e3779b9, 2654435761)) % 100;
    this.state = createGame({ seed });
    this.state.shadowPlanRoll = this.planRoll;
    // A game from a position (the referee's position suite: start "position", the bot's view of it): this engine's
    // state built from that view, the side to act as the view says; no setup events follow.
    this.fromPosition = msg.start === 'position' && !!msg.view;
    if (this.fromPosition) this.state = stateFromView(msg.view, {}, this.planRoll);
    clearQueues();
    this.steps = [];
    this.last = null;
    this.randoms = [];
    this.held = [];
    this.deferred = [];
    this.desynced = null;
    this.plan = null;
    this.earlyReveal = null;
    this.flags = {};
    this.cardInPlay = false;
    this.inBattle = false;
    this.ownCtx = null;
    this.hidden = null; // the opponent's face-down Combat card, a stand-in here until the reveal
    this.stats = { decisions: 0, ai: 0, plan: 0, forced: 0, rule: 0, fallback: 0, desyncs: 0, rebuilds: 0, differences: 0, errors: 0, ms: 0 };
    this.notes = new Map();
  }

  note(text) {
    this.notes.set(text, (this.notes.get(text) ?? 0) + 1);
    debug(`[${this.id}] ${text}`);
  }

  pending() { return pendingOf(this.state); }

  // --- The event stream ---

  event(e) {
    if (e.kind === 'choice') {
      this.feedRandoms();
      // A card move's route ("Which way?", asked after the Army's move when it has several): the bot's own from the
      // question; the opponent's an answer ending where the card's move just before it went, from elsewhere.
      const prev = this.last;
      const route = (N.side(e.side) === this.side && this.ownCtx?.kind === e.decision && this.ownCtx.ctx?.question === 'Which way?') ||
        (N.side(e.side) !== this.side && e.decision === 'CARD_CHOICE' && prev?.kind === 'CARD_CHOICE' && prev.side === N.side(e.side) &&
          prev.opt.card === e.option?.card && isRouteAfter(e.option?.answer, prev.opt.answer));
      this.drain({ side: N.side(e.side), kind: e.decision, opt: e.option, card: e.option?.card ?? null, route });
      const st = {
        side: N.side(e.side), kind: e.decision, o: e.o, opt: { ...e.option }, events: [],
        inCard: this.cardInPlay && !TOP_LEVEL.has(e.decision), inBattle: this.inBattle, ctx: null,
      };
      if (e.option?.hidden) st.opt.hidden = true;
      // Mighty Attack's Companion, known before the steps waiting for the re-roll's dice are made (followOptions).
      if (e.decision === 'CARD_CHOICE' && MIGHTY_ATTACK.has(N.card(e.option?.card ?? '')) && e.option?.character) {
        forfeit = { side: st.side, n: leadershipOf(N.char(e.option.character)) };
      }
      if (st.side === this.side && this.ownCtx?.kind === e.decision) { st.ctx = this.ownCtx.ctx; st.forced = this.ownCtx.forced; this.ownCtx = null; }
      if (TOP_LEVEL.has(e.decision)) this.cardInPlay = false;
      st.route = route;
      st.dice = viewDice;
      this.steps.push(st);
      this.last = st;
      return;
    }
    if (e.kind.startsWith('random_')) {
      // The round's Combat roll: the casualties before it (preCombat) are complete.
      if (e.kind === 'random_roll' && e.roll === 'combat' && this.preCombat) { this.lastPreCombat = this.preCombat; this.preCombat = null; }
      this.randoms.push(e);
      return;
    }
    this.last?.events.push(e);
    switch (e.kind) {
      case 'turn_started': this.flags = {}; this.huntRest = false; this.cardCasualty = false; break;
      // A card's forced Hunt casualty (Foul Thing from the Deep) and then the rest as Corruption at once (maybe after a
      // new Guide's choice): for silentDefault.
      case 'companion_lost_to_hunt': this.cardCasualty = !!e.card; break;
      // Casualties before a round's Combat roll (a card's attack before it): already taken when CASUALTY is asked.
      case 'combat_cards_revealed': this.preCombat = []; forfeit = null; break;
      case 'casualty_taken': this.preCombat?.push(e); break;
      case 'corruption_changed':
        if (this.cardCasualty) { this.huntRest = true; this.cardCasualty = false; }
        break;
      case 'fellowship_declared': this.flags.declared = true; this.flags.fellowshipActed = true; break;
      case 'fellowship_moved': case 'fellowship_hidden': this.flags.fellowshipActed = true; break;
      case 'die_used':
        if (e.side === 'SHADOW' && e.face === 'MUSTER' && ARMY_DIE_ACTIONS.has(e.action?.action)) this.flags.messengerUsed = true;
        break;
      case 'card_played': this.cardInPlay = true; break;
      // (A view of an earlier battle says nothing about this one's attackers: battleView.)
      case 'battle_started': this.inBattle = true; battleView = null; break;
      case 'battle_ended': this.inBattle = false; battleView = null; break;
    }
  }

  /** The referee's random outcomes since the last step, into the queues, in the order this engine asks for them. */
  feedRandoms() {
    if (!this.randoms.length) return;
    const before = Object.fromEntries(Object.entries(queues).map(([k, q]) => [k, q.length]));
    const cardsBefore = cardQueue.length;
    this.feedRandoms0();
    // While the opponent's face-down Combat card is a stand-in: what came since, for making the battle again.
    if (this.hidden) {
      for (const k of Object.keys(queues)) this.hidden.fed[k].push(...queues[k].slice(before[k]));
      this.hidden.fedCards.push(...cardQueue.slice(cardsBefore));
    }
  }

  feedRandoms0() {
    const rolls = []; // [side, kind, dice]
    for (const e of this.randoms) {
      switch (e.kind) {
        case 'random_action_dice': queues.faces.push(...e.faces.map(N.face)); break;
        case 'random_card_draw': cardQueue.push({ side: N.side(e.side), deck: e.deck, card: e.card ? N.card(e.card) : null }); break;
        case 'random_hunt_tile': queues.tiles.push(N.tile(e.tile)); break;
        case 'random_companion': queues.picks.push(N.char(e.character)); break;
        case 'random_hand_card': {
          const side = N.side(e.side);
          const card = N.card(e.card);
          if (side !== this.side) swapIntoHand(this.state, side, card);
          queues.picks.push(card);
          break;
        }
        case 'random_roll': {
          // The referee rolls both sides' Combat dice, then both re-roll; this engine one side with its re-roll, then
          // the other.
          if (e.roll === 'leader_reroll') {
            let at = -1;
            for (let i = rolls.length - 1; i >= 0; i--) if (rolls[i][0] === e.side && rolls[i][1] === 'combat') { at = i; break; }
            rolls.splice(at >= 0 ? at + 1 : rolls.length, 0, [e.side, e.roll, e.dice]);
          } else rolls.push([e.side ?? null, e.roll, e.dice]);
          break;
        }
      }
    }
    // By the official rules the re-roll's dice come after both Combat rolls, in a later batch: the second side's roll
    // waited (combatStash) and goes after the first side's re-roll, as this engine rolls them.
    if (this.combatStash) {
      const i = rolls.findIndex((r) => r[1] === 'leader_reroll' && r[0] === this.combatStash.first);
      const first = i >= 0 ? rolls.splice(i, 1) : [];
      rolls.unshift(...first, ...this.combatStash.rolls);
      this.combatStash = null;
    }
    const combat = rolls.map((r, i) => [r, i]).filter(([r]) => r[1] === 'combat');
    if (this.official && combat.length === 2 && combat[0][0][0] !== combat[1][0][0] && !rolls.some((r) => r[1] === 'leader_reroll')) {
      const at = combat[1][1];
      this.combatStash = { first: combat[0][0][0], rolls: rolls.splice(at) };
    }
    for (const [, , d] of rolls) queues.d6.push(...d);
    this.randoms = [];
  }

  /** The second side's Combat roll that waited for the first side's re-roll: no re-roll came (none for that side). */
  flushCombatStash() {
    if (!this.combatStash) return;
    for (const [, , d] of this.combatStash.rolls) queues.d6.push(...d);
    this.combatStash = null;
  }

  // --- The lock step ---

  drain(next) {
    if (this.desynced) { this.steps = []; return; }
    try {
      this.drainSteps(next);
    } catch (e) {
      if (!(e instanceof Desync)) throw e;
      this.desync(e.message);
    }
  }

  desync(why) {
    this.stats.desyncs++;
    this.note(`out of step until the next clean decision: ${why.slice(0, 200)}`);
    this.desynced = why;
    this.steps = [];
    this.held = [];
    this.deferred = [];
    this.earlyReveal = null;
    this.plan = null;
  }

  drainSteps(next) {
    for (let guard = 0; guard < 400; guard++) {
      const here = this.pending();
      if (here.winner) { this.steps = []; return; }
      if (this.held.length) {
        if (!this.applyHis(this.held[0], true)) {
          // Later steps wait behind it; they are collapsed now so that their actions queue up in order.
          while (this.steps.length) {
            // A card's question (a Combat card's cost) is read against this engine's question then: it waits.
            if (this.steps[0].kind === 'CARD_CHOICE') break;
            const r = collapse(this.steps, here, this.state, next);
            if (r.acts) { const side = this.steps[0].side; this.fixReveal(this.steps.slice(0, r.n)); this.steps.splice(0, r.n); for (const a of r.acts) this.held.push({ ...a, side: a.side ?? side }); }
            else if (r.absorb) this.steps.splice(0, r.absorb);
            else break;
          }
          return;
        }
        this.held.shift();
        continue;
      }
      // A step made before this engine asked it (a hand-limit discard, the Hunt's damage before the reveal's move).
      const waiting = this.deferred[0];
      if (waiting && here.kind === waiting.action.kind && here.actor === waiting.side) {
        this.deferred.shift();
        this.applyOrHold(step(waiting.action, null, { side: waiting.side }));
        continue;
      }
      const head = this.steps[0];
      // An optional draw this engine asks before the referee draws: declined here, the referee's draw written in later.
      // Not before the referee's own questions that come first there: a card move's route, a figure the card recruits,
      // a new Guide (then the draw is asked).
      const before = head && (head.kind === 'CHOOSE_GUIDE' || (head.kind === 'CARD_CHOICE' &&
        (head.opt.kind === 'draw' || head.route || ['REGULAR', 'ELITE'].includes(head.opt.answer))));
      // A hand-limit discard the referee asks before the draw (this engine: the draw first): kept until it is asked.
      if (head && ['guideDraw', 'sorcererDraw', 'bonusDraw'].includes(here.kind) && head.kind === 'DISCARD_EXCESS_CARD' && head.side === here.actor) {
        this.deferred.push({ side: head.side, action: act('discardCard', { card: head.opt.hidden ? { hiddenDeck: head.opt.deck } : N.card(head.opt.card) }) });
        this.steps.shift();
        this.note("a hand-limit discard before this engine's draw: kept for later");
        continue;
      }
      if (head && ['guideDraw', 'sorcererDraw', 'bonusDraw'].includes(here.kind) && !before) {
        this.note(`this engine only: ${here.kind} declined`);
        this.applyOrHold(this.silentDefault(null, true));
        continue;
      }
      // A siege the referee did not extend (it asks only when the attacker can and may; here the next action comes).
      if (head && TOP_LEVEL.has(head.kind) && here.kind === 'siegeExtend') {
        this.note('a siege the referee ended: not extended here');
        this.applyOrHold(step(act('siegeExtend', { extend: false }), null, { side: here.actor }));
        continue;
      }
      // Hand-limit discards: the referee asks the Shadow first, this engine the Free Peoples.
      if (head && head.kind === 'DISCARD_EXCESS_CARD' && (here.kind !== 'discardCard' || here.actor !== head.side)) {
        this.deferred.push({ side: head.side, action: act('discardCard', { card: head.opt.hidden ? { hiddenDeck: head.opt.deck } : N.card(head.opt.card) }) });
        this.steps.shift();
        continue;
      }
      if (!head) {
        const silent = this.silentDefault(next);
        if (!silent) return;
        if (!this.applyHis(silent, true)) return;
        this.note(`this engine only: ${silent.action.kind}`);
        continue;
      }
      const r = collapse(this.steps, here, this.state, next);
      if (r.more) return;
      if (r.fail) throw new Desync(r.fail);
      if (r.absorb) { this.steps.splice(0, r.absorb); if (r.defer) this.deferred.push(r.defer); if (r.note) this.note(r.note); continue; }
      const side = head.side;
      this.fixReveal(this.steps.slice(0, r.n));
      this.steps.splice(0, r.n);
      if (r.note) this.note(r.note);
      for (const a of r.acts) this.applyOrHold(a.action.kind.startsWith('@') ? a : { ...a, side });
    }
  }

  /**
   * Steps still waiting for an outcome when the referee asks the bot something: everything before this question has
   * been drawn, so what they wait for never comes (a rules difference); it is made up (a miss, the top card).
   */
  unblock(next) {
    lenient = true;
    madeUp = 0;
    try {
      while (this.held.length) {
        if (!this.applyHis(this.held[0], true)) break;
        this.held.shift();
      }
      if (!this.held.length) this.drainSteps(next);
    } catch (e) {
      if (!(e instanceof Desync)) throw e;
      this.desync(e.message);
    } finally {
      lenient = false;
    }
    if (madeUp) debug(`[${this.id}]   this engine's log: ${JSON.stringify((this.state.log ?? []).slice(-7).map((l) => l.msg))}`);
    if (madeUp) { this.stats.madeUp = (this.stats.madeUp ?? 0) + madeUp; this.note(`outcomes the referee did not draw, made up here: ${madeUp}`); }
  }

  applyOrHold(hs) {
    const asked = this.state;
    if (this.held.length) { this.held.push(hs); return; }
    if (!this.applyHis(hs, true)) {
      this.held.push(hs);
      // A draw of the bot's declined here and waiting: the AI answers the referee's draw question from this point.
      if (['guideDraw', 'sorcererDraw', 'bonusDraw'].includes(hs.action.kind) && hs.side === this.side) this.drawAsked = asked;
    }
  }

  /** Applies one step of this engine's; false when it needs an outcome the referee has not drawn yet (with `mayWait`). */
  applyHis(hs, mayWait) {
    this.depth = (this.depth ?? 0) + 1;
    const hidden = this.hidden;
    try {
      const ok = this.applyHis0(hs, mayWait);
      // Steps made after the opponent's face-down Combat card: made again with the real card once it is shown.
      if (ok && hidden && this.hidden === hidden && this.depth === 1) hidden.replay.push(hs);
      return ok;
    } finally {
      this.depth--;
    }
  }

  applyHis0(hs, mayWait) {
    let here = this.pending();
    // The engine stands at an automatic phase (the game's start): its phases run first.
    if (!here.actor && !here.winner && this.state.phase !== 'gameOver' && hs.action.kind !== '@advance' && hs.action.kind !== '@patch') {
      const r = advanceForced(this.state);
      if (!r.ok) { if (mayWait && r.needsChance) { debug(`[${this.id}] the phases wait: ${r.reason}`); return false; } throw new Desync(`the phases refuse to run: ${r.reason}`); }
      this.state = r.state;
      here = this.pending();
    }
    // The Hunt: the referee asks the damage first, this engine moves the revealed Fellowship first.
    if (hs.onlyIf === 'huntDamage' && here.kind === 'revealMove' && hs.side && here.actor === hs.side) {
      this.deferred.push({ side: hs.side, action: hs.action });
      this.note("the Hunt's damage before the reveal's move: kept until this engine asks it");
      return true;
    }
    if (hs.onlyIf && hs.onlyIf !== here.kind && !(hs.side && here.actor !== hs.side)) return true;
    // The end of a card's choices where this engine has ended the card already: nothing to do.
    if (hs.action.kind === 'eventTarget' && hs.action.done && here.kind !== 'eventTarget') { this.note('the end of a card this engine ended already'); return true; }
    // Hand-limit discards (also of steps held for an outcome): the referee asks the Shadow first, this engine the Free
    // Peoples; kept until this engine asks it.
    if (hs.action.kind === 'discardCard' && here.kind === 'discardCard' && hs.side && here.actor !== hs.side) {
      this.deferred.push({ side: hs.side, action: hs.action });
      return true;
    }
    // This engine waits for the other side: its questions the referee does not have go first.
    for (let g = 0; hs.side && here.actor !== hs.side && !here.winner && g < 8; g++) {
      if (hs.phaseIf && here.phase === 'actionResolution') { this.note(`settled by this engine itself: ${hs.action.kind}`); return true; }
      const first = this.silentDefault(null);
      if (!first) {
        if (hs.onlyIf) { this.note(`settled by this engine itself: ${hs.action.kind} for ${hs.side}`); return true; }
        throw new Desync(`this engine waits for ${here.actor} (${here.kind ?? here.phase}); the referee's step ${JSON.stringify(hs.action)} is ${hs.side}'s`);
      }
      if (!this.applyHis(first, mayWait)) return false;
      this.note(`this engine only: ${first.action.kind} before the other side's step`);
      here = this.pending();
    }
    if (hs.onlyIf && hs.onlyIf !== here.kind) return true;
    if (hs.phaseIf && here.phase !== hs.phaseIf) { this.note(`settled by this engine itself: ${hs.action.kind}`); return true; }
    let action = hs.action;
    if (hs.resolve) {
      action = hs.resolve(here, this.state);
      if (!action) throw new Desync(`no answer here for ${JSON.stringify(hs.action)}`);
    }
    if (action.kind === '@noop') return true;
    let r;
    if (action.kind === '@patch') {
      const s = JSON.parse(JSON.stringify(this.state));
      let o = s;
      for (const k of action.path.slice(0, -1)) o = o[k];
      o[action.path[action.path.length - 1]] = action.value;
      r = { ok: true, state: s };
    } else if (action.kind === '@advance') {
      r = advanceForced(this.state);
    } else if (action.kind === '@draw') {
      const s = JSON.parse(JSON.stringify(this.state));
      const p = s.cards[action.side];
      let card = action.card ?? p.draw[action.deck][0];
      // A card this engine drew already, as a draw of its own made before this one (the turn's, the referee's bonus card
      // on top of the pile then): the card the referee drew for that one comes now instead.
      if (action.card && action.side === this.side && p.hand.includes(card)) {
        const q = cardQueue.find((c) => c.side === action.side && c.deck === action.deck && c.card && !p.hand.includes(c.card));
        if (q) card = q.card;
      }
      if (action.card && action.side !== this.side) swapIntoHand(s, action.side, card);
      const i = p.draw[action.deck].indexOf(card);
      if (i >= 0) p.draw[action.deck].splice(i, 1);
      if (card && !p.hand.includes(card)) p.hand.push(card);
      const q = cardQueue.findIndex((c) => c.side === action.side && (c.card === card || !c.card));
      if (q >= 0) cardQueue.splice(q, 1);
      r = { ok: true, state: s };
    } else {
      const actor = hs.side ?? here.actor;
      if (!actor) throw new Desync(`nobody to act for ${JSON.stringify(action)}`);
      if (action.kind === 'playEvent') { this.cardBase = this.state; this.cardUsed = new Map(); }
      const prepared = this.prepare(action, actor);
      const before = { state: this.state, q: saveQueues() };
      // The Voice of Saruman's recruits where the referee made them (followOptions.sarumanRecruitIn); an Event card
      // played as the referee played it (followOptions.playAsPlayed).
      if (action.kind === 'sarumanMuster' && action.regions) {
        const { regions, ...plain } = prepared.action;
        prepared.action = plain;
        E.followOptions.sarumanRecruitIn = regions;
      }
      E.followOptions.playAsPlayed = action.kind === 'playEvent';
      if (action.kind === 'revealMove' && action.strongholds != null) {
        const { strongholds, ...plain } = prepared.action;
        prepared.action = plain;
        E.followOptions.revealStrongholds = strongholds;
      }
      try { r = applyForced(prepared.state, prepared.action, actor); } finally {
        E.followOptions.sarumanRecruitIn = null; E.followOptions.playAsPlayed = false; E.followOptions.revealStrongholds = null;
      }
      if (r.ok && prepared.standIn) {
        this.hidden = { ...prepared.standIn, snapshot: before.state, q: before.q, fed: { d6: [], faces: [], tiles: [], picks: [] }, fedCards: [], replay: [] };
      }
    }
    if (!r.ok) {
      if (mayWait && r.needsChance) { this.waitsFor = r.reason; debug(`[${this.id}] waits: ${JSON.stringify(action)}: ${r.reason}`); return false; }
      throw new Desync(`this engine refuses ${JSON.stringify(action)}: ${r.reason}`);
    }
    // The Hunt damage this engine took last (a reveal's Stronghold tile it merges with the damage before it).
    if (action.kind === 'huntDamage' && action.mode) this.lastHuntMode = action.mode;
    if (action.kind === 'moveFellowship' || action.kind === 'playEvent') this.lastHuntMode = null;
    const prior = this.state;
    // An optional draw of the bot's this engine settled before the referee asks it: the state where it was asked.
    if (['guideDraw', 'sorcererDraw', 'bonusDraw'].includes(action.kind) && (hs.side ?? here.actor) === this.side) this.drawAsked = prior;
    const logged = (prior.log ?? []).length;
    this.state = r.state;
    debug(`[${this.id}] applied ${hs.side ?? ''} ${JSON.stringify(action)} -> ${this.pending().actor} ${this.pending().kind ?? this.state.phase}`);
    // A battle round's Combat rolls: the board before them, for the casualties this engine takes by itself (casualtyBase).
    const rolled = (this.state.log ?? []).slice(logged).filter((l) => / dice — /.test(l.msg ?? ''));
    if (rolled.length) {
      this.casualtyBase = { state: prior, used: new Map(), pre: this.lastPreCombat ?? [] };
      for (const l of rolled) debug(`[${this.id}]   ${l.msg}`);
    }
    return true;
  }

  /**
   * The opponent's action made applicable here: its cards are stand-ins in this engine (only their decks are known),
   * so a card the referee names is put into the hand first, and a face-down card (a Combat card, a discard) is any
   * stand-in of its deck.
   */
  prepare(action, actor) {
    if (actor === this.side) return { state: this.state, action };
    const s = JSON.parse(JSON.stringify(this.state));
    const a = { ...action };
    let standIn = null;
    const hidden = (v) => v && typeof v === 'object' && v.hiddenDeck;
    if (a.kind === 'discardCard' && hidden(a.card)) {
      a.card = s.cards[actor].hand.find((c) => N.deck(c) === a.card.hiddenDeck) ?? s.cards[actor].hand[0];
    } else if (a.kind === 'playCombatCard' && hidden(a.cardId)) {
      const deck = a.cardId.hiddenDeck;
      const legal = E.wotrAdapter.legalActions(s, actor).filter((x) => x.kind === 'playCombatCard' && x.cardId && N.deck(x.cardId) === deck);
      let card = legal[0]?.cardId ?? null;
      if (!card) {
        // No stand-in of that deck this engine would let it play: one that it would, from the unseen cards.
        const unseen = [...s.cards[actor].draw[deck], ...s.cards[actor].hand.filter((c) => N.deck(c) === deck)];
        for (const c of unseen) {
          const t = JSON.parse(JSON.stringify(s));
          swapIntoHand(t, actor, c);
          if (E.wotrAdapter.legalActions(t, actor).some((x) => x.kind === 'playCombatCard' && x.cardId === c)) { swapIntoHand(s, actor, c); card = c; break; }
        }
      }
      a.cardId = card;
      // No stand-in this engine would let it play: none here, and the real card made at the reveal (fixReveal).
      standIn = { side: actor, card };
    } else if (a.kind === 'forceDiscardCard' && (hidden(a.discardStrategy) || hidden(a.discardCharacter))) {
      // The price paid face down (A Power too Great / Tom Bombadil): an Army-icon Strategy card and a Character card
      // of the hand, or else unseen ones (draw piles, face-down discards) put into it, so that this engine takes it.
      const p = s.cards[actor];
      const fits = { discardStrategy: (c) => E.data.EVENT_BY_ID[c]?.deck === 'Strategy' && E.data.EVENT_BY_ID[c]?.playableVia === 'army',
        discardCharacter: (c) => E.data.EVENT_BY_ID[c]?.deck === 'Character' };
      for (const k of ['discardStrategy', 'discardCharacter']) {
        if (!hidden(a[k])) continue;
        let card = p.hand.find(fits[k]);
        if (!card) {
          card = [...p.draw[a[k].hiddenDeck], ...(p.discardFaceDown ?? [])].find(fits[k]);
          if (card) swapIntoHand(s, actor, card);
        }
        a[k] = card;
      }
    }
    for (const k of ['cardId', 'card', 'discardStrategy', 'discardCharacter']) {
      if (typeof a[k] === 'string' && E.data.EVENT_BY_ID[a[k]] && !s.cards[actor].hand.includes(a[k]) && !(a.kind === 'playCombatCard' && s.cards[actor].table.includes(a[k]))) {
        if (a.kind === 'forceDiscardCard' && k === 'cardId') continue; // the other side's table card
        swapIntoHand(s, actor, a[k]);
      }
    }
    return { state: s, action: a, standIn };
  }

  /**
   * At the Combat cards' reveal: the opponent's face-down card was a stand-in here (any card of its deck that this
   * engine would let it play). When the real one differs, the battle is made again from just before it: the real
   * card, then the steps since, with the same dice.
   */
  fixReveal(steps) {
    for (const st of steps) for (const e of st.events) {
      if (e.kind !== 'combat_cards_revealed' || !this.hidden) continue;
      const h = this.hidden;
      this.hidden = null;
      const pc = h.snapshot.pendingCombat;
      const realKey = !pc ? null : pc.attacker === h.side ? e.attacker_card : e.defender_card;
      if (!realKey) continue;
      const real = N.card(realKey);
      if (real === h.card) continue;
      this.state = h.snapshot;
      restoreQueues({ q: Object.fromEntries(Object.keys(queues).map((k) => [k, [...h.q.q[k], ...h.fed[k]]])), c: [...h.q.c, ...h.fedCards] });
      const s = JSON.parse(JSON.stringify(this.state));
      swapIntoHand(s, h.side, real);
      const r = applyForced(s, act('playCombatCard', { cardId: real }), h.side);
      if (!r.ok) throw new Desync(`the opponent's Combat card ${real} refused here: ${r.reason}`);
      this.state = r.state;
      for (let i = 0; i < h.replay.length; i++) {
        if (!this.applyHis(h.replay[i], true)) { this.held.unshift(...h.replay.slice(i)); break; }
      }
      this.note("the opponent's face-down Combat card shown: the battle made again with it");
    }
  }

  /**
   * An action for this engine's open decision when the referee has none for it (it left or skipped that question):
   * the one that ends it, its only legal action, or null. `next` is the referee's next step or decision, if known.
   */
  silentDefault(next, force = false) {
    const here = this.pending();
    if (here.winner) return null;
    if (!here.actor) return this.state.phase !== 'gameOver' ? step(act('@advance')) : null;
    // A card move's route asked next: this engine took its own, its open question comes after it.
    if (!force && next?.route) return null;
    if (!force && next && corresponds(here, { side: next.side, kind: next.kind, context: { card: next.card }, options: next.opt ? [next.opt] : [] }, this.cardInPlay)) return null;
    const end = (() => {
      switch (here.kind) {
        case 'armyMove2': return act('armyMove2', { done: true });
        case 'charMove2': return act('charMove2', { done: true });
        case 'musterSecond': return act('recruitSecond', { done: true });
        // (The referee's hand-limit discard asked first: the draw waits for its question after it.)
        case 'guideDraw': case 'sorcererDraw':
          return next?.kind === 'DISCARD_EXCESS_CARD' && next.side === here.actor ? null : act(here.kind, { draw: false });
        case 'bonusDraw': return next?.kind === 'DISCARD_EXCESS_CARD' && next.side === here.actor ? null : act('bonusDraw', { deck: 'none' });
        // The referee asks no Combat card here (by the official rules with hidden passes it asks every one: wait).
        case 'combatCard': return followHidden ? null : act('playCombatCard', { cardId: null });
        case 'freeCharEvent': return act('freeCharEvent', { decline: true });
        case 'huntDamage':
          // A casualty the card forced (Foul Thing from the Deep): the referee took the rest as Corruption at once (one
          // Companion per tile), this engine asks it.
          if (this.huntRest && here.legal.some((a) => a.mode === 'corruption')) { this.huntRest = false; return act('huntDamage', { mode: 'corruption' }); }
          // The referee goes on with the same Hunt (a new Guide among equals, his ability, another casualty): wait.
          if (next && next.side === here.actor && ['CHOOSE_GUIDE', 'GUIDE_ABILITY', 'HUNT_CASUALTY', 'CARD_CHOICE', 'REVEAL_FELLOWSHIP', 'SEPARATE_COMPANIONS'].includes(next.kind)) return null;
          return here.legal.some((a) => a.mode === 'corruption') ? act('huntDamage', { mode: 'corruption' }) : null;
      }
      if (!here.kind && here.phase === 'fellowship') return act('skipFellowshipPhase');
      return this.unasked(here);
    })();
    if (end) return step(end, null, { side: here.actor });
    if (here.legal.length === 1) return step(here.legal[0], null, { side: here.actor });
    return null;
  }

  /**
   * This engine's open question that the referee settled without asking (its only option there), as the events of the
   * last step show it: a card's figure recruited, a casualty taken, a card's target Army hit. The same answer here.
   */
  unasked(here) {
    const events = this.last?.events ?? [];
    if (here.kind === 'eventTarget') {
      const e = events.find((x) => x.kind === 'figure_recruited' && !x.used && N.side(x.side) === here.actor);
      const a = e && here.legal.find((x) => x.kind === 'eventTarget' && x.region === N.region(e.region) && x.figure === String(e.unit).toLowerCase() &&
        (!x.nation || x.nation === N.nation(e.nation)));
      if (a) { e.used = true; return a; }
      // The card's target Army (Faramir's Rangers' dice): the region whose figures it hit, the target's only word.
      const hit = events.filter((x) => (x.kind === 'figure_eliminated' || x.kind === 'casualty_taken') && !x.used && N.side(x.side) !== here.actor);
      const regions = [...new Set(hit.map((x) => x.region))];
      if (regions.length === 1) {
        const t = here.legal.find((x) => x.kind === 'eventTarget' && same([...answerWords(x)], [regions[0]]));
        if (t) { hit.forEach((x) => { x.used = true; }); return t; }
      }
    }
    // The Breaking of the Fellowship's Companions, when there was no choice to make.
    if (here.kind === 'breakingSep') {
      for (const e of events) {
        if (e.kind !== 'companions_separated') continue;
        const c = (e.characters ?? []).map(N.char).find((x) => !(e.usedChars ?? []).includes(x) && here.legal.some((a) => a.companion === x));
        if (c) { (e.usedChars ??= []).push(c); return act('breakingSep', { companion: c }); }
      }
    }
    // The attacker's advance after the battle (a card's attack that must advance): all of it, or none.
    if (['advanceChoice', 'besiegerAdvance', 'relieveAdvance'].includes(here.kind) && events.some((x) => x.kind === 'battle_ended')) {
      const to = this.state.pendingCombat?.to;
      const moved = events.find((x) => x.kind === 'army_moved' && !x.used && N.side(x.side) === here.actor && N.region(x.to) === to);
      if (moved) moved.used = true;
      return act(here.kind, { advance: !!moved });
    }
    // (Not while the referee's own steps wait to be made: their casualties come first, in their order.)
    if ((here.kind === 'eventCasualties' || here.kind === 'combatCasualties') && !this.steps.length) {
      const e = events.find((x) => x.kind === 'casualty_taken' && !x.used && N.side(x.side) === here.actor);
      const stepKind = { REDUCE_ELITE: 'reduceElite', REMOVE_REGULAR: 'removeRegular', REMOVE_ELITE: 'removeElite' }[e?.casualty];
      const a = stepKind && here.legal.find((x) => x.kind === 'casualtyStep' && x.step === stepKind && x.nation === N.nation(e.nation));
      if (a) { e.used = true; return a; }
    }
    return null;
  }

  // --- The decisions ---

  /** The referee's decision: this engine's AI's answer as one of its options (always one of them). */
  decide(msg) {
    const started = Date.now();
    const d = { ...msg.decision, context: msg.decision.context ?? null };
    let option;
    try {
      option = this.decide0(d, msg.view);
    } catch (e) {
      this.stats.errors++;
      log(`[${this.id}] error at ${d.kind}: ${e?.stack ?? e}`);
      option = null;
    }
    if (!option || !d.options.some((o) => o.o === option.o)) {
      this.stats.fallback++;
      if (option) log(`[${this.id}] an answer not among the options at ${d.kind}: ${JSON.stringify(option)}`);
      option = defaultAnswer(d);
    }
    this.stats.decisions++;
    this.stats.ms += Date.now() - started;
    this.ownCtx = { kind: d.kind, ctx: d.context, forced: d.options.length === 1 };
    debug(`[${this.id}] ${d.kind}: ${option.text ?? JSON.stringify(option)}`);
    return option;
  }

  /**
   * The opponent's draw piles as large as the referee's (the view's deck sizes, less the draws queued here): its cards
   * are stand-ins here, and a stand-in left in a pile the referee has emptied would be drawn at the next turn.
   */
  matchPiles(view) {
    const other = this.side === 'fp' ? 'shadow' : 'fp';
    const decks = view?.cards?.decks?.[N.pSide(other)];
    const p = this.state.cards?.[other];
    if (!decks || !p) return;
    p.discardFaceDown ??= [];
    for (const deck of ['character', 'strategy']) {
      if (typeof decks[deck] !== 'number') continue;
      const want = decks[deck] + cardQueue.filter((c) => c.side === other && c.deck === deck).length;
      const pile = p.draw[deck];
      while (pile.length > want) p.discardFaceDown.push(pile.pop());
      for (let i = p.discardFaceDown.length - 1; i >= 0 && pile.length < want; i--) {
        if (N.deck(p.discardFaceDown[i]) === deck) pile.push(...p.discardFaceDown.splice(i, 1));
      }
    }
  }

  decide0(d, view) {
    const side = this.side;
    if (view?.dice) viewDice = view.dice;
    battleView = view?.battle ?? null;
    this.feedRandoms();
    if (!this.desynced) this.matchPiles(view);
    this.drain({ side: N.side(d.side), kind: d.kind, opt: null, card: d.context?.card ?? null, route: d.context?.question === 'Which way?' });
    // The Leader re-roll's question comes before its dice (the official rules ask it after the Combat roll): a step
    // waiting for them still gets them, nothing is made up yet.
    // (So does a Combat card's question asked between the roll and the re-roll: Mighty Attack's forfeited Leadership.)
    const beforeReroll = d.kind === 'LEADER_REROLL' || (d.kind === 'CARD_CHOICE' && this.inBattle);
    if (!beforeReroll && this.combatStash) {
      this.flushCombatStash();
      if (this.held.length && !this.desynced) this.drain({ side: N.side(d.side), kind: d.kind, opt: null, card: d.context?.card ?? null, route: d.context?.question === 'Which way?' });
    }
    // A step that ends the turn here waits for the next turn's card draws, which the referee makes once the action's
    // last questions (a card move's route, the figures that go along, a new Guide) are answered: not made up at those.
    // (A hand-limit discard too while a card is in play: its draws come before the turn's.)
    const cardGoesOn = !TOP_LEVEL.has(d.kind) && (d.kind !== 'DISCARD_EXCESS_CARD' || this.cardInPlay) && /this engine draws a/.test(this.waitsFor ?? '');
    if (this.held.length && !this.desynced && !beforeReroll && !cardGoesOn) this.unblock({ side: N.side(d.side), kind: d.kind, opt: null, card: d.context?.card ?? null });
    if (d.options.length === 1) { this.stats.forced++; this.plan = this.plan?.answer(d) ? this.plan : null; return d.options[0]; }
    // Many Kings / Pits of Mordor's count where the Regulars run short: this engine places two where it can.
    if (d.kind === 'CARD_CHOICE' && ['sh-strat-17', 'sh-strat-24'].includes(d.context?.card) && d.options.every((o) => o.count != null && o.region == null)) {
      const most = d.options.reduce((b, o) => (o.count > b.count && o.count <= 2 ? o : b), d.options[0]);
      this.stats.plan++;
      this.note('a recruit count: two where this engine can');
      return most;
    }
    // Mighty Attack's Companion: this engine forfeits a Leadership of 1, the least (its re-roll stays largest).
    if (d.kind === 'CARD_CHOICE' && MIGHTY_ATTACK.has(N.card(d.context?.card ?? '')) && d.options.every((o) => o.character)) {
      const least = d.options.reduce((b, o) => (leadershipOf(N.char(o.character)) < leadershipOf(N.char(b.character)) ? o : b), d.options[0]);
      this.stats.plan++;
      this.note("Mighty Attack's forfeit: the least Leadership, as this engine forfeits");
      return least;
    }
    // The official rules' Leader re-roll: taken, as this engine always does (a re-roll can only add hits).
    if (d.kind === 'LEADER_REROLL') {
      const reroll = pick(d.options, (o) => o.answer === 'reroll');
      if (reroll) { this.stats.plan++; return reroll; }
    }
    const clean = !view.battle && (TOP_LEVEL.has(d.kind) || (d.kind === 'DISCARD_EXCESS_CARD' && !this.cardInPlay));
    if (clean) {
      const keep = this.plan && d.kind === 'FELLOWSHIP_PHASE' && this.plan.action.kind === 'changeGuide' && this.plan.turn === view.turn ? this.plan : null;
      this.rebuild(view, d);
      this.plan = keep;
    }
    if (this.plan) {
      const o = this.plan.answer(d);
      if (o) { this.stats.plan++; return o; }
      // A card's question the AI's answer leaves to this engine (a recruit's figure after its region, how many): as
      // the answer turns out here.
      if (this.plan.ahead && CARD_FLOW.has(d.kind) && !['ARMY_MOVE', 'CHOOSE_ATTACK', 'MOVE_MINIONS', 'MOVE_COMPANIONS'].includes(d.kind) && this.plan.stage > 0) {
        const s = byGains(gains(this.plan.base, this.plan.ahead), this.plan.used ??= new Map(), d);
        if (s) { this.stats.plan++; return s; }
      }
      this.plan = null;
    }
    if (this.desynced) { this.stats.rule++; this.note(`answered by default while out of step: ${d.kind}`); return defaultAnswer(d); }
    // A siege the referee did not extend: its battle is over at the referee (no battle in the view), so here too.
    if (this.pending().kind === 'siegeExtend' && d.kind !== 'EXTEND_SIEGE' && !view?.battle && !this.steps.length && !this.held.length) {
      const h = this.pending();
      if (this.applyHis(step(act('siegeExtend', { extend: false }), null, { side: h.actor }), true)) this.note('a siege the referee ended: not extended here');
    }
    // What the referee settled unasked before this question (a card's only recruit, its target): made here first.
    for (let g = 0; g < 6 && !this.steps.length && !this.held.length; g++) {
      const h = this.pending();
      const a = h.actor && !h.winner ? this.unasked(h) : null;
      if (!a || !this.applyHis(step(a, null, { side: h.actor }), true)) break;
      this.note(`settled by the referee unasked: ${a.kind}`);
    }
    let here = this.pending();
    // The reveal's move that this engine's AI answered before the referee asked it.
    if (d.kind === 'REVEAL_FELLOWSHIP' && this.earlyReveal) {
      this.plan = new Plan(this.earlyReveal, null, side);
      this.earlyReveal = null;
      const o = this.plan.answer(d);
      if (o) { this.stats.plan++; return o; }
    }
    // The Hunt: this engine asks where the revealed Fellowship goes before the damage, the referee after.
    if (here.kind === 'revealMove' && here.actor === side && !this.steps.length && !this.held.length &&
      (d.kind === 'HUNT_CASUALTY' || d.kind === 'GUIDE_ABILITY' || (d.kind === 'CARD_CHOICE' && d.context?.tile !== undefined))) {
      const a = this.choose(side);
      if (a && this.applyHis(step(a, null, { side }), true)) {
        this.earlyReveal = a;
        this.note("the reveal's move before the Hunt's damage: answered first");
        here = this.pending();
      }
    }
    // A hand-limit discard while this engine's card could go on (an optional clause the referee did not offer): the
    // card is over at the referee, so here too.
    if (d.kind === 'DISCARD_EXCESS_CARD' && here.kind === 'eventTarget' && here.actor === side && !this.steps.length && !this.held.length) {
      const done = here.legal.find((x) => x.kind === 'eventTarget' && x.done);
      if (done && this.applyHis(step(done, null, { side }), true)) { this.note("a card the referee ended: ended here"); here = this.pending(); }
    }
    // A hand-limit discard the referee asks before this engine does (the Shadow's first).
    // Worn with Sorrow and Toil asked before this engine raises it (after the Hunt): the AI's answer to it now.
    if (d.kind === 'CARD_CHOICE' && d.context?.card === 'sh-char-15' && here.kind !== 'wornDiscard') {
      const t = JSON.parse(JSON.stringify(this.state));
      t.pendingChoice = { owner: side, kind: 'wornDiscard', data: {} };
      const a = this.choose(side, [], t);
      const o = a?.kind !== 'wornDiscard' ? null : a.decline ? pick(d.options, (x) => x.skip) : a.card ? pick(d.options, (x) => N.card(x.target_card ?? x.answer) === a.card) : pick(d.options, (x) => x.answer === 'hand');
      if (o) { this.stats.ai++; return o; }
    }
    // (Also while steps wait for an outcome: the hand as the referee offers it.)
    // (And before this engine's own optional draw, which the referee asks after the discard.)
    if (d.kind === 'DISCARD_EXCESS_CARD' && ((here.kind === 'discardCard' && here.actor !== side) || this.held.length ||
      (['guideDraw', 'sorcererDraw', 'bonusDraw'].includes(here.kind) && here.actor === side))) {
      const t = JSON.parse(JSON.stringify(this.state));
      t.pendingChoice = { owner: side, kind: 'discardCard', data: {} };
      // The hand as the referee's options name it (a second discard: the first is not made here yet).
      const offered = new Set(d.options.filter((o) => o.card).map((o) => N.card(o.card)));
      t.cards[side].hand = t.cards[side].hand.filter((c) => offered.has(c));
      const a = this.choose(side, [], t);
      if (a) { this.plan = new Plan(a, null, side); const o = this.plan.answer(d); if (o) { this.stats.ai++; return o; } }
    }
    if (this.held.length || !corresponds(here, d, this.cardInPlay)) {
      if (d.kind === 'CHOOSE_GUIDE') {
        // The Guide this engine names (after the casualty held for the next turn's draws, looked ahead on a copy).
        const ahead = this.held.length ? tryAhead(this.state, this.held[0].action, this.held[0].side ?? side) : null;
        const guide = (ahead ?? this.state).fellowship.guide;
        // (Else this engine's rule: the remaining Companion of the highest Level.)
        const level = (o) => E.data.levelOf(N.char(o.character));
        const g = pick(d.options, (o) => o.character === N.pChar(guide)) ??
          (d.options.every((o) => o.character) ? d.options.reduce((b, o) => (level(o) > level(b) ? o : b), d.options[0]) : null);
        if (g) { this.stats.rule++; this.note('Guide among equals: this engine\'s'); return g; }
      }
      // A card this engine resolved by itself (placing units, moving an Army): the option that does what it did.
      const settled = this.settledAnswer(d);
      if (settled) { this.stats.rule++; this.note(`answered as this engine resolved the card: ${d.kind}`); return settled; }
      const draw = this.drawAnswer(d);
      if (draw) return draw;
      // A reveal's Stronghold tile whose damage this engine took together with the damage before it: the same way.
      if (d.kind === 'HUNT_CASUALTY' && this.lastHuntMode && !here.kind) {
        const o = pick(d.options, (x) => x.kind === this.lastHuntMode);
        if (o) { this.stats.rule++; this.note('a Hunt tile whose damage this engine took with the one before: the same way'); return o; }
      }
      // The Army move or attack of the die the AI chose, which the referee does not offer (it bars a move this engine
      // allows): the AI's choice among those it offers, the die already chosen.
      const again = this.armyAgain(d, here);
      if (again) { this.stats.ai++; this.note(`the AI's ${d.kind} asked again among the referee's moves`); return again; }
      // A battle's casualties this engine took by itself (the only sensible way, which it does not ask): as it took them.
      const casualty = this.settledCasualty(d);
      if (casualty) { this.stats.rule++; this.note('a casualty this engine took by itself: as it took it'); return casualty; }
      // A card this engine resolved by itself in a step that waits for an outcome (its fixed recruits): the option that
      // does what that step does, looked ahead on a copy.
      if (this.held.length && CARD_FLOW.has(d.kind) && this.held[0].action.kind === 'playEvent') {
        const ahead = tryAhead(this.state, this.held[0].action, this.held[0].side ?? side);
        const o = ahead && byGains(gains(this.state, ahead), this.heldUsed ??= new Map(), d);
        if (o) { this.stats.rule++; this.note(`answered as this engine resolves the card: ${d.kind}`); return o; }
      }
      // A card's further choice this engine does not offer (it ended the card: "The Ringwraiths Are Abroad"'s attack or
      // moves after the Nazgûl, the Ents' further Character card): declined, as this engine went on.
      if (d.kind === 'CARD_CHOICE' && !CARD_KINDS.has(here.kind)) {
        const decline = pick(d.options, (o) => o.skip === true || o.answer === 'none' || o.answer === 'no' || o.kind === 'none');
        if (decline) { this.stats.rule++; this.note(`a card's choice this engine does not offer: declined (${d.context?.card ?? '-'})`); return decline; }
      }
      this.stats.rule++;
      this.note(`answered by default: ${d.kind} (this engine ${here.actor ?? '-'} ${here.kind ?? here.phase})`);
      debug(`[${this.id}]   this engine's: ${here.legal.slice(0, 8).map((a) => JSON.stringify(a)).join(' ')}; held ${JSON.stringify(this.held.map((h) => h.action)).slice(0, 300)}`);
      debug(`[${this.id}]   this engine's log: ${JSON.stringify((this.state.log ?? []).slice(-8).map((l) => l.msg))}`);
      return defaultAnswer(d);
    }
    // The AI's choice; one that has no counterpart among the referee's options is left out and the AI asked again.
    const excluded = [];
    for (let round = 0; round < 8; round++) {
      here = this.pending();
      if (here.actor !== side || !corresponds(here, d, this.cardInPlay)) break;
      const a = this.choose(side, excluded);
      if (!a) break;
      debug(`[${this.id}]   the AI: ${JSON.stringify(a)}`);
      const face = spentFace(this.state, a, side);
      const plan = new Plan(a, face, side);
      plan.turn = view.turn;
      this.lookAhead(plan, a);
      if (CARD_KINDS.has(a.kind)) { plan.base = this.state; plan.ahead = tryAhead(this.state, a, side); }
      // Dreadful Spells: the AI's target, cast by the Army with the most Nazgûl there (as this engine casts it).
      if (d.context?.card === 'sh-char-19' && a.kind === 'eventTarget' && a.region) {
        const naz = (r) => { const g = this.state.regions[N.region(r)]; return (g?.nazgul ?? 0) + (g?.characters?.includes('witch-king') ? 1 : 0); };
        const fits = d.options.filter((x) => x.to === N.pRegion(a.region) && x.from);
        if (fits.length) { this.plan = null; this.stats.ai++; return fits.reduce((b, x) => (naz(x.from) > naz(b.from) ? x : b), fits[0]); }
      }
      const o = plan.answer(d);
      if (o) { this.plan = plan; this.stats.ai++; return o; }
      // The die the AI turns into an Eye, by the referee's number for it.
      if (d.context?.question === EYE_QUESTION && a.kind === 'eventTarget') {
        const o2 = a.done ? pick(d.options, (x) => x.skip) : pick(d.options, (x) => x.count != null && dieFace(side, x.count) === N.pFace(a.face));
        if (o2) { this.plan = null; this.stats.ai++; return o2; }
      }
      // A card's moves this engine has ended (no figure of the card's left to move here), its next question asked: the
      // end of the referee's moves.
      if (this.cardInPlay && ['MOVE_MINIONS', 'MOVE_COMPANIONS', 'ARMY_MOVE'].includes(d.kind) && !a.from && !a.companion && !here.legal.some((x) => x.from)) {
        const end = pick(d.options, (x) => x.kind === 'end');
        if (end) { this.stats.rule++; this.note(`a card's moves this engine has ended: ${d.kind} ended`); return end; }
      }
      // The referee's bonus draw after a card this engine has not finished (the referee settled the rest unasked): the
      // card's rest as the AI makes it, here only, then the draw.
      if (here.kind === 'eventTarget' && a.kind === 'eventTarget' && d.options.every((x) => x.kind === 'draw')) {
        if (this.applyHis(step(a, null, { side }), true)) { this.note("this engine only: a card's rest before the referee's bonus draw"); continue; }
      }
      // An action of this engine with no step of the referee's (an optional draw the referee makes later): here only.
      if (['guideDraw', 'sorcererDraw', 'bonusDraw', 'freeCharEvent'].includes(a.kind) && d.kind !== 'CARD_CHOICE') {
        const decline = a.kind === 'bonusDraw' ? act('bonusDraw', { deck: 'none' }) : a.kind === 'freeCharEvent' ? a : act(a.kind, { draw: false });
        if (this.applyHis(step(decline, null, { side }), true)) { this.note(`this engine only: ${a.kind}`); continue; }
      }
      this.note(`the AI's ${a.kind} has no option here (${d.kind}): asked again`);
      debug(`[${this.id}]   ${JSON.stringify(a)} (this engine ${here.kind}); the referee's: ${d.options.slice(0, 12).map((o) => JSON.stringify({ ...o, text: undefined })).join(' ')}`);
      excluded.push(a);
    }
    const draw = this.drawAnswer(d);
    if (draw) return draw;
    // A card's question about what this engine did by itself (its fixed recruits, asked figure by figure): as it did.
    const settled = this.settledAnswer(d);
    if (settled) { this.stats.rule++; this.note(`answered as this engine resolved the card: ${d.kind}`); return settled; }
    this.stats.rule++;
    this.note(`answered by default: ${d.kind}, the AI's answers have no option here`);
    return defaultAnswer(d);
  }

  /**
   * The referee's question about a card this engine resolved by itself (it placed the units, moved the Army): the
   * option naming what changed on the board here since the card was played (and not named by an earlier answer).
   */
  settledAnswer(d) {
    if (!this.cardBase || !CARD_FLOW.has(d.kind)) return null;
    return byGains(gains(this.cardBase, this.state), this.cardUsed, d);
  }
  /** See decide0: the AI's Army move (attack) again, among the referee's options, for the die answered already. */
  armyAgain(d, here) {
    const kind = d.kind === 'ARMY_MOVE' ? 'moveArmy' : d.kind === 'CHOOSE_ATTACK' ? 'attack' : null;
    const opt = d.kind === 'ARMY_MOVE' ? 'army_move' : 'attack';
    if (!kind || here.actor !== this.side || here.kind || this.steps.length !== 1 || this.steps[0].kind !== 'ACTION') return null;
    const offered = (a) => d.options.some((o) => o.kind === opt && o.from === N.pRegion(a.from) && o.to === N.pRegion(a.to));
    const exclude = here.legal.filter((a) => a.kind !== kind || !offered(a));
    if (exclude.length === here.legal.length) return null;
    const a = this.choose(this.side, exclude);
    if (!a || a.kind !== kind || !offered(a)) return null;
    const plan = new Plan(a, null, this.side);
    plan.stage = 1; // the die is chosen
    const o = plan.answer(d);
    if (o) this.plan = plan;
    return o;
  }

  /**
   * The referee's "may draw" question (a card's bonus draw, Gandalf the Grey's, the Witch-king's) that this engine asked
   * earlier and settled there (declined, waiting for the referee's draw): the AI's answer at that point.
   */
  drawAnswer(d) {
    const draws = d.kind === 'CARD_CHOICE' ? d.options.filter((o) => o.kind === 'draw') : [];
    if (!draws.length || !this.drawAsked) return null;
    const asked = this.drawAsked;
    this.drawAsked = null;
    const a = this.choose(this.side, [], asked);
    if (!a || !['guideDraw', 'sorcererDraw', 'bonusDraw'].includes(a.kind)) return null;
    const take = a.kind === 'bonusDraw' ? (a.deck !== 'none' ? a.deck : null) : a.draw ? true : null;
    const o = take === null ? pick(draws, (x) => x.skip === true) : pick(draws, (x) => !x.skip && (take === true || x.deck === take)) ?? pick(draws, (x) => !x.skip);
    if (o) { this.stats.ai++; this.note('a draw this engine asked earlier: the AI\'s answer there'); }
    return o;
  }

  /**
   * The referee's CASUALTY question where this engine removed the casualties by itself (it asks only when the choice
   * matters; the official rules ask every time): the option doing what it did, from the side's units before the round's
   * Combat rolls (casualtyBase) and now, less what earlier answers named.
   */
  settledCasualty(d) {
    if (d.kind !== 'CASUALTY' || !this.casualtyBase) return null;
    const side = N.side(d.side);
    const count = (s) => {
      const c = new Map();
      for (const r of Object.values(s.regions)) for (const [n, u] of Object.entries(r.units ?? {})) {
        if (E.data.sideOfNation(n) !== side) continue;
        const x = c.get(n) ?? { e: 0, r: 0 };
        x.e += u.elite ?? 0; x.r += u.regular ?? 0;
        c.set(n, x);
      }
      return c;
    };
    const was = count(this.casualtyBase.state), now = count(this.state), used = this.casualtyBase.used;
    // The casualties taken before the roll (a card's attack) are no answer of this question's.
    for (const e of this.casualtyBase.pre.splice(0)) {
      const n = N.nation(e.nation);
      if (N.side(e.side) !== side) continue;
      const u = used.get(n) ?? { e: 0, g: 0 };
      const regularsUp = ((now.get(n)?.r ?? 0) - (was.get(n)?.r ?? 0)) > 0;
      if (e.casualty === 'REMOVE_REGULAR') u.g -= 1;
      else { u.e += 1; if (e.casualty === 'REDUCE_ELITE' && regularsUp) u.g += 1; }
      used.set(n, u);
    }
    const hits = Number(d.context?.hits ?? 1);
    const ofNation = (n) => d.options.filter((o) => o.kind === 'casualty' && N.nation(o.nation) === n);
    for (const [n, w] of was) {
      const x = now.get(n) ?? { e: 0, r: 0 };
      const u = used.get(n) ?? { e: 0, g: 0 };
      const lostE = w.e - x.e - u.e, gainedR = x.r - w.r - u.g;
      const ops = ofNation(n);
      let o = null;
      if (lostE > 0 && gainedR > 0) o = pick(ops, (p) => p.unit === 'elite' && p.effect === 'reduce');
      else if (lostE > 0) o = (hits >= 2 * lostE ? pick(ops, (p) => p.unit === 'elite' && p.effect === 'remove') : null) ?? pick(ops, (p) => p.unit === 'elite' && p.effect === 'reduce');
      else if (gainedR < 0) o = pick(ops, (p) => p.unit === 'regular');
      if (!o) continue;
      const g = o.unit === 'regular' ? -1 : o.effect === 'reduce' && gainedR > 0 ? 1 : 0;
      used.set(n, { e: u.e + (o.unit === 'elite' ? 1 : 0), g: u.g + g });
      return o;
    }
    return null;
  }

  /** A follow-up question this engine asks right after the action (where Gandalf the White goes, where to retreat): answered now. */
  lookAhead(plan, a) {
    // A card's figure picked to fly (a Nazgûl group, a Minion): where it goes is this engine's next question.
    if (a.kind === 'eventTarget' && a.companion && a.from && !a.region && !a.to) {
      const next = tryAhead(this.state, a, this.side);
      if (next?.pendingChoice?.kind === 'eventTarget' && next.pendingChoice.owner === this.side) {
        const b = this.choose(this.side, [], next);
        if (b?.kind === 'eventTarget' && b.region) plan.chain = [b];
      }
      return;
    }
    if (a.kind !== 'bringUpgrade' && !(a.kind === 'combatRetreat' && a.retreat)) return;
    const next = tryAhead(this.state, a, this.side);
    if (!next) return;
    const k = next.pendingChoice?.kind;
    if (k !== 'placeGandalf' && k !== 'retreatTo') return;
    const b = this.choose(this.side, [], next);
    if (b?.region) plan.region = b.region;
  }

  /** The AI's action for `side` on `state` (its redacted view, as on the site), without the actions in `exclude`. */
  choose(side, exclude = [], state = this.state) {
    const { wotrAdapter, redact, chooseAction } = E;
    const view = redact(state, side);
    // The actions as the followed game has them (Scouts' withdrawal into a siege); the AI's choice among them its own.
    const legal = asFollowed(() => wotrAdapter.legalActions(view, side)).filter((l) => !exclude.some((x) => refines(x, l) || refines(l, x)));
    if (!legal.length) return null;
    let a;
    try {
      a = chooseAction(view, side, legal, this.rng) ?? legal[0];
    } catch (e) {
      this.note(`chooseAction threw: ${e?.message ?? e}`);
      a = legal[0];
    }
    // As the site's controller does (src/ai/wotrControllers.ts): a refinement the engine refuses falls back to the
    // first listed action it accepts.
    const accepts = (x) => { try { return wotrAdapter.tryApplyAction(view, x, side).ok; } catch { return false; } };
    if (!accepts(a) || exclude.some((x) => same(x, a))) {
      const ok = legal.find((x) => accepts(x) && !exclude.some((y) => same(y, x)));
      if (ok) a = ok;
    }
    this.stats.choices = (this.stats.choices ?? 0) + 1;
    return a;
  }

  /** The state rebuilt from the referee's view at a decision outside any procedure. */
  rebuild(view, d) {
    const before = this.state;
    const s = stateFromView(view, this.flags, this.planRoll);
    if (d.kind === 'DISCARD_EXCESS_CARD') {
      s.pendingChoice = { owner: this.side, kind: 'discardCard', data: {} };
      if (s.phase === 'recover') s.phase = 'fellowship';
    }
    const diff = this.desynced ? 0 : boardDifferences(before, s, this.side).length;
    if (diff) { this.stats.differences += diff; debug(`[${this.id}] rebuilt from the view: ${boardDifferences(before, s, this.side).slice(0, 8).join('; ')}`); }
    this.state = s;
    this.steps = [];
    this.held = [];
    this.deferred = [];
    this.desynced = null;
    this.earlyReveal = null;
    this.hidden = null;
    this.cardBase = null;
    this.heldUsed = null;
    this.casualtyBase = null;
    this.drawAsked = null;
    this.stats.rebuilds++;
    clearQueues();
  }

  summary() {
    const s = this.stats;
    const notes = [...this.notes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${v}x ${k}`);
    return `${s.decisions} decisions (AI ${s.ai}, its plans ${s.plan}, forced ${s.forced}, by default ${s.rule}, fallback ${s.fallback}, errors ${s.errors}), ` +
      `${s.desyncs} stretches out of step, ${s.differences} board differences repaired, ${(s.ms / Math.max(1, s.decisions)).toFixed(1)} ms an answer` +
      (notes.length ? `\n  ${notes.join('\n  ')}` : '');
  }
}

/** The option of `d` naming what `gained` holds (less what earlier answers named, `used`), or null. */
function byGains(gained0, used, d) {
  const gained = new Map(gained0);
  for (const [w, n] of used) gained.set(w, (gained.get(w) ?? 0) - n);
  if (d.kind === 'ARMY_SELECTION') {
    const c = d.context ?? {};
    // A Character going along (the Witch-king, the Mouth of Sauron): whether he moved here.
    if (c.to && c.character) return d.options.find((o) => o.kind === 'count' && o.count === ((gained.get(c.character) ?? 0) > 0 ? 1 : 0)) ?? null;
    if (!c.to || !c.unit) return null;
    // The figures that left the Army's region (another Army may have come to the same place), else those that arrived.
    const left = c.from ? gained.get(`-${c.from}|${c.nation ?? ''}|${c.unit.toUpperCase()}`) : undefined;
    const n = left ?? gained.get(`${c.to}|${c.nation ?? ''}|${c.unit.toUpperCase()}`) ?? 0;
    return d.options.find((o) => o.kind === 'count' && o.count === n) ?? null;
  }
  let best = null, bestScore = 0;
  for (const o of d.options) {
    const words = new Set([...optionWords(o), ...(o.region ? [o.region] : [])]);
    let score = 0;
    for (const w of words) if ((gained.get(w) ?? 0) > 0) score += E.data.REGIONS[N.region(w)] ? 2 : 1;
    if (score > bestScore) { best = o; bestScore = score; }
  }
  if (!best) return null;
  for (const w of new Set([...optionWords(best), ...(best.region ? [best.region] : [])])) used.set(w, (used.get(w) ?? 0) + 1);
  return best;
}

/** What appeared on the board from `base` to `now`: the regions, Nations and figure types gained, as words with counts. */
function gains(base, now) {
  const m = new Map();
  const add = (w, n = 1) => m.set(w, (m.get(w) ?? 0) + n);
  const count = (r) => {
    const c = new Map();
    for (const f of [r, r?.siegeBox]) {
      if (!f) continue;
      for (const [n, u] of Object.entries(f.units ?? {})) {
        c.set(`${n}|REGULAR`, (c.get(`${n}|REGULAR`) ?? 0) + (u.regular ?? 0));
        c.set(`${n}|ELITE`, (c.get(`${n}|ELITE`) ?? 0) + (u.elite ?? 0));
      }
      c.set('|LEADER', (c.get('|LEADER') ?? 0) + (f.leaders ?? 0));
      c.set('sauron|NAZGUL', (c.get('sauron|NAZGUL') ?? 0) + (f.nazgul ?? 0));
    }
    return c;
  };
  for (const [id, r] of Object.entries(now.regions)) {
    const a = count(base.regions[id]), b = count(r);
    for (const [k, v] of a) {
      const lost = v - (b.get(k) ?? 0);
      const [n, type] = k.split('|');
      if (lost > 0 && n) add(`-${N.pRegion(id)}|${N.pNation(n)}|${type}`, lost); // figures that left (ARMY_SELECTION)
    }
    for (const [k, v] of b) {
      const delta = v - (a.get(k) ?? 0);
      if (delta <= 0) continue;
      const [n, type] = k.split('|');
      const region = N.pRegion(id);
      add(region, delta);
      if (n) add(N.pNation(n), delta);
      add(type, delta);
      add(`${region}|${n ? N.pNation(n) : ''}|${type}`, delta);
      if (type === 'LEADER') for (const nat of Object.keys(r.units ?? {})) add(`${region}|${N.pNation(nat)}|LEADER`, delta);
    }
  }
  for (const [c, region] of Object.entries(now.characters.inPlay)) {
    if (base.characters.inPlay[c] === region) continue;
    add(N.pRegion(region)); add(N.pChar(c));
  }
  return m;
}

/** A card the referee names, put into `side`'s hand here (a stand-in of the same deck takes its place). */
function swapIntoHand(s, side, card) {
  const p = s.cards[side];
  if (p.hand.includes(card)) return;
  const deck = N.deck(card);
  const where = [p.draw[deck], p.discardFaceDown ?? [], p.discard[deck], p.table];
  const zone = where.find((z) => z.includes(card));
  const standIn = p.hand.findIndex((c) => N.deck(c) === deck);
  if (standIn >= 0) {
    const out = p.hand[standIn];
    p.hand[standIn] = card;
    // (A card found nowhere here: its stand-in goes among the unknown face-down cards, not into a draw pile whose size
    // the referee knows.)
    if (zone) zone.splice(zone.indexOf(card), 1, out);
    else (p.discardFaceDown ??= []).push(out);
  } else {
    if (zone) zone.splice(zone.indexOf(card), 1);
    p.hand.push(card);
  }
}

/** The differences between two states' boards (figures, control, Fellowship, politics, dice, own hand), for the log. */
function boardDifferences(a, b, viewer) {
  const out = [];
  const flat = (s) => {
    const m = {};
    for (const [id, r] of Object.entries(s.regions)) {
      for (const [where, f] of [['', r], ['box.', r.siegeBox]]) {
        if (!f) continue;
        for (const [n, u] of Object.entries(f.units)) { if (u.regular) m[`${id}.${where}${n}.r`] = u.regular; if (u.elite) m[`${id}.${where}${n}.e`] = u.elite; }
        if (f.leaders) m[`${id}.${where}leaders`] = f.leaders;
        if (f.nazgul) m[`${id}.${where}nazgul`] = f.nazgul;
        if (f.characters.length) m[`${id}.${where}chars`] = [...f.characters].sort().join(',');
      }
      if (r.control) m[`${id}.control`] = r.control;
    }
    const fs = s.fellowship;
    m.fs = `${fs.location} ${fs.progress} ${fs.hidden} ${fs.corruption} ${fs.mordor} ${fs.guide} ${[...fs.companions].sort()}`;
    for (const [n, p] of Object.entries(s.nations)) m[`pol.${n}`] = `${p.step} ${p.active}`;
    for (const side of ['fp', 'shadow']) m[`dice.${side}`] = [...s.dice[side]].sort().join(',');
    m.hand = [...s.cards[viewer].hand].sort().join(',');
    m.hunt = `${s.hunt.box} ${s.hunt.fpDiceInBox} ${[...s.hunt.pool].sort()}`;
    return m;
  };
  const x = flat(a), y = flat(b);
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k]) out.push(`${k}: ${x[k] ?? '-'} | ${y[k] ?? '-'}`);
  return out;
}

// --- The protocol session -------------------------------------------------------------------------------------------

export class Session {
  constructor(opts, send) {
    this.opts = opts;
    this.send = send;
    this.game = null;
    this.played = 0;
    this.quit = false;
  }

  handle(msg) {
    switch (msg.type) {
      case 'hello': {
        const hello = {
          type: 'hello', id: msg.id, protocol: PROTOCOL, name: this.opts.name, version: this.opts.versionLabel ?? 'chooseAction (src/ai/wotrAI.ts)',
          author: 'John Champaign', events: true, options: [],
        };
        if (this.opts.seek) hello.seek = this.opts.seek;
        // An online bot: this process's id, the same on every reconnection, so the site gives it back its own game
        // (not another copy's of the same bot account).
        if (this.opts.instance) hello.instance = this.opts.instance;
        if (this.opts.token) hello.token = this.opts.token;
        this.send(hello);
        log(`referee: ${msg.referee ?? '?'} (${msg.protocol ?? '?'})`);
        break;
      }
      case 'options': break;
      case 'new_game': {
        const resumed = this.game?.id === msg.game;
        this.game = new Game(msg, this.opts);
        const c = msg.clock ?? {};
        const clock = c.kind === 'game' ? `game clock ${Math.round(c.ms / 60000)} min + ${Math.round((c.increment_ms ?? 0) / 1000)} s` : c.kind === 'correspondence' ? `correspondence, ${c.days_per_move} days a move` : c.kind ? `${c.kind} ${c.ms ?? ''} ms` : 'no clock';
        log(`game ${msg.game}: ${resumed ? 'taken up again' : 'new game'} as ${msg.side === 'FREE_PEOPLES' ? 'the Free Peoples' : 'the Shadow'}, ${clock}`);
        this.send({ type: 'ready', id: msg.id });
        break;
      }
      case 'event':
        if (this.game && (!msg.game || msg.game === this.game.id)) {
          try { this.game.event(msg.event); } catch (e) { this.game.stats.errors++; log(`[${this.game.id}] error at event ${msg.event?.kind}: ${e?.stack ?? e}`); }
        }
        break;
      case 'decide': {
        if (!this.game || (msg.game && msg.game !== this.game.id)) {
          // A question for a game this client never heard of: the first option is always legal.
          this.send({ type: 'choice', id: msg.id, o: msg.decision.options[0].o, fingerprint: msg.decision.fingerprint });
          break;
        }
        const option = this.game.decide(msg);
        const c = msg.clock;
        if (c?.left_ms !== undefined && c.left_ms < 30000 && this.opts.verbose) log(`[${this.game.id}] ${Math.round(c.left_ms / 1000)} s left`);
        this.send({ type: 'choice', id: msg.id, o: option.o, fingerprint: msg.decision.fingerprint });
        break;
      }
      case 'view': break;
      case 'timeout':
        log(`game ${msg.game}: timeout at decision ${msg.id} (the referee played ${msg.played})`);
        break;
      case 'error':
        log(`referee: error ${msg.code}${msg.message ? `: ${msg.message}` : ''}`);
        break;
      case 'game_over': {
        const g = this.game;
        const won = msg.winner ? (N.side(msg.winner) === g?.side ? 'won' : 'lost') : 'drawn';
        log(`game ${msg.game}: game over, ${won} (${msg.winner ?? 'no winner'}, ${msg.how}${msg.detail ? ` ${msg.detail}` : ''}, turn ${msg.turn ?? '?'})${g ? `; ${g.summary()}` : ''}`);
        this.game = null;
        this.played++;
        break;
      }
      case 'quit':
        this.quit = true;
        break;
      default:
        if (msg.id !== undefined) this.send({ type: 'error', id: msg.id, code: 'unknown_type' });
    }
  }
}

// --- Transports -----------------------------------------------------------------------------------------------------

function runStdio(opts) {
  const session = new Session(opts, (m) => process.stdout.write(JSON.stringify(m) + '\n'));
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { log(`not JSON: ${line.slice(0, 200)}`); return; }
    session.handle(msg);
    if (session.quit) { rl.close(); process.exit(0); }
  });
  rl.on('close', () => process.exit(0));
}

/**
 * A minimal WebSocket client (RFC 6455) on Node's own sockets: text frames, ping and pong, close. A connection that
 * brings nothing for `idleMs` (the referee pings every 20 s) is given up.
 */
export function openWebSocket(url, { idleMs = 120000, onOpen, onText, onClose }) {
  const u = new URL(url);
  const secure = u.protocol === 'wss:';
  const port = Number(u.port || (secure ? 443 : 80));
  const key = randomBytes(16).toString('base64');
  const socket = secure ? tlsConnect({ host: u.hostname, port, servername: u.hostname }) : tcpConnect({ host: u.hostname, port });
  let buf = Buffer.alloc(0);
  let open = false;
  let closed = false;
  let fragments = [];
  let idle = null;
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => finish('no traffic for 2 minutes'), idleMs); };
  const finish = (why) => {
    if (closed) return;
    closed = true;
    clearTimeout(idle);
    socket.destroy();
    onClose?.(why);
  };
  const frame = (opcode, payload) => {
    const len = payload.length;
    const head = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len])
      : len < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, len >> 8, len & 255])
      : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
    const mask = randomBytes(4);
    const body = Buffer.alloc(len);
    for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
    if (!closed) socket.write(Buffer.concat([head, mask, body]));
  };
  const ws = {
    send: (text) => frame(1, Buffer.from(text, 'utf8')),
    close: () => { try { frame(8, Buffer.alloc(0)); } catch { /* closing anyway */ } finish('closed by the bot'); },
  };
  socket.on(secure ? 'secureConnect' : 'connect', () => {
    touch();
    socket.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: wotr-protocol-bot\r\n\r\n`);
  });
  socket.on('data', (chunk) => {
    touch();
    buf = Buffer.concat([buf, chunk]);
    if (!open) {
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = buf.subarray(0, end).toString('latin1');
      buf = buf.subarray(end + 4);
      const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (!/^HTTP\/1\.1 101/.test(head) || !head.toLowerCase().includes(`sec-websocket-accept: ${accept.toLowerCase()}`)) {
        finish(`the referee refused the connection: ${head.split('\r\n')[0]}`);
        return;
      }
      open = true;
      onOpen?.(ws);
    }
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      const maskKey = masked ? buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      let payload = Buffer.from(buf.subarray(at, at + len));
      buf = buf.subarray(at + len);
      if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
      if (opcode === 9) { frame(10, payload); continue; }
      if (opcode === 10) continue;
      if (opcode === 8) { try { frame(8, payload.subarray(0, 2)); } catch { /* closing */ } finish(`closed by the referee${payload.length > 2 ? `: ${payload.subarray(2).toString('utf8')}` : ''}`); return; }
      if (opcode === 1 || opcode === 0) {
        fragments.push(payload);
        if (fin) { const text = Buffer.concat(fragments).toString('utf8'); fragments = []; onText?.(text); }
      }
    }
  });
  socket.on('error', (e) => finish(`connection error: ${e.message}`));
  socket.on('close', () => finish('connection closed'));
  return ws;
}

function runConnection(opts) {
  return new Promise((resolve) => {
    let session = null;
    let ws = null;
    openWebSocket(opts.connect, {
      onOpen: (w) => {
        ws = w;
        log(`connected to ${opts.connect.replace(/token=[^&]*/, 'token=[redacted]')}`);
        session = new Session(opts, (m) => ws.send(JSON.stringify(m)));
      },
      onText: (text) => {
        let msg;
        try { msg = JSON.parse(text); } catch { log(`not JSON: ${text.slice(0, 200)}`); return; }
        session.handle(msg);
        if (session.quit) ws.close();
      },
      onClose: (why) => resolve({ why, played: session?.played ?? 0, quit: session?.quit ?? false, connected: !!session }),
    });
  });
}

async function runOnline(opts) {
  opts.instance ??= randomBytes(8).toString('hex');
  let delay = 5000;
  for (;;) {
    const r = await runConnection(opts);
    if (r.quit || !opts.reconnect) { log(`${r.quit ? 'the referee said quit' : r.why}; done`); return; }
    if (r.played) delay = 5000;
    log(`${r.why}; dialling again in ${Math.round(delay / 1000)} s`);
    await new Promise((res) => setTimeout(res, delay));
    delay = r.played ? 5000 : Math.min(delay * 2, 300000);
  }
}

// --- Main -----------------------------------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  verbose = opts.verbose;
  if (opts.tokenFile) opts.token = readFileSync(opts.tokenFile, 'utf8').trim();
  await loadEngine(opts.root, opts.chooser);
  if (opts.chooser !== 'standard') log(`chooser: ${opts.chooser}`);
  if (opts.connect) await runOnline(opts);
  else runStdio(opts);
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { log(e?.stack ?? String(e)); process.exit(1); });
}
