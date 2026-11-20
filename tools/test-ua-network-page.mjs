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

const day = (n) => {
  const d = new Date('2026-11-18');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/* Two networks of very different size, and a cohort payer column reporting
   something impossible - which is what the real tab reports. The page must
   not draw it, and must say so once. */
const payload = (scale) => ({
  ua: {
    channelSrc: 'perf',
    channels: [
      { channel: 'Meta', installs: 60000, spend: 120000, cost: 120000,
        revenue: 40000 * scale, adRevenue: 28000 * scale, iapRevenue: 12000 * scale,
        d1: 40, d3: 26, d7: 17, d14: 11, d30: 7,
        roasD0: 8, roasD1: 14, roasD3: 25, roasD7: 42,
        roasD14: 61, roasD21: 74, roasD28: 88, roasD30: 91,
        payersD7: 30, purchD7: 35, cohortIapD7: 200 },
      { channel: 'Tiny', installs: 200, spend: 300, cost: 300,
        revenue: 90, adRevenue: 40, iapRevenue: 50,
        d1: 31, d3: 19, d7: 11, d14: null, d30: null,
        roasD0: 5, roasD1: 9, roasD3: 16, roasD7: 28,
        roasD14: null, roasD21: null, roasD28: null, roasD30: null,
        payersD7: 1, purchD7: 1, cohortIapD7: 6 }
    ],
    channelDaily: [...Array(14)].map((_, i) => ({
      date: day(13 - i), installs: 4300, spend: 8600,
      revenue: 2900 * scale, adRevenue: 2040 * scale, iapRevenue: 860 * scale
    }))
  }
});

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/stub') {
    /* The previous period is the one asked for with the earlier `from`. */
    const from = new URL(req.url, 'http://x').searchParams.get('from');
    const isPrev = from < day(13);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload(isPrev ? 1 : 0.6)));     // revenue falls 40%
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
const signedIn = async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => {
    try { sessionStorage.setItem('mss3d_token', 'test-token'); } catch (e) { /* ignore */ }
  });
  return p;
};

const api = encodeURIComponent('http://127.0.0.1:' + port + '/stub');
const URL_WITH_API = 'http://127.0.0.1:' + port
  + '/reports/ua-network/index.html?api=' + api + '&key=test-key';

const page = await signedIn();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_WITH_API, { waitUntil: 'load' });

