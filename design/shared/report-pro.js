/**
 * report-pro.js - the dashboard design for the reports (Negative Spend, UA
 * Report, Monetization, Life Time, ASO, and the Executive page through
 * reports/exec/exec-pro.js), matching the hub so the whole dashboard reads as
 * one. Its rules are scoped under html.report-pro, which this file adds.
 *
 * What it adds:
 *   - an icon on every KPI card, chosen from the card's label
 *   - the hub's wave graph along the bottom of KPI cards, from REAL data:
 *       1. a card's own data-spark="v1,v2,..." when a report provides one
 *       2. otherwise the chart on the same page whose series has the same
 *          name as the card ("Revenue" card <- "Revenue" series, "Overall
 *          Spend" <- "Cost"). No match, no wave - nothing is invented.
 *   - the delta line under a value split like the hub's: coloured arrow and
 *     percentage, the rest in quiet grey
 *   - the report's header on one line (tabs, date, status, Refresh)
 */
import './report-pro.css';
import Chart from '../../src/shared/chart.js';
import './chart-type.js';   // one chart typeface on every report (Life Time and Negative Spend lacked it)
import './chart-pro.js';    // every chart drawn the way the hub's Overview draws them
import { iconFor } from './pro-icons.js';
import { kpiAccent } from './kpi-colors.js';


const CARD = '.kpi, .kpi-card, .act';
const LABEL = ':scope > .l, :scope > .kpi-label, :scope > .hd';

/* ---- names -> the same word set, so a card can find its chart series ---- */
const STOP = new Set(['total', 'avg', 'average', 'overall', 'the', 'of', 'per', 'period', 'usd',
  'daily', 'weekly', 'monthly', 'sum', 'all', 'selected', 'combined', 'in', 'and', '']);
const SYN = { spend: 'cost', spent: 'cost', costs: 'cost', revenues: 'revenue', installs: 'install' };
const key = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9%]+/g, ' ')
  .split(' ').map((w) => SYN[w] || w).filter((w) => !STOP.has(w)).sort().join(' ');

/* ---- the wave: same shape as the hub's (starts at 0, bottom-left) -------- */
const W = 100, H = 40;
/* points (in the 100 x 40 viewBox) of the real values, kept for the hover */
const SPARK = new WeakMap();

