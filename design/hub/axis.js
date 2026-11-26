/**
 * axis.js - clearer x / y axis numbers on the hub's game pages (Overview,
 * Growth, Retention and the rest): light grey, bold, a step bigger.
 *
 * Runs after chart-type.js, so it only changes colour and weight on top of
 * the shared font. KPI sparklines are skipped (they have no axes shown).
 * The reports get the same axis style from design/shared/chart-pro.js.
 */
import Chart from '../../src/shared/chart.js';

const PAGES = '#tab-overview, #tab-growth, #tab-retention, #tab-playtime, #tab-ftue, #tab-events, #tab-stability, #tab-rating';
const COLOUR = '#d3dae8';

function brighten(chart) {
  const cv = chart.canvas;
  if (!cv || !cv.closest || !cv.closest(PAGES) || cv.closest('.kpi-spark-box')) return;
  const o = chart.config && chart.config.options;
  if (!o || !o.scales) return;
  Object.keys(o.scales).forEach((k) => {
    const s = o.scales[k];
    if (!s || typeof s !== 'object') return;
    s.ticks = s.ticks || {};
    if (typeof s.ticks.color !== 'function') s.ticks.color = COLOUR;
    s.ticks.font = (s.ticks.font && typeof s.ticks.font === 'object') ? s.ticks.font : {};
    s.ticks.font.weight = '700';
    s.ticks.font.size = Math.max(s.ticks.font.size || 0, 16);
    if (s.title && typeof s.title === 'object' && typeof s.title.color !== 'function') s.title.color = COLOUR;
  });
}

Chart.register({ id: 'hubAxis', beforeInit: brighten, beforeUpdate: brighten });
