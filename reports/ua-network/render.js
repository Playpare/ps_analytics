/**
 * UA Network Performance — the view.
 *
 * Six tiles, four charts and a table, all of it period totals except the two
 * cohort curves. No font sizes are set here or in ua-network.css: the scale
 * comes from report-type.css, which is what the other six reports are sized
 * by, so this page lands where they land without anyone matching it by eye.
 */

import {
  fold, findings, cohortPayerCheck, PLAUSIBLE_PAYER_RATE,
  money, num, pct, delta, esc, ratio, DASH
} from './ua-network.js';

const g = (id) => document.getElementById(id);
const charts = {};

/* Categorical slots, assigned in a fixed order and never cycled: a network
   keeps its colour when the list is filtered, so the eye can follow one
   series between cards. A seventh network folds into "Other". */
const SLOTS = ['--n1', '--n2', '--n3', '--n4', '--n5', '--n6'];
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let colourOf = {};
function assignColours(names) {
  colourOf = {};
  names.forEach((nm, i) => {
    colourOf[nm] = i < SLOTS.length ? css(SLOTS[i]) : css('--t3');
  });
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
      x: { grid: { display: false },
           ticks: { color: css('--t2'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      y: { grid: { color: css('--grid') }, border: { display: false },
           ticks: { color: css('--t2'), callback: yFmt, maxTicksLimit: 6 },
           beginAtZero: true }
    }
  };
}

function legend(id, names) {
  const el = g(id);
  if (!el) return;
  el.innerHTML = names.map((nm) =>
    '<span><i style="background:' + colourOf[nm] + '"></i>' + esc(nm) + '</span>').join('');
}

/** Explains an empty card in place, rather than leaving a blank rectangle. */
function saySo(id, text) {
  const el = g(id);
  if (!el) return;
  const box = el.closest('.chartbox') || el.parentNode;
  box.innerHTML = '<div class="empty">' + esc(text) + '</div>';
}

/* ====================================================================
   KPI ROW — six period totals
   ==================================================================== */

function renderKpis(cur, prev) {
  const tiles = [
    ['Spend', money(cur.spend), delta(cur.spend, prev.spend, true), 'what we paid'],
    ['Installs', num(cur.installs), delta(cur.installs, prev.installs), 'what we bought'],
    ['CPI', money(cur.cpi), delta(cur.cpi, prev.cpi, true), 'spend ÷ installs'],
    ['Revenue', money(cur.revenue), delta(cur.revenue, prev.revenue), 'IAP + ads, in period'],
    ['Return on spend', pct(cur.roas, 0), delta(cur.roas, prev.roas), 'revenue ÷ spend'],
    ['Revenue per install', money(cur.arpi), delta(cur.arpi, prev.arpi), 'revenue ÷ installs']
  ];
  g('kpis').innerHTML = tiles.map((t) =>
    '<div class="kpi"><div class="l">' + t[0] + '</div><div class="v">' + t[1]
    + '</div>' + t[2] + '<div class="s">' + t[3] + '</div></div>').join('');
}

/* ====================================================================
   DAILY SPEND AND REVENUE — period, not cohort
   ==================================================================== */

function renderDaily(daily) {
  if (!daily.length) { saySo('cDaily', 'No daily rows in this window.'); return; }

  const opts = axes(money);
  opts.scales.x.stacked = true;
  opts.scales.y.stacked = true;

  mk('cDaily', {
    type: 'bar',
    data: {
      labels: daily.map((r) => r.date.slice(5)),
      datasets: [
        { type: 'line', label: 'Spend', data: daily.map((r) => r.spend),
          borderColor: css('--coral'), backgroundColor: css('--coral'),
          borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.3, order: 0 },
        { type: 'bar', label: 'IAP revenue', data: daily.map((r) => r.iapRevenue),
          backgroundColor: css('--blue'), stack: 'r', order: 1,
          borderColor: css('--card'), borderWidth: { top: 2 }, borderSkipped: false },
        { type: 'bar', label: 'Ad revenue', data: daily.map((r) => r.adRevenue),
          backgroundColor: css('--teal'), stack: 'r', order: 1,
          borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: false }
      ]
    },
    options: opts
  });
}

/* ====================================================================
   RETURN ON SPEND BY NETWORK — period
   ==================================================================== */

function renderByNetwork(rows) {
  const data = rows.map((r) => {
    const t = fold([r]);
    return { name: r.channel, roas: t.roas, spend: t.spend };
  }).filter((x) => x.roas != null);

  if (!data.length) { saySo('cNetRoas', 'No spend in this window.'); return; }

  const opts = axes((v) => (v * 100).toFixed(0) + '%');
  opts.indexAxis = 'y';
  opts.interaction = { mode: 'nearest', intersect: true };
  opts.scales = {
    x: { grid: { color: css('--grid') }, border: { display: false },
         ticks: { color: css('--t2'), callback: (v) => (v * 100).toFixed(0) + '%' },
         beginAtZero: true },
    y: { grid: { display: false }, ticks: { color: css('--t1') } }
  };
  opts.plugins.tooltip.callbacks = {
    label: (c) => ' ' + pct(c.parsed.x, 0) + '  on ' + money(data[c.dataIndex].spend)
  };

  mk('cNetRoas', {
    type: 'bar',
    data: {
      labels: data.map((d) => d.name),
      datasets: [{
        label: 'Return on spend', data: data.map((d) => d.roas),
        backgroundColor: data.map((d) => colourOf[d.name]),
        borderRadius: 4, borderSkipped: false, maxBarThickness: 26
      }]
    },
    options: opts
  });
  g('netRoasNote').textContent = 'Revenue that arrived in this window against'
    + ' spend in the same window. 100% is break-even.';
}

/* ====================================================================
   COHORT CURVES — the only two cohort measures on the page
   ==================================================================== */

const ROAS_POINTS = [
  ['roasD0', 0], ['roasD1', 1], ['roasD3', 3], ['roasD7', 7],
  ['roasD14', 14], ['roasD21', 21], ['roasD28', 28], ['roasD30', 30]
];
const RET_POINTS = [['d1', 1], ['d3', 3], ['d7', 7], ['d14', 14], ['d30', 30]];

/**
 * A real day axis, not evenly spaced labels: D0 to D1 is one day and D21 to
 * D28 is seven, and spacing them equally draws a curve that flattens where it
 * does not.
 */
function dayAxis(points, min) {
  return {
    type: 'linear', min: min, max: 30, grid: { display: false },
    ticks: {
      color: css('--t2'), stepSize: 1, autoSkip: false,
      callback: (v) => (points.some(([, d]) => d === v) ? 'D' + v : '')
    }
  };
}

function renderCurve(canvasId, legendId, noteId, rows, points, min, label) {
  const sets = rows.map((r) => ({
    label: r.channel,
    data: points.map(([k, d]) => ({ x: d, y: r[k] == null ? null : Number(r[k]) / 100 })),
    borderColor: colourOf[r.channel], backgroundColor: colourOf[r.channel],
    borderWidth: 2, pointRadius: 3.5, pointHoverRadius: 6, tension: 0, spanGaps: true
  }));

  if (!sets.some((s) => s.data.some((p) => p.y != null))) {
    saySo(canvasId, 'No matured ' + label + ' figures in this window yet.');
    if (noteId) g(noteId).textContent = '';
    return;
  }

  const opts = axes((v) => (v * 100).toFixed(0) + '%');
  opts.scales.x = dayAxis(points, min);
  mk(canvasId, { type: 'line', data: { datasets: sets }, options: opts });
  legend(legendId, rows.map((r) => r.channel));

  if (noteId) {
    const measured = points.filter(([k]) => rows.some((r) => r[k] != null)).length;
    g(noteId).textContent = measured + ' measured point'
      + (measured === 1 ? '' : 's') + ' per network, joined by straight lines.'
      + ' Nothing between them is drawn as data.';
  }
}

/* ====================================================================
   NETWORK TABLE — period totals, plus the two cohort columns
   ==================================================================== */

const COLUMNS = [
  ['Network', (r, t) => '<span class="dot" style="background:' + colourOf[r.channel]
    + '"></span>' + esc(r.channel), 'l'],
  ['Spend', (r, t) => money(t.spend)],
  ['Installs', (r, t) => num(t.installs)],
  ['CPI', (r, t) => money(t.cpi)],
  ['Revenue', (r, t) => money(t.revenue)],
  ['IAP', (r, t) => money(t.iapRevenue)],
  ['Ads', (r, t) => money(t.adRevenue)],
  ['Rev / install', (r, t) => money(t.arpi)],
  ['Return', (r, t) => pct(t.roas, 0)],
  ['D7 ROAS', (r, t) => pct(t.roasD7 == null ? null : t.roasD7 / 100, 0)],
  ['D7 retention', (r, t) => pct(t.retD7 == null ? null : t.retD7 / 100, 0)]
];

function renderTable(rows) {
  const body = rows.map((r) => {
    const t = fold([r]);
    return '<tr>' + COLUMNS.map((c) =>
      '<td' + (c[2] === 'l' ? ' class="l"' : '') + '>' + c[1](r, t) + '</td>'
    ).join('') + '</tr>';
  }).join('');

  g('tbl').innerHTML = '<thead><tr>'
    + COLUMNS.map((c, i) => '<th' + (i === 0 ? ' class="l"' : '') + '>' + c[0] + '</th>').join('')
    + '</tr></thead><tbody>' + body + '</tbody>';
}

/* ====================================================================
   WHAT MOVED
   ==================================================================== */

function renderFindings(curRows, prevRows) {
  const list = findings(curRows, prevRows);
  const el = g('findings');
  if (!list.length) {
    el.innerHTML = '<div class="finding quiet"><span class="ic">STEADY</span><div>'
      + 'Nothing moved far enough to report<small>No network worth 2% or more of'
      + ' the window’s spend changed its return, its spend or its CPI by'
      + ' enough to be worth a line.</small></div></div>';
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
  const o = fold(rest);
  return sorted.slice(0, 6).concat([{
    channel: 'Other (' + rest.length + ')',
    installs: o.installs, spend: o.spend, cost: o.spend,
    revenue: o.revenue, adRevenue: o.adRevenue, iapRevenue: o.iapRevenue,
    d7: o.retD7, roasD7: o.roasD7
  }]);
}

/**
 * Why a cohort card is empty, in one sentence rather than a row of dashes.
 *
 * Three causes look identical on screen and only one is worth waiting out.
 * The backend tells them apart by what it sends: a deployed script with
 * nothing to report sends null, one that has never heard of the column sends
 * nothing at all, and a feed that is reporting something impossible sends a
 * number.
 */
function renderWarning(rows, channelSrc) {
  const warn = g('srcWarn');
  const COHORT_KEYS = ['roasD7', 'd7'];
  const knows = rows.some((r) => COHORT_KEYS.some((k) => k in r));

  if (rows.length && !knows) {
    warn.innerHTML = '<b>The backend has not been redeployed.</b> It is'
      + ' answering without the cohort columns, so the ROAS and retention'
      + ' curves are blank. The totals above are unaffected.';
    warn.hidden = false;
    return;
  }
  if (channelSrc === 'legacy') {
    warn.innerHTML = 'This window is served from the legacy channel list,'
      + ' which carries no cohort columns, so the two curves are blank for a'
      + ' reason that is not immaturity.';
    warn.hidden = false;
    return;
  }

  /* The payer columns are not drawn anywhere any more, but they are still in
     the payload, and what they say is worth saying once: a payer rate three
     orders of magnitude below any real game is a broken measurement, not a
     small number, and somebody should know before they conclude the game has
     stopped monetising. */
  const payer = cohortPayerCheck(rows);
  if (payer && !payer.plausible) {
    warn.innerHTML = '<b>Adjust is reporting ' + num(payer.payers) + ' D7 payers'
      + ' against ' + num(payer.installs) + ' installs</b> — a payer rate of '
      + pct(payer.rate, 4) + ', where a game of this kind runs between 1% and 3%.'
      + ' That is three orders of magnitude out, so it is most likely the'
      + ' purchase event not being mapped to revenue in Adjust rather than'
      + ' anything about the game. Nothing on this page is built on it; the IAP'
      + ' figures above come from the period revenue columns.';
    warn.hidden = false;
    return;
  }
  warn.hidden = true;
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

  renderWarning(curUa.channels || [], curUa.channelSrc);
  renderKpis(cur, prev);
  renderFindings(curRows, prevRows);
  renderDaily(daily);
  renderByNetwork(curRows);
  renderCurve('cRoas', 'lgRoas', 'roasNote', curRows, ROAS_POINTS, 0, 'ROAS');
  renderCurve('cRet', 'lgRet', null, curRows, RET_POINTS, 1, 'retention');
  renderTable(curRows);
}

export function showError(message) {
  const el = g('fatal');
  el.textContent = message;
  el.hidden = false;
}
