/* Every report is the same size.

   There IS one size system — src/shared/styles/report-type.css. What there
   was not is anything that notices when a report stops obeying it, and the
   first page written after it existed did stop: it set its own, smaller type
   and then zoomed the whole body by 1.15 to make up the difference, landing
   at 17px where every other report is at 20, with its charts a third shorter
   and a max-width nothing else has.

   Nobody saw it because "does this look like the others" is a question you
   have to open seven tabs to answer. This opens them.

   The reference is not written down here. It is MEASURED from the reports
   that already exist and agree with each other, and a new report has to match
   what they do. So the numbers cannot drift out of date, and the test says
   what is wrong rather than what a constant once said. */

import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'dist';
if (!existsSync(DIST)) {
  console.error('\n  dist/ is missing — run `npm run build` first.\n');
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = join(DIST, url === '/' ? 'index.html' : decodeURIComponent(url));
  if (!existsSync(file)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

/* Every report in the build, found rather than listed — a new one is included
   the day it is added, which is the whole point. */
const REPORTS = readdirSync(join(DIST, 'reports'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(DIST, 'reports', d.name, 'index.html')))
  .map((d) => d.name)
  .sort();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else {
    fail++;
    console.log('  FAIL  ' + name + (extra === undefined ? '' : '\n        ' + JSON.stringify(extra)));
  }
};

console.log('\n  one size for every report');
console.log('  ' + '-'.repeat(62));

const browser = await chromium.launch();
const measured = {};

for (const name of REPORTS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:' + port + '/reports/' + name + '/index.html',
    { waitUntil: 'load' }).catch(() => {});
  /* The pages fetch on load and most will fail without a backend. That is
     fine: the type scale is CSS and is applied before any of them answer. */
  await page.waitForTimeout(350);

  measured[name] = await page.evaluate(() => {
    const size = (sel) => {
      const el = document.querySelector(sel);
      return el ? Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100 : null;
    };
    const first = (...sels) => {
      for (const s of sels) { const v = size(s); if (v != null) return v; }
      return null;
    };
    /* Zoom is inherited, so asking the body is not enough — a wrapper can
       zoom everything under it, which is exactly what went wrong. */
    const zoomed = [...document.querySelectorAll('body *')].filter((el) => {
      const z = getComputedStyle(el).zoom;
      return z && z !== '1' && z !== 'normal';
    }).map((el) => el.tagName.toLowerCase() + '.' + (el.className || ''));

    return {
      body: size('body'),
      h2: first('.card h2', '.card-title', '.card-head h2', 'section h2'),
      kpiLabel: first('.kpi .l', '.kpi-label'),
      kpiValue: first('.kpi .v', '.kpi-value'),
      th: size('th'),
      td: size('td'),
      zoomed: zoomed.slice(0, 3)
    };
  });
  await page.close();
}

await browser.close();
server.close();

console.log('  measured:');
REPORTS.forEach((r) => {
  const m = measured[r];
  console.log('    ' + r.padEnd(16)
    + 'body ' + String(m.body).padEnd(6)
    + 'h2 ' + String(m.h2).padEnd(7)
    + 'kpi ' + String(m.kpiLabel).padEnd(6) + '/' + String(m.kpiValue).padEnd(8)
    + 'th ' + String(m.th).padEnd(6) + 'td ' + String(m.td));
});
console.log('');

/* The reference is whatever the majority of reports agree on, per property.
   A property no report sets is skipped rather than guessed at. */
function consensus(prop) {
  const counts = new Map();
  REPORTS.forEach((r) => {
    const v = measured[r][prop];
    if (v == null) return;
    counts.set(v, (counts.get(v) || 0) + 1);
  });
  if (!counts.size) return null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { value: best[0], agreeing: best[1], total: [...counts.values()].reduce((a, b) => a + b, 0) };
}

/* Known exceptions, each with the reason it is one.

   An exception has to be written here to be allowed, which is the point: a
   report that drifts fails this test until somebody decides the drift is
   wanted and says why. The alternative - a test that has been red for months
   - teaches people to ignore it, and then it catches nothing.

   Neither of these is a report that was written against the shared scale and
   wandered off. One never went through it, and the other was deliberately
   enlarged. */
const EXCEPTIONS = {
  exec: {
    props: ['body', 'th', 'td'],
    why: 'The Executive Dashboard was a separate repository with its own '
       + 'stylesheet, and only its front door moved. It has never been '
       + 'through report-type.css, so matching it to the others is a '
       + 'restyling of that report rather than a size fix.'
  },
  weekly: {
    zoom: true,
    why: 'Monetization sets --mon-zoom on its slide body on purpose, so the '
       + 'slides read at presentation size. Its own design.css says so. '
       + 'Removing it would shrink a report somebody deliberately enlarged.'
  }
};

const excepted = (report, prop) => {
  const e = EXCEPTIONS[report];
  return !!(e && e.props && e.props.indexOf(prop) !== -1);
};

const PROPS = ['body', 'h2', 'kpiLabel', 'kpiValue', 'th', 'td'];

ok('there is more than one report to compare', REPORTS.length >= 2, REPORTS);

PROPS.forEach((prop) => {
  const c = consensus(prop);
  if (!c) return;                         // nothing sets it; nothing to enforce
  if (c.agreeing < 2) return;             // no agreement to hold anyone to

  const odd = REPORTS.filter((r) => {
    if (excepted(r, prop)) return false;
    const v = measured[r][prop];
    /* Within a pixel: clamp() and a viewport-relative size land a hair apart
       between pages, and that is not drift. */
    return v != null && Math.abs(v - c.value) > 1;
  });

  ok(prop + ' is ' + c.value + 'px everywhere (' + c.agreeing + ' of ' + c.total + ' agree)',
    odd.length === 0,
    odd.map((r) => ({ report: r, got: measured[r][prop], want: c.value })));
});

/* Zoom is the specific mechanism that hid the drift: the page looked roughly
   right because it had been scaled back up, so every individual size was
   wrong and the whole was nearly right. Nothing should need it. */
const zooming = REPORTS.filter((r) =>
  measured[r].zoomed.length && !(EXCEPTIONS[r] && EXCEPTIONS[r].zoom));
ok('no report scales itself with zoom', zooming.length === 0,
  zooming.map((r) => ({ report: r, elements: measured[r].zoomed })));

console.log('  ' + '-'.repeat(62));
console.log(`  ${pass}/${pass + fail} passed\n`);
process.exit(fail ? 1 : 0);
