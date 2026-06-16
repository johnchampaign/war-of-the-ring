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
import { REGIONS } from '../engine/data';

const seatLabel = (s: string) => (s === 'fp' ? 'Free Peoples' : s === 'shadow' ? 'Shadow' : s);

type SpatialAction = Extract<WotrAction, { kind: 'moveArmy' | 'attack' }>;
const isSpatial = (a: WotrAction): a is SpatialAction => a.kind === 'moveArmy' || a.kind === 'attack';

export function PlayPage({ client, onExit }: { client: GameClientApi; onExit?: () => void }) {
  // Realtime move push when available (online); polling fallback otherwise.
  const g = useGame<GameState, WotrAction>(client as any, { subscribe: client.subscribeMoves });
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [moveDraft, setMoveDraft] = useState<{ from: string; to: string; kind: 'moveArmy' | 'attack' } | null>(null);
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
  const sources = useMemo(() => new Set<RegionId>([...armyActs.map((a) => a.from), ...declareTargets]), [armyActs, declareTargets]);
  const destinations = useMemo(
    () => new Set(armyActs.filter((a) => a.from === selected).map((a) => a.to)),
    [armyActs, selected],
  );

  const onRegionClick = useCallback((id: RegionId) => {
    setBlockMsg(null);
    // Placing the Fellowship figure (declare, or move-on-reveal): click a highlighted region.
    if (declareTargets.has(id)) {
      const a = placeActs.find((x) => x.target === id);
      if (a) { setSelected(null); void submit(a); }
      return;
    }
    if (selected && destinations.has(id)) {
      const act = armyActs.find((a) => a.from === selected && a.to === id);
      if (act) {
        setSelected(null);
        // Both moves and attacks open the picker (whole army, or split off a portion /
        // rearguard); only the kind differs.
        if (act.kind === 'moveArmy') setMoveDraft({ from: act.from, to: act.to, kind: 'moveArmy' });
        else if (act.kind === 'attack') setMoveDraft({ from: act.from, to: act.to, kind: 'attack' });
        else void submit(act);
      }
    } else if (selected && id !== selected && g.view && REGIONS[selected]?.adjacency.includes(id)) {
      // Adjacent but not a legal destination (e.g. a refused merge): explain why,
      // instead of silently re-selecting the other army.
      const reason = moveBlockReason(g.view, selected, id, g.you as Side);
      if (reason) setBlockMsg(reason);
      else if (sources.has(id)) setSelected(id);
    } else if (sources.has(id)) {
      setSelected((s) => (s === id ? null : id));
    } else {
      setSelected(null);
    }
  }, [selected, destinations, sources, armyActs, declareTargets, placeActs, submit, g.view, g.you]);
  // Stable highlight object so a memoized Board ignores hover-only re-renders.
  const highlights = useMemo(() => ({ sources, selected, destinations }), [sources, selected, destinations]);
  const pickRegion = g.yourTurn && (!g.view?.pendingChoice || isReveal) ? onRegionClick : undefined;

  if (!g.view) return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#ccc' }}>{g.error ? `Error: ${g.error.message}` : 'Loading…'}</div>;

  // Army moves/attacks are done on the board; combat/hunt decisions go to the
  // modal. Keep both out of the plain action-button list.
  const panelActions = g.legalActions.filter((a) => !isSpatial(a) && !isDecisionAction(a));

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0c0a07' }}>
      <StatusBar view={g.view} you={g.you} onHoverChar={onHoverChar} />
      {g.error && <div style={{ background: '#7a1f1f', color: '#fff', padding: 6, fontFamily: 'system-ui', fontSize: 13 }}>⚠ {g.error.message}</div>}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: '0 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 2 }}>
          {/* Board sized to the crop's aspect and left-aligned, so there are no
              letterbox bars around it; the info panel (flex:1) takes the freed width. */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', aspectRatio: '1511 / 1318', alignSelf: 'flex-start', maxWidth: '100%' }}>
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
                  : selected ? `Selected ${selected} — click a highlighted region to move/attack (or click again to cancel).`
                    : 'Click a highlighted (green) region to move or attack its army.'}
            </div>
          )}
        </div>
        <div style={{ flex: '1 1 380px', minWidth: 340, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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
      <DecisionModal view={g.view} you={g.you as Side} actions={g.legalActions} onAction={submit} yourTurn={g.yourTurn} />
      <HuntPopup view={g.view} />
      <TurnSummary view={g.view} yourTurn={g.yourTurn} you={g.you as Side | null} />
      <ReportButton report={client.report} clientBuild={typeof __DBF_BUILD_ID__ === 'string' ? __DBF_BUILD_ID__ : undefined} />
      {onExit &&<button onClick={onExit} style={{ position: 'fixed', top: 6, right: 8, padding: '3px 8px', fontSize: 12 }}>← Lobby</button>}
    </div>
  );
}
