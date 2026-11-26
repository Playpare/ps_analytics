/**
 * chart-pro.js - every report chart drawn the way the hub's Overview draws
 * its charts (game-analytics makeChart + chartColors).
 *
 * The reports were each written with their own chart styling: four different
 * tooltip boxes, three axis greys, and palettes that are close to the hub's
 * but not it (#18c97a beside the hub's #00c47a, iOS-style #34c759 / #ff9500,
 * #f5a623 beside #ffb800 ...). Rather than edit several hundred chart configs,
 * this plugin restyles each chart just before it draws:
 *
 *   - tooltip: the hub's navy box, blue hairline, 8px corners, its text colours
 *   - axes: the hub's grid and tick colours
 *   - legend: the hub's text colour and 10px boxes
 *   - series colours: a colour that is a near miss of one of the hub's six is
 *     drawn as that hub colour (alpha kept, so fills stay fills). A colour with
 *     no near hub match (purples, greys, browns) is left alone, and two
 *     colours in one chart are never merged into one - each hub colour goes to
 *     the closest series only, so every series stays distinguishable.
 *   - lines: the hub's smooth 2px stroke, no dots on dense series
 *   - bars: the hub's 3px rounded tops (not on stacked bars)
 *
 * What it never touches: data, labels, callbacks, scriptable (function)
 * options, gradients and dashed target lines. Each chart's own values are
 * kept, so every redraw starts from what the report itself configured.
 */
import Chart from '../../src/shared/chart.js';

const HUB = {
  teal: [0, 229, 195], pink: [236, 10, 155], blue: [77, 159, 255],
  green: [0, 196, 122], amber: [255, 184, 0], red: [255, 77, 109],
};
const TIP = {
  backgroundColor: 'rgba(7,11,20,0.95)', titleColor: '#E8ECFF', bodyColor: '#C8D0F0',
  footerColor: '#C8D0F0', borderColor: 'rgba(100,130,230,0.28)', borderWidth: 1,
  padding: 10, cornerRadius: 8, boxPadding: 5,
};
const GRID = 'rgba(255,255,255,0.07)';
const TICK = '#d3dae8';      // game-analytics/axis.js: the hub's axis numbers
const LEGEND = '#d7deea';    // chartColors().text: the hub's legend text

/* ---- colour parsing ---- */
function parse(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
    return { rgb: [+m[1], +m[2], +m[3]], a };
  }
  return null;
}
const key = (p) => p.rgb.join(',');
function fmt(rgb, a) {
  return a >= 0.999 ? '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
    : `rgba(${rgb.join(',')},${+a.toFixed(3)})`;
}

/* every colour value a dataset carries, as [obj, prop, index|null] slots */
const COLOR_PROPS = ['borderColor', 'backgroundColor', 'pointBackgroundColor', 'pointBorderColor',
  'pointHoverBackgroundColor', 'pointHoverBorderColor', 'hoverBackgroundColor', 'hoverBorderColor'];

function slots(ds) {
  const out = [];
  COLOR_PROPS.forEach((p) => {
    const v = ds[p];
    if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'string') out.push([ds, p, i]); });
    else if (typeof v === 'string') out.push([ds, p, null]);
  });
  return out;
}
const read = ([o, p, i]) => (i == null ? o[p] : o[p][i]);
const write = ([o, p, i], v) => { if (i == null) o[p] = v; else o[p][i] = v; };

/* hue (degrees), saturation and lightness of an [r,g,b] */
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { h, s, l };
}
const HUE_NEAR = 24;   // degrees: within this a colour is "meant to be" that hub colour

/* The hub colour for each distinct source colour of one chart, or none.
   Matched by HUE first, lightness second: a darker teal (Monetization's
   Android #00ad99) is still teal, though in plain RGB it sits nearer the
   hub's green. A purple, an orange or a grey has no hub hue nearby and is
   left as it is. */
function plan(colours) {
  const cands = [];
  colours.forEach((p, k) => {
    const a = hsl(p.rgb);
    if (a.s < 0.35 || a.l < 0.18 || a.l > 0.85) return;  // greys, near-black, near-white stay
    Object.entries(HUB).forEach(([name, rgb]) => {
      const b = hsl(rgb);
      const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
      if (dh <= HUE_NEAR) cands.push({ k, name, rgb, d: dh + 60 * Math.abs(a.l - b.l) });
    });
  });
  /* Each colour may only become its OWN nearest hub colour. When two colours
     share a nearest one (Android's teal and its darker IAP teal), the closer
     takes it and the other keeps its original shade - it never falls through
     to a second-nearest family (dark teal must not turn green). */
  const best = new Map();
  cands.forEach((c) => { if (!best.has(c.k) || c.d < best.get(c.k).d) best.set(c.k, c); });
  const takenHub = new Set(), map = new Map();
  [...best.values()].sort((a, b) => a.d - b.d).forEach((c) => {
    if (takenHub.has(c.name)) return;
    takenHub.add(c.name); map.set(c.k, c.rgb);
  });
  return map;
}

const ORIG = new WeakMap();          // chart -> [{slot, value}] / option backups

/* Each entry: [target, prop, original, hadOwn, written]. A value is put back
   only if it still holds what this file wrote - if the report has since set
   its own value (a highlight, a new array), that value wins. */
