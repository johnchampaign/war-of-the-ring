// "Reply to your problem report" — shown on app load when a report this device
// filed has been resolved with a note (fetched from /api/my-responses, gated by
// the seen-responses set so each reply pops exactly once). The reply copy is
// written for the reporter; this just frames it and echoes their original words.
export function ReportResponseModal({ notice, onDismiss }: {
  notice: { reportId: string; message: string; response: string };
  onDismiss: () => void;
}) {
  return (
    <div style={backdrop} onClick={onDismiss}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 12, color: '#e6b85a', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Reply to your problem report
        </div>
        {notice.message && (
          <div style={{ fontSize: 13, color: '#998', marginBottom: 14, fontStyle: 'italic' }}>
            “{notice.message}”
          </div>
        )}
        <div style={{ fontSize: 14, color: '#ece4d2', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 16 }}>
          {notice.response}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onDismiss} style={btn}>Thanks</button>
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.78)', display: 'grid', placeItems: 'center', zIndex: 80 };
const modal: React.CSSProperties = { background: '#211c14', color: '#eee', fontFamily: 'system-ui', padding: 22, borderRadius: 12, border: '1px solid #7a5f24', width: 460, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 8px 40px #000' };
const btn: React.CSSProperties = { padding: '8px 18px', fontSize: 14, fontWeight: 700, background: '#2f4f9e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' };
