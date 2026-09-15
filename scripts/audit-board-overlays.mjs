#!/usr/bin/env node
// audit-board-overlays.mjs — nothing drawn OVER the map regions may swallow a click.
//
// Region click-targets are the <g onClick> groups built from regionEls. Anything the
// Board draws AFTER them sits on top and wins the hit-test, so it must either be
// pointer-transparent (pointerEvents: 'none') or hand the click on to a region.
// Tokens rendered INSIDE a region group are fine (their clicks bubble to it).
//
// The Fellowship marker broke this: drawn after the regions with no handler, it sat
// on the centre of Rivendell — where the Fellowship starts and where Kindred of
// Glorfindel recruits — so the obvious click did nothing and a player could not go on
// (report 1v2i0j6o2l2d4917, "Cant continue Play").
//
// Deliberately narrow, like audit-board-column: it checks the top-level JSX children
// of the Board's <svg> after the region groups, by text. If the markup is restructured,
// update the anchors — a failure means "look at what is drawn over the regions".
//
// Self-test: `node scripts/audit-board-overlays.mjs --self-test` feeds it a copy with
// the marker's forwarding removed and expects a failure.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = join(repoRoot, 'src/play/Board.tsx');

function audit(src) {
  const problems = [];
  const svgStart = src.indexOf('<svg ref={svgRef}');
  const svgEnd = src.indexOf('</svg>', svgStart);
  if (svgStart < 0 || svgEnd < 0) return ['anchor missing: the Board <svg ref={svgRef}> … </svg> block'];
  const svg = src.slice(svgStart, svgEnd);
  const regionsAt = svg.indexOf('{regionEls.map((e) => e && (');
  if (regionsAt < 0) return ['anchor missing: the region groups ({regionEls.map((e) => e && ( …)'];
  // Walk to the end of the region-group map by bracket depth from its opening "{".
  let depth = 0, i = regionsAt;
  for (; i < svg.length; i++) {
    if (svg[i] === '{') depth++;
    else if (svg[i] === '}') { depth--; if (depth === 0) break; }
  }
  const after = svg.slice(i + 1);
  // Top-level overlay elements after the regions: each `{cond && (<g …>` / `<Component …/>`.
  // Collect every opening tag at JSX nesting depth 0 of `after`.
  const tags = [];
  let d = 0, braces = 0;
  for (let k = 0; k < after.length; k++) {
    const c = after[k];
    if (c === '{') braces++;
    else if (c === '}') braces--;
    if (c === '<' && after[k + 1] !== '/' && after[k + 1] !== '!' && /[A-Za-z]/.test(after[k + 1] ?? '')) {
      // Opening tag: read to its end.
      let j = k, q = 0;
      for (; j < after.length; j++) { if (after[j] === '{') q++; else if (after[j] === '}') q--; else if (after[j] === '>' && q === 0) break; }
      const tag = after.slice(k, j + 1);
      if (d === 0) tags.push(tag);
      if (!tag.endsWith('/>')) d++;
      k = j;
    } else if (c === '<' && after[k + 1] === '/') {
      d--;
      while (k < after.length && after[k] !== '>') k++;
    }
  }
  if (tags.length === 0) problems.push('found no overlay elements after the region groups — anchors are probably stale');
  for (const tag of tags) {
    const name = tag.match(/^<([A-Za-z]+)/)?.[1] ?? '?';
    const transparent = /pointerEvents:\s*'none'/.test(tag);
    const forwards = /onClick=|onPick=/.test(tag);
    if (!transparent && !forwards) problems.push(`<${name}> is drawn over the regions but neither sets pointerEvents: 'none' nor forwards clicks: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  // The marker component must actually forward: its root <g> handles the click.
  const fm = src.indexOf('function FellowshipMarker(');
  if (fm < 0) problems.push('anchor missing: function FellowshipMarker(');
  else {
    const body = src.slice(fm, src.indexOf('\n}\n', fm));
    if (!/<g onClick=\{\(\) => onPick\?\.\(fs\.location\)\}/.test(body)) problems.push('FellowshipMarker no longer forwards its click to its region (onClick={() => onPick?.(fs.location)})');
  }
  return { problems, overlays: tags.map((t) => t.match(/^<([A-Za-z]+)/)?.[1]) };
}

const src = readFileSync(BOARD, 'utf8');
if (process.argv.includes('--self-test')) {
  const broken = src.replace(/<FellowshipMarker view=\{view\} onPick=\{pickRegion\}[\s\S]*?\/>/, '<FellowshipMarker view={view} />')
    .replace('<g onClick={() => onPick?.(fs.location)}', '<g');
  const r = audit(broken);
  const failed = Array.isArray(r) ? r.length > 0 : r.problems.length > 0;
  console.log(failed ? 'self-test ok — the broken copy fails' : 'SELF-TEST FAILED — the broken copy passed');
  process.exit(failed ? 0 : 1);
}
const r = audit(src);
const problems = Array.isArray(r) ? r : r.problems;
if (!Array.isArray(r)) console.log(`board overlays checked: ${r.overlays.join(', ')}`);
if (problems.length) { for (const p of problems) console.log(`FAIL ${p}`); process.exit(1); }
console.log('board overlays OK — nothing drawn over the regions swallows a click');
