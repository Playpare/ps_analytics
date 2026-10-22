/**
 * ============================================================================
 * test-overview-rates.mjs — Overview rates are computed, not averaged
 * ============================================================================
 *
 *   node tools/test-overview-rates.mjs
 *
 * Lifted out of the shipped file rather than copied, so it cannot keep
 * passing after that file drifts.
 *
 * WHY THIS EXISTS
 *
 * Payer conversion was the mean of each day's rate. ARPDAU was revenue over
 * an average DAU multiplied back up by the day count. Neither is wrong by a
 * little in the way a rounding is — they answer a different question, and
 * they only agree with the right answer when every day in the window is the
 * same size.
 *
 * A quiet Sunday with 3 payers out of 200 is a 1.5% day. A Saturday with
 * 3,000 out of 200,000 is 1.5% as well — but take 3 payers out of 200 against
 * 300 out of 200,000 and the mean says 0.83% while the period actually ran at
 * 0.15%. The small day counted as much as the large one, which is not what
 * "payer conversion for the period" means to anyone reading it.
 *
 * So the rule these tests hold: sum the numerator, sum the denominator,
 * divide once. The tests below construct exactly the uneven window that tells
 * the two apart, because on an even one both methods agree and the test would
 * prove nothing.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'game-analytics/game-analytics.legacy.js'), 'utf8');

function lift(decl) {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`not in the shipped file: ${decl}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`never closes: ${decl}`);
}

/* `sum` is the file's own; lifted, not reimplemented. */
const sumDecl = src.match(/^const sum\s*=[^\n]*$/m) || src.match(/^function sum\([^)]*\)[^\n]*$/m);
if (!sumDecl) throw new Error('the `sum` helper is no longer where this expects it');

const api = new Function(`
  ${sumDecl[0]}
  ${lift('function ovRate(rows, numOf, denOf)')}
  ${lift('function ovInstallsSub(d, cur)')}
  ${lift('function ovDauSub(d)')}
  return { ovRate, ovInstallsSub, ovDauSub };
`)();

