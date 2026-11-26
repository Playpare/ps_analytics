/**
 * chart-type.js — one chart typeface and a slightly zoomed-in chart text
 * scale for every page that imports it (UA, Monetization, ASO, the hub).
 *
 * The reports each set their own Chart.js fonts - Poppins, DM Mono, small
 * sizes - inside every chart's config. Rather than edit hundreds of call
 * sites, a global plugin rewrites the fonts on each chart just before it
 * draws: same family as the rest of the dashboard, and sizes raised to at
 * least the targets below. Colours are never touched.
 *
 * A font that is a function (scriptable) is left alone.
 */
import Chart from '../../src/shared/chart.js';

const FAMILY = "'Segoe UI', 'Segoe UI Variable', system-ui, Arial, sans-serif";
const MIN = { tick: 14.5, title: 14.5, legend: 15, tipTitle: 14.5, tipBody: 14, label: 13.5 };

Chart.defaults.font.family = FAMILY;
Chart.defaults.font.size = Math.max(Chart.defaults.font.size || 12, 14);

function lift(font, min, weight) {
  if (typeof font === 'function') return font;
  const f = Object.assign({}, font || {});
  f.family = FAMILY;
  f.size = Math.max(typeof f.size === 'number' ? f.size : 0, min);
  if (weight && !f.weight) f.weight = weight;
  return f;
}

function unify(chart) {
  const o = chart.config && chart.config.options;
  if (!o) return;
  o.font = lift(o.font, 14);

  const scales = o.scales || {};
  Object.keys(scales).forEach((k) => {
    const s = scales[k];
    if (!s || typeof s !== 'object') return;
    s.ticks = s.ticks || {};
    s.ticks.font = lift(s.ticks.font, MIN.tick, '500');
    if (s.title) s.title.font = lift(s.title.font, MIN.title, '600');
    if (s.pointLabels) s.pointLabels.font = lift(s.pointLabels.font, MIN.tick, '500');
  });

  const p = o.plugins = o.plugins || {};
  p.legend = p.legend || {};
  p.legend.labels = p.legend.labels || {};
  p.legend.labels.font = lift(p.legend.labels.font, MIN.legend, '500');
  p.tooltip = p.tooltip || {};
  p.tooltip.titleFont = lift(p.tooltip.titleFont, MIN.tipTitle, '600');
  p.tooltip.bodyFont = lift(p.tooltip.bodyFont, MIN.tipBody);
  if (p.tooltip.footerFont) p.tooltip.footerFont = lift(p.tooltip.footerFont, MIN.tipBody);
  if (p.title) p.title.font = lift(p.title.font, 16, '700');
  if (p.subtitle) p.subtitle.font = lift(p.subtitle.font, MIN.tick);

  /* annotation labels (change logs, targets) */
  const ann = p.annotation && p.annotation.annotations;
  if (ann && typeof ann === 'object') {
    Object.values(ann).forEach((a) => {
      if (a && a.label && typeof a.label === 'object') a.label.font = lift(a.label.font, MIN.label);
    });
  }
}

Chart.register({
  id: 'dashboardType',
  beforeInit: unify,
  beforeUpdate: unify,
});

export default Chart;
