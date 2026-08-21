// App shell: lobby + routing. Hotseat (local in-browser engine) or online (HTTP
// to /api). #audit -> the dev polygon-audit overlay.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIdentity, SignInBar } from 'digital-boardgame-framework/client';
import { PlayPage } from './play/PlayPage';
import { PolygonAudit } from './devtabs/PolygonAudit';
import { ContentAudit } from './devtabs/ContentAudit';
import { BlockedAreasEditor } from './devtabs/BlockedAreasEditor';
import { makeLocalClient } from './online/localClient';

/** The hub's ranked ladder for this game. Linked from BOTH the in-game sign-in bar
 *  and the lobby — it used to hang off the sign-in bar only, which appears once you
 *  are already in an online game, so a player who had not started one could not find
 *  it at all (player report: "also i cant seem to find the leaderboard"). */
const LEADERBOARD_URL = 'https://games-hub-5vo.pages.dev/leaderboard?game=war-of-the-ring';
import { loadLocalGame, peekLocalGame, clearLocalGame, describeSave, type LocalSave, type SavePeek } from './online/localSave';
import { wotrAdapter } from './adapter/wotrAdapter';
import { makeGameClient, createOnlineGame, readOnlineInvite, claimSeat } from './online/gameClient';
import { LoadArtPanel } from './play/LoadArtPanel';

type Mode =
  | { kind: 'lobby' }
  | { kind: 'local'; seed: number; scenario?: 'combat' | 'mordor'; aiSide?: 'fp' | 'shadow'; resume?: LocalSave }
  | { kind: 'online'; gameId: string; token: string };

const SCHEMA = wotrAdapter.schemaVersion ?? 0;

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
    if (mode.kind === 'local') return makeLocalClient(mode.seed, { scenario: mode.scenario, aiSide: mode.aiSide, resume: mode.resume });
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
          <SignInBar leaderboardHref={LEADERBOARD_URL} />
        </div>
        {page}
      </>
    ) : page;
  }
  // Starting a new local game abandons any saved one — there is a single slot, and the
  // lobby warns before this is reachable with a save present.
  const startLocal = (aiSide?: 'fp' | 'shadow') => {
    clearLocalGame();
    setMode({ kind: 'local', seed: Math.floor(Math.random() * 1e9), aiSide });
  };
  const resumeLocal = () => {
    const save = loadLocalGame(SCHEMA);
    if (!save) return;                       // vanished or unreadable — the lobby re-checks
    setMode({ kind: 'local', seed: 0, aiSide: save.aiSide ?? undefined, resume: save });
  };
  return <Lobby onStart={startLocal} onResume={resumeLocal} />;
}

function Lobby({ onStart, onResume }: { onStart: (aiSide?: 'fp' | 'shadow') => void; onResume: () => void }) {
  // A local game in progress, if one was saved. Read once on mount; starting a new game
  // leaves the lobby, so it cannot go stale under us.
  const [saved, setSaved] = useState<SavePeek | null>(() => peekLocalGame(SCHEMA));
  const discard = () => {
    if (!window.confirm('Discard the saved game? This cannot be undone.')) return;
    clearLocalGame();
    setSaved(null);
  };
  // Guard the new-game buttons while a save exists, so a stray click cannot silently
  // destroy a game in progress.
  const startGuarded = (aiSide?: 'fp' | 'shadow') => {
    if (saved && !window.confirm('Starting a new game will discard your saved game in progress. Continue?')) return;
    onStart(aiSide);
  };
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
        {saved && (
          <div style={{ margin: '14px 0 4px', textAlign: 'left', background: '#1a2a1a', border: '1px solid #3a5a3a', padding: 12, borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#bfe6bf', marginBottom: 6 }}>Game in progress</div>
            <div style={{ fontSize: 13, color: '#e9e1cc', marginBottom: 8 }}>{describeSave(saved)}</div>
            <button onClick={onResume} style={{ ...primary, margin: 0, background: '#2c6a3a' }}>Resume game</button>
            <button onClick={discard} style={{ ...secondary, margin: '6px 0 0', padding: 8, fontSize: 13, background: '#2a2320' }}>Discard it</button>
          </div>
        )}
        <div style={{ fontSize: 12, color: '#887', textAlign: 'left', margin: '14px 4px 4px' }}>Ranked online — vs the leaderboard AI:</div>
        <button onClick={() => createVsAi('fp')} disabled={creating} style={{ ...primary, background: '#2f4f9e' }}>{creating ? 'Creating…' : 'Play Free Peoples (vs AI Shadow) — ranked'}</button>
        <button onClick={() => createVsAi('shadow')} disabled={creating} style={{ ...primary, background: '#a83232' }}>{creating ? 'Creating…' : 'Play Shadow (vs AI Free Peoples) — ranked'}</button>
        <div style={{ fontSize: 11, color: '#776', textAlign: 'left', margin: '2px 4px 0' }}>
          Sign in first so your result counts on the <a href={LEADERBOARD_URL} target="_blank" rel="noreferrer" style={{ color: '#e6b85a' }}>leaderboard</a>.
        </div>
        <div style={{ fontSize: 12, color: '#887', textAlign: 'left', margin: '14px 4px 4px' }}>Play vs the AI (local, unranked):</div>
        <button onClick={() => startGuarded('shadow')} style={secondary}>Free Peoples (vs AI Shadow)</button>
        <button onClick={() => startGuarded('fp')} style={secondary}>Shadow (vs AI Free Peoples)</button>
        <div style={{ fontSize: 12, color: '#887', textAlign: 'left', margin: '14px 4px 4px' }}>Two players, one screen:</div>
        <button onClick={() => startGuarded()} style={secondary}>New hotseat game (2 humans)</button>
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
