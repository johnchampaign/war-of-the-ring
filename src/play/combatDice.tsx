// The combat dice, drawn as dice — a hit in gold, a miss in dark. Shared by the
// battle MODAL (live, round by round) and the end-of-battle summary, because the
// reporter of 2p2w0k6c5m2p6z4n was right that one of them had the good display and
// the other had "super tiny text": "How about if we replace the existing Combat roll
// info in the modal with the (superior) Battle summary one".

export type Roll = { dice: number[]; rerolls: number[]; target: number; rerollTarget?: number };

// A combat die: a hit is a 6, or ≥ the to-hit target (never a 1).
export function CDie({ n, target }: { n: number; target: number }) {
  const hit = n === 6 || (n !== 1 && n >= target);
  return (
    <span style={{
      display: 'inline-grid', placeItems: 'center', width: 22, height: 22, margin: '0 2px',
      borderRadius: 4, fontSize: 13, fontWeight: 700,
      background: hit ? '#caa84b' : '#2a2418', color: hit ? '#1a1408' : '#b9b09a',
      border: `1px solid ${hit ? '#e6c869' : '#4a4332'}`,
    }}>{n}</span>
  );
}

export function RollRow({ label, roll, color }: { label: string; roll?: Roll; color: string }) {
  if (!roll || (roll.dice.length === 0 && roll.rerolls.length === 0)) return null;
  // A Combat card can bonus the Combat roll and the Leader re-roll separately, so
  // the re-roll may hit on a different number — label it when it differs.
  const rt = roll.rerollTarget ?? roll.target;
  return (
    <div style={{ margin: '3px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
      <span style={{ width: 64, fontSize: 12, color }}>{label}</span>
      <span style={{ fontSize: 11, color: '#887', marginRight: 4 }}>(hits {roll.target}+)</span>
      {roll.dice.map((n, i) => <CDie key={i} n={n} target={roll.target} />)}
      {roll.rerolls.length > 0 && <span style={{ color: '#887', margin: '0 4px', fontSize: 11 }}>re-roll{rt !== roll.target ? ` (${rt}+)` : ''}</span>}
      {roll.rerolls.map((n, i) => <CDie key={`r${i}`} n={n} target={rt} />)}
    </div>
  );
}

