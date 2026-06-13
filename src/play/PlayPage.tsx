// Top-level play screen: drives the game through the framework useGame hook over
// a GameClientApi (local hotseat or online HTTP). Renders the redacted view; it
// never owns rules and never drives the opponent.
import { useGame } from 'digital-boardgame-framework/client';
import type { GameClientApi } from '../online/gameClient';
import type { GameState } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { Board } from './Board';
import { ActionPanel } from './ActionPanel';
import { StatusBar } from './StatusBar';

export function PlayPage({ client, onExit }: { client: GameClientApi; onExit?: () => void }) {
  const g = useGame<GameState, WotrAction>(client as any);

  if (!g.view) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>{g.error ? `Error: ${g.error.message}` : 'Loading…'}</div>;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0c0a07' }}>
      <StatusBar view={g.view} you={g.you} />
      {g.error && <div style={{ background: '#7a1f1f', color: '#fff', padding: 6, fontFamily: 'system-ui', fontSize: 13 }}>⚠ {g.error.message}</div>}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          <Board view={g.view} />
        </div>
        <ActionPanel actions={g.legalActions} onAction={g.submit} yourTurn={g.yourTurn} gameOver={g.gameOver} view={g.view} />
      </div>
      {onExit && <button onClick={onExit} style={{ position: 'fixed', top: 6, right: 8, padding: '3px 8px', fontSize: 12 }}>← Lobby</button>}
    </div>
  );
}
