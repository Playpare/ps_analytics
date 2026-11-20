/**
 * UA Network Performance — the view.
 *
 * Five cards and a table, which is the whole page. The mockup had eleven KPI
 * tiles and seven charts; most of the cuts were things that could not be
 * measured (see ua-network.js), and the rest were figures already on screen
 * somewhere else. Total revenue, IAP revenue and ad revenue were three tiles
 * above a chart of exactly those three series. LTV D7 is D7 ROAS times CPI.
 * Payers is the denominator of the payer % beside it. A tile that restates
 * its neighbour costs a reader the time to work out that it is the same
 * number.
 */

import {
  fold, decompose, findings, money, num, pct, delta, esc, ratio, DASH
} from './ua-network.js';

const g = (id) => document.getElementById(id);
const charts = {};

/* The categorical slots from the stylesheet, assigned in a fixed order and
   never cycled: a network keeps its colour when the list is filtered, so the
   eye can follow one series between cards. A ninth network would fold into
   "Other" rather than be handed a generated hue. */
const SLOTS = ['--n1', '--n2', '--n3', '--n4', '--n5', '--n6'];
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let colourOf = {};
function assignColours(names) {
  colourOf = {};
  names.slice(0, SLOTS.length).forEach((n, i) => { colourOf[n] = css(SLOTS[i]); });
  names.slice(SLOTS.length).forEach((n) => { colourOf[n] = css('--t3'); });
}

function mk(id, cfg) {
  const el = g(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new window.Chart(el, cfg);
}

/* One axis, always. Two y-scales let any pair of series be drawn as agreeing
   by choosing the scales, which is the commonest way a chart lies. */
function axes(yFmt) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--card2'), borderColor: css('--borderB'),
        borderWidth: 1, titleColor: css('--t1'), bodyColor: css('--t1'),
        padding: 10,
        callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + yFmt(c.parsed.y) }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: css('--t2'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      y: { grid: { color: css('--grid') }, border: { display: false },
           ticks: { color: css('--t2'), callback: yFmt, maxTicksLimit: 6 },
           beginAtZero: true }
    }
  };
}

function legend(id, names) {
  const el = g(id);
  if (!el) return;
  el.innerHTML = names.map((n) =>
    '<span><i style="background:' + colourOf[n] + '"></i>' + esc(n) + '</span>').join('');
}

/** Explains an empty card in place, rather than leaving a blank rectangle. */
function saySo(id, text) {
  const el = g(id);
  if (!el) return;
  const box = el.closest('.chartbox') || el.parentNode;
  box.innerHTML = '<div class="empty">' + esc(text) + '</div>';
}

/* ====================================================================
   KPI ROW — six, each answering a different question
   ==================================================================== */

function renderKpis(cur, prev) {
  const tiles = [
    ['Spend', money(cur.spend), delta(cur.spend, prev.spend, true), 'what we paid'],
    ['Installs', num(cur.installs), delta(cur.installs, prev.installs), 'what we bought'],
    ['CPI', money(cur.cpi), delta(cur.cpi, prev.cpi, true), 'spend ÷ installs'],
    ['D7 ROAS', pct(cur.roasD7, 0), delta(cur.roasD7, prev.roasD7), 'cohort IAP ÷ spend'],
    ['Payer %', pct(cur.payerPct, 2), delta(cur.payerPct, prev.payerPct), 'D7 payers ÷ installs'],
    ['ARPPU', money(ratio(cur.cohortIap, cur.payers)),
      delta(ratio(cur.cohortIap, cur.payers), ratio(prev.cohortIap, prev.payers)),
      'D7 IAP ÷ D7 payers']
  ];
  g('kpis').innerHTML = tiles.map((t) =>
    '<div class="kpi"><div class="l">' + t[0] + '</div><div class="v">' + t[1]
    + '</div>' + t[2] + '<div class="s">' + t[3] + '</div></div>').join('');
}

/* ====================================================================
   THE FOUR-FACTOR WATERFALL — the reason the page exists
   ==================================================================== */

