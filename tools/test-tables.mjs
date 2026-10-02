/**
 * ============================================================================
 * test-tables.mjs — does the colour in a table mean anything?
 * ============================================================================
 *
 *   npm run test:tables
 *
 * WHY THIS EXISTS
 *
 * Every tinted cell in the weekly report was shaded with
 *
 *     alpha = 0.36 - 0.20 * rank          (ranks sorted ascending)
 *
 * so the STRONGEST tint fell on the SMALLEST number, in three separate
 * tables. Intensity is the one thing a tint can say, and it was saying the
 * opposite of the truth everywhere it appeared. Nothing caught it because
 * nothing was looking: a wrong colour renders perfectly.
 *
 * In the benchmark table the rank was also taken across the current week, the
 * US figure, the benchmark and the previous week - four quantities that do
 * not share a scale - so even the right way up it would have said nothing.
 *
 * WHAT IS CHECKED
 *
 *   1. rowHtml paints no backgrounds at all, and emits six columns not eight
 *   2. the change is coloured, and in the right direction
 *   3. no descending alpha ramp survives anywhere in the file
 *
 * The third is a text check rather than a behavioural one, and it is here
 * deliberately: the ramp appears in three places built three different ways,
 * and the thing they have in common is the shape of the arithmetic.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'reports/weekly/weekly.legacy.js'), 'utf8');

/* The real rowHtml, lifted out of the shipped file by brace matching rather
   than copied, for the usual reason: a copy keeps passing after the shipped
   one has drifted. */
function lift(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} is not in the file`);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`${name} never closes`);
}

const STUBS = `
  const finite = (v) => typeof v === 'number' && isFinite(v);
  const num = (v, d) => (finite(v) ? v.toFixed(d === undefined ? 2 : d) : '--');
  const money = (v, d) => '$' + num(v, d === undefined ? 2 : d);
  const change = (a, b) => (finite(a) && finite(b) && b !== 0 ? (a - b) / b : null);
`;

const rowHtml = new Function(STUBS + lift('rowHtml') + '\nreturn rowHtml;')();

/* The same formatter, for the caller's side of the call. */
const num = (v, d) =>
  (typeof v === 'number' && isFinite(v) ? v.toFixed(d === undefined ? 2 : d) : '--');

let bad = 0, n = 0;
const ok = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

/* actual 70.2, US 60.3, bench 80.0, previous 69.8 — the row in the report. */
const row = rowHtml('Viewer Rate', 70.2, 60.3, 80.0, 69.8, (v) => num(v, 1));
const cells = (row.match(/<td\b/g) || []).length;

ok('a row is six cells, not eight', cells, 5);   // metric + 4; '#' is added later
ok('no cell paints a background', /background\s*:/.test(row), false);
ok('the metric name is there', row.includes('Viewer Rate'), true);
ok('the benchmark value is in the same cell as its change',
   /80\.0[\s\S]{0,80}cmp-d/.test(row), true);

/* 70.2 against a bench of 80.0 is a fall; against 69.8 last week, a rise. */
ok('below the benchmark reads as down', /cmp-d down">-12%/.test(row), true);
ok('above last week reads as up',       /cmp-d up">\+1%/.test(row), true);

/* A missing benchmark must say so rather than draw a zero. */
const noBench = rowHtml('Imp/DAU', 53.23, 78, null, 48.52, (v) => num(v, 2));
ok('a missing benchmark says no comp', noBench.includes('cmp-d none">no comp'), true);
ok('a missing benchmark still shows last week',
   /cmp-d up">\+10%/.test(noBench), true);

/* ---- and the ramp that was upside down in three places ----------------- */
/* Comments stripped first. The first run of this check failed on the comments
   written to explain the fix - they quote the old formula - which is a text
   check doing exactly what text checks do. Code only. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const descending = code.match(/0\.36\s*-\s*0\.20\s*\*/g) || [];
ok('no descending alpha ramp is left', descending.length, 0);

/* The one tint that survives is a real magnitude encoding, so it must rise. */
const ramp = code.match(/\(0\.12\s*\+\s*0\.24\s*\*\s*\w+\)/g) || [];
ok('the tint that remains rises with the value', ramp.length >= 2, true);

console.log(bad ? `\n  ${bad} of ${n} FAILED\n` : `\n  tables: all ${n} passed\n`);
process.exit(bad ? 1 : 0);
