# ps-analytics

The Playspare **MSS3D Monetization Hub** — a sign-in shell and five reports
drawn from Google Apps Script backends.

The hub is the only page anyone opens. It authenticates once, then loads each
report into an iframe on demand.

| Report | Path | Backend |
|---|---|---|
| UA | `/reports/ua/` | `VITE_API_UA` |
| Weekly | `/reports/weekly/` | `VITE_API_WEEKLY` |
| Till Date | `/reports/till-date/` | `VITE_API_TILLDATE` |
| ASO | `/reports/aso/` | `VITE_API_ASO` |
| UA Negative Spend | `/reports/negative-spend/` | `VITE_API_NEGATIVE` |

Negative Spend is not a hub tab: the UA report opens it in a nested iframe.

## Running it

```bash
npm install
cp .env.example .env.local     # then paste the real /exec URLs
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built output on :4173 |
| `npm run smoke` | Load all six built pages in Edge and fail on any uncaught error |
| `npm run smoke -- --url <base>` | Same checks against a deployed site |

`npm run smoke` needs a `dist/`, so run `npm run build` first. The `--url` form
does not — point it at the deployed site to check a release:

```bash
npm run smoke -- --url https://playpare.github.io/ps_analytics/
```

A local build passing and the deployed site working are different claims: the
base path, the asset URLs and the endpoints baked in from repository secrets
are all decided by the CI build, and none of them are exercised until
something loads the real thing.

## How it is put together

```
index.html              the hub document
main.js                 hub entry point
src/
  hub/                  hub logic and styles
  shared/
    config.js           endpoints, read from the build environment
    theme.js            the one theme, synced across hub and reports
    theme-boot.js       inlined into every <head> — see "Theme" below
    snapshot.js         IndexedDB cache + paint-first-verify-after boot
    chart.js            the single Chart.js instance
    styles/motion.css   button feedback, transitions, scrollbars
reports/<name>/
  index.html            markup
  main.js               entry point — the import order is the contract
  <name>.css            that report's styles
  <name>.legacy.js      that report's logic, as extracted
tools/
  extract.mjs           the one-shot migration that produced src/
  smoke.mjs             the browser check
```

### Sessions

Sign-in happens once, in the hub, against `VITE_API_AUTH` — a standalone
deployment with no bound workbook, kept separate so a login never queues behind
a workbook rebuild. It returns one HMAC-signed token that every backend
verifies locally, so no report signs in again.

The token lives in `localStorage` with an explicit expiry and is mirrored into
`sessionStorage`, where the reports read it. The hub passes each report its
endpoint as `?api=` when it opens the iframe — reports hold no URLs of their
own, which is why opening one directly says *"open this report from the hub"*.

### Reports load lazily

Opening the hub costs exactly one Apps Script execution: UA, the default tab.
Every other report loads on its first click and then keeps its document, so
going back to it is instant and free. Weekly is the one exception — it is
prefetched, but only *after* UA signals `mss3d:report-ready`, never alongside
it. Two Apps Script requests landing together is what makes Google answer with
an HTML throttling page instead of data.

### Theme

`theme-boot.js` is inlined into every `<head>` at build time by a plugin in
`vite.config.js`. It has to be inline and render-blocking: module scripts are
deferred, so a theme applied from `theme.js` would land one frame after the
first paint and light-theme users would see a flash of black. It sets only the
`data-theme` attribute; `theme.js` does the rest once there is a `<body>`.

A change writes to `localStorage`, which fires a `storage` event in every other
same-origin document — that is how one click in the hub reaches four iframes.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`.

The endpoints are **not in the repository**. Set them as repository secrets
under *Settings → Secrets and variables → Actions*, using the same names as
`.env.example`:

```
VITE_API_AUTH  VITE_API_UA  VITE_API_WEEKLY
VITE_API_TILLDATE  VITE_API_ASO  VITE_API_NEGATIVE
```

Vite inlines them into the bundle at build time, so they are still visible to
anyone who opens the deployed site — that is unavoidable for a static page
that calls them from the browser. What keeping them out of the repo buys is
that clones, forks and the commit history stay clean, and rotating a
deployment is a secret change rather than a commit. The actual protection is
the signed token: every request needs one, and `AUTH_HMAC_SECRET_V1` never
leaves the Apps Script projects.

Because the URLs are baked in at build time, **changing a secret does not
redeploy anything** — trigger the workflow manually from the Actions tab after
rotating one.

## Where this came from

This was six standalone HTML files, each carrying its own copy of the shared
code. `tools/extract.mjs` is the one-shot migration that produced `src/`, and
it is kept in the repo as the record of exactly what moved and what was
dropped. The migration was deliberately mechanical — every `<style>` and
`<script>` body was moved byte-for-byte — so it could be reviewed by diffing
text rather than by re-reading 13,000 lines.

What changed beyond the move:

- **`snapshot-client.js` was three identical copies** (12.4 KB each, in UA,
  Weekly and ASO). One module now.
- **The theme script was four copies that had drifted.** The ASO copy could
  read the theme but never set it; the UA/Weekly copy was missing the
  `visibilitychange` flush and used an emoji where the hub's CSS expected a
  styled glyph. `src/shared/theme.js` is the reconciled superset.
- **Till Date and Negative Spend never had the theme script at all** — both
  ship a full set of `body.lt` rules, so both were built to support the light
  theme, but with nothing listening for the hub's `storage` event those two
  tabs stayed dark when you toggled. They import the shared module now.
- **Chart.js came from three different places** — a 272 KB copy committed
  beside the reports, cdnjs, and jsdelivr. It is one npm dependency, bundled
  once and shared by all five reports.
- **55 KB of dead code removed.** Weekly carried two
  `<script type="application/x-static-disabled">` blocks left over from when
  it was an Excel export. Browsers never ran them; every visitor downloaded
  them anyway.
- **Google Fonts was five separate requests** with slightly different weight
  sets. One request now, carrying the union.
- **Four hand-edited cache-busting strings** (`?v=20260827-…-v68`) are one
  build stamp, set from the commit SHA.

### The one thing to know before editing a report

`<name>.legacy.js` is that report's original code, unmodified. It is a module
now, and **modules are always strict mode** while inline scripts were not — an
assignment to an undeclared variable is a silent implicit global in one and a
`ReferenceError` in the other. `npm run smoke` exists to catch that class of
break; run it after touching a report.

Till Date additionally needs a shim at the bottom of its `legacy.js`: its
markup wires 105 controls through `onclick=""` attributes, and an inline
handler can only see functions on `window`. Deleting that block kills every
one of those controls without throwing anything at load time. The smoke test
asserts all 23 are present.
