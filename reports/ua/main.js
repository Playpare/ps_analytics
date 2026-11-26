/**
 * UA report entry point.
 *
 * Import order is the contract. Chart.js has to be on `window` before the
 * report body runs, and the snapshot cache has to publish SnapshotBoot before
 * the boot sequence that calls it — both are things a <script> tag used to
 * guarantee by position in the document, and an import list is how that
 * guarantee survives bundling.
 */

import '../../design/shared/motion.css';
import '../../design/reports/ua/ua.css';
/* dashboard-wide fonts, sizes and chart scale - colours untouched */
import '../../design/shared/report-type.css';

import '../../src/shared/chart.js';
import '../../design/shared/chart-type.js';
import '../../src/shared/donut.js';
import '../../src/shared/date-popup.js';
import '../../src/shared/snapshot.js';

import './ua.legacy.js';
/* the dashboard design, shared by all the reports */
import '../../design/shared/report-pro.js';
/* one loading screen for every page: the Pulse logo + a Loading bar */
import '../../design/shared/ps-loader.css';
import '../shared/ps-open.js';