function renderWaterfall(cur, prev) {
  const d = decompose(cur, prev);
  if (!d) {
    saySo('cWaterfall', cur.cohortIap == null
      ? 'No matured D7 cohort in this window yet, so there is nothing to split.'
      : 'One of the two periods has no cohort revenue, and a change needs both.');
    g('wfNote').textContent = '';
    return;
  }

  /* A floating bar per factor, each starting where the last one ended, so the
     four add back to the whole rather than being four percentages in a row. */
  const bars = [[0, d.from]];
  const labels = ['Previous'];
  const cols = [css('--t3')];
  const values = [d.from];
  let run = d.from;
  d.parts.forEach((p) => {
    bars.push([run, run + p.effect]);
    run += p.effect;
    labels.push(p.label);
    cols.push(p.effect >= 0 ? css('--green') : css('--coral'));
    values.push(p.effect);
  });
  bars.push([0, d.to]);
  labels.push('This period');
  cols.push(css('--blue'));
  values.push(d.to);

  /* Floor the axis below the smallest bar: from zero, four changes of a few
     per cent each are four invisible slivers on top of one tall column. */
  const floor = Math.min(...bars.flat().filter((v) => v > 0)) * 0.85;
  const opts = axes(money);
  opts.interaction = { mode: 'nearest', intersect: true };
  opts.scales.y.beginAtZero = false;
  opts.scales.y.min = floor;
  opts.plugins.tooltip.callbacks = {
    label: (c) => {
      const v = values[c.dataIndex];
      const ends = c.dataIndex === 0 || c.dataIndex === values.length - 1;
      return ends ? ' ' + money(v)
                  : ' ' + (v >= 0 ? '+' : '−') + money(Math.abs(v));
    }
  };

  mk('cWaterfall', {
    type: 'bar',
    data: { labels, datasets: [{
      label: 'D7 IAP',
      data: bars.map((b, i) => (i === 0 || i === bars.length - 1) ? [floor, b[1]] : b),
      backgroundColor: cols, borderRadius: 4, borderSkipped: false, maxBarThickness: 56
    }] },
    options: opts
  });

  const biggest = d.parts.slice().sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))[0];
  g('wfNote').innerHTML = 'D7 IAP revenue moved '
    + (d.total >= 0 ? '+' : '−') + money(Math.abs(d.total))
    + '. Most of it is <b>' + esc(biggest.label) + '</b> ('
    + (biggest.effect >= 0 ? '+' : '−') + money(Math.abs(biggest.effect)) + ').';
}

/* ====================================================================
   DAILY SPEND AND COHORT REVENUE
   ==================================================================== */

function renderDaily(daily) {
  if (!daily.length) { saySo('cDaily', 'No daily rows in this window.'); return; }

  const labels = daily.map((r) => r.date.slice(5));
  const opts = axes(money);
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;

  mk('cDaily', {
    type: 'bar',
    data: { labels, datasets: [
      { type: 'line', label: 'Spend', data: daily.map((r) => r.spend),
        borderColor: css('--coral'), backgroundColor: css('--coral'),
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.3, order: 0 },
      { type: 'bar', label: 'D7 IAP revenue', data: daily.map((r) => r.cohortIapD7),
        backgroundColor: css('--blue'), stack: 'r', order: 1,
        borderColor: css('--card'), borderWidth: { top: 2 }, borderSkipped: false },
      { type: 'bar', label: 'Ad revenue', data: daily.map((r) => r.adRevenue),
        backgroundColor: css('--teal'), stack: 'r', order: 1,
        borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: false }
    ] },
    options: opts
  });

  /* The last rows of a cohort series are blank by construction, and a reader
     who does not know that sees a cliff. Say which days are still filling. */
  const immature = daily.filter((r) => r.cohortIapD7 == null).length;
  g('dailyNote').textContent = immature
    ? 'The last ' + immature + ' day' + (immature === 1 ? '' : 's')
      + ' have no D7 figure yet — those cohorts are younger than seven days.'
    : '';
}

/* ====================================================================
   ROAS CURVE — the eight points that were measured, and no others
   ==================================================================== */

const ROAS_POINTS = [
  ['roasD0', 0], ['roasD1', 1], ['roasD3', 3], ['roasD7', 7],
  ['roasD14', 14], ['roasD21', 21], ['roasD28', 28], ['roasD30', 30]
];

function renderRoas(rows) {
  const names = rows.map((r) => r.channel);
  const sets = rows.map((r) => ({
    label: r.channel,
    data: ROAS_POINTS.map(([k, d]) => ({
      x: d, y: r[k] == null ? null : Number(r[k]) / 100
    })),
    borderColor: colourOf[r.channel], backgroundColor: colourOf[r.channel],
    borderWidth: 2, pointRadius: 3.5, pointHoverRadius: 6,
    tension: 0, spanGaps: true
  }));

  if (!sets.some((s) => s.data.some((p) => p.y != null))) {
    saySo('cRoas', 'No matured ROAS figures in this window yet.');
    return;
  }

  const opts = axes((v) => (v * 100).toFixed(0) + '%');
  /* A real day axis, not eight evenly spaced labels: the gap from D0 to D1 is
     one day and the gap from D21 to D28 is seven, and spacing them equally
     draws a curve that flattens where it does not. */
  opts.scales.x = {
    type: 'linear', min: 0, max: 30,
    grid: { display: false },
    ticks: {
      color: css('--t2'), stepSize: 1, autoSkip: false,
      callback: (v) => (ROAS_POINTS.some(([, d]) => d === v) ? 'D' + v : '')
    }
  };
  /* Break-even, which is what the whole chart is read against. */
  opts.plugins.annotation = undefined;
  mk('cRoas', { type: 'line', data: { datasets: sets }, options: opts });
  legend('lgRoas', names);

  const measured = ROAS_POINTS.filter(([k]) => rows.some((r) => r[k] != null)).length;
  g('roasNote').textContent = measured + ' measured point'
    + (measured === 1 ? '' : 's') + ' per network, joined by straight lines.'
    + ' Nothing between them is drawn as data, and payback is not estimated'
    + ' from a fitted curve.';
}

