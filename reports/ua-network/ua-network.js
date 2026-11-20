/**
 * UA Network Performance.
 *
 * One question: an IAP number moved — which part of it moved, and on which
 * network?
 *
 * IAP revenue is a product of four things, and the page is built around that
 * identity rather than around a list of available metrics:
 *
 *     IAP = Installs x Payer % x Purchases per payer x Average price
 *
 * Each factor points somewhere different. Installs is media buying. Payer %
 * is who the networks sent. Purchases per payer and average price are the
 * game and its pricing. A single "IAP down 18%" says none of that.
 *
 * ------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE
 *
 * The mockup this page comes from had eleven KPI tiles, seven charts and an
 * eighteen-column table. Several of those could not be built from measured
 * data, and a card that looks like a finding and is not one is worse than no
 * card:
 *
 *   IAP from new vs existing users - in the mockup this was `iap * 0.55`
 *     against a thirty-day window times a half, plus a random wobble. It
 *     needs event data keyed by install date, which Adjust's aggregate
 *     reports cannot answer. Left off rather than approximated.
 *
 *   D7 ROAS by network x country heatmap - needs `country` in the Adjust
 *     dimensions. That is a separate report definition and a separate tab,
 *     because adding country to the channel pull multiplies its row count by
 *     the number of countries. Until that exists there is no country data,
 *     so there is no country filter either - a filter with nothing behind it
 *     is a promise the page cannot keep.
 *
 *   Payback days, and the D0-D30 ROAS curve as 31 points - the mockup drew
 *     31 points from three measurements and a power function whose exponent
 *     was a constant invented in its sample data, then walked that invented
 *     curve until it crossed 100% and called the result payback. Eight
 *     measured ROAS points now exist, so the curve is drawn as the eight
 *     points it actually has.
 *
 *   Days to first purchase - read straight out of the mockup's sample data.
 *
 * ------------------------------------------------------------------
 * TWO PERIODS, TWO REQUESTS
 *
 * Every figure here is shown against the previous period of the same length,
 * because "payer % is 2.8%" is not a finding and "payer % fell by a fifth"
 * is. The channel rollup is aggregated server-side over the window it is
 * asked for, so the previous period is a second request rather than a local
 * slice - a period total cannot be un-summed.
 */

/* ====================================================================
   THE FOUR FACTORS

   Derived from sums, never read as stored rates. A stored rate cannot be
   re-folded: filter to one platform and it is wrong, while sums are still
   sums. The backend ships payers, purchases and cohort revenue as counts for
   exactly this reason.
   ==================================================================== */

/** null, not 0, when the denominator is missing or nothing has matured. */
const ratio = (a, b) => (a == null || !b) ? null : a / b;

/**
 * Fold a list of channel rows into one set of totals.
 *
 * Counts are summed and a count that nobody reported stays null, so an
 * immature cohort reads as "not yet" rather than as zero payers. The two are
 * different statements and only one of them is ever true.
 */
function fold(rows) {
  const t = { installs: 0, spend: 0, adRevenue: 0, iapRevenue: 0, revenue: 0 };
  let payers = null, purch = null, cohortIap = null, retWeighted = 0, retN = 0;

  rows.forEach((r) => {
    t.installs   += Number(r.installs) || 0;
    t.spend      += Number(r.spend != null ? r.spend : r.cost) || 0;
    t.adRevenue  += Number(r.adRevenue) || 0;
    t.iapRevenue += Number(r.iapRevenue) || 0;
    t.revenue    += Number(r.revenue) || 0;

    if (r.payersD7 != null)    payers    = (payers    || 0) + Number(r.payersD7);
    if (r.purchD7 != null)     purch     = (purch     || 0) + Number(r.purchD7);
    if (r.cohortIapD7 != null) cohortIap = (cohortIap || 0) + Number(r.cohortIapD7);

    /* Retention is a rate, so it folds as an install-weighted average. */
    if (r.d7 != null && r.installs) {
      retWeighted += Number(r.d7) * Number(r.installs);
      retN += Number(r.installs);
    }
  });

  t.payers = payers;
  t.purchases = purch;
  t.cohortIap = cohortIap;
  t.cpi = ratio(t.spend, t.installs);
  t.retD7 = retN ? retWeighted / retN : null;

  /* The four factors. */
  t.payerPct = ratio(payers, t.installs);
  t.purchPerPayer = ratio(purch, payers);
  t.avgPrice = ratio(cohortIap, purch);

  /* D7 ROAS from the same two sums the rest of the page uses, rather than the
     stored rate, so every figure on the page divides the same numbers. */
  t.roasD7 = ratio(t.cohortIap, t.spend);
  return t;
}

