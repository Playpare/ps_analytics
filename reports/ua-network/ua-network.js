/**
 * UA Network Performance — the arithmetic.
 *
 * TOTALS, EXCEPT ROAS AND RETENTION
 *
 * Every money and volume figure on this page is a PERIOD TOTAL: spend,
 * installs, revenue, IAP revenue, ad revenue, all summed over the days in the
 * window. Only ROAS and retention are cohort measures, because those two are
 * meaningless as anything else — a return on spend has to follow the cohort
 * that spend bought, and a retention rate has to follow the people it is a
 * rate of.
 *
 * The first version of this page was built the other way round, on the D7
 * cohort split of IAP revenue, and it was wrong in two separate ways:
 *
 *   The denominators did not match. Payers were summed over the days whose
 *   D7 cohort had matured; installs were summed over every day in the window.
 *   With half the window too young to have a D7 figure, that halves payer %
 *   on its own, for no reason visible anywhere on screen.
 *
 *   The cohort payer figures themselves are not usable. Over fourteen days
 *   the Channel Performance tab reported 42 D7 payers against 2.17 million
 *   Google Ads installs — a payer rate of 0.002%, where a game of this kind
 *   runs between 1% and 3%. A figure three orders of magnitude out is not a
 *   small number; it is a number measuring something else, and the likeliest
 *   cause is that the purchase event is not mapped to revenue in Adjust, in
 *   which case the cohort revenue metrics return almost nothing however long
 *   the backfill runs.
 *
 * So the four-factor split is gone from this page. It needs payers, payers
 * exist only as a cohort metric, and that metric is not currently reporting.
 * It can come back when `paying_users_d7` reports a plausible rate — and the
 * test suite holds a case that says what plausible means.
 */

/* ====================================================================
   FOLDING
   ==================================================================== */

/** null, not 0, when the denominator is missing. */
const ratio = (a, b) => (a == null || !b) ? null : a / b;

const n = (v) => Number(v) || 0;

/**
 * Fold channel rows into one set of period totals.
 *
 * Counts and money sum. The two rates fold by their own denominators:
 * retention is install-weighted and ROAS is cost-weighted, because that is
 * what each one is a rate OF. Weighting ROAS by installs would let a cheap,
 * high-volume channel speak for money it never spent.
 */
function fold(rows) {
  const t = { installs: 0, spend: 0, revenue: 0, adRevenue: 0, iapRevenue: 0 };
  let retW = 0, retN = 0, roasW = 0, roasN = 0;

  rows.forEach((r) => {
    const spend = n(r.spend != null ? r.spend : r.cost);
    t.installs   += n(r.installs);
    t.spend      += spend;
    t.revenue    += n(r.revenue);
    t.adRevenue  += n(r.adRevenue);
    t.iapRevenue += n(r.iapRevenue);

    if (r.d7 != null && r.installs) { retW += n(r.d7) * n(r.installs); retN += n(r.installs); }
    if (r.roasD7 != null && spend)  { roasW += n(r.roasD7) * spend;    roasN += spend; }
  });

  t.cpi = ratio(t.spend, t.installs);
  /* Period return: the money that arrived in the window against the money
     spent in it. Not a cohort figure and not labelled as one — it answers
     "did this window pay for itself", which is a different question from
     "will this cohort pay for itself". */
  t.roas = ratio(t.revenue, t.spend);
  t.arpi = ratio(t.revenue, t.installs);
  /* Cohort D7 ROAS, kept as the cohort measure it is. */
  t.roasD7 = roasN ? roasW / roasN : null;
  t.retD7 = retN ? retW / retN : null;
  return t;
}

/* ====================================================================
   WHAT MOVED

   Ranked by money, not by percentage. A list sorted by percentage puts the
   smallest channels at the top, which is how an alert list teaches people to
   stop reading it.

   No significance test here, because none of these are proportions: spend,
   installs and revenue are sums, and a sum is known exactly. What a reader
   needs is the size of the move in money, and whether the channel is big
   enough for that money to matter.
   ==================================================================== */

