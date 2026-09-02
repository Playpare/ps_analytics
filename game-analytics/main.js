/**
 * Game Analytics entry point.
 *
 * Import order is the contract. Chart.js has to be on `window` before the
 * report body runs — that used to be guaranteed by the position of a <script
 * src> tag in the document, and an import list is how that guarantee survives
 * bundling.
 *
 * Two shared modules the other five reports import are deliberately ABSENT:
 *
 *   src/shared/theme.js     this document carries its own data-theme system
 *                           and toggleTheme(); adding the shared one would
 *                           give it two, fighting over the same attribute.
 *
 *   src/shared/snapshot.js  it has its own localStorage cache with a version
 *                           gate, a prefetch queue and an eviction policy.
 *                           Two cache layers over one payload is worse than
 *                           either alone.
 *
 * Both are things to RECONCILE later, once the migration is proven not to
 * have changed anything. Doing it here would mean this step altered
 * behaviour, which is the one thing it must not do.
 */

import './game-analytics.css';

import '../src/shared/chart.js';

import './game-analytics.legacy.js';
