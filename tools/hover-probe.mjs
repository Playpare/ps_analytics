/* hover-probe.mjs - debug the report card hover (sample series) */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const PORT = 4186;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => sessionStorage.setItem('mss3d_token', 'x.y.z'));
  await page.goto(`http://localhost:${PORT}/reports/ua/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelectorAll('.kpi').forEach(k => { k.setAttribute('data-spark-dates', '2026-11-02,2026-11-03,2026-11-04,2026-11-05,2026-11-06,2026-11-07,2026-11-08,2026-11-09'); k.setAttribute('data-spark', '5,7,6,9,8,11,10,13'); }));
  await page.waitForTimeout(500);
  console.log(await page.evaluate(() => {
    const b = document.querySelector('.pro-spark'); if (!b) return 'no .pro-spark';
    const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
    const at = document.elementFromPoint(r.left + r.width * .6, r.top + r.height / 2);
    return `box ${Math.round(r.width)}x${Math.round(r.height)} pe=${cs.pointerEvents} top-el=${at && (at.className.baseVal ?? at.className)} tag=${at && at.tagName}`;
  }));
  const b = await (await page.$('.pro-spark')).boundingBox();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: process.argv[2] || 'hover.png', clip: { x: 0, y: 60, width: 760, height: 320 } });
  console.log(await page.evaluate(() => { const t = document.getElementById('proSparkTip'); return t ? 'tip ' + getComputedStyle(t).opacity + ' ' + t.textContent : 'no tip'; }));
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill();
  setTimeout(() => process.exit(0), 500);
}
