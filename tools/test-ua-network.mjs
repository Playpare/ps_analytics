/* The arithmetic behind UA Network Performance.

   Four things here are easy to get wrong and impossible to see on screen:

     the fold        - a count averaged instead of summed halves payer %
     null vs zero    - an immature cohort must not read as "nobody bought"
     the waterfall   - four factors that do not add back to the whole are
                       four unrelated percentages wearing a chart
     the noise floor - the mockup alerted on any 15% move, which on a small
                       network fires most days and means nothing

   The module is imported rather than restated, so a test that passes while
   the shipped arithmetic is wrong is not possible. */

import { fold, decompose, payerPctIsReal, findings, money, pct, delta }
  from '../reports/ua-network/ua-network.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else {
    fail++;
    console.log('  FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
  }
};
const near = (a, b, eps) => a != null && Math.abs(a - b) < (eps == null ? 1e-9 : eps);

console.log('\n  UA Network Performance');
console.log('  ' + '-'.repeat(62));

/* ---- the fold ---------------------------------------------------------- */
const two = fold([
  { channel: 'Meta', installs: 1000, spend: 2000, adRevenue: 100,
    payersD7: 40, purchD7: 54, cohortIapD7: 560, d7: 16 },
  { channel: 'Unity', installs: 1000, spend: 1000, adRevenue: 200,
    payersD7: 20, purchD7: 24, cohortIapD7: 240, d7: 12 }
]);
ok('installs sum', two.installs === 2000, two.installs);
ok('spend sums', two.spend === 3000, two.spend);
ok('payers sum to 60, not average to 30', two.payers === 60, two.payers);
ok('CPI is total spend over total installs, not a mean of CPIs',
  near(two.cpi, 1.5), two.cpi);
ok('payer % is 60/2000 = 3%', near(two.payerPct, 0.03), two.payerPct);
ok('purchases per payer is 78/60', near(two.purchPerPayer, 78 / 60), two.purchPerPayer);
ok('average price is 800/78', near(two.avgPrice, 800 / 78), two.avgPrice);
ok('D7 ROAS is cohort IAP over spend: 800/3000',
  near(two.roasD7, 800 / 3000), two.roasD7);
/* Retention arrives already install-weighted per channel; folding two
   channels weights them again by their own installs. */
ok('retention is install-weighted: (16 + 12) / 2 = 14', near(two.retD7, 14), two.retD7);

/* A 40-install day must not weigh the same as a 40,000-install one. */
const lopsided = fold([
  { channel: 'Big', installs: 40000, spend: 40000, payersD7: 1200 },
  { channel: 'Tiny', installs: 40, spend: 400, payersD7: 8 }
]);
ok('a tiny channel cannot drag the blended payer %',
  near(lopsided.payerPct, 1208 / 40040), lopsided.payerPct);

/* ---- null is not zero -------------------------------------------------- */
const immature = fold([
  { channel: 'A', installs: 500, spend: 500, payersD7: 20, purchD7: 25, cohortIapD7: 300 },
  { channel: 'B', installs: 500, spend: 500, payersD7: null, purchD7: null, cohortIapD7: null }
]);
ok('an unreported channel is skipped, not added as 0', immature.payers === 20,
  immature.payers);
ok('its installs still count, so payer % is honest about the denominator',
  immature.installs === 1000);

const nothing = fold([{ channel: 'New', installs: 900, spend: 900 }]);
ok('nothing reported at all leaves payers null', nothing.payers === null, nothing.payers);
ok('and payer % null, never 0%', nothing.payerPct === null, nothing.payerPct);
ok('while installs and spend are still real', nothing.installs === 900 && nothing.spend === 900);

/* ---- the waterfall ----------------------------------------------------- */
const prev = fold([{ channel: 'X', installs: 10000, spend: 10000,
  payersD7: 300, purchD7: 400, cohortIapD7: 4000 }]);
const cur = fold([{ channel: 'X', installs: 12000, spend: 12000,
  payersD7: 240, purchD7: 336, cohortIapD7: 3360 }]);
const w = decompose(cur, prev);
ok('a decomposition is produced', w !== null);
ok('it names the four factors in formula order',
  w.parts.map((p) => p.key).join(',')
  === 'installs,payerPct,purchPerPayer,avgPrice',
  w.parts.map((p) => p.key));
/* The point of the log split: the parts add back to the measured change. */
const summed = w.parts.reduce((s, p) => s + p.effect, 0);
ok('the four parts add back to the whole change', near(summed, w.total, 1e-6),
  { summed, total: w.total });
ok('and the ends are the two measured totals',
  w.from === 4000 && w.to === 3360, { from: w.from, to: w.to });
/* Installs rose while revenue fell, so that factor must read positive and
   something else must carry the fall. A split that made every bar negative
   because the total was negative would be telling the reader nothing. */
