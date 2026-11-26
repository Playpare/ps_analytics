/**
 * Weekly report entry point. See reports/ua/main.js on why the order matters.
 */

import '../../design/shared/motion.css';
import '../../design/reports/weekly/weekly.css';
/* dashboard-wide fonts, sizes and chart scale - colours untouched */
import '../../design/shared/report-type.css';

import '../../src/shared/chart.js';
import '../../design/shared/chart-type.js';
import '../../src/shared/donut.js';

/* The slide bodies are zoomed (design.css), which enlarges each canvas after
   Chart.js has sized its pixels. Rendering at the same factor more pixels
   keeps every chart crisp instead of upscaled. */
import '../../design/reports/weekly/design.css';
import Chart from '../../src/shared/chart.js';
Chart.defaults.devicePixelRatio = (window.devicePixelRatio || 1) * 1.15;

/* Under CSS zoom the browser reports the mouse offset in zoomed pixels, while
   Chart.js lays the chart out in unzoomed ones - so hover and tooltips landed
   ~15% away from the pointer. Recompute the position from the pointer's real
   screen point and the canvas's on-screen size before Chart.js uses it. This
   is exact with or without zoom. */
Chart.register({
  id: 'zoomPointer',
  beforeEvent(chart, args) {
    const e = args.event, n = e && e.native;
    if (!n || typeof n.clientX !== 'number') return;
    const c = chart.canvas, r = c.getBoundingClientRect();
    if (!r.width || !c.clientWidth) return;
    e.x = (n.clientX - r.left) * (c.clientWidth / r.width);
    e.y = (n.clientY - r.top) * (c.clientHeight / r.height);
  },
});
import '../../src/shared/date-popup.js';
import '../../src/shared/snapshot.js';

import './weekly.legacy.js';
/* the dashboard design, shared by all the reports */
import '../../design/shared/report-pro.js';
/* one loading screen for every page: the Pulse logo + a Loading bar */
import '../../design/shared/ps-loader.css';
import '../shared/ps-open.js';
