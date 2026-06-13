// Card-art cache. The deployed site ships ZERO publisher art (CLAUDE.md: metadata
// + URLs only). Instead we point the player at art that is *already publicly
// hosted* — the Steam CDN sheets from the "War of the Ring 2E" Tabletop Simulator
// mod (assets/asset-urls.json) — and, on an explicit first-run opt-in, the
// browser fetches those sheets, slices each event card out client-side
// (createImageBitmap region-crop), and caches the per-card blobs in IndexedDB.
//
// Why this shape (mirrors the Star Wars Rebellion / Tyrants / A&A ports):
//   - We never store or redistribute a single byte of art. Each player loads it
//     from the public host themselves; clearing site data drops it.
//   - The crop metadata (sheetId + normalized region) already lives in
//     assets/event-cards.json — every card carries where its art is. So there's
//     no name-join: we just fetch the 12 referenced sheets once and slice.
//   - Cache persists across sessions (IndexedDB); the download is a one-time step.
//   - The game is fully playable with text placeholders if the player skips this.
//
// Scope: event cards (the 96-card decks). Board/token art is not in the TTS card
// dump, so the polygon board stays as-is; this just makes hands/plays show the
// real cards.

import eventCardsJson from '../../assets/event-cards.json';
import assetUrlsJson from '../../assets/asset-urls.json';

type RegionRect = [number, number, number, number]; // normalized [x, y, w, h]
interface CardMeta { id: string; sheetId: string; region: RegionRect }
const CARDS: CardMeta[] = (eventCardsJson as { cards: any[] }).cards.map((c) => ({
  id: c.id, sheetId: String(c.sheetId), region: c.region as RegionRect,
}));
const SHEETS = (assetUrlsJson as { sheets: Record<string, { url: string; w: number; h: number }> }).sheets;

export const TOTAL_CARD_COUNT = CARDS.length;
/** Distinct Steam-CDN sheets we'd fetch (deduped). */
export const SHEET_COUNT = new Set(CARDS.map((c) => c.sheetId)).size;

// The Middle-earth board image is NOT in the TTS card dump. We fetch it from the
// public SirMartin/WarOfRingMap repo, whose map_en.jpg (1920x1324) is the exact
// reference image our region polygons were calibrated against — so it overlays
// the polygon board with no further calibration. Cached under this id like a card.
export const BOARD_ID = 'board:map_en';
const BOARD_URL = 'https://raw.githubusercontent.com/SirMartin/WarOfRingMap/master/images/map_en.jpg';

export const ART_SOURCE_NOTE =
  'Card art is fetched from the public Steam Workshop CDN (the "War of the Ring 2E" Tabletop Simulator mod); ' +
  'the board map is fetched from the public SirMartin/WarOfRingMap repo. Nothing is bundled with or served by ' +
  'this site — art is loaded into your browser only. Card/board art © Ares Games; map by SirMartin.';

const DB_NAME = 'wotr-card-art';
const STORE = 'images';
const META_KEY = '__meta__';

export interface ArtMeta { loadedAt: string; cardCount: number; totalBytes: number }

// ---------- IndexedDB plumbing ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}
async function dbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbClear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbKeys(): Promise<string[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result as string[]);
    r.onerror = () => reject(r.error);
  });
}

// ---------- download + slice ----------

export type DownloadProgress = { phase: 'fetching' | 'slicing' | 'done'; sheetsDone: number; sheetsTotal: number; cardsDone: number; cardsTotal: number };

function cropToBlob(bmp: ImageBitmap, r: RegionRect): Promise<Blob> {
  const sx = Math.round(r[0] * bmp.width), sy = Math.round(r[1] * bmp.height);
  const sw = Math.max(1, Math.round(r[2] * bmp.width)), sh = Math.max(1, Math.round(r[3] * bmp.height));
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(sw, sh)
    : Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  const ctx = (canvas as any).getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  if ('convertToBlob' in canvas) return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality: 0.9 });
  return new Promise((resolve, reject) =>
    (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 0.9));
}

/** Fetch each referenced sheet once, slice every card out of it, persist the
 *  per-card webp blobs to IndexedDB. Reports progress so the UI can show a bar.
 *  Throws on a hard failure (network/CORS); partial progress is preserved. */
