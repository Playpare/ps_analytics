/* logo-transparent.mjs - makes the Pulse logo's near-black background
   transparent (with smooth anti-aliased edges), via a browser canvas.
   node tools/logo-transparent.mjs <in.png> <out.png> */
import { chromium } from 'playwright';
import fs from 'node:fs';
const [, , IN, OUT] = process.argv;
const b64 = fs.readFileSync(IN).toString('base64');
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage();
  const out = await page.evaluate(async (src) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    const bg = [p[0], p[1], p[2]];                       // the corner pixel is the background
    for (let i = 0; i < p.length; i += 4) {
      /* alpha = how far this pixel is from the background colour; colour is
         un-blended from that background so edges stay clean on any backdrop */
      const dist = Math.max(Math.abs(p[i] - bg[0]), Math.abs(p[i + 1] - bg[1]), Math.abs(p[i + 2] - bg[2]));
      const a = Math.min(1, dist / 60);
      if (a <= 0) { p[i + 3] = 0; continue; }
      for (let k = 0; k < 3; k++) p[i + k] = Math.max(0, Math.min(255, Math.round((p[i + k] - bg[k] * (1 - a)) / a)));
      p[i + 3] = Math.round(a * 255);
    }
    x.putImageData(d, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, b64);
  fs.writeFileSync(OUT, Buffer.from(out, 'base64'));
  console.log('saved', OUT);
} finally { await browser.close(); }