/* Wait for the KPI row to fill rather than for a fixed delay: a sleep long
   enough to be safe is long enough to be slow, and one that is neither makes
   the test flaky. */
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
    charts: ['cDaily', 'cNetRoas', 'cRoas', 'cRet'].reduce((o, id) => {
      o[id] = canvasDrawn(id); return o;
    }, {}),
    emptyCards: [...document.querySelectorAll('.empty')].map((e) => e.textContent.trim()),
    roasNote: txt('#roasNote'),
    netRoasNote: txt('#netRoasNote'),
    warnShown: !document.getElementById('srcWarn').hidden,
    warnText: document.getElementById('srcWarn').textContent,
    findings: [...document.querySelectorAll('.finding')].map((f) => ({
      tag: f.querySelector('.ic').textContent.trim(),
      head: f.querySelector('div').textContent.trim()
    })),
    tableHead: [...document.querySelectorAll('#tbl th')].map((t) => t.textContent.trim()),
    rows: [...document.querySelectorAll('#tbl tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())),
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

ok('the ROAS card says the points are measured, not fitted',
  /measured point/.test(seen.roasNote || ''), seen.roasNote);
ok('the return chart says what break-even is',
  /break-even/.test(seen.netRoasNote || ''), seen.netRoasNote);

/* Nothing on the page is built on payers any more. */
ok('no KPI tile is a payer figure',
  !seen.kpis.some((k) => /payer|arppu/i.test(k.label)), seen.kpis.map((k) => k.label));
ok('no table column is a payer figure',
  !seen.tableHead.some((h) => /payer|arppu|purch|avg price/i.test(h)), seen.tableHead);

/* But it does say, once, what the payer column reported. */
ok('the implausible payer feed is named rather than plotted',
  seen.warnShown && /payer rate of/.test(seen.warnText), seen.warnText);
ok('and the notice says the page is not built on it',
  /Nothing on this page is built on it/.test(seen.warnText));

ok('eleven table columns', seen.tableHead.length === 11, seen.tableHead);
ok('a row per network', seen.rows.length === 2, seen.rows.length);
ok('no cell rendered as undefined or NaN',
  seen.rows.every((r) => r.every((c) => c && !/NaN|undefined/.test(c))), seen.rows);
ok('the two cohort columns are last; everything before them is a total',
  /D7 ROAS/.test(seen.tableHead[9]) && /retention/.test(seen.tableHead[10]),
  seen.tableHead.slice(9));

/* Revenue fell 40% on both, on flat spend. Meta is most of the money; Tiny is
   worth well under 2% of spend and should not earn a line. */
ok('the large network is reported',
  seen.findings.some((f) => /Meta/.test(f.head)), seen.findings);
ok('the tiny one is left out',
  !seen.findings.some((f) => /Tiny/.test(f.head)), seen.findings.map((f) => f.head));

ok('the page does not scroll sideways', seen.horizontalScroll === false);

/* And at phone width, where the two-column sections have to stack. */
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(150);
const narrow = await page.evaluate(() => ({
  scrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  /* The gutter is .wrap's padding, not its offset - the element is full width
     by design, so its own left edge is 0 and measuring that proves nothing.
     What a reader sees is the distance to the first card. */
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
await page.close();

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
await page2.close();

/* ---- the stale-backend path --------------------------------------------
   The totals fill in and the cohort curves are blank. Three different causes
   look identical on screen, and the page has to name the right one. A backend
   that has never heard of the column sends no key; one that has nothing to
   report sends null. */
const page3 = await signedIn();
await page3.route('**/stub*', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ ua: { channelSrc: 'perf', channelDaily: [],
    channels: [{ channel: 'Meta', installs: 60000, spend: 120000, cost: 120000,
                 revenue: 40000, adRevenue: 28000, iapRevenue: 12000 }] } })
}));
await page3.goto(URL_WITH_API, { waitUntil: 'load' });
await page3.waitForFunction(
  () => document.querySelectorAll('#kpis .kpi').length > 0, null, { timeout: 15000 }
).catch(() => {});

const stale = await page3.evaluate(() => ({
  warnShown: !document.getElementById('srcWarn').hidden,
  warnText: document.getElementById('srcWarn').textContent,
  spend: document.querySelector('#kpis .kpi .v').textContent.trim()
}));
ok('a backend without the cohort columns is named as the cause',
  stale.warnShown && /has not been redeployed/.test(stale.warnText), stale);
ok('and the notice says which figures are unaffected',
  /totals above are unaffected/.test(stale.warnText), stale.warnText);
ok('those figures do still render', /\$/.test(stale.spend), stale.spend);
await page3.close();

/* A deployed backend reporting null must NOT be blamed on deployment - that
   is an immature cohort, and telling somebody to redeploy wastes an
   afternoon. */
const page4 = await signedIn();
await page4.route('**/stub*', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ ua: { channelSrc: 'perf', channelDaily: [],
    channels: [{ channel: 'Meta', installs: 60000, spend: 120000, cost: 120000,
                 revenue: 40000, adRevenue: 28000, iapRevenue: 12000,
                 d1: null, d7: null, d30: null,
                 roasD0: null, roasD7: null, roasD28: null }] } })
}));
await page4.goto(URL_WITH_API, { waitUntil: 'load' });
await page4.waitForFunction(
  () => document.querySelectorAll('#kpis .kpi').length > 0, null, { timeout: 15000 }
).catch(() => {});
const immature = await page4.evaluate(() => ({
  warnShown: !document.getElementById('srcWarn').hidden,
  empties: [...document.querySelectorAll('.empty')].map((e) => e.textContent.trim())
}));
ok('nulls are not blamed on deployment', immature.warnShown === false);
ok('the cohort cards say the cohort has not matured instead',
  immature.empties.some((t) => /matured/.test(t)), immature.empties);
await page4.close();

await browser.close();
server.close();

console.log('  ' + '-'.repeat(62));
console.log(`  ${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
