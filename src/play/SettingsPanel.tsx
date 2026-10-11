// The ⚙ Settings panel: the display choices players disagree about (see settings.ts).
import { useState } from 'react';
import { DEFAULT_SETTINGS, SETTING_CHOICES, resetSettings, setSetting, useSettings, type Settings } from './settings';

export function SettingsButton({ style }: { style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* The gear alone, so the status bar's control row still fits on one line. */}
      <button onClick={() => setOpen(true)} title="Settings — how the board and panels look for you" aria-label="Settings"
        style={{ ...style, cursor: 'pointer', background: '#33302a', color: '#e9e1cc', border: '1px solid #5a4a2a', padding: '3px 8px' }}>⚙</button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const keys = Object.keys(SETTING_CHOICES) as (keyof Settings)[];
  const changed = keys.some((k) => s[k] !== DEFAULT_SETTINGS[k]);
  return (
    <div onClick={onClose} style={backdrop}>
      <div onClick={(e) => e.stopPropagation()} style={card} data-testid="settings-panel">
        <div style={{ fontSize: 14, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 2 }}>Settings</div>
        <div style={{ fontSize: 11, color: '#998', marginBottom: 10 }}>How the game looks for you, on this device. They never change the rules or what your opponent sees.</div>
        {keys.map((k) => {
          const c = SETTING_CHOICES[k];
          return (
            <fieldset key={k} style={{ border: '1px solid #3a3326', borderRadius: 8, padding: '6px 10px 8px', margin: '0 0 8px' }}>
              <legend style={{ fontSize: 13, fontWeight: 700, color: '#e9e1cc', padding: '0 4px' }}>{c.label}</legend>
              <div style={{ fontSize: 11, color: '#998', marginBottom: 4 }}>{c.hint}</div>
              {c.options.map((o) => (
                <label key={String(o.value)} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 13, padding: '2px 0', cursor: 'pointer' }}>
                  <input type="radio" name={`setting-${k}`} checked={s[k] === o.value}
                    onChange={() => setSetting(k, o.value as never)} />
                  <span>{o.label}{o.value === DEFAULT_SETTINGS[k] ? <span style={{ color: '#776' }}> (default)</span> : null}</span>
                </label>
              ))}
            </fieldset>
          );
        })}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          {changed && <button onClick={resetSettings} style={btn}>Reset to defaults</button>}
          <button onClick={onClose} style={{ ...btn, borderColor: '#6a5' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.62)', display: 'grid', placeItems: 'center', zIndex: 82 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '14px 18px', borderRadius: 12, border: '1px solid #5a4a2a', width: 'min(440px, 94vw)', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 8px 40px #000' };
const btn: React.CSSProperties = { padding: '6px 14px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', borderRadius: 6, cursor: 'pointer', fontSize: 13 };
