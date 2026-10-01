/**
 * ============================================================================
 * test-fit.mjs — does the report still fit a frame narrower than the design?
 * ============================================================================
 *
 *   npm run test:fit
 *
 * WHY THIS EXISTS
 *
 * The weekly report is drawn for a 1520px slide. The hub hands it whatever is
 * left beside the sidebar, which on a normal laptop is around 780px, and at
 * that width a card hung 76px past the right edge of its own document.
 *
 * Nothing in the markup said so and nothing in a diff would. The cause was a
 * bare `1fr` grid column, which is `minmax(auto,1fr)`: it will not go below
 * its content's min-content width, so the grid overflows rather than shrinks.
 * The same shape as the flex `min-width:auto` trap, in a different property.
 *
 * WHAT IS TESTED, AND WHY A FIXTURE RATHER THAN THE REAL PAGE
 *
 * The real page refuses to draw without a token, and an empty report has no
 * content to overflow with - it would pass while broken. So the fixture
 * rebuilds the one condition that was actually measured in the browser: two
 * cards in a .row2, each holding a source row whose .src-name and .src-val
 * are fixed at 120px and 90px. That is where the 474px minimum comes from.
 *
 * Both directions matter:
 *   - narrow: nothing may cross the right edge
 *   - wide:   the two columns must still BE two columns
 *
 * A fix that stacks everything always would pass the first and ruin the
 * report, so the second is not padding.
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(ROOT, 'reports/weekly/weekly.css'), 'utf8');

/* 474px is not a guess. It is what the real card measured in the browser at
   a 771px frame, where it hung 76px past the right edge. The fixture cannot
   reproduce that from .src-name and .src-val alone - those come to about
   316px - so the measured minimum is stated outright rather than approximated
   by piling in markup until the number happens to come out right. */
const MEASURED_CARD_MIN = 474;

const card = (title) => `
  <div class="card">
    <h2>${title}</h2>
    <div style="min-width:${MEASURED_CARD_MIN}px;height:1px"></div>
    <div class="src-row">
      <div class="src-name">Rewarded Video</div>
      <div class="src-bar-track"><div class="src-bar" style="width:70%">70%</div></div>
      <div class="src-val">$12,345</div>
    </div>
    <div class="src-row">
      <div class="src-name">Interstitial</div>
      <div class="src-bar-track"><div class="src-bar" style="width:40%">40%</div></div>
      <div class="src-val">$6,789</div>
    </div>
  </div>`;

/* `live-ready` is not decoration. weekly.css line 2 is
   `body:not(.live-ready) .tabview{visibility:hidden}`, and the report adds
   that class once data arrives. Without it every card is visibility:hidden,
   the overflow check skips hidden elements, and the test passes on markup
   that is 300px too wide. It did exactly that until the fixture was checked
   against a browser rather than trusted. */
const page = `<!DOCTYPE html><html data-theme="dark"><head><meta charset="utf-8">
<style>${css}</style>
<style>html,body{margin:0;padding:0}</style></head>
<body class="live-ready"><div id="tab-report" class="tabview"><div class="slide"><div class="sb">
  <div class="row2 ad-format-wide">${card('Revenue by format')}${card('eCPM by format')}</div>
</div></div></div></body></html>`;

const browser = await chromium.launch();
let bad = 0, n = 0;
const ok = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

/** Everything that crosses the right edge of the document. */
async function measure(width) {
  const p = await browser.newPage({ viewport: { width, height: 900 } });
  await p.setContent(page, { waitUntil: 'load' });
  const r = await p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll('*')]
      .filter((el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        return el.getBoundingClientRect().right > W + 1;
      })
      .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(/\s+/)[0]);
    const row = document.querySelector('.row2');
    const cards = [...row.children].map((c) => Math.round(c.getBoundingClientRect().top));
    return {
      docW: W,
      scrollW: document.documentElement.scrollWidth,
      overflowing: [...new Set(over)],
      /* Same top = side by side. Different tops = stacked. */
      columns: new Set(cards).size === 1 ? 2 : 1
    };
  });
  await p.close();
  return r;
}

