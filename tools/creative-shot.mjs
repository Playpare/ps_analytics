/* creative-shot.mjs - screenshot the Creative header (no data).
   After `npm run build`: node tools/creative-shot.mjs <out-dir> */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const PORT = 4189;
const OUT = process.argv[2] || ROOT;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: Number(process.argv[3]) || 1840, height: 400 } });
  await page.goto(`http://localhost:${PORT}/reports/creative/`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('#loadProgress, #bootOverlay, [id*=auth i], [class*=auth i], [id*=login i], [class*=gate i]').forEach(a => a.style.display = 'none');
    const shell = document.querySelector('.app-shell'); if (shell) shell.style.display = '';
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/creative-head.png` });
  console.log('saved');
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill();
  setTimeout(() => process.exit(0), 500);
}
