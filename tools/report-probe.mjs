/* report-probe.mjs - print header element boxes for a report (debug aid).
   node tools/report-probe.mjs <report-dir> */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = process.argv[2] || 'aso';
const PORT = 4184;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.addInitScript(() => sessionStorage.setItem('mss3d_token', 'x.y.z'));
  await page.goto(`http://localhost:${PORT}/reports/${REPORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const sel = ['.top', '.top .tabs', '.top .connect', '.top .brand', '#tabnav', '.view.active .sh', '.view.active .sh .brand',
      '.view.active .sh .date', '.view.active .date-controls', '.view.active .sh .date-controls', '.view.active .slide'];
    return sel.map(s => { const e = document.querySelector(s); if (!e) return s + ': -';
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return `${s}: x${Math.round(r.x)} y${Math.round(r.y)} w${Math.round(r.width)} h${Math.round(r.height)} pos=${cs.position} disp=${cs.display} bb=${cs.borderBottomWidth} ${cs.borderBottomColor}`; });
  });
  console.log(out.join('\n'));
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill();
  setTimeout(() => process.exit(0), 500);
}
