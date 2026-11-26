/**
 * ps-open.js - the shared loading screen on every report's first open.
 *
 * Several reports paint straight from a saved copy and so never raised their
 * own loader; this one goes up as soon as the page's script runs, whatever
 * the page then does, and comes down once the page has loaded and had a
 * moment to draw. A page still loading its data then shows its own loader,
 * which looks the same (ps-loader.css), so the two read as one.
 */
import '../../design/shared/ps-loader.css';

const MIN_MS = 900;
const t0 = Date.now();
const el = document.createElement('div');
el.id = 'bootOverlay';
el.setAttribute('role', 'status');
el.setAttribute('aria-label', 'Loading');
(document.body || document.documentElement).appendChild(el);

const done = () => setTimeout(() => el.remove(), Math.max(0, MIN_MS - (Date.now() - t0)));
if (document.readyState === 'complete') done();
else window.addEventListener('load', done, { once: true });
// never strand anyone behind it
setTimeout(() => el.remove(), 20000);
