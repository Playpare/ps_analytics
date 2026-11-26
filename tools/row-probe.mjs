/* row-probe.mjs - list the visible elements in the band y=60..120 of a report (debug aid) */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv[2]; const PORT = 4185;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.addInitScript(() => sessionStorage.setItem('mss3d_token', 'x.y.z'));
  await page.goto(`http://localhost:${PORT}/reports/${REPORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  console.log(await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.top >= 58 && r.bottom <= 125 && r.width > 300 && r.height > 30) {
        const cs = getComputedStyle(e);
        out.push(`${e.tagName.toLowerCase()}#${e.id}.${[...e.classList].join('.')} y${Math.round(r.top)} h${Math.round(r.height)} w${Math.round(r.width)} pos=${cs.position} parent=${e.parentElement.tagName.toLowerCase()}#${e.parentElement.id}.${[...e.parentElement.classList].join('.')}`);
      }
    });
    return out.slice(0, 12).join('\n');
  }));
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill();
  setTimeout(() => process.exit(0), 500);
}
