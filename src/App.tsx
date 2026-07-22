// App shell: lobby + routing. Hotseat (local in-browser engine) or online (HTTP
// to /api). #audit -> the dev polygon-audit overlay.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIdentity, SignInBar } from 'digital-boardgame-framework/client';
import { PlayPage } from './play/PlayPage';
import { PolygonAudit } from './devtabs/PolygonAudit';
import { ContentAudit } from './devtabs/ContentAudit';
import { BlockedAreasEditor } from './devtabs/BlockedAreasEditor';
import { makeLocalClient } from './online/localClient';
import { makeGameClient, createOnlineGame, readOnlineInvite, claimSeat } from './online/gameClient';
import { LoadArtPanel } from './play/LoadArtPanel';

type Mode =
  | { kind: 'lobby' }
  | { kind: 'local'; seed: number; scenario?: 'combat' | 'mordor'; aiSide?: 'fp' | 'shadow' }
  | { kind: 'online'; gameId: string; token: string };

export function App() {
  // Re-render on hash change so the dev routes (#audit / #content / #blocked /
  // #combat) switch live from the lobby links instead of only on a fresh load.
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const devScenario = hash === '#combat' ? 'combat' as const : hash === '#mordor' ? 'mordor' as const : null;
  const invite = readOnlineInvite();
  const [mode, setMode] = useState<Mode>(
    devScenario ? { kind: 'local', seed: 1, scenario: devScenario }
      : invite ? { kind: 'online', gameId: invite.gameId, token: invite.token }
        : { kind: 'lobby' });

  // Ranked identity (anon or signed-in). Kept in a ref so each move carries it
  // to the server (per-move attribution — robust + race-free).
  const { identity } = useIdentity();
  const idTokRef = useRef<string | undefined>(undefined);
  idTokRef.current = identity?.token;

  const client = useMemo(() => {
    if (mode.kind === 'local') return makeLocalClient(mode.seed, { scenario: mode.scenario, aiSide: mode.aiSide });
    if (mode.kind === 'online') return makeGameClient(mode.gameId, mode.token, () => idTokRef.current);
    return null;
  }, [mode]);

  // Bind this client's identity to its seat on join (per-move attribution above
  // is the primary path; this covers a game where you never get a turn).
  useEffect(() => {
    if (mode.kind === 'online' && identity?.token) {
      void claimSeat(mode.gameId, mode.token, identity.token);
    }
  }, [mode, identity?.token]);

  // Dev routes — checked after the hooks above so hook order stays stable.
  if (hash === '#audit') return <PolygonAudit />;
  if (hash === '#content') return <ContentAudit />;
  if (hash === '#blocked') return <BlockedAreasEditor />;

  if (client) {
    const page = <PlayPage client={client} onExit={mode.kind === 'local' ? () => setMode({ kind: 'lobby' }) : undefined} />;
    return mode.kind === 'online' ? (
      <>
        <div style={{ padding: '0 12px' }}>
          <SignInBar leaderboardHref="https://games-hub-5vo.pages.dev/leaderboard?game=war-of-the-ring" />
        </div>
        {page}
      </>
    ) : page;
  }
  const startLocal = (aiSide?: 'fp' | 'shadow') => setMode({ kind: 'local', seed: Math.floor(Math.random() * 1e9), aiSide });
  return <Lobby onStart={startLocal} />;
}

