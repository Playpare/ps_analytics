/**
 * chart.js — the single Chart.js instance every report draws with.
 *
 * The six documents used to reach for Chart.js three different ways: a 272 KB
 * copy of the library committed next to the reports (ua, weekly), cdnjs
 * (till-date) and jsdelivr (aso, negative-spend). Three sources meant three
 * chances to be on a different point release than the report next to it, and
 * two of them put a third-party CDN on the critical path of a dashboard that
 * is otherwise entirely first-party.
 *
 * It is one npm dependency now, bundled and fingerprinted with everything
 * else, so all five reports are provably on the same version.
 *
 * `chart.js/auto` is the entry point that pre-registers every controller,
 * scale and element — the same thing the UMD builds did — so the report code
 * that assumes `new Chart(ctx, {type:'bar'})` just works needs no changes.
 */

import Chart from 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';

/* Only till-date draws annotations, but registering the plugin globally costs
   nothing at runtime and means a report that starts using them later does not
   have to discover this file first. */
Chart.register(annotationPlugin);

/* The report bundles construct charts through the bare global, exactly as
   they did when a <script src> put it there. */
window.Chart = Chart;

export default Chart;