/**
 * The four-factor decomposition of a change in cohort IAP revenue.
 *
 * IAP = I x P x Q x A, so the log of the change is the sum of the logs of the
 * four ratios. Splitting the money change in proportion to those logs gives
 * four parts that add back to the whole, which is what makes the chart a
 * decomposition rather than four unrelated percentages side by side.
 *
 * Returns null when either period has nothing to compare — a decomposition of
 * an unknown is not a zero.
 */
function decompose(cur, prev) {
  const need = ['installs', 'payerPct', 'purchPerPayer', 'avgPrice'];
  if (cur.cohortIap == null || prev.cohortIap == null
      || !prev.cohortIap || !cur.cohortIap) return null;
  if (need.some((k) => !cur[k] || !prev[k])) return null;

  const total = cur.cohortIap - prev.cohortIap;
  const lnTotal = Math.log(cur.cohortIap / prev.cohortIap);
  /* Below this the ratio is 1 to within rounding and the split is noise
     divided by noise. Report the money and no attribution. */
  if (!isFinite(lnTotal) || Math.abs(lnTotal) < 1e-9) return null;

  const labels = {
    installs: 'Installs',
    payerPct: 'Payer %',
    purchPerPayer: 'Purchases / payer',
    avgPrice: 'Average price'
  };
  return {
    from: prev.cohortIap,
    to: cur.cohortIap,
    total,
    parts: need.map((k) => ({
      key: k,
      label: labels[k],
      ratio: cur[k] / prev[k],
      effect: total * Math.log(cur[k] / prev[k]) / lnTotal
    }))
  };
}

/* ====================================================================
   IS THE CHANGE REAL?

   Payer % is a small number. A channel with 200 installs a day has about six
   payers; four the next day is a 33% "drop" and nothing happened. The
   mockup's alerts fired at a flat 15% with no regard for how many payers
   that was, which on a small channel means they fire most days.

   So a change in payer % is only reported when it clears the standard error
   of the difference between two proportions at 95%. That is arithmetic, not
   a threshold somebody chose, and it scales by itself: a big channel trips
   it at a few per cent, a small one never trips it on a single day — which
   is the correct answer for a small channel on a single day.
   ==================================================================== */

function payerPctIsReal(cur, prev) {
  const n1 = cur.installs, n2 = prev.installs;
  const p1 = cur.payerPct, p2 = prev.payerPct;
  if (!n1 || !n2 || p1 == null || p2 == null) return null;

  const se = Math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2);
  if (!se) return null;
  const z = (p1 - p2) / se;
  return {
    z,
    real: Math.abs(z) >= 1.96,
    /* The smallest relative move this many installs could have shown. Worth
       printing: it turns "nothing to report" into "nothing this size could
       have detected", which are different and only the second is useful. */
    detectable: p2 ? 1.96 * se / p2 : null,
    payers: cur.payers
  };
}

/**
 * What to say about each network, and only what the numbers support.
 *
 * Ordered by how much money the network moved, because an alert list sorted
 * by percentage puts the smallest channels at the top.
 */
