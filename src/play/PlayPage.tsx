// Top-level play screen: drives the game through the framework useGame hook over
// a GameClientApi (local hotseat or online HTTP). Renders the redacted view; it
// never owns rules and never drives the opponent.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useGame, ChatPanel } from 'digital-boardgame-framework/client';
import type { GameClientApi } from '../online/gameClient';
import type { GameState, RegionId, Side, DieFace } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { Board } from './Board';
import { ActionPanel } from './ActionPanel';
import { StatusBar } from './StatusBar';
import { HandStrip } from './HandStrip';
import { PoliticsPanel } from './PoliticsPanel';
import { DecisionModal } from './DecisionModal';
import { MovePicker } from './MovePicker';
import { DiceTray } from './DiceTray';
import { HuntPopup } from './HuntPopup';
import { TurnSummary } from './TurnSummary';
import { LogPanel } from './LogPanel';
import { GameOverUpload } from './GameOverUpload';
import { ReportButton } from './ReportButton';
import { HoverPreview, type Hover } from './HoverPreview';
import { isDecisionAction, dieOptions } from './actionText';
import { moveBlockReason } from '../engine/armies';
import { movableCharsAt, characterDestinations } from '../engine/charMove';
import { REGIONS } from '../engine/data';
import { charName } from './charInfo';

const seatLabel = (s: string) => (s === 'fp' ? 'Free Peoples' : s === 'shadow' ? 'Shadow' : s);

type SpatialAction = Extract<WotrAction, { kind: 'moveArmy' | 'attack' }>;
const isSpatial = (a: WotrAction): a is SpatialAction => a.kind === 'moveArmy' || a.kind === 'attack';

// Die-first filter: when the player has picked a specific die to spend, an action is
// shown only if that die can pay for it. Free/phase actions (dieOptions empty — Pass,
// Elven Ring, Hunt/Fellowship-phase steps) are always shown.
const dieAllowsAction = (a: WotrAction, view: GameState, you: Side, die: DieFace): boolean => {
  const opts = dieOptions(a, view, you);
  return opts.length === 0 || opts.includes(die);
};

