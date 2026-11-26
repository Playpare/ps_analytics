/* exec-shot.mjs - screenshot the Executive page with sample numbers (no data).
   After `npm run build`: node tools/exec-shot.mjs <out.png> */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const PORT = 4187;
const OUT = process.argv[2] || 'exec-shot.png';
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(`http://localhost:${PORT}/reports/exec/${process.argv[3] === 'embedded' ? '#embedded' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('body > *').forEach(el => { if (el.id !== 'app' && getComputedStyle(el).position === 'fixed') el.style.display = 'none'; });
    const app = document.getElementById('app'); if (app) app.style.display = 'block';
    if (location.hash === '#embedded') document.documentElement.classList.add('exec-embedded');
    [['kRevVal','$1.24M'],['kSpdVal','$842.6K'],['kProVal','$401.3K'],['kRoiVal','1.47x']].forEach(([id, v]) => { const e = document.getElementById(id); if (e) e.textContent = v; });
    [['kRevChg','▲ 6.2%'],['kSpdChg','▼ 2.1%'],['kProChg','▲ 9.4%'],['kRoiChg','▲ 3.0%']].forEach(([id, v]) => { const e = document.getElementById(id); if (e) e.textContent = v; });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT });
  console.log('saved ' + OUT);
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill();
  setTimeout(() => process.exit(0), 500);
}