function findings(cur, prev) {
  const out = [];
  const prevBy = {};
  prev.forEach((r) => { prevBy[r.channel] = r; });

  cur.forEach((row) => {
    const p = prevBy[row.channel];
    if (!p) return;
    const c = fold([row]), q = fold([p]);
    const sig = payerPctIsReal(c, q);
    const moved = (c.cohortIap != null && q.cohortIap != null)
      ? c.cohortIap - q.cohortIap : 0;

    if (sig && sig.real) {
      const dp = (c.payerPct - q.payerPct) / q.payerPct;
      const worse = dp < 0;
      out.push({
        tone: worse ? 'bad' : 'good',
        tag: 'PAYER %',
        money: Math.abs(moved),
        head: row.channel + ': payer % ' + (worse ? 'down ' : 'up ')
              + Math.abs(dp * 100).toFixed(0) + '%',
        body: 'From ' + pct(q.payerPct, 2) + ' to ' + pct(c.payerPct, 2)
              + ' on ' + num(c.installs) + ' installs (' + num(c.payers)
              + ' payers). Clears the noise floor of '
              + pct(sig.detectable, 0) + ' at this volume.'
              + (worse ? ' Payer % is who the network sent, so this points at'
                       + ' targeting, bids or the optimisation event — not at'
                       + ' the game.' : '')
      });
      return;
    }

    /* Price and basket are the game's side of the identity, and they are
       measured on payers rather than installs, so they get their own check
       rather than borrowing the payer-% one. */
    if (c.avgPrice != null && q.avgPrice != null && q.avgPrice) {
      const da = (c.avgPrice - q.avgPrice) / q.avgPrice;
      if (da < -0.10 && c.purchases >= 100) {
        out.push({
          tone: 'warn', tag: 'PRICE', money: Math.abs(moved),
          head: row.channel + ': average price down ' + Math.abs(da * 100).toFixed(0) + '%',
          body: 'Payer % held, so people are still buying and spending less:'
                + ' ' + money(q.avgPrice) + ' to ' + money(c.avgPrice)
                + ' across ' + num(c.purchases) + ' purchases. That is pricing,'
                + ' offers or bundles rather than media.'
        });
        return;
      }
    }

    if (sig && !sig.real && sig.detectable != null) {
      const dp = (c.payerPct - q.payerPct) / q.payerPct;
      if (dp < -0.10) {
        out.push({
          tone: 'quiet', tag: 'TOO SMALL', money: Math.abs(moved),
          head: row.channel + ': payer % looks down '
                + Math.abs(dp * 100).toFixed(0) + '%, but it is not measurable',
          body: num(c.installs) + ' installs could only show a change of '
                + pct(sig.detectable, 0) + ' or more. Aggregate a longer period'
                + ' before acting on this one.'
        });
      }
    }
  });

  out.sort((a, b) => b.money - a.money);
  return out;
}

/* ====================================================================
   FORMATTING
   ==================================================================== */

const DASH = '—';

function money(v) {
  if (v == null || !isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  if (a >= 10) return '$' + v.toFixed(0);
  return '$' + v.toFixed(2);
}
function num(v) {
  if (v == null || !isFinite(v)) return DASH;
  return Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(1) + 'K'
                            : Math.round(v).toLocaleString('en-GB');
}
function pct(v, dp) {
  if (v == null || !isFinite(v)) return DASH;
  return (v * 100).toFixed(dp == null ? 1 : dp) + '%';
}

/**
 * The change, with its direction coloured by whether it is good.
 *
 * `lowerIsBetter` exists because CPI and spend are the two figures on this
 * page where down is up. A single green-for-rising rule would paint a rising
 * CPI as good news.
 */
function delta(cur, prev, lowerIsBetter) {
  if (cur == null || prev == null || !prev || !isFinite(cur) || !isFinite(prev)) {
    return '<span class="d flat">' + DASH + '</span>';
  }
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return '<span class="d flat">no change</span>';
  const good = lowerIsBetter ? d < 0 : d > 0;
  return '<span class="d ' + (good ? 'up' : 'down') + '">'
    + (d > 0 ? '▲' : '▼') + ' ' + Math.abs(d * 100).toFixed(1) + '%</span>';
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export {
  fold, decompose, payerPctIsReal, findings,
  money, num, pct, delta, esc, ratio, DASH
};
