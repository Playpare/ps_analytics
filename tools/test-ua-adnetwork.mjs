/**
 * ============================================================================
 * test-ua-adnetwork.mjs — the ad network cards on the UA platform slides
 * ============================================================================
 *
 *   node tools/test-ua-adnetwork.mjs
 *
 * Everything here is read out of the shipped files rather than copied, for the
 * reason every test in this project is written that way: a copy keeps passing
 * after the shipped version has drifted away from it.
 *
 * WHAT IS ACTUALLY AT RISK HERE
 *
 * The UA table renderer picks its formatting from the COLUMN NAME. That is
 * convenient and it sets one specific trap:
 *
 *     /roas|retention|share|rate/  ->  printed as (v * 100) + '%'
 *
 * The backend reports fill rate as 94.2, already a percentage. Handing that
 * straight to a column called `fill_rate` prints 9420.0%.
 *
 * Which is, on reflection, the harmless version of the fault - 9420% is
 * obviously broken and somebody says so within a day. The dangerous direction
 * is the correction being lost later: if someone removes the `/ 100` because
 * "the backend already gives a percentage", the cell prints 0.9% and that
 * looks like a plausible, terrible fill rate. Nobody queries a believable
 * number. So the division is pinned here, in both directions.
 *
 * eCPM is the quieter one. 'ecpm' matched none of formatCell's money patterns
 * - 'ecpi' is a different string - so dollars printed as a bare 3.05, and a
 * column of bare numbers beside a column of dollars invites exactly the wrong
 * comparison.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const js   = readFileSync(join(ROOT, 'reports/ua/ua.legacy.js'), 'utf8');
const html = readFileSync(join(ROOT, 'reports/ua/index.html'), 'utf8');

let bad = 0, n = 0;
const ok = (label, got, want) => {
  n++;
  if (got !== want) {
    bad++;
    console.log(`  FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};
const truthy = (label, got) => {
  n++;
  if (!got) { bad++; console.log(`  FAIL  ${label}`); }
};

/* ---- lift the real formatters out of the shipped file -------------------- */

/* Named one by one rather than by a line range, so a reorder of the file does
   not quietly change what is under test. A missing name throws. */
function lift(name, pattern) {
  const m = js.match(pattern);
  if (!m) {
    throw new Error(`test-ua-adnetwork: could not find ${name} in ua.legacy.js `
      + `- it moved or was renamed, fix the pattern here rather than deleting the test`);
  }
  return m[0];
}

