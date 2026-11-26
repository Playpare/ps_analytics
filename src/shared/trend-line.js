/**
 * trend-line.js — a dotted trend line under every line series, on every chart.
 *
 * Registered once in src/shared/chart.js, so the hub and every report get it
 * without touching their chart code. For each visible LINE series it fits a
 * straight line through the points (least squares) and draws it dotted, in
 * the series' own colour, from the first point to the last. It is drawn, not
 * added as a dataset, so legends, tooltips and stacking are unaffected.
 *
 * Left alone:
 *   - bar / doughnut / pie series            only line series get one
 *   - a series that is already dashed        targets, benchmarks, "Competitor /
 *                                            industry", projections: a trend of
 *                                            a reference line means nothing
 *   - sparklines (no visible axis at all)    KPI-card minis would only get noise
 *   - fewer than 3 points                    two points ARE their own trend
 *
 * Turn it off for one chart:   options.plugins.trendLine = false
 *                 one series:   dataset.trendLine = false
 *
 * LEGEND: a chart that shows a legend gets a "Trend" item at the end of it,
 * drawn as a dotted line. Clicking it hides or shows that chart's trend lines,
 * exactly like clicking a series. The choice is remembered per chart for the
 * session, so a chart redrawn after a range change keeps it.
 */

import { toFont, toPadding } from 'chart.js/helpers';

const DASH = [5, 5];
const WIDTH = 1.6;
const LABEL = 'Trend';
const TIP_PREFIX = 'Trend: ';

/* Hidden trend lines, by chart canvas id, for the session. */
const HIDDEN = new Set();
const chartKey = (chart) => (chart.canvas && chart.canvas.id) || ('chart' + chart.id);
const isHidden = (chart) => HIDDEN.has(chartKey(chart));

/** True when this series gets a trend line (same rules as the drawing). */
function eligible(chart, ds, i) {
  if (!ds || ds.trendLine === false) return false;
  if (Array.isArray(ds.borderDash) && ds.borderDash.length) return false;
  const meta = chart.getDatasetMeta(i);
  if (!isLineSeries(chart, meta, ds)) return false;
  const vals = (ds.data || []).filter((v) => {
    const y = (v && typeof v === 'object') ? v.y : v;
    return y !== null && y !== undefined && Number.isFinite(+y);
  });
  return vals.length >= 3;
}

function anyEligible(chart) {
  if (chart.options.indexAxis === 'y') return false;
  if (!hasVisibleAxis(chart)) return false;
  return chart.data.datasets.some((ds, i) => eligible(chart, ds, i));
}

/**
 * Adds the Trend item to the chart's own legend and makes it clickable.
 * Works on the chart's raw options, wrapping whatever label generator and
 * click handler the chart already had, so custom legends keep working.
 */
function patchLegend(chart) {
  const raw = chart.config.options || (chart.config.options = {});
  raw.plugins = raw.plugins || {};
  if (raw.plugins.trendLine === false) return;
  const lg = raw.plugins.legend = raw.plugins.legend || {};
  if (lg.$trendPatched) return;
  lg.$trendPatched = true;
  lg.labels = lg.labels || {};

  const defaults = chart.constructor.defaults.plugins.legend;
  const baseGen = lg.labels.generateLabels || defaults.labels.generateLabels;
  const baseClick = lg.onClick || defaults.onClick;

  lg.labels.generateLabels = function (c) {
    const items = baseGen.call(this, c) || [];
    if (!anyEligible(c)) return items;
    const first = items[0] || {};
    items.push({
      text: LABEL,
      fillStyle: 'transparent',
      strokeStyle: first.fontColor || 'rgba(200,208,240,0.85)',
      fontColor: first.fontColor,
      lineWidth: WIDTH,
      lineDash: DASH,
      hidden: isHidden(c),
      $trend: true
    });
    return items;
  };

  lg.onClick = function (e, item, legend) {
    if (item && item.$trend) {
      const c = legend.chart, k = chartKey(c);
      if (HIDDEN.has(k)) HIDDEN.delete(k); else HIDDEN.add(k);
      /* Drop the open pop-up: it keeps its old lines until the hovered point
         changes, so it would still show (or still lack) the Trend values. */
      if (c.tooltip && c.tooltip.setActiveElements) c.tooltip.setActiveElements([], { x: 0, y: 0 });
      c.update('none');
      return;
    }
    return baseClick.call(this, e, item, legend);
  };
}

