// The whole game log, kept by this browser.
//
// The engine keeps only the newest LOG_CAP (500) entries in the game state — the
// state is stored on every move, so it cannot grow all game — and in a long game the
// log panel used to begin somewhere around turn 4 (player report jag3mymgg4tqwute:
// "Full game log please. It cuts off at Turn 4."). The page sees every entry as it
// arrives, so it keeps them: merged by `seq` into one list per game and seat, saved in
// localStorage, and shown in place of the capped log. A later copy of an entry wins
// (a private line rewritten for everyone at game over).
//
// What it holds is only what this seat's view has shown, so it reveals nothing new. A
// device that joins a game halfway starts from what the state still holds. Storage is
// best-effort: a blocked or full localStorage just leaves the capped log.
import type { GameState } from '../engine/types';

type Entry = GameState['log'][number];

const PREFIX = 'wotr.fullLog.v1.';
const KEEP_GAMES = 6; // older games' logs are dropped so storage never fills up

const memory = new Map<string, Entry[]>();

function load(key: string): Entry[] {
  const hit = memory.get(key);
  if (hit) return hit;
  let list: Entry[] = [];
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as { log?: Entry[] };
      if (Array.isArray(parsed.log)) list = parsed.log;
    }
  } catch { /* storage blocked or corrupt: start from the state's own log */ }
  memory.set(key, list);
  return list;
}

function save(key: string, list: Entry[]): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), log: list }));
    // Keep only the most recent few games.
    const keys: { k: string; at: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      let at = 0;
      try { at = (JSON.parse(localStorage.getItem(k) ?? '{}') as { at?: number }).at ?? 0; } catch { /* unreadable: oldest */ }
      keys.push({ k, at });
    }
    keys.sort((a, b) => b.at - a.at).slice(KEEP_GAMES).forEach(({ k }) => localStorage.removeItem(k));
  } catch { /* quota or blocked: the in-memory copy still serves this session */ }
}

/** The view's log merged into everything this browser has kept for `key`, oldest
 *  first. Returns the view's own log untouched when there is no key. */
export function fullLog(key: string | undefined, log: Entry[]): Entry[] {
  if (!key) return log;
  const kept = load(key);
  const firstSeq = log[0]?.seq ?? Infinity;
  const older = kept.filter((e) => e.seq < firstSeq);
  if (!older.length && kept.length === log.length && kept[kept.length - 1]?.seq === log[log.length - 1]?.seq) return log;
  const merged = [...older, ...log];
  memory.set(key, merged);
  save(key, merged);
  return merged;
}
