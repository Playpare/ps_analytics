/**
 * pro-icons.js - one line icon per KPI, picked from the KPI's label.
 * Shared by the hub theme (game-analytics/pro-theme.js) and the report theme
 * (src/shared/report-pro.js) so every page shows the same icon for the same
 * kind of number.
 */
const svg = (body) => "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' " +
  "fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>" + body + "</svg>\")";

const ICONS = {
  trendUp:  svg("<polyline points='22 7 13.5 15.5 8.5 10.5 2 17'/><polyline points='16 7 22 7 22 13'/>"),
  trendDn:  svg("<polyline points='22 17 13.5 8.5 8.5 13.5 2 7'/><polyline points='16 17 22 17 22 11'/>"),
  users:    svg("<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>"),
  user:     svg("<circle cx='12' cy='8' r='5'/><path d='M20 21a8 8 0 0 0-16 0'/>"),
  repeat:   svg("<path d='M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'/><path d='M3 3v5h5'/><path d='M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16'/><path d='M16 16h5v5'/>"),
  clock:    svg("<circle cx='12' cy='12' r='10'/><polyline points='12 6 12 12 16 14'/>"),
  bars:     svg("<rect x='3' y='3' width='18' height='18' rx='2'/><path d='M8 17v-5'/><path d='M12 17V7'/><path d='M16 17v-3'/>"),
  flag:     svg("<path d='M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z'/><line x1='4' y1='22' x2='4' y2='15'/>"),
  dollar:   svg("<line x1='12' y1='2' x2='12' y2='22'/><path d='M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'/>"),
  coin:     svg("<circle cx='12' cy='12' r='10'/><path d='M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8'/><path d='M12 18V6'/>"),
  star:     svg("<polygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'/>"),
  pie:      svg("<path d='M21.21 15.89A10 10 0 1 1 8 2.83'/><path d='M22 12A10 10 0 0 0 12 2v10z'/>"),
  card:     svg("<rect x='2' y='5' width='20' height='14' rx='2'/><line x1='2' y1='10' x2='22' y2='10'/>"),
  alert:    svg("<path d='M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/>"),
  shield:   svg("<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/><path d='m9 12 2 2 4-4'/>"),
  calendar: svg("<rect x='3' y='4' width='18' height='18' rx='2'/><line x1='16' y1='2' x2='16' y2='6'/><line x1='8' y1='2' x2='8' y2='6'/><line x1='3' y1='10' x2='21' y2='10'/>"),
  layers:   svg("<polygon points='12 2 2 7 12 12 22 7 12 2'/><polyline points='2 17 12 22 22 17'/><polyline points='2 12 12 17 22 12'/>"),
  target:   svg("<circle cx='12' cy='12' r='10'/><circle cx='12' cy='12' r='6'/><circle cx='12' cy='12' r='2'/>"),
  funnel:   svg("<polygon points='22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3'/>"),
  globe:    svg("<circle cx='12' cy='12' r='10'/><line x1='2' y1='12' x2='22' y2='12'/><path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'/>"),
};

/* First match wins: [pattern on the lower-case label, icon]. */
const RULES = [
  [/^us /, 'globe'],
  [/drop|churn/, 'trendDn'],
  [/crash-free/, 'shield'],
  [/crash|anr/, 'alert'],
  [/days tracked|median day/, 'calendar'],
  [/rating|movement/, 'star'],
  [/ftue|completion|funnel|milestone/, 'flag'],
  [/shop|level/, 'layers'],
  [/install/, 'trendUp'],
  [/retention|cohort/, 'repeat'],
  [/playtime|session len|10-min/, 'clock'],
  [/sessions|total sessions/, 'bars'],
  [/active|players|base/, 'users'],
  [/arppu|arpu|buyer/, 'user'],
  [/share/, 'pie'],
  [/spend|cpi/, 'card'],
  [/roas|roi|ltv/, 'target'],
  [/conv|purchase|rate/, 'funnel'],
  [/arpdau/, 'coin'],
  [/revenue|\$/, 'dollar'],
];

export function iconFor(label) {
  const l = String(label || '').toLowerCase();
  for (const [re, name] of RULES) if (re.test(l)) return ICONS[name];
  return ICONS.bars;
}

