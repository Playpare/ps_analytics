/**
 * ============================================================================
 * glance.js — the decision summary and the performance table
 * ============================================================================
 *
 * WHAT THIS IS FOR
 *
 * The page below this answers, in nine sections, what happened. A UA manager
 * opens it to answer something narrower: what needs a decision today. These
 * two sections answer that, and everything below them is the working.
 *
 * THE ONE RULE
 *
 * Every number here is a rollup of rows this file also renders, produced by
 * negative-spend.legacy.js's own verdict engine through the bridge. Nothing is
 * recomputed independently.
 *
 * That rule is the whole reason this file is careful. The live page currently
 * shows "Spend at risk $0.00 — 0 campaigns under their target" directly above
 * a list of three campaigns marked CUT, because two verdict engines answer the
 * same question on different bases: the KPI reads mature cohorts and goal-
 * window revenue, the table reads the whole window and all revenue. Both are
 * defensible; showing them side by side without saying so is not. A summary
 * that can disagree with the table beneath it is worse than no summary.
 *
 * So: one classification pass over overallCampaigns(W), and the three tiles
 * are three filters over that one list.
 */

import '../../design/reports/negative-spend/glance.css';
import { enhanceDate } from '../../src/shared/date-popup.js';

const B = () => window.__nsBridge;
const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------------------
 * Vocabulary — the report's own verdict strings, not a parallel set.
 * ------------------------------------------------------------------------- */
const ICON = {
  warn: '<path d="M8 1.6 1.4 13.2h13.2L8 1.6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.2v3.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.2" r=".95" fill="currentColor"/>',
  minus: '<circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.5"/><path d="M5.4 8h5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  check: '<circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.2 7.1 10l3.7-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  info:  '<circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.8v3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.1" r=".95" fill="currentColor"/>',
  up:    '<path d="M2.2 10.6 6 6.6l2.7 2.5 4.9-5.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.4 3.5h3.4v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};
const svgIcon = (k, cls) => `<svg class="${cls}" viewBox="0 0 16 16" fill="none" aria-hidden="true">${ICON[k]}</svg>`;

/* Verdicts that mean "nothing to decide" and are left out of the table. */
const INERT = { 'not active': 1, 'NO SPEND': 1 };

/* ---------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */
let GRAIN = 'weekly';
let CHART = 'money';             // 'money' = cost · revenue · gross, 'roas'
let ROASK = 'all';               // which revenue the ROAS lines use: all | iap | ad
let SELECTED = null;
const OPEN = new Set();
let MODEL = null;                // last built model, for redraws without a full render

/* ---------------------------------------------------------------------------
 * Model — one classification pass, shared by the tiles and the table
 * ------------------------------------------------------------------------- */
function build(W) {
  const b = B();
  const rows = b.overallCampaigns(W).filter((c) => !INERT[c.verdict] && c.cost > 0);
  const series = b.dailySeriesByCampaign();

  const nets = new Map();
  rows.forEach((c) => {
    const s = series.byKey.get(c.campaign + '||' + c.channel) || { cost: [], rev: [] };
    c._cost = s.cost; c._rev = s.rev; c._s = s;
    let n = nets.get(c.channel);
    if (!n) {
      n = { name: c.channel, campaigns: [], cost: 0, allRev: 0,
            matureCost: 0, revAtGoal: 0, target: null, budgetOnly: true };
      nets.set(c.channel, n);
    }
    n.campaigns.push(c);
    n.cost += c.cost;
    n.allRev += c.allRev;
    /* A network's ROAS is graded revenue over graded cost - never the mean of
       its campaigns' ratios, which would let a $200 campaign outvote a
       $40,000 one. Only rows carrying a real verdict contribute. */
    if (c.roas != null && c.target != null) {
      n.matureCost += c.matureCost;
      n.revAtGoal += c.revAtGoal;
      if (n.target == null) n.target = c.target;
    }
    if (!c.budgetOnly) n.budgetOnly = false;
  });

  const networks = [...nets.values()].map((n) => {
    n.cashGap = n.allRev - n.cost;
    n.roas = n.matureCost > 0 ? n.revAtGoal / n.matureCost : null;
    n.goal = [...new Set(n.campaigns.map((c) => c.goal).filter((g) => g && g !== '—'))].join(' / ');
    /* The worst thing true of any campaign under it, in the report's own order
       of severity. Over budget outranks a missing cap: a breach is a fact, an
       absent cap is the lack of one. */
    const order = ['FAIL - cut', 'OVER BUDGET', 'UNDER TARGET', 'NO BUDGET - set one',
                   'NO GOAL - map it', 'INSUFFICIENT DATA', 'PENDING', 'PASS'];
    n.verdict = order.find((v) => n.campaigns.some((c) => c.verdict === v)) || 'PASS';
    n.budget = n.campaigns.every((c) => c.budget != null)
      ? n.campaigns.reduce((s, c) => s + c.budget, 0) : null;
    n.uncapped = n.campaigns.filter((c) => c.budget == null).length;
    n._cost = sumSeries(n.campaigns.map((c) => c._cost));
    n._rev = sumSeries(n.campaigns.map((c) => c._rev));
    n._s = {};
    COHORT_KEYS.forEach((k) => { n._s[k] = sumSeries(n.campaigns.map((c) => (c._s && c._s[k]) || [])); });
    return n;
  }).sort((a, b2) => b2.cost - a.cost);

  return { W, rows, networks, days: series.days };
}

const COHORT_KEYS = ['cost', 'ad0', 'iap0', 'c7', 'ad7', 'iap7', 'c28', 'ad28', 'iap28'];

function sumSeries(list) {
  const n = Math.max(0, ...list.map((a) => a.length));
  const out = new Array(n).fill(0);
  list.forEach((a) => a.forEach((v, i) => { out[i] += v; }));
  return out;
}

/* ---------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------- */
const money = (v) => B().money(v);
const esc = (s) => B().esc(s);
const kmoney = (v) => (v < 0 ? '−' : '') +
  '$' + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Math.round(Math.abs(v)));