const pieces = [
  lift('tableMoney',      /^const tableMoney=.*$/m),
  lift('dateVal',         /^const dateVal=.*$/m),
  lift('shortDate',       /^function shortDate\(v\).*$/m),
  lift('LABEL_OVERRIDES', /^const LABEL_OVERRIDES=.*$/m),
  lift('label',           /^function label\(s\)\{const k=.*$/m),
  lift('formatCell',      /^function formatCell\(k,v\).*$/m)
].join('\n');

const F = {};
new Function('F', pieces + '\nObject.assign(F, { formatCell, label, tableMoney });')(F);
const { formatCell, label } = F;

/* ---- the test can fail --------------------------------------------------- */

/* A test that cannot fail proves nothing. Before asserting anything about the
   real code, the harness is checked against a deliberately wrong formatter. */
const G = {};
new Function('G', pieces.replace("key==='ecpm'||", '')
  + '\nObject.assign(G, { formatCell });')(G);
truthy('the harness would notice the eCPM fix being removed',
  G.formatCell('ecpm', 3.05) !== formatCell('ecpm', 3.05));

/* ---- fill rate: a fraction in, a percentage out -------------------------- */

ok('fill_rate 0.942 prints as 94.2%',   formatCell('fill_rate', 0.942), '94.2%');
ok('fill_rate 1 prints as 100.0%',      formatCell('fill_rate', 1),     '100.0%');
ok('fill_rate 0 prints as 0.0%',        formatCell('fill_rate', 0),     '0.0%');
ok('fill_rate null prints as a dash',   formatCell('fill_rate', null),  '-');

/* The trap, asserted so that it is documented behaviour rather than a
   surprise: the backend's own 94.2, passed through unconverted, is nonsense.
   renderAdNetworks divides by 100 for exactly this reason. */
ok('an unconverted 94.2 would print 9420.0%', formatCell('fill_rate', 94.2), '9420.0%');

/* And the believable-wrong direction. 0.942 was the backend value divided by
   100 twice - the shape of someone "fixing" the conversion by removing it
   while the backend still sends a percentage. */
ok('a double-divided 0.00942 would print 0.9%', formatCell('fill_rate', 0.00942), '0.9%');

/* ---- eCPM is money ------------------------------------------------------- */

ok('ecpm 3.05 carries a currency symbol', formatCell('ecpm', 3.05), '$3.1');
/* "$0.0" rather than "$0": tableMoney sets maximumFractionDigits to 1, which
   clamps the currency style's default MINIMUM of 2 down to 1 instead of to 0.
   This expectation was wrong on the first run and the test caught it, which is
   the more useful demonstration that it is reading the real formatter. */
ok('ecpm 0 is still money, not a dash',   formatCell('ecpm', 0),    '$0.0');
ok('ecpm null prints as a dash',          formatCell('ecpm', null), '-');

/* ecpi must keep working - it was in that branch before ecpm was added. */
ok('ecpi still formats as money', formatCell('ecpi', 1.5), '$1.5');

/* ---- headers ------------------------------------------------------------- */

ok('ecpm heads as eCPM, not Ecpm',  label('ecpm'),      'eCPM');
ok('fill_rate heads as Fill Rate',  label('fill_rate'), 'Fill Rate');
/* The override map must not have changed every other header on the report. */
ok('network is untouched',          label('network'),     'Network');
ok('impressions is untouched',      label('impressions'), 'Impressions');
ok('all_revenue is untouched',      label('all_revenue'), 'All Revenue');

/* ---- the renderer does divide -------------------------------------------- */

/* Comments are stripped first. A text check that matches the prose explaining
   the rule, rather than the rule, is a test that passes on deleted code - that
   has happened in this project before. */
const code = js
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

truthy('renderAdNetworks converts fillRate to a fraction',
  /num\(n\.fillRate\)\s*\/\s*100/.test(code));
truthy('renderAdNetworks is called for each platform',
  /renderAdNetworks\(p\)/.test(code));
truthy('the fetch names the adNetworks action',
  /action=adNetworks/.test(code));
truthy('the platform maps to a gameId',
  /mss_ios/.test(code) && /mss_android/.test(code));
truthy('both window dates are sent together or not at all',
  /win \? 'from=/.test(code) && /win \? 'to=/.test(code));

/* ---- the cards exist on both slides -------------------------------------- */

for (const plat of ['android', 'ios']) {
  truthy(`${plat} has an ad network pie canvas`,  html.includes(`id="${plat}AdNetPie"`));
  truthy(`${plat} has a pie box to write into`,   html.includes(`id="${plat}AdNetBox"`));
  truthy(`${plat} has an ad network table`,       html.includes(`id="${plat}AdNetTable"`));

  /* Placement is the request: below Spend Share and IAP Revenue Share, not
     above them and not on a slide of its own. */
  const iShare = html.indexOf(`id="${plat}IapNetworkShare"`);
  const iTable = html.indexOf(`id="${plat}AdNetTable"`);
  truthy(`${plat} cards sit after the two share pies`, iShare > -1 && iTable > iShare);
}

/* ---- failure is visible in both cards ------------------------------------ */

/* An error in the table with an empty circle above it reads as "no ad
   revenue", which is a different statement from "this did not load". */
truthy('a failure writes into the pie box as well as the table',
  /function adNetFail[\s\S]{0,400}AdNetBox[\s\S]{0,400}AdNetTable/.test(code));
truthy('the canvas is restored before drawing after a failure',
  /function adNetCanvas[\s\S]{0,300}<canvas id="/.test(code));

/* ---- result -------------------------------------------------------------- */

console.log('');
console.log(bad
  ? `  ua ad networks: ${bad} of ${n} FAILED`
  : `  ua ad networks: all ${n} passed`);
console.log('');
process.exit(bad ? 1 : 0);
