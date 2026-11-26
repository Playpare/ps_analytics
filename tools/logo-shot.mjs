/* logo-shot.mjs - screenshot the hub sidebar logo (sign-in screen bypassed for the picture only) */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const PORT = 4188;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = ''; });
  await page.waitForTimeout(800);
  if (process.argv[3] === 'collapsed') { await page.evaluate(() => document.body.classList.add('sb-collapsed')); await page.waitForTimeout(400); }
  await page.screenshot({ path: process.argv[2], clip: { x: 0, y: 0, width: 240, height: 70 } });
  console.log('saved');
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill();
  setTimeout(() => process.exit(0), 500);
}