/* ---- the width that was actually measured in the browser --------------- */
const narrow = await measure(771);
ok('nothing crosses the right edge at 771px', narrow.overflowing, []);
ok('no horizontal scroll at 771px', narrow.scrollW <= narrow.docW, true);
ok('the two cards are stacked at 771px', narrow.columns, 1);

/* ---- and the width the report is drawn for ----------------------------- */
const wide = await measure(1400);
ok('nothing crosses the right edge at 1400px', wide.overflowing, []);
ok('the two cards are still side by side at 1400px', wide.columns, 2);

/* ═══════════════════════════════════════════════════════════════════════
   The shell, at four screen sizes
   ═══════════════════════════════════════════════════════════════════════
   The report lives in an iframe whose height used to be
   calc(100vh - 170px) - the topbar, the range bar and the content padding
   added up by hand. The range bar is display:none on every report scope, so
   53px that was not there was subtracted anyway, and the bottom of every
   slide was lost.

   Four sizes rather than one, because a hand-added number can be right at
   the size it was tuned on and wrong everywhere else. That is the whole
   claim being tested: the frame takes the space that is actually left, at
   any size, without anyone re-deriving a number. */

const shellCss = readFileSync(join(ROOT, 'game-analytics/game-analytics.css'), 'utf8');

/* data-scope is deliberately NOT "game": that is what a report section sets,
   and it is what hides the range bar. A fixture that left it as "game" would
   test the one case where the old arithmetic happened to be closest. */
const shell = `<!DOCTYPE html><html data-theme="dark"><head><meta charset="utf-8">
<style>${shellCss}</style><style>html,body{margin:0;padding:0}</style></head>
<body data-scope="weekly">
  <div class="shell" id="appShell">
    <aside class="sidebar"></aside>
    <div class="main">
      <div class="topbar"><div class="topbar-title">Monetization</div></div>
      <div id="freshBanner"></div>
      <div class="rangebar"><div class="range-pills"></div></div>
      <div class="content">
        <div class="tab-pane report-pane on"><iframe class="report-frame"></iframe></div>
      </div>
    </div>
  </div>
</body></html>`;

async function shellAt(width, height) {
  const p = await browser.newPage({ viewport: { width, height } });
  await p.setContent(shell, { waitUntil: 'load' });
  const r = await p.evaluate(() => {
    const f = document.querySelector('.report-frame');
    const rect = f.getBoundingClientRect();
    const rb = document.querySelector('.rangebar');
    return {
      frameH: Math.round(rect.height),
      wastedBelow: Math.round(innerHeight - rect.bottom),
      rangeBarShown: getComputedStyle(rb).display !== 'none',
      outerScroll: document.documentElement.scrollHeight
                   > document.documentElement.clientHeight + 1
    };
  });
  await p.close();
  return r;
}

const SIZES = [[1280, 720], [1366, 768], [1920, 1080], [2560, 1440]];

for (const [w, h] of SIZES) {
  const r = await shellAt(w, h);
  /* Hidden on a report scope. If this ever goes true the numbers below change
     meaning, so it is asserted rather than assumed. */
  ok(`${w}x${h}: the range bar is hidden on a report scope`, r.rangeBarShown, false);
  /* Only .content's bottom padding may remain. More than that is the frame
     failing to claim space that is there. */
  ok(`${w}x${h}: no more than the content padding is left below the frame`,
     r.wastedBelow <= 28, true);
  ok(`${w}x${h}: the shell itself does not scroll`, r.outerScroll, false);
}

await browser.close();
console.log(bad ? `\n  ${bad} of ${n} FAILED\n` : `\n  fit: all ${n} passed\n`);
process.exit(bad ? 1 : 0);
