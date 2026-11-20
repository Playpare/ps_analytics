/**
 * The US section, from the payload to the card.
 *
 * normalizeSheetData is a WHITELIST. A section the backend adds and that
 * function does not name is dropped on the way in, and the tab that draws it
 * shows its empty state instead of an error - the quietest failure this file
 * can produce, and the one that cost three months on FirstPayers. So the
 * first test here runs the real function rather than reading it.
 *
 * The rest guard the caveat. GA4's US buyer figures were reported as wrong on
 * 29 Oct 2026, ARPPU and the buyer rate divide by them, and a number shown
 * without its doubt is a number somebody will act on.
 */
import { readFileSync } from 'node:fs';

const SRC = readFileSync(
  'C:/Users/PS/Documents/ps-analytics/game-analytics/game-analytics.legacy.js', 'utf8');

let bad = 0, n = 0;
const ok = (l, c, d) => {
  n++;
  if (!c) { bad++; console.log('  FAIL ' + l + (d !== undefined ? ': ' + JSON.stringify(d) : '')); }
};

console.log('\n  Growth — the United States block');
console.log('  ' + '-'.repeat(64));

/* ── normalizeSheetData actually run ─────────────────────────────────── */
{
  const start = SRC.indexOf('function normalizeSheetData(');
  const end = SRC.indexOf('\nfunction ', start + 10);
  const body = SRC.slice(start, end);

  /* It calls a few helpers for other sections; stubbed so the function can be
     evaluated on its own. None of them touches `us`. */
  const stubs = {
    expandPayload: (x) => x,
    applySheetThresholds: () => {},
    coerceDaily: (x) => x
  };
  const names = Object.keys(stubs);
  const fn = new Function(...names, body + '; return normalizeSheetData;')
    (...names.map(k => stubs[k]));

  const out = fn({
    meta: { generatedAt: '2026-10-29T00:00:00Z' },
    daily: [],
    us: { rows: [{ date: '2026-10-01', revenueUsd: 100 }], totals: { revenueUsd: 100 },
          buyersVerified: false, buyersNote: 'x', notes: [], sources: {} }
  });

  ok('the US section survives normalizeSheetData', out.us != null, out.us);
  ok('and arrives whole, not flattened',
    out.us && out.us.totals && out.us.totals.revenueUsd === 100, out.us && out.us.totals);
  ok('the caveat flag survives too',
    out.us && out.us.buyersVerified === false, out.us && out.us.buyersVerified);

  const none = fn({ meta: {}, daily: [] });
  ok('a payload with no US section gives null, not an empty object',
    none.us === null, none.us,
    'an empty object would make a missing workbook id look like a quiet fortnight');
}

/* ── the caveat reaches the screen ───────────────────────────────────── */
ok('the unreconciled banner is rendered from the flag, not hardcoded on',
  /if\(us && !us\.buyersVerified\)/.test(SRC));
ok('and it prints the backend\'s own reason',
  /String\(us\.buyersNote \|\| ''\)/.test(SRC));
ok('both cards that divide by buyers carry the word',
  (SRC.match(/usSub\('/g) || []).length === 2,
  (SRC.match(/usSub\('/g) || []).length);
ok('usSub appends "unverified" only when the flag is false',
  /usOk \? t : t \+ ' \\u00b7 unverified'/.test(SRC));

/* ── the things that are wrong in silence ────────────────────────────── */
ok('ARPPU is withheld rather than drawn as zero',
  /usTot\.arppu!=null \? fmtMoney\(usTot\.arppu, 2\) : '\\u2014'/.test(SRC));
ok('so is the buyer rate',
  /usTot\.buyerRate!=null \?/.test(SRC));
ok('a day with no buyer row is skipped, not read as zero buyers',
  /r\.buyers>0/.test(SRC) && /r\.buyers!=null/.test(SRC));

/* Two scales on one axis is the chart mistake that makes any two series
   look like they agree. Revenue and buyers are drawn separately. */
ok('revenue and buyers are two charts, not two axes',
  /cvGrowthUsRev/.test(SRC) && /cvGrowthUsBuyers/.test(SRC));
ok('neither declares a second y-axis',
  !/y1\s*:/.test(SRC.slice(SRC.indexOf('cvGrowthUsRev'))),
  'a second y-axis lets any pair of series be drawn as agreeing');

/* ── the empty states say which emptiness it is ──────────────────────── */
ok('"no section" and "no rows" are told apart',
  /us \? 'No US revenue rows in this range'\s*\n?\s*: 'The payload carries no US section'/.test(SRC));

/* ── the markup the renderer writes into ─────────────────────────────── */
{
  const HTML = readFileSync('C:/Users/PS/Documents/ps-analytics/index.html', 'utf8');
  ['growthUsNote', 'growthUsKpis', 'cvGrowthUsRev', 'cvGrowthUsBuyers'].forEach(id => {
    ok('index.html has #' + id, HTML.includes('id="' + id + '"'));
  });
  ok('the spark prefix is not one already in use',
    !/paintKpis\('growth(Acq|Mon)Kpis2?', [a-zA-Z0-9]+, 'gke'\)/.test(SRC)
    && /paintKpis\('growthUsKpis', usKpis, 'gke'\)/.test(SRC),
    'two card rows sharing a prefix overwrite each other\'s sparkline canvases');
}

console.log(`  ${n - bad}/${n} passed${bad ? `  (${bad} FAILED)` : ''}\n`);
process.exit(bad ? 1 : 0);