/* ====================================================================
   RETENTION — five measured points
   ==================================================================== */

const RET_POINTS = [['d1', 1], ['d3', 3], ['d7', 7], ['d14', 14], ['d30', 30]];

function renderRetention(rows) {
  const sets = rows.map((r) => ({
    label: r.channel,
    data: RET_POINTS.map(([k, d]) => ({ x: d, y: r[k] == null ? null : Number(r[k]) / 100 })),
    borderColor: colourOf[r.channel], backgroundColor: colourOf[r.channel],
    borderWidth: 2, pointRadius: 3.5, pointHoverRadius: 6, tension: 0, spanGaps: true
  }));
  if (!sets.some((s) => s.data.some((p) => p.y != null))) {
    saySo('cRet', 'No retention figures in this window yet.');
    return;
  }
  const opts = axes((v) => (v * 100).toFixed(0) + '%');
  opts.scales.x = {
    type: 'linear', min: 1, max: 30, grid: { display: false },
    ticks: {
      color: css('--t2'), stepSize: 1, autoSkip: false,
      callback: (v) => (RET_POINTS.some(([, d]) => d === v) ? 'D' + v : '')
    }
  };
  mk('cRet', { type: 'line', data: { datasets: sets }, options: opts });
  legend('lgRet', rows.map((r) => r.channel));
}

/* ====================================================================
   DAILY PAYER %

   Combined across networks, not per network, because the payload carries one
   daily series for the whole account — `channelDaily` folds the channels. A
   per-network daily line would need a channel-by-day dataset, and inventing
   one by spreading the period total across days would draw a line nobody
   measured. Per-network comparison lives in the table instead.
   ==================================================================== */

function renderPayerDaily(daily) {
  const pts = daily.map((r) => ({
    x: r.date.slice(5),
    y: (r.payersD7 == null || !r.installs) ? null : r.payersD7 / r.installs
  }));
  if (!pts.some((p) => p.y != null)) {
    saySo('cPayer', 'No matured D7 payer figures in this window yet.');
    return;
  }
  const opts = axes((v) => (v * 100).toFixed(2) + '%');
  opts.scales.y.beginAtZero = false;
  mk('cPayer', {
    type: 'line',
    data: { labels: pts.map((p) => p.x), datasets: [{
      label: 'Payer %', data: pts.map((p) => p.y),
      borderColor: css('--teal'), backgroundColor: css('--teal'),
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.3, spanGaps: true
    }] },
    options: opts
  });
}

/* ====================================================================
   NETWORK TABLE — ten columns
   ==================================================================== */

const COLUMNS = [
  ['Network', (r, t) => '<span class="dot" style="background:' + colourOf[r.channel]
    + '"></span>' + esc(r.channel), 'left'],
  ['Spend', (r, t) => money(t.spend)],
  ['Installs', (r, t) => num(t.installs)],
  ['CPI', (r, t) => money(t.cpi)],
  ['D7 ROAS', (r, t) => pct(t.roasD7, 0)],
  ['D7 payers', (r, t) => num(t.payers)],
  ['Payer %', (r, t) => pct(t.payerPct, 2)],
  ['Purch / payer', (r, t) => (t.purchPerPayer == null ? DASH : t.purchPerPayer.toFixed(2))],
  ['Avg price', (r, t) => money(t.avgPrice)],
  ['D7 retention', (r, t) => pct(t.retD7 == null ? null : t.retD7 / 100, 0)]
];

