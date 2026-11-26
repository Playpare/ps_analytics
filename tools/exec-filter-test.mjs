/* exec-filter-test.mjs - clicks the Executive game / platform dropdowns and
   checks the page's own select changes and its change listener fires. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'); const PORT = 4189;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
let fail = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`http://localhost:${PORT}/reports/exec/#embedded`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('body > *').forEach(el => { if (el.id !== 'app' && getComputedStyle(el).position === 'fixed') el.style.display = 'none'; });
    document.getElementById('app').style.display = 'block';
    document.documentElement.classList.add('exec-embedded');
    /* options as the page fills them once data loads */
    document.getElementById('fGame').innerHTML = '<option value="">🎮 All Games</option><option value="MSS">MSS</option><option value="Legacy">Legacy</option>';
    document.getElementById('fPlat').innerHTML = '<option value="">📱 All Platforms</option><option value="Android">Android</option><option value="iOS">iOS</option>';
    window.__changes = [];
    ['fGame', 'fPlat'].forEach(id => document.getElementById(id).addEventListener('change', e => window.__changes.push(id + '=' + e.target.value)));
  });
  await page.waitForTimeout(500);
  for (const [id, label] of [['fGame', 'MSS'], ['fPlat', 'iOS']]) {
    const dd = page.locator(`#${id}`).locator('xpath=preceding-sibling::div[contains(@class,"dd")][1]');
    await dd.locator('.dd-btn').click();
    await page.waitForTimeout(250);
    const item = dd.locator('.dd-it', { hasText: label });
    const visible = await item.isVisible();
    if (!visible) { console.log(`FAIL ${id}: menu item "${label}" not visible`); fail++; continue; }
    await item.click();
    await page.waitForTimeout(200);
    const v = await page.evaluate(i => document.getElementById(i).value, id);
    const btn = (await dd.locator('.dd-lbl').textContent()).trim();
    console.log(`${v === label ? 'PASS' : 'FAIL'} ${id}: select=${v} button="${btn}"`);
    if (v !== label) fail++;
  }
  console.log('change events:', await page.evaluate(() => window.__changes.join(', ')));
} finally {
  await browser.close();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']); else server.kill();
  setTimeout(() => process.exit(fail ? 1 : 0), 500);
}