function restore(chart) {
  const list = ORIG.get(chart);
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const [obj, prop, val, had, written] = list[i];
    if (prop === '__slot__') {
      const [o, p, k] = obj;
      if (k != null && !Array.isArray(o[p])) continue;
      if (read(obj) === written) write(obj, val);
      continue;
    }
    if (obj[prop] !== written) continue;
    if (had) obj[prop] = val; else delete obj[prop];
  }
  ORIG.delete(chart);
}

function setOpt(list, obj, prop, val) {
  if (!obj || typeof obj[prop] === 'function') return;      // scriptable: leave it
  list.push([obj, prop, obj[prop], Object.prototype.hasOwnProperty.call(obj, prop), val]);
  obj[prop] = val;
}

function style(chart) {
  if (chart.$proSkip) return;
  restore(chart);                    // start from the chart's own config each time
  const list = [];
  ORIG.set(chart, list);
  const o = chart.config.options || (chart.config.options = {});
  const type = chart.config.type;

  /* tooltip */
  const p = o.plugins = o.plugins || {};
  const tt = p.tooltip = p.tooltip || {};
  Object.entries(TIP).forEach(([k, v]) => setOpt(list, tt, k, v));

  /* legend */
  const lg = p.legend = p.legend || {};
  const ll = lg.labels = lg.labels || {};
  setOpt(list, ll, 'color', LEGEND);
  if (!ll.usePointStyle && ll.boxWidth == null) setOpt(list, ll, 'boxWidth', 10);

  /* axes */
  const scales = o.scales || {};
  let stacked = false;
  Object.values(scales).forEach((s) => {
    if (!s || typeof s !== 'object') return;
    if (s.stacked) stacked = true;
    s.grid = s.grid || {};
    if (s.grid.color == null || typeof s.grid.color === 'string') setOpt(list, s.grid, 'color', GRID);
    /* the hub's grid lines are solid (ASO drew them dashed) */
    if (s.border && Array.isArray(s.border.dash) && s.border.dash.length) setOpt(list, s.border, 'dash', []);
    s.ticks = s.ticks || {};
    if (s.ticks.color == null || typeof s.ticks.color === 'string') setOpt(list, s.ticks, 'color', TICK);
    /* the hub's axis numbers are semibold-bold and a step bigger (axis.js) */
    if (s.display !== false && (s.ticks.font == null || typeof s.ticks.font === 'object')) {
      const f = s.ticks.font || {};
      setOpt(list, s.ticks, 'font', { ...f, weight: '700', size: Math.max(typeof f.size === 'number' ? f.size : 0, 16) });
    }
    if (s.title && typeof s.title === 'object') setOpt(list, s.title, 'color', TICK);
    if (s.pointLabels && typeof s.pointLabels === 'object') setOpt(list, s.pointLabels, 'color', TICK);
  });

  /* series colours */
  const datasets = (chart.data && chart.data.datasets) || [];
  const all = [];
  datasets.forEach((ds) => slots(ds).forEach((sl) => all.push(sl)));
  const distinct = new Map();
  all.forEach((sl) => {
    const pc = parse(read(sl));
    if (pc && !distinct.has(key(pc))) distinct.set(key(pc), pc);
  });
  const keys = [...distinct.keys()];
  const m = plan(keys.map((k) => distinct.get(k)));
  /* A colour ARRAY may be shared - a palette constant handed to several
     charts, or read again to colour an HTML legend chip. Recolouring it in
     place would change every one of those. So this chart gets its own copy,
     and only the copy is recoloured (restore puts the original array back). */
  const copied = new Set();
  all.forEach((sl) => {
    const [o, p, i] = sl;
    if (i == null || copied.has(o[p])) return;
    const pc = parse(read(sl));
    if (!pc || !m.get(keys.indexOf(key(pc)))) return;
    setOpt(list, o, p, o[p].slice());
    copied.add(o[p]);
  });
  all.forEach((sl) => {
    const pc = parse(read(sl));
    if (!pc) return;
    const to = m.get(keys.indexOf(key(pc)));
    if (!to) return;
    const v = fmt(to, pc.a);
    list.push([sl, '__slot__', read(sl), true, v]);
    write(sl, v);
  });

  /* line and bar shapes */
  datasets.forEach((ds) => {
    const t = ds.type || type;
    const dashed = Array.isArray(ds.borderDash) && ds.borderDash.some((v) => v > 0);
    if (t === 'line' && !dashed && !ds.stepped) {
      /* the hub's curve and stroke; a deliberately straight line (tension 0)
         stays straight */
      if (ds.tension == null || (typeof ds.tension === 'number' && ds.tension > 0)) setOpt(list, ds, 'tension', 0.35);
      if (ds.borderWidth == null || typeof ds.borderWidth === 'number') setOpt(list, ds, 'borderWidth', 2);
      const n = (ds.data || []).length;
      if (ds.pointRadius == null && n > 12) setOpt(list, ds, 'pointRadius', 0);
      if (ds.pointHoverRadius == null) setOpt(list, ds, 'pointHoverRadius', 4);
    }
    if (t === 'bar' && !stacked && ds.borderRadius == null) setOpt(list, ds, 'borderRadius', 3);
  });
}

Chart.register({ id: 'chartPro', beforeInit: style, beforeUpdate: style });

export default Chart;
