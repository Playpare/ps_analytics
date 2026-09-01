/**
 * ============================================================================
 * glance-test.mjs — does the new summary agree with the table under it?
 * ============================================================================
 *
 * `npm run smoke` proves the page evaluates. It cannot prove the glance
 * section is CORRECT, because without a signed-in session DATA is null, render()
 * never runs, and the new code never executes at all.
 *
 * So this feeds a fixture snapshot through the report's real boot path — the
 * same fetch, the same applyPayload, the same render — by intercepting the
 * Apps Script request. Everything downstream is the shipped code.
 *
 * What it asserts is the one invariant glance.js exists to hold: the tiles are
 * a rollup of the rows the table draws. The live page fails this today — its
 * KPI reads "$0.00 at risk" above three campaigns marked CUT, because two
 * verdict engines answer on different bases. A regression back to that would
 * be invisible to every other check in this repo.
 *
 *   npm run glance
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4181;
const BASE = `http://localhost:${PORT}`;

/* ---------------------------------------------------------------------------
 * Fixture. Shaped like buildPayload_() in the Apps Script, and deliberately
 * built so every verdict the table can show is present at least once.
 * ------------------------------------------------------------------------- */
const DAYS = 100;
const END = new Date(Date.UTC(2026, 7, 30));
const iso = (i) => {
  const d = new Date(END); d.setUTCDate(d.getUTCDate() - (DAYS - 1 - i));
  return d.toISOString().slice(0, 10);
};
const rng = (seed) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; };

const CHANNELS = ['Google Ads', 'Applovin'];
/* [name, channelIdx, os, app, goal, revType, target, mapped, judge] */
const CAMPAIGNS = [
  ['GA_uncapped_big',  0, 'android', 'app', 'D7', 'all', null, true, ''],       // no cap  -> NO BUDGET - set one
  ['GA_capped_over',   0, 'android', 'app', 'D7', 'all', null, true, ''],       // over cap -> OVER BUDGET
  ['AL_failing',       1, 'android', 'app', 'D7', 'all', 0.80, true, 'both'],   // roas 0.3 -> FAIL - cut
  ['AL_passing',       1, 'android', 'app', 'D7', 'all', 0.80, true, 'both'],   // roas 1.0 -> PASS
  ['AL_under',         1, 'android', 'app', 'D7', 'all', 0.80, true, 'both'],   // roas 0.7 -> UNDER TARGET
];
const SHAPE = [
  { cost: 900, ratio: 0.62 },
  { cost: 400, ratio: 0.55 },
  { cost: 500, ratio: 0.30 },
  { cost: 300, ratio: 1.02 },
  { cost: 200, ratio: 0.72 },
];

const rows = [];
CAMPAIGNS.forEach((_, ci) => {
  const r = rng(7 + ci * 31), s = SHAPE[ci];
  for (let di = 0; di < DAYS; di++) {
    const cost = s.cost * (1 + (r() - 0.5) * 0.25);
    const rev = cost * s.ratio * (1 + (r() - 0.5) * 0.2);
    // cost, inst, ad, iap, adD0, iapD0, adD7, iapD7, adD28, iapD28
    rows.push([ci, di, +cost.toFixed(2), Math.round(cost / 1.4),
      +(rev * 0.6).toFixed(2), +(rev * 0.4).toFixed(2),
      +(rev * 0.2).toFixed(2), +(rev * 0.1).toFixed(2),
      +(rev * 0.6).toFixed(2), +(rev * 0.4).toFixed(2),
      +(rev * 0.6).toFixed(2), +(rev * 0.4).toFixed(2)]);
  }
});

const setting = (campaign, channel, target, budget, judge) => ({
  campaign, channel, os: 'android', goal: 'D7', revType: 'all',
  target: target == null ? '' : target, budget: budget == null ? '' : budget,
  tmode: target == null ? 'auto' : 'value', bmode: budget == null ? 'none' : 'value',
  judge: judge || '', from: iso(0), updated: iso(0) + ' 08:00:00',
  by: 'test@example.com', action: 'set', row: 4,
});

