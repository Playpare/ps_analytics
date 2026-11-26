/* overview-shot.mjs - screenshot the Overview KPI tiles with sample markup
   (no data needed). Run after `npm run build`: node tools/overview-shot.mjs <out.png> */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || resolve(ROOT, 'overview-shot.png');
const TAB = process.argv[3] || 'overview';   // any hub page id, e.g. retention
const PORT = 4182;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(() => sessionStorage.setItem('mss3d_token', 'x.y.z'));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate((TAB) => {
    const card = (cls, lbl, val, tr, good) => `<div class="kpi has-spark ${cls}"><div class="kpi-text">
      <div class="kpi-label">${lbl}</div><div class="kpi-val">${val}</div>
      <div class="kpi-trend ${good ? 'good' : 'bad'}">${good ? '▲' : '▼'} ${tr}% <span>vs first half</span></div>
      <div class="kpi-bottom"><span class="kpi-sub">x</span></div></div>
      <div class="kpi-spark-box"><svg viewBox="0 0 100 40" preserveAspectRatio="none" style="width:100%;height:100%">
      <path d="M0 32 C15 30 25 36 40 30 S65 20 75 26 S90 8 100 12 L100 40 L0 40Z" fill="currentColor" opacity=".18"/>
      <path d="M0 32 C15 30 25 36 40 30 S65 20 75 26 S90 8 100 12" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></div></div>`;
    /* no data: hide the loading veil that covers the page */
    document.querySelectorAll('body *').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && /Loading/i.test(el.textContent || '') && el.offsetWidth > 600) el.style.display = 'none';
    });
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('on'));
    document.getElementById('tab-' + TAB).classList.add('on');
    if (TAB !== 'overview') { const gr = document.querySelector('#tab-' + TAB + ' .kpi-grid'); if (gr) gr.id = 'heroKpis'; }
    document.getElementById('heroKpis').innerHTML = [
      card('cy','Installs','1.14M','5.7',1), card('mg','Active Users','1.20M','0.9',1), card('vl','D1 Retention','29.4%','0.6',0),
      card('lm','D0 Playtime','947s','2.3',0), card('am','Sessions / User','3.21','0.9',0), card('co','FTUE Complete','3.7%','1.2',1)].join('');
    if (document.getElementById('heroKpis2') && TAB === 'overview') document.getElementById('heroKpis2').innerHTML = [
      card('lm','Revenue','$73.0K','2.5',0), card('cy','ARPDAU','$0.0051','11.4',0), card('vl','ARPPU','$8.65','27.4',0),
      card('mg','Payer Conv.','0.052%','30.1',0), card('am','Ad / IAP Share','58% / 42%','2.7',1), card('co','UA Spend','$235.9K','7.0',0)].join('');
    if (TAB === 'overview') document.getElementById('ovRetStats').innerHTML = ['D1|29.4%','D7|6.2%','D14|—'].map(s => {
      const [k, v] = s.split('|'); return `<div class="stat"><div class="stat-lbl">${k}</div><div class="stat-val">${v}</div></div>`; }).join('');
    document.querySelectorAll('.kpi-spark-box').forEach(b => b.style.color = getComputedStyle(b.closest('.kpi')).getPropertyValue('--kc'));
  }, TAB);
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1600, height: 900 } });
  console.log('saved ' + OUT);
} finally {
  await browser.close();
  // shell:true wraps vite in a shell; kill the whole tree or it keeps running
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill();
  setTimeout(() => process.exit(0), 500);
}
