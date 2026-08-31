/**
 * UA report entry point.
 *
 * Import order is the contract. Chart.js has to be on `window` before the
 * report body runs, and the snapshot cache has to publish SnapshotBoot before
 * the boot sequence that calls it — both are things a <script> tag used to
 * guarantee by position in the document, and an import list is how that
 * guarantee survives bundling.
 */

import '../../src/shared/styles/motion.css';
import './ua.css';

import '../../src/shared/theme.js';
import '../../src/shared/chart.js';
import '../../src/shared/snapshot.js';

import './ua.legacy.js';
