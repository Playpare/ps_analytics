/**
 * ============================================================================
 * smoke.mjs — does every page still run?
 * ============================================================================
 *
 * The migration moved ~800 KB of working code out of inline <script> tags and
 * into ES modules, and ES modules are always strict mode. Inline scripts were
 * not. That difference is silent until it isn't: an assignment to a variable
 * that was never declared is a harmless implicit global in sloppy mode and a
 * ReferenceError in strict mode. No amount of reading the diff finds those —
 * only running the code does.
 *
 * So this loads all six built pages in a real browser and fails on any
 * uncaught exception. It deliberately does NOT check that the reports render
 * data: without a signed-in session they cannot, and the network failures that
 * follow are expected and are filtered out below. What it proves is narrower
 * and is exactly the risk the migration introduced — that every module still
 * parses, evaluates, and wires up its handlers.
 *
 *   npm run smoke
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;
const BASE = `http://localhost:${PORT}`;

/* The 23 functions till-date's markup calls from onclick="" attributes. They
   were implicit globals when this was an inline script; in a module they only
   exist because till-date.legacy.js republishes them. If that shim is ever
   dropped, 105 controls go dead silently — nothing throws until a user
   clicks. This is the check that makes that loud. */
const TILL_DATE_HANDLERS = [
  'adsFilter', 'adsRangeApply', 'adsRangeClear', 'cohFilter', 'ftpFilter',
  'globalToggle', 'iapFilter', 'iapPeriod', 'iapRangeApply', 'iapRangeClear',
  'ltvFilter', 'netRevFilter', 'netRevRangeApply', 'netRevRangeClear',
  'ovFilter', 'ovRangeApply', 'ovRangeClear', 'purRateFilter', 'refreshData',
  'retFilter', 'showSection', 'stickFilter', 'whaleFilter',
];

const PAGES = [
  {
    name: 'hub',
    url: '/',
    // The toggle in the hub's nav is wired to this; the reports listen for the
    // storage event it writes.
    assert: () => (typeof window.toggleThemeGlobal === 'function'
      ? null : 'window.toggleThemeGlobal is missing'),
  },
  { name: 'ua', url: '/reports/ua/' },
  {
    name: 'weekly',
    url: '/reports/weekly/',
    assert: () => (typeof window.switchCohort === 'function'
      ? null : 'window.switchCohort is missing'),
  },
  {
    name: 'till-date',
    url: '/reports/till-date/',
    assert: (names) => {
      const missing = names.filter((n) => typeof window[n] !== 'function');
      return missing.length ? 'inline handlers not on window: ' + missing.join(', ') : null;
    },
    assertArg: TILL_DATE_HANDLERS,
  },
  { name: 'aso', url: '/reports/aso/' },
  { name: 'negative-spend', url: '/reports/negative-spend/' },
];

/* Failures that are the absence of a signed-in session, not the absence of
   working code. The reports are supposed to survive these; that they report
   them cleanly is the correct behaviour. */
const EXPECTED = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /script\.google\.com/i,
  /could not reach the web app/i,
  /the web app did not answer/i,
  /Unauthorized/i,
  /session/i,
  /favicon/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
];
const expected = (text) => EXPECTED.some((re) => re.test(text));

/**
 * Runs vite's own entry script under this Node, rather than going through
 * `npx` in a shell. On Windows a shell-wrapped child is a grandchild, and
 * proc.kill() reaps only the shell — the preview server survives, keeps the
 * port, and the next run dies on --strictPort. Spawning it directly means the
 * pid we hold is the pid we can kill.
 */
function startServer() {
  const proc = spawn(
    process.execPath,
    [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'preview',
     '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let out = '';
  return new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error('preview did not start in 30s:\n' + out)), 30000);
    proc.stdout.on('data', (d) => {
      out += d.toString();
      if (out.includes('Local:')) { clearTimeout(timer); ok(proc); }
    });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      no(new Error(`preview exited ${code}:\n${out}`));
    });
  });
}

const server = await startServer();
const browser = await chromium.launch({ channel: 'msedge' });

let failed = 0;
const results = [];

for (const page of PAGES) {
  const ctx = await browser.newContext();
  const tab = await ctx.newPage();

  const crashes = [];   // uncaught exceptions — these are the ones that matter
  const noise = [];     // console.error that is not an uncaught exception

  tab.on('pageerror', (err) => crashes.push(err.message));
  tab.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!expected(text)) noise.push(text);
  });

  await tab.goto(BASE + page.url, { waitUntil: 'load', timeout: 30000 }).catch((e) => {
    crashes.push('navigation failed: ' + e.message);
  });

  // Let deferred work, chart building and the boot sequence actually run.
  await tab.waitForTimeout(4000);

  /* One structural assertion per page beyond "it did not throw": the document
     has to have applied a theme, which only happens if theme-boot ran in the
     head and theme.js evaluated afterwards. */
  const themed = await tab.evaluate(() =>
    document.documentElement.getAttribute('data-theme')
  ).catch(() => null);

  /* The light theme is applied by a different code path than the initial
     paint — theme-boot writes the html attribute, theme.js adds the body
     class — so exercising the switch is what proves both halves are wired. */
  const lightOk = await tab.evaluate(() => {
    try {
      localStorage.setItem('mss3d_theme', 'light');
      window.dispatchEvent(new StorageEvent('storage', { key: 'mss3d_theme', newValue: 'light' }));
      const on = document.body.classList.contains('lt');
      localStorage.setItem('mss3d_theme', 'dark');
      return on;
    } catch (e) { return false; }
  }).catch(() => false);

  const assertion = page.assert
    ? await tab.evaluate(
        ([fnSrc, arg]) => new Function('return ' + fnSrc)()(arg),
        [page.assert.toString(), page.assertArg ?? null]
      ).catch((e) => 'assertion threw: ' + e.message)
    : null;

  const real = crashes.filter((c) => !expected(c));
  if (real.length || !themed || !lightOk || assertion) failed++;

  results.push({
    page: page.name, crashes: real, noise,
    theme: themed || 'NONE', lightOk, assertion,
  });
  await ctx.close();
}

await browser.close();
server.kill();

console.log('\n' + '='.repeat(74));
for (const r of results) {
  const ok = r.crashes.length === 0 && r.theme !== 'NONE' && r.lightOk && !r.assertion;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${r.page.padEnd(16)} theme=${r.theme}  light-switch=${r.lightOk ? 'ok' : 'BROKEN'}`
  );
  if (r.assertion) console.log(`        assert:   ${r.assertion}`);
  r.crashes.forEach((c) => console.log(`        uncaught: ${c.split('\n')[0]}`));
  r.noise.slice(0, 5).forEach((c) => console.log(`        console: ${c.split('\n')[0].slice(0, 140)}`));
}
console.log('='.repeat(74));
console.log(failed ? `\n${failed} page(s) failed.\n` : '\nAll pages evaluated without uncaught errors.\n');

process.exit(failed ? 1 : 0);
