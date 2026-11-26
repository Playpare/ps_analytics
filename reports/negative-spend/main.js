/**
 * Negative Spend monitor entry point.
 *
 * This report is not a hub tab: the UA report opens it in a nested iframe and
 * passes it the endpoint as ?api=. It reads the same sessionStorage token as
 * everything else, so it needs no sign-in of its own.
 *
 * Every stylesheet it uses lives in design/ (see design/README.md).
 */

import '../../design/shared/theme-tokens.css';
import '../../design/shared/motion.css';
import '../../design/reports/negative-spend/negative-spend.css';
import '../../design/reports/negative-spend/design.css';

import '../../src/shared/chart.js';

import './negative-spend.legacy.js';

/* After the report, never before: glance.js registers itself on the bridge
   that negative-spend.legacy.js publishes at the end of its own evaluation.
   Imported first, it would find no bridge to attach to and the new sections
   would silently never render. */
import './glance.js';

/* Last, so the one font stack and the type scale win (DESIGN.md §11). */
import '../../design/shared/typography.css';
/* the dashboard design, shared by all the reports */
import '../../design/shared/report-pro.js';
/* one loading screen for every page: the Pulse logo + a Loading bar */
import '../../design/shared/ps-loader.css';
import '../shared/ps-open.js';
