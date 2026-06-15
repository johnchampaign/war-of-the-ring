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
import { ReportButton } from './ReportButton';
import { HoverPreview, type Hover } from './HoverPreview';
import { isDecisionAction } from './actionText';

const seatLabel = (s: string) => (s === 'fp' ? 'Free Peoples' : s === 'shadow' ? 'Shadow' : s);

type SpatialAction = Extract<WotrAction, { kind: 'moveArmy' | 'attack' }>;
const isSpatial = (a: WotrAction): a is SpatialAction => a.kind === 'moveArmy' || a.kind === 'attack';

export function PlayPage({ client, onExit }: { client: GameClientApi; onExit?: () => void }) {
  // Realtime move push when available (online); polling fallback otherwise.
  const g = useGame<GameState, WotrAction>(client as any, { subscribe: client.subscribeMoves });
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [moveDraft, setMoveDraft] = useState<{ from: string; to: string; kind: 'moveArmy' | 'attack' } | null>(null);
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
  const sources = useMemo(() => new Set(armyActs.map((a) => a.from)), [armyActs]);
  const destinations = useMemo(
    () => new Set(armyActs.filter((a) => a.from === selected).map((a) => a.to)),
    [armyActs, selected],
  );

  const onRegionClick = useCallback((id: RegionId) => {
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
    } else if (sources.has(id)) {
      setSelected((s) => (s === id ? null : id));
    } else {
      setSelected(null);
    }
  }, [selected, destinations, sources, armyActs, submit]);
  // Stable highlight object so a memoized Board ignores hover-only re-renders.
  const highlights = useMemo(() => ({ sources, selected, destinations }), [sources, selected, destinations]);
  const pickRegion = g.yourTurn && !g.view?.pendingChoice ? onRegionClick : undefined;

  if (!g.view) return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#ccc' }}>{g.error ? `Error: ${g.error.message}` : 'Loading…'}</div>;

  // Army moves/attacks are done on the board; combat/hunt decisions go to the
  // modal. Keep both out of the plain action-button list.
  const panelActions = g.legalActions.filter((a) => !isSpatial(a) && !isDecisionAction(a));

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0c0a07' }}>
      <StatusBar view={g.view} you={g.you} onHoverChar={onHoverChar} />
      {g.error && <div style={{ background: '#7a1f1f', color: '#fff', padding: 6, fontFamily: 'system-ui', fontSize: 13 }}>⚠ {g.error.message}</div>}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          <Board view={g.view} onPickRegion={pickRegion} onHoverRegion={onHoverRegion} highlights={highlights} />
          {sources.size > 0 && (
            <div style={{ color: '#9c9', fontFamily: 'system-ui', fontSize: 13, padding: '4px 8px' }}>
              {selected ? `Selected ${selected} — click a highlighted region to move/attack (or click again to cancel).`
                : 'Click a highlighted (green) region to move or attack its army.'}
            </div>
          )}
        </div>
        <div style={{ width: 320, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PoliticsPanel view={g.view} />
          {/* Actions size to their content (scroll past ~45% of the column); the hover
              preview takes the rest so cards/region crops show as large as possible. */}
          <div style={{ flex: '0 1 auto', minHeight: 0, maxHeight: '45%', overflow: 'auto' }}>
            <ActionPanel actions={panelActions} onAction={submit} onHover={setHover} yourTurn={g.yourTurn} gameOver={g.gameOver} view={g.view} />
          </div>
          <div style={{ flex: '1 1 0', minHeight: 200, display: 'flex', flexDirection: 'column' }}>
            <HoverPreview hover={hover} view={g.view} />
          </div>
          {chatClient && g.you && (
            <ChatPanel client={chatClient} you={g.you} seatLabel={seatLabel} title="Table talk"
              subscribe={client.subscribeMessages} style={{ borderTop: '1px solid #2a2418', maxHeight: '34vh' }} />
          )}
        </div>
      </div>
      <HandStrip view={g.view} you={g.you as Side} onHoverCard={onHoverCard} />
      {moveDraft && (
        <MovePicker from={moveDraft.from} to={moveDraft.to} kind={moveDraft.kind} view={g.view}
          onConfirm={(a) => { setMoveDraft(null); void submit(a); }} onCancel={() => setMoveDraft(null)} />
      )}
      <DecisionModal view={g.view} you={g.you as Side} actions={g.legalActions} onAction={submit} yourTurn={g.yourTurn} />
      <ReportButton report={client.report} clientBuild={typeof __DBF_BUILD_ID__ === 'string' ? __DBF_BUILD_ID__ : undefined} />
      {onExit &&<button onClick={onExit} style={{ position: 'fixed', top: 6, right: 8, padding: '3px 8px', fontSize: 12 }}>← Lobby</button>}
    </div>
  );
}
