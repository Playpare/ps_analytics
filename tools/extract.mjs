/**
 * ============================================================================
 * extract.mjs — one-shot migration from the six standalone HTML documents
 *               into the Vite multi-page source tree.
 * ============================================================================
 *
 * This is deliberately MECHANICAL. Every <style> and inline <script> body is
 * moved out byte-for-byte; nothing is reformatted, reordered or "improved" on
 * the way. That is the whole point: the reports are ~800 KB of working code
 * whose behaviour nobody wants to re-derive, so the migration that produces
 * them must be one a person can check by diffing text rather than by reading
 * 13,000 lines and hoping.
 *
 * The only content that is dropped is content this file names explicitly:
 *   - blocks that exist identically in several documents (they become one
 *     shared module instead), and
 *   - blocks the browser already refuses to run.
 * Both lists are below, with the hash of every block so a re-run can prove it
 * removed exactly what it meant to.
 *
 * Run once:  node tools/extract.mjs
 * It is kept in the repo as the record of how src/ was produced.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = path.join(ROOT, 'legacy');

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const hashOf = (body) => sha(norm(body));

/* ---------------------------------------------------------------------------
 * 1. Blocks that leave the documents
 * ------------------------------------------------------------------------- */

/**
 * Duplicated blocks. Each of these appears byte-identical (modulo whitespace)
 * in two or more documents; the shared module named here replaces all copies.
 * Near-duplicates - the theme script, which drifted slightly in each file -
 * are listed individually and reconciled by hand in src/shared/theme.js.
 */
const SHARED = {
  '449bd87460': 'src/shared/snapshot.js',        // IndexedDB cache + boot sequence, x3
  'ac096eca8a': 'src/shared/theme.js',           // theme sync, hub variant
  'b9d335b108': 'src/shared/theme.js',           // theme sync, ua + weekly variant
  '6098aed067': 'src/shared/theme.js',           // theme sync, aso variant
  '1c67f2e65c': 'src/shared/styles/motion.css',  // button press/hover motion, x4
  '627bfccb88': 'src/shared/styles/motion.css',  // colour transitions, x3
  '5a284b7e39': 'src/shared/styles/motion.css',  // colour transitions, weekly variant
};

/**
 * Code the browser never executed. Both are <script type="application/
 * x-static-disabled">, left behind when weekly_report.html stopped being an
 * Excel export and started reading live data. 55 KB that every visitor has
 * downloaded and parsed as inert text ever since.
 */
const DEAD = {
  dd585fe4a6: 'weekly: disabled static Chart.defaults + hardcoded 2024 datasets',
  '304cc0f23a': 'weekly: disabled static Excel data-source block',
};

/* ---------------------------------------------------------------------------
 * 2. The pages
 * ------------------------------------------------------------------------- */

const PAGES = [
  { src: 'index.html', out: '.', name: 'hub', kind: 'hub' },
  { src: 'ua_report.html', out: 'reports/ua', name: 'ua', kind: 'report' },
  { src: 'weekly_report.html', out: 'reports/weekly', name: 'weekly', kind: 'report' },
  { src: 'till_date_report.html', out: 'reports/till-date', name: 'till-date', kind: 'report' },
  { src: 'aso_report.html', out: 'reports/aso', name: 'aso', kind: 'report' },
  { src: 'negative_spend_report.html', out: 'reports/negative-spend', name: 'negative-spend', kind: 'report' },
];

/* One font request for the whole app, carrying the union of every weight the
   six documents asked for separately. */
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  'family=Poppins:wght@300;400;500;600;700;800&' +
  'family=Quicksand:wght@500;600;700&' +
  'family=Syne:wght@700;800&' +
  'family=DM+Mono:wght@400;500&display=swap">';

/* ---------------------------------------------------------------------------
 * 3. Parsing
 * ------------------------------------------------------------------------- */

function parseBlocks(html) {
  const out = [];
  const re = /<(style|script)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const [full, tagRaw, attrsRaw = '', body] = m;
    const tag = tagRaw.toLowerCase();
    const attrs = attrsRaw.trim();
    const external = tag === 'script' && /\bsrc\s*=/.test(attrs);
    out.push({
      tag,
      attrs,
      body,
      external,
      start: m.index,
      end: m.index + full.length,
      hash: external ? null : hashOf(body),
    });
  }
  return out;
}

