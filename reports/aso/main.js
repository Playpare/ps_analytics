/**
 * ASO report entry point. See reports/ua/main.js on why the order matters.
 */

import '../../src/shared/styles/motion.css';
import './aso.css';
/* dashboard-wide fonts, sizes and chart scale - colours untouched */
import '../../src/shared/styles/report-type.css';
/* ASO-specific clean-up: Overview shows only the Android vs IOS cards,
   Theme Detail zoomed in */
import './design.css';

import '../../src/shared/theme.js';
import '../../src/shared/chart.js';
import '../../src/shared/chart-type.js';
import '../../src/shared/date-popup.js';
import '../../src/shared/snapshot.js';

import './aso.legacy.js';
