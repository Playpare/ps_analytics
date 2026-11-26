/**
 * date-popup.js — the rounded date-filter popup, shared by every report that
 * uses the `.date-controls select.date` pattern (Negative Spend, Life Time).
 *
 * A native <select> list cannot be styled (square corners, OS colours), so
 * the select stays as the source of truth, hidden, and this draws a pill
 * button plus a menu over it. Choosing an item sets the select's value and
 * fires its own `change` event, so each report's date logic is untouched.
 *
 * Reports rebuild their date controls after data loads, and set the select's
 * value from code, so a MutationObserver re-enhances new selects and keeps the
 * label in step. syncDate() only writes when something actually changed, so
 * the observer cannot feed itself.
 */
import '../../design/shared/date-popup.css';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Which selects become popups: every report's date pill, the filter
   dropdowns in a .filterbar (ASO Reviews), the channel / network filters
   (.chan-filter, .ctrl-select), the hub's form selects (.form-ctrl) and any
   select marked data-popup. Every one is drawn as the same gradient pill as
   the date range (design/shared/date-popup.css); .dd-plain only changes the
   size and opens the menu to the left. */
const SELECTS = '.date-controls select.date, .filterbar select, select[data-popup], ' +
  'select.chan-filter, select.ctrl-select, select.form-ctrl';

export function enhanceDate() {
  document.querySelectorAll(SELECTS).forEach((sel) => {
    const prev = sel.previousElementSibling;
    let dd = prev && prev.classList.contains('dd') ? prev : null;
    if (!dd) {
      dd = document.createElement('div');
      /* gradient pill for a page's date control (and any select marked
         data-popup="accent"); everything else gets the plain pill */
      dd.className = 'dd' + (sel.matches('.date-controls select.date, select[data-popup="accent"]') ? '' : ' dd-plain');
      dd.innerHTML = '<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false">' +
        '<span class="dd-lbl"></span>' +
        '<svg class="dd-chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1.5 1.5 6 6l4.5-4.5" fill="none" ' +
        'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button><div class="dd-menu" role="listbox"></div>';
      sel.before(dd);
      sel.classList.add('dd-native');
      const btn = dd.querySelector('.dd-btn');
      const close = () => { dd.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
      btn.onclick = (ev) => {
        ev.stopPropagation();
        const open = !dd.classList.contains('open');
        document.querySelectorAll('.dd.open').forEach((o) => o.classList.remove('open'));
        dd.classList.toggle('open', open);
        btn.setAttribute('aria-expanded', String(open));
      };
      dd.querySelector('.dd-menu').onclick = (ev) => {
        const it = ev.target.closest('[data-v]');
        if (!it) return;
        ev.stopPropagation();
        close();
        if (sel.value !== it.dataset.v) {
          sel.value = it.dataset.v;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncDate(sel, dd);
      };
      document.addEventListener('click', (ev) => { if (!dd.contains(ev.target)) close(); });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
    }
    syncDate(sel, dd);
  });
}

function syncDate(sel, dd) {
  /* options are refilled from code (e.g. the From / To date lists), so the
     signature covers their text as well as the value and count */
  const opts = sel.options, n = opts.length;
  const sig = sel.value + '|' + n + '|' + (n ? opts[0].text + '|' + opts[n - 1].text : '');
  if (dd.dataset.sig === sig) return;          // nothing changed: write nothing
  dd.dataset.sig = sig;
  const cur = sel.options[sel.selectedIndex];
  dd.querySelector('.dd-lbl').textContent = cur ? cur.text : '';
  /* A divider before the non-preset choices (custom / single date). */
  dd.querySelector('.dd-menu').innerHTML = [...sel.options].map((o, i, all) => {
    const special = o.value === 'custom' || o.value === 'single';
    const prevSpecial = i > 0 && (all[i - 1].value === 'custom' || all[i - 1].value === 'single');
    return (special && !prevSpecial ? '<div class="dd-sep"></div>' : '') +
      `<button type="button" role="option" data-v="${esc(o.value)}" aria-selected="${o.value === sel.value}"` +
      ` class="dd-it${o.value === sel.value ? ' on' : ''}"><span>${esc(o.text)}</span><i>✓</i></button>`;
  }).join('');
}

/* Auto mode: enhance whatever date controls appear, whenever they appear. */
let queued = false;
const run = () => { queued = false; enhanceDate(); };
const start = () => {
  run();
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(document.body, { childList: true, subtree: true });
  /* value set from code fires no DOM mutation; a change event or a filter
     click is when it happens in practice, so re-check then */
  document.addEventListener('change', () => requestAnimationFrame(run), true);
  document.addEventListener('click', () => requestAnimationFrame(run), true);
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