function findings(curRows, prevRows) {
  const prevBy = {};
  prevRows.forEach((r) => { prevBy[r.channel] = r; });

  const out = [];
  const totalSpend = fold(curRows).spend || 1;

  curRows.forEach((row) => {
    const p = prevBy[row.channel];
    if (!p) {
      const c = fold([row]);
      if (c.spend / totalSpend >= 0.02) {
        out.push({
          tone: 'good', tag: 'NEW', money: c.spend,
          head: row.channel + ': new this period',
          body: money(c.spend) + ' spent, ' + num(c.installs) + ' installs, '
              + 'at ' + money(c.cpi) + ' each. Nothing to compare it with yet.'
        });
      }
      return;
    }
    const c = fold([row]), q = fold([p]);

    /* A channel too small to matter is not worth a line, however it moved.
       Two per cent of the window's spend is the cut: below that, the biggest
       possible swing is still smaller than the rounding on the big channels. */
    if (c.spend / totalSpend < 0.02 && q.spend / totalSpend < 0.02) return;

    const dRev = c.revenue - q.revenue;
    const dSpend = c.spend - q.spend;
    const relRev = q.revenue ? dRev / q.revenue : null;
    const relSpend = q.spend ? dSpend / q.spend : null;

    /* Return moved and spend did not: the channel got better or worse at
       turning the same money into revenue, which is the finding worth having.
       Stated before the volume lines below, because it is the one that is
       about the channel rather than about the budget. */
    if (c.roas != null && q.roas != null && q.roas
        && Math.abs(c.roas - q.roas) / q.roas >= 0.15
        && (relSpend === null || Math.abs(relSpend) < 0.15)) {
      const worse = c.roas < q.roas;
      out.push({
        tone: worse ? 'bad' : 'good', tag: 'RETURN', money: Math.abs(dRev),
        head: row.channel + ': return on spend ' + (worse ? 'down ' : 'up ')
            + Math.abs((c.roas - q.roas) / q.roas * 100).toFixed(0) + '%',
        body: pct(q.roas, 0) + ' to ' + pct(c.roas, 0) + ' on roughly the same'
            + ' spend (' + money(q.spend) + ' then ' + money(c.spend) + ').'
            + ' Revenue moved ' + (dRev >= 0 ? '+' : '−') + money(Math.abs(dRev)) + '.'
      });
      return;
    }

    if (relSpend !== null && Math.abs(relSpend) >= 0.20) {
      const up = dSpend > 0;
      out.push({
        tone: 'warn', tag: up ? 'SPEND UP' : 'SPEND DOWN', money: Math.abs(dSpend),
        head: row.channel + ': spend ' + (up ? 'up ' : 'down ')
            + Math.abs(relSpend * 100).toFixed(0) + '%',
        body: money(q.spend) + ' to ' + money(c.spend) + '. CPI '
            + money(q.cpi) + ' to ' + money(c.cpi) + ', revenue '
            + (relRev === null ? 'unknown' : (relRev >= 0 ? 'up ' : 'down ')
               + Math.abs(relRev * 100).toFixed(0) + '%') + '.'
      });
      return;
    }

    if (c.cpi != null && q.cpi != null && q.cpi
        && Math.abs(c.cpi - q.cpi) / q.cpi >= 0.20) {
      const up = c.cpi > q.cpi;
      out.push({
        tone: up ? 'warn' : 'good', tag: 'CPI', money: Math.abs(dSpend),
        head: row.channel + ': CPI ' + (up ? 'up ' : 'down ')
            + Math.abs((c.cpi - q.cpi) / q.cpi * 100).toFixed(0) + '%',
        body: money(q.cpi) + ' to ' + money(c.cpi) + ' on '
            + num(c.installs) + ' installs.'
      });
    }
  });

  out.sort((a, b) => b.money - a.money);
  return out;
}

/* ====================================================================
   IS THE COHORT SIDE REPORTING AT ALL?

   The page draws two cohort cards and nothing else from cohort data, so
   when those are empty it has to say which emptiness it is. A payer rate
   three orders of magnitude below any real game is not a small number, it
   is a broken measurement, and it should be named rather than plotted.
   ==================================================================== */

/** The lowest payer rate any real game runs at. Below this, suspect the feed. */
const PLAUSIBLE_PAYER_RATE = 0.001;      // 0.1%

/**
 * What the cohort payer columns are saying, if anything.
 *
 * Returns null when nothing reported, which is the ordinary immature case,
 * and a verdict when something reported a figure too small to be real.
 */
function cohortPayerCheck(rows) {
  let payers = null, installs = 0;
  rows.forEach((r) => {
    if (r.payersD7 != null) {
      payers = (payers || 0) + n(r.payersD7);
      installs += n(r.installs);
    }
  });
  if (payers === null || !installs) return null;
  const rate = payers / installs;
  if (rate >= PLAUSIBLE_PAYER_RATE) return { rate, payers, installs, plausible: true };
  return { rate, payers, installs, plausible: false };
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
 * The change, coloured by whether it is good.
 *
 * `lowerIsBetter` exists because CPI and spend are the figures where down is
 * up. One green-for-rising rule would paint a rising CPI as good news.
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
  fold, findings, cohortPayerCheck, PLAUSIBLE_PAYER_RATE,
  money, num, pct, delta, esc, ratio, DASH
};
