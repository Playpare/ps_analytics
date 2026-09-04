/**
 * The shell's entry point — the document at the root of the site.
 *
 * Import order is the contract. Chart.js has to be on `window` before the body
 * runs; that used to be guaranteed by the position of a <script src> tag, and
 * an import list is how that guarantee survives bundling.
 *
 * Two shared modules the five reports import are deliberately ABSENT:
 *
 *   src/shared/theme.js     this document carries its own data-theme system
 *                           and toggleTheme(); importing the shared one too
 *                           would give it two writers over one attribute.
 *
 *                           It does now WRITE the shared 'mss3d_theme' key,
 *                           and reads it back through the inline theme-boot in
 *                           the head. That half could not wait: the reports
 *                           follow that key, and a light shell wrapped around
 *                           a dark report is not something the eye forgives.
 *
 *   src/shared/snapshot.js  it has its own localStorage cache with a version
 *                           gate, a prefetch queue and an eviction policy.
 *                           Two cache layers over one payload is worse than
 *                           either alone. Still to reconcile.
 */

import './game-analytics.css';

import '../src/shared/chart.js';

import './game-analytics.legacy.js';
