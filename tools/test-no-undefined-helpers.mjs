/**
 * ============================================================================
 * test-no-undefined-helpers.mjs — the DOM helper each page actually has
 * ============================================================================
 *
 *   node tools/test-no-undefined-helpers.mjs
 *
 * WHY THIS EXISTS
 *
 * `installsNote` called `$('installsSrcNote')`. game-analytics has no `$`; it
 * has `g`. The ReferenceError was thrown inside renderGrowth, which stopped
 * before drawing anything, so the entire Growth tab came up blank — not just
 * the one line the helper was meant to fill.
 *
 * It cost three rounds. The call shipped. The unit test for that function
 * passed, because the test had declared `$` in its own sandbox and so handed
 * the code the very thing that was missing. The real fix then missed the
 * merge and sat on a branch while main went on serving the broken build.
 *
 * WHAT THIS CHECKS — AND WHAT IT GAVE UP ON
 *
 * One thing, precisely: no page calls `$(` unless that page declares `$`.
 * ua and aso do declare it, and use it 33 and 55 times; game-analytics does
 * not. So the question is per file, not per project.
 *
 * The first version tried to be general — every called identifier must be
 * declared somewhere. That needs strings, comments and template literals
 * stripped first, and two attempts with regexes both failed: template
 * substitutions contain braces, so `[^}]*\}` stops early and swallows code to
 * the next backtick; and quote pairing drifts on one stray apostrophe, which
 * made the check report the broken file as clean. That last outcome is worse
 * than having no check at all. Doing it properly needs a parser, which is
 * worth doing and was not worth doing while the page was down.
 *
 * So this reads the RAW source. It can only err toward a false positive — a
 * `$(` inside a comment would trip it — which is loud and trivial to settle.
 * Measured here: game-analytics has 0, the broken version on main had 1.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'game-analytics/game-analytics.legacy.js',
  'reports/ua/ua.legacy.js',
  'reports/aso/aso.legacy.js'
];

let bad = 0, n = 0;
const ok = (label, cond, detail) => {
  n++;
  if (!cond) { bad++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};

console.log('\n  no page calls a DOM helper it never declares');
console.log('  ' + '-'.repeat(62));

for (const file of FILES) {
  let raw;
  try { raw = readFileSync(join(ROOT, file), 'utf8'); }
  catch { continue; }

  const declaresDollar =
    /(?:^|[\n;{(,])\s*(?:const|let|var|function)\s*\$\s*[=(]/.test(raw);

  const hits = [];
  raw.split('\n').forEach((line, i) => {
    // Not preceded by a dot, a word character or another $, so `obj.$(`,
    // `a$(` and `$$(` are left alone.
    if (/(^|[^.\w$])\$\s*\(/.test(line)) {
      hits.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}`);
    }
  });

  if (declaresDollar) {
    ok(`${file}: declares its own $, so its ${hits.length} call(s) are fine`, true);
  } else {
    ok(`${file}: no call to an undeclared $`, hits.length === 0,
       hits.slice(0, 5).join('\n        ')
       + (hits.length > 5 ? `\n        ...and ${hits.length - 5} more` : ''));
  }
}

/* The helper game-analytics does have, asserted by name. If `g` is renamed,
   this says so rather than leaving the check above passing against a file
   where nothing resolves. */
const ga = readFileSync(join(ROOT, 'game-analytics/game-analytics.legacy.js'), 'utf8');
ok('game-analytics declares g as its element lookup',
   /^const g = id => document\.getElementById\(id\);$/m.test(ga),
   'the helper was renamed; the check above is now aimed at the wrong name');

/* And that the function which caused all this uses it. */
ok('installsNote resolves its element through g',
   /function installsNote[\s\S]{0,400}?\bg\('installsSrcNote'\)/.test(ga));

console.log(`  ${n - bad}/${n} passed${bad ? `  (${bad} FAILED)` : ''}\n`);
process.exit(bad ? 1 : 0);
