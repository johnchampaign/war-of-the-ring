// "Report a problem" — a small floating button + modal that submits a bug /
// rules-question / feedback report through the client's report() (server-stored
// via the framework; hotseat returns a local id). The thank-you copy is written
// for the reporter: owning it, and making clear the habit of reporting is what
// matters. Captures the build id so a report ties back to a deploy.
import { useState } from 'react';

type Sev = 'bug' | 'rules-question' | 'feedback';

export function ReportButton({ report, clientBuild }: {
  report: (b: { message: string; severity?: 'bug' | 'rules-question' | 'feedback'; category?: string; clientBuild?: string }) => Promise<{ reportId: string }>;
  clientBuild?: string;
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [sev, setSev] = useState<Sev>('bug');
  const [busy, setBusy] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!msg.trim()) return;
    setBusy(true); setErr(null);
    try {
      // Distinct category so the shared Supabase project's report queue can be
      // filtered to this game (Axis & Allies / Tyrants / … share the table).
      const r = await report({ message: msg.trim(), severity: sev, category: 'wotr', clientBuild });
      // Only confirm on a real, server-issued id — never show a false "thank you".
      if (!r?.reportId) throw new Error("Couldn't save the report. Please try again.");
      setSentId(r.reportId);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const close = () => { setOpen(false); setMsg(''); setSentId(null); setErr(null); setSev('bug'); };

  if (!open) {
    return <button onClick={() => setOpen(true)} style={fab} title="Report a problem or share feedback">⚑ Report</button>;
  }

  return (
    <div style={backdrop} onClick={close}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        {sentId ? (
          <>
            <h3 style={{ margin: '0 0 8px' }}>Thank you — truly.</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>
              That's in our hands now. People who take a moment to flag what's wrong are exactly
              how this game gets better — please keep doing it whenever something feels off.
            </p>
            <button onClick={close} style={primary}>Close</button>
          </>
        ) : (
          <>
            <h3 style={{ margin: '0 0 8px' }}>Report a problem</h3>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['bug', 'rules-question', 'feedback'] as Sev[]).map((s) => (
                <button key={s} onClick={() => setSev(s)} style={{ ...chip, ...(sev === s ? chipOn : {}) }}>
                  {s === 'bug' ? 'Bug' : s === 'rules-question' ? 'Rules?' : 'Feedback'}
                </button>
              ))}
            </div>
            <textarea autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} rows={5}
              placeholder="What happened? What did you expect? The more detail, the better."
              style={textarea} />
            {err && <div style={{ color: '#e98', fontSize: 12, margin: '4px 0' }}>⚠ {err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={submit} disabled={busy || !msg.trim()} style={primary}>{busy ? 'Sending…' : 'Send report'}</button>
              <button onClick={close} style={ghost}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const fab: React.CSSProperties = { position: 'fixed', bottom: 10, right: 10, zIndex: 40, padding: '6px 12px', fontSize: 13, background: '#3a3326', color: '#f0e9d8', border: '1px solid #5a4a2a', borderRadius: 18, cursor: 'pointer', boxShadow: '0 2px 8px #0008' };
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.7)', display: 'grid', placeItems: 'center', zIndex: 70 };
const modal: React.CSSProperties = { background: '#211c14', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 12, border: '1px solid #5a4a2a', width: 420, maxWidth: '90vw', boxShadow: '0 8px 40px #000' };
const textarea: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#14110b', color: '#f0e9d8', border: '1px solid #443', borderRadius: 6, padding: 8, fontSize: 13, fontFamily: 'system-ui', resize: 'vertical' };
const chip: React.CSSProperties = { padding: '4px 10px', fontSize: 12, background: '#2a2418', color: '#bba', border: '1px solid #443', borderRadius: 14, cursor: 'pointer' };
const chipOn: React.CSSProperties = { background: '#7a5230', color: '#fff', borderColor: '#7a5230' };
const primary: React.CSSProperties = { padding: '8px 14px', fontSize: 14, background: '#2f4f9e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' };
const ghost: React.CSSProperties = { padding: '8px 14px', fontSize: 14, background: 'transparent', color: '#a98', border: '1px solid #553', borderRadius: 6, cursor: 'pointer' };
