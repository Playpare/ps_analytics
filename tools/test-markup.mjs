/**
 * ============================================================================
 * test-markup.mjs — are the report pages' tags balanced?
 * ============================================================================
 *
 *   npm run test:markup
 *
 * WHY THIS EXISTS
 *
 * One stray `</div>` in reports/weekly/index.html made every platform slide
 * show on every view, including the Overview, for days.
 *
 * It survived review because nothing about it is visible in a diff. The change
 * removed a block of markup; the diff showed a block of markup being removed;
 * the card it removed was confirmed gone. All true, and the file was left with
 * one closer more than it had openers.
 *
 * The damage was four slides away from the edit. `setupSubnav` classifies
 * slides with `:scope > .slide` and `selectSub` hides them the same way -
 * direct children only - so a container closing early turned every later slide
 * into a sibling rather than a child. Not classified, not hidden, visible
 * everywhere at once.
 *
 * WHAT IT CHECKS, AND WHY THAT AND NOT MORE
 *
 * Two things, both cheap and both load-bearing:
 *
 *   1. every non-void element opens and closes the same number of times
 *   2. every `.slide` in a file opens at the same nesting depth
 *
 * The second is the one that matters. A file can be perfectly balanced and
 * still have a slide nested one level too deep - and that slide disappears
 * from `:scope >` the same way. Counting tags would not see it; walking the
 * depth does.
 *
 * It is a counter, not a parser. A real HTML parser would be better and is not
 * worth the dependency: the failure this guards against is a count being off
 * by one, and a count catches that exactly.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PAGES = [
  'index.html',
  'reports/weekly/index.html',
  'reports/ua/index.html',
  'reports/till-date/index.html',
  'reports/aso/index.html',
  'reports/negative-spend/index.html'
];

/* Elements that never have a closing tag, so counting them would always
   disagree with itself. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

let bad = 0, checked = 0;
const fail = (file, msg) => { bad++; console.log(`  FAIL  ${file}\n        ${msg}`); };

for (const page of PAGES) {
  const path = join(ROOT, page);
  if (!existsSync(path)) continue;          // not every report has one
  checked++;

  /* Comments and the contents of script/style are not markup and contain
     things that look like tags. Removed before anything is counted. */
  const html = readFileSync(path, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  /* ---- 1. balance, per element name ---------------------------------- */
  const open = {}, close = {};
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const [, slash, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (VOID.has(name) || attrs.trimEnd().endsWith('/')) continue;
    if (slash) close[name] = (close[name] || 0) + 1;
    else open[name] = (open[name] || 0) + 1;
  }

  for (const name of new Set([...Object.keys(open), ...Object.keys(close)])) {
    const o = open[name] || 0, c = close[name] || 0;
    if (o !== c) {
      fail(page, `<${name}> opens ${o} time(s) and closes ${c} — `
        + `${o > c ? 'a closing tag is missing' : 'there is an extra closing tag'}`);
    }
  }

  /* ---- 2. every slide at the same depth -------------------------------- */
  let depth = 0, first = null, offenders = 0, slides = 0;
  for (const m of html.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    const tag = m[0];
    if (tag.startsWith('</')) { depth--; continue; }
    if (/class="[^"]*\bslide\b/.test(tag)) {
      slides++;
      if (first === null) first = depth;
      else if (depth !== first) offenders++;
    }
    depth++;
  }
  if (offenders) {
    fail(page, `${offenders} of ${slides} slides open at a different nesting `
      + `depth than the first. setupSubnav and selectSub use ':scope > .slide', `
      + `so those slides are never classified and never hidden.`);
  }
  if (depth !== 0) {
    fail(page, `the <div> tree ends at depth ${depth} rather than 0.`);
  }
}

console.log(bad
  ? `\n  ${bad} problem(s) in ${checked} page(s)\n`
  : `\n  markup: ${checked} page(s), tags balanced and every slide at one depth\n`);
process.exit(bad ? 1 : 0);
