/**
 * ============================================================================
 * test-installs-note.mjs — the daily-installs card says what it is showing
 * ============================================================================
 *
 *   node tools/test-installs-note.mjs
 *
 * Lifted out of the shipped file rather than copied, so it cannot keep
 * passing after the shipped version has drifted.
 *
 * WHY THIS EXISTS
 *
 * The subtitle was a fixed sentence in the markup ending "· Android". It
 * stayed on screen under the iOS filter, telling anyone reading it the wrong
 * thing about the number beside it. Nothing was broken — the label simply
 * described a state the dashboard had moved on from.
 *
 * A label that describes data has to be written from that data, or it is only
 * correct until the data moves. So it now comes from two fields the backend
 * sends, and these tests pin the three cases that differ:
 *
 *   Android          Play Console, Android
 *   iOS              Play Console once the tab has an iOS column; the old
 *                    source, named, until then
 *   Combined         "Android + iOS" ONLY when that column exists — otherwise
 *                    the figure is Android alone and must say so
 *
 * That last case is the one that would quietly go wrong again: on Combined
 * the source is play-console either way, so a subtitle keyed on the source
 * alone would claim both platforms over an Android-only number.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'game-analytics/game-analytics.legacy.js'), 'utf8');

function lift(decl) {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`not in the shipped file: ${decl}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`never closes: ${decl}`);
}

let text = null;
const el = { set textContent(v) { text = v; }, get textContent() { return text; } };

/* The DOM is stubbed; the file's own helpers are NOT.
 *
 * The first version of this test declared `$` in the sandbox and passed while
 * the shipped code threw a ReferenceError on every render — this file has no
 * `$`, it has `g`. The test had supplied the very thing that was broken, so
 * it went green while the whole Growth tab came up blank in the browser.
 *
 * The rule that follows: fake only what is genuinely absent — `document` —
 * and lift everything the file defines for itself out of the file, including
 * the helpers the function under test calls. A sandbox global that papers
 * over a missing declaration is not a test, it is a second implementation.
 *
 * The match below is strict on purpose. If `g` is renamed or redefined this
 * throws, rather than quietly reverting to the state that shipped the bug. */
const gDecl = src.match(/^const g = id => document\.getElementById\(id\);$/m);
if (!gDecl) throw new Error('the DOM helper `g` is no longer declared as expected');

let bad = 0, n = 0;
const ok = (label, cond, detail) => {
  n++;
  if (!cond) { bad++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
};

console.log('\n  daily installs — the card subtitle');
console.log('  ' + '-'.repeat(60));

/* ---- it calls a helper this file actually has -------------------------- */

/* Checked on the SOURCE, before the sandbox is built, so an undefined helper
   is reported by name instead of crashing this file with the same
   ReferenceError it is meant to catch. */
const noteSrc = lift('function installsNote(d, cur)');
ok('installsNote does not call `$`, which this file does not define',
  !/\$\(/.test(noteSrc), (noteSrc.match(/.*\$\(.*/) || [])[0]);
ok('it uses `g`, the helper this file does define', /\bg\(/.test(noteSrc));

const api = new Function('EL', `
  const document = { getElementById: (id) => (id === 'installsSrcNote' ? EL : null) };
  ${gDecl[0]}
  ${noteSrc}
  return { installsNote };
`)(el);

const run = (platform, rows) => {
  text = null;
  api.installsNote({ platform }, rows);
  return text || '';
};

const consoleRow  = (hasIos) => ({ installsSource: 'play-console', consoleHasIos: hasIos });
const byteBrewRow = () => ({ installsSource: 'bytebrew', consoleHasIos: false });

/* ---- the markup no longer carries the sentence ------------------------ */

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
ok('the subtitle is an element the data fills, not fixed text',
  /id="installsSrcNote"/.test(html));
ok('the old hard-coded "· Android" sentence is gone',
  !/Play Console installs · Android\./.test(html));

/* ---- Android ---------------------------------------------------------- */

const and = run('android', [consoleRow(false)]);
ok('android names Play Console', /Play Console/.test(and), and);
ok('android says Android', /Android/.test(and), and);
ok('android does not claim iOS', !/iOS/.test(and), and);

/* ---- iOS, before and after the column exists -------------------------- */

const iosOld = run('ios', [byteBrewRow()]);
ok('iOS on the old source does NOT say Android', !/Android/.test(iosOld), iosOld);
ok('iOS on the old source says iOS', /iOS/.test(iosOld), iosOld);
ok('iOS on the old source names that source',
  /Executive KPI/.test(iosOld), iosOld);
ok('and explains why it is not on Play Console',
  /no iOS column/.test(iosOld), iosOld);

const iosNew = run('ios', [consoleRow(true)]);
ok('iOS on Play Console says so', /Play Console/.test(iosNew), iosNew);
ok('iOS on Play Console says iOS', /iOS/.test(iosNew), iosNew);
ok('iOS on Play Console does not mention Android', !/Android/.test(iosNew), iosNew);

/* ---- Combined: the case that would go wrong again ---------------------- */

const allNoIos = run('all', [consoleRow(false)]);
ok('combined without the column does NOT claim Android + iOS',
  !/Android \+ iOS/.test(allNoIos), allNoIos);
ok('combined without the column says the figure is Android only',
  /Android only/.test(allNoIos), allNoIos);
ok('and says why', /no iOS column/.test(allNoIos), allNoIos);

const allWithIos = run('all', [consoleRow(true)]);
ok('combined WITH the column claims both', /Android \+ iOS/.test(allWithIos), allWithIos);
ok('and drops the caveat', !/Android only/.test(allWithIos), allWithIos);

/* The two combined cases must not read the same - that is the whole point. */
ok('the two combined cases say different things', allNoIos !== allWithIos);

/* ---- the gap note, which is about reading the chart ------------------- */

for (const [label, t] of [['android', and], ['iOS', iosNew], ['combined', allWithIos]]) {
  ok(`${label} still explains that a gap is not a zero`,
    /not zero installs/.test(t), t);
}

/* ---- nothing to say ---------------------------------------------------- */

ok('no rows at all leaves a dash rather than a sentence about nothing',
  run('all', []) === '—', JSON.stringify(run('all', [])));
ok('rows with no source field do not produce a half-written sentence',
  run('all', [{ installs: 5 }]).length > 0);

console.log(`  ${n - bad}/${n} passed${bad ? `  (${bad} FAILED)` : ''}\n`);
process.exit(bad ? 1 : 0);
