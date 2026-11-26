# design/

Every stylesheet and every design script for the dashboard lives here. To
change how something looks, change it in this folder. Page scripts (data,
charts' data, behaviour) stay where they were; they only import from here.

The dashboard is **dark only**. Each page carries `data-theme="dark"` on its
`<html>` tag; there is no light theme and no theme switch.

The written spec (colours, type scale, components) is [DESIGN.md](../../DESIGN.md)
at the repository root.

## Layout

```
design/
  shared/              used by every page
    theme-tokens.css     every colour token
    typography.css       the one font (Segoe UI) and the type scale
    report-type.css      font sizes, control shapes, chart heights
    motion.css           hover / press feedback, transitions, reduced motion
    report-pro.css       the Overview look on every report (cards, KPI tiles)
    report-pro.js        adds that look: KPI icons, card wave graphs, one-line header
    chart-pro.js         draws every report chart the way Overview draws its charts
    chart-type.js        one chart font and text scale
    pro-icons.js         the icon for each KPI card, chosen from its label
    date-popup.css       the date range pill and its popup
    donut.css            donut centre totals
    ps-loader.css        the loading screen (+ pulse-logo.png)
  hub/                 the dashboard shell and its game pages (Overview, Growth, ...)
    game-analytics.css   sidebar, top bar, range bar, game-page components
    design.css           shapes and sizes of the game pages
    pro-theme.css/.js    the Overview look: KPI tiles, cards, icons
    axis.js              axis numbers on the game pages' charts
    login.css            the sign-in screen
  reports/<name>/      one folder per report (ua, weekly, till-date, aso,
                       negative-spend, exec): that report's own stylesheets,
                       loaded before the shared layers above
```

## Load order (why a rule wins)

Each report imports, in order: its own stylesheet(s) in `design/reports/<name>/`,
then `shared/report-type.css`, then `shared/report-pro.css` (through
`report-pro.js`). Later layers win, so the shared Overview look sits on top.
The hub imports `hub/game-analytics.css`, `shared/report-type.css`,
`hub/design.css`, then `hub/pro-theme.css`.

The Creative report is separate and does not use this folder, apart from the
shared loading screen.