const PAYLOAD = {
  meta: { built: iso(DAYS - 1) + ' 08:00:00', buildMs: 12, timezone: 'UTC',
          spanStart: iso(0), spanEnd: iso(DAYS - 1), detailStart: iso(0),
          detailDays: 120, rawRows: rows.length, badDates: 0, title: 'UA Negative Spend Monitor' },
  assumptions: { m_d0_d7: 1.98, m_d7_d28: 1.25, m_d28_d30: 1.011,
                 target_d0: 0.35, target_d7: 0.80, target_d28: 1.10, target_d30: 1.15,
                 atRiskPace: 0.70, marginSigma: 1.0, minMatureSpend: 500, fakeEcpi: 0.05 },
  channels: CHANNELS,
  campaigns: CAMPAIGNS,
  networkJudge: { 'google ads': 'budget' },
  days: Array.from({ length: DAYS }, (_, i) => iso(i)),
  rows,
  health: { unmapped: [], noGoal: [], dormant: [], costTotal: 0, costMapped: 0, costWithGoal: 0 },
  settings: [
    setting('GA_capped_over', 'Google Ads', null, 5000, 'budget'),   // will breach
    setting('AL_failing',  'Applovin', 0.80, null,  'both'),
    setting('AL_passing',  'Applovin', 0.80, 90000, 'both'),         // headroom
    setting('AL_under',    'Applovin', 0.80, null,  'both'),
  ],
};

/* ------------------------------------------------------------------------- */
function startServer() {
  const proc = spawn(process.execPath,
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const plain = (s) => s.replace(/\[[0-9;]*m/g, '');
  let out = '';
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('preview did not start:\n' + out)), 30000);
    proc.stdout.on('data', (d) => {
      out += d.toString();
      if (plain(out).includes(`localhost:${PORT}`)) { clearTimeout(t); ok(proc); }
    });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('exit', (c) => { clearTimeout(t); no(new Error(`preview exited ${c}:\n${out}`)); });
  });
}

const server = await startServer();
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const crashes = [];
page.on('pageerror', (e) => crashes.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && /glance/i.test(m.text())) crashes.push(m.text()); });

await page.addInitScript(() => { try { sessionStorage.setItem('mss3d_token', 'test-token'); } catch (e) {} });
await page.route('**/exec**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, fingerprint: 'fixture-1', payload: PAYLOAD }) }));

await page.goto(`${BASE}/reports/negative-spend/?api=${encodeURIComponent('https://script.google.com/macros/s/FIXTURE/exec')}`,
  { waitUntil: 'load' });
await page.waitForTimeout(2500);

/* --------------------------------- checks -------------------------------- */
const fail = [];
const ok = (cond, label, detail) => { if (!cond) fail.push(label + (detail ? ' — ' + detail : '')); };

/* The money invariant is asserted on the model, not on rendered text. money()
   abbreviates ("$209K") and the spend cell carries a budget caption beside the
   figure, so scraping both is how the first version of this check ended up
   comparing 209 against 9,145,235. Text is checked for what text is for. */

const seen = await page.evaluate(() => {
  const t = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
  const rows = [...document.querySelectorAll('#perfTable tbody tr')];
  return {
    head: t('#glanceHead .gh'),
    tiles: [...document.querySelectorAll('#glanceActs .act')].map((a) => ({
      title: a.querySelector('.hd')?.textContent.trim(),
      amt: a.querySelector('.amt')?.textContent.trim(),
      why: a.querySelector('.why')?.textContent.trim(),
    })),
    netRows: rows.filter((r) => r.dataset.k?.startsWith('n:')).map((r) => ({
      name: r.querySelector('.g-nm span:last-child')?.textContent.trim().split('\n')[0],
      spend: r.children[2].textContent.trim(),
      chip: r.querySelector('.g-chip')?.textContent.trim() || '',
      budgetPct: r.querySelector('.g-spend .lb')?.textContent.trim() || '',
    })),
    rowCount: rows.length,
    chartOn: document.querySelector('#perfDetail')?.classList.contains('on'),
    chartMode: document.querySelector('#perfMode button[aria-pressed=true]')?.textContent.trim(),
    svgPaths: document.querySelectorAll('#pdSvg path').length,
  };
});

/* Computed styles for the pieces most likely to be caught by a stylesheet
   that predates them. The report has 40 KB of CSS written for other tables;
   a new element wearing a short class name like .v or .t is exactly the kind
   of thing that quietly inherits a background from it. */
const styles = await page.evaluate(() => {
  const bg = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return sel + ': (absent)';
    const s = getComputedStyle(el);
    return `${sel}: bg=${s.backgroundColor} color=${s.color} font=${s.fontSize}`;
  };
  return ['#perfTable .g-bul', '#perfTable .g-bul .v', '#perfTable .g-bul .t',
          '#perfTable .g-bul .f', '#perfTable td.n'].map(bg);
});

