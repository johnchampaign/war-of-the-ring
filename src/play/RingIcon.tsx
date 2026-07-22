// The One Ring, drawn rather than emoji'd. 💍 renders on every platform as a
// diamond ENGAGEMENT ring (player report: "could it be a more appropriate gold
// ring?"), which is both wrong and hard to read at token size. This is a plain
// gold band: dark rim for contrast against the map, warm gold body, and a thin
// highlight arc so it reads as metal at 12px.

/** Ring drawn in SVG user space — for use inside the board <svg>. */
export function RingGlyph({ cx, cy, r = 6 }: { cx: number; cy: number; r?: number }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#5c4208" strokeWidth={r * 0.68} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e3bf47" strokeWidth={r * 0.44} />
      <path d={`M ${cx - r * 0.72} ${cy - r * 0.5} A ${r} ${r} 0 0 1 ${cx + r * 0.1} ${cy - r * 0.98}`}
        fill="none" stroke="#fff2c0" strokeWidth={r * 0.14} strokeLinecap="round" opacity={0.85} />
    </g>
  );
}

/** Standalone ring for HTML contexts (panels, legends). */
export function RingIcon({ size = 16, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ display: 'block' }} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <RingGlyph cx={10} cy={10} r={7} />
    </svg>
  );
}
