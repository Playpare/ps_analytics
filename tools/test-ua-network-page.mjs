/* Does the page actually draw?

   The arithmetic has its own test. This one is about the wiring between the
   render module and the document: a canvas id that does not exist, a
   getElementById for an element somebody renamed, a Chart.js option that
   throws. None of that shows up in a build - Vite bundles a reference to a
   missing id perfectly happily - and all of it shows up as a blank card.

   So the built page is served, the backend is stubbed, and the page is then
   asked what it drew. */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'dist';
if (!existsSync(join(DIST, 'reports/ua-network/index.html'))) {
  console.error('\n  dist/reports/ua-network/index.html is missing - run `npm run build` first.\n');
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

/* ---- a stub backend, with the awkward cases in the data ---------------- */
const day = (n) => {
  const d = new Date('2026-11-18');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/* Two networks of very different size, so the noise floor has something to
   do, and the last two days left immature, as the real tab leaves them. */
const payload = (scale) => ({
  ua: {
    channelSrc: 'perf',
    channels: [
      { channel: 'Meta', installs: 60000, spend: 120000,
        cost: 120000, revenue: 40000, adRevenue: 12000, iapRevenue: 28000,
        d1: 40, d3: 26, d7: 17, d14: 11, d30: 7,
        roasD0: 8, roasD1: 14, roasD3: 25, roasD7: 42,
        roasD14: 61, roasD21: 74, roasD28: 88, roasD30: 91,
        payersD7: Math.round(1800 * scale), purchD7: Math.round(2400 * scale),
        cohortIapD7: 27000 * scale },
      { channel: 'Tiny', installs: 200, spend: 300, cost: 300,
        revenue: 90, adRevenue: 40, iapRevenue: 50,
        d1: 31, d3: 19, d7: 11, d14: null, d30: null,
        roasD0: 5, roasD1: 9, roasD3: 16, roasD7: 28,
        roasD14: null, roasD21: null, roasD28: null, roasD30: null,
        payersD7: Math.round(6 * scale), purchD7: Math.round(8 * scale),
        cohortIapD7: 70 * scale }
    ],
    channelDaily: [...Array(14)].map((_, i) => {
      const immature = i >= 12;
      return {
        date: day(13 - i), installs: 4300, spend: 8600,
        revenue: 2900, adRevenue: 860, iapRevenue: 2040,
        payersD7: immature ? null : Math.round(129 * scale),
        purchD7: immature ? null : 172,
        cohortIapD7: immature ? null : 1930 * scale,
        cohortIapD30: null
      };
    })
  }
});

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/stub') {
    /* The previous period is the one asked for with the earlier `from`. */
    const from = new URL(req.url, 'http://x').searchParams.get('from');
    const isPrev = from < day(13);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload(isPrev ? 1 : 0.7)));   // a 30% fall
    return;
  }
  const file = join(DIST, url === '/' ? 'index.html' : decodeURIComponent(url));
  if (!existsSync(file)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else {
    fail++;
    console.log('  FAIL  ' + name + (extra === undefined ? '' : '  ' + JSON.stringify(extra)));
  }
};

console.log('\n  UA Network Performance: the page');
console.log('  ' + '-'.repeat(62));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.addInitScript(() => {
  try { sessionStorage.setItem('mss3d_token', 'test-token'); } catch (e) { /* ignore */ }
});

const api = encodeURIComponent('http://127.0.0.1:' + port + '/stub');
await page.goto('http://127.0.0.1:' + port + '/reports/ua-network/index.html?api=' + api
  + '&key=test-key', { waitUntil: 'load' });

/* Wait for the KPI row to fill rather than for a fixed delay: a sleep long
   enough to be safe is long enough to be slow, and a sleep that is neither
   makes the test flaky. */
await page.waitForFunction(
  () => document.querySelectorAll('#kpis .kpi').length > 0, null, { timeout: 15000 }
).catch(() => {});

