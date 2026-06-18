// A stable per-device reporter ID. It's embedded as an HTML-comment marker in
// every problem-report message (invisible to the reader) so /api/my-responses can
// tie our resolution note back to the device that filed the report — and surface
// it in a "reply to your report" popup on a later visit. Mirrors Star Wars
// Rebellion's reporter-id / seen-responses pattern, adapted to dbf_reports.
const LS_REPORTER_ID = 'wotr-reporter-id';
const LS_SEEN_RESPONSES = 'wotr-seen-responses';
const MARKER = /\n*<!-- reporter:[a-zA-Z0-9-]{4,64} -->/g;

/** Get (or first-time generate) this device's stable reporter ID. '' if storage
 *  is unavailable — callers then simply skip the reporter wiring. */
export function getReporterId(): string {
  try {
    let id = localStorage.getItem(LS_REPORTER_ID);
    if (!id || !/^[a-zA-Z0-9-]{4,64}$/.test(id)) {
      id = `r-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`.slice(0, 48);
      localStorage.setItem(LS_REPORTER_ID, id);
    }
    return id;
  } catch { return ''; }
}

/** The marker appended to a report message so the server can find this reporter's
 *  reports later. Empty (no marker) when storage is unavailable. */
export function reporterMarker(): string {
  const id = getReporterId();
  return id ? `\n\n<!-- reporter:${id} -->` : '';
}

/** Strip the reporter marker from a message for display. */
export const stripReporterMarker = (msg: string): string => msg.replace(MARKER, '').trim();

export function getSeenResponses(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(LS_SEEN_RESPONSES) || '[]')); } catch { return new Set(); }
}
export function markResponseSeen(reportId: string): void {
  try {
    const s = getSeenResponses();
    s.add(reportId);
    localStorage.setItem(LS_SEEN_RESPONSES, JSON.stringify([...s]));
  } catch { /* storage full/disabled — it'll just pop again next load */ }
}
