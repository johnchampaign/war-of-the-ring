// Top-level play screen: drives the game through the framework useGame hook over
// a GameClientApi (local hotseat or online HTTP). Renders the redacted view; it
// never owns rules and never drives the opponent.
//
// DIE_BEARING (below): the action kinds that let the player NAME the die being
// spent. The tray's selection used to be advisory only — it filtered which actions
// were OFFERED but was never sent, so the engine re-picked by its own preference
// order and could spend a different die than the one clicked. That is how a
// Character-die army move became an ARMY-die move, which then offered the Army
// die's second move (player report: "I only get 1 move when using a [C]", p.27).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame, ChatPanel } from 'digital-boardgame-framework/client';
import type { GameClientApi, LogTime } from '../online/gameClient';
import type { GameState, RegionId, Side, DieFace, Nation } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { Board } from './Board';
import { ActionPanel, DieTag } from './ActionPanel';
import { regionName } from './names';
import { StatusBar } from './StatusBar';
import { HandStrip, TabledStrip, CardZoom, OpponentHand } from './HandStrip';
import { PoliticsPanel } from './PoliticsPanel';
import { DecisionModal, modalDecisions } from './DecisionModal';
import { MovePicker, type MovePickerKind } from './MovePicker';
import { sortieForce, retreatBlockReason } from '../engine/combat';
import { DiceTray } from './DiceTray';
import { HuntPopup, huntResultPending } from './HuntPopup';
import { BattlePopup, battleResultPending } from './BattlePopup';
import { NoticePopup, noticePending } from './NoticePopup';
import { TurnSummary } from './TurnSummary';
import { LogPanel, CopyLogButton } from './LogPanel';
import { GameOverUpload, UploadLogButton } from './GameOverUpload';
import { DiceStats } from './DiceStats';
import { ReportButton } from './ReportButton';
import { ReportResponseModal } from './ReportResponseModal';
import { getReporterId, getSeenResponses, markResponseSeen } from './reporterId';
import { HoverPreview, type Hover } from './HoverPreview';
import { dieOptions, describeAction, isCardRecruitTarget, isCardArmyMoveTarget, isSplitCardAttack, isSecondMusterTarget, trivialDie, isCardRegionPick } from './actionText';
import { moveBlockReason, musterBlockReason, cardPathBlockReason, regionHops, companionLandingActivates } from '../engine/armies';
import { basicMoveHintsApply } from './blockHints';
import { panelShowsAction, isSpatial, isCardCompanionMove } from './panelFilter';
import { movableCharsAt, characterDestinations, characterMoveBlockReason, companionGroupLeader, companionGroupDestinations, companionGroupBlockReason, CARD_COMPANION_MOVE_OPTS } from '../engine/charMove';
import { CompanionPicker } from './CompanionPicker';
import { separationActivates, separationBlockReason, revealMoveBlockReason } from '../engine/fellowship';
import { REGIONS, levelOf, sideOfNation, EVENT_BY_ID } from '../engine/data';
import { threatsAndPromisesActive } from '../engine/persistent';
import { charName } from './charInfo';

const seatLabel = (s: string) => (s === 'fp' ? 'Free Peoples' : s === 'shadow' ? 'Shadow' : s);


// Die-first filter: when the player has picked a specific die to spend, an action is
// shown only if that die can pay for it. Free/phase actions (dieOptions empty — Pass,
// Elven Ring, Hunt/Fellowship-phase steps) are always shown.
const dieAllowsAction = (a: WotrAction, view: GameState, you: Side, die: DieFace): boolean => {
  const opts = dieOptions(a, view, you);
  return opts.length === 0 || opts.includes(die);
};

/** Action kinds that accept an explicit `die` — see the header note. */
/** Which Nations belong to the Free Peoples — used to name the Nations actually
 *  travelling on a card move, so a split leaves the not-At-War half's restriction behind. */
const FP_NATION_SET = new Set<Nation>(['dwarves', 'elves', 'gondor', 'north', 'rohan'] as Nation[]);
const DIE_BEARING = new Set<WotrAction['kind']>([
  'moveFellowship', 'hideFellowship', 'separateCompanion', 'companionMuster', 'sarumanMuster',
  'drawEvent', 'playEvent', 'diplomaticAction', 'recruitUnit', 'bringMinion',
  'moveArmy', 'attack', 'moveCharacter',
]);

/** The Event card being resolved right now, pinned to the map under "Reset view". Once
 *  played it is neither in the hand nor yet in the discards, so while it asked for its
 *  targets nobody could read it (player report 585i2m023l6m5c6o). Hover shows it in the
 *  inspector; a click enlarges it. */
