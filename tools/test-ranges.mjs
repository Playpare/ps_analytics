/**
 * ============================================================================
 * test-ranges.mjs — does a range stop at the last finished day?
 * ============================================================================
 *
 *   npm run test:ranges
 *
 * The functions are lifted out of the shipped file rather than copied, for the
 * same reason as every other test here: a copy keeps passing after the
 * original has drifted.
 *
 * WHY THIS EXISTS
 *
 * Every preset ended at sheetToday(). "Last 14 days" meant today-13 .. today,
 * and today is a part-day: whatever hours of it had been synced were drawn as
 * the day's total. Nothing on the screen said the last bar was incomplete, and
 * it changed by itself overnight.
 *
 * It was not only the last bar. The totals, the averages and every
 * week-over-week comparison were measured over a window with that hole in it.
 *
 * mxDates had stepped back a day for exactly this reason since it was written,
 * in exactly one place - so the idea was already in the file, used once. This
 * checks it now holds everywhere.
 *
 * WHAT IS CHECKED
 *
 *   1. dataThrough() is the day before sheetToday(), across month and year ends
 *   2. a preset window is the right LENGTH and ends at dataThrough()
 *   3. no range end in the file defaults to sheetToday() any more
 *
 * The third is a text check and it is the one that will catch the regression:
 * the arithmetic is unlikely to rot, but `dateTo || sheetToday()` is exactly
 * what somebody adds next time they need a default.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'game-analytics/game-analytics.legacy.js'), 'utf8');

function lift(decl) {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`not in the file: ${decl}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`never closes: ${decl}`);
}

/* sheetToday is stubbed so the test can stand on a chosen day instead of
   whichever day it happens to run on - including the two days that break
   naive date maths. */
const build = (todayIso) => new Function(`
  function sheetToday(){ return ${JSON.stringify(todayIso)}; }
  ${lift('function isoShift(')}
  ${lift('function dataThrough(')}
  return { isoShift, dataThrough, sheetToday };
`)();

let bad = 0, n = 0;
const ok = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

/* ---- 1. the last finished day --------------------------------------- */
ok('an ordinary day',        build('2026-10-05').dataThrough(), '2026-10-04');
ok('the first of a month',   build('2026-10-01').dataThrough(), '2026-09-30');
ok('the first of March',     build('2027-03-01').dataThrough(), '2027-02-28');
ok('the first of March in a leap year',
                             build('2028-03-01').dataThrough(), '2028-02-29');
ok('new year',               build('2027-01-01').dataThrough(), '2026-12-31');

/* ---- 2. a preset window ---------------------------------------------- */
/* The same two lines applyPresetToInputs uses. Asserting the shape it
   produces, on a fixed day, rather than the DOM it writes it into. */
const presetWindow = (todayIso, days) => {
  const api = build(todayIso);
  const to = api.dataThrough();
  return { from: api.isoShift(to, -(days - 1)), to: to };
};

const w14 = presetWindow('2026-10-05', 14);
ok('"Last 14 days" ends yesterday',    w14.to, '2026-10-04');
ok('"Last 14 days" does not include today', w14.to === '2026-10-05', false);
ok('"Last 14 days" starts 13 days before that', w14.from, '2026-09-21');

/* Inclusive of both ends, so the span is exactly the number asked for. */
const span = (w) =>
  Math.round((Date.parse(w.to + 'T00:00:00Z') - Date.parse(w.from + 'T00:00:00Z')) / 86400000) + 1;
ok('14 days means 14 days', span(w14), 14);
[28, 42, 56].forEach((d) => {
  ok(`${d} days means ${d} days`, span(presetWindow('2026-10-05', d)), d);
});

/* And across a month end, where off-by-one errors live. */
const wEdge = presetWindow('2026-03-02', 14);
ok('a window spanning February is still 14 days', span(wEdge), 14);
ok('...and ends on the 1st',                      wEdge.to, '2026-03-01');

/* ---- 3. nothing defaults a range end to today any more ---------------- */
/* Comments stripped: this file's own comments quote the old expression to
   explain the fix, and a text check that reads them is checking prose. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const defaults = code.match(/\|\|\s*sheetToday\(\)/g) || [];
ok('no range end falls back to sheetToday()', defaults.length, 0);

/* isoDaysAgo built windows ending today and is gone. If it comes back,
   something is building one again. */
ok('isoDaysAgo is not back', /function\s+isoDaysAgo/.test(code), false);

console.log(bad ? `\n  ${bad} of ${n} FAILED\n` : `\n  ranges: all ${n} passed\n`);
process.exit(bad ? 1 : 0);
