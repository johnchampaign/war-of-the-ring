// App shell: lobby + routing. Hotseat (local in-browser engine) or online (HTTP
// to /api). #audit -> the dev polygon-audit overlay.
import { useMemo, useState } from 'react';
import { PlayPage } from './play/PlayPage';
import { PolygonAudit } from './devtabs/PolygonAudit';
import { makeLocalClient } from './online/localClient';
import { makeGameClient, createOnlineGame, readOnlineInvite } from './online/gameClient';
import { LoadArtPanel } from './play/LoadArtPanel';

type Mode =
  | { kind: 'lobby' }
  | { kind: 'local'; seed: number }
  | { kind: 'online'; gameId: string; token: string };

export function App() {
  if (typeof window !== 'undefined' && window.location.hash === '#audit') return <PolygonAudit />;

  const invite = readOnlineInvite();
  const [mode, setMode] = useState<Mode>(invite ? { kind: 'online', gameId: invite.gameId, token: invite.token } : { kind: 'lobby' });

  const client = useMemo(() => {
    if (mode.kind === 'local') return makeLocalClient(mode.seed);
    if (mode.kind === 'online') return makeGameClient(mode.gameId, mode.token);
    return null;
  }, [mode]);

  if (client) return <PlayPage client={client} onExit={mode.kind === 'local' ? () => setMode({ kind: 'lobby' }) : undefined} />;
  return <Lobby onHotseat={() => setMode({ kind: 'local', seed: Math.floor(Math.random() * 1e9) })} />;
}

function Lobby({ onHotseat }: { onHotseat: () => void }) {
  const [invites, setInvites] = useState<Record<'fp' | 'shadow', string> | null>(null);
  const [creating, setCreating] = useState(false);
  const createOnline = async () => {
    setCreating(true);
    try { const r = await createOnlineGame(); setInvites(r.invites); }
    catch (e) { alert('Online create failed (needs the deployed server): ' + (e as Error).message); }
    finally { setCreating(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c0a07', color: '#e9e1cc', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <h1 style={{ fontVariant: 'small-caps', letterSpacing: 1 }}>War of the Ring</h1>
        <p style={{ color: '#a99' }}>Unofficial digital port · 2-player (Free Peoples vs Shadow)</p>
        <button onClick={onHotseat} style={primary}>New hotseat game</button>
        <button onClick={createOnline} disabled={creating} style={secondary}>{creating ? 'Creating…' : 'New online game'}</button>
        {invites && (
          <div style={{ marginTop: 18, textAlign: 'left', background: '#1a160f', padding: 14, borderRadius: 8 }}>
            <p>Share these seat links (one per player):</p>
            <p><b>Free Peoples:</b><br /><a style={{ color: '#7fb6e6', wordBreak: 'break-all' }} href={invites.fp}>{invites.fp}</a></p>
            <p><b>Shadow:</b><br /><a style={{ color: '#e6857f', wordBreak: 'break-all' }} href={invites.shadow}>{invites.shadow}</a></p>
          </div>
        )}
        <LoadArtPanel />
        <p style={{ marginTop: 24, fontSize: 12, color: '#776' }}>Placeholder board (no publisher art). <a href="#audit" style={{ color: '#998' }}>polygon audit</a></p>
      </div>
    </div>
  );
}

const primary: React.CSSProperties = { display: 'block', width: '100%', margin: '8px 0', padding: '12px', fontSize: 16, background: '#2f4f9e', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const secondary: React.CSSProperties = { ...primary, background: '#3a3326' };
