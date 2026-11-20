/* The arithmetic behind UA Network Performance.

   Totals, except ROAS and retention. The page used to be built on the D7
   cohort split of IAP revenue and it was wrong twice over - once in the
   arithmetic and once in the data - so the cases below pin both:

     the fold         period sums, with the two rates folded by their own
                      denominators rather than by whichever is to hand
     the mismatch     the bug that halved payer %: a numerator summed over
                      the mature days against a denominator summed over all
                      of them
     the feed         a payer rate three orders of magnitude below any real
                      game is a broken measurement, and must be named rather
                      than plotted */

import {
  fold, findings, cohortPayerCheck, PLAUSIBLE_PAYER_RATE,
  money, num, pct, delta
} from '../reports/ua-network/ua-network.js';

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

/* ---- the fold: period totals ------------------------------------------ */
const two = fold([
  { channel: 'Meta', installs: 1000, spend: 2000,
    revenue: 900, adRevenue: 600, iapRevenue: 300, d7: 16, roasD7: 42 },
  { channel: 'Unity', installs: 1000, spend: 1000,
    revenue: 400, adRevenue: 300, iapRevenue: 100, d7: 12, roasD7: 28 }
]);
ok('installs sum', two.installs === 2000, two.installs);
ok('spend sums', two.spend === 3000, two.spend);
ok('revenue sums', two.revenue === 1300, two.revenue);
ok('IAP and ads sum separately and add back to revenue',
  two.iapRevenue === 400 && two.adRevenue === 900
  && two.iapRevenue + two.adRevenue === two.revenue,
  { iap: two.iapRevenue, ads: two.adRevenue, rev: two.revenue });

ok('CPI is total spend over total installs, not a mean of CPIs',
  near(two.cpi, 1.5), two.cpi);
ok('return on spend is period revenue over period spend',
  near(two.roas, 1300 / 3000), two.roas);
ok('revenue per install is revenue over installs',
  near(two.arpi, 1300 / 2000), two.arpi);

/* The two rates keep their own denominators. */
ok('retention is install-weighted:  (16 + 12) / 2 = 14', near(two.retD7, 14), two.retD7);
ok('D7 ROAS is cost-weighted:  (42x2000 + 28x1000) / 3000 = 37.33',
  near(two.roasD7, (42 * 2000 + 28 * 1000) / 3000, 1e-6), two.roasD7);

/* A 40-install day must not weigh the same as a 40,000-install one. */
const lopsided = fold([
  { channel: 'Big', installs: 40000, spend: 40000, revenue: 20000 },
  { channel: 'Tiny', installs: 40, spend: 400, revenue: 10 }
]);
ok('a tiny channel cannot drag the blended CPI',
  near(lopsided.cpi, 40400 / 40040), lopsided.cpi);

/* ---- nothing to divide by is a dash, never a zero --------------------- */
const empty = fold([{ channel: 'New', installs: 0, spend: 0 }]);
ok('no installs leaves CPI null, not 0', empty.cpi === null, empty.cpi);
ok('no spend leaves return null, not 0%', empty.roas === null, empty.roas);
ok('no retention reported leaves it null', empty.retD7 === null, empty.retD7);
ok('no ROAS reported leaves it null', empty.roasD7 === null, empty.roasD7);

/* A rate that is present but zero is a real zero and must survive. */
const zeroed = fold([{ channel: 'Z', installs: 100, spend: 100, revenue: 0,
                       d7: 0, roasD7: 0 }]);
ok('a reported zero return stays 0, not null', zeroed.roas === 0, zeroed.roas);

/* ---- the bug this page was rebuilt to remove -------------------------- */
/* Cohort payers matured on two of four days; installs ran over all four. The
   old page divided one by the other and halved the payer rate for a reason
   nothing on screen could show. The fold no longer carries payers at all, so
   the mismatch is not available to be made. */
const mixed = fold([
  { channel: 'M', installs: 1000, spend: 1000, revenue: 500, payersD7: 30 },
  { channel: 'M', installs: 1000, spend: 1000, revenue: 500, payersD7: null }
]);
ok('the fold carries no payer figure to divide by the wrong denominator',
  mixed.payerPct === undefined && mixed.payers === undefined,
  Object.keys(mixed));