/** rgba() of a colour string at the given alpha; null if it cannot be read. */
function fade(color, alpha) {
  if (typeof color !== 'string') return null;
  const c = color.trim();
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((s) => s.trim());
    return `rgba(${p[0]},${p[1]},${p[2]},${alpha})`;
  }
  return c;                                   // named / hsl: use as is
}

function isLineSeries(chart, meta, ds) {
  const type = ds.type || meta.type || chart.config.type;
  return type === 'line';
}

function hasVisibleAxis(chart) {
  return Object.values(chart.scales || {}).some((s) => s.options && s.options.display !== false);
}

/** A trend value written the way this chart's y axis writes its numbers. */
function formatLike(scale, v) {
  try {
    const cb = scale && scale.options && scale.options.ticks && scale.options.ticks.callback;
    if (typeof cb === 'function') {
      const out = cb.call(scale, v, 0, [{ value: v }]);
      if (out !== undefined && out !== null && out !== '') return Array.isArray(out) ? out.join(' ') : String(out);
    }
  } catch (e) { /* fall back to a plain number */ }
  const abs = Math.abs(v);
  return v.toLocaleString(undefined, { maximumFractionDigits: abs >= 100 ? 0 : abs >= 1 ? 2 : 4 });
}

/**
 * Adds "Trend: <value>" under each series in the hover pop-up, for series
 * that have a trend line. The value is the trend line's height at the hovered
 * date, read back through the series' own y axis. Wraps any afterLabel the
 * chart already had.
 */
function patchTooltip(chart) {
  const raw = chart.config.options || (chart.config.options = {});
  raw.plugins = raw.plugins || {};
  if (raw.plugins.trendLine === false) return;
  const tt = raw.plugins.tooltip = raw.plugins.tooltip || {};
  if (tt.$trendPatched) return;
  tt.$trendPatched = true;
  tt.callbacks = tt.callbacks || {};
  const base = tt.callbacks.afterLabel;

  tt.callbacks.afterLabel = function (ctx) {
    const prev = base ? base.call(this, ctx) : undefined;
    const c = ctx.chart;
    const fit = !isHidden(c) && c.$trendFits && c.$trendFits[ctx.datasetIndex];
    const el = ctx.element;
    if (!fit || !el || !Number.isFinite(el.x)) return prev;
    const scale = c.scales[fit.yAxisID];
    if (!scale) return prev;
    const value = scale.getValueForPixel(fit.a + fit.b * el.x);
    if (!Number.isFinite(value)) return prev;
    const line = TIP_PREFIX + formatLike(scale, value);
    if (prev === undefined || prev === null || prev === '') return line;
    return (Array.isArray(prev) ? prev : [prev]).concat(line);
  };
}

/**
 * A dotted square, in the series' colour, beside each "Trend:" line of the
 * hover pop-up - the same mark the Trend item has in the legend.
 *
 * Chart.js draws a colour square only for a series' own line; the Trend line
 * is indented to the same column but gets nothing. This walks the pop-up the
 * way Chart.js lays it out (Tooltip.drawTitle / drawBody / _drawColorBox in
 * chart.js 4.4) to find each Trend line, and draws the square in that empty
 * column. Left-aligned, left-to-right pop-ups with colour squares only, which
 * is every pop-up in this dashboard.
 */
