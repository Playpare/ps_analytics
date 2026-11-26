/* loader-shot.mjs - screenshot every page's loading screen (forced visible).
   After `npm run build`: node tools/loader-shot.mjs <out-dir> */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const PORT = 4190;
const OUT = process.argv[2] || ROOT;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
const pages = [
  ['negative', '/reports/negative-spend/', () => { const l = document.getElementById('loader'); l.classList.add('show'); }],
  ['open', '/reports/ua/', () => { if (!document.getElementById('bootOverlay')) document.body.insertAdjacentHTML('beforeend', '<div id="bootOverlay"></div>'); }],
  ['boot', '/', () => { const ls = document.getElementById('loginScreen'); if (ls) ls.style.display = 'none';
      if (!document.getElementById('bootOverlay')) document.body.insertAdjacentHTML('afterbegin', '<div id="bootOverlay"></div>'); }],
  ['creative', '/reports/creative/', () => { document.querySelectorAll('[id*=auth i], [class*=auth i], #loginScreen').forEach(a => a.style.display = 'none');
      const b = document.getElementById('loadProgress'); document.body.appendChild(b); b.classList.add('show'); b.style.setProperty('--pl-real', '63'); }],
  ['hub', '/', () => { const el = document.createElement('div'); el.id = 'loadingOverlay';
      el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#000';
      el.innerHTML = '<div>old spinner</div>'; const ls = document.getElementById('loginScreen'); if (ls) ls.style.display = 'none'; document.body.appendChild(el); }],
  ['exec', '/reports/exec/', () => { document.querySelectorAll('#authGate, .authGate').forEach(a => a.style.display = 'none'); const l = document.getElementById('loader'); l.style.display = 'flex'; }],
  ['ua', '/reports/ua/', () => { const l = document.getElementById('loader'); l.classList.add('show'); }],
  ['aso', '/reports/aso/', () => { const l = document.getElementById('loader'); l.classList.add('show'); }],
  ['weekly', '/reports/weekly/', () => { if (!document.getElementById('uaLoader')) document.body.insertAdjacentHTML('beforeend', '<div id="uaLoader"><div class="lbox"><div class="spin"></div><b>Loading Data</b><div class="pulse"></div></div></div>'); document.body.classList.remove('live-error'); document.body.classList.add('live-busy'); }],
];
try {
  for (const [name, path, show] of pages) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
    await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.evaluate(show);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/loader-${name}.png` });
    console.log('saved', name);
    await page.close();
  }
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill();
  setTimeout(() => process.exit(0), 500);
}