function ResolvingCard({ view, onHoverCard }: { view: GameState; onHoverCard: (id: string | null) => void }) {
  const [zoom, setZoom] = useState(false);
  const card = (view.pendingChoice?.data as { card?: unknown } | undefined)?.card;
  if (typeof card !== 'string' || !EVENT_BY_ID[card]) return null;
  return (
    <>
      <button data-testid="resolving-card" onClick={() => setZoom(true)} onMouseEnter={() => onHoverCard(card)} onMouseLeave={() => onHoverCard(null)}
        title="The Event card being resolved — click to enlarge"
        style={{ position: 'absolute', top: 38, left: 6, zIndex: 6, padding: '4px 9px', fontSize: 12, fontFamily: 'system-ui', background: 'rgba(28,23,16,0.92)', color: '#e9e1cc', border: '1px solid #c9a24a', borderRadius: 6, cursor: 'zoom-in', boxShadow: '0 2px 8px #0008' }}>
        <span style={{ color: '#b9b29c' }}>Resolving:</span> <b style={{ textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>{EVENT_BY_ID[card]!.name}</b>
      </button>
      {zoom && <CardZoom id={card} onClose={() => setZoom(false)} />}
    </>
  );
}

/** Where each Character that enters during the game may come in (the board hint shown
 *  while its entry is legal). */
const ENTER_HINT: Record<string, string> = {
  aragorn: 'Aragorn can enter play: Strider becomes Aragorn where he stands.',
  'gandalf-white': 'Gandalf the White can enter play: in place of Gandalf the Grey if he is on the map, otherwise in Fangorn or any unconquered Elven Stronghold.',
  saruman: 'Saruman can enter play in Orthanc.',
  'witch-king': 'The Witch-king can enter play in any region with a Shadow Army that includes at least one Sauron unit.',
  'mouth-of-sauron': 'The Mouth of Sauron can enter play in any unconquered Sauron Stronghold.',
};

export function PlayPage({ client, onExit }: { client: GameClientApi; onExit?: () => void }) {
  // Realtime move push when available (online); polling fallback otherwise.
  const g = useGame<GameState, WotrAction>(client as any, { subscribe: client.subscribeMoves });
  // Die-first turn flow (Ira #8): pick one of your dice → only that die's actions show
  // (in the panel AND on the board). null = no filter (every legal action visible).
  const [die, setDie] = useState<DieFace | null>(null); // the die face the player selected in the tray
  const [diceStatsOpen, setDiceStatsOpen] = useState(false); // the end-of-game dice statistics
  const me: Side = g.you === 'shadow' ? 'shadow' : 'fp';
  // Move-receipt times for the game log (feature F): re-fetched whenever the log
  // grows. Best-effort — a failed fetch just leaves the log undated.
  const [logTimes, setLogTimes] = useState<LogTime[]>([]);
  const logLen = g.view?.log?.length ?? 0;
  useEffect(() => {
    let cancelled = false;
    client.logTimes?.().then((t) => { if (!cancelled) setLogTimes(t); }).catch(() => { /* undated log */ });
    return () => { cancelled = true; };
  }, [client, logLen]);
  // Drop a stale selection (die spent / new round) so we never filter to a die you no longer have.
  const activeDie = die && (g.view?.dice[me] ?? []).includes(die) ? die : null;
  // The die your Action spent, held while that Action is still being resolved — a
  // pending second Army move, a battle, a card asking for its targets — so the tray
  // keeps showing what is paying (player report 6b0u2t1l4w535d1d). Dice are only ever
  // spent by their owner, so a new entry in your used dice is your own Action's die.
  const [inActionDie, setInActionDie] = useState<DieFace | null>(null);
  const usedMine = g.view?.usedDice?.[me];
  const usedLen = useRef({ side: me, n: usedMine?.length ?? 0 });
  const actionOpen = !!(g.view?.pendingChoice || g.view?.pendingCombat);
  useEffect(() => {
    const n = usedMine?.length ?? 0;
    // Hotseat hands the screen to the other side: start that side's count afresh.
    if (usedLen.current.side !== me) setInActionDie(null);
    else if (n > usedLen.current.n && actionOpen) setInActionDie(usedMine![n - 1]!);
    else if (!actionOpen || n < usedLen.current.n) setInActionDie(null);
    usedLen.current = { side: me, n };
  }, [usedMine, actionOpen, me]);
  // A map/modal action that more than one die could pay for, clicked with no die
  // pre-selected: ask, exactly as the panel's card/diplomacy buttons do. The old
  // auto-pick chose for the player, and a Will of the West is NOT strictly better
  // than the plain die (The Day Without Dawn discards Will dice only) — player
  // report 690g3p1z041n6q1g.
  const [diePick, setDiePick] = useState<WotrAction | null>(null);
  // Drop the pending prompt outright once the turn leaves you, so it cannot come back
  // pointing at an action from a turn that has already ended.
  useEffect(() => { if (!g.yourTurn) setDiePick(null); }, [g.yourTurn]);
  const charDieOk = !activeDie || activeDie === 'character' || activeDie === 'will';
  const [selected, setSelected] = useState<RegionId | null>(null);
  // A card that moves an Army "through more than one region" is traced step by step:
  // each click takes one step, and the route decides what is captured on the way
  // (p.27 — player report 384n5a5y63480b3g). `route` holds the regions entered so far.
  const [route, setRoute] = useState<RegionId[]>([]);
  const [moveDraft, setMoveDraft] = useState<{ from: string; to: string; kind: MovePickerKind; base?: WotrAction } | null>(null);
  // Board-driven independent-character (Nazgûl / Minion / Companion) move in progress.
  // `group` (Companions only): move several together — range = highest Level (p.24).
  // `card`: a Companion move granted by an Event card (Fear! Fire! Foes!, Book of
  // Mazarbul, We Prove the Swifter, Gwaihir) — the same flow as a Character die's.
  const [charPick, setCharPick] = useState<{ from: RegionId; char: string; group?: string[]; card?: string } | null>(null);
  // A Minion entering play, chosen from his panel button: his entry regions light up and
  // a click places him (player report 3v5t0l4a6t1g3f73 — like Summon Gandalf the White).
  const [minionPick, setMinionPick] = useState<string | null>(null);
  // Choosing WHO travels in a Companion group, before its destination (CompanionPicker).
  const [compPick, setCompPick] = useState<{ from: RegionId; candidates: string[]; card?: string } | null>(null);
  // When a clicked region offers more than one thing to move (e.g. the army AND its
  // Nazgûl), let the player choose which.
  const [moveMenu, setMoveMenu] = useState<{ region: RegionId; options: Array<{ kind: 'army'; char?: undefined; chars?: undefined } | { kind: 'assault'; char?: undefined; chars?: undefined } | { kind: 'muster'; char?: undefined; chars?: undefined } | { kind: 'chargroup'; chars: string[]; char?: undefined } | { kind: 'char'; char: string; chars?: undefined } | { kind: 'cardchar'; act: WotrAction; label: string; char?: undefined; chars?: undefined } | { kind: 'cardgroup'; acts: WotrAction[]; char?: undefined; chars?: undefined } | { kind: 'cardcomps'; chars: string[]; card: string; char?: undefined }> } | null>(null);
  const [musterMenu, setMusterMenu] = useState<RegionId | null>(null); // board-click muster: the chosen Settlement
  // Choosing HOW MANY Nazgûl to move from a stack (RAW: move any number, not the whole group).
  // `card` set = this came from a Nazgûl-moving EVENT CARD, so confirming submits an
  // eventTarget rather than a Character-die move. Same picker either way, because it is
  // the same decision (player reports: the card path silently moved the whole stack).
  const [nazPick, setNazPick] = useState<{ from: RegionId; to: RegionId; max: number; card?: string } | null>(null);
  // Why the last attempted move/merge was refused (shown so it isn't a silent no-op).
  const [blockMsg, setBlockMsg] = useState<string | null>(null);
  // The framework's `error` has no clear() — it stands until the next successful
  // fetch/submit. Remember the message the player dismissed so the banner can be
  // clicked away like blockMsg, and forget it the moment the error actually clears
  // (so the SAME message recurring later is shown again rather than swallowed).
  const [errorSeen, setErrorSeen] = useState<string | null>(null);
  const errorMsg = g.error && g.error.message !== errorSeen ? g.error.message : null;
  useEffect(() => { if (!g.error) setErrorSeen(null); }, [g.error]);
  // Replies to this device's resolved problem reports, fetched once on load.
  // Each unseen one pops a modal; dismissing marks it seen so it won't recur.
  const [responseQueue, setResponseQueue] = useState<{ reportId: string; message: string; response: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rid = getReporterId();
        if (!rid) return;
        const res = await fetch(`/api/my-responses?reporterId=${encodeURIComponent(rid)}`);
        if (!res.ok || cancelled) return;
        const body = await res.json() as { ok?: boolean; responses?: { reportId: string; message: string; response: string }[] };
        if (!body.ok || !Array.isArray(body.responses)) return;
        const seen = getSeenResponses();
        const unseen = body.responses.filter((r) => r.response && !seen.has(r.reportId));
        if (unseen.length && !cancelled) setResponseQueue(unseen);
      } catch { /* offline / dev with no API — just skip */ }
    })();
    return () => { cancelled = true; };
  }, []);
  const [hover, setHover] = useState<Hover>(null);
  // The Log pop-up has its OWN hover state. If it drove the shared `hover`, hovering
  // a card in the log would ALSO light up the always-on bottom inspector behind the
  // pop-up backdrop — the card rendered twice, offset and dimmed ("doubled and
  // staggered", player report). Keeping it separate confines the preview to the pop-up.
  const [logHover, setLogHover] = useState<Hover>(null);
  const onHoverRegion = useCallback((id: RegionId | null) => setHover(id ? { kind: 'region', id } : null), []);
  const onHoverCard = useCallback((id: string | null) => setHover(id ? { kind: 'card', id } : null), []);
  const onHoverChar = useCallback((id: string | null) => setHover(id ? { kind: 'character', id } : null), []);

  // Guard against a rapid double-click submitting a now-stale action (e.g. clicking
  // a combat decision twice before the re-render): drop submits while one is in flight.
  const inFlight = useRef(false);
  // Visible "working…" state for the same window. Submitting is never instant — online
  // it is a round trip plus the server AI's whole turn, and locally the AI's turn runs
  // right inside submit — and until it lands the screen looks completely unchanged
  // (player report: "after you click the action there's delay but nothing happens on
  // the screen"). The local AI's turn is SYNCHRONOUS, so setting the flag is not enough
  // on its own: without yielding, the browser never gets a frame to paint the indicator
  // before the work blocks the main thread. `paint()` waits for one (double rAF — the
  // second callback runs after the first frame has been committed).
  const [busy, setBusy] = useState(false);
  const paint = () => new Promise<void>((res) => {
    // A hidden/backgrounded tab does not composite, so its rAF callbacks never run.
    // Waiting on them alone would strand the move forever (caught in verification —
    // the click registered, the indicator appeared, and the turn never resolved), so
    // the timer is the floor: whichever fires first releases the submit.
    if (typeof document !== 'undefined' && document.hidden) { res(); return; }
    const t = setTimeout(res, 80);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); res(); }));
  });
  const submit = useCallback(async (a: WotrAction) => {
    if (inFlight.current) return;
    // Any action reaching this funnel SUPERSEDES an open "which die pays?" prompt.
    // The prompt used to sit there while the player did something else entirely, and
    // its buttons still submitted the abandoned action — clicking one later replayed
    // a move that was no longer possible and answered with a red "You have no Army to
    // move there." hint (player report 1z2b2n2n340v6e0c). The disambiguation branch
    // below re-arms it for the action actually being asked about.
    setDiePick(null);
    // The card Gandalf the White grants after an Ents card is played WITHOUT a die, so
    // it must not ask which die pays (player report 6v145h2o5w361j27).
    // Likewise every move after the first in a Character-die move: that die was spent
    // by the first move, and the rest ride on it (player report 4i6k5k5c6761245r).
    const dieFree = (a.kind === 'playEvent' && g.view?.pendingChoice?.kind === 'freeCharEvent')
      || (a.kind === 'moveCharacter' && g.view?.pendingChoice?.kind === 'charMove2');
    if (!dieFree && !activeDie && DIE_BEARING.has(a.kind) && !(a as { die?: DieFace }).die && g.view && g.you) {
      const opts = dieOptions(a, g.view, g.you as Side);
      // The plain-vs-hybrid case is settled without asking (same rule as the action
      // list — player report 4w2p23491g062m5l); every other multi-die action asks.
      const easy = trivialDie(opts, a.kind);
      if (easy) a = { ...a, die: easy } as WotrAction;
      else if (opts.length > 1) { setDiePick(a); return; }
    }
    inFlight.current = true;
    // Name the die the player actually picked (see DIE_BEARING).
    const withDie = (!dieFree && activeDie && DIE_BEARING.has(a.kind) && !(a as { die?: DieFace }).die)
      ? { ...a, die: activeDie } as WotrAction
      : a;
    setBusy(true);
    await paint();
    // A rejected action is already surfaced: useGame re-syncs, sets g.error (the hint
    // banner shows it) and then rethrows. Every caller fires and forgets, so letting
    // that rethrow escape only put an "Uncaught (in promise)" in the console (player
    // report 2b2u0a575e5u3a70). Resolve false instead so a chained caller can stop.
    try { await g.submit(withDie); setDie(null); return true; }
    catch { return false; }
    finally { inFlight.current = false; setBusy(false); }
  }, [g, activeDie]);

  // Undo (local hotseat / vs-AI only — the online client has no undo()). A
  // foreknowledge undo (one that crosses a dice roll / card draw) requires an explicit
  // confirm, and the game log records it.
  const [undoConfirm, setUndoConfirm] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // "Already clicked through" cursors for the three result popups (Hunt, battle,
  // notice). They live here, not inside each popup, so the opponent's "while you
  // waited" recap can WAIT for a result you haven't acknowledged: an unsuccessful
  // Hunt resolves with no prompt, the AI plays on immediately, and its recap used to
  // land on top of the Hunt result the moment it appeared (player report).
  const [huntSeen, setHuntSeen] = useState(0);
  const [battleSeen, setBattleSeen] = useState(0);
  const [noticeSeen, setNoticeSeen] = useState(0);
  // These markers live in component state, so a RELOAD resets them to 0 while the
  // engine still carries its retained history (hunt.draws keeps the last 16). Every
  // old entry then counted as unseen and the popups replayed the whole backlog at
  // once — player report: after reloading, "7 tiles drawn from the bag" showing a
  // previous turn's Hunt tiles and a Foul Thing draw. These popups announce what JUST
  // happened (the Hunt-tile browser is the history view), so on the first view we
  // receive, everything already recorded counts as seen.
  const primedSeen = useRef(false);
  useEffect(() => {
    if (primedSeen.current || !g.view) return;
    primedSeen.current = true;
    const maxSeq = (xs: Array<{ seq: number }> | undefined) => (xs ?? []).reduce((m, x) => Math.max(m, x.seq), 0);
    setHuntSeen(maxSeq(g.view.hunt?.draws));
    setBattleSeen(g.view.lastBattle?.seq ?? 0);
    setNoticeSeen(maxSeq(g.view.notices));
  }, [g.view]);
  // A card's roll popup waits for open choices to clear (noticePending), but the cards
  // that roll at an Army ask their question straight after the roll — which units fall,
  // where the Nazgûl fly, where the Army retreats. The roll is shown WITH that question
  // instead, so the player sees the dice before answering (player reports
  // 070f5x2t003i394j, 3d5q0g6q6r460b5z); answering marks it seen.
  const ROLL_QUESTIONS = new Set(['eventCasualties', 'eaglesRefuge', 'cardRetreat']);
  const rollContext = g.view?.pendingChoice && ROLL_QUESTIONS.has(g.view.pendingChoice.kind)
    ? (g.view.notices ?? []).filter((n) => n.seq > noticeSeen) : [];
  const markRollSeen = () => { if (rollContext.length) setNoticeSeen(Math.max(...rollContext.map((n) => n.seq))); };
  // After an UNDO the game's event numbers rewind, but these "seen" markers did not: the
  // next Hunt draw, battle or notice reused a number already marked seen, and its popup
  // never appeared (player reports 6z0a4u2v0d5z5e05 — an Orc Patrol Eye with no popup —
  // and 6r582a470b1r6l6n). Re-prime them to the restored game once it arrives.
  const [undoTick, setUndoTick] = useState(0);
  const primedUndo = useRef(0);
  useEffect(() => {
    if (!g.view || undoTick === primedUndo.current) return;
    primedUndo.current = undoTick;
    const maxSeq = (xs: Array<{ seq: number }> | undefined) => (xs ?? []).reduce((m, x) => Math.max(m, x.seq), 0);
    setHuntSeen(maxSeq(g.view.hunt?.draws));
    setBattleSeen(g.view.lastBattle?.seq ?? 0);
    setNoticeSeen(maxSeq(g.view.notices));
  }, [g.view, undoTick]);
  const [logsUploaded, setLogsUploaded] = useState(false); // shared by the Upload button + end-game prompt
  // "Peek the board": temporarily hide a blocking choice modal (combat/hunt decision,
  // move picker) so you can study the board, then click again to return to the choice.
  // (mirrors the Star Wars Rebellion feature.) Reset whenever the prompt changes/clears
  // so a leftover peek can never hide the next prompt.
  const [peekBoard, setPeekBoard] = useState(false);
  const promptSig = (g.view?.pendingChoice?.kind ?? '') + (moveDraft ? '|md' : '');
  useEffect(() => { setPeekBoard(false); }, [promptSig]);
  const runUndo = useCallback(async () => {
    setUndoConfirm(false);
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    await paint();
    try { await client.undo?.(); await g.refresh(); setSelected(null); setCharPick(null); setMoveMenu(null); setMoveDraft(null); setBlockMsg(null); setDie(null); setUndoTick((t) => t + 1); }
    finally { inFlight.current = false; setBusy(false); }
  }, [client, g]);

  // Chat is online-only (a remote opponent to talk to); the hotseat client omits
  // the messaging methods, so it's hidden in that mode.
  const chatClient = useMemo(
    () => (client.listMessages && client.postMessage
      ? { listMessages: client.listMessages.bind(client), postMessage: client.postMessage.bind(client) }
      : null),
    [client],
  );

  const armyActs = useMemo(() => {
    // A siege ASSAULT is an attack from===to, so it has no separate destination to
    // click; it is kept OUT of this list (which feeds `destinations`) and handled by
    // `assaultActs` below — click the besieged region itself and choose "Assault".
    const acts = g.legalActions.filter(isSpatial).filter((a) => !(a.kind === 'attack' && a.from === a.to));
    return activeDie && g.view && g.you ? acts.filter((a) => dieAllowsAction(a, g.view!, g.you as Side, activeDie)) : acts;
  }, [g.legalActions, activeDie, g.view, g.you]);
  // The optional SECOND army move (Army die). Board-driven like the first move: select
  // the army on the map, then its destination (report: the panel list was awkward).
  const armyMove2Acts = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'armyMove2' }> => a.kind === 'armyMove2' && !!a.from && !!a.to), [g.legalActions]);
  const boardArmyActs = useMemo(() => [...armyActs, ...armyMove2Acts], [armyActs, armyMove2Acts]); // mutually exclusive states
  const isArmyMove2 = armyMove2Acts.length > 0;
  // Board-click placement of the Fellowship figure: declaring it (Fellowship phase) or
  // choosing where it moves when revealed by the Hunt (revealMove choice).
  const placeActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'declareFellowship' | 'revealMove' | 'separateMove' }> => a.kind === 'declareFellowship' || a.kind === 'revealMove' || a.kind === 'separateMove'), [g.legalActions]);
  // Playing an Event card is clicking it in your hand (player report
  // 4b4f6o3p5v066c5o). The die choice rides along unchanged: submit() settles the
  // trivial Army/Muster case itself and asks for anything else.
  const playableCards = useMemo(() => {
    const m = new Map<string, WotrAction>();
    // A card lights only if the selected die can pay for it, like the panel's list
    // (player report 1e2v5l5f0q5d6h0v).
    if (g.yourTurn) for (const a of g.legalActions) {
      if (a.kind !== 'playEvent' || m.has(a.cardId)) continue;
      if (activeDie && g.view && g.you && !dieAllowsAction(a, g.view, g.you as Side, activeDie)) continue;
      m.set(a.cardId, a);
    }
    return m;
  }, [g.legalActions, g.yourTurn, activeDie, g.view, g.you]);
  // Retreat destinations are board clicks (player report 0f3003342g666741): the
  // battle modal asks Retreat-or-stand, the MAP answers "to where".
  // The Eagles are Coming!'s refuge for the surviving Nazgûl is the same kind of pick —
  // a region on the map, the modal stepping aside (player report 3e624i0y1v4p2o2c).
  const retreatActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'retreatTo' | 'preCombatRetreat' | 'eaglesRefuge' | 'cardRetreat' }> => a.kind === 'retreatTo' || a.kind === 'preCombatRetreat' || a.kind === 'eaglesRefuge' || a.kind === 'cardRetreat'), [g.legalActions]);
  const isRetreatPick = retreatActs.length > 0;
  const isEaglesPick = retreatActs.some((a) => a.kind === 'eaglesRefuge');
  // Gandalf the White's entry: a board click on one of the card's candidate regions.
  const gandalfActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'placeGandalf' }> => a.kind === 'placeGandalf'), [g.legalActions]);
  const isPlaceGandalf = gandalfActs.length > 0;
  const declareTargets = useMemo(() => new Set([...placeActs.map((a) => a.target).filter((t): t is RegionId => !!t), ...gandalfActs.map((a) => a.region), ...retreatActs.map((a) => a.region)]), [placeActs, gandalfActs, retreatActs]);
  const isReveal = g.view?.pendingChoice?.kind === 'revealMove';
  const isSeparateMove = g.view?.pendingChoice?.kind === 'separateMove';
  // Continuing a Character-die move (RAW: one die moves all eligible characters).
  // `charMoved` lists what has already moved this die, so those figures drop out.
  const isCharMove2 = g.view?.pendingChoice?.kind === 'charMove2';
  const charMoved = useMemo(
    () => (isCharMove2 ? (g.view!.pendingChoice!.data as { chars: string[]; movedNazgul: Record<string, number> } | undefined) : undefined),
    [isCharMove2, g.view],
  );
  // Character figures are board-movable when a Character/Will die is free (first move)
  // OR we're mid-chain continuing the same die.
  const charMoveOk = charDieOk || isCharMove2;
  // Card-driven Companion separation, destination step: eventTarget options carrying
  // both a companion and a region. Placed on the BOARD (not 60+ buttons).
  // (A card move of Companions already ON the map is not a separation — see cardCompMoves.)
  const cardSepActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'eventTarget' }> => a.kind === 'eventTarget' && !!a.region && !!a.companion && !isCardCompanionMove(a)), [g.legalActions]);
  const cardSepTargets = useMemo(() => new Set(cardSepActs.map((a) => a.region!)), [cardSepActs]);
  const isCardSep = cardSepActs.length > 0;
  // Gwaihir / We Prove the Swifter also MOVE Companions already on the map. Picking
  // which ones used to be panel buttons; it now works like every other figure move —
  // click their region and choose from the menu (player report 6f03724h00040z3r).
  // These targets carry `from` + `companion` and no region; the DESTINATION step
  // (companion + region) was already a board click, above.
  const cardCharPicks = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'eventTarget' }> =>
    a.kind === 'eventTarget' && !!a.from && !!a.companion && !a.region && !a.done), [g.legalActions]);
  const cardCharSources = useMemo(() => new Set(cardCharPicks.map((a) => a.from!)), [cardCharPicks]);
  // A card moving Companions already on the map (Fear! Fire! Foes!, Book of Mazarbul,
  // the "or move" branch of We Prove the Swifter / Gwaihir): each offered target is one
  // Companion's move. The player picks the group in the same picker a Character die
  // uses and clicks the destination on the map (player reports 674b1i0u5719635k,
  // 186w6s0a051h4534, 231u2i4l5p19426w).
  const cardCompMoves = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'eventTarget' }> => isCardCompanionMove(a)), [g.legalActions]);
  const cardCompSources = useMemo(() => new Set(cardCompMoves.map((a) => a.from!)), [cardCompMoves]);
  // A card's bare REGION pick — the Army it strikes, the Nazgûl the Eagles fall on, where
  // Cruel Weather blows the Fellowship: a highlighted region to click, not a modal button
  // (player reports 45031a1d013o5x0m, 6z342y5h274r046w).
  const cardRegionActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'eventTarget' }> => isCardRegionPick(a)), [g.legalActions]);
  const cardRegionTargets = useMemo(() => new Set(cardRegionActs.map((a) => a.region!)), [cardRegionActs]);
  const isCardCharPick = cardCharPicks.length > 0;
  // Independent characters (Nazgûl/Minion/Companion) are board-movable when a
  // Character (or Will) die is available — detected by any moveCharacter being legal.
  const canMoveChars = useMemo(() => g.legalActions.some((a) => a.kind === 'moveCharacter'), [g.legalActions]);
  const charSources = useMemo(() => {
    const s = new Set<RegionId>();
    if (g.view && canMoveChars && charMoveOk && g.you) for (const id of Object.keys(g.view.regions)) {
      if (movableCharsAt(g.view, g.you as Side, id, charMoved).length) s.add(id);
    }
    return s;
  }, [g.view, canMoveChars, charMoveOk, charMoved, g.you]);
  // Siege assaults / sorties (attack with from === to). ONE die-filtered list drives
  // the highlight, the region click and the panel's pointer, so the three can't
  // disagree — they used to read raw legalActions while every other board affordance
  // (army moves, musters, Minion entries) was filtered by the selected die, so picking
  // a Muster die still offered an assault it could not pay for.
  const assaultActs = useMemo(() => {
    const acts = g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'attack' }> => a.kind === 'attack' && a.from === a.to);
    return activeDie && g.view && g.you ? acts.filter((a) => dieAllowsAction(a, g.view!, g.you as Side, activeDie)) : acts;
  }, [g.legalActions, activeDie, g.view, g.you]);
  // A card's ASSAULT (Grond, The Fighting Uruk-hai, a Nazgûl-led or Witch-king's Army
  // storming the Stronghold it besieges) is the same board click — the besieged region
  // and "⚔ Assault" — not a panel button (player report 1w2k3i631m5c5a4z).
  const cardAssaultActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'eventTarget' }> =>
    a.kind === 'eventTarget' && a.mode === 'attack' && !!a.from && a.from === a.to && !a.done), [g.legalActions]);
  const assaultSources = useMemo(() => [...assaultActs.map((a) => a.from), ...cardAssaultActs.map((a) => a.from!)], [assaultActs, cardAssaultActs]);
  // Board-click MUSTERING (player report: paging the panel's recruit buttons was
  // tedious): eligible Settlements highlight; clicking one opens its bundle menu.
  const recruitActs = useMemo(() => {
    const acts = g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'recruitUnit' }> => a.kind === 'recruitUnit');
    return activeDie && g.view && g.you ? acts.filter((a) => dieAllowsAction(a, g.view!, g.you as Side, activeDie)) : acts;
  }, [g.legalActions, activeDie, g.view, g.you]);
  // Minion entries (the Witch-king / Saruman / the Mouth) join the board-click
  // muster flow: their candidate regions highlight, and the Settlement's bundle
  // menu lists them (player report: 'a popup to place the witchking in a sauron
  // army would be wonderful' — it was a wall of one-button-per-region).
  const minionActs = useMemo(() => {
    const acts = g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'bringMinion' }> => a.kind === 'bringMinion');
    return activeDie && g.view && g.you ? acts.filter((a) => dieAllowsAction(a, g.view!, g.you as Side, activeDie)) : acts;
  }, [g.legalActions, activeDie, g.view, g.you]);
  // Card-driven RECRUITS (Riders of Rohan, Imrahil, Faramir's Rangers' Osgiliath half, ...)
  // join the muster flow: their Settlements highlight and the bundle menu lists them
  // (player report 2s3p6y0x000k6b70). Card-driven ARMY MOVES likewise join the army
  // flow below: click the army, then the highlighted destination.
  const cardRecruitActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'eventTarget' }> => isCardRecruitTarget(a)), [g.legalActions]);
  const isCardRecruit = cardRecruitActs.length > 0;
  const cardMoveActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'eventTarget' }> => isCardArmyMoveTarget(a)), [g.legalActions]);
  const isCardMove = cardMoveActs.length > 0;
  // Everything about the in-progress trace: where we stand, how far the card still
  // reaches, which neighbours are legal next steps, and whether we may stop here.
  const FP_NATIONS = FP_NATION_SET;
  const trace = useMemo(() => {
    if (!selected || !g.view || !g.you) return null;
    const legs = cardMoveActs.filter((a) => a.from === selected && a.mode !== 'attack');
    if (!legs.length) return null;
    // A card that can also ATTACK out of this region keeps the old one-click flow:
    // an attack is declared from where the Army stands, so it does not compose with
    // walking a route first.
    if (cardMoveActs.some((a) => a.from === selected && a.mode === 'attack')) return null;
    const head = (route.length ? route[route.length - 1] : selected) as RegionId;
    // The card's REACH, as the card states it ("move one Army up to three regions") —
    // not the distance to the nearest thing it happens to offer. Guessing the budget
    // from the offered destinations made the same pair of Armies walkable one way and
    // not the other: from an Army whose only partner was two regions off, the budget
    // came out 2, so the three-region detour that reached it the other way was refused
    // (player report 1y683v3l5s0z3o1u, "I can move from Eastemnet via Folde to Dead
    // Marshes, but not from Dead Marshes via Folde to Eastemnet"). The old guess stays
    // as the fallback for cards that don't state a range.
    // A DIRECT card move has no route to trace: Paths of the Woses goes "directly to
    // Minas Tirith", Corsairs of Umbar lands "from Umbar to a Gondor coastal region".
    // Falling back to a region-hop guess made the map demand a walkable path to a
    // destination the card reaches by fiat, and then refused the move when no such path
    // existed (player report 1u1f45154m472g67). Hand these back to the plain
    // click-the-destination flow.
    if (legs.some((a) => a.direct)) return null;
    const budget = Math.max(...legs.map((a) => a.range ?? regionHops(selected as RegionId, a.to!)));
    // A ONE-REGION card move is an ordinary Army move — there is no route to trace, so
    // hand it back to the plain click-the-destination flow rather than making the
    // player walk a single step and then confirm it (player report 6124175c5o6r2f1r,
    // about The Shadow is Moving).
    if (budget <= 1) return null;
    const nations = (Object.keys(g.view.regions[selected]?.units ?? {}) as Nation[])
      .filter((n) => (g.you === 'fp') === FP_NATIONS.has(n));
    const steps = new Set<RegionId>();
    if (route.length < budget) {
      for (const n of REGIONS[head]?.adjacency ?? []) {
        // A route MAY walk back through a region it has already entered (only ENDING
        // where it started is barred, and the engine never offers that destination) —
        // barring revisits here made legal detours impossible to trace (player report
        // 306c5v2g003c6332).
        if (!cardPathBlockReason(g.view, selected as RegionId, [...route, n as RegionId], g.you as Side, nations)) steps.add(n as RegionId);
      }
    }
    const finish = legs.find((a) => a.to === head) ?? null;
    return { head, budget, steps, finish, left: budget - route.length };
  }, [selected, route, cardMoveActs, g.view, g.you]);
  // A Muster die's optional SECOND figure takes the same board flow as the first
  // (player report 6r5a254l3f035e3l); only "no second figure" stays a panel button.
  const secondMusterActs = useMemo(() => g.legalActions.filter(isSecondMusterTarget), [g.legalActions]);
  // Minions are no longer entered from the muster menu — their own panel button asks for
  // the region (minionPick) — so their regions are not muster targets.
  const musterTargets = useMemo(() => new Set([...recruitActs.map((a) => a.region), ...cardRecruitActs.map((a) => a.region!), ...secondMusterActs.map((a) => a.region!)]), [recruitActs, cardRecruitActs, secondMusterActs]);
  const minionPickActs = useMemo(() => (minionPick ? minionActs.filter((a) => a.minion === minionPick) : []), [minionPick, minionActs]);
  const minionPickTargets = useMemo(() => new Set(minionPickActs.map((a) => a.region)), [minionPickActs]);
  const sources = useMemo(() => new Set<RegionId>([...boardArmyActs.map((a) => a.from!), ...cardMoveActs.map((a) => a.from!), ...assaultSources, ...musterTargets, ...declareTargets, ...charSources, ...cardSepTargets, ...cardCharSources, ...cardCompSources]), [boardArmyActs, cardMoveActs, cardCharSources, cardCompSources, assaultSources, musterTargets, declareTargets, charSources, cardSepTargets]);
  // The generic "why can't I do that?" hints (moveBlockReason / musterBlockReason)
  // belong to the BASIC Move / Muster actions during Action Resolution, and nowhere
  // else. Every other map click is a different question — placing the Ring-bearers on
  // a reveal, a separation, an Event card picking its own targets — and answering it
  // with a muster/move rule yields a statement that is TRUE but is not why the click
  // was refused: a revealed Fellowship clicked onto a besieged Minas Tirith was told
  // "There is an enemy Army in Minas Tirith", when the actual bar is that the
  // Ring-bearers may not reveal into an unconquered Free Peoples City or Stronghold
  // (player report 5f3q6k1f20650635). That report also settles HOW to fix it: Event
  // cards can drive arbitrary map clicks, so writing a bespoke hint per interaction is
  // a slippery slope — outside this window the click stays silent, which is what the
  // other placement flows already did.
  // armyMove2 / charMove2 ARE the basic move continued on the same die, so they count;
  // any other pendingChoice means some other machine owns the board right now.
  const basicMoveWindow = useMemo(() => basicMoveHintsApply(g.view), [g.view]);
  // A hint already on screen when the window closes is just as misleading as one
  // raised outside it — drop it as the board changes hands.
  useEffect(() => { if (!basicMoveWindow) setBlockMsg(null); }, [basicMoveWindow]);
  // …and so is one left over from an Action that has ended: every Action spends a die,
  // so a die leaving either pool clears it (player report 662j57501s6k6d5j).
  const diceLeft = g.view ? g.view.dice.fp.length + g.view.dice.shadow.length : 0;
  useEffect(() => { setBlockMsg(null); }, [diceLeft]);
  // A retreat hint belongs to the retreat pick; it goes when the pick does.
  useEffect(() => { setBlockMsg(null); }, [isRetreatPick]);
  // Peeking is a look at the board DURING one blocking prompt; once that prompt is gone
  // the peek has to end with it, or the toggle stays latched on and hides the NEXT
  // modal before the player has seen it.
  const peekable = !!moveDraft || !!g.view?.pendingCombat || modalDecisions(g.view, g.legalActions).length > 0;
  useEffect(() => { if (!peekable) setPeekBoard(false); }, [peekable]);
  // What the MAP offers that the action list deliberately leaves out. The panel has to
  // NAME these: army moves, musters, Minion entries, character moves and siege assaults
  // are all board-driven, so a turn whose only actions are on the map would otherwise
  // leave the list reading "No actions." with no hint of where to look. The two dedupes
  // in `panelActionsAll` (reports 6y3j4u31164n1c5r, 2j4j710i000x3k0b) remove the last
  // two buttons that were covering for this, so the pointer has to be honest now.
  const boardHints = useMemo(() => {
    const out: string[] = [];
    // Character and Nazgûl moves are covered by "Move or attack" (player report
    // 38082l3z263r3e4h: the separate character hint read as excluding the Nazgûl).
    if (boardArmyActs.length || charSources.size) out.push('Move or attack — click a highlighted region on the map.');
    if (musterTargets.size) out.push('Muster — click a highlighted region on the map.');
    // The Fellowship phase is board-driven too (player report 414d1l3969347125).
    if (g.legalActions.some((a) => a.kind === 'declareFellowship')) out.push('Declare the Fellowship — click a highlighted region on the map.');
    // A card moving Companions already on the map points at the map like a Character
    // die does (player report 231u2i4l5p19426w).
    if (cardCompMoves.length) {
      const name = EVENT_BY_ID[cardCompMoves[0]!.card]?.name ?? 'The card';
      out.push(`${name}: move Companions — click a highlighted region on the map, then where they go.`);
    }
    // The Ents Awake: one Character card from the hand, free (player report 1q4m361n2s444f4d).
    if (g.view?.pendingChoice?.kind === 'freeCharEvent' && g.yourTurn) out.push('The Ents Awake: you may play a Character Event card from your hand now, without a die — click it in your hand, or "Done" to play none.');
    // A Character that may come into play now, and where (player report
    // 504u5o696f1g2x68) — the entry action itself is unchanged.
    const entering = new Set(g.legalActions.flatMap((a) => a.kind === 'bringMinion' ? [a.minion] : a.kind === 'bringUpgrade' ? [a.which] : []));
    for (const id of ['aragorn', 'gandalf-white', 'saruman', 'witch-king', 'mouth-of-sauron']) if (entering.has(id as never)) out.push(ENTER_HINT[id]!);
    if (cardRegionActs.length) {
      const card = cardRegionActs[0]!.card;
      const what = ({ 'sh-char-19': 'click the Free Peoples Army to strike', 'fp-str-06': 'click the Shadow Army to strike', 'fp-str-05': 'click the Shadow Army to strike',
        'fp-char-18': 'click the Nazgûl the Eagles strike', 'sh-char-10': 'click the region the Fellowship is driven into' } as Record<string, string>)[card] ?? 'click a highlighted region';
      out.push(`${EVENT_BY_ID[card]?.name ?? 'The card'}: ${what} — the highlighted regions on the map.`);
    }
    return out;
  }, [boardArmyActs, assaultSources, musterTargets, charSources, g.legalActions, cardCompMoves, cardRegionActs, g.view, g.yourTurn]);
  // The Companion currently being separated (Character-die or card), if any.
  const sepCompanion = useMemo(() => {
    if (isSeparateMove) return (g.view?.pendingChoice?.data as { companions?: string[] } | undefined)?.companions?.[0] ?? null;
    if (isCardSep) { const c = cardSepActs[0]?.companion; return c && c !== 'nazgul' ? c : null; }
    return null;
  }, [isSeparateMove, isCardSep, cardSepActs, g.view]);
  // The region currently "selected" for highlighting (an army source, a char source, or a menu region).
  // While a card route is being traced, the ACTIVE region is where the Army has
  // walked to, not where it set out — that is the one the next step leaves from.
  const activeRegion = trace?.head ?? selected ?? charPick?.from ?? moveMenu?.region ?? null;
  const charDestinations = useMemo(
    // `group` matters for Gandalf the White: Shadowfax's four regions depend on who
    // rides WITH him, so the highlighted destinations must know the travelling party.
    () => (g.view && charPick && g.you ? new Set(charPick.card
      ? companionGroupDestinations(g.view, g.you as Side, charPick.from, charPick.group ?? [charPick.char], CARD_COMPANION_MOVE_OPTS[charPick.card] ?? {})
      : charPick.group
      ? companionGroupDestinations(g.view, g.you as Side, charPick.from, charPick.group)
      : characterDestinations(g.view, g.you as Side, charPick.char, charPick.from)) : new Set<RegionId>()),
    [g.view, charPick, g.you],
  );
  // Among the destinations of a separation OR any Companion move (die or card), the
  // ones that ROUSE a passive Free Peoples Nation — marked ★, the same way everywhere
  // (player report 395d3n1w3f085y56). One rule decides it (companionLandingActivates).
  const activateTargets = useMemo(() => {
    const set = new Set<RegionId>();
    if (!g.view) return set;
    if (sepCompanion) {
      for (const r of (isCardSep ? cardSepTargets : declareTargets)) if (separationActivates(g.view, sepCompanion, r)) set.add(r);
    }
    if (charPick && g.you === 'fp' && charPick.char !== 'nazgul') {
      const group = charPick.group ?? [charPick.char];
      for (const r of charDestinations) if (companionLandingActivates(g.view, group, r)) set.add(r);
    }
    return set;
  }, [g.view, g.you, sepCompanion, isCardSep, cardSepTargets, declareTargets, charPick, charDestinations]);
  const destinations = useMemo(
    () => new Set<RegionId>([...boardArmyActs.filter((a) => a.from === selected).map((a) => a.to!), ...(trace ? trace.steps : cardMoveActs.filter((a) => a.from === selected).map((a) => a.to!)), ...charDestinations]),
    [boardArmyActs, cardMoveActs, trace, selected, charDestinations],
  );

  const clearMove = () => { setSelected(null); setCharPick(null); setCompPick(null); setMinionPick(null); setMoveMenu(null); setNazPick(null); setMusterMenu(null); setRoute([]); };

  // Begin moving whatever was chosen from a region: an army (select for the picker)
  // or a specific independent character (Nazgûl/Minion/Companion).
  const beginMove = useCallback((region: RegionId, opt: { kind: 'army' } | { kind: 'assault' } | { kind: 'muster' } | { kind: 'chargroup'; chars: string[] } | { kind: 'char'; char: string }
    | { kind: 'cardchar'; act: WotrAction; label: string } | { kind: 'cardgroup'; acts: WotrAction[] } | { kind: 'cardcomps'; chars: string[]; card: string }) => {
    setMoveMenu(null);
    // A card's Companion move: one Companion goes straight to the map, several open the
    // group picker — exactly as a Character die does.
    if (opt.kind === 'cardcomps') {
      setSelected(null);
      if (opt.chars.length === 1) setCharPick({ from: region, char: opt.chars[0]!, card: opt.card });
      else { setCharPick(null); setCompPick({ from: region, candidates: opt.chars, card: opt.card }); }
      return;
    }
    // A card's Companion pick: submitting it makes the destinations legal, and those
    // are already board clicks. A group is picked one at a time (the card allows any
    // number), so the submits run in order.
    if (opt.kind === 'cardchar') { clearMove(); void submit(opt.act); return; }
    if (opt.kind === 'cardgroup') { clearMove(); void (async () => { for (const a of opt.acts) if (await submit(a) === false) break; })(); return; }
    if (opt.kind === 'army') { setCharPick(null); setSelected(region); }
    else if (opt.kind === 'assault') { // storm the besieged Stronghold — by die, or by the card being played
      setCharPick(null); setSelected(null);
      const card = cardAssaultActs.find((a) => a.from === region);
      setMoveDraft(card ? { from: region, to: region, kind: 'eventAttack', base: card } : { from: region, to: region, kind: 'attack' });
    }
    else if (opt.kind === 'muster') { setCharPick(null); setSelected(null); setMusterMenu(region); } // pick the bundle for this Settlement
    else if (opt.kind === 'chargroup') {
      // Two or more Companions here: choose who travels together first (p.24 — a group
      // moves at its highest Level), then the destination on the map.
      setSelected(null); setCharPick(null); setCompPick({ from: region, candidates: opt.chars });
    }
    else { setSelected(null); setCharPick({ from: region, char: opt.char }); }
  }, [cardAssaultActs]); // the card assault on offer changes once the card is played

  const onRegionClick = useCallback((id: RegionId) => {
    setBlockMsg(null); setMoveMenu(null);
    // Card-driven separation destination: click a highlighted region to place the Companion.
    if (cardSepTargets.has(id)) {
      const here = cardSepActs.filter((x) => x.region === id);
      // A Nazgûl group offering several counts is a real choice — ask, exactly as the
      // Character-die path does, instead of quietly taking the first (= all of them).
      const counts = here.filter((x) => x.companion === 'nazgul' && typeof x.count === 'number');
      if (counts.length > 1) {
        const max = Math.max(...counts.map((x) => x.count!));
        clearMove(); setNazPick({ from: counts[0]!.from!, to: id, max, card: counts[0]!.card });
        return;
      }
      const a = here[0];
      if (a) { clearMove(); void submit(a); }
      return;
    }
    // A Minion entering play from his panel button: the click places him.
    if (minionPick) {
      const a = minionPickActs.find((x) => x.region === id);
      setMinionPick(null);
      if (a) { clearMove(); void submit(a); }
      return; // anywhere else cancels the pick
    }
    // A card's bare region pick: the click IS the answer.
    if (cardRegionTargets.has(id)) {
      const a = cardRegionActs.find((x) => x.region === id);
      if (a) { clearMove(); void submit(a); }
      return;
    }
    // Placing the Fellowship figure (declare, or move-on-reveal): click a highlighted region.
    if (declareTargets.has(id)) {
      const a = placeActs.find((x) => x.target === id) ?? gandalfActs.find((x) => x.region === id) ?? retreatActs.find((x) => x.region === id);
      if (a) { clearMove(); if (retreatActs.includes(a as never)) markRollSeen(); void submit(a); }
      return;
    }
    // Placing the revealed Ring-bearers, or landing a separating group: a region that is
    // not highlighted says why not, in the same terms as any other figure move (player
    // reports 64185k012e1r6d0n, 634k193f614n105n).
    if ((isReveal || isSeparateMove) && g.view) {
      const pc = g.view.pendingChoice!;
      let reason: string | null = null;
      if (isReveal) reason = revealMoveBlockReason(g.view, id);
      else {
        const d = pc.data as { from: RegionId; range: number };
        reason = separationBlockReason(g.view, d.from, id, d.range);
      }
      if (reason) setBlockMsg(reason);
      return;
    }
    // Picking a retreat destination: a region that is not highlighted says why not
    // (player report 6z172r5s4x731j62), instead of the click doing nothing.
    if (isRetreatPick) {
      const reason = g.view ? retreatBlockReason(g.view, id) : null;
      if (reason) setBlockMsg(reason);
      return;
    }
    // A character move is in progress: click a highlighted destination to move it there.
    if (charPick) {
      if (charDestinations.has(id)) {
        // A Nazgûl stack with more than one unmoved figure: let the player pick how many.
        if (charPick.char === 'nazgul' && g.view) {
          const avail = (g.view.regions[charPick.from]?.nazgul ?? 0) - (charMoved?.movedNazgul[charPick.from] ?? 0);
          if (avail > 1) { setNazPick({ from: charPick.from, to: id, max: avail }); setCharPick(null); return; }
        }
        if (charPick.card) {
          void submit({ kind: 'eventTarget', card: charPick.card, companion: charPick.char, from: charPick.from, region: id, ...(charPick.group ? { group: charPick.group } : {}) }); clearMove(); return;
        }
        void submit({ kind: 'moveCharacter', char: charPick.char, from: charPick.from, to: id, ...(charPick.group ? { chars: charPick.group } : {}) }); clearMove(); return;
      }
      if (id === charPick.from) { setCharPick(null); return; } // click the piece again to cancel
      // A card's Companion move: say why this region is refused, in the group's terms.
      if (charPick.card && g.view) {
        const reason = companionGroupBlockReason(g.view, 'fp', charPick.from, id, charPick.group ?? [charPick.char], CARD_COMPANION_MOVE_OPTS[charPick.card] ?? {});
        if (reason) setBlockMsg(reason);
        return;
      }
    }
    // An army move is in progress: click a highlighted destination (army-only set).
    // Tracing a card's route: each click takes ONE step. Clicking where we already
    // stand stops the journey there (if the card can end there), which is how the
    // player says "done" — the reporter's own suggestion.
    if (trace) {
      if (id === trace.head && trace.finish) { const act = trace.finish; const path = [...route];
        clearMove();
        if (act.mode === 'attack' && !isSplitCardAttack(act)) setMoveDraft({ from: act.from!, to: act.to!, kind: 'eventAttack', base: { ...act, path } });
        else setMoveDraft({ from: act.from!, to: act.to!, kind: 'eventMove', base: { ...act, path } });
        return; }
      if (trace.steps.has(id)) { setRoute((r) => [...r, id]); return; }
      if (id === selected && !route.length) { clearMove(); return; }   // click the army again to cancel
    }
    if (selected && destinations.has(id)) {
      const cardAct = cardMoveActs.find((a) => a.from === selected && a.to === id);
      if (cardAct) {
        setSelected(null);
        // A card ATTACK stays whole (the rearguard flow is the attack action's); a
        // card MOVE may split (p.28), so it takes the move picker — and so does a card
        // attack that LANDS first, where the player picks who goes (Corsairs of Umbar).
        if (cardAct.mode === 'attack' && !isSplitCardAttack(cardAct)) setMoveDraft({ from: cardAct.from!, to: cardAct.to!, kind: 'eventAttack', base: cardAct });
        else setMoveDraft({ from: cardAct.from!, to: cardAct.to!, kind: 'eventMove', base: cardAct });
        return;
      }
      const act = boardArmyActs.find((a) => a.from === selected && a.to === id);
      if (act) {
        setSelected(null);
        if (act.kind === 'moveArmy') setMoveDraft({ from: act.from, to: act.to, kind: 'moveArmy' });
        else if (act.kind === 'attack') setMoveDraft({ from: act.from, to: act.to, kind: 'attack' });
        else if (act.kind === 'armyMove2') setMoveDraft({ from: act.from!, to: act.to!, kind: 'armyMove2', base: act });
        else void submit(act);
      }
      return;
    }
    // Clicking a region that has something to do: move an army, assault, muster,
    // move character(s) — or several (menu).
    const armyHere = boardArmyActs.some((a) => a.from === id) || cardMoveActs.some((a) => a.from === id);
    // A siege ASSAULT (attack from===to) is board-clickable too (player report):
    // click the besieged region you occupy and choose "Assault".
    const assaultHere = assaultActs.some((a) => a.from === id) || cardAssaultActs.some((a) => a.from === id);
    const musterHere = musterTargets.has(id);
    const charsHere = (g.view && canMoveChars && charMoveOk && g.you) ? movableCharsAt(g.view, g.you as Side, id, charMoved) : [];
    // ≥2 movable Companions here: ONE "Move Companions" entry opens the group picker —
    // any subset travels together, a lone Companion being a group of one (player report
    // 3a1z26454w0x6c38). With just one, his own entry goes straight to the map.
    const compsHere = g.you === 'fp' ? charsHere.filter((c) => c !== 'nazgul') : [];
    const soloHere = compsHere.length >= 2 ? charsHere.filter((c) => !compsHere.includes(c)) : charsHere;
    // A card is asking WHICH Companions travel: offer each, and the group.
    const cardHere = cardCharPicks.filter((a) => a.from === id);
    const cardCompsHere = [...new Set(cardCompMoves.filter((a) => a.from === id).map((a) => a.companion!))];
    const opts: Array<{ kind: 'army' } | { kind: 'assault' } | { kind: 'muster' } | { kind: 'chargroup'; chars: string[] } | { kind: 'char'; char: string }
      | { kind: 'cardchar'; act: WotrAction; label: string } | { kind: 'cardgroup'; acts: WotrAction[] } | { kind: 'cardcomps'; chars: string[]; card: string }> = [
      // The Army comes first, ahead of any figures a card moves on their own (player
      // report 6u1k505o3m1k2i1r).
      ...(armyHere ? [{ kind: 'army' as const }] : []),
      ...cardHere.map((a) => ({ kind: 'cardchar' as const, act: a, label: a.companion === 'nazgul' ? 'The Nazgûl' : charName(a.companion!) })),
      // Only Companions travel as a group on a card; Nazgûl each fly on their own, so a
      // Nazgûl "group" pick left the second figure un-pickable (player report 2m6j6f1z5w07390y).
      ...(cardHere.length >= 2 && !cardHere.some((a) => a.companion === 'nazgul' || a.companion === 'witch-king') ? [{ kind: 'cardgroup' as const, acts: cardHere as WotrAction[] }] : []),
      ...(cardCompsHere.length ? [{ kind: 'cardcomps' as const, chars: cardCompsHere, card: cardCompMoves[0]!.card }] : []),
      ...(assaultHere ? [{ kind: 'assault' as const }] : []),
      ...(compsHere.length >= 2 ? [{ kind: 'chargroup' as const, chars: compsHere }] : []),
      ...soloHere.map((c) => ({ kind: 'char' as const, char: c })),
      // Muster goes LAST, below the figures — everything above it moves something, so
      // the list reads as one group of movers and then the odd one out (player report
      // 182f552y4v5r6f1n).
      ...(musterHere ? [{ kind: 'muster' as const }] : []),
    ];
    if (opts.length > 1) { clearMove(); setMoveMenu({ region: id, options: opts }); return; }
    if (opts.length === 1) {
      // Toggle off if re-clicking the already-active piece's region.
      if ((selected === id && opts[0]!.kind === 'army') || (charPick?.from === id)) { clearMove(); return; }
      beginMove(id, opts[0]!);
      return;
    }
    // Nothing on offer here. If we are inside the basic Move / Muster window, say why;
    // otherwise stay silent — see basicMoveWindow above (report 5f3q6k1f20650635).
    if (basicMoveWindow) {
      // A Character was picked and this is not one of its destinations: say why in
      // Character-move terms. It used to fall through to the MUSTER hint for the region
      // clicked (player report 5q0l1z724w6u2742 — "There is an enemy Army in Helm's
      // Deep" for a Companion barred from his own besieged Stronghold).
      if (charPick) {
        const reason = g.view && g.you ? characterMoveBlockReason(g.view, g.you as Side, charPick.char, charPick.from, id, charPick.group) : null;
        if (reason) setBlockMsg(reason);
      }
      // Adjacent-but-illegal (e.g. a refused merge): explain why instead of a silent no-op.
      else if (selected && id !== selected && g.view && REGIONS[selected]?.adjacency.includes(id)) {
        // An Army die's SECOND move and a card-granted move are moves only — they can
        // never turn into an attack, so the hint must not blame the Political Track
        // (player report 4g082f046g241z5i).
        const moveOnly = isArmyMove2 || (isCardMove && !cardMoveActs.some((a) => a.mode === 'attack'));
        const reason = moveBlockReason(g.view, selected, id, g.you as Side, { moveOnly });
        if (reason) setBlockMsg(reason);
      } else if (g.view && g.you && !musterTargets.has(id)
        // Only while a muster is the question: not with a die picked that cannot muster,
        // and not halfway through another Action (a second Army move, a Character move) —
        // a Muster hint there answers a question nobody asked (player reports
        // 3166044n3t3h3o6y, 213s201q0z15386w).
        && (!activeDie || activeDie === 'muster' || activeDie === 'armyMuster' || activeDie === 'will')
        && !isArmyMove2 && !isCharMove2) {
        // Clicked one of your own Settlements and it offered nothing at all: say why it
        // can't be mustered in (player report: "I can't muster in Lorien while it is
        // empty"). Every blocker — the Political Track, an enemy Control marker, an
        // empty reinforcement pool — is otherwise invisible or easy to misread.
        //
        // The FIRST thing to check is whether a muster is even affordable. Leading with
        // "Rohan is not At War, so it cannot muster" when the player holds no Muster die
        // implies that fixing the Political Track would have let the click through
        // (player report 512k2t582f1e2b3r). The die comes first, then the region rule.
        const def = REGIONS[id];
        const yours = !!def?.settlement && !!def.nation && sideOfNation(def.nation) === g.you;
        const reason = musterBlockReason(g.view, id, g.you as Side);
        const canMusterDie = (g.view.dice[g.you as Side] ?? []).some((f) => f === 'muster' || f === 'armyMuster' || f === 'will');
        // A Fortification (Fords of Isen, Osgiliath) is never a muster site, so it only
        // explains itself when a muster was actually on the table — without a Muster
        // die, clicking it says nothing about mustering at all (report 0l3g3q43552l6j1x).
        if (def?.settlement === 'Fortification') { if (canMusterDie && reason) setBlockMsg(reason); }
        else if (yours && !canMusterDie) {
          setBlockMsg(`You have no die left that can Muster — that takes a Muster, an Army/Muster or a Will of the West die (p.23).${reason ? ` (Even with one: ${reason})` : ''}`);
        } else if (reason) setBlockMsg(reason);
      }
    }
    clearMove();
  }, [selected, charPick, destinations, charDestinations, boardArmyActs, declareTargets, placeActs, cardSepTargets, cardSepActs, submit, beginMove, canMoveChars, charMoveOk, charMoved, g.view, g.you, g.legalActions, musterTargets, basicMoveWindow, assaultActs, isArmyMove2, isCardMove, cardMoveActs, cardCompMoves, isRetreatPick, cardRegionActs, cardRegionTargets, activeDie, isCharMove2, minionPick, minionPickActs, isReveal, isSeparateMove]);
  // Stable highlight object so a memoized Board ignores hover-only re-renders.
  // Where a Character or a Nazgûl may GO is always lit as a destination — a separation
  // and a card's Companion or Nazgûl move included — never in the green of "click here
  // to start something" (player report 395d3n1w3f085y56: separation and card moves
  // were green, the die's Character moves orange).
  const highlights = useMemo(() => {
    const charGoals = new Set<RegionId>([...cardSepTargets, ...(isSeparateMove ? declareTargets : []), ...cardRegionTargets, ...minionPickTargets]);
    return {
      sources: new Set([...sources].filter((r) => !charGoals.has(r))),
      selected: activeRegion,
      destinations: new Set([...destinations, ...charGoals]),
      activate: activateTargets,
    };
  }, [sources, activeRegion, destinations, activateTargets, cardSepTargets, isSeparateMove, declareTargets, cardRegionTargets, minionPickTargets]);
  // The Muster die's second figure is a pending choice too, so it must be listed here or
  // its lit Settlements ignore the click (player report 310b003u0c1j3220).
  const pickRegion = g.yourTurn && (!g.view?.pendingChoice || isReveal || isSeparateMove || isCardSep || isCardCharPick || cardCompMoves.length > 0 || cardRegionActs.length > 0 || isCardRecruit || isCardMove || cardAssaultActs.length > 0 || isPlaceGandalf || isRetreatPick || isCharMove2 || isArmyMove2 || secondMusterActs.length > 0) ? onRegionClick : undefined;

  if (!g.view) return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#ccc' }}>{g.error ? `Error: ${g.error.message}` : 'Loading…'}</div>;

  // A result of YOUR OWN (Hunt tile, battle outcome, roused Nation) still waiting to
  // be clicked through — the opponent recap holds until it is.
  const resultPending = huntResultPending(g.view, huntSeen) || battleResultPending(g.view, battleSeen) || noticePending(g.view, noticeSeen);

  // Army moves/attacks AND independent-character (Nazgûl/Minion/Companion) moves are done on
  // the board; combat/hunt decisions go to the modal. Keep them out of the button list.
  // Undo availability (re-read each render; reflects the local client's history).
  const undoCap = client.undo ? client.undoStatus?.() : undefined;
  const onUndoClick = () => {
    const s = client.undoStatus?.();
    if (!s?.canUndo) return;
    if (s.foreknowledge) setUndoConfirm(true); else void runUndo();
  };
  // Undo button lives inline in the status bar (to the right of the Elven Rings).
  const undoButton = undoCap ? (
    <button onClick={onUndoClick} disabled={!undoCap.canUndo}
      title={undoCap.reason ?? (undoCap.canUndo ? 'Undo your last action' : 'Nothing to undo')}
      style={{ padding: '3px 10px', fontSize: 12, fontWeight: 600, borderRadius: 10, whiteSpace: 'nowrap', cursor: undoCap.canUndo ? 'pointer' : 'default',
        background: undoCap.canUndo ? (undoCap.foreknowledge ? '#4a3a1a' : '#2c3a2c') : '#231f18',
        color: undoCap.canUndo ? (undoCap.foreknowledge ? '#ffe08a' : '#cfe6c0') : '#776',
        border: `1px solid ${undoCap.canUndo ? (undoCap.foreknowledge ? '#7a5f24' : '#3a5a3a') : '#3a342a'}` }}>
      ↶ Undo{undoCap.canUndo && undoCap.foreknowledge ? ' (reveals info)' : ''}
    </button>
  ) : null;
  // Status-bar trailing controls: Undo + Lobby. Kept in the bar's flow (not a fixed
  // overlay) so they never sit on top of / block the status pills.
  // Log / Report / Upload log sit here too, in the bar's flow: as floating buttons in the
  // bottom-right corner they covered the end of the game log (player report
  // 42341i4k121w0n3s).
  const barBtn: React.CSSProperties = { position: 'static', padding: '3px 10px', fontSize: 12, borderRadius: 10, whiteSpace: 'nowrap', boxShadow: 'none' };
  const statusTrailing = (
    <>
      {undoButton}
      <button onClick={() => setLogOpen(true)} title="Open the game log"
        style={{ ...barBtn, cursor: 'pointer', background: '#33302a', color: '#e9e1cc', border: '1px solid #5a4a2a' }}>📜 Log</button>
      <ReportButton report={client.report} clientBuild={typeof __DBF_BUILD_ID__ === 'string' ? __DBF_BUILD_ID__ : undefined} style={barBtn} />
      {g.view && <UploadLogButton view={g.view} you={g.you as Side | null} mode={{ mode: client.mode, aiSide: client.aiSide }} clientBuild={typeof __DBF_BUILD_ID__ === 'string' ? __DBF_BUILD_ID__ : undefined}
        uploaded={logsUploaded} onUploaded={() => setLogsUploaded(true)} style={barBtn} />}
      {g.gameOver && g.view && (
        <button onClick={() => setDiceStatsOpen(true)} title="Both players' dice over the game"
          style={{ ...barBtn, cursor: 'pointer', background: '#33302a', color: '#e9e1cc', border: '1px solid #5a4a2a' }}>📊 Dice</button>
      )}
      {onExit && (
        <button onClick={onExit} title="Leave to the lobby"
          style={{ padding: '3px 10px', fontSize: 12, borderRadius: 10, whiteSpace: 'nowrap', cursor: 'pointer', background: '#33302a', color: '#e9e1cc', border: '1px solid #5a4a2a' }}>
          ← Lobby
        </button>
      )}
    </>
  );

  const panelActionsAll = g.legalActions.filter((a) => panelShowsAction(a, g.legalActions, g.view!));
  // With a die selected, an Elven Ring offers only to change THAT die (player report
  // 4k5u2p3c37693s0l).
  const elvenActions = g.yourTurn
    ? g.legalActions.filter((a) => a.kind === 'useElvenRing' && (!activeDie || a.from === activeDie))
    : [];
  const panelActions = activeDie && g.you
    ? panelActionsAll.filter((a) => dieAllowsAction(a, g.view!, g.you as Side, activeDie))
    : panelActionsAll;
  // Threats and Promises (sh-str-05) bars the Free Peoples from advancing a PASSIVE
  // Nation with an Action die. The engine simply stops offering those actions, and a
  // list that silently loses "advance Rohan" reads as the game having forgotten that
  // diplomacy exists — so the barred advances are still listed, greyed, with the card
  // named on hover (player report 3k6l6x4l0t3t4q5q). Plain code, not a hook: this is
  // below the `if (!g.view) return` guard.
  const blockedPanel: { action: WotrAction; reason: string }[] = [];
  // Only on the plain action menu: mid-Action (a pending choice such as adding more
  // Companions to a separating group) the die advances aren't on offer anyway, so
  // greyed ones there are noise (player report 0m2j2c251s154y2h).
  if (g.yourTurn && g.you === 'fp' && g.view.phase === 'actionResolution' && !g.view.pendingChoice && threatsAndPromisesActive(g.view)) {
    for (const n of Object.keys(g.view.nations) as Nation[]) {
      const ns = g.view.nations[n];
      // Only a Nation the die COULD otherwise advance: ours, still passive, and not
      // already sitting on the step above "At War" that passive Nations may not pass.
      if (sideOfNation(n) !== 'fp' || ns.active || ns.step <= 1) continue;
      const action: WotrAction = { kind: 'diplomaticAction', nation: n };
      // Only while a die that could advance it is left — with no Muster or Will die
      // there is nothing the card is barring (report 2z4h2h0f6w732o4s).
      if (dieOptions(action, g.view, 'fp').length === 0) continue;
      if (activeDie && !dieAllowsAction(action, g.view, 'fp', activeDie)) continue;
      blockedPanel.push({ action, reason: 'Threats and Promises is in play — the Free Peoples cannot advance a passive Nation' });
    }
  }
  // The optional SECOND army move (Army die) is offered as panel buttons; route it
  // through the split picker too, so a second move can also be partial. NB: plain
  // function (NOT useCallback) — this is below the `if (!g.view) return` guard, so a
  // hook here would violate the Rules of Hooks (crashes the page on the first render).
  // End of Battle: open the picker so the winner can leave part of the Army behind
  // (p.31 "all or part"). Confirming without changing anything keeps everyone forward.
  // This choice arrives through the DECISION MODAL, so onDecisionAction below routes it
  // too — sending it straight to submit left "Keep the whole Army forward" as the only
  // button (player report).
  const onDecisionAction = (a: WotrAction) => {
    if (a.kind === 'advanceHoldBack' && g.view?.pendingChoice?.kind === 'advanceHoldBack') {
      const d = g.view.pendingChoice.data as { from: RegionId; to: RegionId };
      setMoveDraft({ from: d.to, to: d.from, kind: 'holdBack' }); return;
    }
    // End of Battle (p.31 "all or part", advance optional): the ADVANCE button opens
    // the picker choosing who marches in ("move all" is the one-click default);
    // "Hold position" submits directly and captures nothing.
    if (a.kind === 'advanceChoice' && a.advance && !a.move && g.view?.pendingChoice?.kind === 'advanceChoice') {
      const d = g.view.pendingChoice.data as { from: RegionId; to: RegionId };
      setMoveDraft({ from: d.from, to: d.to, kind: 'advance' }); return;
    }
    // Every advance is a move whose destination is already decided, so every advance
    // gets the same picker — laying siege and relieving one used to march everyone in
    // with no choice (player reports 4f0z2o2y1t2d3y6v, 405e1k232p3h3j4m).
    if (a.kind === 'relieveAdvance' && a.advance && !a.move && g.view?.pendingChoice?.kind === 'relieveAdvance') {
      const d = g.view.pendingChoice.data as { from: RegionId; to: RegionId };
      setMoveDraft({ from: d.from, to: d.to, kind: 'relieveAdvance' }); return;
    }
    if (a.kind === 'besiegerAdvance' && a.advance && !a.move && g.view?.pendingChoice?.kind === 'besiegerAdvance' && g.view.pendingCombat) {
      setMoveDraft({ from: g.view.pendingCombat.from, to: g.view.pendingCombat.to, kind: 'besiegerAdvance' }); return;
    }
    void submit(a);
  };
  const onPanelAction = (a: WotrAction) => {
    // One button per Minion: with several entry regions, ask for the region on the map.
    if (a.kind === 'bringMinion' && minionActs.filter((x) => x.minion === a.minion).length > 1) { clearMove(); setMinionPick(a.minion); return; }
    if (a.kind === 'advanceHoldBack' && g.view?.pendingChoice?.kind === 'advanceHoldBack') { onDecisionAction(a); return; }
    if ((a.kind === 'advanceChoice' || a.kind === 'relieveAdvance' || a.kind === 'besiegerAdvance') && g.view?.pendingChoice?.kind === a.kind) { onDecisionAction(a); return; }
    if (a.kind === 'armyMove2' && a.from && a.to && !a.done) { setMoveDraft({ from: a.from, to: a.to, kind: 'armyMove2', base: a }); return; }
    // A card-granted Army MOVE (Shadows Gather, The Shadow Lengthens, Corsairs…)
    // routes through the split picker — p.28 allows splitting the Army before a
    // card move (player report: "it did not ask if I wanted to move the ENTIRE
    // army"). Card ATTACKS stay whole (the rearguard flow is the attack action's).
    // A card ATTACK opens the attack picker, like any attack (player report 1o6s51234u6u4m30).
    if (a.kind === 'eventTarget' && a.from && a.to && !a.done && a.mode === 'attack' && !isSplitCardAttack(a)) {
      setMoveDraft({ from: a.from, to: a.to, kind: 'eventAttack', base: a }); return;
    }
    if (a.kind === 'eventTarget' && a.from && a.to && !a.done && (a.mode !== 'attack' || isSplitCardAttack(a))) {
      setMoveDraft({ from: a.from, to: a.to, kind: 'eventMove', base: a }); return;
    }
    void submit(a);
  };

  return (
    // height:100% (not 100vh) so the page fills whatever box its parent gives it --
    // online, that box is the viewport MINUS the sign-in bar above it (report 2t2n).
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0c0a07' }}>
      {busy && <BusyOverlay />}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Board column sized to the crop's width at full available height, so the
            board renders LARGE and fills it with no letterbox bars; the info panel
            (flex:1) takes the rest. 1.1464 = crop aspect (1511/1318); the ~16px is just
            padding — the status bar moved into the right column, so the board now spans
            the full viewport height (and widens to match, per its aspect). */}
        <div style={{ width: 'min(74vw, calc((100vh - 16px) * 1.1464))', flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 2 }}>
          {/* THE MAP'S BOX IS THE COLUMN'S ONLY FLOW CHILD. Every banner below is
              absolutely positioned inside it, because each one of them used to be a
              flow sibling that stole height from the board — so the map visibly shrank
              when a message appeared and grew back when it went away. Three separate
              follow-up reports came in after the first round of this fix still left
              banners in the flow: the bottom hint line shrinking the map when its text
              wrapped and re-growing it when the hint cleared (2a5x360h324z5z0s,
              4e636e723e532m5p) and the red error banner doing the same from the OUTER
              column (561d44030f1l3m6s). Nothing that appears and disappears may live in
              this column's flow — put it in the overlay stack instead. */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
            <Board view={g.view} onPickRegion={pickRegion} onHoverRegion={onHoverRegion} highlights={highlights} />
            <ResolvingCard view={g.view} onHoverCard={onHoverCard} />
            {/* The Ents Awake rider: one Character Event playable without a die. Surface
                it — a player couldn't tell why a card was suddenly playable ("I didn't
                have an [E] or [C] die left... so I did"). Pinned TOP so it can never
                collide with the message stack at the bottom. */}
            {g.you === 'fp' && g.view.flags?.fpFreeCharEventThisTurn && (
              <div style={{ position: 'absolute', left: 8, right: 8, top: 8, zIndex: 18, pointerEvents: 'none', color: '#bfe6bf', background: 'rgba(29,47,29,0.95)', border: '1px solid #3a5a3a', fontFamily: 'system-ui', fontSize: 13, padding: '5px 10px', borderRadius: 6, boxShadow: '0 4px 18px rgba(0,0,0,0.7)' }}>
                🌳 The Ents Awake: you may play ONE Character Event card without spending a die (your next Character-card play is free).
              </div>
            )}
            {/* Bottom message stack, most urgent first: the refused-action error, the
                refusal reason, then the ambient "what to click" hint. A COLUMN, so two
                of them showing at once stack instead of drawing on top of each other.
                The container is pointer-transparent and only the dismissable banners
                take clicks back — otherwise this strip would become a dead band along
                the bottom of the map where regions can't be clicked. */}
            <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, zIndex: 20, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {trace && (
                <div style={{ pointerEvents: 'auto', color: '#f0e9d8', background: 'rgba(35,52,31,0.96)', border: '1px solid #6ea84f', fontFamily: 'system-ui', fontSize: 13, padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span>
                    <b>Route:</b> {[selected as RegionId, ...route].map((r) => regionName(r)).join(' → ')}
                    {trace.left > 0 ? ` · ${trace.left} step${trace.left === 1 ? '' : 's'} left` : ' · no steps left'}
                  </span>
                  <span style={{ color: '#b9d6a3' }}>
                    {trace.steps.size > 0 ? 'Click a highlighted region to walk one step.' : 'Nowhere further to go.'}
                  </span>
                  {trace.finish && (
                    <button onClick={() => { const act = trace.finish!; const path = [...route]; clearMove();
                      if (act.mode === 'attack' && !isSplitCardAttack(act)) setMoveDraft({ from: act.from!, to: act.to!, kind: 'eventAttack', base: { ...act, path } });
                      else setMoveDraft({ from: act.from!, to: act.to!, kind: 'eventMove', base: { ...act, path } }); }}
                      style={{ padding: '3px 10px', fontSize: 12, lineHeight: '16px', fontWeight: 700, borderRadius: 6, cursor: 'pointer', background: '#2c6a3a', color: '#f0f7ee', border: '1px solid #6ea84f' }}>
                      {/* Fixed line height: the ✓ glyph is taller than the letters (report 35634l1x431r4a4a). */}
                      ✓ Stop here ({regionName(trace.head)})
                    </button>
                  )}
                  <button onClick={() => clearMove()}
                    style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 12, lineHeight: '16px', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: '#cb8', border: '1px solid #5a4a2a' }}>
                    cancel
                  </button>
                </div>
              )}
              {errorMsg && (
                <div onClick={() => setErrorSeen(errorMsg)} title="Click to dismiss"
                  style={{ pointerEvents: 'auto', cursor: 'pointer', color: '#fff', background: 'rgba(122,31,31,0.95)', border: '1px solid #a8413a', fontFamily: 'system-ui', fontSize: 13, padding: '5px 10px', borderRadius: 6, boxShadow: '0 4px 18px rgba(0,0,0,0.7)' }}>
                  ⚠ {errorMsg}
                </div>
              )}
              {blockMsg && (
                <div onClick={() => setBlockMsg(null)} title="Click to dismiss"
                  style={{ pointerEvents: 'auto', cursor: 'pointer', color: '#f0d090', background: 'rgba(58,42,18,0.95)', border: '1px solid #6a531f', fontFamily: 'system-ui', fontSize: 13, padding: '5px 10px', borderRadius: 6, boxShadow: '0 4px 18px rgba(0,0,0,0.7)' }}>
                  ⚠ {blockMsg}
                </div>
              )}
              {/* The idle "click a green region" line is gone (player reports
                  4k5e3n4x6o6y411g, 5u1y292b0s0o4n35): the side panel already says it,
                  and the banner sat over the Mordor track. Only the specific,
                  in-progress placements below still name themselves on the map. */}
              {sources.size > 0 && (isCardSep || isSeparateMove || isReveal || isRetreatPick || isPlaceGandalf || placeActs.length > 0 || !!charPick || !!selected || isArmyMove2) && (
                <div style={{ color: '#bfe6bf', background: 'rgba(18,26,18,0.92)', border: '1px solid #2f4a2f', fontFamily: 'system-ui', fontSize: 13, padding: '5px 10px', borderRadius: 6, boxShadow: '0 4px 18px rgba(0,0,0,0.7)' }}>
                  {isCardSep
                    ? (cardSepActs[0]!.companion === 'nazgul'
                      ? 'Moving the Nazgûl — click a highlighted region to fly them there.'
                      : `${charName(cardSepActs[0]!.companion!)} — click a highlighted region to place them there.${activateTargets.size ? ' A gold ★ region rouses that Nation to war.' : ''}`)
                    : isSeparateMove
                    ? `Separating Companions — click a highlighted region to place the group there (up to Progress + the highest Level in the group). You can first add more Companions to travel together using the buttons on the right.${activateTargets.size ? ' A gold ★ region rouses that Nation to war.' : ''}`
                    : isReveal
                    ? `Revealed! The Fellowship was caught — click a highlighted region to move the Ring-bearers there (up to ${g.view.fellowship.progress}; not into your own City/Stronghold). Passing through a Shadow Stronghold draws an extra Hunt tile.`
                    // Retreats and Gandalf's entry are board clicks too, and they share
                    // the highlight set with the Fellowship placement — so this banner
                    // told a retreating player to "Declare the Fellowship" (player report
                    // 0u36044v452i6p60). Each board-driven placement now names itself.
                    : isEaglesPick
                    ? 'The Eagles are Coming! — click a highlighted Sauron Stronghold to fly the surviving Nazgûl there.'
                    : isRetreatPick
                    ? `Retreating — click a highlighted region to fall back there. Only regions free of enemy troops and enemy Settlements can be retreated into.`
                    : isPlaceGandalf
                    ? 'Gandalf the White returns — click a highlighted region to place him there.'
                    : placeActs.length > 0
                      ? `Declare the Fellowship: click a highlighted region to place it there (within ${g.view.fellowship.progress} region${g.view.fellowship.progress === 1 ? '' : 's'} of its last-known spot). Or "End the Fellowship phase" on the right.`
                      : charPick ? `Moving ${charPick.char === 'nazgul' ? 'the Nazgûl' : (charPick.group ?? [charPick.char]).map(charName).join(', ')} — click a highlighted region to move there (or click the piece again to cancel).`
                        : selected ? `Selected ${regionName(selected)} — click a highlighted region to move/attack (or click again to cancel).`
                          : isArmyMove2 ? 'Second Army move — click a green Army to move it (a different Army), or “Done — no second Army move” on the right.'
                            : null}
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* The status bar lives at the top of the right column (may wrap to several
              rows). The Undo button rides along at its right end (after Elven Rings). */}
          <StatusBar view={g.view} you={g.you} onHoverChar={onHoverChar} onHoverCard={onHoverCard} trailing={statusTrailing} elvenActions={elvenActions} onAction={(a) => void submit(a)} />
          {/* Dice pool and Politics share one row when there's width; when the column
              is narrow they WRAP (Politics drops below the dice, each full-width) so the
              Politics reinforcement pips can't run off the right edge (report 6q0s). */}
          <div style={{ flexShrink: 0, maxHeight: '42%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: 0, overflowY: 'auto', borderBottom: '1px solid #2a2418' }}>
            {/* The OPPONENT's hand (card backs) and dice sit up here, above the actions;
                yours sit below them, over your hand — so the two pools are no longer
                lumped together (player report 0e4z5e1m4z4p3t32). */}
            <div style={{ flex: '1 1 200px', minWidth: 0, overflow: 'auto', background: '#1a160f' }}>
              <OpponentHand view={g.view} you={g.you as Side} />
              <DiceTray view={g.view} you={g.you as Side} only="opp" />
            </div>
            <div style={{ flex: '1 1 270px', minWidth: 0, overflow: 'auto', borderLeft: '1px solid #2a2418' }}>
              <PoliticsPanel view={g.view} />
              {/* Cards in play belong with the board state, not wedged against the
                  player's hand — they are not yours to play and they were crowding out
                  the cards that are (player report 572i6e714m1d2j3t). */}
              <TabledStrip view={g.view} onHoverCard={onHoverCard} />
            </div>
          </div>
          </div>
          {/* Lower area: action buttons + hand on the LEFT, the big enlarge/inspect
              area filling the RIGHT (it takes all the room that's left there). */}
          <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0, borderTop: '1px solid #2a2418' }}>
            <div style={{ flex: '0 0 44%', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Action buttons (compact — half height). */}
              <div style={{ flex: '1 1 auto', minHeight: 60, overflow: 'auto' }}>
                <ActionPanel actions={panelActions} onAction={onPanelAction} onHover={setHover} yourTurn={g.yourTurn} gameOver={g.gameOver} view={g.view} you={g.you as Side | null} boardHints={boardHints} blocked={blockedPanel} selectedDie={activeDie} />
              </div>
              {chatClient && g.you && (
                <ChatPanel client={chatClient} you={g.you} seatLabel={seatLabel} title="Table talk"
                  subscribe={client.subscribeMessages} style={{ borderTop: '1px solid #2a2418', maxHeight: '28vh' }} />
              )}
              {/* Your dice over your hand — sizes to its content. The die-payment prompt
                  floats just above your dice rather than sitting in the flow: inline, its
                  appearing pushed everything a few pixels (player report
                  24071c590o0o2c6i), and it was easy to miss — a click on the board
                  seemed to do nothing (5g050c2d2f49306y). It glows as it opens. */}
              <div style={{ position: 'relative', flexShrink: 0, borderTop: '1px solid #2a2418' }}>
              {/* `g.yourTurn` as well: online, the turn can pass to the opponent while
                  the prompt is open (a pendingChoice resolving, a timeout), and a
                  prompt for an action you can no longer take is worse than none. */}
              {diePick && g.yourTurn && g.view && g.you && (
                <div data-testid="die-pick-prompt" style={{ position: 'absolute', bottom: '100%', left: 6, right: 6, marginBottom: 4, zIndex: 20, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#3a2a12', border: '1px solid #c9a24a', borderRadius: 6, fontSize: 13, color: '#f0d090', boxShadow: '0 6px 20px #000c', animation: 'wotr-attn 0.45s ease-out 3' }}>
                  <span>Which die pays for “{describeAction(diePick, g.view)}”?</span>
                  {dieOptions(diePick, g.view, g.you as Side).map((f) => (
                    <button key={f} disabled={busy} onClick={() => { const a = { ...diePick, die: f } as WotrAction; setDiePick(null); void submit(a); }}
                      style={{ cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}><DieTag face={f} /></button>
                  ))}
                  <button onClick={() => setDiePick(null)} style={{ marginLeft: 'auto', background: 'none', border: '1px solid #6a531f', color: '#cb8', borderRadius: 4, padding: '1px 6px', cursor: 'pointer', fontSize: 11 }}>cancel</button>
                </div>
              )}
                <DiceTray view={g.view} you={g.you as Side} only="mine" selectedDie={activeDie} onSelectDie={g.yourTurn && !g.view.pendingChoice && !inActionDie ? setDie : undefined} inActionDie={inActionDie} />
                <HandStrip view={g.view} you={g.you as Side} onHoverCard={onHoverCard} playable={playableCards} onPlay={(a) => void submit(a)} busy={busy} />
              </div>
            </div>
            {/* The enlarge/inspect area — fills the whole right side of the lower area
                (enlarged cards & board territories). The Report / Log buttons float over it. */}
            <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #2a2418', minHeight: 0 }}>
              {/* Blank while the Log pop-up is open: otherwise a lingering hover
                  shows here, dimmed behind the pop-up backdrop, beside the pop-up's
                  own bright preview — the "doubled (and flickering) card" report.
                  With nothing hovered this space used to hold only a one-line hint, so
                  the game log lives here instead — visible without opening the pop-up
                  (player report: "I have to click Log to see what my opponent did").
                  NB: no onHoverCard here — a hover preview would replace the log under
                  the cursor and re-enter/leave in a loop (the old flicker report). The
                  pop-up keeps card-hover. */}
              {!logOpen && hover
                ? <HoverPreview hover={hover} view={g.view} bottom />
                : (
                  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: '#14110b' }}>
                    <div style={{ fontSize: 10, color: '#776', fontStyle: 'italic', padding: '4px 8px 0', flexShrink: 0 }}>
                      Hover a card, a region, or the Guide to inspect it here.
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                      <LogPanel view={g.view} times={logTimes} recentTurns={2} />
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>
      {moveDraft && (
        <div style={{ display: peekBoard ? 'none' : 'contents' }}>
          <MovePicker from={moveDraft.from} to={moveDraft.to} kind={moveDraft.kind} view={g.view} you={me} base={moveDraft.base}
            charOnly={(() => {
              // Only a Character die can pay — the one the player picked, or the only kind
              // left that the whole Army qualifies for. The goers must then include a
              // Leader or Character, and the picker says so before the click (player
              // report 5w5l396p391y5t30).
              if (moveDraft.kind !== 'moveArmy' && moveDraft.kind !== 'attack') return false;
              const faces = activeDie ? [activeDie] : dieOptions({ kind: moveDraft.kind, from: moveDraft.from as RegionId, to: moveDraft.to as RegionId }, g.view, me);
              return faces.length > 0 && faces.every((f) => f === 'character');
            })()}
            onConfirm={(a) => { setMoveDraft(null); void submit(a); }} onCancel={() => setMoveDraft(null)} />
        </div>
      )}
      {/* A region offered more than one thing to move (e.g. the army AND its Nazgûl). */}
      {musterMenu && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.55)', display: 'grid', placeItems: 'center', zIndex: 60 }}
          onClick={() => setMusterMenu(null)}>
          <div style={{ background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: 16, borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 280, boxShadow: '0 8px 40px #000' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>Muster in {REGIONS[musterMenu]?.name ?? musterMenu}</div>
            {[...recruitActs, ...cardRecruitActs, ...secondMusterActs].filter((a) => a.region === musterMenu).map((a, i) => (
              <button key={i} onClick={() => { setMusterMenu(null); void submit(a); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', margin: '4px 0', padding: '8px 12px', fontSize: 14, background: '#3a3326', color: '#f0e9d8', border: '1px solid #5a4a2a', borderRadius: 6, cursor: 'pointer' }}>
                {describeAction(a)}
              </button>
            ))}
            <button onClick={() => setMusterMenu(null)} style={{ marginTop: 6, padding: '5px 12px', fontSize: 13, background: 'transparent', color: '#a98', border: '1px solid #553', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {moveMenu && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.55)', display: 'grid', placeItems: 'center', zIndex: 60 }}
          onClick={() => setMoveMenu(null)}>
          <div style={{ background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: 16, borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 240, boxShadow: '0 8px 40px #000' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>What do you want to do here?</div>
            {moveMenu.options.map((o, i) => (
              <button key={i} onClick={() => beginMove(moveMenu.region, o)}
                style={{ display: 'block', width: '100%', textAlign: 'left', margin: '4px 0', padding: '8px 12px', fontSize: 14, background: '#3a3326', color: '#f0e9d8', border: '1px solid #5a4a2a', borderRadius: 6, cursor: 'pointer' }}>
                {o.kind === 'army' ? 'The Army'
                  : o.kind === 'assault' ? (sortieForce(g.view!, moveMenu!.region, me) ? '⚔ Sortie against the besiegers' : '⚔ Assault the besieged Stronghold')
                  // "Muster here" under a heading that already says "here" (player
                  // report 4j5g4c352b5u476e).
                  : o.kind === 'muster' ? '🛡 Muster'
                  // No "(by card)" / ", by card": while a card is resolving its moves
                  // are the only ones on offer (player report 2l4d2f146v333i3b).
                  : o.kind === 'cardchar' ? o.label
                  : o.kind === 'cardgroup' ? `All of them together (${o.acts.map((a) => charName((a as Extract<WotrAction, { kind: 'eventTarget' }>).companion!)).join(', ')})`
                  : o.kind === 'chargroup' || (o.kind === 'cardcomps' && o.chars.length > 1) ? `Move Companions… (${o.chars.map(charName).join(', ')})`
                  : o.kind === 'cardcomps' ? charName(o.chars[0]!)
                  : o.char === 'nazgul' ? 'The Nazgûl' : charName(o.char)}
              </button>
            ))}
            <button onClick={() => setMoveMenu(null)} style={{ marginTop: 6, padding: '5px 12px', fontSize: 13, background: 'transparent', color: '#a98', border: '1px solid #553', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {/* How many Nazgûl to move from a stack (RAW: move any number, not the whole group). */}
      {compPick && g.view && g.you && (
        <CompanionPicker from={compPick.from} candidates={compPick.candidates} view={g.view} you={g.you as Side}
          opts={compPick.card ? CARD_COMPANION_MOVE_OPTS[compPick.card] : undefined}
          onConfirm={(group) => {
            const { from, card } = compPick; setCompPick(null);
            const pick = group.length === 1 ? { from, char: group[0]! } : { from, char: companionGroupLeader(g.view!, from, group, card ? CARD_COMPANION_MOVE_OPTS[card] : {}), group };
            setCharPick(card ? { ...pick, card } : pick);
          }}
          onCancel={() => setCompPick(null)} />
      )}
      {nazPick && <NazgulCountPicker pick={nazPick}
        onConfirm={(count) => { const p = nazPick; clearMove(); void submit(p.card
          ? { kind: 'eventTarget', card: p.card, companion: 'nazgul', from: p.from, region: p.to, count }
          : { kind: 'moveCharacter', char: 'nazgul', from: p.from, to: p.to, count }); }}
        onCancel={() => setNazPick(null)} />}
      {undoConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 62 }} onClick={() => setUndoConfirm(false)}>
          <div style={{ background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 12, border: '1px solid #7a5f24', maxWidth: 440, boxShadow: '0 8px 40px #000' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#ffe08a', marginBottom: 8 }}>⚠ Foreknowledge undo</div>
            <p style={{ fontSize: 13, lineHeight: 1.45, margin: '0 0 10px' }}>
              This undo crosses a <b>dice roll or card draw</b>, so you’ll be re-deciding while already knowing a random outcome you wouldn’t normally have seen. It’s allowed, but it will be <b>recorded in the game log</b>.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setUndoConfirm(false)} style={{ padding: '6px 14px', fontSize: 13, background: 'transparent', color: '#cb9', border: '1px solid #5a4a2a', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => void runUndo()} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, background: '#4a3a1a', color: '#ffe08a', border: '1px solid #7a5f24', borderRadius: 6, cursor: 'pointer' }}>Undo anyway</button>
            </div>
          </div>
        </div>
      )}
      {/* Hidden while the split picker is open: the End of Battle hold-back choice
          OPENS the picker and leaves its own pendingChoice standing, so both modals
          were live at zIndex 50 — and this one, rendered later, painted OVER the
          picker. The player saw a second pop-up stranded behind the first and the
          game was unresolvable (player report). The picker is now the only thing
          on screen once it opens; cancelling it brings this back. */}
      {/* A retreat DESTINATION is answered on the map, so the modal steps aside for it
          (its backdrop would cover the very regions to click) — player report
          0f3003342g666741. The battle resumes its modal as soon as the click lands. */}
      <div style={{ display: (peekBoard || moveDraft || isRetreatPick) ? 'none' : 'contents' }}>
        {/* onDecisionAction, not submit: the End of Battle "keep figures back?" call is
            a decision-modal choice, and routing it straight to submit meant its only
            button was "Keep the whole Army forward" — the split picker was unreachable
            (player report: "the only option presented was keep the whole army forward").
            Every other decision falls through to submit unchanged. */}
        <DecisionModal view={g.view} you={g.you as Side} actions={g.legalActions} onAction={(a) => { markRollSeen(); return onDecisionAction(a); }} yourTurn={g.yourTurn}
          context={rollContext}
          undo={undoCap?.canUndo ? { foreknowledge: !!undoCap.foreknowledge, onUndo: onUndoClick } : undefined} />
      </div>
      {/* Floating "Peek board" toggle (top-left) — shown whenever a blocking choice
          modal (move picker / combat-hunt decision) covers the board; lives outside
          the hidden wrappers so it stays clickable while peeking. */}
      {/* Not during a retreat pick: that prompt already stepped the modal aside, so the
          board is fully visible and the toggle did nothing at all when clicked (player
          report 313y6r5o19701p42). */}
      {!isRetreatPick && peekable && (
        <button onClick={() => setPeekBoard((p) => !p)}
          title="Temporarily hide this prompt to study the board, then click again to go back and choose"
          style={{ position: 'fixed', top: 10, left: 10, zIndex: 90, padding: '6px 12px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer', boxShadow: '0 4px 16px #000a',
            background: peekBoard ? '#caa84b' : '#2a2418', color: peekBoard ? '#1a1408' : '#f0e9d8', border: `2px solid ${peekBoard ? '#e6c869' : '#5a4a2a'}` }}>
          {peekBoard ? '↩ Back to choice' : '👁 Peek board'}
        </button>
      )}
      {minionPick && (
        <div style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 92, padding: '8px 16px', fontSize: 14, fontWeight: 600,
          borderRadius: 8, background: '#3a2a12', color: '#f0d090', border: '1px solid #6a531f', boxShadow: '0 4px 20px #000' }}>
          ⚑ Bring {charName(minionPick)} into play — click a highlighted region (anywhere else cancels).
        </div>
      )}
      {isRetreatPick && (
        <div style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 92, padding: '8px 16px', fontSize: 14, fontWeight: 600,
          borderRadius: 8, background: '#3a2a12', color: '#f0d090', border: '1px solid #6a531f', boxShadow: '0 4px 20px #000' }}>
          {isEaglesPick ? '⚑ The Eagles are Coming! — click a highlighted Sauron Stronghold to fly the surviving Nazgûl there.' : '⚑ Retreat — click a highlighted region to fall back there.'}
          {rollContext.map((n) => <div key={n.seq} style={{ fontSize: 12, fontWeight: 400, marginTop: 4, color: '#e8dcc0' }}>{n.title ? `${n.title}: ` : ''}{n.msg}</div>)}
        </div>
      )}
      <HuntPopup view={g.view} seen={huntSeen} onSeen={setHuntSeen} />
      {/* In hotseat the seat changes hands every turn, so "you" names nobody in
          particular — the result is shown neutral there. */}
      <BattlePopup view={g.view} seen={battleSeen} onSeen={setBattleSeen} you={(client as { mode?: string }).mode === 'hotseat' ? null : (g.you as Side | null)} />
      <NoticePopup view={g.view} seen={noticeSeen} onSeen={setNoticeSeen} />
      <TurnSummary view={g.view} yourTurn={g.yourTurn} you={g.you as Side | null} onOpenLog={() => setLogOpen(true)} hold={resultPending} />
      {g.gameOver && g.ranked && (
        <p style={{ margin: '8px 12px', fontSize: 14, color: g.ranked.recorded ? '#6c6' : '#caa' }}>
          {g.ranked.recorded
            ? '✓ Recorded to the leaderboard.'
            : g.ranked.reason === 'one-player'
              ? 'Not ranked — both seats were the same player (you need two different people/identities).'
              : g.ranked.reason === 'no-identities'
                ? 'Not ranked — no identities were attached to the seats.'
                : "Not ranked — couldn't reach the leaderboard."}
        </p>
      )}
      {diceStatsOpen && g.view && (
        <div onClick={() => setDiceStatsOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.62)', display: 'grid', placeItems: 'center', zIndex: 81 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#1c1710', fontFamily: 'system-ui', padding: '16px 22px', borderRadius: 12, border: '1px solid #5a4a2a', maxWidth: 'min(520px, 94vw)', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 8px 40px #000' }}>
            <div style={{ fontSize: 14, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1 }}>Dice statistics</div>
            <DiceStats view={g.view} />
            <button onClick={() => setDiceStatsOpen(false)} style={{ marginTop: 12, padding: '6px 18px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', display: 'block', marginLeft: 'auto' }}>Close</button>
          </div>
        </div>
      )}
      <GameOverUpload view={g.view} you={g.you as Side | null} gameOver={g.gameOver} mode={{ mode: client.mode, aiSide: client.aiSide }} clientBuild={typeof __DBF_BUILD_ID__ === 'string' ? __DBF_BUILD_ID__ : undefined}
        uploaded={logsUploaded} onUploaded={() => setLogsUploaded(true)} />
      {responseQueue.length > 0 && (
        <ReportResponseModal notice={responseQueue[0]!}
          onDismiss={() => { markResponseSeen(responseQueue[0]!.reportId); setResponseQueue((q) => q.slice(1)); }} />
      )}
      {logOpen && (
        <div onClick={() => { setLogOpen(false); setLogHover(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.7)', display: 'grid', placeItems: 'center', zIndex: 71 }}>
          {/* Hovered card renders in a bright side box INSIDE the overlay — it used to
              land in the right-hand panel UNDER the dark backdrop, unreadably dim
              (player report: "grayed-out … difficult to read"). */}
          {/* The log box is centred on its OWN width; the hover-preview is absolutely
              positioned to its right so it never changes the row's width. Previously
              the preview box was in normal flow, so it appearing re-centred the row and
              slid the hovered log line out from under the cursor — mouseleave/enter
              looping = the "doubled, flickering" report. */}
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 520, maxWidth: '92vw' }}>
            <div style={{ background: '#1c1710', color: '#eee', fontFamily: 'system-ui', borderRadius: 12, border: '1px solid #5a4a2a', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px #000' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '6px 10px', borderBottom: '1px solid #2a2418' }}>
                <CopyLogButton view={g.view} style={{ background: 'none', border: '1px solid #5a4a2a', color: '#cb9', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }} />
                <button onClick={() => { setLogOpen(false); setLogHover(null); }} style={{ background: 'none', border: '1px solid #5a4a2a', color: '#cb9', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>Close</button>
              </div>
              <div style={{ height: '60vh', overflowY: 'auto' }}>
                <LogPanel view={g.view} times={logTimes} onHoverCard={(id) => setLogHover(id ? { kind: 'card', id } : null)} />
              </div>
            </div>
            {logHover?.kind === 'card' && (
              <div style={{ position: 'absolute', left: '100%', top: 0, marginLeft: 12, width: 320, maxHeight: '70vh', overflow: 'hidden', background: '#1c1710', borderRadius: 12, border: '1px solid #5a4a2a', boxShadow: '0 8px 40px #000', pointerEvents: 'none' }}>
                <HoverPreview hover={logHover} view={g.view} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Pick how many Nazgûl move from a stack (RAW: a Character die may move any number,
// not the whole group). Defaults to all; one tap on −/+ adjusts.
function NazgulCountPicker({ pick, onConfirm, onCancel }: {
  pick: { from: RegionId; to: RegionId; max: number }; onConfirm: (count: number) => void; onCancel: () => void;
}) {
  const [n, setN] = useState(pick.max);
  const fromName = REGIONS[pick.from]?.name ?? pick.from, toName = REGIONS[pick.to]?.name ?? pick.to;
  const btn: React.CSSProperties = { width: 34, height: 34, fontSize: 18, background: '#3a3326', color: '#f0e9d8', border: '1px solid #5a4a2a', borderRadius: 6, cursor: 'pointer' };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.55)', display: 'grid', placeItems: 'center', zIndex: 60 }} onClick={onCancel}>
      <div style={{ background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: 18, borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 260, boxShadow: '0 8px 40px #000' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 12, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 4 }}>Move Nazgûl</div>
        <div style={{ fontSize: 13, color: '#cbbf9a', marginBottom: 12 }}>{fromName} → {toName}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 14 }}>
          <button style={btn} disabled={n <= 1} onClick={() => setN((v) => Math.max(1, v - 1))}>−</button>
          <span style={{ fontSize: 24, fontWeight: 700, minWidth: 48, textAlign: 'center' }}>{n} / {pick.max}</span>
          <button style={btn} disabled={n >= pick.max} onClick={() => setN((v) => Math.min(pick.max, v + 1))}>+</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onConfirm(n)} style={{ flex: 1, padding: '8px 12px', fontSize: 14, fontWeight: 700, background: '#4a5a3a', color: '#f0e9d8', border: '1px solid #6a7', borderRadius: 6, cursor: 'pointer' }}>Move {n}</button>
          <button onClick={onCancel} style={{ padding: '8px 12px', fontSize: 13, background: 'transparent', color: '#a98', border: '1px solid #553', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// "Working…" indicator for the window between clicking an action and the board coming
// back — the network round trip online, or the AI taking its whole turn. It sits over
// the top of the screen and swallows clicks, so a second click can't queue up behind
// the first (which `inFlight` already drops silently, with nothing on screen to explain
// why). No dimming at all: against the AI it shows after every action, and even a
// faint tint read as a dark flash each time (player report 6p2l0q6p73354o5c).
function BusyOverlay() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, cursor: 'progress', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'transparent' }}>
      <style>{'@keyframes wotr-spin{to{transform:rotate(360deg)}}@keyframes wotr-attn{0%{box-shadow:0 0 0 0 #ffd36a,0 6px 20px #000c}100%{box-shadow:0 0 0 10px #ffd36a00,0 6px 20px #000c}}'}</style>
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, background: '#1c1710e6', color: '#e9e1cc', fontFamily: 'system-ui', fontSize: 13, padding: '8px 14px', borderRadius: 20, border: '1px solid #5a4a2a', boxShadow: '0 4px 18px #000a' }}>
        <span style={{ width: 15, height: 15, borderRadius: '50%', border: '2px solid #5a4a2a', borderTopColor: '#e6b85a', animation: 'wotr-spin 0.8s linear infinite', display: 'inline-block' }} />
        Resolving your move…
      </div>
    </div>
  );
}
