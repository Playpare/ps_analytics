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
 *   npm run smoke                     against a local `npm run build`
 *   npm run smoke -- --url <base>     against a deployed site
 *
 * The --url form is how a deploy gets checked. A build passing locally and the
 * deployed site working are different claims: the base path, the asset URLs and
 * the endpoints baked in from secrets are all decided by the CI build, not this
 * one, and none of them are exercised until something loads the real thing.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;

const urlArg = process.argv.indexOf('--url');
const REMOTE = urlArg > -1 ? process.argv[urlArg + 1].replace(/\/$/, '') : null;
const BASE = REMOTE || `http://localhost:${PORT}`;

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

/* The same trap, in game-analytics: 22 functions its markup and its generated
   rows call from on*="" attributes. tools/extract-game.mjs discovers them and
   republishes them; this is the check that notices if that ever stops. */
const GAME_HANDLERS = [
  'addFeedback', 'addUser', 'applyDateFilter', 'changeRole', 'doLogin',
  'doLogout', 'goTab', 'goToTab', 'hardReset', 'jumpToLatest', 'loadUsers',
  'mxSetGrain', 'mxToggleSheetColours', 'onDateInput', 'onGameChange',
  'onPresetChange', 'onProgRangeChange', 'removeUser', 'saveThresh',
  'syncNow', 'toggleSidebar', 'toggleTheme',
];

const PAGES = [
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
  {
    name: 'shell',
    url: '/',
    /* Exempt from the shared light-switch check, which looks for the `lt` body
       class src/shared/theme.js adds. This page never had that: it carries its
       own data-theme system, and importing theme.js as well would give it two
       writers over one attribute.
       What it DOES now share is the key. The reports read 'mss3d_theme' and
       this page writes it, which is the half of the reconciliation that had to
       happen the moment they became frames inside it — asserted below. */
    sharedTheme: false,
    /* Note what this does NOT prove. The document opens on a login screen and
       init() only runs after a successful sign-in, so nothing here renders a
       chart or calls the backend. What it does prove is the part the module
       conversion actually threatened: the script evaluates under strict mode
       without throwing, and all 22 inline handlers resolve. Charts have to be
       checked by signing in. */
    assert: (names) => {
      const missing = names.filter((n) => typeof window[n] !== 'function');
      if (missing.length) return 'inline handlers not on window: ' + missing.join(', ');

      // Its own theme path, since it is exempt from the shared one above:
      // toggleTheme() must actually flip the attribute, and put it back.
      const root = document.documentElement;
      const before = root.getAttribute('data-theme');
      window.toggleTheme();
      const after = root.getAttribute('data-theme');
      window.toggleTheme();
      if (after === before) return 'toggleTheme() did not change data-theme';
      if (root.getAttribute('data-theme') !== before) return 'toggleTheme() is not reversible';

      /* The reports read localStorage['mss3d_theme'] and follow it. The hub
         used to write it; this page does now. Without this the shell switches
         to light and every report framed inside it stays dark, which is not
         something the eye forgives. */
      window.toggleTheme();
      const written = (() => { try { return localStorage.getItem('mss3d_theme'); } catch (e) { return null; } })();
      const nowTheme = root.getAttribute('data-theme');
      window.toggleTheme();
      if (written !== nowTheme) {
        return 'toggleTheme() left mss3d_theme as ' + written + ' while the page is ' + nowTheme +
               ' - framed reports would not follow';
      }

      /* ---- the shell: scope, reports, and the controls ----
         Reached through window.__shell because the test cannot sign in, so it
         never gets a nav to click. */
      const S = window.__shell;
      if (!S) return '__shell test hook is missing';

      const ids = S.sections.map((s) => s.id);
      const reports = ['negative', 'uareport', 'monetization', 'tilldate', 'aso'];
      const absent = reports.filter((r) => ids.indexOf(r) < 0);
      if (absent.length) return 'report sections missing from the nav: ' + absent.join(', ');

      // Every section must declare a scope the SCOPES table knows about, or
      // applyScope silently falls back to 'game' and a report gets a game
      // picker over it.
      const bad = S.sections.filter((s) => !S.scopes[s.scope]);
      if (bad.length) return 'sections with an unknown scope: ' +
        bad.map((s) => s.id + '=' + s.scope).join(', ');

      // Nothing is built until it is opened.
      if (document.getElementById('tab-negative')) return 'a report pane was built before it was opened';

      // The controls swap, and swap back. Neither may end up hidden with no
      // chip in its place - that is the reflow this design exists to avoid.
      const check = (scope) => {
        S.applyScope(scope);
        return [['gameSelect', 'gameChip'], ['rangePreset', 'rangeChip']].map((pair) => {
          const c = document.getElementById(pair[0]);
          const chip = document.getElementById(pair[1]);
          const cOn = c && c.style.display !== 'none';
          const chipOn = chip && chip.style.display !== 'none';
          if (cOn === chipOn) return pair[0] + ': both or neither visible in scope ' + scope;
          if (chipOn && !chip.textContent.trim()) return pair[1] + ': shown but empty in scope ' + scope;
          return null;
        }).filter(Boolean);
      };
      const uaProblems = check('ua');
      const gameProblems = check('game');
      if (uaProblems.length || gameProblems.length) {
        return 'scope controls: ' + uaProblems.concat(gameProblems).join('; ');
      }
      // Left in the state a fresh load expects.
      S.applyScope('game');
      return null;
    },
    assertArg: GAME_HANDLERS,
  },
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

  /* Vite colours its banner, so "Local:" arrives as "Local" + an ANSI reset +
     ":" and a literal substring match never fires — the run then dies on the
     30s timeout with the server plainly running in the captured output. Strip
     the escapes before matching, and match the URL rather than the label,
     which is the part that cannot be restyled. */
  const plain = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
  let out = '';
  return new Promise((ok, no) => {
    const timer = setTimeout(() => no(new Error('preview did not start in 30s:\n' + out)), 30000);
    proc.stdout.on('data', (d) => {
      out += d.toString();
      if (plain(out).includes(`localhost:${PORT}`)) { clearTimeout(timer); ok(proc); }
    });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      no(new Error(`preview exited ${code}:\n${out}`));
    });
  });
}

const server = REMOTE ? null : await startServer();
if (REMOTE) console.log(`checking deployed site: ${BASE}`);
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
  const lightOk = page.sharedTheme === false ? 'n/a' : await tab.evaluate(() => {
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
if (server) server.kill();

console.log('\n' + '='.repeat(74));
for (const r of results) {
  const ok = r.crashes.length === 0 && r.theme !== 'NONE' && r.lightOk && !r.assertion;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${r.page.padEnd(16)} theme=${r.theme}  light-switch=${
      r.lightOk === 'n/a' ? 'own theme' : r.lightOk ? 'ok' : 'BROKEN'}`
  );
  if (r.assertion) console.log(`        assert:   ${r.assertion}`);
  r.crashes.forEach((c) => console.log(`        uncaught: ${c.split('\n')[0]}`));
  r.noise.slice(0, 5).forEach((c) => console.log(`        console: ${c.split('\n')[0].slice(0, 140)}`));
}
console.log('='.repeat(74));
console.log(failed ? `\n${failed} page(s) failed.\n` : '\nAll pages evaluated without uncaught errors.\n');

process.exit(failed ? 1 : 0);
