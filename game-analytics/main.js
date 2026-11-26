/**
 * The shell's entry point — the document at the root of the site.
 *
 * Import order is the contract. Chart.js has to be on `window` before the body
 * runs; that used to be guaranteed by the position of a <script src> tag, and
 * an import list is how that guarantee survives bundling.
 *
 * Every stylesheet and design script lives in design/ (see design/README.md).
 *
 * One shared module the reports import is deliberately ABSENT:
 *
 *   src/shared/snapshot.js  it has its own localStorage cache with a version
 *                           gate, a prefetch queue and an eviction policy.
 *                           Two cache layers over one payload is worse than
 *                           either alone. Still to reconcile.
 */

import '../design/hub/game-analytics.css';
/* dashboard-wide fonts, sizes and chart scale - colours untouched */
import '../design/shared/report-type.css';
/* the hub's own pages on the UA Report's design (sizes and shapes only) */
import '../design/hub/design.css';
/* the dashboard design (cards, icons, panels) for every hub page */
import '../design/hub/pro-theme.js';
/* the sign-in screen */
import '../design/hub/login.css';
/* one loading screen for every page: the Pulse logo + a Loading bar */
import '../design/shared/ps-loader.css';

import '../src/shared/chart.js';
import '../design/shared/chart-type.js';
/* brighter axis numbers on Overview / Growth / Retention */
import '../design/hub/axis.js';
/* Range + game dropdowns in the topbar use the UA-style rounded popup */
import '../src/shared/date-popup.js';

import './game-analytics.legacy.js';
