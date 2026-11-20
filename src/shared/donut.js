/**
 * donut.js — the clean donut look shared by the reports' share charts:
 * a ring with gaps between slices, the total written big in the hole with a
 * caption under it, and (in the page) a legend of name + coloured value chip.
 *
 * The centre total is a global Chart.js plugin that only acts on charts which
 * opt in with `options.plugins.donutCenter = { label, format }`.
 */
import Chart from './chart.js';
import './styles/donut.css';

const FAMILY = "'Segoe UI', 'Segoe UI Variable', system-ui, Arial, sans-serif";

/* $1,234 -> "$1.23K" style, short enough for the hole */
export function compactMoney(v) {
  const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return s + '$' + Math.round(a).toLocaleString('en-US');
}

function css(name, fallback) {
  try { return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback; }
  catch (e) { return fallback; }
}

const donutCenter = {
  id: 'donutCenter',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.display === false || !opts.label) return;
    const meta = chart.getDatasetMeta(0);
    const arc = meta && meta.data && meta.data[0];
    if (!arc || !arc.innerRadius) return;
    const vals = (chart.data.datasets[0] && chart.data.datasets[0].data) || [];
    const total = vals.reduce((s, v) => s + (Number(v) || 0), 0);
    const text = (opts.format || compactMoney)(total);
    const { x, y } = arc, r = arc.innerRadius;
    const ctx = chart.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    /* the number is as big as the hole allows, then shrunk until it fits */
    let size = Math.min(48, r * 0.46);
    ctx.font = `800 ${size}px ${FAMILY}`;
    while (size > 14 && ctx.measureText(text).width > r * 1.6) {
      size -= 1;
      ctx.font = `800 ${size}px ${FAMILY}`;
    }
    const cap = Math.max(14, Math.round(size * 0.4));
    ctx.fillStyle = css('--t1', css('--text', '#edf2ff'));
    ctx.fillText(text, x, y - cap * 0.55);
    ctx.font = `600 ${cap}px ${FAMILY}`;
    ctx.fillStyle = css('--t2', css('--mut', '#c9d2e1'));
    ctx.fillText(opts.label, x, y + size * 0.5);
    ctx.restore();
  },
};
Chart.register(donutCenter);

/* Share written on each slice of the ring. Opt in with
   `options.plugins.donutLabels = { display: true }`. Black or white per slice
   by its lightness; slices too thin or too short to hold the text are left
   clean (the legend still carries them). */
function lightness(color) {
  const c = String(color || '').trim();
  let r, g, b, a = 1;
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else if ((m = /rgba?\(([^)]+)\)/i.exec(c))) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    [r, g, b] = p; a = p[3] == null ? 1 : p[3];
  } else return 1;
  /* a translucent slice sits on the dark card, so it reads darker */
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return L * a;
}
const donutLabels = {
  id: 'donutLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.display) return;
    const ds = chart.data.datasets[0];
    const vals = (ds && ds.data) || [];
    const total = vals.reduce((s, v) => s + (Number(v) || 0), 0);
    if (total <= 0) return;
    const cols = Array.isArray(ds.backgroundColor) ? ds.backgroundColor : [ds.backgroundColor];
    const ctx = chart.ctx;
    chart.getDatasetMeta(0).data.forEach((arc, i) => {
      const share = (Number(vals[i]) || 0) / total * 100;
      if (share < 3) return;
      const text = (share < 10 ? share.toFixed(1) : Math.round(share)) + '%';
      const thick = arc.outerRadius - arc.innerRadius;
      const size = Math.max(11, Math.min(15, thick * 0.42));
      ctx.save();
      ctx.font = `700 ${size}px ${FAMILY}`;
      const w = ctx.measureText(text).width;
      const mid = (arc.innerRadius + arc.outerRadius) / 2;
      if ((arc.endAngle - arc.startAngle) * mid < w + 8 || thick < size + 6) { ctx.restore(); return; }
      const ang = (arc.startAngle + arc.endAngle) / 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = lightness(cols[i % cols.length]) > 0.45 ? '#000' : '#fff';
      ctx.fillText(text, arc.x + Math.cos(ang) * mid, arc.y + Math.sin(ang) * mid);
      ctx.restore();
    });
  },
};
Chart.register(donutLabels);

/* 1234567 -> "1.23M" (counts, e.g. impressions) */
export function compactNumber(v) {
  const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + (a / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return s + Math.round(a).toLocaleString('en-US');
}

/** Legend: name + chip in the slice colour holding the share. `fmt` formats
    the raw value shown on hover (money by default). */
export function donutLegendHTML(labels, values, colors, fmt) {
  const show = fmt || compactMoney;
  const total = values.reduce((s, v) => s + (Number(v) || 0), 0);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return labels.map((label, i) => {
    const v = Number(values[i]) || 0;
    const share = total ? (v / total) * 100 : 0;
    const col = colors[i % colors.length];
    return `<span class="dl-item" title="${esc(label)} · ${show(v)} · ${share.toFixed(1)}%">` +
      `<span class="dl-lb">${esc(label)}</span>` +
      `<span class="dl-chip" style="background:${col}">${share < 10 ? share.toFixed(1) : Math.round(share)}%</span></span>`;
  }).join('');
}

/* The report bundles are plain scripts that reach shared code through window. */
window.__donut = { donutLegendHTML, compactMoney, compactNumber };

export default donutCenter;
