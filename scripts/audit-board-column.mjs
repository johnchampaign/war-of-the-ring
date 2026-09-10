#!/usr/bin/env node
// audit-board-column.mjs — enforce the ONE invariant that keeps the map from jumping.
//
// The board's box must be the ONLY flow child of the board column. Anything that
// appears and disappears — a hint line, a refusal warning, a card rider, an error
// banner — has to be absolutely positioned INSIDE that box, or it steals height from
// the board and the whole map visibly shrinks and re-grows as the message comes and
// goes.
//
// This has now been reported four separate times (4s0g, then the follow-ups
// 2a5x360h324z5z0s / 4e636e723e532m5p / 561d44030f1l3m6s), each time because a new
// banner was added as a flow sibling. The rule is invisible in the source unless you
// already know it, so it is checked here instead of being re-learned from a report.
//
// Deliberately narrow: it counts direct <div> children of the board column and does
// not try to be a JSX parser. If the column's markup is restructured, update the two
// anchors below — a failure here is "look at the board column", not "the sky is falling".

import { readFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// An explicit path argument is for this script's own self-test (feed it a mutated
// copy and check that it FAILS); normal runs take the default.
const FILE = process.argv[2] ?? join('src', 'play', 'PlayPage.tsx');
const src = readFileSync(isAbsolute(FILE) ? FILE : join(repoRoot, FILE), 'utf8');

// Anchors: the board column's opening tag, and the board box's own style signature.
const COLUMN_ANCHOR = "width: 'min(74vw";
const BOARD_BOX_ANCHOR = "position: 'relative'";

const fail = (msg) => {
  console.error(`[FAIL] ${FILE}: ${msg}`);
  process.exit(1);
};

const colAt = src.indexOf(COLUMN_ANCHOR);
if (colAt < 0) fail(`can't find the board column (looked for \`${COLUMN_ANCHOR}\`)`);
// Step past the column's own opening tag.
const bodyStart = src.indexOf('>', src.indexOf('}}', colAt)) + 1;

// Walk <div>/</div> only: every element in this column is a div except the
// self-closing <Board />, which never changes the depth.
const children = [];
let depth = 0, i = bodyStart, openedAt = -1;
const tag = /<\/?div\b/g;
tag.lastIndex = bodyStart;
for (let m; (m = tag.exec(src)); ) {
  const closing = src[m.index + 1] === '/';
  if (!closing) {
    if (depth === 0) openedAt = m.index;
    depth++;
  } else {
    depth--;
    if (depth === 0) children.push(src.slice(openedAt, m.index));
    if (depth < 0) { i = m.index; break; }   // this </div> closes the column itself
  }
}
if (depth >= 0) fail('never found the board column’s closing </div> — unbalanced markup?');

if (children.length !== 1) {
  fail(
    `the board column has ${children.length} flow children; it must have exactly ONE (the board's box).\n` +
    '       Anything that appears/disappears must be absolutely positioned inside that box,\n' +
    '       or it steals height from the map and the board shrinks and re-grows.\n' +
    '       Offending children start:\n' +
    children.map((c, n) => `         [${n}] ${c.slice(0, 110).replace(/\s+/g, ' ')}…`).join('\n'),
  );
}

const box = children[0];
if (!box.includes('<Board ')) fail('the board column’s only flow child does not contain <Board /> — anchors are stale');
if (!box.includes(BOARD_BOX_ANCHOR)) fail('the board’s box is not position:relative, so its overlays would escape it');

// Every conditional banner inside the box must be taken out of the flow.
const absolutes = (box.match(/position: 'absolute'/g) ?? []).length;
if (absolutes < 1) fail('no absolutely positioned overlay found inside the board box');

console.log(
  `[PASS] board column: 1 flow child (the board box), ${absolutes} absolute overlay(s) inside it.`,
);
console.log('Board-column audit OK — nothing that appears/disappears can resize the map.');