/** Ranges to delete from the source HTML, merged and applied back to front. */
function cut(html, ranges) {
  return [...ranges]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, r) => acc.slice(0, r.start) + acc.slice(r.end), html);
}

/* ---------------------------------------------------------------------------
 * 4. Migration
 * ------------------------------------------------------------------------- */

const report = { pages: [], sharedRemoved: {}, deadRemoved: [], warnings: [] };

for (const page of PAGES) {
  const srcPath = path.join(LEGACY, page.src);
  const html = fs.readFileSync(srcPath, 'utf8');
  const blocks = parseBlocks(html);

  const outDir = path.join(ROOT, page.out);
  fs.mkdirSync(outDir, { recursive: true });

  const css = [];
  const js = [];
  const drop = [];
  const imports = [];

  for (const b of blocks) {
    if (b.external) {
      // Chart.js arrives from npm now, whichever CDN this document happened
      // to use. The tag goes; src/shared/chart.js takes its place.
      drop.push(b);
      continue;
    }

    if (DEAD[b.hash]) {
      drop.push(b);
      report.deadRemoved.push(`${page.src}: ${b.hash} — ${DEAD[b.hash]}`);
      continue;
    }

    if (SHARED[b.hash]) {
      drop.push(b);
      const target = SHARED[b.hash];
      (report.sharedRemoved[target] ||= []).push(`${page.src}:${b.hash}`);
      continue;
    }

    // Anything left is this document's own code.
    if (b.tag === 'style') {
      css.push(`/* --- from ${page.src} · block ${b.hash} --- */\n${b.body.trim()}\n`);
    } else {
      const kind = b.attrs ? ` (was <script ${b.attrs}>)` : '';
      js.push(`/* --- from ${page.src} · block ${b.hash}${kind} --- */\n${b.body.trim()}\n`);
    }
    drop.push(b);
  }

  /* ---- write the extracted code ---- */
  if (css.length) {
    fs.writeFileSync(path.join(outDir, `${page.name}.css`), css.join('\n'), 'utf8');
    imports.push(`import './${page.name}.css';`);
  }
  if (js.length) {
    // One file, not one per block: several blocks in the same document refer
    // to each other's top-level bindings, and separate ES modules would each
    // get their own scope and break those references.
    fs.writeFileSync(
      path.join(outDir, `${page.name}.legacy.js`),
      `/* eslint-disable */\n${js.join('\n')}`,
      'utf8'
    );
  }

  /* ---- rewrite the document ---- */
  let doc = cut(html, drop);

  // Drop every per-document font <link>; one unified request is injected below.
  doc = doc.replace(/[ \t]*<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\n?/gi, '');

  // Inject fonts + the critical theme bootstrap, then the module entry.
  doc = doc.replace(
    /<\/head>/i,
    `  ${FONTS}\n  <!--THEME_BOOT-->\n</head>`
  );
  doc = doc.replace(
    /<\/body>/i,
    `  <script type="module" src="./main.js"></script>\n</body>`
  );

  // Collapse the blank lines the removals left behind.
  doc = doc.replace(/\n{3,}/g, '\n\n');

  fs.writeFileSync(path.join(outDir, 'index.html'), doc, 'utf8');

  report.pages.push({
    name: page.name,
    out: page.out,
    cssBlocks: css.length,
    jsBlocks: js.length,
    htmlKB: (Buffer.byteLength(doc) / 1024).toFixed(1),
    cssKB: (Buffer.byteLength(css.join('')) / 1024).toFixed(1),
    jsKB: (Buffer.byteLength(js.join('')) / 1024).toFixed(1),
  });
}

/* ---------------------------------------------------------------------------
 * 5. Report
 * ------------------------------------------------------------------------- */

console.log('\nPAGES');
console.table(report.pages);

console.log('\nSHARED BLOCKS REMOVED (replaced by one module each)');
for (const [target, sources] of Object.entries(report.sharedRemoved)) {
  console.log(`  ${target}`);
  sources.forEach((s) => console.log(`      ${s}`));
}

console.log('\nDEAD CODE REMOVED');
report.deadRemoved.forEach((d) => console.log(`  ${d}`));

console.log('\nNOTE: main.js for each page is hand-written, not generated —');
console.log('      it is where the import order is decided.\n');
