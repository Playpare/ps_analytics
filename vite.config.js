import { defineConfig, loadEnv } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const at = (...p) => resolve(root, ...p);

/**
 * Inlines src/shared/theme-boot.js into every document's <head>, replacing the
 * <!--THEME_BOOT--> marker the migration left there.
 *
 * It cannot be a normal import. Module scripts are deferred, so a theme
 * applied from src/shared/theme.js lands one frame after the first paint and
 * anyone on the light theme sees a flash of black first. It cannot be a hand
 * written inline script either, because then it would be six copies again -
 * which is the state this whole repository exists to get out of. One source
 * file, substituted at build time, is the way to have both.
 */
function themeBoot() {
  const src = readFileSync(at('src/shared/theme-boot.js'), 'utf8');
  // Strip the explanatory header; the HTML gets the code, the file keeps the why.
  const code = src.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
  return {
    name: 'ps-theme-boot',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(
          '<!--THEME_BOOT-->',
          `<script>${code}</script>`
        ),
    },
  };
}

/** Short, stable, and different on every deploy — used to bust HTML caches. */
function buildId() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

/**
 * Multi-page build.
 *
 * The hub is the root document; each report is its own page under /reports/.
 * They are separate documents on purpose and not a single-page app: the hub
 * loads them into iframes, and that iframe boundary is what keeps one report's
 * 200 KB of chart building from janking whichever report the user is actually
 * looking at. Rollup still hoists what they share — the theme sync, the
 * snapshot cache, Chart.js — into one chunk every page gets from cache.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'VITE_');

  return {
    base: env.VITE_BASE || './',

    plugins: [themeBoot()],

    define: {
      'import.meta.env.VITE_BUILD_ID': JSON.stringify(env.VITE_BUILD_ID || buildId()),
    },

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // The reports are heavy by nature; the warning adds nothing but noise.
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        input: {
          // The root IS the shell now. The hub that used to live here listed
          // four reports and signed people in; the shell does both, plus the
          // game sections, from one nav - so keeping the hub would have meant
          // two front doors to the same system.
          shell: at('index.html'),
          ua: at('reports/ua/index.html'),
          weekly: at('reports/weekly/index.html'),
          tilldate: at('reports/till-date/index.html'),
          aso: at('reports/aso/index.html'),
          negative: at('reports/negative-spend/index.html'),
        },
      },
    },

    server: { port: 5173, open: true },
    preview: { port: 4173 },
  };
});
