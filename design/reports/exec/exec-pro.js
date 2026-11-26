/**
 * exec-pro.js - the Executive page in the hub's pro theme (same look as the
 * Overview), and its date presets as the UA Report's date dropdown.
 *
 * The original preset buttons stay in the page, hidden; the dropdown clicks
 * them, so the page's own date logic is untouched.
 */
import '../../shared/report-pro.js';
import { iconFor } from '../../shared/pro-icons.js';
import { kpiAccent } from '../../shared/kpi-colors.js';
import '../../../src/shared/date-popup.js';
import './exec-pro.css';
import '../../shared/ps-loader.css';
import '../../../reports/shared/ps-open.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function presetDropdown() {
  const bar = $('#dateBar');
  if (!bar || $('#execPreset')) return;
  const btns = $$('.presetBtn[data-preset]', bar);
  if (!btns.length) return;
  /* a plain <select> the shared date-popup turns into the UA-style pill;
     choosing an item clicks the matching original button, so the page's own
     preset logic (app.js applyPreset) does all the work */
  const sel = document.createElement('select');
  sel.id = 'execPreset';
  sel.setAttribute('data-popup', 'accent');
  sel.setAttribute('aria-label', 'Date range');
  sel.innerHTML = btns.map((b) => `<option value="${b.dataset.preset}">${b.textContent.trim()}</option>`).join('')
    + '<option value="custom">Custom range</option>';
  const wrap = document.createElement('span');
  wrap.className = 'pro-preset';
  wrap.appendChild(sel);
  /* in the top bar, just left of Refresh (falls back to the date bar) */
  const refresh = $('#refreshBtn');
  if (refresh && refresh.parentElement) refresh.parentElement.insertBefore(wrap, refresh);
  else bar.insertBefore(wrap, btns[0]);

  const sync = () => {
    const on = btns.find((b) => b.classList.contains('active'));
    const v = on ? on.dataset.preset : 'custom';
    if (sel.value !== v) { sel.value = v; sel.dispatchEvent(new Event('pro-sync')); }
    bar.classList.toggle('pro-custom', v === 'custom');
  };
  sel.addEventListener('change', () => {
    if (sel.value === 'custom') { bar.classList.add('pro-custom'); $('#fFrom')?.focus(); return; }
    const b = btns.find((x) => x.dataset.preset === sel.value);
    if (b) b.click();
    sync();
  });
  /* the page changes the active button itself (typing a custom date clears
     it), so follow it */
  new MutationObserver(sync).observe(bar, { subtree: true, attributes: true, attributeFilter: ['class'] });
  sync();
}

/* the filter row (games, platforms, From / To) moves up into the top bar, on
   the line the Dashboard button used to hold (that button is hidden: it is
   the page's only tab). The row element itself moves, so every control keeps
   its id and listeners. */
function filtersInTopBar() {
  const bar = $('#dateBar'), top = $('.topbar'), right = $('.topbar .topRight');
  if (!bar || !top || !right || bar.parentElement === top) return;
  top.insertBefore(bar, right);
  bar.classList.add('pro-in-top');
}

function cardIcons() {
  $$('.kpi, .ltvKpi').forEach((k) => {
    const l = $('.kpiLbl', k);
    if (!l) return;
    const t = l.textContent.trim();
    if (k.dataset.icoFor === t) return;
    k.dataset.icoFor = t;
    k.style.setProperty('--ico', iconFor(t));
    k.style.setProperty('--kc', kpiAccent(t));
  });
}

{
  document.documentElement.classList.add('exec-pro');
  /* inside the hub, the hub's own top bar already has the user, sign-out and
     theme switch; this page's copies are hidden there */
  if (window.parent && window.parent !== window) document.documentElement.classList.add('exec-embedded');
  /* game and platform filters: the same rounded popup, plain style */
  ['fGame', 'fPlat'].forEach((id) => { const s = document.getElementById(id); if (s) s.setAttribute('data-popup', ''); });

  const run = () => { presetDropdown(); filtersInTopBar(); cardIcons(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  let q = false;
  new MutationObserver(() => { if (!q) { q = true; requestAnimationFrame(() => { q = false; cardIcons(); }); } })
    .observe(document.documentElement, { childList: true, subtree: true });
}
