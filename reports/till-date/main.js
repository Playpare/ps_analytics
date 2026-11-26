/**
 * Life Time report entry point (formerly "Till Date"; the folder keeps its name).
 *
 * It is the only report that draws Chart.js annotations, which is why it was
 * the only one loading chartjs-plugin-annotation from a second CDN.
 * src/shared/chart.js registers the plugin for everybody now.
 *
 * Every stylesheet it uses lives in design/ (see design/README.md).
 */

import '../../design/shared/motion.css';
import '../../design/reports/till-date/till-date.css';
/* Negative Spend's fonts, sizes and control shapes. Loaded right after the
   report's stylesheet and BEFORE its script, so the charts read the new
   greys on their first draw (in dev, CSS lands in import order). */
import '../../design/reports/till-date/design.css';

import '../../src/shared/chart.js';

import './till-date.legacy.js';

import '../../src/shared/date-popup.js';
/* the dashboard design, shared by all the reports */
import '../../design/shared/report-pro.js';
/* one loading screen for every page: the Pulse logo + a Loading bar */
import '../../design/shared/ps-loader.css';
import '../shared/ps-open.js';
