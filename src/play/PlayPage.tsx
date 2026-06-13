// Top-level play screen: drives the game through the framework useGame hook over
// a GameClientApi (local hotseat or online HTTP). Renders the redacted view; it
// never owns rules and never drives the opponent.
import { useMemo, useState } from 'react';
import { useGame } from 'digital-boardgame-framework/client';
import type { GameClientApi } from '../online/gameClient';
import type { GameState, RegionId, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { Board } from './Board';
import { ActionPanel } from './ActionPanel';
import { StatusBar } from './StatusBar';
import { HandStrip } from './HandStrip';
import { PoliticsPanel } from './PoliticsPanel';
import { DecisionModal } from './DecisionModal';
import { isDecisionAction } from './actionText';

type SpatialAction = Extract<WotrAction, { kind: 'moveArmy' | 'attack' }>;
const isSpatial = (a: WotrAction): a is SpatialAction => a.kind === 'moveArmy' || a.kind === 'attack';

export function PlayPage({ client, onExit }: { client: GameClientApi; onExit?: () => void }) {
  const g = useGame<GameState, WotrAction>(client as any);
  const [selected, setSelected] = useState<RegionId | null>(null);

  const armyActs = useMemo(() => g.legalActions.filter(isSpatial), [g.legalActions]);
  const sources = useMemo(() => new Set(armyActs.map((a) => a.from)), [armyActs]);
  const destinations = useMemo(
    () => new Set(armyActs.filter((a) => a.from === selected).map((a) => a.to)),
    [armyActs, selected],
  );

  const onRegionClick = (id: RegionId) => {
    if (selected && destinations.has(id)) {
      const act = armyActs.find((a) => a.from === selected && a.to === id);
      if (act) { setSelected(null); void g.submit(act); }
    } else if (sources.has(id)) {
      setSelected((s) => (s === id ? null : id));
    } else {
      setSelected(null);
    }
  };

  if (!g.view) return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#ccc' }}>{g.error ? `Error: ${g.error.message}` : 'Loading…'}</div>;

  // Army moves/attacks are done on the board; combat/hunt decisions go to the
  // modal. Keep both out of the plain action-button list.
  const panelActions = g.legalActions.filter((a) => !isSpatial(a) && !isDecisionAction(a));

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0c0a07' }}>
      <StatusBar view={g.view} you={g.you} />
      {g.error && <div style={{ background: '#7a1f1f', color: '#fff', padding: 6, fontFamily: 'system-ui', fontSize: 13 }}>⚠ {g.error.message}</div>}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          <Board view={g.view} onPickRegion={g.yourTurn && !g.view.pendingChoice ? onRegionClick : undefined}
            highlights={{ sources, selected, destinations }} />
          {sources.size > 0 && (
            <div style={{ color: '#9c9', fontFamily: 'system-ui', fontSize: 13, padding: '4px 8px' }}>
              {selected ? `Selected ${selected} — click a highlighted region to move/attack (or click again to cancel).`
                : 'Click a highlighted (green) region to move or attack its army.'}
            </div>
          )}
        </div>
        <div style={{ width: 320, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PoliticsPanel view={g.view} />
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <ActionPanel actions={panelActions} onAction={g.submit} yourTurn={g.yourTurn} gameOver={g.gameOver} view={g.view} />
          </div>
        </div>
      </div>
      <HandStrip view={g.view} you={g.you as Side} />
      <DecisionModal view={g.view} you={g.you as Side} actions={g.legalActions} onAction={g.submit} yourTurn={g.yourTurn} />
      {onExit &&<button onClick={onExit} style={{ position: 'fixed', top: 6, right: 8, padding: '3px 8px', fontSize: 12 }}>← Lobby</button>}
    </div>
  );
}
