/* report-shot.mjs - screenshot a report page without data (loader hidden).
   After `npm run build`: node tools/report-shot.mjs <report-dir> <out.png> */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv[2] || 'ua';
const OUT = process.argv[3] || resolve(ROOT, REPORT + '-shot.png');
const PORT = 4183;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.addInitScript(() => sessionStorage.setItem('mss3d_token', 'x.y.z'));
  await page.goto(`http://localhost:${PORT}/reports/${REPORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('body *').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && el.offsetWidth > 600 && el.offsetHeight > 400) el.style.display = 'none';
    });
    const sample = ['$235.9K', '$73.0K', '31.0%', '1.14M', '$0.21', '4.18'];
    document.querySelectorAll('.kpi > .v, .kpi-card > .kpi-value').forEach((v, i) => {
      if (/^[—-]?$/.test(v.textContent.trim())) v.textContent = sample[i % sample.length];
      /* sample series so the wave can be checked without data */
      v.parentElement.setAttribute('data-spark-dates', Array.from({length:14},(_,k)=>'2026-11-'+String(k+2).padStart(2,'0')).join(','));
      v.parentElement.setAttribute('data-spark', [5,7,6,9,8,11,10,13,12,15,14,13,16,18].map(x => x + (i * 3) % 7).join(','));
    });
  });
  await page.waitForTimeout(500);
  /* hover the second card's graph, as a person would */
  const box = (await page.$$('.pro-spark')) || [];
  if (box[1]) { const b = await box[1].boundingBox(); await page.mouse.move(b.x + 20, b.y + 10); await page.mouse.move(b.x + b.width * 0.62, b.y + b.height / 2, { steps: 5 }); await page.waitForTimeout(400); }
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1500, height: 420 } });
  console.log('saved ' + OUT);
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill();
  setTimeout(() => process.exit(0), 500);
}
