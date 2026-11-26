/**
 * pro-theme.js - the dashboard design for every hub page (the reports use
 * src/shared/report-pro.js). Adds html.pro-theme, which the stylesheet and
 * drawSpark's wave band read, and gives each KPI card its icon.
 *
 * Icons are chosen from the KPI's label, so any card on any page - including
 * cards added later - gets a fitting icon with no per-page list to maintain.
 */
import './pro-theme.css';
import { iconFor } from '../shared/pro-icons.js';
import { kpiAccent } from '../shared/kpi-colors.js';

document.documentElement.classList.add('pro-theme');

function paintIcons() {
  document.querySelectorAll('.tab-pane .kpi').forEach((card) => {
    const lbl = card.querySelector('.kpi-label');
    if (!lbl) return;
    const text = lbl.textContent.trim();
    if (card.dataset.icoFor === text) return;     // already done for this label
    card.dataset.icoFor = text;
    card.style.setProperty('--ico', iconFor(text));
    card.style.setProperty('--kc', kpiAccent(text));
  });
}

let queued = false;
const run = () => { queued = false; paintIcons(); };
const start = () => {
  run();
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(document.body, { childList: true, subtree: true });
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