let bad = 0, n = 0;
const ok = (label, cond, detail) => {
  n++;
  if (!cond) { bad++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};
const near = (label, got, want) =>
  ok(label, got != null && Math.abs(got - want) < 1e-9, `got ${got}, want ${want}`);

console.log('\n  Overview — rates computed from sums');
console.log('  ' + '-'.repeat(62));

/* ---- the uneven window that tells the two methods apart ---------------- */

/* Rows as the payload sends them: a day is a numerator and a denominator
   together, not two independent columns. */
const day = (payers, active, revenue) => ({ payers, activeUsers: active, revenue });

const uneven = [day(3, 200, 100), day(300, 200000, 9900)];
const P = r => r.payers, A = r => r.activeUsers, R = r => r.revenue;

near('payer rate is sum ÷ sum', api.ovRate(uneven, P, A), 303 / 200200);

/* The old method written out, so the gap is visible rather than asserted
   about: the mean of the daily rates. */
const meanOfDaily = (3 / 200 + 300 / 200000) / 2;
ok('and that is NOT the mean of the daily rates',
  Math.abs(api.ovRate(uneven, P, A) - meanOfDaily) > 0.001,
  `sums ${(api.ovRate(uneven, P, A) * 100).toFixed(3)}% vs mean ${(meanOfDaily * 100).toFixed(3)}%`);
ok('the mean overstates it more than 5x on this window',
  meanOfDaily / api.ovRate(uneven, P, A) > 5,
  `${(meanOfDaily / api.ovRate(uneven, P, A)).toFixed(1)}x`);

near('ARPDAU is sum(revenue) ÷ sum(active)', api.ovRate(uneven, R, A), 10000 / 200200);

/* ---- an even window, where both agree ---------------------------------- */

/* Stated so the test is known to measure the weighting and not an arithmetic
   slip: on equal days the two methods must give the same answer. */
near('on equal-sized days the result matches the simple mean',
  api.ovRate([day(10, 1000, 0), day(20, 1000, 0)], P, A),
  (10 / 1000 + 20 / 1000) / 2);

/* ---- a day with no denominator takes its numerator with it ------------- */

/* THE FAULT THIS SHAPE PREVENTS. The IAP tab can be a day behind while
   revenue for that day is already in. Summing the two columns independently
   would divide two days of revenue by one day of users, and ARPDAU would
   read high exactly when a feed fell behind - a number that improves when
   something breaks. */
const laggingFeed = [day(5, 1000, 500), day(null, null, 500)];
near('revenue from a day with no active-user figure is excluded',
  api.ovRate(laggingFeed, R, A), 500 / 1000);
ok('not 1000/1000, which independent sums would have given',
  Math.abs(api.ovRate(laggingFeed, R, A) - 1) > 1e-9);
near('the payer rate drops that day too', api.ovRate(laggingFeed, P, A), 5 / 1000);

/* A zero denominator is treated the same way: nobody measured, so there is
   nothing to divide by. */
near('a zero active count does not drag a day in',
  api.ovRate([day(5, 1000, 500), day(0, 0, 400)], R, A), 500 / 1000);

/* ---- absent is not zero ------------------------------------------------- */

ok('no usable day gives null, not 0',
  api.ovRate([day(5, 0, 5)], P, A) === null);
ok('an empty window gives null', api.ovRate([], P, A) === null);
/* A real zero numerator over a real denominator IS zero - nobody paid. */
near('zero payers over real users is 0, not null',
  api.ovRate([day(0, 1000, 0)], P, A), 0);
ok('a blank numerator counts as 0 rather than poisoning the sum',
  api.ovRate([day(null, 100, 0), day(5, 100, 0)], P, A) === 5 / 200);

/* ---- the Installs subtitle names the store ----------------------------- */

const consoleRow = (hasIos) => [{ installsSource: 'play-console', consoleHasIos: hasIos }];

ok('android names Play Console',
  /Play Console/.test(api.ovInstallsSub({ platform: 'android' }, consoleRow(false))));
ok('android says New Users',
  /New Users/.test(api.ovInstallsSub({ platform: 'android' }, consoleRow(false))));
ok('iOS names the App Store, not Play Console',
  api.ovInstallsSub({ platform: 'ios' }, consoleRow(true)) === 'New Users · App Store');
ok('iOS on the old source says so instead of claiming the App Store',
  /Executive KPI/.test(
    api.ovInstallsSub({ platform: 'ios' }, [{ installsSource: 'bytebrew' }])));
ok('combined without the iOS column admits it is Android only',
  /Android only/.test(api.ovInstallsSub({ platform: 'all' }, consoleRow(false))));
ok('combined with the column names both stores',
  /Play Console \+ App Store/.test(api.ovInstallsSub({ platform: 'all' }, consoleRow(true))));

/* ---- the Active Users subtitle names its real source -------------------- */

/* The figure is GA4's, carried on the same tab as payers and sales - which
   is why the whole row can divide by it and reconcile. The fallbacks are
   named rather than hidden, because a card that silently swapped feeds is
   what naming the source is for. */
ok('the default label names GA4',
  api.ovDauSub({}) === 'active users · GA4', api.ovDauSub({}));
ok('a fallback day is named, not passed off as GA4',
  api.ovDauSub({ dauSource: 'adperf' }) === 'active users · AdPerformance'
  && api.ovDauSub({ dauSource: 'useractraw' }) === 'active users · User Activity Raw');

/* ---- the shipped file no longer averages the rates --------------------- */

const ov = lift('function renderOverview()');

/* ---- an unreported day is not a zero ----------------------------------- */

/* THE FAULT THAT HID ANDROID INSTALLS. The backend sends null for a date the
   Console Installs tab has no row for, and its own comment calls a zero
   install bar "the most confidently wrong thing this dashboard can draw".
   `+x.installs||0` turned every one of those into a real zero, so a tab that
   had not reached the range showed 0 installs instead of saying so. */
ok('installs are summed over reporting days only, not with ||0',
  !/totalInstalls = sum\(cur\.map\(x=>\+x\.installs\|\|0\)\)/.test(ov));
ok('a window with no install rows yields null, not 0',
  /installRows\.length \? sum\(/.test(ov));
ok('and the card shows a dash rather than a confident zero',
  /totalInstalls!=null\?fmtKn\(totalInstalls\):/.test(ov));
ok('with a subtitle saying why',
  /no install rows in range/.test(ov));

ok('payer conversion is no longer avg() of the daily rate',
  !/avg\(cur\.map\(x=>\+x\.payerRate/.test(ov));
ok('ARPDAU no longer divides by an averaged DAU',
  !/revTot\/\(dauAvg\*/.test(ov));
ok('all three cards divide by the same activeUsers',
  (ov.match(/activeOf/g) || []).length >= 4, 'the denominator is not shared');
ok('the Active Users card shows activeUsers, not dau',
  /lbl:'Active Users'[\s\S]{0,160}x\.activeUsers/.test(ov));
ok('sessions per user is still an average, as it should be',
  /avgNN\(cur\.map\(x=>x\.sessionsPerUser\)\)/.test(ov));
ok('ad and IAP share are one card',
  /Ad \/ IAP Share/.test(ov));

/* ---- money is net, except ARPPU ---------------------------------------- */

/* THE RULE THIS ENCODES
   Everywhere revenue is shown it is net of the store cut - 35% on Android, 0
   on iOS because iOS arrives as proceeds. ARPPU is the single exception: what
   a payer is worth is what they SPENT, not what survived the cut.

   Checked against the shipped source rather than by running it, because these
   figures come from a Sheet1 rollup that is not available here. */

/* The source moved to the Revenue tab, which the payload already carries -
   the Sheet1 rollup had no rows for most windows, so the card spent its time
   saying so while the numbers sat unread. */
ok('the share reads the Revenue tab columns',
   /adGross\s*=\s*sum\(cur\.map\(x => \+x\.adRevenue/.test(ov)
   && /iapGross\s*=\s*sum\(cur\.map\(x => \+x\.iapRevenue/.test(ov));

ok('and no longer depends on the Sheet1 rollup',
   !/inappTotal/.test(ov) && !/mxDaysForRange/.test(ov));

/* The cut is the whole point: IAP arrives gross, so the share would be too
   big by whatever the store keeps. */
ok('IAP is cut, and by a rate that depends on the platform',
   /OV_IAP_CUT\s*=\s*\{\s*android:\s*0\.35,\s*ios:\s*0\s*\}/.test(ov),
   'the rate is not stated per platform');
ok('iOS is not cut, because it arrives as proceeds',
   /ios:\s*0\s*\}/.test(ov));
ok('the cut is applied to IAP and not to ads',
   /iapGross \* \(1 - ovCut\)/.test(ov) && !/adGross \* \(1 -/.test(ov));

/* A platform with no known rate must not be given a guessed blend. */
ok('an unknown platform shows gross and says so',
   /ovNettable\s*=\s*ovCut !== undefined/.test(ov) && /GROSS/.test(ov));

ok('Revenue is the same two totals added, so the row reconciles',
   /revTot\s*=\s*haveSh\s*\?\s*adTot \+ iapTot/.test(ov));

/* A silent swap between net and gross would show as a step in the trend that
   nobody could explain, so the card has to say which it is showing. */
ok('and says which it is showing when it falls back to gross',
   /GROSS/.test(ov) && /revSub/.test(ov));

ok('ARPDAU divides that same total, so the row reconciles',
   /arpdau\s*=\s*activeTot > 0 \? revTot \/ activeTot/.test(ov));

ok('ARPPU is the one gross figure, from sales',
   /arppu\s*=\s*ovRate\(cur,\s*x => x\.iapSales,\s*x => x\.payers\)/.test(ov));
ok('and its subtitle says gross, so the exception is visible',
   /gross sales .{0,12} paying users/.test(ov));

/* ---- the two rows are split by what they measure ----------------------- */

const row1 = ov.slice(ov.indexOf('const kpis = ['), ov.indexOf('const kpis2 = ['));
const row2 = ov.slice(ov.indexOf('const kpis2 = ['));

for (const lbl of ['Installs', 'Active Users', 'D1 Retention', 'D0 Playtime',
                   'Sessions / User', 'FTUE Complete']) {
  ok('row 1 carries ' + lbl, row1.includes("lbl:'" + lbl + "'"));
}
for (const lbl of ['Revenue', 'ARPDAU', 'ARPPU', 'Payer Conv.',
                   'Ad / IAP Share', 'UA Spend']) {
  ok('row 2 carries ' + lbl, row2.includes("lbl:'" + lbl + "'"));
}
/* The move that prompted this: Sessions / User is engagement, not money. */
ok('Sessions / User is NOT in the monetization row',
   !row2.includes("lbl:'Sessions / User'"));

console.log(`  ${n - bad}/${n} passed${bad ? `  (${bad} FAILED)` : ''}\n`);
process.exit(bad ? 1 : 0);