const byKey = {};
w.parts.forEach((p) => { byKey[p.key] = p.effect; });
ok('rising installs is a positive contribution', byKey.installs > 0, byKey.installs);
ok('the falling payer % is a negative one', byKey.payerPct < 0, byKey.payerPct);
ok('payer % is the biggest single mover',
  Math.abs(byKey.payerPct) >= Math.max(...w.parts.map((p) => Math.abs(p.effect))) - 1e-9);

ok('no cohort revenue means no decomposition, not a zero one',
  decompose(fold([{ channel: 'A', installs: 100, spend: 100 }]), prev) === null);
ok('an unchanged period yields no split rather than a divide by a log of 1',
  decompose(cur, cur) === null);

/* ---- the noise floor --------------------------------------------------- */
/* 200 installs at 3% is six payers. Four is a 33% "drop" and is noise. */
const smallCur  = fold([{ channel: 'S', installs: 200, spend: 200, payersD7: 4 }]);
const smallPrev = fold([{ channel: 'S', installs: 200, spend: 200, payersD7: 6 }]);
const small = payerPctIsReal(smallCur, smallPrev);
ok('a 33% fall on 200 installs does NOT clear the noise floor',
  small && small.real === false, small && small.z);
ok('and the page can say what size it could have detected',
  small && small.detectable > 0.5, small && small.detectable);

/* The same relative fall on a big channel is a real finding. */
const bigCur  = fold([{ channel: 'B', installs: 60000, spend: 60000, payersD7: 1200 }]);
const bigPrev = fold([{ channel: 'B', installs: 60000, spend: 60000, payersD7: 1800 }]);
const big = payerPctIsReal(bigCur, bigPrev);
ok('the same 33% fall on 60,000 installs DOES clear it', big && big.real === true,
  big && big.z);
ok('a big channel needs a much smaller move to be measurable',
  big.detectable < small.detectable / 5,
  { big: big.detectable, small: small.detectable });

ok('no installs means no verdict, not a false one',
  payerPctIsReal(fold([{ channel: 'Z', installs: 0, spend: 0 }]), bigPrev) === null);

/* ---- what gets reported ------------------------------------------------ */
const reported = findings(
  [{ channel: 'Small', installs: 200, spend: 200, payersD7: 4, purchD7: 5, cohortIapD7: 50 },
   { channel: 'Large', installs: 60000, spend: 60000, payersD7: 1200, purchD7: 1500, cohortIapD7: 18000 }],
  [{ channel: 'Small', installs: 200, spend: 200, payersD7: 6, purchD7: 8, cohortIapD7: 80 },
   { channel: 'Large', installs: 60000, spend: 60000, payersD7: 1800, purchD7: 2250, cohortIapD7: 27000 }]
);
const payerFindings = reported.filter((f) => f.tag === 'PAYER %');
ok('the large network is reported', payerFindings.some((f) => /Large/.test(f.head)),
  reported.map((f) => f.head));
ok('the small one is not reported as a payer-% finding',
  !payerFindings.some((f) => /Small/.test(f.head)));
ok('it is reported as not measurable instead, rather than dropped silently',
  reported.some((f) => f.tag === 'TOO SMALL' && /Small/.test(f.head)),
  reported.map((f) => f.tag));
ok('the list is ordered by money moved, not by percentage',
  reported[0].money >= reported[reported.length - 1].money,
  reported.map((f) => f.money));

/* A price fall with a steady payer % is the game's side of the identity and
   must not be announced as a marketing problem. */
const priced = findings(
  [{ channel: 'P', installs: 20000, spend: 20000, payersD7: 600, purchD7: 800, cohortIapD7: 8000 }],
  [{ channel: 'P', installs: 20000, spend: 20000, payersD7: 600, purchD7: 800, cohortIapD7: 10000 }]
);
ok('a price fall is reported as PRICE, not as a payer-% problem',
  priced.length === 1 && priced[0].tag === 'PRICE', priced.map((f) => f.tag));
ok('and it says so in words', /pricing|offers|bundles/.test(priced[0].body));

/* ---- formatting -------------------------------------------------------- */
ok('a missing number renders as a dash, never as 0',
  money(null) === '—' && pct(null) === '—', [money(null), pct(null)]);
ok('a rising CPI is bad news, and coloured as such',
  /class="d down"/.test(delta(2.2, 2.0, true)), delta(2.2, 2.0, true));
ok('a rising ROAS is good news', /class="d up"/.test(delta(1.2, 1.0, false)));
ok('a change against nothing is a dash, not an infinity',
  /flat/.test(delta(5, 0, false)), delta(5, 0, false));

console.log('  ' + '-'.repeat(62));
console.log(`  ${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
