// Headless verification for the "while you waited" (TurnSummary) marker fix.
// Bug: oppLogStart was a FULL-log index but the view's log is REDACTED, so the
// marker could point PAST the end of view.log -> summary shows nothing.
// Invariant under test: for every snapshot the human sees, oppLogStart is a valid
// index into the (redacted) view.log, i.e. 0 <= oppLogStart <= view.log.length.
import { makeLocalClient } from '../src/online/localClient.ts';

const TurnSummaryWouldShow = (view) => {
  const start = view.oppLogStart;
  const items = (typeof start === 'number' && view.log.length > start) ? view.log.slice(start) : [];
  return { start, logLen: view.log.length, items: items.length };
};

let checked = 0, violations = 0, popupsShown = 0, oppActionsSeen = 0;
for (let seed = 1; seed <= 12; seed++) {
  const client = makeLocalClient(seed, { aiSide: 'shadow' }); // human = FP
  let res = await client.fetch();
  let guard = 0;
  while (!res.gameOver && res.turn <= 4 && guard++ < 400) {
    const v = res.view;
    // Invariant: marker must be within the redacted log the UI slices.
    checked++;
    if (typeof v.oppLogStart === 'number' && (v.oppLogStart < 0 || v.oppLogStart > v.log.length)) {
      violations++;
      if (violations <= 5) console.log(`  VIOLATION seed${seed} turn${v.turn}: oppLogStart=${v.oppLogStart} > logLen=${v.log.length}`);
    }
    // When it's the human's turn and the opponent did public things since, the popup should show.
    if (res.yourTurn) {
      const s = TurnSummaryWouldShow(v);
      if (s.items > 0) popupsShown++;
    }
    const legal = await client.legalActions();
    if (legal.length === 0) break;
    const before = v.log.length;
    res = await client.submit(legal[0]);
    if (res.view.log.length > before) oppActionsSeen++;
  }
}
console.log(`checked=${checked} snapshots, marker violations=${violations}, human-turn popups-that-would-show=${popupsShown}`);
console.log(violations === 0 ? 'PASS: oppLogStart always within redacted view.log' : 'FAIL: marker out of range');
process.exit(violations === 0 && popupsShown > 0 ? 0 : 1);
