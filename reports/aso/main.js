/**
 * ASO report entry point. See reports/ua/main.js on why the order matters.
 */

import '../../design/shared/motion.css';
import '../../design/reports/aso/aso.css';
/* dashboard-wide fonts, sizes and chart scale - colours untouched */
import '../../design/shared/report-type.css';
/* ASO-specific clean-up: Overview shows only the Android vs IOS cards,
   Theme Detail zoomed in */
import '../../design/reports/aso/design.css';

import '../../src/shared/chart.js';
import '../../design/shared/chart-type.js';
import '../../src/shared/date-popup.js';
import '../../src/shared/snapshot.js';

import './aso.legacy.js';
/* the dashboard design, shared by all the reports */
import '../../design/shared/report-pro.js';
/* one loading screen for every page: the Pulse logo + a Loading bar */
import '../../design/shared/ps-loader.css';
import '../shared/ps-open.js';