ok('and the totals it does carry cover every row',
  mixed.installs === 2000 && mixed.revenue === 1000);

/* ---- is the cohort feed reporting anything real? ---------------------- */
const broken = cohortPayerCheck([
  { installs: 2166600, payersD7: 42 },
  { installs: 331800, payersD7: 15 }
]);
ok('42 payers on 2.2M installs is reported as implausible',
  broken && broken.plausible === false, broken);
ok('and the rate it computed is the one worth printing',
  near(broken.rate, 57 / 2498400, 1e-12), broken.rate);

const real = cohortPayerCheck([{ installs: 100000, payersD7: 2000 }]);
ok('2% is plausible and is not flagged', real && real.plausible === true, real);
ok('the threshold sits below any real game', PLAUSIBLE_PAYER_RATE <= 0.005,
  PLAUSIBLE_PAYER_RATE);

ok('nothing reported at all is not a verdict',
  cohortPayerCheck([{ installs: 1000 }]) === null);
ok('payers with no installs is not a verdict either',
  cohortPayerCheck([{ installs: 0, payersD7: 5 }]) === null);

/* ---- what gets reported ----------------------------------------------- */
const moved = findings(
  [{ channel: 'Big', installs: 100000, spend: 50000, revenue: 25000 },
   { channel: 'Small', installs: 300, spend: 200, revenue: 60 }],
  [{ channel: 'Big', installs: 100000, spend: 50000, revenue: 50000 },
   { channel: 'Small', installs: 300, spend: 200, revenue: 180 }]
);
ok('the big network halving its return is reported',
  moved.some((f) => f.tag === 'RETURN' && /Big/.test(f.head)),
  moved.map((f) => f.head));
ok('a channel worth under 2% of spend is left out, however it moved',
  !moved.some((f) => /Small/.test(f.head)), moved.map((f) => f.head));

const spent = findings(
  [{ channel: 'A', installs: 200000, spend: 100000, revenue: 60000 }],
  [{ channel: 'A', installs: 100000, spend: 50000, revenue: 30000 }]
);
ok('doubling spend at a steady return is reported as spend, not as return',
  spent.length === 1 && spent[0].tag === 'SPEND UP', spent.map((f) => f.tag));

const priced = findings(
  [{ channel: 'A', installs: 50000, spend: 100000, revenue: 60000 }],
  [{ channel: 'A', installs: 100000, spend: 100000, revenue: 60000 }]
);
ok('CPI doubling at flat spend and flat revenue is reported as CPI',
  priced.length === 1 && priced[0].tag === 'CPI', priced.map((f) => f.tag));

const fresh = findings(
  [{ channel: 'New', installs: 50000, spend: 30000, revenue: 10000 },
   { channel: 'Old', installs: 50000, spend: 30000, revenue: 10000 }],
  [{ channel: 'Old', installs: 50000, spend: 30000, revenue: 10000 }]
);
ok('a network with no previous period is announced, not silently skipped',
  fresh.some((f) => f.tag === 'NEW' && /New/.test(f.head)), fresh.map((f) => f.tag));

const steady = findings(
  [{ channel: 'A', installs: 100000, spend: 50000, revenue: 50000 }],
  [{ channel: 'A', installs: 100000, spend: 50000, revenue: 50000 }]
);
ok('an unchanged period reports nothing at all', steady.length === 0, steady);

ok('the list is ordered by money moved, not by percentage',
  moved.every((f, i) => i === 0 || moved[i - 1].money >= f.money),
  moved.map((f) => f.money));

/* ---- formatting -------------------------------------------------------- */
ok('a missing number renders as a dash, never as 0',
  money(null) === '—' && pct(null) === '—' && num(null) === '—');
ok('a rising CPI is bad news, and coloured as such',
  /class="d down"/.test(delta(2.2, 2.0, true)), delta(2.2, 2.0, true));
ok('a rising return is good news', /class="d up"/.test(delta(1.2, 1.0, false)));
ok('a change against nothing is a dash, not an infinity',
  /flat/.test(delta(5, 0, false)), delta(5, 0, false));

console.log('  ' + '-'.repeat(62));
console.log(`  ${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
