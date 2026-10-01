import { chromium } from 'playwright';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 945, height: 744 } });
await pg.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(900);
console.log(await pg.evaluate(() => {
  const s = [...document.querySelectorAll('.slide')].filter(x => x.getBoundingClientRect().height > 0)[0];
  if (!s) return 'no visible slide';
  const cs = getComputedStyle(s), L = [];
  L.push(`slide height ${Math.round(s.getBoundingClientRect().height)}  padding ${cs.paddingTop}/${cs.paddingBottom}`);
  [...s.children].forEach(c => {
    const r = c.getBoundingClientRect(), k = getComputedStyle(c);
    L.push(`  > ${c.className||c.tagName}  h ${Math.round(r.height)}  display ${k.display}  pad ${k.paddingTop}/${k.paddingBottom}  margin ${k.marginTop}/${k.marginBottom}`);
  });
  const sb = s.querySelector(':scope > .sb');
  if (sb) {
    const k = getComputedStyle(sb);
    let sum = 0;
    [...sb.children].forEach(c => {
      const r = c.getBoundingClientRect(), m = getComputedStyle(c);
      sum += r.height;
      L.push(`     .sb > ${String(c.className||c.tagName).slice(0,24)}  h ${Math.round(r.height)}  margin ${m.marginTop}/${m.marginBottom}`);
    });
    L.push(`     .sb height ${Math.round(sb.getBoundingClientRect().height)}  padding ${k.paddingTop}/${k.paddingBottom}  children ${Math.round(sum)}`);
    L.push(`     => padding accounts for ${parseFloat(k.paddingTop)+parseFloat(k.paddingBottom)}px of the slack`);
  }
  return L.join('\n');
}));
await b.close();
