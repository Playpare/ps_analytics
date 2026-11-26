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
import { readFileSync } from 'node:fs';
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

/* The date filter is a styled popup over the hidden native select; picking
   an item must still drive the report's own date logic. */
await page.click('.dd-btn');
await page.click('.dd-it[data-v=w2]');
await page.waitForTimeout(700);
const ddLabel = await page.textContent('.dd-lbl');
await page.click('.dd-btn');
await page.click('.dd-it[data-v=w13]');
await page.waitForTimeout(700);

/* Switching platform must re-render. It used to throw in the removed
   campaign/margin filters and leave the page stuck on Android. */
const platTitles = [];
for (const p of ['ios', 'all', 'android']) {
  /* platform is three buttons now (was a dropdown): click the one wanted */
  await page.click(`#platformDropMenu [data-platform=${p}]`);
  await page.waitForTimeout(600);
  platTitles.push(await page.textContent('#pageTitle'));
}

/* --------------------------------- checks -------------------------------- */
const fail = [];
const ok = (cond, label, detail) => { if (!cond) fail.push(label + (detail ? ' — ' + detail : '')); };

/* ---------------------------------------------------------------------------
 * Class-name collisions, checked statically.
 *
 * negative-spend.css is 40 KB written years before glance.css existed, and it
 * legitimately owns short names. This has now bitten twice: `.b-warn`/`.b-bad`
 * painted the ROAS bullets with the report's badge colours, and `.ladder` and
 * every `.lad-*` were the OLD cohort ladder's classes, so the new payback rows
 * inherited its layout and rendered as thumbnails in the middle of the card.
 *
 * Neither threw. Both looked like a styling mistake in the new code. Checking
 * the two stylesheets against each other costs nothing and ends the class.
 * ------------------------------------------------------------------------- */
{
  const NS = resolve(ROOT, 'design/reports/negative-spend');
  const classesIn = (f) => new Set(
    [...readFileSync(resolve(NS, f), 'utf8').matchAll(/\.([a-zA-Z][\w-]*)(?=[\s,{:.>)\[])/g)]
      .map((m) => m[1]));

  /* Shared on purpose: `lt` is the report's light-theme body class, and the two
     value colours are only ever used inside #perfTable, which scopes them. */
  const SHARED = new Set(['lt', 'neg', 'pos']);
  const clash = [...classesIn('glance.css')].filter((c) => classesIn('negative-spend.css').has(c) && !SHARED.has(c));

  ok(clash.length === 0, 'no class-name collision with the report stylesheet',
    clash.length ? `${clash.join(', ')} — prefix them (g-…) or add to SHARED with a reason` : '');
}

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
    })),
    rowCount: rows.length,
    chartOn: document.querySelector('#perfDetail')?.classList.contains('on'),
    chartMode: [...document.querySelectorAll('#pdRef .key')].map((k) => k.textContent.trim()).join(' / '),
    modeButtons: document.querySelectorAll('#perfMode').length,
    lines: [...document.querySelectorAll('#pdSvg path')].map((p) => p.getAttribute('stroke')),
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
ok(ddLabel === 'Last 2 weeks', 'date popup changes the range', ddLabel);
ok(platTitles.join('|') === 'Negative Spend · iOS|Negative Spend · All platforms|Negative Spend · Android',
  'platform switch re-renders', platTitles.join(' | '));
ok(!seen.head, 'headline removed', seen.head);
ok(seen.tiles.map((t) => t.title).join('|') === 'Total spend|Total revenue|Total gross profit',
  'three totals cards', JSON.stringify(seen.tiles.map((t) => t.title)));