function drawTooltipMarks(chart, tooltip) {
  if (!tooltip || !tooltip.opacity) return;
  const o = tooltip.options;
  if (!o || !o.displayColors || o.rtl || (o.bodyAlign && o.bodyAlign !== 'left')) return;
  const body = tooltip.body || [];
  if (!body.some((b) => (b.after || []).some((l) => String(l).indexOf(TIP_PREFIX) === 0))) return;

  const ctx = chart.ctx;
  const pad = toPadding(o.padding);
  const titleFont = toFont(o.titleFont), bodyFont = toFont(o.bodyFont);
  const boxW = o.boxWidth, boxH = o.boxHeight;
  const x = tooltip.x + pad.left;
  let y = tooltip.y + pad.top;

  // title
  const title = tooltip.title || [];
  title.forEach((_t, i) => {
    y += titleFont.lineHeight + o.titleSpacing;
    if (i + 1 === title.length) y += o.titleMarginBottom - o.titleSpacing;
  });

  const step = (h) => { y += h + o.bodySpacing; };
  (tooltip.beforeBody || []).forEach(() => step(bodyFont.lineHeight));

  const yOff = boxH < bodyFont.lineHeight ? (bodyFont.lineHeight - boxH) / 2 : 0;
  ctx.save();
  ctx.globalAlpha = tooltip.opacity;
  body.forEach((item, i) => {
    (item.before || []).forEach(() => step(bodyFont.lineHeight));
    (item.lines || []).forEach((_l, j) => step(j === 0 ? Math.max(bodyFont.lineHeight, boxH) : bodyFont.lineHeight));
    (item.after || []).forEach((l) => {
      if (String(l).indexOf(TIP_PREFIX) === 0) {
        const col = (tooltip.labelColors && tooltip.labelColors[i]) || {};
        const stroke = fade(typeof col.borderColor === 'string' ? col.borderColor : null, 0.95)
          || 'rgba(200,208,240,0.9)';
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = stroke;
        ctx.strokeRect(x + 0.5, y + yOff + 0.5, boxW - 1, boxH - 1);
      }
      step(bodyFont.lineHeight);
    });
  });
  ctx.restore();
}

const trendLine = {
  id: 'trendLine',

  afterTooltipDraw(chart, args) { drawTooltipMarks(chart, args && args.tooltip); },

  /* Before the legend builds its items, for new charts and for charts whose
     options are replaced and updated later. */
  beforeInit(chart) { patchLegend(chart); patchTooltip(chart); },
  beforeUpdate(chart) { patchLegend(chart); patchTooltip(chart); },

  afterDatasetsDraw(chart, _args, opts) {
    if (opts === false || (opts && opts.display === false)) return;
    if (isHidden(chart)) return;                          // switched off in the legend
    if (chart.options.indexAxis === 'y') return;
    if (!hasVisibleAxis(chart)) return;                   // sparkline

    const area = chart.chartArea;
    if (!area) return;
    const ctx = chart.ctx;
    /* What was drawn, per series: { datasetIndex, x0, y0, x1, y1 } in pixels.
       Kept on the chart so it can be checked; nothing reads it otherwise. */
    chart.$trendLines = [];
    /* The fit itself, per dataset index, for the hover pop-up: pixel y at
       pixel x is a + b*x on the series' own y axis. */
    chart.$trendFits = {};

    chart.data.datasets.forEach((ds, i) => {
      if (!ds || ds.trendLine === false) return;
      const meta = chart.getDatasetMeta(i);
      if (!meta || meta.hidden || !chart.isDatasetVisible(i)) return;
      if (!isLineSeries(chart, meta, ds)) return;
      if (Array.isArray(ds.borderDash) && ds.borderDash.length) return;   // reference line

      // Points actually drawn, in pixels. Category and time axes are linear
      // in pixel space, so a pixel fit is the same fit as one in data space.
      const pts = (meta.data || []).filter((el) =>
        el && !el.skip && Number.isFinite(el.x) && Number.isFinite(el.y));
      if (pts.length < 3) return;

      const n = pts.length;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      pts.forEach((p) => { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
      const den = n * sxx - sx * sx;
      if (!den) return;
      const b = (n * sxy - sx * sy) / den;
      const a = (sy - b * sx) / n;

      const x0 = pts[0].x, x1 = pts[n - 1].x;
      const color = fade(ds.borderColor, 0.85) || 'rgba(255,255,255,0.7)';
      chart.$trendLines.push({ datasetIndex: i, x0: x0, y0: a + b * x0, x1: x1, y1: a + b * x1 });
      chart.$trendFits[i] = { a: a, b: b, yAxisID: meta.yAxisID };

      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
      ctx.clip();
      ctx.setLineDash(DASH);
      ctx.lineWidth = WIDTH;
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x0, a + b * x0);
      ctx.lineTo(x1, a + b * x1);
      ctx.stroke();
      ctx.restore();
    });
  }
};

export default trendLine;
