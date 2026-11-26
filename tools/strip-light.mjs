/* strip-light.mjs - removes light-theme-only CSS (the dashboard is dark only).
   A selector that can only match in light mode is dropped; a rule whose
   selectors are all dropped is removed; @media (prefers-color-scheme: light)
   blocks are removed. Negations such as :not([data-theme="light"]) are kept,
   since they always match now and carry specificity the new design relies on.
   Usage: node tools/strip-light.mjs [--dry] */
import fs from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const LIGHT = /\[data-theme=["']?light["']?\]|\.lt(?![-\w])|\bhtml\.light(?![-\w])|\bbody\.light(?![-\w])/;

/* drop every :not(...) (balanced) before testing, so a negation never counts */
function stripNots(sel) {
  let out = '', i = 0;
  while (i < sel.length) {
    if (sel.startsWith(':not(', i)) {
      let depth = 0, j = i + 4;
      for (; j < sel.length; j++) { if (sel[j] === '(') depth++; else if (sel[j] === ')') { depth--; if (!depth) break; } }
      i = j + 1;
    } else out += sel[i++];
  }
  return out;
}
const lightOnly = (sel) => LIGHT.test(stripNots(sel));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else if (e.name.endsWith('.css')) acc.push(p);
  }
  return acc;
}
const files = ['game-analytics', 'src/shared/styles', 'reports'].flatMap((d) => walk(resolve(ROOT, d)));

let totalRules = 0, totalSel = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const ast = postcss.parse(src);
  let rules = 0, sels = 0;
  ast.walkAtRules('media', (at) => { if (/prefers-color-scheme:\s*light/.test(at.params)) { at.remove(); rules++; } });
  ast.walkRules((rule) => {
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
    const keep = rule.selectors.filter((s) => !lightOnly(s));
    if (keep.length === rule.selectors.length) return;
    sels += rule.selectors.length - keep.length;
    if (!keep.length) { rule.remove(); rules++; } else rule.selectors = keep;
  });
  /* an @media left empty by the removals goes too */
  ast.walkAtRules('media', (at) => { if (!at.nodes || !at.nodes.length) at.remove(); });
  if (rules || sels) {
    console.log(`${relative(ROOT, f).padEnd(44)} rules removed ${String(rules).padStart(3)}  selectors removed ${sels}`);
    totalRules += rules; totalSel += sels;
    if (!DRY) fs.writeFileSync(f, ast.toString());
  }
}
console.log(`${DRY ? '[dry run] ' : ''}total: ${totalRules} rules, ${totalSel} selectors`);