ok(await page.evaluate(() => getComputedStyle(document.getElementById('mapBtn')).display === 'none'),
  'campaign settings button hidden');
{
  const order = await page.evaluate(() => window.__glanceModel().networks.map((n) => n.cost));
  ok(order.every((v, i) => !i || order[i - 1] >= v), 'networks sorted by spend, high to low', order.join(' > '));
}
ok(seen.tiles.length === 3, 'three decision tiles', JSON.stringify(seen.tiles.map((t) => t.title)));
ok(seen.netRows.length === 2, 'both networks in the table', JSON.stringify(seen.netRows.map((r) => r.name)));
ok(seen.chartOn, 'detail chart opened');
ok(seen.svgPaths > 0, 'detail chart drew something', 'paths=' + seen.svgPaths);
ok(seen.modeButtons === 0, 'chart mode buttons removed');
ok(['var(--g-cost)', 'var(--g-rev)', 'var(--g-gp)'].every((c) => seen.lines.includes(c)),
  'chart draws cost, revenue and gross profit', seen.lines.join(', '));

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

/* The table is Spend / Revenue / Gross Profit only: no budget captions, no
   Back per $1, no Needs chips, and no Payback card above it. */
const tableShape = await page.evaluate(() => ({
  heads: [...document.querySelectorAll('#perfTable thead th')].map((th) => th.firstChild?.textContent.trim()),
  chips: document.querySelectorAll('#perfTable .g-chip, #perfTable .g-bul').length,
  captions: document.querySelectorAll('#perfTable .g-spend .lb, #perfTable .g-spend .nocap').length,
  payback: !!document.getElementById('beCard'),
}));
ok(tableShape.heads.join('|') === '#|Network / campaign|Trend|Spend|Revenue|Gross Profit',
  'performance columns', tableShape.heads.join(' | '));
ok(tableShape.chips === 0, 'no Back per $1 / Needs cells', 'found ' + tableShape.chips);
ok(tableShape.captions === 0, 'no budget captions under spend', 'found ' + tableShape.captions);
ok(!tableShape.payback, 'payback card removed');

/* A campaign opens its trend directly beneath its own row; a second click
   hands the chart back to the network. Below-$0 gross profit is marked. */
{
  await page.click('#perfTable tr.grow[data-k^="n:Google"]');
  await page.waitForTimeout(300);
  if (!(await page.$('#perfTable tr.grow.camp'))) await page.click('#perfTable tr.grow[data-k^="n:Google"]');
  await page.click('#perfTable tr.grow.camp >> nth=0');
  await page.waitForTimeout(500);
  const inRow = await page.evaluate(() => ({
    ok: !!document.querySelector('#perfTable tr.cdrow #perfDetail.inrow.on') &&
        document.querySelector('#perfTable tr.cdrow').previousElementSibling.classList.contains('camp'),
    neg: !!document.querySelector('#pdRef .negnote'),
  }));
  ok(inRow.ok, 'campaign trend opens under its row');
  ok(inRow.neg, 'below-$0 gross profit is flagged');
  /* Clicking a campaign further down keeps that row where it was on screen,
     so its trend opens beneath it rather than appearing to land above it. */
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.click('#perfTable tr.grow.camp >> nth=0');          // a chart open ABOVE the next one
  await page.waitForTimeout(400);
  const second = page.locator('#perfTable tr.grow.camp >> nth=1');
  await second.scrollIntoViewIfNeeded();
  const y1 = (await second.boundingBox()).y;
  await second.click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const on = document.querySelector('#perfTable tr.grow.camp.on');
    return { y: on.getBoundingClientRect().top, below: on.nextElementSibling?.classList.contains('cdrow') };
  });
  ok(after.below && Math.abs(after.y - y1) < 3, 'clicked campaign stays put with its trend below',
    `row moved ${Math.round(after.y - y1)}px, chart below: ${after.below}`);
  await page.setViewportSize({ width: 1400, height: 1400 });
  await page.click('#perfTable tr.grow.camp.on');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.getElementById('perfDetail').parentElement.id === 'perfCard'),
    'second click returns the chart to the network');
}

