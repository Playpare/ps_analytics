/**
 * ============================================================================
 * extract-game.mjs — migrates the standalone Game Analytics document into the
 *                    Vite source tree, the same way extract.mjs did the six.
 * ============================================================================
 *
 * MECHANICAL on purpose. The <style> and <script> bodies move out byte-for-
 * byte; nothing is reformatted, reordered or fixed on the way. The document is
 * ~5,800 lines of working code, and the only migration worth trusting is one a
 * person can check with `diff` rather than by re-reading all of it.
 *
 * The known bugs in this file (dead session check, invisible alerts, demo user
 * list, feedback that never posts) are deliberately carried across UNCHANGED.
 * Moving and fixing in one step means a later breakage cannot be attributed to
 * either one; they are separate commits so the answer stays knowable.
 *
 * THE ONE THING THIS FILE MUST GET RIGHT
 * -------------------------------------
 * The document wires its buttons with inline handlers - onclick="doLogin()"
 * and friends - some written in the markup, some generated inside JS template
 * strings. Those attributes are evaluated in GLOBAL scope. As a plain <script>
 * that worked for free; an ES module has its own scope, so the moment this
 * code becomes a module every one of those functions is `undefined` and every
 * button dies SILENTLY - no error, nothing happens.
 *
 * So the handler names are DISCOVERED rather than hardcoded: every on*= value
 * in the document is scanned for called identifiers, intersected with the
 * functions the script actually declares, and the survivors are republished
 * onto `window` in a generated footer. Anything referenced but not declared is
 * reported as a warning rather than silently skipped.
 *
 * Run:  node tools/extract-game.mjs
 * Kept in the repo as the record of how game-analytics/ was produced.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'legacy', 'game_analytics.html');
const OUT = path.join(ROOT, 'game-analytics');
const NAME = 'game-analytics';

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const hashOf = (b) => sha(b.replace(/\s+/g, ' ').trim());

/* One font request, matching the rest of the app. */
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  'family=Poppins:wght@300;400;500;600;700;800&' +
  'family=Quicksand:wght@500;600;700&' +
  'family=Syne:wght@700;800&' +
  'family=DM+Mono:wght@400;500&display=swap">';

/* ---------------------------------------------------------------- parsing */

function parseBlocks(html) {
  const out = [];
  const re = /<(style|script)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [full, tagRaw, attrsRaw = '', body] = m;
    const tag = tagRaw.toLowerCase();
    const external = tag === 'script' && /\bsrc\s*=/.test(attrsRaw);
    out.push({
      tag,
      attrs: attrsRaw.trim(),
      body,
      external,
      start: m.index,
      end: m.index + full.length,
      hash: external ? null : hashOf(body),
    });
  }
  return out;
}

const cut = (html, ranges) =>
  [...ranges]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, r) => acc.slice(0, r.start) + acc.slice(r.end), html);

/* ------------------------------------------------- inline-handler discovery */

/** Every on*="…" value in the document, markup and generated alike. */
function handlerAttrValues(doc) {
  const out = [];
  const re = /\bon[a-z]+\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(doc))) out.push(m[1]);
  return out;
}

/** Identifiers that look like calls inside a handler body. */
function calledNames(expr) {
  const names = new Set();
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(expr))) names.add(m[2]);
  return names;
}

/** Top-level `function foo(){}` declarations in the extracted script. */
function declaredFunctions(js) {
  const names = new Set();
  const re = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(js))) names.add(m[1]);
  return names;
}

/* -------------------------------------------------------------- migration */

const html = fs.readFileSync(SRC, 'utf8');
const blocks = parseBlocks(html);
fs.mkdirSync(OUT, { recursive: true });

const css = [];
const js = [];
const drop = [];
const externals = [];

for (const b of blocks) {
  if (b.external) {
    // Chart.js comes from npm now; src/shared/chart.js puts it on window.
    externals.push(b.attrs);
    drop.push(b);
    continue;
  }
  const label = '/* --- from game_analytics.html · block ' + b.hash + ' --- */';
  (b.tag === 'style' ? css : js).push(label + '\n' + b.body.trim() + '\n');
  drop.push(b);
}

let jsBody = js.join('\n');

/* ---- endpoint substitution ----
 *
 * The ONLY place this migration is allowed to change the source, and it is
 * allowed because the alternative is worse. The document declares its /exec
 * URL and its shared key as literals; this repository is public, so carrying
 * them across byte-for-byte would republish in a committed file exactly what
 * src/shared/config.js and .gitignore'd legacy/ exist to keep out.
 *
 * Behaviour is unchanged: Vite inlines import.meta.env at build time, so the
 * running bundle holds the same two strings it always did. What changes is
 * that the repository, its forks and its history no longer do — and rotating
 * the deployment becomes a secret change rather than a commit.
 *
 * Each pattern must match exactly once. A silent miss here would mean a key
 * shipped to a public repo, so a miss is a hard failure, not a warning.
 */