const seen = await page.evaluate(() => {
  const txt = (s) => { const el = document.querySelector(s); return el ? el.textContent.trim() : null; };
  const canvasDrawn = (id) => {
    const c = document.getElementById(id);
    if (!c) return 'missing';
    /* A Chart.js canvas gets its pixel size from the layout; 0 means it never
       laid out, which is what a hidden or empty card looks like. */
    return (c.width > 10 && c.height > 10) ? 'drawn' : 'blank';
  };
  return {
    fatal: document.getElementById('fatal').hidden ? null : txt('#fatal'),
    kpis: [...document.querySelectorAll('#kpis .kpi')].map((k) => ({
      label: k.querySelector('.l').textContent.trim(),
      value: k.querySelector('.v').textContent.trim()
    })),
    charts: ['cWaterfall', 'cDaily', 'cPayer', 'cRoas', 'cRet'].reduce((o, id) => {
      o[id] = canvasDrawn(id); return o;
    }, {}),
    emptyCards: [...document.querySelectorAll('.empty')].map((e) => e.textContent.trim()),
    wfNote: txt('#wfNote'),
    dailyNote: txt('#dailyNote'),
    roasNote: txt('#roasNote'),
    findings: [...document.querySelectorAll('.finding')].map((f) => ({
      tag: f.querySelector('.ic').textContent.trim(),
      head: f.querySelector('div').textContent.trim()
    })),
    tableHead: [...document.querySelectorAll('#tbl th')].map((t) => t.textContent.trim()),
    rows: [...document.querySelectorAll('#tbl tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
    shadedPayerCells: document.querySelectorAll('#tbl td.bad').length,
    period: txt('#period'),
    horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  };
});

ok('the page loaded without a fatal error', seen.fatal === null, seen.fatal);
ok('no uncaught script errors', errors.length === 0, errors.slice(0, 3));

ok('six KPI tiles', seen.kpis.length === 6, seen.kpis.map((k) => k.label));
ok('no KPI is an empty string or NaN',
  seen.kpis.every((k) => k.value && !/NaN|undefined/.test(k.value)), seen.kpis);
ok('the period line names both ends',
  /2026-\d\d-\d\d → 2026-\d\d-\d\d/.test(seen.period || ''), seen.period);

/* Every canvas must have laid out. A card referencing a canvas id that does
   not exist reports "missing", which is the failure this test exists for. */
Object.entries(seen.charts).forEach(([id, status]) => {
  ok('chart ' + id + ' drew', status === 'drawn', status);
});
ok('no card fell back to an empty state with this data',
  seen.emptyCards.length === 0, seen.emptyCards);

ok('the waterfall names the biggest mover', /Most of it is/.test(seen.wfNote || ''),
  seen.wfNote);
ok('the daily card says which days are still immature',
  /no D7 figure yet/.test(seen.dailyNote || ''), seen.dailyNote);
ok('the ROAS card says the points are measured, not fitted',
  /measured point/.test(seen.roasNote || ''), seen.roasNote);

/* The stub falls 30% on both networks. Meta has 60,000 installs and clears
   the floor; Tiny has 200 and cannot. Both facts must reach the page. */
ok('the large network is reported as a payer-% finding',
  seen.findings.some((f) => f.tag === 'PAYER %' && /Meta/.test(f.head)),
  seen.findings);
ok('the small one is reported as not measurable',
  seen.findings.some((f) => f.tag === 'TOO SMALL' && /Tiny/.test(f.head)),
  seen.findings.map((f) => f.tag));

ok('ten table columns', seen.tableHead.length === 10, seen.tableHead);
ok('a row per network', seen.rows.length === 2, seen.rows.length);
ok('no cell rendered as undefined or NaN',
  seen.rows.every((r) => r.every((c) => c && !/NaN|undefined/.test(c))), seen.rows);
ok('exactly one payer-% cell is shaded - the measurable one',
  seen.shadedPayerCells === 1, seen.shadedPayerCells);

ok('the page does not scroll sideways', seen.horizontalScroll === false);

/* And at phone width, where the two-column sections have to stack. */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(150);
const narrow = await page.evaluate(() => ({
  scrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  /* The gutter is .wrap's padding, not its offset - the element is full
     width by design, so its own left edge is 0 and measuring that proves
     nothing. What a reader sees is the distance to the first card. */
  gutter: Math.round(document.querySelector('.card').getBoundingClientRect().left),
  stacked: (() => {
    const cards = [...document.querySelectorAll('.two .card')];
    return cards.length < 2
      || cards[0].getBoundingClientRect().bottom <= cards[1].getBoundingClientRect().top + 1;
  })()
}));
ok('no sideways scroll at 390px', narrow.scrollsSideways === false);
ok('a side gutter remains at 390px', narrow.gutter >= 12, narrow.gutter);
ok('the two-column sections stack at 390px', narrow.stacked === true);

/* ---- the refusal path -------------------------------------------------- */
const page2 = await browser.newPage();
await page2.goto('http://127.0.0.1:' + port + '/reports/ua-network/index.html',
  { waitUntil: 'load' });
await page2.waitForFunction(
  () => !document.getElementById('fatal').hidden, null, { timeout: 10000 }
).catch(() => {});
const noAuth = await page2.evaluate(() => ({
  hidden: document.getElementById('fatal').hidden,
  text: document.getElementById('fatal').textContent
}));
ok('opened with no endpoint, the page says so rather than sitting blank',
  noAuth.hidden === false && /API URL|signed in/.test(noAuth.text), noAuth);

await browser.close();
server.close();

console.log('  ' + '-'.repeat(62));
console.log(`  ${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