/* ROAS view: d0/d7/d28 lines, the All/IAP/Ad switch, and the maths
   (cohort revenue ÷ spend) checked against the model for the first day. */
{
  await page.click('#pdMode button[data-c=roas]');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    kind: !document.getElementById('pdKind').hidden,
    lines: [...document.querySelectorAll('#pdSvg path')].map((p) => p.getAttribute('stroke')),
  }));
  ok(r.kind, 'ROAS shows the All / IAP / Ad switch');
  ok(['var(--teal)', 'var(--amb)', 'var(--pur)'].every((c) => r.lines.includes(c)), 'ROAS draws d0, d7, d28', r.lines.join(', '));
  await page.click('#pdKind button[data-k=iap]');
  await page.waitForTimeout(200);
  ok(/IAP ROAS d0/.test(await page.textContent('#pdRef')), 'IAP ROAS legend');
  await page.click('#pdKind button[data-k=all]');
  await page.click('#pdMode button[data-c=money]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.getElementById('pdKind').hidden), 'ROAS switch hides with the money view');
}

/* ---------------------------------------------------------------------------
 * An empty payload must not take the page down.
 *
 * This is the failure that cost a full day. A snapshot built while the RAW
 * column mapping was wrong had every row dropped, so `days` came back empty.
 * readLocal's guard was `obj.payload.days` — and an empty array is truthy — so
 * the browser cached it, painted from it on every load, and threw in isoShift()
 * before it could fetch a good one. Reloading could not help: the poison was
 * the thing being reloaded. The throw also aborted this file's module
 * evaluation, which meant glance.js was never imported at all.
 *
 * One uncaught TypeError, three symptoms, none of them pointing at the cause.
 * ------------------------------------------------------------------------- */
{
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  const empty = [];
  p2.on('pageerror', (e) => empty.push(e.message));
  await p2.addInitScript(() => { try { sessionStorage.setItem('mss3d_token', 'test-token'); } catch (e) {} });
  await p2.route('**/exec**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, fingerprint: 'empty-1',
        payload: { ...PAYLOAD, days: [], rows: [], campaigns: [], channels: [] } }) }));
  await p2.goto(`${BASE}/reports/negative-spend/?api=${encodeURIComponent('https://x/exec')}`,
    { waitUntil: 'load' });
  await p2.waitForTimeout(1500);

  const status = await p2.textContent('#status').catch(() => '');
  ok(empty.length === 0, 'empty payload does not throw', empty.join(' | '));
  ok(/no usable rows/i.test(status || ''),
    'empty payload explains itself', `status read: "${(status || '').slice(0, 80)}"`);

  /* And the poison must not be cached for next time. */
  const cached = await p2.evaluate(() => localStorage.getItem('uansm_snapshot'));
  const cachedDays = cached ? (JSON.parse(cached).payload?.days?.length ?? 0) : 0;
  ok(cachedDays === 0 || cached === null,
    'an empty snapshot is not treated as a cache hit', `cached days: ${cachedDays}`);
  await ctx2.close();
}

/* A rendered screenshot on every run. The assertions above check numbers and
   they cannot see a collided label, a bar off its track, or a chart drawn
   behind its own gridlines. */
await page.setViewportSize({ width: 1400, height: 1400 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(ROOT, 'dist/glance-live.png'), fullPage: false });



await browser.close();
server.kill();

console.log('\n' + '='.repeat(74));
console.log('headline :', seen.head);
seen.tiles.forEach((t) => console.log(`tile     : ${t.title} = ${t.amt}`));
seen.netRows.forEach((r) => console.log(`network  : ${r.name} | ${r.spend.replace(/\s+/g, ' ')}`));
console.log('chart    :', seen.chartMode, '·', seen.svgPaths, 'paths');
console.log('totals   : campaigns', totals.campaigns, '= networks', totals.networks);
console.log('verdicts :', JSON.stringify(totals.verdicts));
styles.forEach((s) => console.log('style    :', s));
console.log('='.repeat(74));
if (fail.length) { fail.forEach((f) => console.log('FAIL  ' + f)); console.log(`\n${fail.length} check(s) failed.\n`); }
else console.log('\nAll checks passed.\n');
process.exit(fail.length ? 1 : 0);
