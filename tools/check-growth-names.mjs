/**
 * Every name renderGrowth calls, checked against what the file defines.
 *
 * This is the shape of the bug that blanked the whole Growth tab once
 * before: a helper called `$` in a file that defines `g`. A name that
 * exists nowhere does not fail quietly - it throws on the line it is on,
 * and everything after that line in the same function never runs. One
 * wrong identifier near the top of renderGrowth takes out every table
 * below it, which looks exactly like "the data is missing".
 *
 * Strict-mode compilation will not catch it: free identifiers are resolved
 * at call time, not at parse time. So the names are read out of the source
 * and looked up by hand.
 *
 * It errs towards reporting too much rather than too little. A name on the
 * list that turns out to be a browser or library global is noise; a name
 * missing from the list that does not exist is a blank tab.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const S = readFileSync(join(ROOT, 'game-analytics/game-analytics.legacy.js'), 'utf8');

/* The functions Growth draws through. Checked together because a throw in
   any of them leaves the rest of the tab empty. */
const FUNCS = ['renderGrowth', 'renderSpendMatrix', 'installsNote'];

/* Built-ins, DOM, and the method names that come after a dot. Method calls
   are not free identifiers and cannot be undefined in the way this looks
   for. */
const KNOWN = new Set(`
if for while switch catch function return typeof new do else void delete
String Number Math Object Array JSON Date Boolean RegExp Set Map Promise Error
parseFloat parseInt isNaN isFinite encodeURIComponent decodeURIComponent
console document window setTimeout setInterval requestAnimationFrame fetch
Chart getComputedStyle
map filter forEach reduce sort find findIndex join slice splice push pop shift
unshift includes indexOf lastIndexOf some every concat reverse flat flatMap
keys values entries assign freeze fromEntries isArray
toFixed toString toLocaleString trim split replace replaceAll match matchAll
startsWith endsWith padStart padEnd repeat charAt substring substr at
max min round abs floor ceil pow sqrt sign
has get set add remove toggle contains
querySelector querySelectorAll getElementById createElement appendChild
closest addEventListener removeEventListener getContext destroy update
now parse stringify from of test exec call apply bind
`.trim().split(/\s+/));

let bad = 0;
for (const fn of FUNCS) {
  const start = S.indexOf(`function ${fn}(`);
  if (start === -1) { console.log(`  ${fn}: NOT FOUND`); bad++; continue; }
  const next = S.indexOf('\nfunction ', start + 10);
  const body = S.slice(start, next === -1 ? S.length : next);

  /* COMMENTS COME OUT FIRST.

     The first run of this reported sixteen "undefined" names - cards,
     Sheet1, Revenue, AG, Total - every one of them an ordinary word in a
     prose comment that happened to be followed by a bracket, as in
     "Sheet1 (RawData)". A checker that cries wolf sixteen times is worse
     than no checker, because the seventeenth name is the real one.

     Trailing comments go too, and that needs care: a // inside a string -
     "https://..." - must not take the rest of the line with it. So a line
     is cut at the first // that has an EVEN number of unescaped quotes
     before it, which is the test for "not inside a string".

     Leaving them in left four more phantoms (AG, App, Revenue, range), and
     four is still enough to train someone to ignore the output. */
  const stripTrailing = (line) => {
    let qd = 0, qs = 0, qb = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '\\') { i++; continue; }
      if (c === '"') qd ^= 1;
      else if (c === "'") qs ^= 1;
      else if (c === '`') qb ^= 1;
      else if (c === '/' && line[i + 1] === '/' && !qd && !qs && !qb) {
        return line.slice(0, i);
      }
    }
    return line;
  };

  /* And string CONTENTS are blanked, keeping the quotes.

     Four more phantoms came from here: 'Revenue (Applovin)',
     'IN-App (Proceeds)', 'Sheet1 column AG (fallback)' and 'No whale rows
     in range (weekly grain)'. A word followed by a bracket inside a label
     is not a call, and a checker cannot tell the difference by looking at
     the raw text. */
  const blankStrings = (line) => {
    let out = '', q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '\\') { out += '  '; i++; continue; }
        if (c === q) { q = null; out += c; } else { out += ' '; }
      } else if (c === '"' || c === "'" || c === '`') {
        q = c; out += c;
      } else {
        out += c;
      }
    }
    return out;
  };

  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .map(stripTrailing)
    .map(blankStrings)
    .join('\n');

  /* A call site, but not a method call - so `foo(` counts and `x.foo(`
     does not. The dot is what tells them apart. */
  const called = new Set();
  for (const m of code.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    called.add(m[2]);
  }

  const missing = [];
  for (const name of called) {
    if (KNOWN.has(name)) continue;
    const defined =
      new RegExp('\\bfunction\\s+' + name + '\\b').test(S) ||
      new RegExp('\\b(?:const|let|var)\\s+' + name + '\\b').test(S) ||
      new RegExp('\\b' + name + '\\s*[:=]\\s*(?:function|\\()').test(S) ||
      new RegExp('\\b' + name + '\\s*=\\s*[A-Za-z_$(]').test(S);
    if (!defined) missing.push(name);
  }

  console.log(`  ${fn}: ${called.size} name(s) called` +
    (missing.length ? `  ->  NOT DEFINED: ${missing.join(', ')}` : '  ->  all resolve'));
  if (missing.length) bad++;
}

console.log(bad ? '\n  A name that resolves nowhere throws, and every table\n'
                + '  below that line never renders.\n'
                : '\n  No undefined call in the functions Growth draws through.\n');
process.exit(bad ? 1 : 0);