function sparkSvg(vals, dates) {
  const pairs = [];
  vals.forEach((v, i) => { if (v != null && isFinite(v)) pairs.push({ v: +v, d: dates ? dates[i] : null }); });
  if (pairs.length < 2) return null;
  const nums = pairs.map((p) => p.v);
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const span = (hi - lo) || Math.abs(hi) * 0.1 || 1;
  const yMin = lo - span * 0.12, yMax = hi + span * 0.2;
  const n = pairs.length;
  const real = pairs.map((p, i) => [((i + 1) / n) * W, H - ((p.v - yMin) / (yMax - yMin)) * H]);
  const pts = [[0, H]].concat(real);                      // the 0 anchor first
  /* Catmull-Rom -> cubic Bezier, for the hub's smooth curve */
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  const id = 'pg' + Math.random().toString(36).slice(2, 8);
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--kc)" stop-opacity=".42"/><stop offset="1" stop-color="var(--kc)" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${W},${H} L0,${H} Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="var(--kc)" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>
    <i class="pro-dot"></i>`;
  return { svg, pts: real, pairs };
}

/* ---- hover: the hub's tooltip (date, value, change vs the previous point) - */
function tipEl() {
  let t = document.getElementById('proSparkTip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'proSparkTip';
    document.body.appendChild(t);
  }
  return t;
}
/* values are shown in the card's own units: $ / % / plain, read off its value */
function fmtLike(card, v) {
  const txt = ((card.querySelector(':scope > .v, :scope > .kpi-value, :scope > .amt') || {}).textContent || '').trim();
  const a = Math.abs(v);
  const compact = a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(1) + 'K'
    : a >= 100 ? Math.round(v).toLocaleString('en-US') : a >= 1 ? v.toFixed(2) : v.toFixed(4);
  if (/\$/.test(txt)) return (v < 0 ? '−$' : '$') + compact.replace(/^-/, '');
  if (/%\s*$/.test(txt)) return v.toFixed(a >= 10 ? 1 : 2) + '%';
  return compact;
}
function fmtDate(d) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (!m) return String(d);
  const dt = new Date(+m[1], +m[2] - 1, +m[3]);
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}
function onSparkMove(e) {
  const box = e.currentTarget, card = box.parentElement, s = SPARK.get(card);
  if (!s) return;
  const r = box.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  let i = 0, best = Infinity;
  s.pts.forEach((p, k) => { const dd = Math.abs(p[0] - x); if (dd < best) { best = dd; i = k; } });
  const [px, py] = s.pts[i];
  const dot = box.querySelector('.pro-dot');
  dot.style.left = (px / W) * 100 + '%';
  dot.style.top = (py / H) * 100 + '%';
  dot.style.opacity = '1';
  /* exactly the hub card tooltip (game-analytics drawSpark): date, value in
     the card's colour, "vs prev: ▲ +x (+y%)", sitting just above the graph */
  const cur = s.pairs[i].v, prev = i > 0 ? s.pairs[i - 1].v : null;
  const col = getComputedStyle(card).getPropertyValue('--kc').trim();
  let diff = '';
  if (prev != null) {
    const dv = cur - prev, pct = prev !== 0 ? (dv / Math.abs(prev)) * 100 : 0;
    const arrow = dv > 0 ? '▲' : dv < 0 ? '▼' : '•';
    const sign = dv > 0 ? '+' : '';
    const dcol = dv > 0 ? '#00c47a' : dv < 0 ? '#ff4d6d' : '#c9d2e1';
    diff = `<div style="font-size:10px;color:${dcol};margin-top:3px">vs prev: ${arrow} ${sign}${fmtLike(card, dv)} (${sign}${pct.toFixed(1)}%)</div>`;
  }
  const label = s.pairs[i].d ? fmtDate(s.pairs[i].d) : '';
  const t = tipEl();
  t.innerHTML = (label ? `<div style="font-weight:600;color:#E8ECFF;margin-bottom:3px">${label}</div>` : '')
    + `<div style="font-family:'Segoe UI',sans-serif;font-size:13px;color:${col};font-weight:600">${fmtLike(card, cur)}</div>` + diff;
  t.style.opacity = '1';
  const tr = t.getBoundingClientRect();
  let left = r.left + (px / W) * r.width - tr.width / 2;
  let top = r.top - tr.height - 8;
  if (left < 6) left = 6;
  if (left + tr.width > window.innerWidth - 6) left = window.innerWidth - tr.width - 6;
  if (top < 6) top = r.bottom + 8;
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}
function onSparkLeave(e) {
  const dot = e.currentTarget.querySelector('.pro-dot');
  if (dot) dot.style.opacity = '0';
  tipEl().style.opacity = '0';
}

/* every chart on the page as { canvas, key, n, data, labels } per dataset */
function chartSeries() {
  const out = [];
  const all = Chart && Chart.instances ? Object.values(Chart.instances) : [];
  all.forEach((ch) => {
    const labels = (ch.data && ch.data.labels) || [];
    if (labels.length < 4) return;
    const canvas = ch.canvas;
    (ch.data.datasets || []).forEach((ds) => {
      const data = (ds.data || []).map((v) => (v && typeof v === 'object' ? v.y : v))
        .map((v) => (v == null || v === '' ? null : +v));
      if (data.filter((v) => v != null && isFinite(v)).length < 2) return;
      out.push({ canvas, key: key(ds.label), n: labels.length, data, labels: labels.map(String) });
    });
  });
  return out;
}

/* { vals, dates }: the card's own data-spark (+ data-spark-dates), or the
   same-named series of a chart on the same page */
function seriesFor(card, label, all) {
  /* Monetization (the only report with #tabnav): no graph lines on its KPI
     cards, by request */
  if (document.getElementById('tabnav')) return null;
  const own = card.getAttribute('data-spark');
  if (own) {
    const dd = card.getAttribute('data-spark-dates');
    return { vals: own.split(',').map(Number), dates: dd ? dd.split(',') : null };
  }
  const k = key(label);
  if (!k) return null;
  const scope = card.closest('.view, main, .slide, section') || document.body;
  const hits = all.filter((s) => s.key === k && scope.contains(s.canvas));
  if (!hits.length) return null;
  hits.sort((a, b) => b.n - a.n);                // most points: the daily chart
  return { vals: hits[0].data, dates: hits[0].labels };
}

/* "▼ 0.8% vs previous period (prev: $314.9K)" -> coloured part + grey rest */
function splitDelta(d) {
  if (d.dataset.proText === d.textContent) return;
  const m = /^\s*([▲▼•↑↓]\s*[+\-−]?[\d.,]+%)(.*)$/s.exec(d.textContent);
  if (!m) { d.dataset.proText = d.textContent; return; }
  d.innerHTML = '<b class="pro-dv"></b><span class="pro-mut"></span>';
  d.firstChild.textContent = m[1];
  d.lastChild.textContent = m[2];
  d.dataset.proText = d.textContent;
}

function paint() {
  const series = chartSeries();
  document.querySelectorAll(CARD).forEach((card) => {
    const lbl = card.querySelector(LABEL);
    if (!lbl) return;
    const text = lbl.textContent.trim();
    if (!text) return;
    if (card.dataset.icoFor !== text) {
      card.dataset.icoFor = text;
      card.style.setProperty('--ico', iconFor(text));
      card.style.setProperty('--kc', kpiAccent(text));
    }
    const ser = seriesFor(card, text, series);
    const vals = ser && ser.vals;
    const sig = vals ? vals.length + ':' + vals.slice(0, 3).join('|') + ':' + vals.slice(-3).join('|') : '';
    if (card.dataset.proSpark !== sig) {
      card.dataset.proSpark = sig;
      let box = card.querySelector(':scope > .pro-spark');
      const sp = vals ? sparkSvg(vals, ser.dates) : null;
      if (sp) {
        if (!box) {
          box = document.createElement('div'); box.className = 'pro-spark'; card.appendChild(box);
          box.addEventListener('mousemove', onSparkMove);
          box.addEventListener('mouseleave', onSparkLeave);
        }
        box.innerHTML = sp.svg;
        SPARK.set(card, sp);
        if (!card.classList.contains('pro-spark-on')) card.classList.add('pro-spark-on');
      } else {
        if (box) box.remove();
        if (card.classList.contains('pro-spark-on')) card.classList.remove('pro-spark-on');
      }
    }
    const d = card.querySelector(':scope > .d');
    /* UA: delta-up/down/flat; Monetization: up/down ("▲ +1.2% WoW vs ...") */
    if (d && /\b(delta-(up|down|flat)|up|down|dn)\b/.test(d.className)) splitDelta(d);
  });

  oneLineHeader();
}

/* ---- one-line header ------------------------------------------------------
   Every report has a top bar (tabs and/or status + Refresh) and, under it, a
   second row (date filter; ASO's tabs; Life Time's toggles). The second row
   is marked .pro-row and lifted onto the top bar's line by the CSS; this
   measures the room the top bar's own left (tabs) and right (status +
   Refresh) groups need, so the lifted row sits between them. */
function oneLineHeader() {
  const root = document.documentElement;
  const top = document.querySelector('body > .top, body > #tabnav, .top');
  if (!top) return;
  if (!top.classList.contains('pro-top')) top.classList.add('pro-top');
  /* in priority order: Monetization's bar sits in different parents in live
     and error mode, so it is found by id wherever it is */
  const row = ['#weeklyFilterBar', '.view.active > .slide > .sh', 'body > .subtop', '.subtop', 'body > .sh']
    .map((s) => document.querySelector(s)).find(Boolean);
  document.querySelectorAll('.pro-row').forEach((r) => { if (r !== row) r.classList.remove('pro-row'); });
  if (!row) return;
  if (!row.classList.contains('pro-row')) row.classList.add('pro-row');
  const tb = top.getBoundingClientRect(), mid = tb.left + tb.width / 2;
  let leftEdge = tb.left, rightEdge = tb.right;
  [...top.children].forEach((ch) => {
    const r = ch.getBoundingClientRect();
    if (!r.width || getComputedStyle(ch).display === 'none') return;
    if (r.left < mid) leftEdge = Math.max(leftEdge, r.right);
    else rightEdge = Math.min(rightEdge, r.left);
  });
  root.style.setProperty('--pro-th', Math.round(tb.height) + 'px');
  root.style.setProperty('--pro-lw', Math.max(0, Math.ceil(leftEdge - tb.left)) + 'px');
  root.style.setProperty('--pro-cw', Math.max(0, Math.ceil(tb.right - rightEdge)) + 'px');
}

{
  document.documentElement.classList.add('report-pro');
  let queued = false;
  const run = () => { queued = false; paint(); };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  /* charts draw after data arrives: repaint the waves whenever one updates */
  try { Chart.register({ id: 'reportProSpark', afterUpdate: later }); } catch (e) { /* already registered */ }
  const start = () => {
    run();
    new MutationObserver(later).observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['data-spark', 'data-spark-dates', 'class'] });
    window.addEventListener('resize', later);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