function Lobby({ onStart }: { onStart: (aiSide?: 'fp' | 'shadow') => void }) {
  const [invites, setInvites] = useState<Record<'fp' | 'shadow', string> | null>(null);
  const [creating, setCreating] = useState(false);
  // Best-effort play counter from the games hub (never blocks the lobby).
  const [plays, setPlays] = useState<number | null>(null);
  useEffect(() => {
    fetch('https://games-hub-5vo.pages.dev/stats?game=war-of-the-ring')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.count === 'number') setPlays(d.count); })
      .catch(() => {});
  }, []);
  const createOnline = async () => {
    setCreating(true);
    try { const r = await createOnlineGame(); setInvites(r.invites); }
    catch (e) { alert('Online create failed (needs the deployed server): ' + (e as Error).message); }
    finally { setCreating(false); }
  };
  // Create a ranked online game vs the server-driven AI: the human takes
  // `humanSide`, the AI takes the other side, then navigate the human to their
  // seat (the server drives the AI's turns + auto-rates the result).
  const createVsAi = async (humanSide: 'fp' | 'shadow') => {
    setCreating(true);
    try {
      const aiSide = humanSide === 'fp' ? 'shadow' : 'fp';
      const r = await createOnlineGame({ ai: { [aiSide]: 'standard' } });
      window.location.href = r.invites[humanSide]; // go to the human's seat
    } catch (e) {
      alert('Online vs-AI create failed (needs the deployed server): ' + (e as Error).message);
      setCreating(false);
    }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0c0a07', color: '#e9e1cc', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center', maxWidth: 460 }}>
        <h1 style={{ fontVariant: 'small-caps', letterSpacing: 1 }}>War of the Ring</h1>
        <p style={{ color: '#a99' }}>Unofficial digital port · 2-player (Free Peoples vs Shadow)</p>
        {plays != null && <p style={{ color: '#776', fontSize: 12, marginTop: -6 }}>{plays.toLocaleString()} games played</p>}
        <div style={{ fontSize: 12, color: '#887', textAlign: 'left', margin: '14px 4px 4px' }}>Ranked online — vs the leaderboard AI:</div>
        <button onClick={() => createVsAi('fp')} disabled={creating} style={{ ...primary, background: '#2f4f9e' }}>{creating ? 'Creating…' : 'Play Free Peoples (vs AI Shadow) — ranked'}</button>
        <button onClick={() => createVsAi('shadow')} disabled={creating} style={{ ...primary, background: '#a83232' }}>{creating ? 'Creating…' : 'Play Shadow (vs AI Free Peoples) — ranked'}</button>
        <div style={{ fontSize: 11, color: '#776', textAlign: 'left', margin: '2px 4px 0' }}>Sign in first so your result counts on the leaderboard.</div>
        <div style={{ fontSize: 12, color: '#887', textAlign: 'left', margin: '14px 4px 4px' }}>Play vs the AI (local, unranked):</div>
        <button onClick={() => onStart('shadow')} style={secondary}>Free Peoples (vs AI Shadow)</button>
        <button onClick={() => onStart('fp')} style={secondary}>Shadow (vs AI Free Peoples)</button>
        <div style={{ fontSize: 12, color: '#887', textAlign: 'left', margin: '14px 4px 4px' }}>Two players, one screen:</div>
        <button onClick={() => onStart()} style={secondary}>New hotseat game (2 humans)</button>
        <button onClick={createOnline} disabled={creating} style={secondary}>{creating ? 'Creating…' : 'New online game'}</button>
        {invites && (
          <div style={{ marginTop: 18, textAlign: 'left', background: '#1a160f', padding: 14, borderRadius: 8 }}>
            <p>Share these seat links (one per player):</p>
            <p><b>Free Peoples:</b><br /><a style={{ color: '#7fb6e6', wordBreak: 'break-all' }} href={invites.fp}>{invites.fp}</a></p>
            <p><b>Shadow:</b><br /><a style={{ color: '#e6857f', wordBreak: 'break-all' }} href={invites.shadow}>{invites.shadow}</a></p>
          </div>
        )}
        <LoadArtPanel />
        <p style={{ marginTop: 24, fontSize: 12, color: '#776' }}>Placeholder board (no publisher art). <a href="#audit" style={{ color: '#998' }}>polygon audit</a> · <a href="#content" style={{ color: '#998' }}>content audit</a> · <a href="#blocked" style={{ color: '#998' }}>block areas</a></p>
      </div>
    </div>
  );
}

const primary: React.CSSProperties = { display: 'block', width: '100%', margin: '8px 0', padding: '12px', fontSize: 16, background: '#2f4f9e', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const secondary: React.CSSProperties = { ...primary, background: '#3a3326' };
