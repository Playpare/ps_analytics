/**
 * The Growth acquisition card.
 *
 * Organic was a subtraction of two sources, so it carried both their gaps
 * and showed neither: a day with no install count made it null, a day
 * Sheet1 had not reached made it equal the total, and nothing on the card
 * told either apart from a real fall in organic.
 */
import { readFileSync } from 'node:fs';
const SRC = readFileSync('C:/Users/PS/Documents/ps-analytics/game-analytics/game-analytics.legacy.js','utf8');
let bad=0,n=0;
const ok=(l,c,d)=>{n++;if(!c){bad++;console.log('  FAIL '+l+(d?': '+d:''));}};
console.log('\n  Growth — the installs card');
console.log('  '+'-'.repeat(64));

ok('the card is Total Installs', /lbl:'Total Installs'/.test(SRC));
ok('and Organic Installs is no longer a card',
   !/lbl:'Organic Installs'/.test(SRC));
ok('it shows the window total', /val: fmtKn\(totalInstalls\)/.test(SRC));
ok('it compares against the previous window',
   /cur: totalInstalls, prev: prevInstalls/.test(SRC),
   'the old card had prev: null, so the delta never moved');
ok('the subtitle says these are new users', /'new users \u00b7 '/.test(SRC));
ok('and how many days actually reported',
   /day\(s\) reported/.test(SRC),
   'a short window would otherwise read as a low total');

/* A missing day must stay a hole in the sparkline, not a zero. */
ok('a null install day is carried through as null',
   /x\.installs==null \? null : \+x\.installs\|\|0/.test(SRC),
   'coercing to 0 draws a real day at zero');

/* The split survives where it can be read. */
ok('the stacked chart still splits organic from paid',
   /label:'Organic', data:cur\.map\(x=>organicByDay\(x\.date\)\)/.test(SRC));
ok('organicByDay is still defined', /const organicByDay\s*=/.test(SRC));

/* Dead code. */
ok('organicTotal is gone from the code',
   (SRC.match(/organicTotal/g)||[]).length === 1,
   'only the note explaining its removal should remain');
ok('assistedTotal is gone too',
   (SRC.match(/assistedTotal/g)||[]).length === 1);
ok('but assistedByDay stays, because the chart needs it',
   (SRC.match(/assistedByDay/g)||[]).length >= 3);

console.log(`  ${n-bad}/${n} passed${bad?`  (${bad} FAILED)`:''}\n`);
process.exit(bad?1:0);