const SUBS = [
  ['SHEET_API_URL', /const SHEET_API_URL = '[^']*';/g, 'const SHEET_API_URL = API_URLS.game;'],
  ['SHEET_API_KEY', /const SHEET_API_KEY = '[^']*';/g, 'const SHEET_API_KEY = GAME_API_KEY;'],
];
const subReport = [];
for (const [name, re, replacement] of SUBS) {
  const hits = jsBody.match(re) || [];
  if (hits.length !== 1) {
    throw new Error(
      `endpoint substitution for ${name} matched ${hits.length} times, expected exactly 1. ` +
      'Refusing to write — a miss would commit a live endpoint to a public repo.'
    );
  }
  jsBody = jsBody.replace(re, replacement);
  subReport.push({ constant: name, was: 'literal', now: replacement.split('= ')[1].replace(';', '') });
}

const CONFIG_IMPORT =
  "import { API_URLS, GAME_API_KEY } from '../src/shared/config.js';\n";

/* ---- the bridge ---- */
const declared = declaredFunctions(jsBody);
const referenced = new Set();
for (const v of handlerAttrValues(html)) for (const n of calledNames(v)) referenced.add(n);

const bridged = [...referenced].filter((n) => declared.has(n)).sort();
const unresolved = [...referenced].filter((n) => !declared.has(n)).sort();

const bridge = [
  '',
  '',
  '/* ===========================================================================',
  ' * Inline-handler bridge — GENERATED by tools/extract-game.mjs. Do not edit.',
  ' *',
  ' * This document wires its buttons with onclick="doLogin()" style attributes,',
  ' * which the browser evaluates in GLOBAL scope. As a <script> that worked for',
  ' * free; as an ES module it does not, because a module has its own scope, so',
  ' * every one of these would be undefined — buttons that do nothing, with no',
  ' * error to notice.',
  ' *',
  ' * Republished here so the markup keeps working byte-for-byte. Converting the',
  ' * attributes to addEventListener is a real improvement and a SEPARATE change:',
  ' * doing it here would mean the migration altered behaviour, which is the one',
  ' * thing it must not do.',
  ' *',
  ' * ' + bridged.length + ' functions, discovered by scanning every on*= value in the',
  ' * source and keeping those this script actually declares.',
  ' * ========================================================================= */',
  'Object.assign(window, {',
  bridged.map((n) => '  ' + n + ',').join('\n'),
  '});',
  '',
].join('\n');

fs.writeFileSync(path.join(OUT, NAME + '.css'), css.join('\n'), 'utf8');
fs.writeFileSync(
  path.join(OUT, NAME + '.legacy.js'),
  '/* eslint-disable */\n' + CONFIG_IMPORT + jsBody + bridge,
  'utf8'
);

/* ---- the document ---- */
let doc = cut(html, drop);
doc = doc.replace(/[ \t]*<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\n?/gi, '');
// No <!--THEME_BOOT-->: this document carries its own data-theme system and
// toggleTheme(). Injecting the shared bootstrap would give it two.
doc = doc.replace(/<\/head>/i, '  ' + FONTS + '\n</head>');
doc = doc.replace(/<\/body>/i, '  <script type="module" src="./main.js"></script>\n</body>');
doc = doc.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(path.join(OUT, 'index.html'), doc, 'utf8');

/* ----------------------------------------------------------------- report */

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log('\nEXTRACTED');
console.table([
  {
    page: NAME,
    'style blocks': css.length,
    'script blocks': js.length,
    html: kb(doc),
    css: kb(css.join('')),
    js: kb(jsBody),
  },
]);

console.log('\nENDPOINT SUBSTITUTION (the one change to the source — see the comment above SUBS)');
console.table(subReport);

console.log('\nEXTERNAL SCRIPTS DROPPED (npm + src/shared/chart.js replace them)');
externals.forEach((a) => console.log('  <script ' + a + '>'));

console.log('\nINLINE-HANDLER BRIDGE — ' + bridged.length + ' functions republished on window');
console.log('  ' + bridged.join(', '));

if (unresolved.length) {
  console.log('\n  referenced by a handler but NOT declared as a function here:');
  unresolved.forEach((n) => console.log('      ' + n + '   <-- check this by hand'));
}
console.log('');
