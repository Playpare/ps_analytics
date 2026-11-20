/**
 * axis.js - clearer x / y axis numbers on the Overview, Growth and Retention
 * pages: a light grey (not white) and semibold, a step bigger.
 *
 * Runs after chart-type.js, so it only changes colour and weight on top of
 * the shared font. KPI sparklines are skipped (they have no axes shown).
 */
import Chart from '../src/shared/chart.js';

const PAGES = '#tab-overview, #tab-growth, #tab-retention, #tab-playtime, #tab-ftue, #tab-events, #tab-stability, #tab-rating';
const DARK  = '#b9c3d6';
const LIGHT = '#394155';

function axisColour() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? LIGHT : DARK;
}

function brighten(chart) {
  const cv = chart.canvas;
  if (!cv || !cv.closest || !cv.closest(PAGES) || cv.closest('.kpi-spark-box')) return;
  const o = chart.config && chart.config.options;
  if (!o || !o.scales) return;
  /* Retention: one step clearer again (brighter grey, bolder, bigger) */
  /* same strong style on Overview and Growth as on Retention */
  const ret = true;
  const col = ret
    ? (document.documentElement.getAttribute('data-theme') === 'light' ? '#262c3b' : '#d3dae8')
    : axisColour();
  Object.keys(o.scales).forEach((k) => {
    const s = o.scales[k];
    if (!s || typeof s !== 'object') return;
    s.ticks = s.ticks || {};
    if (typeof s.ticks.color !== 'function') s.ticks.color = col;
    s.ticks.font = (s.ticks.font && typeof s.ticks.font === 'object') ? s.ticks.font : {};
    s.ticks.font.weight = ret ? '700' : '600';
    s.ticks.font.size = Math.max(s.ticks.font.size || 0, ret ? 16 : 15);
    if (s.title && typeof s.title === 'object' && typeof s.title.color !== 'function') s.title.color = col;
  });
}

Chart.register({ id: 'hubAxis', beforeInit: brighten, beforeUpdate: brighten });