function renderTable(cur, prev) {
  const prevBy = {};
  prev.forEach((r) => { prevBy[r.channel] = r; });

  const body = cur.map((r) => {
    const t = fold([r]);
    const p = prevBy[r.channel] ? fold([prevBy[r.channel]]) : null;
    /* Only payer % is shaded, and only when the change clears its own noise
       floor. Shading every column that fell by a fixed percentage is what
       made the mockup's table red on the smallest networks every day. */
    let cls = '';
    if (p) {
      const n1 = t.installs, n2 = p.installs;
      if (n1 && n2 && t.payerPct != null && p.payerPct != null) {
        const se = Math.sqrt(t.payerPct * (1 - t.payerPct) / n1
                           + p.payerPct * (1 - p.payerPct) / n2);
        if (se && (t.payerPct - p.payerPct) / se <= -1.96) cls = 'bad';
      }
    }
    return '<tr>' + COLUMNS.map((c, i) => {
      const align = c[2] === 'left' ? ' class="l"' : '';
      const shade = (i === 6 && cls) ? ' class="' + cls + '"' : align;
      return '<td' + shade + '>' + c[1](r, t) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  g('tbl').innerHTML = '<thead><tr>'
    + COLUMNS.map((c, i) => '<th' + (i === 0 ? ' class="l"' : '') + '>' + c[0] + '</th>').join('')
    + '</tr></thead><tbody>' + body + '</tbody>';
}

/* ====================================================================
   FINDINGS
   ==================================================================== */

function renderFindings(curRows, prevRows) {
  const list = findings(curRows, prevRows);
  const el = g('findings');
  if (!list.length) {
    el.innerHTML = '<div class="finding quiet"><span class="ic">NONE</span><div>'
      + 'No change clears its own noise floor<small>Every network is within the'
      + ' range that this many installs could produce by chance. That is not the'
      + ' same as nothing having changed — it is that nothing changed by more'
      + ' than this volume can measure.</small></div></div>';
    return;
  }
  el.innerHTML = list.map((f) =>
    '<div class="finding ' + f.tone + '"><span class="ic">' + esc(f.tag) + '</span>'
    + '<div>' + esc(f.head) + '<small>' + f.body + '</small></div></div>').join('');
}

/* ====================================================================
   PAGE
   ==================================================================== */

/** Up to six networks by spend; the rest fold into one "Other" row. */
function topNetworks(rows) {
  const sorted = rows.slice().sort((a, b) =>
    (Number(b.spend != null ? b.spend : b.cost) || 0)
    - (Number(a.spend != null ? a.spend : a.cost) || 0));
  if (sorted.length <= 6) return sorted;
  const rest = sorted.slice(6);
  const other = fold(rest);
  return sorted.slice(0, 6).concat([{
    channel: 'Other (' + rest.length + ')',
    installs: other.installs, spend: other.spend, cost: other.spend,
    adRevenue: other.adRevenue, iapRevenue: other.iapRevenue,
    revenue: other.revenue, payersD7: other.payers, purchD7: other.purchases,
    cohortIapD7: other.cohortIap, d7: other.retD7
  }]);
}

export function renderPage(curPayload, prevPayload, win, days) {
  const curUa = (curPayload && curPayload.ua) || {};
  const prevUa = (prevPayload && prevPayload.ua) || {};
  const curRows = topNetworks(curUa.channels || []);
  const prevRows = prevUa.channels || [];
  const daily = curUa.channelDaily || [];

  assignColours(curRows.map((r) => r.channel));

  const cur = fold(curRows);
  const prev = fold(prevRows);

  g('period').textContent = win.cur.from + ' → ' + win.cur.to
    + '  ·  against the ' + days + ' days before it';

  /* WHY THE COHORT CARDS ARE EMPTY, in one sentence instead of a page of
     dashes.
     
     There are three different reasons they can be, and they look identical on
     screen. Only the third is the page's own business:

       the backend has not been redeployed - the Channel Performance tab has
         the columns, the deployed script has no idea they exist, and every
         cohort field is simply absent from the payload
       the legacy channel list is being served - that fallback never carried
         payer columns at all
       the cohorts have not matured - the real one, and the only one worth
         waiting out

     The first is told apart from the third by the KEY being missing rather
     than null: a deployed backend that has nothing to report sends null, and
     one that has never heard of the column sends nothing. */
  const rows = curUa.channels || [];
  const COHORT_KEYS = ['payersD7', 'purchD7', 'cohortIapD7'];
  const knowsCohorts = rows.some((r) => COHORT_KEYS.some((k) => k in r));
  const warn = g('srcWarn');

  if (rows.length && !knowsCohorts) {
    warn.innerHTML = '<b>The backend has not been redeployed.</b> It is'
      + ' answering without the payer and cohort columns — not reporting them'
      + ' as empty, but not carrying them at all — so every card built on the'
      + ' four factors is blank. Spend, installs and CPI are unaffected.';
    warn.hidden = false;
  } else if (curUa.channelSrc === 'legacy') {
    warn.innerHTML = 'This window is served from the legacy channel list,'
      + ' which has no payer or cohort columns, so the four-factor cards are'
      + ' blank for a reason that is not immaturity.';
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }

  renderKpis(cur, prev);
  renderWaterfall(cur, prev);
  renderFindings(curRows, prevRows);
  renderDaily(daily);
  renderRoas(curRows);
  renderRetention(curRows);
  renderPayerDaily(daily);
  renderTable(curRows, prevRows);
}

export function showError(message) {
  const el = g('fatal');
  el.textContent = message;
  el.hidden = false;
}
