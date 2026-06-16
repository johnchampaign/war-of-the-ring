// Top-level play screen: drives the game through the framework useGame hook over
// a GameClientApi (local hotseat or online HTTP). Renders the redacted view; it
// never owns rules and never drives the opponent.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useGame, ChatPanel } from 'digital-boardgame-framework/client';
import type { GameClientApi } from '../online/gameClient';
import type { GameState, RegionId, Side } from '../engine/types';
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
import { ReportButton } from './ReportButton';
import { HoverPreview, type Hover } from './HoverPreview';
import { isDecisionAction } from './actionText';
import { moveBlockReason } from '../engine/armies';
import { movableCharsAt, characterDestinations } from '../engine/charMove';
import { REGIONS } from '../engine/data';
import { charName } from './charInfo';

const seatLabel = (s: string) => (s === 'fp' ? 'Free Peoples' : s === 'shadow' ? 'Shadow' : s);

type SpatialAction = Extract<WotrAction, { kind: 'moveArmy' | 'attack' }>;
const isSpatial = (a: WotrAction): a is SpatialAction => a.kind === 'moveArmy' || a.kind === 'attack';

export function PlayPage({ client, onExit }: { client: GameClientApi; onExit?: () => void }) {
  // Realtime move push when available (online); polling fallback otherwise.
  const g = useGame<GameState, WotrAction>(client as any, { subscribe: client.subscribeMoves });
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
    try { await g.submit(a); } finally { inFlight.current = false; }
  }, [g]);

  // Chat is online-only (a remote opponent to talk to); the hotseat client omits
  // the messaging methods, so it's hidden in that mode.
  const chatClient = useMemo(
    () => (client.listMessages && client.postMessage
      ? { listMessages: client.listMessages.bind(client), postMessage: client.postMessage.bind(client) }
      : null),
    [client],
  );

  const armyActs = useMemo(() => g.legalActions.filter(isSpatial), [g.legalActions]);
  // Board-click placement of the Fellowship figure: declaring it (Fellowship phase) or
  // choosing where it moves when revealed by the Hunt (revealMove choice).
  const placeActs = useMemo(() => g.legalActions.filter((a): a is Extract<WotrAction, { kind: 'declareFellowship' | 'revealMove' }> => a.kind === 'declareFellowship' || a.kind === 'revealMove'), [g.legalActions]);
  const declareTargets = useMemo(() => new Set(placeActs.map((a) => a.target)), [placeActs]);
  const isReveal = g.view?.pendingChoice?.kind === 'revealMove';
  // Independent characters (Nazgûl/Minion/Companion) are board-movable when a
  // Character (or Will) die is available — detected by any moveCharacter being legal.
  const canMoveChars = useMemo(() => g.legalActions.some((a) => a.kind === 'moveCharacter'), [g.legalActions]);
  const charSources = useMemo(() => {
    const s = new Set<RegionId>();
    if (g.view && canMoveChars && g.you) for (const id of Object.keys(g.view.regions)) {
      if (movableCharsAt(g.view, g.you as Side, id).length) s.add(id);
    }
    return s;
  }, [g.view, canMoveChars, g.you]);
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
    const charsHere = (g.view && canMoveChars && g.you) ? movableCharsAt(g.view, g.you as Side, id) : [];
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
  }, [selected, charPick, destinations, charDestinations, armyActs, declareTargets, placeActs, submit, beginMove, canMoveChars, g.view, g.you]);
  // Stable highlight object so a memoized Board ignores hover-only re-renders.
  const highlights = useMemo(() => ({ sources, selected: activeRegion, destinations }), [sources, activeRegion, destinations]);
  const pickRegion = g.yourTurn && (!g.view?.pendingChoice || isReveal) ? onRegionClick : undefined;

  if (!g.view) return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#ccc' }}>{g.error ? `Error: ${g.error.message}` : 'Loading…'}</div>;

  // Army moves/attacks AND independent-character (Nazgûl/Companion) moves are done on
  // the board; combat/hunt decisions go to the modal. Keep them out of the button list.
  const panelActions = g.legalActions.filter((a) => !isSpatial(a) && !isDecisionAction(a) && a.kind !== 'moveCharacter');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0c0a07' }}>
      <StatusBar view={g.view} you={g.you} onHoverChar={onHoverChar} />
      {g.error && <div style={{ background: '#7a1f1f', color: '#fff', padding: 6, fontFamily: 'system-ui', fontSize: 13 }}>⚠ {g.error.message}</div>}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Board column sized to the crop's width at full available height, so the
            board renders LARGE and fills it with no letterbox bars; the info panel
            (flex:1) takes the rest. 1.1464 = crop aspect (1511/1318); the ~175px is
            the top bar + bottom bar + padding. */}
        <div style={{ width: 'min(74vw, calc((100vh - 175px) * 1.1464))', flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 2 }}>
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
              {isReveal
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
          <DiceTray view={g.view} you={g.you as Side} />
          {/* Politics is reference info — capped + scrolls so it never crowds the actions. */}
          <div style={{ flexShrink: 0, maxHeight: '24%', overflow: 'auto' }}>
            <PoliticsPanel view={g.view} />
          </div>
          {/* Actions are the PRIMARY interaction — they get the whole column now (the
              hover inspector moved to the wide bottom bar). */}
          <div style={{ flex: '1 1 auto', minHeight: 120, overflow: 'auto' }}>
            <ActionPanel actions={panelActions} onAction={submit} onHover={setHover} yourTurn={g.yourTurn} gameOver={g.gameOver} view={g.view} you={g.you as Side | null} boardActions={armyActs.length} />
          </div>
          {/* Always-visible game log so a unit's fate (moved / merged / removed /
              killed) is traceable in the moment. Capped so it never crowds actions. */}
          <div style={{ flexShrink: 0, height: '26%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <LogPanel view={g.view} />
          </div>
          {chatClient && g.you && (
            <ChatPanel client={chatClient} you={g.you} seatLabel={seatLabel} title="Table talk"
              subscribe={client.subscribeMessages} style={{ borderTop: '1px solid #2a2418', maxHeight: '34vh' }} />
          )}
        </div>
      </div>
      {/* Bottom bar: hand + in-play cards on the left, the hover inspector filling the
          (previously wasted) wide space on the right. */}
      <div style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid #2a2418', height: 124, flexShrink: 0 }}>
        <div style={{ flexShrink: 0, maxWidth: '52%', overflowX: 'auto', display: 'flex' }}>
          <HandStrip view={g.view} you={g.you as Side} onHoverCard={onHoverCard} />
        </div>
        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #2a2418' }}>
          <HoverPreview hover={hover} view={g.view} bottom />
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
      <DecisionModal view={g.view} you={g.you as Side} actions={g.legalActions} onAction={submit} yourTurn={g.yourTurn} />
      <HuntPopup view={g.view} />
      <TurnSummary view={g.view} yourTurn={g.yourTurn} you={g.you as Side | null} />
      <ReportButton report={client.report} clientBuild={typeof __DBF_BUILD_ID__ === 'string' ? __DBF_BUILD_ID__ : undefined} />
      {onExit &&<button onClick={onExit} style={{ position: 'fixed', top: 6, right: 8, padding: '3px 8px', fontSize: 12 }}>← Lobby</button>}
    </div>
  );
}
