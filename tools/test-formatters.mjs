/**
 * ============================================================================
 * test-formatters.mjs — does a bad number reach the screen as a number?
 * ============================================================================
 *
 *   npm run test:fmt
 *
 * The formatters are read out of game-analytics.legacy.js rather than copied,
 * for the reason every test in this codebase is written that way: a copy keeps
 * passing after the shipped version has drifted.
 *
 * WHAT IS BEING TESTED
 *
 * Not "does it print a dollar sign". The question is what happens to the three
 * values that are not numbers but survive a `n == null` check — which is the
 * guard every formatter here used to have:
 *
 *   NaN        a parse that failed          -> used to print "NaN%"
 *   Infinity   a division by zero           -> used to print "InfinityM"
 *   ''         a blank cell                 -> used to print "0.0%"
 *
 * The third is the worst of them. NaN and Infinity look broken, so somebody
 * reports them. An empty cell rendering as a confident 0.0% looks like a
 * measurement, and it is the exact shape of every silent fault this project
 * has found.
 *
 * And the overcorrection is tested too: zero is a value. A guard written as
 * `if (!n)` would turn a real zero into an em dash, which is the same fault
 * pointing the other way.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'game-analytics/game-analytics.legacy.js'), 'utf8');

/* The formatter block, lifted from the shipped file between two anchors that
   sit either side of it. If either anchor moves, this throws rather than
   silently testing nothing. */
const from = src.indexOf('const isNum   =');
const to   = src.indexOf('const sum     =');
if (from < 0 || to < 0 || to < from) {
  throw new Error('test-formatters: could not find the formatter block in '
    + 'game-analytics.legacy.js — the anchors moved, fix them here');
}

const F = {};
new Function('F', src.slice(from, to) + `
  Object.assign(F, { isNum, fmt, fmtKn, fmtPct, fmtPct2, fmtSec, fmtPlaytime, fmtMoney });
`)(F);

const { fmt, fmtKn, fmtPct, fmtSec, fmtMoney } = F;

let bad = 0, n = 0;
const ok = (label, got, want) => {
  n++;
  if (got !== want) {
    bad++;
    console.log(`  FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

const DASH = '—';

/* ---- the three the old guard let through ------------------------------- */
ok('fmtPct(NaN)',        fmtPct(NaN),        DASH);
ok('fmtPct(1/0)',        fmtPct(1 / 0),      DASH);
ok('fmtPct("")',         fmtPct(''),         DASH);
ok('fmtKn(NaN)',         fmtKn(NaN),         DASH);
ok('fmtKn(Infinity)',    fmtKn(Infinity),    DASH);
ok('fmt(NaN)',           fmt(NaN),           DASH);
ok('fmtSec(NaN)',        fmtSec(NaN),        DASH);
ok('fmtMoney(NaN)',      fmtMoney(NaN),      DASH);
ok('fmtMoney(0/0, 2)',   fmtMoney(0 / 0, 2), DASH);
ok('fmt(undefined)',     fmt(undefined),     DASH);

/* ---- and the overcorrection: zero is a value --------------------------- */
ok('fmtKn(0)',           fmtKn(0),           '0');
ok('fmtPct(0)',          fmtPct(0),          '0.0%');
ok('fmtMoney(0)',        fmtMoney(0),        '$0');
ok('fmtMoney(0, 2)',     fmtMoney(0, 2),     '$0.00');
ok('fmtSec(0)',          fmtSec(0),          '0s');

/* ---- the sign belongs outside the currency symbol ---------------------- */
ok('fmtMoney(-1234)',    fmtMoney(-1234),    '-$1.2K');
ok('fmtMoney(-5, 2)',    fmtMoney(-5, 2),    '-$5.00');

/* ---- and the ordinary cases still read as they always did -------------- */
ok('fmtMoney(1234)',     fmtMoney(1234),     '$1.2K');
ok('fmtMoney(2500000)',  fmtMoney(2500000),  '$2.50M');
ok('fmtMoney(1234.5, 2)', fmtMoney(1234.5, 2), '$1,234.50');
ok('fmtKn(999)',         fmtKn(999),         '999');
ok('fmtKn(1500)',        fmtKn(1500),        '1.5K');

console.log(bad ? `\n  ${bad} of ${n} FAILED\n` : `\n  formatters: all ${n} passed\n`);
process.exit(bad ? 1 : 0);