/* ---------------------------------------------------------------------------
 * Headline + the three decisions
 * ------------------------------------------------------------------------- */
function renderHead(m) {
  /* The headline sentence and its fact chips were removed; the page opens on
     three totals instead. They sum the same rows the table shows, so the
     cards and the table can never disagree. */
  $('glanceHead').innerHTML = '';

  const spend = m.rows.reduce((s, c) => s + c.cost, 0);
  const rev = m.rows.reduce((s, c) => s + c.allRev, 0);
  const gp = rev - spend;
  const w = m.W;
  const span = w.from && w.to ? `${B().shortDate(w.from)} – ${B().shortDate(w.to)}` : '';
  const roas = spend > 0 ? rev / spend : null;
  const margin = rev > 0 ? gp / rev : null;
  const camps = m.rows.length, nets = m.networks.length;

  /* Daily totals behind each card. Only the report theme reads data-spark
     (src/shared/report-pro.js draws them as the card's wave); without it the
     attribute is inert. */
  const n = (m.days || []).length;
  const daySum = (k) => Array.from({ length: n }, (_, i) =>
    m.rows.reduce((s, c) => s + (+((c[k] || [])[i]) || 0), 0));
  const spendD = daySum('_cost'), revD = daySum('_rev');
  const gpD = revD.map((v, i) => v - spendD[i]);
  const sparkAttr = (arr) => arr.length > 1
    ? ` data-spark="${arr.map((v) => Math.round(v)).join(',')}" data-spark-dates="${(m.days || []).join(',')}"` : '';
  const sparks = { 'k-spend': sparkAttr(spendD), 'k-rev': sparkAttr(revD), 'k-gp': sparkAttr(gpD) };

  const card = (cls, title, amt, sub) =>
    `<article class="act ${cls}"${sparks[cls.split(' ')[0]] || ''}>
       <div class="hd">${title}</div>
       <div class="amt">${amt}</div>
       <div class="g-why">${sub}</div>
     </article>`;

  $('glanceActs').innerHTML =
    card('k-spend', 'Total spend', money(spend),
      `${camps} campaign${camps === 1 ? '' : 's'} across ${nets} network${nets === 1 ? '' : 's'}` +
      (span ? `<span class="sub2">${esc(span)}</span>` : '')) +
    card('k-rev', 'Total revenue', money(rev),
      (roas != null ? `<b>${roas.toFixed(2)}x</b> back per $1 spent` : 'Nothing spent yet') +
      `<span class="sub2">IAP + ad revenue</span>`) +
    card(gp < 0 ? 'k-gp neg' : 'k-gp', 'Total gross profit',
      `<span class="gp-sign">${gp < 0 ? '▼' : '▲'}</span>${money(gp)}`,
      (margin != null ? `<b>${(margin * 100).toFixed(1)}%</b> of revenue` : '—') +
      `<span class="sub2">revenue − spend</span>`);
}

