/**
 * UA Network Performance entry point.
 *
 * Import order is the contract: Chart.js has to be on `window` before the
 * render module draws anything, and the theme has to be stamped before first
 * paint or anyone on light sees a flash of dark.
 */

import './ua-network.css';
import '../../src/shared/styles/report-type.css';

import '../../src/shared/theme.js';
import '../../src/shared/chart.js';
import '../../src/shared/chart-type.js';

import { GAME_IDS, windows, fetchWindow } from './api.js';
import { renderPage, showError } from './render.js';

const state = { days: 14, plat: 'android' };
let inFlight = 0;

const loader = (on) => {
  const el = document.getElementById('loader');
  if (el) el.style.display = on ? '' : 'none';
};

async function load() {
  const seq = ++inFlight;
  const win = windows(state.days);
  loader(true);
  document.getElementById('fatal').hidden = true;

  try {
    const gameId = GAME_IDS[state.plat];
    /* Both windows at once. The previous period is a second request because
       the channel rollup is aggregated server-side over the window it is
       asked for, and a period total cannot be un-summed into two halves. */
    const [cur, prev] = await Promise.all([
      fetchWindow(gameId, win.cur),
      fetchWindow(gameId, win.prev)
    ]);
    /* A slower earlier request must not paint over a later one: the range
       buttons are two clicks apart and the backend is not always fast. */
    if (seq !== inFlight) return;
    renderPage(cur, prev, win, state.days);
  } catch (e) {
    if (seq !== inFlight) return;
    showError(String((e && e.message) || e));
  } finally {
    if (seq === inFlight) loader(false);
  }
}

document.getElementById('fRange').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#fRange button')
    .forEach((x) => x.classList.toggle('on', x === b));
  state.days = Number(b.dataset.v);
  load();
});

document.getElementById('fPlat').addEventListener('change', (e) => {
  state.plat = e.target.value;
  load();
});

document.getElementById('refreshBtn').addEventListener('click', () => load());

/* The shell can switch theme while the report is open. Redrawing is not
   optional: Chart.js reads the colour tokens once, when it builds, so the
   charts keep the old theme's greys until they are rebuilt. */
window.__themeRerender = () => load();

load();
