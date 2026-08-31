/**
 * Negative Spend monitor entry point.
 *
 * This report is not a hub tab: the UA report opens it in a nested iframe and
 * passes it the endpoint as ?api=. It reads the same sessionStorage token as
 * everything else, so it needs no sign-in of its own.
 *
 * Like till-date, it shipped light-theme rules without the script that applies
 * them — see the note in reports/till-date/main.js.
 */

import '../../src/shared/styles/motion.css';
import './negative-spend.css';

import '../../src/shared/theme.js';
import '../../src/shared/chart.js';

import './negative-spend.legacy.js';
