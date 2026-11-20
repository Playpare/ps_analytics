/**
 * Life Time report entry point (formerly "Till Date"; the folder keeps its name).
 *
 * Two notes specific to this report:
 *
 * 1. It is the only one that draws Chart.js annotations, which is why it was
 *    the only one loading chartjs-plugin-annotation from a second CDN.
 *    src/shared/chart.js registers the plugin for everybody now.
 *
 * 2. It never had the theme-sync script. It ships a full set of `body.lt`
 *    rules — so somebody built it to support the light theme — but with
 *    nothing listening for the hub's `storage` event, toggling the theme left
 *    this one tab dark. Importing the shared module fixes that. It defines no
 *    `window.__themeRerender`, so the charts keep their build-time colours
 *    until the next data refresh, exactly as the other reports behave when
 *    they have nothing to redraw.
 */

import '../../src/shared/styles/motion.css';
import './till-date.css';
/* Negative Spend's fonts, sizes and control shapes. Loaded right after the
   report's stylesheet and BEFORE its script, so the charts read the new
   greys on their first draw (in dev, CSS lands in import order). */
import './design.css';

import '../../src/shared/theme.js';
import '../../src/shared/chart.js';

import './till-date.legacy.js';

import '../../src/shared/date-popup.js';