export async function downloadAllArt(onProgress?: (p: DownloadProgress) => void): Promise<ArtMeta> {
  const bySheet = new Map<string, CardMeta[]>();
  for (const c of CARDS) (bySheet.get(c.sheetId) ?? bySheet.set(c.sheetId, []).get(c.sheetId)!).push(c);
  const sheetIds = [...bySheet.keys()];

  let sheetsDone = 0, cardsDone = 0, totalBytes = 0;
  const report = (phase: DownloadProgress['phase']) =>
    onProgress?.({ phase, sheetsDone, sheetsTotal: sheetIds.length, cardsDone, cardsTotal: CARDS.length });

  for (const sheetId of sheetIds) {
    const sheet = SHEETS[sheetId];
    if (!sheet) { sheetsDone++; continue; }
    report('fetching');
    const resp = await fetch(sheet.url, { headers: { Accept: 'image/*' } });
    if (!resp.ok) throw new Error(`Sheet ${sheetId} fetch failed: HTTP ${resp.status}`);
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    report('slicing');
    for (const card of bySheet.get(sheetId)!) {
      const out = await cropToBlob(bmp, card.region);
      totalBytes += out.size;
      await dbPut(card.id, out);
      cardsDone++;
    }
    bmp.close();
    sheetsDone++;
    report('slicing');
  }

  // Board map (single image, no slicing) — fetched from SirMartin/WarOfRingMap.
  report('fetching');
  try {
    const bResp = await fetch(BOARD_URL, { headers: { Accept: 'image/*' } });
    if (bResp.ok) {
      const bBlob = await bResp.blob();
      totalBytes += bBlob.size;
      await dbPut(BOARD_ID, bBlob);
    }
  } catch { /* board is optional; cards still usable without it */ }

  const meta: ArtMeta = { loadedAt: new Date().toISOString(), cardCount: cardsDone, totalBytes };
  await dbPut(META_KEY, meta);
  report('done');
  notifyArtChanged();
  return meta;
}

/** True if the board map image is already cached (separate from cards, since it
 *  was added after the initial card-only release — lets us offer an "add board"
 *  path to players who downloaded before this feature shipped). */
export async function hasBoardArt(): Promise<boolean> {
  try { return !!(await dbGet<Blob>(BOARD_ID)); } catch { return false; }
}

/** Fetch + cache just the board map (no card re-slicing). */
export async function downloadBoardArt(): Promise<void> {
  const resp = await fetch(BOARD_URL, { headers: { Accept: 'image/*' } });
  if (!resp.ok) throw new Error(`Board map fetch failed: HTTP ${resp.status}`);
  const blob = await resp.blob();
  await dbPut(BOARD_ID, blob);
  const meta = await dbGet<ArtMeta>(META_KEY);
  if (meta) await dbPut(META_KEY, { ...meta, totalBytes: meta.totalBytes + blob.size });
  notifyArtChanged();
}

export async function getArtMeta(): Promise<ArtMeta | null> {
  try {
    const m = await dbGet<ArtMeta>(META_KEY);
    if (!m || !m.cardCount) return null;
    return m;
  } catch { return null; }
}

export async function clearArt(): Promise<void> {
  await dbClear();
  for (const url of blobUrlCache.values()) if (url) URL.revokeObjectURL(url);
  blobUrlCache.clear();
  notifyArtChanged();
}

// ---------- in-memory blob: URL cache + React hooks ----------

const blobUrlCache = new Map<string, string | null>(); // null = known missing
const pending = new Map<string, Promise<string | null>>();

async function resolveUrl(cardId: string): Promise<string | null> {
  if (blobUrlCache.has(cardId)) return blobUrlCache.get(cardId) ?? null;
  const inflight = pending.get(cardId);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const blob = await dbGet<Blob>(cardId);
      const url = blob ? URL.createObjectURL(blob) : null;
      blobUrlCache.set(cardId, url);
      return url;
    } catch { blobUrlCache.set(cardId, null); return null; }
    finally { pending.delete(cardId); }
  })();
  pending.set(cardId, p);
  return p;
}

/** Preload every cached card into an in-memory blob: URL so useCardArt resolves
 *  synchronously after boot. Returns the count loaded. */
export async function preloadAllArt(): Promise<number> {
  for (const url of blobUrlCache.values()) if (url) URL.revokeObjectURL(url);
  blobUrlCache.clear();
  let n = 0;
  for (const key of await dbKeys()) {
    if (key === META_KEY) continue;
    try {
      const blob = await dbGet<Blob>(key);
      if (blob) { blobUrlCache.set(key, URL.createObjectURL(blob)); n++; }
    } catch { /* skip */ }
  }
  return n;
}

import { useEffect, useState } from 'react';

/** blob: URL for a card id, or null while pending / not downloaded. */
export function useCardArt(cardId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => (cardId ? blobUrlCache.get(cardId) ?? null : null));
  useEffect(() => {
    if (!cardId) { setUrl(null); return; }
    if (blobUrlCache.has(cardId)) { setUrl(blobUrlCache.get(cardId) ?? null); return; }
    let cancelled = false;
    resolveUrl(cardId).then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [cardId]);
  return url;
}

/** blob: URL for the cached board map image, or null if not downloaded. */
export function useBoardArt(): string | null { return useCardArt(BOARD_ID); }

const ART_EVENT = 'wotr-art-changed';
export function notifyArtChanged(): void { window.dispatchEvent(new CustomEvent(ART_EVENT)); }

export function useArtLoaded(): { loaded: boolean; meta: ArtMeta | null; hasBoard: boolean } {
  const [s, setS] = useState<{ loaded: boolean; meta: ArtMeta | null; hasBoard: boolean }>({ loaded: false, meta: null, hasBoard: false });
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const meta = await getArtMeta();
      if (cancelled) return;
      if (meta) await preloadAllArt();
      const hasBoard = await hasBoardArt();
      if (!cancelled) setS({ loaded: !!meta, meta, hasBoard });
    };
    refresh();
    const h = () => refresh();
    window.addEventListener(ART_EVENT, h);
    return () => { cancelled = true; window.removeEventListener(ART_EVENT, h); };
  }, []);
  return s;
}
