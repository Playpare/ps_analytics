/**
 * theme.js — one theme, synced across the hub and every report.
 *
 * The choice is written to localStorage, which same-origin documents share.
 * A `storage` event fires in every OTHER document when one of them writes,
 * which is how a click in the hub's toggle reaches four iframes.
 *
 * Charts read their colours from CSS variables at build time, so they have to
 * be rebuilt on a change. That rebuild is expensive and blocks the main
 * thread, so it is deliberately pushed behind a paint: the CSS flip lands on
 * the next frame, and the redraw happens after. A report that is currently
 * hidden (its iframe is display:none, so its document has no width) stays
 * marked dirty and redraws when it is shown again — otherwise three reports
 * would rebuild at once on a thread they all share.
 *
 * ---------------------------------------------------------------------------
 * This reconciles four near-identical copies that had drifted apart:
 *
 *   hub        the full version: toggle button label, `visibilitychange`
 *              flush, and an early paint() before DOMContentLoaded
 *   ua/weekly  same, but no `visibilitychange` listener and no early paint,
 *              and its button label used the 🌙 emoji rather than the styled
 *              ☾ glyph the hub's CSS targets
 *   aso        paint + flush only: no setTheme, so a report could observe the
 *              theme but never change it
 *
 * The superset is kept. `visibilitychange` costs nothing and recovers a
 * report whose redraw was deferred while its tab was in the background; the
 * early paint is now handled by theme-boot.js in the head, so this module no
 * longer needs it. The ☾ glyph wins because `#themeBtn .theme-moon` in the
 * hub's stylesheet exists to style it, and the emoji version left that rule
 * matching nothing.
 */

const KEY = 'mss3d_theme';
let dirty = false;

function paint(mode) {
  const light = mode === 'light';
  if (document.body) document.body.classList.toggle('lt', light);
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  const btn = document.getElementById('themeBtn');
  if (btn) btn.innerHTML = light ? '<span class="theme-moon">☾</span> Dark' : '☀ Light';
}

function flush() {
  if (!dirty) return;
  if (typeof window.__themeRerender !== 'function') { dirty = false; return; }
  // A hidden iframe has no layout; leave it dirty until it is shown.
  if (!document.documentElement.clientWidth) return;
  dirty = false;
  try { window.__themeRerender(); } catch (e) { /* a report that cannot redraw keeps its old colours */ }
}

function apply(mode, initial) {
  paint(mode);
  if (initial) return;                       // first paint: nothing built yet
  dirty = true;
  // rAF gets us past the paint, the timeout past the frame's own work.
  requestAnimationFrame(() => setTimeout(flush, 0));
}

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'dark'; } catch (e) { return 'dark'; }
}

export function setTheme(mode) {
  try { localStorage.setItem(KEY, mode); } catch (e) { /* storage blocked */ }
  apply(mode);
}

export function toggleTheme() {
  setTheme(getTheme() === 'light' ? 'dark' : 'light');
}

/* The report bundles still call these as bare globals in code that has not
   been rewritten yet, and the hub's markup is wired to toggleThemeGlobal.
   Keeping the three names published means this module can be adopted without
   touching 800 KB of report code in the same change. */
window.getTheme = getTheme;
window.setTheme = setTheme;
window.toggleThemeGlobal = toggleTheme;

window.addEventListener('storage', (ev) => { if (ev.key === KEY) apply(ev.newValue || 'dark'); });
window.addEventListener('resize', flush);          // fires when a hidden iframe is shown
document.addEventListener('visibilitychange', flush);

/* theme-boot.js already set data-theme in the head, so there is no flash to
   avoid here — this is the pass that adds the body class and the button
   label, once the document has a body to put them on. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => apply(getTheme(), true));
} else {
  apply(getTheme(), true);
}