const shortName = (s) => String(s).replace(/^PS_AND_Supermarket_Simulator_/, '')
  .replace(/^Android_com\.playspare\.supermarket\.store\.simulator_/, '…');

/* ---------------------------------------------------------------------------
 * Buckets — daily / weekly / monthly
 * ------------------------------------------------------------------------- */
function bucketise(arr, days) {
  const size = GRAIN === 'daily' ? 1 : GRAIN === 'weekly' ? 7 : 30;
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    const end = Math.min(i + size - 1, arr.length - 1);
    out.push({
      v: arr.slice(i, i + size).reduce((a, b2) => a + b2, 0),
      from: days[i], to: days[end],
      label: size === 1 ? B().shortDate(days[i])
                        : B().shortDate(days[i]) + ' – ' + B().shortDate(days[end]),
    });
  }
  return out;
}

function spark(cost, rev, days) {
  const c = bucketise(cost, days).map((b2) => b2.v);
  const r = bucketise(rev, days).map((b2) => b2.v);
  if (c.length < 2) return '';
  const w = 112, h = 30, max = Math.max(...c, ...r, 1);
  const path = (a) => a.map((v, i) =>
    (i ? 'L' : 'M') + (i / (a.length - 1) * w).toFixed(1) + ' ' + (h - v / max * (h - 3) - 1.5).toFixed(1)).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="display:block">
    <path d="${path(c)}" fill="none" stroke="var(--g-cost)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${path(r)}" fill="none" stroke="var(--g-rev)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/* ---------------------------------------------------------------------------
 * Cells
 * ------------------------------------------------------------------------- */
/* Spend only. The budget caption (percent used, "no cap" notes) was removed
   from this column on purpose. */
function spendCell(o) {
  return `<div class="g-spend"><b>${money(o.cost)}</b></div>`;
}

/* ---------------------------------------------------------------------------
 * Table
 * ------------------------------------------------------------------------- */
function renderTable(m) {
  /* The detail chart may be sitting inside the table (under a campaign row).
     Park it back at the bottom of the card before the table is rebuilt, or
     the rebuild would destroy it. */
  const detail = $('perfDetail');
  detail.classList.remove('inrow');
  $('perfCard').appendChild(detail);

  const head = `<table><thead><tr>
    <th class="n" style="width:34px">#</th>
    <th style="width:24%">Network / campaign</th>
    <th style="width:11%">Trend<em>cost vs revenue</em></th>
    <th class="n" style="width:15%">Spend</th>
    <th class="n">Revenue<em>came back</em></th>
    <th class="n">Gross Profit<em>revenue − spend</em></th></tr></thead><tbody>`;

  let html = head;
  m.networks.forEach((net, ni) => {
    const open = OPEN.has(net.name);
    html += `<tr class="grow${SELECTED === 'n:' + net.name ? ' on' : ''}" data-k="n:${esc(net.name)}">
      <td class="n g-rank">${ni + 1}</td>
      <td><div class="g-nm${open ? ' open' : ''}"><span class="tw">▶</span><span>${esc(net.name)}
        <small>${net.campaigns.length} campaign${net.campaigns.length > 1 ? 's' : ''}${net.goal ? ' · goal ' + esc(net.goal) : ''}</small></span></div></td>
      <td>${spark(net._cost, net._rev, m.days)}</td>
      <td class="n">${spendCell(net)}</td>
      <td class="n">${money(net.allRev)}</td>
      <td class="n ${net.cashGap < 0 ? 'g-neg' : 'pos'}">${money(net.cashGap)}</td></tr>`;

    if (open) net.campaigns.slice().sort((a, b2) => b2.cost - a.cost).forEach((c, ci) => {
      html += `<tr class="grow camp${SELECTED === 'c:' + c.campaign + '||' + c.channel ? ' on' : ''}"
          data-k="c:${esc(c.campaign)}||${esc(c.channel)}">
        <td class="n g-rank">${ni + 1}.${ci + 1}</td>
        <td><div class="g-nm"><span>${esc(shortName(c.campaign))}<small>goal ${esc(c.goal)}</small></span></div></td>
        <td>${spark(c._cost, c._rev, m.days)}</td>
        <td class="n">${spendCell(c)}</td>
        <td class="n">${money(c.allRev)}</td>
        <td class="n ${c.cashGap < 0 ? 'g-neg' : 'pos'}">${money(c.cashGap)}</td></tr>`;
      /* A selected campaign gets its trend in a row directly beneath it. */
      if (SELECTED === 'c:' + c.campaign + '||' + c.channel) {
        html += `<tr class="cdrow"><td colspan="6"><div class="cdslot"></div></td></tr>`;
      }
    });
  });
  html += '</tbody></table>';

  $('perfTable').innerHTML = m.networks.length ? html
    : '<div class="empty">Nothing spent in this window.</div>';
  $('perfCard').hidden = !m.networks.length;
  $('perfKeys').innerHTML =
    `<span class="key" style="--k:var(--g-cost)"><i></i>Cost</span>
     <span class="key" style="--k:var(--g-rev)"><i></i>Revenue</span>`;

  const slot = $('perfTable').querySelector('.cdslot');
  if (slot) { detail.classList.add('inrow'); slot.appendChild(detail); }

  $('perfTable').querySelectorAll('tr.grow').forEach((tr) => {
    tr.onclick = () => {
      const clicked = tr.dataset.k, before = tr.getBoundingClientRect().top;
      let k = tr.dataset.k;
      if (k.startsWith('n:')) {
        const name = k.slice(2);
        OPEN.has(name) ? OPEN.delete(name) : OPEN.add(name);
      } else if (k === SELECTED) {
        /* Clicking the open campaign again closes its trend and hands the
           chart back to its network at the bottom of the card. */
        k = 'n:' + k.slice(2).split('||')[1];
      }
      SELECTED = k;
      renderTable(m); drawDetail(m);
      const again = [...$('perfTable').querySelectorAll('tr.grow')].find((r) => r.dataset.k === clicked);
      if (again) window.scrollBy(0, again.getBoundingClientRect().top - before);
    };
  });
}

/* ---------------------------------------------------------------------------
 * Detail chart — cost, revenue and gross profit (revenue − cost) per bucket
 * ------------------------------------------------------------------------- */
function selected(m) {
  if (!SELECTED) return null;
  if (SELECTED.startsWith('n:')) {
    const o = m.networks.find((n) => n.name === SELECTED.slice(2));
    return o ? { o, title: o.name, isNet: true } : null;
  }
  const [campaign, channel] = SELECTED.slice(2).split('||');
  const o = m.rows.find((c) => c.campaign === campaign && c.channel === channel);
  return o ? { o, title: shortName(o.campaign), isNet: false } : null;
}

function drawDetail(m) {
  const sel = selected(m), box = $('perfDetail');
  if (!sel) { box.classList.remove('on'); return; }
  box.classList.add('on');

  /* The viewBox is set to the plot's real pixel width, so one unit is one
     pixel and the text is never stretched. */
  const H = 300, PL = 72, PR = 18, PT = 16, PB = 32;
  const W = Math.max(560, Math.round($('pdPlot').clientWidth || 900));
  $('pdSvg').setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  const iw = W - PL - PR, ih = H - PT - PB;
  const cost = bucketise(sel.o._cost, m.days), rev = bucketise(sel.o._rev, m.days);
  const n = cost.length;
  if (!n) { box.classList.remove('on'); return; }
  const x = (i) => PL + (n === 1 ? iw / 2 : i / (n - 1) * iw);
  const unit =GRAIN === 'daily' ? 'days' : GRAIN === 'weekly' ? 'weeks' : 'months';

  /* Round axis steps (1, 2, 2.5, 5 × 10^n) so ticks read as numbers a person
     would say, and 0 always lands on a gridline. */
  const axis = (rawLo, rawHi) => {
    const rough = (rawHi - rawLo) / 4 || 1;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((v) => v >= rough) || 10 * mag;
    return { lo: Math.floor(rawLo / step) * step, hi: Math.ceil(rawHi / step) * step, step };
  };
  /* A line that skips missing points instead of dropping them to zero. */
  const lnGap = (vals, yOf) => {
    let d = '', pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yOf(v).toFixed(1) + ' ';
      pen = true;
    });
    return d.trim();
  };
  const stroke = (d, c, w = 2.5, extra = '') =>
    d ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>` : '';

  let body = '', pts = [], ax, yOf, fmt, legend = '';

  if (CHART === 'roas') {
    /* ROAS dN = cohort revenue at day N ÷ spend, both summed over the bucket.
       All = sheet cols L/M/N (IAP + ad), IAP = O/P/Q, Ad = R/S/T, spend = G.
       d7/d28 only count days whose cohort has reached that age, so recent
       buckets read as "not mature yet" rather than as a collapse to zero. */
    const S = sel.o._s || {};
    const bk = (k) => bucketise(S[k] || [], m.days).map((q) => q.v);
    const pick = (ad, iap) => (ROASK === 'ad' ? ad : ROASK === 'iap' ? iap : ad.map((v, i) => v + iap[i]));
    const c0 = bk('cost'), c7 = bk('c7'), c28 = bk('c28');
    const r0 = pick(bk('ad0'), bk('iap0'));
    const r7 = pick(bk('ad7'), bk('iap7'));
    const r28 = pick(bk('ad28'), bk('iap28'));
    const ratio = (r, c) => r.map((v, i) => (c[i] > 0 ? v / c[i] : null));
    const L = [
      { key: 'd0',  col: 'var(--teal)', vals: ratio(r0, c0) },
      { key: 'd7',  col: 'var(--amb)',  vals: ratio(r7, c7) },
      { key: 'd28', col: 'var(--pur)',  vals: ratio(r28, c28) },
    ];
    const vals = L.flatMap((l) => l.vals).filter((v) => v != null);
    ax = axis(0, Math.max(1.1, ...vals));
    fmt = (v) => (ax.step >= 1 ? v.toFixed(0) : ax.step >= 0.5 ? v.toFixed(1) : v.toFixed(2)) + 'x';
    yOf = (v) => PT + ih - (v - ax.lo) / ((ax.hi - ax.lo) || 1) * ih;

    /* 1.00x is break-even: every dollar spent came back. */
    body += `<line x1="${PL}" x2="${W - PR}" y1="${yOf(1).toFixed(1)}" y2="${yOf(1).toFixed(1)}" stroke="var(--target)" stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="${(W - PR - 4).toFixed(1)}" y="${(yOf(1) - 7).toFixed(1)}" text-anchor="end" font-size="13" font-weight="500" fill="var(--target)">1.00x break-even</text>`;
    L.forEach((l) => {
      body += stroke(lnGap(l.vals, yOf), l.col);
      /* a lone point between gaps still gets a mark */
      l.vals.forEach((v, i) => {
        if (v != null && l.vals[i - 1] == null && l.vals[i + 1] == null) {
          body += `<circle cx="${x(i).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="3.5" fill="${l.col}"/>`;
        }
      });
    });

    const word = ROASK === 'ad' ? 'Ad ROAS' : ROASK === 'iap' ? 'IAP ROAS' : 'ROAS';
    const show = (v) => (v == null ? '<span class="tip-na">not mature yet</span>' : v.toFixed(2) + 'x');
    pts = cost.map((k, i) => {
      const top = [L[2], L[1], L[0]].map((l) => l.vals[i]).find((v) => v != null);
      return { x: x(i), y: top == null ? null : yOf(top), label: k.label, dot: 'var(--text)',
        rows: L.map((l) => [`<i style="--k:${l.col}"></i>${word} ${l.key}`, show(l.vals[i])])
          .concat([['Spend', money(c0[i])]]) };
    });
    legend = L.map((l) => `<span class="key" style="--k:${l.col}"><i></i>${word} ${l.key}</span>`).join('') +
      `<span class="key key-dash" style="--k:var(--target)"><i></i>Break-even</span>`;
  } else {
    const gp = cost.map((k, i) => rev[i].v - k.v);
    const all = cost.map((k) => k.v).concat(rev.map((k) => k.v), gp);
    ax = axis(Math.min(...all, 0), Math.max(...all, 1));
    fmt = kmoney;
    yOf = (v) => PT + ih - (v - ax.lo) / ((ax.hi - ax.lo) || 1) * ih;
    const lnv = (vs) => vs.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yOf(v).toFixed(1)).join(' ');
    const y0 = yOf(0);
    if (ax.lo < 0) {
      body += `<line x1="${PL}" x2="${W - PR}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}" stroke="var(--mut)" stroke-opacity=".45" stroke-width="1" stroke-dasharray="4 4"/>`;
    }
    /* Below-zero gross profit, made impossible to miss: a red band over every
       losing period, a red fill between the line and $0, and the line itself
       redrawn red under $0. Bands go first so the lines sit on top. */
    const negI = gp.map((v, i) => (v < 0 ? i : -1)).filter((i) => i >= 0);
    if (negI.length) {
      const half = n > 1 ? iw / (n - 1) / 2 : iw / 2;
      negI.forEach((i) => {
        const a2 = Math.max(PL, x(i) - half), b2 = Math.min(W - PR, x(i) + half);
        body += `<rect x="${a2.toFixed(1)}" y="${PT}" width="${(b2 - a2).toFixed(1)}" height="${ih}" fill="var(--red)" fill-opacity=".09"/>`;
      });
      body += `<defs><clipPath id="pdNegClip"><rect x="${PL - 4}" y="${y0.toFixed(1)}" width="${iw + 8}" height="${(PT + ih - y0 + 4).toFixed(1)}"/></clipPath></defs>` +
        `<path d="${lnv(gp)} L ${x(n - 1).toFixed(1)} ${y0.toFixed(1)} L ${x(0).toFixed(1)} ${y0.toFixed(1)} Z" fill="var(--red)" fill-opacity=".22" clip-path="url(#pdNegClip)"/>`;
    }
    body += stroke(lnv(cost.map((k) => k.v)), 'var(--g-cost)') +
      stroke(lnv(rev.map((k) => k.v)), 'var(--g-rev)') +
      stroke(lnv(gp), 'var(--g-gp)');
    if (negI.length) {
      body += stroke(lnv(gp), 'var(--red)', 3, 'clip-path="url(#pdNegClip)"') +
        negI.map((i) => `<circle cx="${x(i).toFixed(1)}" cy="${yOf(gp[i]).toFixed(1)}" r="3.5" fill="var(--red)" stroke="var(--sur)" stroke-width="1.5"/>`).join('');
    }
    pts = cost.map((k, i) => ({ x: x(i), y: yOf(gp[i]), label: k.label,
      dot: gp[i] < 0 ? 'var(--red)' : 'var(--g-gp)',
      rows: [['<i style="--k:var(--g-cost)"></i>Cost', money(k.v)],
             ['<i style="--k:var(--g-rev)"></i>Revenue', money(rev[i].v)],
             ['<i style="--k:var(--g-gp)"></i>Gross profit',
               gp[i] < 0 ? `<span class="tip-neg">▼ ${money(gp[i])}</span>` : money(gp[i])]] }));
    legend = `<span class="key" style="--k:var(--g-cost)"><i></i>Cost</span>
       <span class="key" style="--k:var(--g-rev)"><i></i>Revenue</span>
       <span class="key" style="--k:var(--g-gp)"><i></i>Gross profit</span>` +
      (negI.length ? `<span class="negnote">▼ Below $0 in ${negI.length} of ${n} ${unit}</span>` : '');
  }

  let grid = '';
  for (let v = ax.lo; v <= ax.hi + ax.step / 2; v += ax.step) {
    const yy = yOf(v);
    grid += `<line x1="${PL}" x2="${W - PR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--g-grid)" stroke-width="1"/>
      <text x="${PL - 10}" y="${(yy + 4.5).toFixed(1)}" text-anchor="end" font-size="14" font-weight="500" fill="var(--tick)">${fmt(v)}</text>`;
  }
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" font-size="14" font-weight="500" fill="var(--tick)">${cost[i].label}</text>`).join('');

  const svg = $('pdSvg');
  svg.innerHTML = grid + body + ticks +
    `<line id="pdCross" x1="0" x2="0" y1="${PT}" y2="${PT + ih}" stroke="var(--hover-line)" stroke-width="1" stroke-dasharray="4 4" opacity="0"/>
     <circle id="pdDot" r="5" fill="var(--g-gp)" stroke="var(--sur)" stroke-width="2.5" opacity="0"/>`;

  const o = sel.o;
  $('pdTitle').textContent = sel.title;
  $('pdMeta').innerHTML = `${money(o.cost)} spent · ${money(o.allRev)} back · ` +
    `<span class="${o.cashGap < 0 ? 'g-neg' : 'pos'}">${money(o.cashGap)} gross profit</span>`;
  $('pdRef').innerHTML = legend;

  /* the two chart toggles show the current choice */
  $('pdMode').querySelectorAll('button').forEach((b2) => b2.setAttribute('aria-pressed', String(b2.dataset.c === CHART)));
  $('pdKind').hidden = CHART !== 'roas';
  $('pdKind').querySelectorAll('button').forEach((b2) => b2.setAttribute('aria-pressed', String(b2.dataset.k === ROASK)));

  const plot = $('pdPlot'), tip = $('pdTip');
  const cross = svg.querySelector('#pdCross'), dot = svg.querySelector('#pdDot');
  plot.onmousemove = (ev) => {
    const bb = svg.getBoundingClientRect();
    let i = Math.round(((ev.clientX - bb.left) / bb.width * W - PL) / (iw || 1) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const p = pts[i];
    cross.setAttribute('x1', p.x); cross.setAttribute('x2', p.x); cross.setAttribute('opacity', '1');
    if (p.y == null) dot.setAttribute('opacity', '0');
    else {
      dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('opacity', '1');
      dot.setAttribute('fill', p.dot || 'var(--g-gp)');
    }
    tip.innerHTML = `<div class="g-d">${esc(p.label)}</div>` +
      p.rows.map((kv) => `<div class="r"><span>${kv[0]}</span><b>${kv[1]}</b></div>`).join('');
    tip.classList.add('on');
    tip.style.left = Math.min(p.x / W * bb.width + 16, bb.width - 230) + 'px';
    tip.style.top = '6px';
  };
  plot.onmouseleave = () => {
    tip.classList.remove('on');
    cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0');
  };
}