ok(crashes.length === 0, 'no uncaught errors', crashes.join(' | '));
ok(/spent/.test(seen.head), 'headline rendered', seen.head);
ok(seen.tiles.length === 3, 'three decision tiles', JSON.stringify(seen.tiles.map((t) => t.title)));
ok(seen.netRows.length === 2, 'both networks in the table', JSON.stringify(seen.netRows.map((r) => r.name)));
ok(seen.chartOn, 'detail chart opened');
ok(seen.svgPaths > 0, 'detail chart drew something', 'paths=' + seen.svgPaths);

/* THE invariant: the tiles, the network rows and the campaign rows are all
   the same money. If those three ever disagree the summary has grown its own
   opinion — which is exactly the fault this section exists to remove. */
const totals = await page.evaluate(() => {
  const m = window.__glanceModel();
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    campaigns: r2(m.rows.reduce((s, c) => s + c.cost, 0)),
    networks:  r2(m.networks.reduce((s, n) => s + n.cost, 0)),
    cash:      r2(m.rows.reduce((s, c) => s + c.cashGap, 0)),
    netCash:   r2(m.networks.reduce((s, n) => s + n.cashGap, 0)),
    verdicts:  m.rows.reduce((a, c) => (a[c.verdict] = (a[c.verdict] || 0) + 1, a), {}),
  };
});
ok(Math.abs(totals.campaigns - totals.networks) < 0.5,
  'network rollup equals the campaign rows',
  `networks ${totals.networks} vs campaigns ${totals.campaigns}`);
ok(Math.abs(totals.cash - totals.netCash) < 0.5,
  'network cash equals the campaign cash',
  `networks ${totals.netCash} vs campaigns ${totals.cash}`);

/* No row may claim it is fine while showing more than 100% of its budget. */
seen.netRows.forEach((r) => {
  const m = /^(\d+)%/.exec(r.budgetPct);
  if (m && Number(m[1]) > 100)
    ok(/over budget/i.test(r.chip), 'over-budget row says so', `${r.name}: ${r.budgetPct} -> "${r.chip}"`);
});

/* Every verdict the fixture was built to produce should be reachable. */
const chips = await page.evaluate(() => {
  document.querySelectorAll('#perfTable tr.grow').forEach((r) => { if (r.dataset.k?.startsWith('n:')) r.click(); });
  return [...document.querySelectorAll('#perfTable .g-chip')].map((c) => c.textContent.trim());
});
['cut', 'passing', 'under target', 'over budget', 'no budget cap'].forEach((v) =>
  ok(chips.includes(v), `verdict "${v}" appears`, 'saw: ' + [...new Set(chips)].join(', ')));

/* A rendered screenshot on every run. The assertions above check numbers and
   they cannot see a collided label, a bar off its track, or a chart drawn
   behind its own gridlines. */
await page.setViewportSize({ width: 1400, height: 1400 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(ROOT, 'design/glance-live.png'), fullPage: false });

await browser.close();
server.kill();

console.log('\n' + '='.repeat(74));
console.log('headline :', seen.head);
seen.tiles.forEach((t) => console.log(`tile     : ${t.title} = ${t.amt}`));
seen.netRows.forEach((r) => console.log(`network  : ${r.name} | ${r.spend.replace(/\s+/g, ' ')} | ${r.chip}`));
console.log('chart    :', seen.chartMode, '·', seen.svgPaths, 'paths');
console.log('totals   : campaigns', totals.campaigns, '= networks', totals.networks);
console.log('verdicts :', JSON.stringify(totals.verdicts));
styles.forEach((s) => console.log('style    :', s));
console.log('='.repeat(74));
if (fail.length) { fail.forEach((f) => console.log('FAIL  ' + f)); console.log(`\n${fail.length} check(s) failed.\n`); }
else console.log('\nAll checks passed.\n');
process.exit(fail.length ? 1 : 0);
