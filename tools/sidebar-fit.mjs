/* sidebar-fit.mjs - does the hub sidebar fit without scrolling?
   Serves dist/ with vite preview, fakes a session so the shell shows, and
   measures the sidebar at common window heights, expanded and collapsed.
   Run after `npm run build`:  node tools/sidebar-fit.mjs */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4181;
const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, shell: true });
await new Promise(r => setTimeout(r, 3500));

const browser = await chromium.launch({ channel: 'msedge' });
let fail = 0;
try {
  for (const h of [720, 800, 900, 1000]) {
    for (const collapsed of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: h } });
      await page.addInitScript(([c]) => {
        sessionStorage.setItem('mss3d_token', 'x.y.z');
        if (c) localStorage.setItem('sbCollapsed', '1');
      }, [collapsed]);
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const r = await page.evaluate((c) => {
        /* without data the nav is never built, so draw the real one's markup:
           8 groups, 16 pages, as an admin sees it (Alerts is last) */
        const nav = document.getElementById('sbNav');
        if (nav && !nav.children.length) {
          const G = [['Dashboard',['Overview','Executive']],['Growth',['Growth']],
            ['Player Metrics',['Retention','Engagement','FTUE Funnel']],['Gameplay',['Progress Events']],
            ['App Health',['Stability']],
            ['Reports',['Negative Spend','UA Report','Monetization','Life Time','ASO','Creative']],
            ['Config',['Thresholds','User Management']],
            ['Data',['Alerts']]];
          const ico = '<svg width="17" height="17" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16"/></svg>';
          nav.innerHTML = G.map(([g, items]) => '<div class="sb-section">' + g + '</div>' +
            items.map(l => '<div class="nav-item">' + ico + '<span class="nav-lbl">' + l + '</span></div>').join('')).join('');
        }
        if (c) document.body.classList.add('sb-collapsed');
        const sb = document.querySelector('.sidebar');
        return { client: sb.clientHeight, scroll: sb.scrollHeight,
                 items: document.querySelectorAll('.sidebar .nav-item').length };
      }, collapsed);
      const ok = r.scroll <= r.client + 1;
      if (!ok) fail++;
      console.log(`${ok ? 'FITS ' : 'SCROLL'}  h=${h} ${collapsed ? 'collapsed' : 'expanded '}  items=${r.items}  content=${r.scroll}px  window=${r.client}px`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  // shell:true wraps vite in a shell; kill the whole tree or the port stays taken
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']);
  else server.kill();
}
process.exit(fail ? 1 : 0);