/* ---------------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------------- */
function wireOnce() {
  if (wireOnce.done) return;
  wireOnce.done = true;

  $('pdMode').querySelectorAll('button').forEach((b2) => {
    b2.onclick = (ev) => { ev.stopPropagation(); CHART = b2.dataset.c; if (MODEL) drawDetail(MODEL); };
  });
  $('pdKind').querySelectorAll('button').forEach((b2) => {
    b2.onclick = (ev) => { ev.stopPropagation(); ROASK = b2.dataset.k; if (MODEL) drawDetail(MODEL); };
  });

  $('perfGrain').querySelectorAll('button').forEach((b2) => {
    b2.onclick = () => {
      $('perfGrain').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b2.setAttribute('aria-pressed', 'true');
      GRAIN = b2.dataset.g;
      if (MODEL) { renderTable(MODEL); drawDetail(MODEL); }
    };
  });
}

window.__nsBridge.onRender = function (W) {
  wireOnce();
  enhanceDate();
  MODEL = build(W);

  /* Open on the biggest spender rather than on nothing. An empty chart well
     is worse than a chart of the row the eye lands on first, and the network
     carrying the most money is the one worth a default. A selection that no
     longer exists — the window moved, the platform changed — falls back the
     same way instead of leaving a stale title above a blank plot. */
  const stillThere = SELECTED && (
    (SELECTED.startsWith('n:') && MODEL.networks.some((n) => 'n:' + n.name === SELECTED)) ||
    (SELECTED.startsWith('c:') && MODEL.rows.some((c) => 'c:' + c.campaign + '||' + c.channel === SELECTED)));
  if (!stillThere) SELECTED = MODEL.networks.length ? 'n:' + MODEL.networks[0].name : null;

  renderHead(MODEL);
  renderTable(MODEL);
  drawDetail(MODEL);
};

/* Both charts size their viewBox from the container, so a resize has to redraw
   them or the type ends up scaled after all - which is the bug the viewBox
   change was made to fix. */
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!MODEL) return;
    try { drawDetail(MODEL); } catch (e) {}
  }, 150);
});

/* Exposed for the smoke test, which asserts the tiles and the table agree —
   the one invariant this file exists to hold. */
window.__glanceModel = () => MODEL;