export function PlayPage({ client, onExit }: { client: GameClientApi; onExit?: () => void }) {
  // Realtime move push when available (online); polling fallback otherwise.
  const g = useGame<GameState, WotrAction>(client as any, { subscribe: client.subscribeMoves });
  // Die-first turn flow (Ira #8): pick one of your dice → only that die's actions show
  // (in the panel AND on the board). null = no filter (every legal action visible).
  const [die, setDie] = useState<DieFace | null>(null);
  const me: Side = g.you === 'shadow' ? 'shadow' : 'fp';
  // Drop a stale selection (die spent / new round) so we never filter to a die you no longer have.
  const activeDie = die && (g.view?.dice[me] ?? []).includes(die) ? die : null;
  const charDieOk = !activeDie || activeDie === 'character' || activeDie === 'will';
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [moveDraft, setMoveDraft] = useState<{ from: string; to: string; kind: 'moveArmy' | 'attack' } | null>(null);
  // Board-driven independent-character (Nazgûl / Minion / Companion) move in progress.
  const [charPick, setCharPick] = useState<{ from: RegionId; char: string } | null>(null);
  // When a clicked region offers more than one thing to move (e.g. the army AND its
  // Nazgûl), let the player choose which.
  const [moveMenu, setMoveMenu] = useState<{ region: RegionId; options: Array<{ kind: 'army'; char?: undefined } | { kind: 'char'; char: string }> } | null>(null);
  // Why the last attempted move/merge was refused (shown so it isn't a silent no-op).
  const [blockMsg, setBlockMsg] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const onHoverRegion = useCallback((id: RegionId | null) => setHover(id ? { kind: 'region', id } : null), []);
  const onHoverCard = useCallback((id: string | null) => setHover(id ? { kind: 'card', id } : null), []);
  const onHoverChar = useCallback((id: string | null) => setHover(id ? { kind: 'character', id } : null), []);

  // Guard against a rapid double-click submitting a now-stale action (e.g. clicking
  // a combat decision twice before the re-render): drop submits while one is in flight.
  const inFlight = useRef(false);
  const submit = useCallback(async (a: WotrAction) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await g.submit(a); setDie(null); } finally { inFlight.current = false; }
  }, [g]);

  // Undo (local hotseat / vs-AI only — the online client has no undo()). A
  // foreknowledge undo (one that crosses a dice roll / card draw) is blocked outright
  // in 2-player and requires an explicit confirm vs the AI.
  const [undoConfirm, setUndoConfirm] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const runUndo = useCallback(async () => {
    setUndoConfirm(false);
    if (inFlight.current) return;
    inFlight.current = true;
    try { await client.undo?.(); await g.refresh(); setSelected(null); setCharPick(null); setMoveMenu(null); setMoveDraft(null); setBlockMsg(null); setDie(null); }
    finally { inFlight.current = false; }
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
    const acts = g.legalActions.filter(isSpatial);
    return activeDie && g.view && g.you ? acts.filter((a) => dieAllowsAction(a, g.view!, g.you as Side, activeDie)) : acts;
  }, [g.legalActions, activeDie, g.view, g.you]);
  // Board-click placement of the Fellowship figure: declaring it (Fellowship phase) or
  // choosing where it moves when revealed by the Hunt (revealMove choice).
  const placeActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'declareFellowship' | 'revealMove' | 'separateMove' }> => a.kind === 'declareFellowship' || a.kind === 'revealMove' || a.kind === 'separateMove'), [g.legalActions]);
  const declareTargets = useMemo(() => new Set(placeActs.map((a) => a.target)), [placeActs]);
  const isReveal = g.view?.pendingChoice?.kind === 'revealMove';
  const isSeparateMove = g.view?.pendingChoice?.kind === 'separateMove';
  // Independent characters (Nazgûl/Minion/Companion) are board-movable when a
  // Character (or Will) die is available — detected by any moveCharacter being legal.
  const canMoveChars = useMemo(() => g.legalActions.some((a) => a.kind === 'moveCharacter'), [g.legalActions]);
  const charSources = useMemo(() => {
    const s = new Set<RegionId>();
    if (g.view && canMoveChars && charDieOk && g.you) for (const id of Object.keys(g.view.regions)) {
      if (movableCharsAt(g.view, g.you as Side, id).length) s.add(id);
    }
    return s;
  }, [g.view, canMoveChars, charDieOk, g.you]);
  const sources = useMemo(() => new Set<RegionId>([...armyActs.map((a) => a.from), ...declareTargets, ...charSources]), [armyActs, declareTargets, charSources]);
  // The region currently "selected" for highlighting (an army source, a char source, or a menu region).
  const activeRegion = selected ?? charPick?.from ?? moveMenu?.region ?? null;
  const charDestinations = useMemo(
    () => (g.view && charPick && g.you ? new Set(characterDestinations(g.view, g.you as Side, charPick.char, charPick.from)) : new Set<RegionId>()),
    [g.view, charPick, g.you],
  );
  const destinations = useMemo(
    () => new Set<RegionId>([...armyActs.filter((a) => a.from === selected).map((a) => a.to), ...charDestinations]),
    [armyActs, selected, charDestinations],
  );

  const clearMove = () => { setSelected(null); setCharPick(null); setMoveMenu(null); };

  // Begin moving whatever was chosen from a region: an army (select for the picker)
  // or a specific independent character (Nazgûl/Minion/Companion).
  const beginMove = useCallback((region: RegionId, opt: { kind: 'army' } | { kind: 'char'; char: string }) => {
    setMoveMenu(null);
    if (opt.kind === 'army') { setCharPick(null); setSelected(region); }
    else { setSelected(null); setCharPick({ from: region, char: opt.char }); }
  }, []);

  const onRegionClick = useCallback((id: RegionId) => {
    setBlockMsg(null); setMoveMenu(null);
    // Placing the Fellowship figure (declare, or move-on-reveal): click a highlighted region.
    if (declareTargets.has(id)) {
      const a = placeActs.find((x) => x.target === id);
      if (a) { clearMove(); void submit(a); }
      return;
    }
    // A character move is in progress: click a highlighted destination to move it there.
    if (charPick) {
      if (charDestinations.has(id)) { void submit({ kind: 'moveCharacter', char: charPick.char, from: charPick.from, to: id }); clearMove(); return; }
      if (id === charPick.from) { setCharPick(null); return; } // click the piece again to cancel
    }
    // An army move is in progress: click a highlighted destination (army-only set).
    if (selected && destinations.has(id)) {
      const act = armyActs.find((a) => a.from === selected && a.to === id);
      if (act) {
        setSelected(null);
        if (act.kind === 'moveArmy') setMoveDraft({ from: act.from, to: act.to, kind: 'moveArmy' });
        else if (act.kind === 'attack') setMoveDraft({ from: act.from, to: act.to, kind: 'attack' });
        else void submit(act);
      }
      return;
    }
    // Clicking a region that has something to move: army, character(s), or both.
    const armyHere = armyActs.some((a) => a.from === id);
    const charsHere = (g.view && canMoveChars && charDieOk && g.you) ? movableCharsAt(g.view, g.you as Side, id) : [];
    const opts: Array<{ kind: 'army' } | { kind: 'char'; char: string }> = [
      ...(armyHere ? [{ kind: 'army' as const }] : []),
      ...charsHere.map((c) => ({ kind: 'char' as const, char: c })),
    ];
    if (opts.length > 1) { clearMove(); setMoveMenu({ region: id, options: opts }); return; }
    if (opts.length === 1) {
      // Toggle off if re-clicking the already-active piece's region.
      if ((selected === id && opts[0]!.kind === 'army') || (charPick?.from === id)) { clearMove(); return; }
      beginMove(id, opts[0]!);
      return;
    }
    // Adjacent-but-illegal (e.g. a refused merge): explain why instead of a silent no-op.
    if (selected && id !== selected && g.view && REGIONS[selected]?.adjacency.includes(id)) {
      const reason = moveBlockReason(g.view, selected, id, g.you as Side);
      if (reason) setBlockMsg(reason);
    }
    clearMove();
  }, [selected, charPick, destinations, charDestinations, armyActs, declareTargets, placeActs, submit, beginMove, canMoveChars, charDieOk, g.view, g.you]);
  // Stable highlight object so a memoized Board ignores hover-only re-renders.
  const highlights = useMemo(() => ({ sources, selected: activeRegion, destinations }), [sources, activeRegion, destinations]);
  const pickRegion = g.yourTurn && (!g.view?.pendingChoice || isReveal || isSeparateMove) ? onRegionClick : undefined;

  if (!g.view) return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#ccc' }}>{g.error ? `Error: ${g.error.message}` : 'Loading…'}</div>;

  // Army moves/attacks AND independent-character (Nazgûl/Companion) moves are done on
  // the board; combat/hunt decisions go to the modal. Keep them out of the button list.
  // Undo availability (re-read each render; reflects the local client's history).
  const undoCap = client.undo ? client.undoStatus?.() : undefined;
  const onUndoClick = () => {
    const s = client.undoStatus?.();
    if (!s?.canUndo) return;
    if (s.foreknowledge) setUndoConfirm(true); else void runUndo();
  };

  const panelActionsAll = g.legalActions.filter((a) => !isSpatial(a) && !isDecisionAction(a) && a.kind !== 'moveCharacter' && a.kind !== 'separateMove');
  const panelActions = activeDie && g.you
    ? panelActionsAll.filter((a) => dieAllowsAction(a, g.view!, g.you as Side, activeDie))
    : panelActionsAll;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0c0a07' }}>
      {g.error && <div style={{ background: '#7a1f1f', color: '#fff', padding: 6, fontFamily: 'system-ui', fontSize: 13 }}>⚠ {g.error.message}</div>}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Board column sized to the crop's width at full available height, so the
            board renders LARGE and fills it with no letterbox bars; the info panel
            (flex:1) takes the rest. 1.1464 = crop aspect (1511/1318); the ~16px is just
            padding — the status bar moved into the right column, so the board now spans
            the full viewport height (and widens to match, per its aspect). */}
        <div style={{ width: 'min(74vw, calc((100vh - 16px) * 1.1464))', flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 2 }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <Board view={g.view} onPickRegion={pickRegion} onHoverRegion={onHoverRegion} highlights={highlights} />
          </div>
          {blockMsg && (
            <div onClick={() => setBlockMsg(null)} title="Click to dismiss"
              style={{ color: '#f0d090', background: '#3a2a12', border: '1px solid #6a531f', fontFamily: 'system-ui', fontSize: 13, padding: '5px 10px', margin: '2px 8px', borderRadius: 6, flexShrink: 0, cursor: 'pointer' }}>
              ⚠ {blockMsg}
            </div>
          )}
          {sources.size > 0 && (
            <div style={{ color: '#9c9', fontFamily: 'system-ui', fontSize: 13, padding: '4px 8px', flexShrink: 0 }}>
              {isSeparateMove
                ? 'Separating a Companion — click a highlighted region to place it there (up to Progress + the Companion’s Level away). Landing in a friendly City/Stronghold of a Nation it rouses brings that Nation toward War.'
                : isReveal
                ? `Revealed! The Fellowship was caught — click a highlighted region to move the Ring-bearers there (up to ${g.view.fellowship.progress}; not into your own City/Stronghold). Passing through a Shadow Stronghold draws an extra Hunt tile.`
                : declareTargets.size > 0
                  ? `Declare the Fellowship: click a highlighted region to place it there (within ${g.view.fellowship.progress} region${g.view.fellowship.progress === 1 ? '' : 's'} of its last-known spot). Or "Skip the Fellowship phase" on the right.`
                  : charPick ? `Moving ${charPick.char === 'nazgul' ? 'the Nazgûl' : charName(charPick.char)} — click a highlighted region to move there (or click the piece again to cancel).`
                    : selected ? `Selected ${selected} — click a highlighted region to move/attack (or click again to cancel).`
                      : 'Click a highlighted (green) region to move an army or an independent character (Nazgûl, Companion).'}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* The status bar lives at the top of the right column (may wrap to several rows). */}
          <StatusBar view={g.view} you={g.you} onHoverChar={onHoverChar} />
          {undoCap && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: '#1a160f', borderBottom: '1px solid #2a2418', flexShrink: 0 }}>
              <button onClick={onUndoClick} disabled={!undoCap.canUndo}
                title={undoCap.reason ?? (undoCap.canUndo ? 'Undo your last action' : 'Nothing to undo')}
                style={{ padding: '4px 12px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: undoCap.canUndo ? 'pointer' : 'not-allowed',
                  background: undoCap.canUndo ? (undoCap.foreknowledge ? '#4a3a1a' : '#2c3a2c') : '#231f18',
                  color: undoCap.canUndo ? (undoCap.foreknowledge ? '#ffe08a' : '#cfe6c0') : '#776',
                  border: `1px solid ${undoCap.canUndo ? (undoCap.foreknowledge ? '#7a5f24' : '#3a5a3a') : '#3a342a'}` }}>
                ↶ Undo{undoCap.canUndo && undoCap.foreknowledge ? ' (reveals info)' : ''}
              </button>
              {undoCap.foreknowledge && !undoCap.canUndo && (
                <span style={{ fontSize: 11, color: '#a98' }}>Can’t undo past a roll/draw in a 2-player game.</span>
              )}
            </div>
          )}
          {/* Dice pool and Politics share one row at the top of the column. */}
          <div style={{ display: 'flex', flexShrink: 0, maxHeight: '32%', borderBottom: '1px solid #2a2418' }}>
            <div style={{ flexShrink: 0, overflow: 'auto' }}>
              <DiceTray view={g.view} you={g.you as Side} selectedDie={activeDie} onSelectDie={g.yourTurn ? setDie : undefined} />
            </div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'auto', borderLeft: '1px solid #2a2418' }}>
              <PoliticsPanel view={g.view} />
            </div>
          </div>
          {/* Action buttons — flex, so they yield space to the fixed inspector below
              (and scroll when the list is long) rather than squeezing it. */}
          <div style={{ flex: '1 1 auto', minHeight: 80, overflow: 'auto' }}>
            <ActionPanel actions={panelActions} onAction={submit} onHover={setHover} yourTurn={g.yourTurn} gameOver={g.gameOver} view={g.view} you={g.you as Side | null} boardActions={armyActs.length} selectedDie={activeDie} onClearDie={activeDie ? () => setDie(null) : undefined} />
          </div>
          {/* The game log moved to a pop-up (opened from the floating Log button). */}
          {chatClient && g.you && (
            <ChatPanel client={chatClient} you={g.you} seatLabel={seatLabel} title="Table talk"
              subscribe={client.subscribeMessages} style={{ borderTop: '1px solid #2a2418', maxHeight: '34vh' }} />
          )}
          {/* Hand + in-play (played) cards, full-width, in their own row above the inspector. */}
          <div style={{ flexShrink: 0, height: 116, borderTop: '1px solid #2a2418' }}>
            <HandStrip view={g.view} you={g.you as Side} onHoverCard={onHoverCard} />
          </div>
          {/* Large, FIXED-size inspector in the lower-right corner: enlarged cards &
              board territories. flexShrink:0 + a set height so the action buttons and
              hand above never resize it. */}
          <div style={{ flexShrink: 0, height: 300, borderTop: '1px solid #2a2418' }}>
            <HoverPreview hover={hover} view={g.view} bottom />
          </div>
        </div>
      </div>
      {moveDraft && (
        <MovePicker from={moveDraft.from} to={moveDraft.to} kind={moveDraft.kind} view={g.view}
          onConfirm={(a) => { setMoveDraft(null); void submit(a); }} onCancel={() => setMoveDraft(null)} />
      )}
      {/* A region offered more than one thing to move (e.g. the army AND its Nazgûl). */}
      {moveMenu && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.55)', display: 'grid', placeItems: 'center', zIndex: 60 }}
          onClick={() => setMoveMenu(null)}>
          <div style={{ background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: 16, borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 240, boxShadow: '0 8px 40px #000' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>What do you want to move?</div>
            {moveMenu.options.map((o, i) => (
              <button key={i} onClick={() => beginMove(moveMenu.region, o)}
                style={{ display: 'block', width: '100%', textAlign: 'left', margin: '4px 0', padding: '8px 12px', fontSize: 14, background: '#3a3326', color: '#f0e9d8', border: '1px solid #5a4a2a', borderRadius: 6, cursor: 'pointer' }}>
                {o.kind === 'army' ? 'The army' : o.char === 'nazgul' ? 'The Nazgûl' : charName(o.char)}
              </button>
            ))}
            <button onClick={() => setMoveMenu(null)} style={{ marginTop: 6, padding: '5px 12px', fontSize: 13, background: 'transparent', color: '#a98', border: '1px solid #553', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {undoConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 62 }} onClick={() => setUndoConfirm(false)}>
          <div style={{ background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 12, border: '1px solid #7a5f24', maxWidth: 440, boxShadow: '0 8px 40px #000' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#ffe08a', marginBottom: 8 }}>⚠ Foreknowledge undo</div>
            <p style={{ fontSize: 13, lineHeight: 1.45, margin: '0 0 10px' }}>
              This undo crosses a <b>dice roll or card draw</b>, so you’ll be re-deciding while already knowing a random outcome you wouldn’t normally have seen. It’s allowed against the AI, but it will be <b>recorded in the game log</b>.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setUndoConfirm(false)} style={{ padding: '6px 14px', fontSize: 13, background: 'transparent', color: '#cb9', border: '1px solid #5a4a2a', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => void runUndo()} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, background: '#4a3a1a', color: '#ffe08a', border: '1px solid #7a5f24', borderRadius: 6, cursor: 'pointer' }}>Undo anyway</button>
            </div>
          </div>
        </div>
      )}
      <DecisionModal view={g.view} you={g.you as Side} actions={g.legalActions} onAction={submit} yourTurn={g.yourTurn} />
      <HuntPopup view={g.view} />
      <TurnSummary view={g.view} yourTurn={g.yourTurn} you={g.you as Side | null} />
      <GameOverUpload view={g.view} you={g.you as Side | null} gameOver={g.gameOver} clientBuild={typeof __DBF_BUILD_ID__ === 'string' ? __DBF_BUILD_ID__ : undefined} />
      <ReportButton report={client.report} clientBuild={typeof __DBF_BUILD_ID__ === 'string' ? __DBF_BUILD_ID__ : undefined} />
      {/* Floating Log button (beside Report) — opens the game log as a pop-up. */}
      <button onClick={() => setLogOpen(true)} title="Open the game log"
        style={{ position: 'fixed', bottom: 10, right: 110, zIndex: 40, padding: '6px 12px', fontSize: 13, background: '#3a3326', color: '#f0e9d8', border: '1px solid #5a4a2a', borderRadius: 18, cursor: 'pointer', boxShadow: '0 2px 8px #0008' }}>
        📜 Log
      </button>
      {logOpen && (
        <div onClick={() => setLogOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.7)', display: 'grid', placeItems: 'center', zIndex: 71 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#1c1710', color: '#eee', fontFamily: 'system-ui', borderRadius: 12, border: '1px solid #5a4a2a', width: 520, maxWidth: '92vw', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px #000' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '6px 10px', borderBottom: '1px solid #2a2418' }}>
              <button onClick={() => setLogOpen(false)} style={{ background: 'none', border: '1px solid #5a4a2a', color: '#cb9', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>Close</button>
            </div>
            <div style={{ height: '60vh', overflowY: 'auto' }}>
              <LogPanel view={g.view} />
            </div>
          </div>
        </div>
      )}
      {onExit &&<button onClick={onExit} style={{ position: 'fixed', top: 6, right: 8, padding: '3px 8px', fontSize: 12 }}>← Lobby</button>}
    </div>
  );
}
