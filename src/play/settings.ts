// Player display settings (⚙ in the status bar). Where players genuinely disagree about
// presentation, John picks the default and the alternative becomes a setting (standing
// decision 2026-10-11, docs/standing-decisions.md). Display only: no setting may change
// what is legal, what is hidden from the opponent, or how the AI plays. Kept per browser
// (localStorage); online, each player sees their own choices. A non-default choice rides
// along on problem reports and uploaded logs, so triage can tell a setting from a bug.
import { useSyncExternalStore } from 'react';

export interface Settings {
  /** Dashed rings on the regions bordering the one under the pointer. */
  reachRings: 'on' | 'polygonOnly' | 'off';
  /** The always-visible side log: the last two turns, or the whole game. */
  sideLog: 'recent' | 'all';
  /** The "While you waited" catch-up when control comes back to you. */
  recap: 'show' | 'skip';
}

export const DEFAULT_SETTINGS: Settings = { reachRings: 'on', sideLog: 'recent', recap: 'show' };

/** What the panel offers, in order: each setting's label, a line of explanation, and its
 *  choices (the first is always the default). */
export const SETTING_CHOICES: { [K in keyof Settings]: { label: string; hint: string; options: { value: Settings[K]; label: string }[] } } = {
  reachRings: {
    label: 'Border rings on hover',
    hint: 'Dashed rings around every region that borders the one under the pointer — a region left unringed is behind an impassable border.',
    options: [
      { value: 'on', label: 'Always' },
      { value: 'polygonOnly', label: 'Only on the plain map (the board art shows the borders)' },
      { value: 'off', label: 'Never' },
    ],
  },
  sideLog: {
    label: 'Side log',
    hint: 'The log beside the board. The 📜 Log button always has the whole game.',
    options: [
      { value: 'recent', label: 'The last two turns' },
      { value: 'all', label: 'The whole game' },
    ],
  },
  recap: {
    label: '“While you waited” summary',
    hint: 'The pop-up listing what happened since you last had a move.',
    options: [
      { value: 'show', label: 'Show it' },
      { value: 'skip', label: 'Skip it (the log still has everything)' },
    ],
  },
};

const KEY = 'wotr.settings.v1';
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof Settings, unknown>>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (SETTING_CHOICES[k].options.some((o) => o.value === raw[k])) (out as Record<string, unknown>)[k] = raw[k];
    }
    return out;
  } catch { return { ...DEFAULT_SETTINGS }; }
}

let current: Settings = load();

export function getSettings(): Settings { return current; }

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  current = { ...current, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* storage unavailable: this session only */ }
  for (const l of listeners) l();
}

export function resetSettings(): void {
  current = { ...DEFAULT_SETTINGS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  for (const l of listeners) l();
}

/** The current settings; re-renders the caller whenever one changes. */
export function useSettings(): Settings {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getSettings, getSettings);
}

/** The non-default choices as a hidden marker for problem reports / uploaded logs
 *  ('' when everything is at its default). */
export function settingsMarker(): string {
  const changed = (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).filter((k) => current[k] !== DEFAULT_SETTINGS[k]);
  return changed.length ? `\n<!-- settings:${changed.map((k) => `${k}=${current[k]}`).join(',')} -->` : '';
}
