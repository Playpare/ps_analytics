/* eslint-disable */
import { API_URLS, GAME_API_KEY, BUILD_ID, assertConfigured } from '../src/shared/config.js';
import { getToken, clearSession, login as sessionLogin } from '../src/shared/session.js';
import { kpiAccent } from '../design/shared/kpi-colors.js';
/* --- from game_analytics.html · block 1f1f70eae8 --- */
// ═════════════════════════════════════════
// CONFIG — Apps Script /exec URL + secret key
// ═════════════════════════════════════════
const SHEET_API_URL = API_URLS.game;
const SHEET_API_KEY = GAME_API_KEY;

// 10-min milestone is auto-detected: step whose cumulative playtime is closest to 600s

// ═════════════════════════════════════════
// STATE
// ═════════════════════════════════════════
const g = id => document.getElementById(id);
let currentGame = 'mss_android';
let currentTab = 'overview';
let activeRange = 14;
let dateFrom = '', dateTo = '';
let DATA = {};
/**
 * Chart.js takes a literal family name, not a CSS variable, so the numeric face
 * is named once here and referenced by every chart config. Keep it in step with
 * --mono in the stylesheet.
 */
const CHART_FONT = 'Segoe UI, sans-serif';

let charts = {};
let shopRange = { min:1, max:20 };
let dayRange  = { min:1, max:30 };

// Progress Events carries its own window, independent of the dashboard range.
// Its rows are a cumulative "how many players ever reached level X" aggregate
// over the window, not a per-day series, so it only reads sensibly over whole
// weeks and cannot be re-sliced client-side — each window is its own request.
let progRangeDays = 14;
let PROG  = {};        // `${gameId}_${from}_${to}` → { shopLevels, dayCounts, window }
let _progSeq = 0;      // newest progression request wins

// Games populated from Apps Script (GAMES config, filtered by user access)
let games = [];

let thresholds = {
  crash:   { label:'Crash rate max',      val:1.5,  unit:'%' },
  anr:     { label:'ANR rate max',        val:1.0,  unit:'%' },
  d1:      { label:'D1 retention min',    val:35,   unit:'%' },
  d7:      { label:'D7 retention min',    val:15,   unit:'%' },
  ftue:    { label:'FTUE completion min', val:50,   unit:'%' },
  ftue10m: { label:'10-min tutorial min', val:60,   unit:'%' },
  nps:     { label:'NPS score min',       val:30,   unit:''  },
  rating:  { label:'In-game rating min',  val:4.0,  unit:''  },
};

let feedback = [];

// ═════════════════════════════════════════
// SECTION REGISTRY (config-driven framework)
// ═════════════════════════════════════════
// Every dashboard section is declared here. The sidebar nav and overview cards
// are built dynamically from this registry + the per-game enabled list.
//
// To enable/disable a section for a game, either:
//   1. Add a row to the game's `Config` sheet tab (Section | Enabled | Label | Order)
//   2. Or edit DEFAULT_ENABLED_SECTIONS below (used as fallback when sheet has no Config tab)

const NAV_ICONS = {
  overview:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.2"/></svg>',
  growth:    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="1.5,12 5,8 8.5,10 14,3"/><polyline points="10,3 14,3 14,7"/></svg>',
  retention: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 8a6 6 0 0111-3.5M14 8a6 6 0 01-11 3.5M14 3v3h-3M2 13v-3h3"/></svg>',
  playtime:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>',
  ftue:      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 2h12l-2.5 4h-7z"/><path d="M4.5 6l1.5 3h4l1.5-3"/><path d="M6 9v5h4V9"/></svg>',
  events:    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 2v13"/><path d="M3 3h8l-2 3 2 3H3"/></svg>',
  liveops:   '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9.5 2l-6 7.5h4L7 14l5.5-7.5H8.5z"/></svg>',
  stability: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 1.5l6.5 11H1.5L8 1.5z"/><line x1="8" y1="6.5" x2="8" y2="9.5"/><circle cx="8" cy="11.5" r=".7" fill="currentColor"/></svg>',
  rating:    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 1.5l2 4.5 4.5.5-3.5 3 1 4.5L8 11.5 4 14l1-4.5-3.5-3L6 6z"/></svg>',
  feedback:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M13.5 2.5h-11a1 1 0 00-1 1v7a1 1 0 001 1h3l2.5 3 2.5-3h3a1 1 0 001-1v-7a1 1 0 00-1-1z"/></svg>',
  thresholds:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="2.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>',
  negative:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="1.5,4 5,8 8.5,6 14,12"/><polyline points="10,12 14,12 14,8"/></svg>',
  uareport:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="2" width="12" height="12" rx="1.6"/><line x1="5" y1="10.5" x2="5" y2="7"/><line x1="8" y1="10.5" x2="8" y2="5"/><line x1="11" y1="10.5" x2="11" y2="8.5"/></svg>',
  monetization:'<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="6"/><path d="M10.5 5.5H7a1.5 1.5 0 100 3h2a1.5 1.5 0 010 3H5.5"/><line x1="8" y1="3.5" x2="8" y2="12.5"/></svg>',
  tilldate:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="6"/><path d="M8 4.2V8l2.6 1.6"/></svg>',
  /* Executive (briefcase) and Creative (image), new with those two pages */
  exec:      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="1.8" y="4.6" width="12.4" height="9" rx="1.6"/><path d="M5.6 4.6V3.2a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v1.4M1.8 8.6h12.4"/></svg>',
  creative:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="1.8" y="2.4" width="12.4" height="11.2" rx="1.6"/><circle cx="5.6" cy="6" r="1.2"/><path d="M14.2 10.6 10.6 7l-6.8 6.6"/></svg>',
  aso:       '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 1.6l1.9 4 4.3.5-3.2 2.9 .9 4.3L8 11.2 4.1 13.3l.9-4.3L1.8 6.1l4.3-.5z"/></svg>',
  alerts:    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11z"/><path d="M6.5 14a1.6 1.6 0 0 0 3 0"/></svg>',
  users:     '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="5" r="3"/><path d="M1 14c0-3 2-5 5-5s5 2 5 5"/><circle cx="12.5" cy="5" r="2"/><path d="M12.5 9c1.5 0 3 1 3 3.5"/></svg>',
};

/**
 * SCOPE is the thing that makes one nav able to hold both halves.
 *
 * The sections above the divider answer "how is THIS GAME doing" and are cut
 * by the game picker and the date range. The reports below it answer
 * different questions entirely: Negative Spend is cut by network across every
 * campaign, Till Date covers all time. Leaving "MSS - Android" sitting above
 * Negative Spend would not be untidy, it would be a lie - a reader would take
 * those figures for that game's.
 *
 * So each section declares what it is cut by, and the topbar follows. See
 * SCOPES and applyScope() below for what that does to the controls.
 *
 * `report` marks a section that is one of the five existing report pages
 * rather than something this file draws. Those load in an iframe, which is
 * why folding them in costs a registry entry instead of a port.
 */
const SECTION_META = {
  overview:   { group:'Dashboard',      label:'Overview',        order:10,  scope:'game' },
  /* The Executive Dashboard, under Dashboard as "Executive". As in the
     ps_analytics repo: its own page (reports/exec) and its own Apps Script
     backend (VITE_API_EXEC); it shows the whole portfolio, not one game. */
  exec:       { group:'Dashboard',      label:'Executive',       order:15,  scope:'portfolio',
                report:'exec',           api:'exec' },
  growth:     { group:'Growth',         label:'Growth',          order:20,  scope:'game' },
  retention:  { group:'Player Metrics', label:'Retention',       order:30,  scope:'game' },
  playtime:   { group:'Player Metrics', label:'Engagement',      order:40,  scope:'game' },
  ftue:       { group:'Player Metrics', label:'FTUE Funnel',     order:50,  scope:'game' },
  events:     { group:'Gameplay',       label:'Progress Events', order:80,  scope:'game' },
  /* hidden: drawn nowhere and reachable from nowhere, but kept here with
     its render and its markup intact. Live Ops has no data behind it yet;
     deleting the section would mean rebuilding it when it does. One word
     here is the whole switch. */
  liveops:    { group:'Live Ops',       label:'Live Ops',        order:90,  scope:'game', hidden:true },
  stability:  { group:'App Health',     label:'Stability',       order:100, scope:'game' },
  /* Player Rating: removed from the dashboard on request. hidden keeps its
     render and markup, so it can come back by deleting one word. */
  rating:     { group:'App Health',     label:'Player Rating',   order:110, scope:'game', hidden:true },

  /* The reports. Order puts them after the game sections and before Config,
     which is where a UA manager's eye goes second - the game overview first,
     then what needs a decision today. */
  /* `report` is the directory the page lives in; `api` is its key in
     API_URLS. They are not always the same word - till-date/tilldate and
     negative-spend/negative differ - so the key is written down rather than
     derived from the path. Deriving it would work for three of the five and
     fail silently on the other two. */
  negative:     { group:'Reports', label:'Negative Spend', order:200, scope:'ua',
                  report:'negative-spend', api:'negative' },
  uareport:     { group:'Reports', label:'UA Report',      order:210, scope:'ua',
                  report:'ua',             api:'ua' },
  uanetwork:    { group:'Reports', label:'Networks',       order:215, scope:'ua',
                  report:'ua-network',     api:'game' },
  monetization: { group:'Reports', label:'Monetization',   order:220, scope:'ua',
                  report:'weekly',         api:'weekly' },
  tilldate:     { group:'Reports',   label:'Life Time',      order:230, scope:'all',
                  report:'till-date',      api:'tilldate' },
  aso:          { group:'Reports',      label:'ASO',            order:240, scope:'aso',
                  report:'aso',            api:'aso' },
  /* Creative Analytics, under Reports. As in the ps_analytics repo: its own
     page (reports/creative) and backend (VITE_API_CREATIVE); its VALIA page
     reads a third deployment, handed over as ?valiaApi= by reportUrl(). */
  creative:     { group:'Reports',      label:'Creative',       order:250, scope:'ua',
                  report:'creative',       api:'creative' },

  feedback:   { group:'Config',         label:'Feedback',        order:300, scope:'game', hidden:true },
  thresholds: { group:'Config',         label:'Thresholds',      order:310, scope:'game' },
  users:      { group:'Config',         label:'User Management', order:320, scope:'game' },
  /* Last in the sidebar, Data team only (DATA_TEAM_PAGES): every page and
     report, and the KPI cards and charts on it that have no data points. */
  /* order is far past anything else, so it stays last even when the sheet's
     Config tab gives other pages orders of its own */
  alerts:     { group:'Data',           label:'Alerts',          order:99999, scope:'game' },
};

/**
 * What the topbar controls mean in each scope.
 *
 * Nothing is ever hidden. A control that does not apply becomes a chip that
 * says what the section is actually cut by, in the same place and at the same
 * size, so the bar never reflows as you move around and a reader is never left
 * guessing whether a stale-looking dropdown is filtering what they see.
 *
 * Hiding was the first design and it was worse in both directions: controls
 * jumped as you switched sections, and their absence said nothing.
 */
const SCOPES = {
  game: { game: null,          range: null },
  ua:   { game: 'all games',   range: 'set inside the report' },
  all:  { game: 'all games',   range: 'all time' },
  aso:  { game: 'all games',   range: 'set inside the report' },
  portfolio: { game: 'all games', range: 'set inside the report' }
};

/**
 * The URL for a report section's page.
 *
 * `api` is the whole reason a report can fetch anything: each one reads its
 * /exec endpoint out of that query parameter rather than importing config.js,
 * because these pages predate the shared module and were always launched by a
 * host that knew which backend they belonged to. The hub did this. This page
 * did not, so every framed report loaded, found no endpoint and stayed empty -
 * while saying so in the console, in words, on every run.
 *
 * `v` is the build id. Vite fingerprints JS and CSS by content but cannot
 * fingerprint the HTML documents themselves, so without this a deploy leaves
 * everyone's cached copy of the report in place.
 *
 * The UA report carries extra endpoints because it reaches past its own
 * backend. Its nav has a Negative Spend tab inside it, and its platform slides
 * now show the ad network table, which lives in THIS project's workbook rather
 * than UA's - the UA spreadsheet has no Network tab at all.
 *
 * Handing it the URL is better than the two alternatives. UA's backend could
 * openById across to this workbook, but its own debug.js records that
 * cross-workbook open as measurably slow, and the aggregation would then exist
 * twice and drift. Or the Network tab could be synced into UA's workbook,
 * which buys a second copy of the data and a staleness problem.
 */
function reportUrl(section) {
  const api = API_URLS[section.api];
  let url = 'reports/' + section.report + '/?v=' + encodeURIComponent(BUILD_ID);
  if (api) url += '&api=' + encodeURIComponent(api);
  /* Creative's VALIA page talks to a different deployment from the rest of
     that report, so it needs its own endpoint on the same URL. */
  if (section.api === 'creative' && API_URLS.valia) {
    url += '&valiaApi=' + encodeURIComponent(API_URLS.valia);
  }
  if (section.api === 'ua' && API_URLS.negative) {
    url += '&negativeApi=' + encodeURIComponent(API_URLS.negative);
  }
  /* The key travels with the URL because this project's route() checks it
     before anything else; the session token does not, because UA reads the
     same sessionStorage entry this page wrote. Passing the token through the
     query string would put it in the iframe's URL for no gain. */
  if (section.api === 'ua' && API_URLS.game) {
    url += '&gameApi=' + encodeURIComponent(API_URLS.game);
    if (GAME_API_KEY) url += '&gameKey=' + encodeURIComponent(GAME_API_KEY);
  }
  return url;
}

// Section id → render function reference (late-bound so forward decls work)
const SECTION_RENDERS = {
  overview:   function(){ renderOverview(); },
  growth:     function(){ renderGrowth(); },
  retention:  function(){ renderRetention(); },
  playtime:   function(){ renderPlaytime(); },
  ftue:       function(){ renderFtue(); },
  events:     function(){ renderEvents(); },
  liveops:    function(){ renderLiveOps(); },
  stability:  function(){ renderStability(); },
  rating:     function(){ renderRating(); },
  feedback:   function(){ renderFeedback(); },
  thresholds: function(){ renderThresholds(); },
  users:      function(){ renderUsers(); },
  alerts:     function(){ renderAlerts(); },
};

// Fallback enabled set when a game's sheet has no Config tab yet.
// Once you add a Config tab per game, those rows override this list.
const DEFAULT_ENABLED_SECTIONS = [
  'overview', 'growth', 'retention', 'playtime', 'ftue',
  'events', 'liveops', 'stability',
  'feedback', 'thresholds'
];

/**
 * The five report pages. Appended to whatever the section list turns out to
 * be, never listed inside it.
 *
 * They were in DEFAULT_ENABLED_SECTIONS at first, which looked right and was
 * wrong: getEnabledSections() reads the sheet's Config tab when that tab has
 * rows and only falls back to the default list when it does not. MSS_Dashbaord
 * has a Config tab. So the sheet path ran, replaced the whole list, and not
 * one report ever reached the nav - while the smoke test, which has no signed
 * in session and therefore no sheet config, went down the fallback path and
 * saw all five.
 *
 * They are not per-game features to be switched on and off; they are the rest
 * of the dashboard. Appending them, the way ADMIN_ONLY_SECTIONS already was,
 * is what makes that true in the code and not only in a comment.
 */
const REPORT_SECTIONS = ['exec', 'negative', 'uareport', 'uanetwork',
                         'monetization', 'tilldate', 'aso', 'creative'];
// Users section is always available but only shown to admins (filtered in getEnabledSections)
const ADMIN_ONLY_SECTIONS = ['users'];
// Pages for the Data team alone - not admins by role, not grantable to a team.
const DATA_TEAM_PAGES = ['alerts'];

function getEnabledSections(){
  const d = curData();
  let list;

  if(d.sections && Array.isArray(d.sections) && d.sections.length){
    list = d.sections
      .filter(function(s){
        return s.enabled === true || s.enabled === 'TRUE' || s.enabled === 1 || s.enabled === 'true';
      })
      .map(function(s){
        const meta = SECTION_META[s.section] || {};
        return {
          id:    s.section,
          label: s.section === 'playtime' ? 'Engagement' : (s.label || meta.label || s.section),
          order: +s.order || meta.order || 999,
          group: meta.group || 'Other',
          scope: meta.scope || 'game',
          report:meta.report || null,
          api:   meta.api || null,
          icon:  NAV_ICONS[s.section] || '',
          render:SECTION_RENDERS[s.section],
        }; 
      })
      // A report section is drawn by its own page in an iframe, so it has no
      // render function here and must not be filtered out for lacking one.
      .filter(function(s){ return s.render || s.report; });
  } else {
    list = DEFAULT_ENABLED_SECTIONS.map(function(id){
      const meta = SECTION_META[id] || {};
      return {
        id:    id,
        label: meta.label || id,
        order: meta.order || 999,
        group: meta.group || 'Other',
        scope: meta.scope || 'game',
        report:meta.report || null,
      api:   meta.api || null,
        icon:  NAV_ICONS[id] || '',
        render:SECTION_RENDERS[id],
      };
    }).filter(function(s){ return s.render || s.report; });
  }

  /* Whichever branch produced the list above, the reports go on it. */
  REPORT_SECTIONS.forEach(function(id){
    if(list.find(function(s){ return s.id === id; })) return;
    const meta = SECTION_META[id] || {};
    if(!meta.report) return;
    list.push({
      id:    id,
      label: meta.label || id,
      order: meta.order || 999,
      group: meta.group || 'Other',
      scope: meta.scope || 'game',
      report:meta.report,
      api:   meta.api || null,
      icon:  NAV_ICONS[id] || '',
      render:null,
    });
  });

  // Admin-only sections (User Management) for the Data team, which is the admin
  if(isAdminUser()){
    ADMIN_ONLY_SECTIONS.forEach(function(id){
      if(!list.find(function(s){ return s.id === id; })){
        const meta = SECTION_META[id] || {};
        if(SECTION_RENDERS[id]){
          list.push({
            id:    id,
            label: meta.label || id,
            order: meta.order || 999,
            group: meta.group || 'Config',
            // Without this the section arrives with scope undefined, and
            // applyScope falls back to 'game' by luck rather than by intent.
            scope: meta.scope || 'game',
            report:meta.report || null,
          api:   meta.api || null,
            icon:  NAV_ICONS[id] || '',
            render:SECTION_RENDERS[id],
          });
        }
      }
    });
  }

  /* Alerts: appended last for everyone, then granted like any other page -
     the Data team (full access) always has it; another team has it when it
     is ticked on the Teams page. */
  {
    DATA_TEAM_PAGES.forEach(function(id){
      if(list.find(function(s){ return s.id === id; })) return;
      const meta = SECTION_META[id] || {};
      list.push({ id:id, label:meta.label || id, order:meta.order || 999, group:meta.group || 'Data',
        scope:meta.scope || 'game', report:null, api:null, icon:NAV_ICONS[id] || '', render:SECTION_RENDERS[id] });
    });
  }

  /* One choke point for hiding. Both branches above build the list their
     own way and isEnabled() reads the same function, so a section filtered
     here is gone from the nav, from goTab and from every other check at
     once - rather than being removed from the sidebar and still reachable
     by a stale URL. */
  return list
    .filter(function(s){ return !(SECTION_META[s.id] || {}).hidden; })
    // team access: a page the user's team may not open is gone everywhere
    .filter(function(s){ return pageAllowed(s.id); })
    .sort(function(a,b){ return a.order - b.order; });
}

/* ═════════════════════════════════════════
   ACCESS: teams, pages and KPIs (see user_access.md)

   The server sends user.access with every payload:
     { full:true }                                admin / full / legacy rows
     { full:false, team, pages:{ page:'*'|[ids] }} a team member
   A page missing from `pages` is not allowed. '*' = every KPI on it.

   PLUG-N-PLAY
   - Pages: every visible SECTION_META entry is a page the admin can grant.
     Add a section there and it shows up in the Teams checklist.
   - KPIs: a KPI's id is its card label, slugged ("UA Spend" -> ua_spend).
     ACCESS_KPIS seeds the checklist; any card drawn with a label not listed
     is discovered at render time and added too. A new KPI is hidden for a
     team with a picked list until the admin ticks it, and shown for '*'.
   ═════════════════════════════════════════ */
const ACCESS_KPIS = {
  overview:  ['Installs','Active Users','D1 Retention','D0 Playtime','Sessions / User','FTUE Complete',
              'Revenue','ARPDAU','ARPPU','Payer Conv.','Ad / IAP Share','UA Spend'],
  growth:    ['Total Installs','UA Spend','ROI','Avg CPI','ROAS','LTV : CPI','Revenue','ARPDAU','ARPPU',
              'Purchase Rate','IAP Revenue','Ad Revenue','LTV D0 / D7 / D28','ARPU',
              'US Revenue','US Purchases','US ARPPU','US Buyer Rate'],
  retention: ['D1 Retention','D4 Retention','D7 Retention','D14 Retention','Cohort Size'],
  playtime:  ['D0 Playtime','Avg Playtime','Session Len D0','Avg Session Len','Sessions / User',
              'Total Playtime','Total Sessions'],
  ftue:      ['Funnel Base','Completion','Biggest Drop','10-min Milestone'],
  events:    ['Active Players','Median Shop Lvl','Median Day','Deepest Level'],
  stability: ['Crash Rate','ANR Rate','Crash-Free Users','Days Tracked'],
};
/* Pages that are admin tools, never granted to a team. */
const ACCESS_ADMIN_PAGES = ['users'];

function kpiSlug(label){
  return String(label||'').toLowerCase().replace(/→/g,'to').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
}

/** Every page the admin can grant, in sidebar order. */
function accessPages(){
  return Object.keys(SECTION_META)
    .filter(function(id){ return !SECTION_META[id].hidden && ACCESS_ADMIN_PAGES.indexOf(id) === -1; })
    .sort(function(a,b){ return (SECTION_META[a].order||999) - (SECTION_META[b].order||999); })
    .map(function(id){ return { id:id, label:SECTION_META[id].label, group:SECTION_META[id].group }; });
}

/* KPI labels seen while drawing, merged into the checklist (plug-n-play). */
const KPI_SEEN = {};
function accessKpis(page){
  const seen = KPI_SEEN[page] || {};
  const list = (ACCESS_KPIS[page] || []).slice();
  Object.keys(seen).forEach(function(l){ if(list.indexOf(l) === -1) list.push(l); });
  const out = [], ids = {};
  list.forEach(function(l){ const id = kpiSlug(l); if(!ids[id]){ ids[id]=1; out.push({ id:id, label:l }); } });
  return out;
}

/* Until the server has said what this person may see, they see nothing. The
   old default was full access, which is how the whole dashboard flashed up for
   a moment before the team's pages arrived. */
function userAccessRec(){ return (CU && CU.access) || { full:false, pages:{} }; }

function pageAllowed(id){
  if(ACCESS_ADMIN_PAGES.indexOf(id) !== -1) return isAdminUser();
  const a = userAccessRec();
  if(a.full) return true;
  return !!(a.pages && Object.prototype.hasOwnProperty.call(a.pages, id));
}

function kpiAllowed(page, kpiId){
  const a = userAccessRec();
  if(a.full) return true;
  const k = a.pages && a.pages[page];
  if(!k) return false;
  return k === '*' || (Array.isArray(k) && k.indexOf(kpiId) !== -1);
}

/** Hides KPI cards the team may not see, and records labels for the registry. */
function filterKpis(root){
  (root || document).querySelectorAll('.tab-pane .kpi').forEach(function(card){
    const pane = card.closest('.tab-pane'); if(!pane || !pane.id) return;
    const page = pane.id.replace(/^tab-/, '');
    const lblEl = card.querySelector('.kpi-label'); if(!lblEl) return;
    const label = lblEl.textContent.trim(); if(!label) return;
    (KPI_SEEN[page] = KPI_SEEN[page] || {})[label] = 1;
    card.classList.toggle('kpi-denied', !kpiAllowed(page, kpiSlug(label)));
  });
}
/* Any page, any time it draws: cards are filtered as they appear. */
(function(){
  let t = null;
  const run = function(){ t = null; filterKpis(); };
  const obs = new MutationObserver(function(){ if(!t) t = setTimeout(run, 0); });
  document.addEventListener('DOMContentLoaded', function(){
    const root = document.querySelector('.content') || document.body;
    obs.observe(root, { childList:true, subtree:true });
  });
})();

function isEnabled(id){
  return getEnabledSections().some(function(s){ return s.id === id; });
}

function buildNav(){
  const nav = g('sbNav');
  if(!nav) return;

  const sections = getEnabledSections();

  // Group while preserving first-encounter order
  const groupOrder = [];
  const groups = {};
  sections.forEach(function(s){
    if(!groups[s.group]){
      groups[s.group] = [];
      groupOrder.push(s.group);
    }
    groups[s.group].push(s);
  });

  nav.innerHTML = groupOrder.map(function(groupName){
    return '<div class="sb-section">'+groupName+'</div>' +
      groups[groupName].map(function(s){
        return '<div class="nav-item'+(currentTab===s.id?' active':'')+'" data-tab="'+s.id+'" onclick="goTab(\''+s.id+'\',this)">' +
          s.icon + '<span class="nav-lbl">' + s.label + '</span>' +
          '</div>';
      }).join('');
  }).join('');

  // The nav was just replaced; if the rail is collapsed the new items need
  // their tooltips back.
  if(document.body.classList.contains('sb-collapsed')) applySidebarState(true);
}

// ═════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════
// ── Formatting ──────────────────────────────────────────────────────────────
// Every formatter refuses anything that is not a finite number and prints the
// em dash instead. The old guard was `n == null`, which let three things
// through that all render as text on a card: NaN from a parse that failed,
// Infinity from a division whose denominator turned out to be zero, and the
// empty string from a blank cell. 'NaN%' on a KPI is worse than '—' — it is
// the same amount of missing information wearing the costume of a value.
const isNum   = n => n !== null && n !== undefined && n !== '' && isFinite(n);

const fmt     = n => isNum(n) ? Number(n).toLocaleString() : '—';
const fmtKn   = n => !isNum(n) ? '—'
                   : Math.abs(n)>=1e6 ? (n/1e6).toFixed(2)+'M'
                   : Math.abs(n)>=1e3 ? (n/1e3).toFixed(1)+'K'
                   : Math.round(n).toString();
const fmtPct  = n => isNum(n) ? (+n).toFixed(1)+'%' : '—';
const fmtPct2 = n => isNum(n) ? (+n).toFixed(2)+'%' : '—';
const fmtSec  = n => isNum(n) ? Math.round(n)+'s' : '—';
const fmtPlaytime = n => isNum(n) ? Math.round(+n)+'s' : '—';

// Money, in one place. Sixteen call sites used to write '$'+something
// themselves, which is how a negative figure came out as "$-1.2K" - the sign
// belongs outside the currency symbol, and a page that writes it by hand gets
// that right in some places and not others.
//   fmtMoney(n)      -> $1.2K    compact, for headlines and axes
//   fmtMoney(n, 2)   -> $1,234.56  exact, for tables and small amounts
const fmtMoney = (n, dp) => {
  if (!isNum(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(+n);
  return sign + '$' + (dp == null ? fmtKn(a)
    : a.toLocaleString(undefined, { minimumFractionDigits: dp,
                                    maximumFractionDigits: dp }));
};
const sum     = a => a.reduce((s,v)=>s+(+v||0),0);
const avg     = a => { const f=a.filter(v=>v!=null && v!=='' && !isNaN(v)); return f.length?sum(f)/f.length:0; };
// Alias used where a value may legitimately be null (dropped as out-of-range),
// to make it obvious at the call site that nulls are skipped, not zeroed.
const avgNN   = avg;
const rnd     = (min,max) => min + Math.random()*(max-min);
const rndi    = (min,max) => Math.floor(rnd(min,max+1));

function pctChange(cur, prev){
  if(!prev || prev===0) return 0;
  return (cur-prev)/prev*100;
}
function deltaHtml(cur, prev, goodUp=true){
  const dp = pctChange(cur, prev);
  const up = dp >= 0; 
  const good = goodUp ? up : !up;
  const small = Math.abs(dp) < 0.5;
  const cls = small ? 'flat' : good ? 'up' : 'dn';
  const arrow = small ? '•' : up ? '▲' : '▼';
  return `<span class="kpi-delta ${cls}">${arrow} ${Math.abs(dp).toFixed(1)}%</span>`;
}
/* Compare the same metric across two equal calendar windows. */
function kpiTrendHtml(k){
  if(k.noTrend || k.val === '—' || !isNum(k.cur) || !isNum(k.prev)) return '';
  const formatter = k.fmt || (String(k.val).includes('%') ? fmtPct
    : String(k.val).includes('$') ? fmtMoney : fmtKn);
  const baseline = '<span>vs ' + formatter(+k.prev) + '</span>';
  const delta = +k.cur - +k.prev;
  if(!delta) return '<div class="kpi-trend flat">● no change ' + baseline + '</div>';
  const pct = +k.prev ? Math.abs(delta / +k.prev * 100) : null;
  if(pct !== null && pct < 0.05) return '<div class="kpi-trend flat">● no change ' + baseline + '</div>';
  const up = delta > 0;
  const good = (k.better || 'up') === 'up' ? up : !up;
  const move = pct === null ? (up ? 'Up' : 'Down') : (up ? '▲ ' : '▼ ') + pct.toFixed(1) + '%';
  return '<div class="kpi-trend ' + (good ? 'good' : 'bad') + '">' + move + ' ' + baseline + '</div>';
}
function getWindow(arr){
  if(!arr || !arr.length) return [];
  if(dateFrom && dateTo){
    return arr.filter(r => r.date && r.date >= dateFrom && r.date <= dateTo);
  }
  return arr.slice(-activeRange);
}
function previousDashboard(){
  const current = curData();
  return current.meta?.from === dateFrom && current.meta?.to === dateTo ? current.previousPeriod || {} : {};
}
function averageReported(rows, key){
  const values = (rows || []).map(row => row[key]).filter(isNum);
  return values.length ? avg(values) : null;
}

const pendingComparisons = new WeakSet();

async function loadPreviousDashboard(){
  const current = curData(), game = currentGame, from = dateFrom, to = dateTo;
  if(!from || !to || current.meta?.from !== from || current.meta?.to !== to ||
     current._fetchError || current.previousPeriod || pendingComparisons.has(current) || !getToken()) return;

  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const priorFrom = isoShift(from, -days), priorTo = isoShift(from, -1);
  pendingComparisons.add(current);
  try {
    const cached = readCache(game, priorFrom, priorTo);
    const raw = cached?.payload || await fetchRange(game, priorFrom, priorTo);
    if(raw.meta?.from !== priorFrom || raw.meta?.to !== priorTo) return;
    if(!cached) writeCache(game, raw, priorFrom, priorTo);
    current.previousPeriod = normalizeSheetData(raw);
    if(current === curData() && game === currentGame && from === dateFrom && to === dateTo) renderAll();
  } catch(e){
    console.warn('[dash] previous period unavailable:', e.message);
  } finally {
    pendingComparisons.delete(current);
  }
}
function curData(){ return DATA[currentGame] || {}; }

function find10minStep(steps){
  if(!steps || !steps.length) return null;
  var best = steps[0], bestDiff = Math.abs((+steps[0].avgPlaytimeSec||0) - 600);
  steps.forEach(function(s){ var d = Math.abs((+s.avgPlaytimeSec||0) - 600); if(d < bestDiff){ bestDiff = d; best = s; } });
  return best;
}

function aggregateFtue(){
  // Server already rolls up FTUE steps (median playtime, engagement, churn,
  // step-to-step drop, <1% noise removal). Nothing to do client-side.
  const d = curData();
  if(!d) return;
  d.ftueFunnel = d.ftueSteps || [];
  d._ftueBase = d.ftueBase || 0;
  d._ftueHiddenCount = (d.ftue && d.ftue.hiddenCount) || 0;
}

function chartColors(){
  return {
    /* Chart.js takes literals, not CSS variables, so every one of these is a
       copy of a token in the stylesheet and has to be changed with it. The
       names are the shell's originals; the values are the reports' palette,
       so a chart in a game section and a chart inside a framed report are
       drawing with the same six colours.

         cyan -> teal    violet -> blue    lime -> green
         magenta -> pink    amber, coral unchanged in role */
    text:  '#d7deea',
    grid:  'rgba(255,255,255,0.07)',
    cyan:  '#00e5c3',
    magenta: '#ec0a9b',
    lime:  '#00c47a',
    amber: '#ffb800',
    coral: '#ff4d6d',
    violet:'#4d9fff',
  };
}

// Generate a 2-4 letter badge from a game name
function gameBadge(name){
  const words = name.split(/[\s\-_—]+/).filter(Boolean);
  if(words.length >= 2) return words.map(w=>w[0]).join('').toUpperCase().slice(0,4);
  return name.slice(0,4).toUpperCase();
}

// ═════════════════════════════════════════
// LIVE FETCH LAYER (Phase C) — Apps Script → dashboard
// ═════════════════════════════════════════
//
// TRANSPORT RULES — do not break these.
// Every call below is a plain GET with query-string parameters and NO custom
// headers, which is what makes it a CORS "simple request". Apps Script Web Apps
// do not answer OPTIONS, so the moment a header, a JSON body or a non-default
// mode is added the browser issues a preflight, the preflight fails, and the
// whole dashboard goes dark. Keep: fetch(url, { redirect:'follow' }).
// The 302 to script.googleusercontent.com is followed by default; that is fine
// and required.

// ═════════════════════════════════════════
// PAYLOAD EXPANSION — {h:[headers], r:[[row]]} → [{…}]
// ═════════════════════════════════════════
//
// Row-heavy sections arrive with their headers declared once and their rows as
// bare arrays, which is a large saving on the wire when `daily` alone repeats
// ~25 key names per day. The column order is never written down here: it is
// read out of the payload's own `h` array, so the server is the only place that
// decides it. Everything downstream keeps receiving the arrays of objects it
// always did, so no renderer needs to know this happened.

/** True for a packed section — an object carrying both `h` and `r` arrays. */
function isPacked(x){
  return !!x && typeof x === 'object' && !Array.isArray(x)
      && Array.isArray(x.h) && Array.isArray(x.r);
}

/** Rebuilds one packed section. Anything already expanded passes straight through. */
function expandSection(sec){
  if(Array.isArray(sec)) return sec;
  if(!isPacked(sec)) return sec;
  const h = sec.h, n = h.length;
  return sec.r.map(function(row){
    const o = {};
    for(let i = 0; i < n; i++) o[h[i]] = row[i];
    return o;
  });
}

/**
 * Walks the paths the server packed and expands each one in place.
 *
 * Driven by meta.packed — the server's own list — so adding a section to
 * PACKED_SECTIONS in Code.gs needs no matching edit here. The hardcoded list is
 * only a fallback for a payload built before meta.packed existed.
 */
const PACKED_FALLBACK = [
  'daily','retention.cohorts','retention.curve','ftue.steps','ftue.tenMin',
  'ratings.daily','ratings.nps','monetization.networks','monetization.whale',
  'monetization.ftp','engagement.placements','stickiness.daily',
  'progression.shopLevels','progression.dayCounts','conversions','liveops',
  'benchmark','feedback'
];

function expandPayload(raw){
  if(!raw || typeof raw !== 'object') return raw;
  const paths = (raw.meta && Array.isArray(raw.meta.packed)) ? raw.meta.packed : PACKED_FALLBACK;
  paths.forEach(function(path){
    const parts = path.split('.');
    let host = raw;
    for(let i = 0; i < parts.length - 1; i++){
      host = host && host[parts[i]];
      if(!host) return;
    }
    const leaf = parts[parts.length - 1];
    if(host && isPacked(host[leaf])) host[leaf] = expandSection(host[leaf]);
  });
  return raw;
}

// Frontend expected shape ←→ Code.gs response shape normalization
function normalizeSheetData(raw){
  // Packed sections are rebuilt into plain arrays of objects before anything
  // else looks at them, so every renderer below is unchanged.
  raw = expandPayload(raw);
  const ftue = raw.ftue || { base:0, steps:[], tenMin:[] };
  const prog = raw.progression || { shopLevels:[], dayCounts:[] };
  return {
    meta:        raw.meta        || {},
    sections:    raw.config      || [],
    daily:       raw.daily       || [],
    // Retention is an object: the D1-D7 + D14 curve for the selected platform,
    // its cohort sizes, and an Android-vs-iOS breakdown built on every view.
    retentionRaw: raw.retention || {},
    retention:    (raw.retention && raw.retention.curve)    || [],
    retCohorts:   (raw.retention && raw.retention.cohorts)  || [],
    retSummary:   (raw.retention && raw.retention.summary)  || {},
    retByPlatform:(raw.retention && raw.retention.byPlatform) || {},
    retDays:      (raw.retention && raw.retention.days)     || ['d1','d2','d3','d4','d5','d6','d7','d14'],
    curveAvailable: !!(raw.retention && raw.retention.curveAvailable),
    platform:     (raw.meta && raw.meta.platform) || 'all',
    platformNotes: raw.platformNotes || {},
    ftue:        ftue,
    ftueSteps:   ftue.steps      || [],
    ftueBase:    ftue.base       || 0,
    tenMin:      ftue.tenMin     || [],
    shopLevels:  prog.shopLevels || [],
    dayCounts:   prog.dayCounts  || [],
    progWindow:  prog.window     || null,
    stability:   raw.stability   || [],
    ratings:     raw.ratings     || { daily:[] },
    ua:          raw.ua          || { daily:[], channels:[], campaigns:[] },
    roasCurve:   raw.roasCurve   || { points:[] },
    stickiness:  raw.stickiness  || { daily:[], stickiness:null },
    cohortRoas:  raw.cohortRoas  || null,
    sheet1:      raw.sheet1      || null,
    monetization:raw.monetization|| { networks:[], ltv:[], whale:[], ftp:[] },
    engagement:  raw.engagement  || { adCohort:null, placements:[], cohortDayKeys:[] },
    conversions: raw.conversions || [],
    /* Passed through, not defaulted to an empty object.

       null here means "the backend sent no US section", which renderGrowth
       tells apart from "the section is there and has no rows" - a missing
       workbook id and a quiet fortnight are different errands and an empty
       object would make them look the same. */
    us:          raw.us          || null,
    liveops:     raw.liveops     || [],
    benchmark:   raw.benchmark   || [],
    feedback:    raw.feedback    || [],
    missing:     raw.missing     || {},
    freshness:   raw.freshness   || null,
    user:        raw.user        || null,
    _cached:     !!raw._cached,
    _lastSync:   (raw.meta && raw.meta.generatedAt) || new Date().toISOString(),
  };
}

function applySheetThresholds(rows){
  if(!Array.isArray(rows) || !rows.length) return;
  rows.forEach(function(r){
    if(r.key && thresholds[r.key]){
      const v = +r.value;
      if(!isNaN(v)) thresholds[r.key].val = v;
    }
  });
}

// ═════════════════════════════════════════
// LOCAL CACHE — one stored payload per game + range
// ═════════════════════════════════════════
//
// The sheet is append-only and weeklysync.gs appends once a week, on Monday
// morning. Between syncs the data is byte-for-byte static, so a stored payload
// is not merely "probably still good" — it is exactly what the server would
// rebuild. That is why the cache is used first and revalidated afterwards,
// never the other way round.
//
// Freshness is decided by meta.dataVersion, which the server derives from the
// row counts of the append-only tabs. It moves only when rows were actually
// added, so a warm cycle that changed nothing no longer forces a download.
const LS_PREFIX  = 'mssdash.v3.';
const LOCAL_CACHE_ENABLED = true;
// Bump this whenever the payload shape changes — it invalidates every stored
// copy. Must be bumped alongside PAYLOAD_VERSION in Code.gs.
const LS_SCHEMA  = '2026-09-02-v31';   // v31: Sheet1 bundled in fetchAll
// A stored copy is dropped after this even if the version still matches, so a
// forgotten tab cannot show week-old figures indefinitely.
const LS_MAX_AGE = 12 * 60 * 60 * 1000;

function lsKey(gameId, from, to){
  return LS_PREFIX + gameId + '.' + (from || dateFrom) + '_' + (to || dateTo);
}

/** The version stamp a payload carries, or '' when it predates the stamp. */
function payloadVersion(payload){
  return (payload && payload.meta && payload.meta.dataVersion) || '';
}

/** A cached payload is only usable if it answers the range now on screen. */
function cacheUsable(box){
  if(!box || !box.payload) return false;
  if(box.schema !== LS_SCHEMA) return false;
  const m = box.payload.meta;
  if(!m) return false;                        // pre-versioning payload
  if(m.from !== dateFrom || m.to !== dateTo) return false;
  return true;
}

/**
 * Reads the stored payload for one explicit range.
 *
 * Every failure mode lands on the same answer — null — so the caller simply
 * falls through to a normal fetch: a missing key, a quota-truncated write, a
 * hand-edited or otherwise corrupted entry, a stale schema, or a payload that
 * answers a different range. A corrupted entry is deleted rather than left to
 * fail the same way on every future load.
 */
function readCache(gameId, from, to){
  if(!LOCAL_CACHE_ENABLED) return null;
  const key = lsKey(gameId, from, to);
  let box;
  try {
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    box = JSON.parse(raw);
  } catch(e){
    // Unparseable — drop it so this is not re-attempted on every load.
    try { localStorage.removeItem(key); } catch(e2){}
    return null;
  }
  try {
    if(!box || !box.payload || box.schema !== LS_SCHEMA){
      try { localStorage.removeItem(key); } catch(e2){}
      return null;
    }
    if(Date.now() - (box.savedAt || 0) > LS_MAX_AGE) return null;
    const m = box.payload.meta;
    if(!m || m.from !== from || m.to !== to) return null;
    return box;
  } catch(e){ return null; }
}

/**
 * Stores one payload. The version comes out of the payload itself, so writing
 * no longer costs an extra request just to label the entry.
 *
 * On quota exhaustion every OTHER entry we own is evicted and the write is
 * retried once — one current payload is worth more than a full set of stale
 * ones. If it still will not fit, the write is abandoned silently: the network
 * path is unaffected and the dashboard works exactly as it did before caching.
 */
function writeCache(gameId, payload, from, to){
  if(!LOCAL_CACHE_ENABLED) return false;
  const key = lsKey(gameId, from, to);
  const box = JSON.stringify({
    schema: LS_SCHEMA,
    dataVersion: payloadVersion(payload),
    savedAt: Date.now(),
    payload: payload
  });

  try {
    localStorage.setItem(key, box);
    return true;
  } catch(e){
    // Evict the OLDEST entry and retry, repeatedly. The previous version wiped
    // every other range on the first failure, so storing "last 4 weeks" threw
    // away "last 2 weeks" and going back threw away the one just stored —
    // every switch was a cold fetch in both directions, permanently.
    for(let attempt = 0; attempt < 12; attempt++){
      const others = Object.keys(localStorage)
        .filter(k => k.indexOf(LS_PREFIX) === 0 && k !== key)
        .map(function(k){
          let savedAt = 0;
          try { savedAt = (JSON.parse(localStorage.getItem(k)) || {}).savedAt || 0; } catch(e2){}
          return { key: k, savedAt: savedAt };
        })
        .sort(function(a, b){ return a.savedAt - b.savedAt; });

      if(!others.length) break;
      try { localStorage.removeItem(others[0].key); } catch(e2){}

      try {
        localStorage.setItem(key, box);
        console.info('[dash] evicted ' + (attempt + 1) + ' oldest range(s) to store this one');
        return true;
      } catch(e2){ /* still too big — evict the next oldest */ }
    }

    console.warn('[dash] could not store payload — running uncached');
    try { localStorage.removeItem(key); } catch(e3){}   // never leave a half-write
    return false;
  }
}

/** Removes one stored range. Used when a payload turns out to be unusable. */
function dropCache(gameId, from, to){
  try { localStorage.removeItem(lsKey(gameId, from, to)); } catch(e){}
}

function lsClearAll(){
  try {
    Object.keys(localStorage)
      .filter(k => k.indexOf(LS_PREFIX) === 0)
      .forEach(k => localStorage.removeItem(k));
  } catch(e){}
}

/**
 * Tiny call — the server's current data version, no payload.
 *
 * Used only to decide whether a stored copy is out of date. Returns null on any
 * failure, which the callers read as "assume unchanged": a status call that
 * cannot be made is never a reason to throw away a good cached render.
 */
async function fetchDataVersion(){
  try {
    const token = getToken();
    const url = SHEET_API_URL + '?action=cacheStatus&key=' + encodeURIComponent(SHEET_API_KEY)
      + (token ? '&token=' + encodeURIComponent(token) : '') + '&_cb=' + Date.now();
    const res = await fetch(url, { redirect:'follow', cache:'no-store' });
    if(!res.ok) return null;
    const data = await res.json();
    if(!data || data.error) return null;
    return data.dataVersion ? String(data.dataVersion) : null;
  } catch(e){ return null; }
}

// ── Backend fetch: server does the date filtering and aggregation ──
async function fetchFromSheet(gameId, opts){
  opts = opts || {};
  const token = getToken();
  // The backend now rejects a half-specified range. Make sure we never send one:
  // an empty date used to be silently widened to "today" server-side.
  if(!dateFrom || !dateTo){
    applyPresetToInputs(activeRange && activeRange > 1 ? activeRange : 14);
  }

  const params = [
    'action=fetchAll',
    'key='   + encodeURIComponent(SHEET_API_KEY),
    'gameId='+ encodeURIComponent(gameId),
    'from='  + encodeURIComponent(dateFrom || ''),
    'to='    + encodeURIComponent(dateTo   || ''),
    token ? 'token=' + encodeURIComponent(token) : '',
    opts.refresh ? 'refresh=1' : '',
    '_cb=' + Date.now()
  ].filter(Boolean).join('&');

  const res = await fetch(SHEET_API_URL + '?' + params, { redirect:'follow', cache:'no-store' });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if(data.error){
    if(data.code === 'AUTH'){ doLogout(); throw new Error('Session expired'); }
    if(data.code === 'BAD_RANGE'){ console.warn('[dash] backend rejected the range:', data.error); }
    throw new Error(data.error);
  }
  return data;
}

let _reqSeq = 0;

async function loadGameData(gameId, opts){
  opts = opts || {};

  // Sequence each load. Editing FROM fires one request and editing TO fires
  // another; whichever RESPONDS last used to win, which is how a wider range
  // overwrote the one actually selected.
  const myReq   = ++_reqSeq;
  const reqFrom = dateFrom, reqTo = dateTo;
  const isStale = function(){ return myReq !== _reqSeq || reqFrom !== dateFrom || reqTo !== dateTo; };

  // A payload is only usable if it answers the exact range that was requested.
  const rangeOk = function(payload){
    const m = payload && payload.meta;
    return !!(m && m.from === reqFrom && m.to === reqTo);
  };

  try {
    let raw = null, source = 'network';

    if(!opts.refresh && !opts.noLocal){
      // Use the stored copy straight away rather than waiting on a version
      // check first — that check was a network round trip in front of every
      // "cached" load, which defeated the point of caching. Freshness is
      // handled afterwards by revalidateInBackground().
      const local = readCache(gameId, reqFrom, reqTo);
      if(local){
        raw = local.payload;
        source = 'local';
        revalidateInBackground(gameId, payloadVersion(local.payload));
      }
    }

    if(!raw){
      raw = await fetchFromSheet(gameId, opts);
      // Keyed by the range it answers, so switching presets finds it later.
      // The payload carries its own version stamp, so storing it no longer
      // needs a second request to label the entry.
      if(rangeOk(raw)){
        writeCache(gameId, raw, reqFrom, reqTo);
        // Baseline for the version gate. Without this the first visit would
        // compare against an empty string and refetch everything on the second.
        rememberDataVersion(payloadVersion(raw));
      }
    }

    if(isStale()) return { ok:true, superseded:true };

    // Hard stop: never render figures for a range nobody asked for. A backend
    // that silently widens a request (empty "to" defaulting to today) produced
    // 37-day acquisition numbers on a 14-day selection. Retry once forcing a
    // rebuild; if it still comes back wrong, show an error instead of numbers
    // that look plausible but answer a different question.
    if(!rangeOk(raw)){
      const m = (raw && raw.meta) || {};
      console.warn('[dash] range mismatch — asked ' + reqFrom + ' → ' + reqTo
        + ', got ' + m.from + ' → ' + m.to + (opts.refresh ? '' : '; retrying'));
      if(!opts.refresh) return await loadGameData(gameId, { refresh:true });

      DATA[gameId] = emptyDataShell();
      DATA[gameId].meta = { from: reqFrom, to: reqTo };
      DATA[gameId]._fetchError = 'Server returned ' + m.from + ' → ' + m.to
        + ' instead of ' + reqFrom + ' → ' + reqTo + '. Redeploy Code.gs as a new version.';
      feedback = [];
      return { ok:false, error: DATA[gameId]._fetchError };
    }

    const normalized = normalizeSheetData(raw);
    normalized._source = source;
    DATA[gameId] = normalized;
    /* Who this is and what they may see comes from the SERVER only. A copy
       stored in the browser carries the user record from when it was saved -
       one saved before teams existed has no access at all, which read as
       "no pages" and left only User Management on screen after a range
       change. Those copies still supply the data; never the access. */
    if(source !== 'local') applyUserRecord(raw.user);
    applySheetThresholds(raw.thresholds || []);
    feedback = (normalized.feedback || []).slice();
    return { ok:true, raw: raw, source: source };

  } catch(err) {
    if(isStale()) return { ok:true, superseded:true };
    console.error('[dash] load failed for', gameId, err);

    // Offline fallback — only a local copy matching this exact range.
    const local = readCache(gameId, reqFrom, reqTo);
    if(cacheUsable(local) && rangeOk(local.payload)){
      DATA[gameId] = normalizeSheetData(local.payload);
      DATA[gameId]._source = 'local-stale';
      feedback = (DATA[gameId].feedback || []).slice();
      return { ok:true, raw: local.payload, source:'local-stale', warning: err.message };
    }
    DATA[gameId] = emptyDataShell();
    DATA[gameId].meta = { from: reqFrom, to: reqTo };
    DATA[gameId]._fetchError = err.message;
    feedback = [];
    return { ok:false, error: err.message };
  }
}

function emptyDataShell(){
  return {
    meta:{}, sections:[], daily:[], retention:[],
    ftue:{base:0,steps:[],tenMin:[]}, ftueSteps:[], ftueBase:0, tenMin:[],
    shopLevels:[], dayCounts:[], progWindow:null,
    stability:[], ratings:{daily:[]},
    ua:{daily:[],channels:[],campaigns:[]},
    roasCurve:{points:[]}, stickiness:{daily:[],stickiness:null},
    monetization:{networks:[],ltv:[],whale:[],ftp:[]},
    engagement:{adCohort:null,placements:[],cohortDayKeys:[]},
    conversions:[], liveops:[], benchmark:[], feedback:[], missing:{}, freshness:null,
    us:null,
    retentionRaw:{}, retCohorts:[], retSummary:{}, retByPlatform:{},
    retDays:['d1','d2','d3','d4','d5','d6','d7','d14'], curveAvailable:false,
    platform:'android', platformNotes:{}
  };
}

// ── Empty-state helper for cards with no source yet ──
const sparkCharts = {};
function getSparkTip(){
  let tip = document.getElementById('sparkTip');
  if(!tip){
    tip = document.createElement('div');
    tip.id = 'sparkTip';
    tip.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:rgba(7,11,20,0.97);border-radius:8px;padding:8px 12px;font-family:var(--sans);font-size:11px;color:#E8ECFF;box-shadow:0 6px 24px rgba(0,0,0,0.5);opacity:0;transition:opacity .08s;white-space:nowrap';
    document.body.appendChild(tip);
  }
  return tip;
}

function drawSpark(id, data, color, fmt, dates){
  const c = g(id); if(!c) return;
  const label = c.closest('.kpi')?.querySelector('.kpi-label')?.textContent.trim();
  if(label) color = kpiAccent(label);
  if(sparkCharts[id]){ try{sparkCharts[id].destroy();}catch(e){} delete sparkCharts[id]; }

  const vals = (data || []).map(v => (v == null || v === '') ? null : +v);
  if(vals.filter(v => v != null).length < 2) return;

  const formatter = fmt || fmtKn;

  const fmtDate = (iso) => {
    if(!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if(isNaN(d)) return iso;
    return d.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short' });
  };

  const ctx = c.getContext('2d');
  const h = c.offsetHeight || 28;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '66');
  grad.addColorStop(1, color + '00');

  // Put the series crest on the same horizontal line as the card's headline
  // value. Since the scale begins at zero, extending its ceiling moves the
  // peak down without distorting the series or changing the filled baseline.
  const nums = vals.filter(v => v != null && isFinite(v));
  const peak = nums.length ? Math.max.apply(null, nums) : 0;
  const card = c.closest('.kpi.has-spark');
  const value = card && card.querySelector('.kpi-val');
  const canvasRect = c.getBoundingClientRect();
  const valueRect = value && value.getBoundingClientRect();
  const valueMid = valueRect && canvasRect.height
    ? ((valueRect.top + valueRect.height / 2) - canvasRect.top) / canvasRect.height
    : 0.55;
  const peakLine = Math.max(0.35, Math.min(0.72, valueMid));
  const sparkMax = peak > 0 ? peak / (1 - peakLine) : undefined;

  /* Dashboard design (design/hub/pro-theme.js sets html.pro-theme): the graph
     is a band along the bottom of the card. It starts from 0 at the
     bottom-left corner and rises into the series, which fills the band
     (lowest point near the bottom edge). */
  const pro = document.documentElement.classList.contains('pro-theme');
  const lo = nums.length ? Math.min.apply(null, nums) : 0;
  const span = (peak - lo) || Math.abs(peak) * 0.1 || 1;
  const proMin = lo - span * 0.12;
  const proMax = peak + span * 0.2;
  const off = pro ? 1 : 0;                       // the leading 0 anchor point
  const plotted = pro ? [proMin].concat(vals) : vals;

  sparkCharts[id] = new Chart(c, {
    type: 'line',
    data: {
      labels: (pro ? [''] : []).concat(vals.map((_, i) => (dates && dates[i]) ? dates[i] : i)),
      datasets: [{
        data: plotted,
        borderColor: color,
        backgroundColor: grad,
        borderWidth: 1.8,
        pointRadius: 0,
        pointHoverRadius: 3.5,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 1.5,
        fill: true,
        tension: 0.4,
        spanGaps: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: (context) => {
            const tip = getSparkTip();
            const tt = context.tooltip;
            if(tt.opacity === 0){ tip.style.opacity = '0'; return; }
            if(!tt.dataPoints || !tt.dataPoints.length){ tip.style.opacity = '0'; return; }

            const i = tt.dataPoints[0].dataIndex - off;
            if(i < 0){ tip.style.opacity = '0'; return; }   // the 0 anchor, not data
            const cur = vals[i];
            const dateLbl = (dates && dates[i]) ? fmtDate(dates[i]) : '';

            // Find previous non-null value
            let prev = null;
            for(let j = i - 1; j >= 0; j--){ if(vals[j] != null){ prev = vals[j]; break; } }
            let diffLine = '';
            if(cur != null && prev != null){
              const diff = cur - prev;
              const pct = prev !== 0 ? (diff / Math.abs(prev) * 100) : 0;
              const arrow = diff > 0 ? '▲' : (diff < 0 ? '▼' : '•');
              const sign = diff > 0 ? '+' : '';
              /* Was three literals from the old palette, and dark-mode ones at
                 that - so in light mode this tooltip drew neon on white. Reading
                 chartColors() fixes the hue and the theme in one go. */
              const cc = chartColors();
              const col = diff > 0 ? cc.lime : (diff < 0 ? cc.coral : cc.text);
              diffLine = `<div style="font-size:10px;color:${col};margin-top:3px">vs prev: ${arrow} ${sign}${formatter(diff)} (${sign}${pct.toFixed(1)}%)</div>`;
            }

            tip.innerHTML =
              (dateLbl ? `<div style="font-weight:600;color:#E8ECFF;margin-bottom:3px">${dateLbl}</div>` : '')
              + `<div style="font-family:var(--mono);font-size:13px;color:${color};font-weight:600">${formatter(cur)}</div>`
              + diffLine;

            // Position above the canvas, escaping the card bounds
            const rect = context.chart.canvas.getBoundingClientRect();
            tip.style.opacity = '1';
            // Wait for layout to get size
            const tipRect = tip.getBoundingClientRect();
            let left = rect.left + tt.caretX - tipRect.width / 2;
            let top = rect.top - tipRect.height - 8;
            // Keep within viewport
            if(left < 6) left = 6;
            if(left + tipRect.width > window.innerWidth - 6) left = window.innerWidth - tipRect.width - 6;
            if(top < 6) top = rect.bottom + 8; // if no room above, show below
            tip.style.left = left + 'px';
            tip.style.top = top + 'px';
          }
        }
      },
      // Layout has no padding, so the curve reaches the card edges and the
      // fill sits flush against the bottom instead of floating in a box.
      layout: { padding: 0 },
      scales: {
        x: { display: false, offset: false,
             bounds: 'data', grid: { display: false }, border: { display: false } },
        // Anchored at zero so bar height is proportional to value — a series
        // that only moves between 900 and 1000 must not look like it triples.
        // The dynamic ceiling places the crest level with this card's value.
        y: {
          display: false, beginAtZero: !pro, min: pro ? proMin : 0, grid: { display: false },
          border: { display: false },
          max: pro ? proMax : sparkMax
        }
      }
    }
  });

  // Hide tooltip when mouse leaves the card
  c.addEventListener('mouseleave', () => {
    const tip = document.getElementById('sparkTip');
    if(tip) tip.style.opacity = '0';
  });
}


function fbHtml(f){
  return `<div class="fb-item ${f.category}">
    <div class="fb-meta">
      <span class="fb-author">${f.author}</span>
      <span class="fb-tag ${f.category}">${f.category}</span>
      <span class="fb-date">${f.date}</span>
    </div>
    <div class="fb-text">${f.text}</div>
  </div>`;
}

function noData(reason){
  return '<div class="notice" style="text-align:center;padding:26px 16px">'
    + '<div style="font-size:20px;margin-bottom:8px;opacity:.5">◔</div>'
    + '<div style="font-weight:600;color:var(--text2);margin-bottom:4px">No data source connected</div>'
    + '<div style="font-size:11px;color:var(--text3)">' + (reason || 'Pending Cellar integration') + '</div>'
    + '</div>';
}

/**
 * Retention / ROAS cells for the UA tables.
 *
 * A cohort that has not matured reports nothing, and the sheet leaves those
 * cells blank on purpose. Rendering a dash keeps that distinct from a real
 * 0%, which would claim the cohort returned nothing — a different statement.
 * D28 ROAS and D30 retention are blank for any recent range, so this is the
 * normal case on these two cards, not an edge case.
 */
function pctCell(v){
  return (v===null||v===undefined||v==='') ? '—' : (+v).toFixed(1)+'%';
}

function roasCell(v){
  return (v===null||v===undefined||v==='') ? '—' : (+v).toFixed(0)+'%';
}

function roasCls(v){
  if(v===null||v===undefined||v==='') return '';
  return v>=100 ? 'pill-good' : v>=70 ? 'pill-warn' : 'pill-bad';
}

/**
 * The "last updated" the header shows is the newest date present in the SHEET
 * (meta.lastUpdated), not the moment this page happened to render. On a cached
 * render those two are hours or days apart, and the render time was the more
 * reassuring and less true of the pair.
 */
function lastUpdatedLabel(){
  const m = (DATA[currentGame] && DATA[currentGame].meta) || {};
  return m.lastUpdated ? ('Data to ' + m.lastUpdated) : '';
}

function setSyncState(state, info){
  const el  = g('syncInfo');
  const dot = document.querySelector('.sync-dot');
  const time = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

  if(state === 'live'){
    if(dot){ dot.style.background = 'var(--lime)'; dot.style.boxShadow = '0 0 8px var(--lime)'; }
    const upd = lastUpdatedLabel();
    el.textContent = upd ? (upd + ' · checked ' + time) : ('Live · ' + time);
  } else if(state === 'loading'){
    if(dot){ dot.style.background = 'var(--amber)'; dot.style.boxShadow = '0 0 8px var(--amber)'; }
    el.textContent = info ? ('Loading ' + info + '…') : 'Loading…';
  } else if(state === 'error'){
    if(dot){ dot.style.background = 'var(--coral)'; dot.style.boxShadow = '0 0 8px var(--coral)'; }
    let msg = 'Error';
    if(info === 'FILE_PROTOCOL') msg = 'Open via localhost';
    else if(info === 'NETWORK')  msg = 'Offline';
    else if(info === 'AUTH')     msg = 'Auth failed';
    else if(info)                msg = 'Error: ' + info;
    el.textContent = msg + ' · ' + time;
  }
}

function showFileProtocolWarning(){
  if(document.getElementById('fileProtoToast')) return;
  const div = document.createElement('div');
  div.id = 'fileProtoToast';
  div.style.cssText = 'position:fixed;top:70px;right:20px;max-width:340px;z-index:999;background:var(--surface);border:1px solid var(--border2);border-left:3px solid var(--amber);border-radius:var(--r);padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,0.35);font-size:12px;line-height:1.55;color:var(--text2);font-family:var(--sans)';
  div.innerHTML = '<div style="font-weight:600;color:var(--amber);margin-bottom:6px">⚠ file:// mode</div>' +
    'Dashboard is opened as a local file — browser security blocks network fetch.<br><br>' +
    'Use a local server (VS Code <b>Live Server</b>, <code style="color:var(--cyan)">python -m http.server</code>) or host it online, then reload.' +
    '<div style="margin-top:10px;text-align:right"><span onclick="this.closest(\'#fileProtoToast\').remove()" style="cursor:pointer;color:var(--cyan);font-family:var(--mono);font-size:10px">DISMISS</span></div>';
  document.body.appendChild(div);
}

// ═════════════════════════════════════════
// (Demo data generator removed — dashboard shows live data only)
// ═════════════════════════════════════════
// ═════════════════════════════════════════
// INSTANT BOOT & BACKGROUND PREFETCH
// ═════════════════════════════════════════
//
// First paint must not wait on the network. A stored payload for the default
// range is rendered immediately, then revalidated in the background: if the
// server's build id has moved on, the fresh copy replaces it and the page
// re-renders. Repeat visits are therefore instant and still end up current.
//
// Once the dashboard is up and idle, the 30-day view is fetched, and after that
// the preceding 30 days. Both land in localStorage, so clicking "Last 30 days"
// is instant too. Prefetches never touch what is on screen.

const PREFETCH_DELAY_MS = 1200;    // let first paint and its charts finish
const PREFETCH_GAP_MS   = 800;     // breathing room between the two windows

/**
 * "Today" as the SHEET reckons it, not the browser.
 *
 * The server builds and warms every range against the spreadsheet's timezone
 * (Asia/Karachi). The client used toISOString(), which is UTC — five hours
 * behind. Between midnight and 05:00 local the two disagree by a day, so the
 * dashboard asked for a window ending yesterday, missed every warmed cache key,
 * and paid for a 30-100s cold build. Same clock on both ends, or the warm is
 * useless for part of every day.
 */
const SHEET_TZ = 'Asia/Karachi';

function isoInSheetTz(d){
  // en-CA formats as yyyy-mm-dd, which is the format the API expects.
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: SHEET_TZ, year:'numeric', month:'2-digit', day:'2-digit'
    }).format(d);
  } catch(e){
    return d.toISOString().slice(0,10);      // no Intl: UTC is better than nothing
  }
}

function sheetToday(){ return isoInSheetTz(new Date()); }

/**
 * The last day that is finished. Every default range ends here.
 *
 * Presets used to run to sheetToday(), so "Last 14 days" meant today-13 ..
 * today - and today is a part-day. Whatever hours of it had been synced were
 * shown as the day's total. A partial day is not visibly partial; it just
 * looks like a bad day, and then it changes by itself overnight.
 *
 * It moved more than the last bar. Every total, average and week-over-week
 * comparison was measured over a window with that hole in it.
 *
 * mxDates already stepped back a day for this reason, in one place, with the
 * note "Today is still filling, so it can never close a week." That was right
 * and it was the only place doing it. This is the same idea, named once and
 * used everywhere a range end is defaulted.
 */
function dataThrough(){ return isoShift(sheetToday(), -1); }

/* isoDaysAgo(n) used to live here. Nothing calls it now that every range end
   comes from dataThrough(), and leaving it would leave a ready-made way to
   build a window ending today for whoever needs one next. */

/**
 * The background queue, in the order a user is most likely to need it.
 *
 * The OTHER platform's default view comes first: switching Android ⇄ iOS is a
 * single click and by far the most common next action, whereas widening to 30
 * days takes a deliberate choice. Deeper history goes last.
 */
/** Every preset the range dropdown offers. Custom ranges are not warmed. */
const PRESET_DAYS = [14, 30, 60, 90];

/**
 * The complete set of views worth holding locally: every preset for every
 * platform, plus the progression window each platform opens on.
 *
 * The data is append-only and changes once a week, so a view fetched after a
 * sync stays correct until the next one. Warming the whole matrix costs a few
 * background requests on the Monday a sync lands, and buys instant switching —
 * platform or range — for the rest of the week.
 *
 * Ordered by how soon it is likely to be needed: the other platform at the
 * range now on screen comes first, because switching platform is one click.
 */
function prefetchQueue(currentGameId){
  const ids    = (games || []).map(function(x){ return x.id; });
  const others = ids.filter(function(id){ return id !== currentGameId; });
  const prog   = progWindow();
  const queue  = [];
  const seen   = {};

  const add = function(gameId, from, to, label){
    const k = gameId + '|' + from + '|' + to;
    if(seen[k]) return;                       // never queue the same view twice
    seen[k] = true;
    queue.push({ gameId: gameId, from: from, to: to, label: label });
  };

  // 1. the other platform, at exactly what is on screen now
  others.forEach(function(id){ add(id, dateFrom, dateTo, id + ' — current view'); });

  // 2. every preset, current platform first, then the others
  PRESET_DAYS.forEach(function(days){
    /* The warm windows have to be the SAME windows a preset asks for, or
       every preset misses the cache it was meant to hit - the server keys on
       from+to. Both ends now come from dataThrough(). */
    const end = dataThrough();
    const w = { from: isoShift(end, -(days - 1)), to: end };
    add(currentGameId, w.from, w.to, 'last ' + days + ' days');
    others.forEach(function(id){ add(id, w.from, w.to, id + ' last ' + days + ' days'); });
  });

  // 3. the progression window, which Progress Events opens on independently
  ids.forEach(function(id){ add(id, prog.from, prog.to, id + ' progression window'); });

  return queue;
}

/**
 * Fetches one explicit range. Deliberately does NOT read dateFrom/dateTo, so a
 * prefetch can never be mistaken for the range the user is looking at.
 */
async function fetchRange(gameId, from, to){
  const token = getToken();
  const params = [
    'action=fetchAll',
    'key='    + encodeURIComponent(SHEET_API_KEY),
    'gameId=' + encodeURIComponent(gameId),
    'from='   + encodeURIComponent(from),
    'to='     + encodeURIComponent(to),
    token ? 'token=' + encodeURIComponent(token) : '',
    '_cb=' + Date.now()
  ].filter(Boolean).join('&');

  const res = await fetch(SHEET_API_URL + '?' + params, { redirect:'follow', cache:'no-store' });
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if(data.error) throw new Error(data.error);
  return data;
}

/** Stores one range in localStorage. Silent by design — nothing on screen changes. */
async function prefetchRange(gameId, from, to, label){
  if(readCache(gameId, from, to)) return 'cached';
  try {
    const raw = await fetchRange(gameId, from, to);
    const m = raw && raw.meta;
    // Only store a payload that answers the range asked for.
    if(!m || m.from !== from || m.to !== to) return 'range-mismatch';
    writeCache(gameId, raw, from, to);
    console.info('[dash] prefetched ' + label + ' (' + from + ' → ' + to + ')');
    return 'ok';
  } catch(e){
    console.warn('[dash] prefetch failed for ' + label + ': ' + e.message);
    return 'failed';
  }
}

/**
 * Runs after the dashboard is interactive. Strictly one request at a time —
 * firing these in parallel would compete with whatever the user does next, and
 * the point of prefetching is that they never notice it.
 */
let _prefetchRunning = false;

let _prefetchDone = false;

/**
 * Fills the local store with every preset for every platform.
 *
 * Runs once per data version. Between Monday syncs there is nothing new to
 * fetch, so a second call is a no-op — the queue is skipped entirely rather
 * than re-requesting windows that are already held and still correct.
 *
 * One request at a time, spaced out: Apps Script serves a single request per
 * user, so an eager queue would sit in front of whatever the user clicks next.
 */
function schedulePrefetch(gameId, opts){
  opts = opts || {};
  if(!LOCAL_CACHE_ENABLED || !SHEET_API_URL) return;
  if(location.protocol === 'file:') return;
  if(_prefetchRunning) return;                 // a queue is already draining
  if(_prefetchDone && !opts.force) return;     // matrix already warm for this version
  _prefetchRunning = true;

  setTimeout(async function(){
    let fetched = 0, held = 0;
    try {
      const queue = prefetchQueue(gameId);
      for(let i = 0; i < queue.length; i++){
        const q = queue[i];
        const outcome = await prefetchRange(q.gameId, q.from, q.to, q.label);
        if(outcome === 'cached') { held++; continue; }   // already stored, no request made
        fetched++;
        if(i < queue.length - 1) await new Promise(r => setTimeout(r, PREFETCH_GAP_MS));
      }
      _prefetchDone = true;
      if(fetched) console.info('[dash] warmed ' + fetched + ' view(s), ' + held + ' already held');
    } finally { _prefetchRunning = false; }
  }, PREFETCH_DELAY_MS);
}

/**
 * Checks the server's data version after a cached render, and refetches only if
 * rows were actually appended. Between Monday syncs that is never, so the usual
 * case costs one tiny request and no redraw at all.
 *
 * A failure here is deliberately quiet in one direction and loud in the other:
 * if the version call cannot be made we assume nothing changed and leave the
 * cached render alone, but if we KNOW the data moved and then fail to fetch it,
 * the user is told the figures on screen are behind.
 */
const LS_VERSION_KEY = LS_PREFIX + 'dataVersion';

function storedDataVersion(){
  try { return localStorage.getItem(LS_VERSION_KEY) || ''; } catch(e){ return ''; }
}
function rememberDataVersion(v){
  try { if(v) localStorage.setItem(LS_VERSION_KEY, v); } catch(e){}
}

/**
 * Drops every stored payload. Used when the server reports a new dataVersion —
 * the weekly sync has appended rows, so every cached range is now short of the
 * newest days and must be rebuilt rather than patched.
 */
function dropAllPayloads(){
  try {
    Object.keys(localStorage)
      .filter(function(k){ return k.indexOf(LS_PREFIX) === 0 && k !== LS_VERSION_KEY; })
      .forEach(function(k){ localStorage.removeItem(k); });
  } catch(e){}
}

async function revalidateInBackground(gameId, cachedVersion){
  let serverVersion = null;
  try {
    serverVersion = await fetchDataVersion();
  } catch(e){
    return;                                   // cannot tell — leave it alone
  }
  if(!serverVersion || serverVersion === cachedVersion){
    // Nothing has been appended since this copy was taken, and rows never
    // change in place — so the local copy is not merely usable, it is correct.
    // No payload is fetched at all between Monday syncs.
    return;
  }

  console.info('[dash] server data changed (' + cachedVersion + ' → ' + serverVersion + ')');
  dropAllPayloads();

  try {
    const result = await loadGameData(gameId, { refresh:true });
    if(result.ok && !result.superseded){
      feedback = (DATA[gameId] && DATA[gameId].feedback || []).slice();
      renderAll();
      markSource('network');
      rememberDataVersion(serverVersion);
      console.info('[dash] refreshed — new data on the server');
      // Rebuild the rest of the matrix in the background so the first click on
      // any other range or platform is instant again.
      schedulePrefetch(gameId, { force:true });
    } else if(!result.ok){
      noteStaleData(gameId);
    }
  } catch(e){
    noteStaleData(gameId);
  }
}

/**
 * The cached render stays on screen, but says so. Reached only when the server
 * has confirmed newer data exists and we then failed to download it — showing
 * figures we know are behind without a word would be the worse outcome.
 */
function noteStaleData(gameId){
  const d = DATA[gameId];
  if(d) d._staleNotice = true;
  console.warn('[dash] newer data exists but could not be fetched — showing the cached copy');
  try { renderFreshness(DATA[currentGame]); } catch(e){}
}

// ═════════════════════════════════════════
// INIT
// ═════════════════════════════════════════
async function init(){
  /* The hub used to make this check and is gone. Without it a mis-set build
     variable surfaces deep inside a report as an unexplained "could not reach
     the web app"; with it, one clear message at boot naming the variable. */
  try { assertConfigured(); }
  catch (e) { setSyncState('error', e.message); showLoadingOverlay(false); throw e; }

  // Older builds stored payloads without a schema stamp. Clear them once so a
  // pre-fix copy can never be resurrected by the offline fallback.
  try {
    Object.keys(localStorage).filter(k => k.indexOf(LS_PREFIX) === 0).forEach(function(k){
      let ok = false;
      try { ok = (JSON.parse(localStorage.getItem(k)) || {}).schema === LS_SCHEMA; } catch(e){}
      if(!ok) localStorage.removeItem(k);
    });
  } catch(e){}

  // Show loading state — no demo data
  setSyncState('loading');
  showLoadingOverlay(true);

  // The allowed games now ride along on the payload, so the blocking
  // ?action=listGames round trip that used to sit in front of every single page
  // load is gone. Start from the known set; the payload confirms or corrects it
  // a moment later, and applyGameList() re-renders the picker if it differs.
  applyGameList(DEFAULT_GAMES);
  applyPresetToInputs(14);

  /* ── Sign-in path: current access and current data, nothing older ──
   *
   * The browser's stored payload is NOT drawn at sign-in. It carried the team
   * and access from whenever it was saved, so the dashboard opened on the
   * pages someone used to have - and, before access arrived, on every page.
   *
   * Both requests go out together and nothing is painted until both answer:
   * myAccess says which pages this person may open, and the data comes from
   * the server rather than from localStorage. The loading screen covers the
   * wait. Stored payloads are still written, and still used when the range
   * changes later in the session. */
  CU = CU || { username: '', name: '', role: 'viewer' };
  CU.access = null;                         // unknown until the server answers
  _booting = true;                          // applyUserRecord records, does not draw
  let boot;
  try {
    boot = await Promise.all([
      refreshMyAccess(),
      loadGameData(currentGame, { noLocal:true })
    ]);
  } finally { _booting = false; }
  const result = boot[1];
  if(result.ok){
    if(result.raw && result.raw.games) applyGameList(result.raw.games);
    setSyncState('live');
    markSource(result.source);
  } else {
    setSyncState('error', result.error);
  }

  feedback = (DATA[currentGame] && DATA[currentGame].feedback || []).slice();

  /* Everything that paints, in one guarded block.
   *
   * showLoadingOverlay(false) used to sit at the end of a bare sequence, so
   * anything throwing on the way - buildNav, goTab, updateRangeLabel - left
   * the overlay up with no error anywhere a person could see it. The symptom
   * was a blank page after signing in, which says nothing about the cause and
   * is the hardest kind of failure to report.
   *
   * renderAll already guards each section individually. This guards the rest,
   * and puts the message on screen instead of only in the console. */
  try {
    // Both a fresh sign-in and a restored session start from Overview.
    currentTab = 'overview';
    buildNav();
    restoreSidebarState();
    renderAll();
    goTab(currentTab);
    updateRangeLabel();
    // Only when access is actually known: a failed request is an error, not "no pages".
    showNoAccess(!!(CU && CU.access) && !getEnabledSections().length);
  } catch (e) {
    console.error('[dash] boot failed while drawing:', e);
    setSyncState('error', e.message || String(e));
    const box = g('freshBanner');
    if(box) box.innerHTML = '<div class="fresh-warn"><span>&#9888; <b>The dashboard could not '
      + 'finish drawing.</b> ' + String(e && e.message || e) + '</span>'
      + '<button onclick="hardReset()">Clear cache &amp; reload</button></div>';
  } finally {
    // Always. A stuck overlay is indistinguishable from a hung page.
    showLoadingOverlay(false);
  }

  // The dashboard is now interactive. Everything below is background work and
  // must never block or alter what is on screen.
  schedulePrefetch(currentGame);
  startVersionPoll();
}

/**
 * Someone with no team, or a team with no pages, would otherwise land on an
 * Overview they are not allowed to see. Every page is hidden and they are
 * told who can fix it.
 */
function showNoAccess(on){
  let el = document.getElementById('noAccessMsg');
  document.querySelectorAll('.tab-pane').forEach(function(p){ if(on) p.classList.remove('on'); });
  if(!on){ if(el) el.remove(); return; }
  if(!el){
    el = document.createElement('div');
    el.id = 'noAccessMsg';
    el.className = 'notice';
    el.style.cssText = 'margin:48px auto;max-width:520px;text-align:center;font-size:15px;line-height:1.6';
    const pane = document.querySelector('.tab-pane');
    (pane && pane.parentNode ? pane.parentNode : document.body).appendChild(el);
  }
  el.innerHTML = '<b>You do not have access to any pages yet.</b><br>'
    + 'Ask someone in the Data team to add you to a team in User Management.';
}

/** The two games this dashboard covers. Used until the payload confirms them. */
const DEFAULT_GAMES = [
  { id:'mss_android', name:'MSS — Android' },
  { id:'mss_ios',     name:'MSS — iOS' }
];

/**
 * Points the picker at a games list, from the payload or from the default.
 * Idempotent: re-applying the same list changes nothing on screen.
 */
function applyGameList(list){
  const next = (Array.isArray(list) ? list : [])
    .filter(function(x){ return x && (x.id === 'mss_android' || x.id === 'mss_ios'); });
  const use = next.length ? next : DEFAULT_GAMES;

  const same = games.length === use.length
    && games.every(function(x, i){ return x.id === use[i].id && x.name === use[i].name; });
  if(same) return;

  games = use;
  const sel = g('gameSelect');
  if(sel){
    sel.innerHTML = games.map(function(x){ return '<option value="'+x.id+'">'+x.name+'</option>'; }).join('');
    if(!games.find(function(x){ return x.id === currentGame; })) currentGame = games[0].id;
    sel.value = currentGame;
  }
  updateGameBranding();
}

/**
 * Centred loading state for an action the user just took, as opposed to the
 * full-screen overlay used once at boot.
 *
 * Deliberately non-blocking in appearance: the dashboard stays visible behind
 * it, because a range change replaces figures that are already on screen.
 */
function showBusy(show, label, sub){
  let el = document.getElementById('busyVeil');

  if(show){
    if(!el){
      el = document.createElement('div');
      el.id = 'busyVeil';
      el.className = 'busy-veil';
      document.body.appendChild(el);
    }
    el.innerHTML = '<div class="busy-box">'
      + '<div class="busy-spin"></div>'
      + '<div class="busy-lbl">' + (label || 'Loading…') + '</div>'
      + (sub ? '<div class="busy-sub">' + sub + '</div>' : '')
      + '</div>';
    return;
  }

  if(el) el.remove();
}

function showLoadingOverlay(show){
  let el = g('loadingOverlay');
  if(!el && show){
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--bg);';
    el.innerHTML = '<div style="text-align:center"><div style="width:40px;height:40px;border:3px solid var(--surface2);border-top-color:var(--cyan);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px"></div><div style="color:var(--text2);font-family:var(--mono);font-size:13px">Loading live data…</div></div>';
    document.body.appendChild(el);
  }
  if(el && !show){ el.remove(); }
  if(!show) hideBootOverlay();
}

/* The first-open screen (#bootOverlay, in index.html) is up from the first
   paint, before any script runs; it goes when the sign-in form or the
   dashboard is ready to be seen. */
function hideBootOverlay(){
  const b = g('bootOverlay');
  if(b) b.remove();
}
// never strand anyone behind it, whatever fails on the way
setTimeout(hideBootOverlay, 45000);

// ═════════════════════════════════════════
// VERSION POLL — replaces the old 15-minute forced refresh
// ═════════════════════════════════════════
//
// This used to be `setInterval(refreshData, 15min)`, and refreshData() calls
// lsClearAll() and then fetches with refresh=1. So four times an hour, every
// open tab threw away every stored payload — including everything the
// background prefetcher had just spent minutes collecting — and forced the
// server to rebuild from the sheets with the cache deliberately bypassed.
//
// On data that only changes on Monday mornings that was ~96 full rebuilds a day
// in exchange for nothing. Now the poll asks the server one cheap question —
// "has the row count moved?" — and only does the expensive thing when the
// answer is yes. Nothing is ever cleared speculatively.
const VERSION_POLL_MS = 15 * 60 * 1000;
let _versionPollTimer = null;

function startVersionPoll(){
  if(_versionPollTimer) return;
  _versionPollTimer = setInterval(checkForNewData, VERSION_POLL_MS);
}

async function checkForNewData(){
  if(!CU || !getToken()) return;
  if(document.hidden) return;              // a background tab needs nothing
  const d = DATA[currentGame];
  if(!d || !d.meta) return;
  await revalidateInBackground(currentGame, d.meta.dataVersion || '');
}

function applyPresetToInputs(days){
  // Both ends derived from dataThrough() - the last finished day - so a preset
  // lands on exactly the window the server warmed, and never includes the
  // part-day that today still is.
  const toStr   = dataThrough();
  const fromStr = isoShift(toStr, -(days - 1));
  g('rangeFrom').value = fromStr;
  g('rangeTo').value   = toStr;
  // Critical: also set the state vars so getWindow() filters by actual dates
  // rather than falling back to arr.slice(-activeRange) which can return more/fewer
  // rows than the visible date range.
  dateFrom = fromStr;
  dateTo   = toStr;
  // activeRange must be updated BEFORE syncPresetSelect(), which picks the
  // dropdown option by reading it. Callers used to set it on the line after
  // this one, so choosing "Last 4 weeks" loaded 28 days of data and then snapped
  // the dropdown back to whatever was selected before.
  activeRange = days;
  syncPresetSelect();
  updateRangeLabel();
}

function updateGameBranding(){
  g('sbGameName').textContent = 'Pulse';
}

/**
 * Sections whose drawn output no longer matches the data.
 *
 * renderAll() used to call every section's renderer. With makeChart()
 * destroying and rebuilding a chart on each run, that was 34 Chart.js
 * instances torn down and constructed per pass - and one section's worth of
 * them was on screen. Everything else was drawn into a pane with
 * display:none, at zero width, to be thrown away and drawn again the next
 * time anything changed.
 *
 * It cost the most on exactly the actions where waiting is most obvious: a
 * range change, a game switch, a sync. And it grows with the data, which is
 * the direction this dashboard is going.
 *
 * Now a data change marks every section stale and draws the one being looked
 * at. goTab() draws a section the first time it is opened after that, and not
 * again until something makes it stale.
 */
const staleSections = new Set();

/** Draws one section if it is stale. Safe to call for a report or an unknown id. */
function renderSection(id){
  if(!staleSections.has(id)) return false;
  const s = getEnabledSections().find(function(x){ return x.id === id; });
  if(!s || s.report || typeof s.render !== 'function'){ staleSections.delete(id); return false; }
  try { s.render(); }
  catch(e) { console.warn('Render error:', id, e); }
  staleSections.delete(id);
  return true;
}

function renderAll(){
  setTimeout(function(){ resizeChartsIn(g('tab-' + currentTab)); }, 50);
  aggregateFtue();
  getEnabledSections().forEach(function(s){
    // A report draws itself inside its own page; there is nothing to mark.
    if(!s.report && typeof s.render === 'function') staleSections.add(s.id);
  });
  renderSection(currentTab);
  loadPreviousDashboard();
  // No-op once this window is cached; otherwise it lands and repaints itself.
  ensureProgression();
}

// ═════════════════════════════════════════
// ALERTS — every page and report, and its cards with no data points
// ═════════════════════════════════════════
/* Data team only. Walks the sidebar in order: a dashboard page is drawn (it is
   drawn hidden, exactly as it would be on opening it) and read; a report is
   loaded off screen in its own frame and read once its loader has gone. What
   counts as "no data":
     KPI card   value is a dash / blank / N/A, or its trend line has no points
     chart      no finite data point in any series (a doughnut summing to 0)
     card       shows a "no data / no rows / unavailable" notice
   Dashboard pages are checked for the range and game selected at the top;
   each report for its own default range. */
const AL_SKIP   = ['alerts', 'users', 'thresholds', 'feedback'];
const AL_EMPTY  = /^(—|–|-|n\/?a|no data|…|\.\.\.|null|undefined|nan)?$/i;
const AL_NOTICE = /no data|no rows|unavailable|not connected|nothing to show|not reported|no .{0,40}\b(in|for) (this |the )?(range|period)/i;
const ALERTS = { results: null, key: '', running: false, at: null };

function alText(el){
  if(!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('.card-sub, small, .kpi-sub, svg, button').forEach(function(n){ n.remove(); });
  return (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90);
}

/** Finite data points across a chart's series (a pie/doughnut summing to 0 counts as none). */
function alChartPoints(chart){
  let n = 0, sum = 0;
  const type = chart.config && chart.config.type;
  (chart.data.datasets || []).forEach(function(ds){
    (ds.data || []).forEach(function(v){
      const y = (v && typeof v === 'object') ? (v.y !== undefined ? v.y : v.r) : v;
      if(y !== null && y !== undefined && y !== '' && Number.isFinite(+y)){ n++; sum += Math.abs(+y); }
    });
  });
  if((type === 'doughnut' || type === 'pie' || type === 'polarArea') && sum === 0) return 0;
  return n;
}

function alCardTitle(el){
  const card = el.closest('.card, .panel, .chart-card, .box, section');
  if(!card) return '';
  return alText(card.querySelector('.card-title, .card-head h3, .card-head h2, .card-head, .ch-title, .panel-title, h3, h2, .hd, .title'));
}

/** Keep line breaks between notice blocks even when the scanned pane is hidden. */
function alNoticeText(notice){
  const copy = notice.cloneNode(true);
  copy.querySelectorAll('div, p, br, li, h2, h3, h4').forEach(function(block){
    block.before(' ');
    block.after(' ');
  });
  return copy.textContent.replace(/\s+/g, ' ').trim()
    .replace(/^(.*?No data source connected)\s+(?=\S)/i, '$1 — ');
}

/** Findings inside one root (a hub pane or a report's <body>). */
function alScanRoot(root, ChartCtor){
  const out = [], seen = {};
  const add = function(kind, name, reason){
    name = name || '(untitled)';
    const k = kind + '|' + name;
    if(seen[k]) return;
    seen[k] = 1; out.push({ kind: kind, name: name, reason: reason });
  };
  const getChart = function(cv){ try { return ChartCtor && ChartCtor.getChart ? ChartCtor.getChart(cv) : null; } catch(e){ return null; } };
  const inCard = new Set();

  // KPI cards: the hub's .kpi, the reports' .kpi-card / .act, Executive's .kpi
  root.querySelectorAll('.kpi, .kpi-card, .act').forEach(function(card){
    if(card.classList.contains('kpi-denied')) return;
    const lbl = alText(card.querySelector('.kpi-label, .kpiLbl, .l, .hd'));
    if(!lbl) return;
    const valEl = card.querySelector('.kpi-val, .kpi-value, .kpiVal, .v, .amt');
    const val = valEl ? (valEl.textContent || '').replace(/\s+/g, ' ').trim() : null;
    const cv = card.querySelector('canvas');
    if(cv) inCard.add(cv);
    const ch = cv ? getChart(cv) : null;
    const spark = card.getAttribute('data-spark');
    if(val !== null && AL_EMPTY.test(val)) add('KPI', lbl, 'no value');
    else if(ch && !alChartPoints(ch)) add('KPI', lbl, 'trend line has no points');
    else if(spark !== null && !spark.split(',').some(function(x){ return x.trim() !== '' && Number.isFinite(+x); }))
      add('KPI', lbl, 'trend line has no points');
  });

  // charts that are not a KPI card's sparkline
  root.querySelectorAll('canvas').forEach(function(cv){
    if(inCard.has(cv)) return;
    const ch = getChart(cv);
    if(!ch) return;
    const scales = Object.values(ch.scales || {});
    if(scales.length && !scales.some(function(s){ return s.options && s.options.display !== false; })) return;
    if(!alChartPoints(ch)) add('Chart', alCardTitle(cv) || cv.id, 'no data points');
  });

  // cards that say so in words
  root.querySelectorAll('.notice, .empty, .empty-state, .nodata, .no-data').forEach(function(n){
    const txt = alNoticeText(n);
    if(!AL_NOTICE.test(txt)) return;
    const name = alCardTitle(n);
    if(name) add('Card', name, txt.slice(0, 110));
  });
  return out;
}

function alScanHub(sec){
  staleSections.add(sec.id);
  renderSection(sec.id);
  const pane = g('tab-' + sec.id);
  return pane ? alScanRoot(pane, window.Chart) : [];
}

/** True while a report still shows any of its loading screens. */
function alReportLoading(doc){
  const els = doc.querySelectorAll('.loader, #uaLoader, #loadingOverlay, .load-progress.show');
  return Array.prototype.some.call(els, function(el){
    const cs = doc.defaultView.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  });
}

/** Loads a report off screen, waits for it to settle, reads it. */
function alScanReport(sec){
  return new Promise(function(resolve){
    const pane = ensureReportPane(sec);
    if(!pane){ resolve({ error: 'not signed in' }); return; }
    const frame = pane.querySelector('iframe');
    if(!frame){ resolve({ error: 'report frame missing' }); return; }
    const visible = pane.classList.contains('on');
    // laid out but off screen, so a hidden report still loads and sizes its charts
    if(!visible) pane.classList.add('al-offscreen');
    if(frame.getAttribute('loading') === 'lazy') frame.setAttribute('loading', 'eager');
    const t0 = Date.now();
    let last = -1, stable = 0;
    const finish = function(r){ if(!visible) pane.classList.remove('al-offscreen'); resolve(r); };
    const tick = function(){
      let doc = null, win = null;
      try { doc = frame.contentDocument; win = frame.contentWindow; } catch(e){}
      if(doc && win && doc.readyState === 'complete' && doc.body && !alReportLoading(doc)){
        const count = doc.querySelectorAll('.kpi, .kpi-card, .act, canvas').length;
        if(count > 0){
          stable = (count === last) ? stable + 1 : 0;
          last = count;
          if(stable >= 2){ finish({ items: alScanRoot(doc.body, win.Chart) }); return; }
        }
      }
      if(Date.now() - t0 > 60000){ finish({ error: 'did not finish loading within a minute' }); return; }
      setTimeout(tick, 800);
    };
    tick();
  });
}

function renderAlerts(){ alertsScan(false); }

function alertsRangeKey(){ return currentGame + '|' + dateFrom + '|' + dateTo; }

function updateOverviewDataStatus(){
  const pill = g('overviewDataStatus');
  if(!pill) return false;
  pill.hidden = String(CU?.team || '').trim().toLowerCase() !== 'data' ||
    currentTab !== 'overview' || !isEnabled('alerts') || !dateFrom || !dateTo;
  if(pill.hidden) return false;
  const complete = ALERTS.key === alertsRangeKey() && ALERTS.at;
  const results = ALERTS.results || [];
  pill.classList.toggle('is-checking', !complete);
  g('overviewDataStatusLabel').textContent = !complete ? 'Checking if any data is missing'
    : results.some(r => r.items.length) ? 'Missing data found'
    : results.some(r => r.error) || !results.length ? 'Data check incomplete'
    : 'No missing data';
  return !complete;
}

async function alertsScan(force){
  if(ALERTS.running) return;
  const key = alertsRangeKey();
  if(!force && ALERTS.results && ALERTS.key === key){ alDraw(); return; }
  ALERTS.running = true; ALERTS.key = key; ALERTS.results = []; ALERTS.at = null;
  const btn = g('alScanBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Checking…'; }
  const secs = getEnabledSections().filter(function(s){ return AL_SKIP.indexOf(s.id) === -1; });
  try {
    for(let i = 0; i < secs.length; i++){
      if(key !== alertsRangeKey()) break;
      const s = secs[i];
      ALERTS.progress = 'Checking ' + s.label + ' (' + (i + 1) + ' of ' + secs.length + ')…';
      alDraw();
      let r;
      try {
        r = s.report ? await alScanReport(s) : { items: alScanHub(s) };
      } catch(e){
        r = { error: e.message };
      }
      ALERTS.results.push({ id: s.id, label: s.label, group: s.group, report: !!s.report,
                            items: r.items || [], error: r.error || null });
    }
  } finally {
    const superseded = key !== alertsRangeKey();
    ALERTS.running = false; ALERTS.progress = ''; ALERTS.at = superseded ? null : new Date();
    if(superseded){ ALERTS.key = null; ALERTS.results = null; }
    if(btn){ btn.disabled = false; btn.textContent = 'Check again'; }
    alDraw();
    if(superseded && (currentTab === 'alerts' || updateOverviewDataStatus())){
      setTimeout(() => alertsScan(false), 0);
    }
  }
}

function alDraw(){
  updateOverviewDataStatus();
  const list = g('alList'), sum = g('alSummary'), sub = g('alSub');
  if(!list) return;
  const res = ALERTS.results || [];
  const game = (games.find(function(x){ return x.id === currentGame; }) || {}).name || currentGame;
  if(sub){
    sub.innerHTML = ALERTS.progress
      ? umStatus(ALERTS.progress)
      : 'Dashboard pages checked for <b>' + umEsc(dateFrom) + ' → ' + umEsc(dateTo) + '</b> · ' + umEsc(game)
        + '. Reports use their own default range.'
        + (ALERTS.at ? ' Last checked ' + ALERTS.at.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) + '.' : '');
  }
  const withIssues = res.filter(function(r){ return r.items.length; });
  const failed = res.filter(function(r){ return r.error; });
  const clean = res.filter(function(r){ return !r.items.length && !r.error; });
  const total = withIssues.reduce(function(a, r){ return a + r.items.length; }, 0);
  if(sum){
    sum.innerHTML = res.length
      ? '<span class="al-pill ' + (total ? 'bad' : 'ok') + '">' + total + ' card' + (total === 1 ? '' : 's') + ' with no data</span>'
        + '<span class="al-pill">' + withIssues.length + ' page' + (withIssues.length === 1 ? '' : 's') + ' affected</span>'
        + '<span class="al-pill ok">' + clean.length + ' complete</span>'
        + (failed.length ? '<span class="al-pill warn">' + failed.length + ' could not be checked</span>' : '')
      : '';
  }
  const kindCls = { KPI: 'kpi', Chart: 'chart', Card: 'card' };
  const pageCard = function(r){
    const rows = r.error
      ? '<div class="al-row"><span class="al-kind warn">Not checked</span><span class="al-reason">' + umEsc(r.error) + '</span></div>'
      : r.items.map(function(it){
          return '<div class="al-row"><span class="al-kind ' + kindCls[it.kind] + '">' + it.kind + '</span>'
            + '<span class="al-name">' + umEsc(it.name) + '</span>'
            + '<span class="al-reason">' + umEsc(it.reason) + '</span></div>';
        }).join('');
    return '<div class="card al-page">'
      + '<div class="al-page-hd"><div><span class="al-page-name">' + umEsc(r.label) + '</span>'
      + '<span class="al-where">' + umEsc(r.group) + ' · ' + (r.report ? 'report' : 'dashboard page') + '</span></div>'
      + '<div class="al-page-right">' + (r.error ? '' : '<span class="al-count">' + r.items.length + ' missing</span>')
      + '<button type="button" class="um-link" data-tab="' + umEsc(r.id) + '" onclick="goTab(this.dataset.tab)">Open ›</button></div></div>'
      + '<div class="al-rows">' + rows + '</div></div>';
  };
  list.innerHTML = withIssues.map(pageCard).join('') + failed.map(pageCard).join('')
    + (clean.length
        ? '<div class="card al-page"><div class="al-page-hd"><div><span class="al-page-name">No missing data</span></div></div>'
          + '<div class="al-clean">' + clean.map(function(r){ return '<span class="al-chip">' + umEsc(r.label) + '</span>'; }).join('') + '</div></div>'
        : '');
}

// ═════════════════════════════════════════
// OVERVIEW
// ═════════════════════════════════════════
/**
 * What the Installs card is counting, written from the payload.
 *
 * The figure is New Users either way - Play Console's own count on Android,
 * App Store first-time downloads on iOS - so the subtitle names the store
 * rather than repeating the metric.
 */
function ovInstallsSub(d, cur){
  const row    = cur.find(x => x && x.installsSource) || {};
  const source = row.installsSource || '';
  const hasIos = !!row.consoleHasIos;
  const plat   = (d && d.platform) || 'all';

  if(plat === 'ios'){
    return source === 'play-console' ? 'New Users \u00b7 App Store'
                                     : 'Executive KPI installs \u00b7 iOS';
  }
  if(plat === 'android') return 'New Users \u00b7 Play Console';
  return hasIos ? 'New Users \u00b7 Play Console + App Store'
                : 'New Users \u00b7 Play Console (Android only)';
}


/**
 * Where the Active Users figure comes from.
 *
 * GA4, carried on the same tab as payers and sales and split by platform
 * there - which is why ARPPU already reads from it. The card shows that
 * figure and the whole row divides by it, so the three numbers reconcile.
 *
 * The named fallbacks stay because the payload still has them for a day that
 * tab has not reached. A card that silently swapped feeds is the thing this
 * names its source to prevent.
 */
function ovDauSub(d){
  const src = (d && d.dauSource) || '';
  if(src === 'adperf')     return 'active users \u00b7 AdPerformance';
  if(src === 'useractraw') return 'active users \u00b7 User Activity Raw';
  return 'active users \u00b7 GA4';
}


/**
 * A rate over a window: the numerator summed, the denominator summed, then
 * divided ONCE.
 *
 * NOT THE MEAN OF THE DAILY RATES
 *
 * Those answer different questions, and agree only when every day is the same
 * size. Payer conversion was the mean, so a quiet Sunday with 3 payers out of
 * 200 pulled the headline as hard as a Saturday with 300 out of 200,000: the
 * mean says 0.83%, the period actually ran at 0.15%. Nobody reading "payer
 * conversion for the period" means the first one.
 *
 * DAYS ARE TAKEN IN PAIRS
 *
 * A day whose denominator is missing contributes NEITHER half. Summing the
 * two columns independently would count that day's revenue against a
 * population that was never measured, and ARPDAU would read high by exactly
 * as much as the feed was behind. A number that rises when a tab stops is
 * worse than no number at all.
 *
 * Returns null when nothing is left to divide by. A rate with nothing
 * underneath it is unknown; 0% is a measurement, and the two must not look
 * the same.
 */
function ovRate(rows, numOf, denOf){
  let n = 0, d = 0, used = 0;
  rows.forEach(r => {
    const den = denOf(r);
    if(den == null || den === '' || !(+den > 0)) return;
    n += +numOf(r) || 0;
    d += +den;
    used++;
  });
  return used && d > 0 ? n / d : null;
}


function scheduleOverviewDataStatus(){
  if(updateOverviewDataStatus() && !ALERTS.running){
    setTimeout(() => {
      if(updateOverviewDataStatus()) alertsScan(false);
    }, 0);
  }
}

function renderOverview(){
  scheduleOverviewDataStatus();
  const d = curData(); if(!d.daily) return;
  const cur  = getWindow(d.daily);
  const prior = previousDashboard();
  const prev = prior.daily || [];
  const curR = getWindow(d.retention);
  const cc   = chartColors();
  const curDates = cur.map(x=>x.date);

  /* Counted over the days that REPORTED, so a tab that has not reached this
     range reads as unknown rather than as zero installs.

     The backend goes to some trouble to send null for a date the Console
     Installs tab has no row for - its own comment calls a zero install bar
     "the most confidently wrong thing this dashboard can draw". `+x||0` threw
     that away and turned every unreported day into a real zero, which is how
     Android installs came to show 0 instead of saying nothing was reported. */
  const installRows   = cur.filter(x => x.installs != null);
  const prevInstRows  = prev.filter(x => x.installs != null);
  const totalInstalls = installRows.length ? sum(installRows.map(x => +x.installs)) : null;
  const prevInstalls  = prevInstRows.length ? sum(prevInstRows.map(x => +x.installs)) : null;

  const dauAvg        = avg(cur.map(x=>+x.dau||0));
  const prevDau       = avg(prev.map(x=>+x.dau||0));
  /* Averaged over the days that actually reported, not over the window. A
     day the tab has not reached is not a day of zero users, and dividing by
     the window length would quietly drag the figure down as the feed falls
     behind. */
  const activeAvg     = avgNN(cur.map(x=>x.activeUsers));
  const activePrevAvg = averageReported(prev,'activeUsers');
  // D1 comes from Executive_KPIs (cohort-weighted, platform-aware) so the value
  // has the same meaning whichever platform is selected.
  const retSum        = d.retSummary || {};
  const cohortsCur    = getWindow(d.retCohorts || []);
  const d1            = (retSum.d1 != null) ? retSum.d1 : null;
  const prevD1        = prior.retSummary?.d1 ?? null;
  const d0Play        = avgNN(cur.map(x=>x.d0Playtime));
  const prevD0Play    = averageReported(prev,'d0Playtime');
  /* Sessions per user belongs with the core metrics, not the money. It is
     already a per-user figure on each row, so it stays an AVERAGE across days
     - there is no total of "sessions per user" to sum. */
  const spd           = avgNN(cur.map(x=>x.sessionsPerUser));
  const spdPrev       = averageReported(prev,'sessionsPerUser');
  const ftueSteps     = d.ftueSteps || [];
  // Measured at the deepest step every platform reaches, so Android, iOS and
  // Combined are comparable. The old "last step" figure was not.
  const ftueRef       = (d.ftue && d.ftue.referenceStep) || {};
  const ftueComplete  = (ftueRef.engagement != null) ? ftueRef.engagement : null;

  /* Both subtitles name their source, and both are written from the payload
     rather than fixed here. A label that describes data and is typed by hand
     is correct only until the data moves - which is exactly how the installs
     card came to read "Android" under an iOS filter. */
  const kpis = [
    { cls:'cy', lbl:'Installs',      val:totalInstalls!=null?fmtKn(totalInstalls):'—',  data:cur.map(x=>x.installs==null?null:+x.installs), dates:curDates, cur:totalInstalls, prev:prevInstalls, sub:totalInstalls!=null?ovInstallsSub(d, cur):'no install rows in range', color:'#2DD4BF',    fmt:fmtKn },
    { cls:'mg', lbl:'Active Users',  val:fmtKn(activeAvg),      data:cur.map(x=>x.activeUsers==null?null:+x.activeUsers), dates:curDates, cur:activeAvg, prev:activePrevAvg, sub:ovDauSub(d), color:'#22D3EE', fmt:fmtKn },
    { cls:'vl', lbl:'D1 Retention',  val:d1?fmtPct(d1):'—',     data:cohortsCur.map(x=>+x.d1||0), dates:cohortsCur.map(x=>x.date), cur:d1, prev:prevD1, sub:'cohort-weighted',   color:'#38BDF8',  fmt:fmtPct },
    { cls:'lm', lbl:'D0 Playtime',   val:fmtSec(d0Play),        data:cur.map(x=>+x.d0Playtime||0), dates:curDates, cur:d0Play,     prev:prevD0Play,   sub:'avg new user', color:'#60A5FA',    fmt:fmtSec },
    { cls:'am', lbl:'Sessions / User', val:spd?spd.toFixed(2):'\u2014', data:cur.map(x=>+x.sessionsPerUser||0), dates:curDates, cur:spd, prev:spdPrev, sub:'period avg', color:'#818CF8', fmt:v=>(+v).toFixed(2) },
    /* No per-day series exists for FTUE completion, so its graph is the funnel
       itself: share of users still engaged at each step, first to last. */
    { cls:'co', lbl:'FTUE Complete', val:ftueComplete?fmtPct(ftueComplete):'\u2014',
      data: ftueSteps.map(s => (s && s.engagement != null && isFinite(s.engagement)) ? +s.engagement : null),
      dates: ftueSteps.map((s,i) => (s && (s.name || s.step || s.label)) || ('Step ' + (i+1))),
      cur:ftueComplete, prev:prior.ftue?.referenceStep?.name === ftueRef.name ? prior.ftue?.referenceStep?.engagement : null,
      sub:(ftueRef.name ? 'reached ' + ftueRef.name : 'final step'), color:'#A78BFA', fmt:fmtPct },
  ];

  g('heroKpis').innerHTML = kpis.map((k,i)=>`
    <div class="kpi has-spark ${k.cls}" style="--kc:${k.color}">
      <div class="kpi-text">
        <div class="kpi-label">${k.lbl}</div>
        <div class="kpi-val${String(k.val).length>6?' small':''}">${k.val}</div>
        ${kpiTrendHtml(k)}<div class="kpi-bottom"><span class="kpi-sub">${k.sub}</span></div>
      </div>
      <div class="kpi-spark-box"><canvas id="sp${i}"></canvas></div>
    </div>
  `).join('');
  kpis.forEach((k,i)=>{
    if(!k.data.length) return;
    const color = k.color;
    drawSpark('sp'+i, k.data, color, k.fmt, k.dates);
  });

  // ── Row 2: monetization ──

  /* MONEY COMES FROM THE REVENUE TAB, NET OF THE STORE CUT.

     It used to read a Sheet1 rollup, which has no rows for most windows - so
     the card spent its time saying "no rows in range" while the Revenue tab,
     which the payload already carries, had the numbers all along. Reading
     what is there beats reading what is tidier.

     IAP ARRIVES GROSS AND IS CUT HERE

     The Revenue tab's IAP Revenue is purchase value, not what reaches us.
     Shown beside ad revenue it overstates IAP's share by the whole 35% the
     store keeps, and the bigger IAP grows the further out the split goes.

     iOS is NOT cut: it already arrives as proceeds. That is the same rule
     the Monetization section states in its own comment, applied to a
     different source - so the two still agree about what a net figure is.

     The payload is fetched per platform, so the rate is known exactly. On a
     combined view it would not be - the mix would have to be split first -
     and rather than guess a blend the card says it is showing gross. */
  const OV_IAP_CUT = { android: 0.35, ios: 0 };
  const ovPlat   = (d && d.platform) || '';
  const ovCut    = OV_IAP_CUT[ovPlat];
  const ovNettable = ovCut !== undefined;

  const adGross  = sum(cur.map(x => +x.adRevenue  || 0));
  const iapGross = sum(cur.map(x => +x.iapRevenue || 0));
  const haveSh   = (adGross + iapGross) > 0;

  const adTot    = haveSh ? adGross : null;
  const iapTot   = haveSh ? (ovNettable ? iapGross * (1 - ovCut) : iapGross) : null;

  /* The two shares are read against their own total, so they sum to 100%
     rather than against a revenue figure from a different source. */
  const splitTot = haveSh ? adTot + iapTot : null;
  const adShare  = splitTot > 0 ? adTot  / splitTot * 100 : null;
  const iapShare = splitTot > 0 ? iapTot / splitTot * 100 : null;

  /* Net when Sheet1 has this window, and the gross payload figure when it
     does not - with the card saying which. Swapping silently between two
     measurements is how a chart comes to show a step nobody can explain. */
  const revTot   = haveSh ? adTot + iapTot : sum(cur.map(x => +x.revenue || 0));
  const priorAd = sum(prev.map(x => +x.adRevenue || 0));
  const priorIap = sum(prev.map(x => +x.iapRevenue || 0)) * (ovNettable ? 1 - ovCut : 1);
  const priorSplit = priorAd + priorIap;
  const revPrev  = priorSplit || (haveSh || !prev.length ? null : sum(prev.map(x => +x.revenue || 0)));
  const revSub   = !haveSh      ? 'ads + IAP \u00b7 no revenue rows in range'
                 : ovNettable   ? 'ads + IAP, IAP net of store cut'
                                : 'ads + IAP, IAP GROSS \u00b7 cut varies by platform';

  /* ONE denominator for the per-user figures: activeUsers, which is GA4's
     count, carried on the same tab as payers and sales and split by platform
     there.

     The same population throughout is what makes the row checkable - Active
     Users x ARPDAU comes back to Revenue, and payers over that same figure is
     a conversion somebody can verify by hand. */
  const activeOf  = x => x.activeUsers;
  const activeTot = sum(cur.map(x => +activeOf(x) || 0));

  /* Built from the same net total the Revenue card shows, so the two
     reconcile. Not the mean of each day's ARPDAU. */
  const arpdau   = activeTot > 0 ? revTot / activeTot : null;
  const priorActive = sum(prev.map(x => +activeOf(x) || 0));
  const arpdauP  = revPrev != null && priorActive > 0 ? revPrev / priorActive : null;

  /* Payers over the same active users: both come from that tab, so numerator
     and denominator describe one population rather than two feeds that need
     not agree. */
  const payerPct = ovRate(cur,  x => x.payers, activeOf);
  const payerPrv = ovRate(prev, x => x.payers, activeOf);
  const payerPctV = payerPct == null ? null : payerPct * 100;
  const payerPrvV = payerPrv == null ? null : payerPrv * 100;

  /* ARPPU IS THE ONE PLACE THAT USES GROSS SALES.

     What a payer is worth is what they spent, not what reached us after the
     store took its share. `sales` is the column that carries that;
     IAP.revenue is blank on every row, which is why the backend prefers
     sales too.

     Summed then divided, like the rest of the row. Ad revenue is excluded: a
     payer is defined by purchases, and crediting non-payers' ad views to the
     people who bought something is a different figure entirely. */
  const arppu    = ovRate(cur,  x => x.iapSales, x => x.payers);
  const arppuP   = ovRate(prev, x => x.iapSales, x => x.payers);

  /* UA spend, from the same source Growth uses. Two pages showing spend from
     two tabs is the fault just removed from Growth, and adding a second one
     here would put it straight back - so this reads ua.channelDaily,
     restricted to the visible window like everything else in this row, and
     names the source on the card. */
  const ovChDaily = getWindow((d.ua && d.ua.channelDaily) || []);
  const ovChPrev  = prior.ua?.channelDaily || [];
  const spendTot  = sum(ovChDaily.map(x=>+x.spend||0));
  const spendPrev = sum(ovChPrev.map(x=>+x.spend||0));
  /* Zero is not the same as absent. No Channel Performance rows for a range
     means nobody knows what was spent; a confident $0 would say nothing was. */
  const spendCur  = spendTot > 0 ? spendTot : null;

  const kpis2 = [
    { cls:'lm', lbl:'Revenue',    val:fmtMoney(revTot), data:cur.map(x=>+x.revenue||0), cur:revTot, prev:revPrev, sub:revSub, color:'#34D399' },
    { cls:'cy', lbl:'ARPDAU',     val:arpdau!=null?fmtMoney(arpdau, 4):'\u2014', data:cur.map(x=>+x.arpdau||0), cur:arpdau, prev:arpdauP, sub:'revenue \u00f7 active users', color:'#A3E635' },
    /* The one gross figure on the page, and the subtitle says so. What a
       payer is worth is what they spent, not what survived the store cut. */
    { cls:'vl', lbl:'ARPPU',      val:arppu!=null?fmtMoney(arppu, 2):'\u2014', data:cur.map(x=>+x.arppu||0), cur:arppu, prev:arppuP, sub:'gross sales \u00f7 paying users', color:'#FACC15' },
    { cls:'mg', lbl:'Payer Conv.', val:payerPctV!=null?payerPctV.toFixed(3)+'%':'\u2014', data:cur.map(x=>+x.payerRate||0), cur:payerPctV, prev:payerPrvV, sub:'payers \u00f7 active users', color:'#FB923C' },
    /* One card, both halves. Two cards for two numbers that always add to 100
       spends the space twice and still makes the reader do the subtraction. */
    { cls:'am', lbl:'Ad / IAP Share',
      val: splitTot>0 ? adShare.toFixed(0)+'% / '+iapShare.toFixed(0)+'%' : '\u2014',
      /* graph: the ad share of each day's revenue (IAP net of the same cut) */
      data: splitTot>0 ? cur.map(x => {
        const a = +x.adRevenue || 0, ip = (+x.iapRevenue || 0) * (ovNettable ? 1 - ovCut : 1);
        return (a + ip) > 0 ? a / (a + ip) * 100 : null;
      }) : [],
      cur:splitTot > 0 ? adShare * 100 : null,
      prev:priorSplit > 0 ? priorAd / priorSplit * 100 : null,
      fmt:v => Math.round(v) + '% / ' + Math.round(100 - v) + '%',
      /* Both halves net, so the split is of money we keep rather than money
         that passed through. */
      sub: splitTot>0
        ? fmtMoney(adTot)+' ads \u00b7 '+fmtMoney(iapTot)+' IAP'
          + (ovNettable ? (ovCut ? ', net of '+(ovCut*100)+'%' : ', proceeds') : ', GROSS')
        : 'no revenue rows in range',
      color:'#FB7185' },
    { cls:'co', lbl:'UA Spend',        val:fmtMoney(spendCur),
      data: spendCur!=null ? ovChDaily.map(x=>+x.spend||0) : [],
      dates: spendCur!=null ? ovChDaily.map(x=>x.date) : [],
      cur:spendCur, prev:spendCur!=null&&spendPrev>0?spendPrev:null,
      sub: spendCur!=null ? 'Channel Performance' : 'no spend rows in range',
      color:'#E879F9' },
  ];
  if(g('heroKpis2')){
    g('heroKpis2').innerHTML = kpis2.map((k,i)=>`
      <div class="kpi has-spark ${k.cls}" style="--kc:${k.color}">
        <div class="kpi-text">
          <div class="kpi-label">${k.lbl}</div>
          <div class="kpi-val${String(k.val).length>6?' small':''}">${k.val}</div>
          ${kpiTrendHtml(k)}<div class="kpi-bottom"><span class="kpi-sub">${k.sub}</span></div>
        </div>
        <div class="kpi-spark-box"><canvas id="sq${i}"></canvas></div>
      </div>
    `).join('');
    kpis2.forEach((k,i)=>{
      if(!k.data.length) return;
      const color = k.color;
      drawSpark('sq'+i, k.data, color, v=>(+v).toFixed(2), curDates);
    });
  }

  // ── Alerts ──
  const alerts = [];
  if(d1 && d1 < thresholds.d1.val) alerts.push({t:'D1 retention '+fmtPct(d1)+' is below the '+thresholds.d1.val+'% target'});
  const d7 = avg(curR.map(x=>x.d7));
  if(d7 && d7 < thresholds.d7.val) alerts.push({t:'D7 retention '+fmtPct(d7)+' is below the '+thresholds.d7.val+'% target'});
  const curStab = getWindow(d.stability);
  const crashAvg = avg(curStab.map(x=>+x.crashRate||0));
  if(crashAvg && crashAvg > thresholds.crash.val) alerts.push({t:'Crash rate '+crashAvg.toFixed(2)+'% is above the '+thresholds.crash.val+'% limit'});
  const anrAvg = avg(curStab.filter(x=>x.anrRate!=null).map(x=>+x.anrRate||0));
  if(anrAvg && anrAvg > thresholds.anr.val) alerts.push({t:'ANR rate '+anrAvg.toFixed(2)+'% is above the '+thresholds.anr.val+'% limit'});
  const alertEl = g('alertStrip');
  if(alertEl){
    alertEl.innerHTML = alerts.length
      ? alerts.map(a=>'<div class="alert-item">⚠ '+a.t+'</div>').join('')
      : '<div class="alert-item ok">✓ All tracked metrics within target</div>';
  }

  // ── Retention mini ──
  g('ovRetStats').innerHTML = [
    {k:'D1',  v:retSum.d1  != null ? retSum.d1  : null},
    {k:'D7',  v:retSum.d7  != null ? retSum.d7  : null},
    {k:'D14', v:retSum.d14 != null ? retSum.d14 : null},
  ].map(x=>`<div class="stat"><div class="stat-lbl">${x.k}</div><div class="stat-val">${x.v?fmtPct(x.v):'—'}</div></div>`).join('');

  makeChart('cvOvRet','line',{
    labels: cohortsCur.map(x=>x.date.slice(5)),
    datasets:[
      {label:'D1', data:cohortsCur.map(x=>x.d1), borderColor:cc.cyan,   backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0,spanGaps:true},
      {label:'D7', data:cohortsCur.map(x=>x.d7), borderColor:cc.violet, backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0,spanGaps:true},
      {label:'D14',data:cohortsCur.map(x=>x.d14),borderColor:cc.magenta,backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0,spanGaps:true},
    ]
  }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}} });

  // ── Playtime mini ──
  // D0 playtime stays; the second slot now reports sessions per active user
  // rather than average playtime, which duplicated the D0 figure's units and
  // told you little the trend line beside it did not already show.
  // Sessions reports Session_Length_D0 from Executive_KPI's (buildDaily exposes
  // it as sessionLenD0), so it is a DURATION, formatted like D0 Playtime beside
  // it — not the sessions-per-user count, which shares the label but not the
  // units and made the pair impossible to read against each other.
  g('ovPlayStats').innerHTML = [
    {k:'D0 Playtime', v:fmtSec(d0Play)},
    {k:'Sessions',    v:fmtSec(avgNN(cur.map(x=>x.sessionLenD0)))},
  ].map(x=>`<div class="stat"><div class="stat-lbl">${x.k}</div><div class="stat-val">${x.v}</div></div>`).join('');

  makeChart('cvOvPlaytime','line',{
    labels: cur.map(x=>x.date.slice(5)),
    datasets:[
      {label:'D0',data:cur.map(x=>x.d0Playtime),borderColor:cc.lime,backgroundColor:cc.lime+'22',fill:true,tension:.35,borderWidth:2,pointRadius:0},
      {label:'D0 session length',data:cur.map(x=>x.sessionLenD0),borderColor:cc.cyan,backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0},
    ]
  }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}} });

  // ── FTUE mini ──
  const fs = ftueSteps;
  g('ovFtueStats').innerHTML = [
    {k:'Steps',    v:fs.length},
    {k:'Base',     v:fmtKn(d.ftueBase||0)},
    {k:'Complete', v:ftueComplete?fmtPct(ftueComplete):'—'},
  ].map(x=>`<div class="stat"><div class="stat-lbl">${x.k}</div><div class="stat-val">${x.v}</div></div>`).join('');

  if(fs.length){
    makeChart('cvOvFtueChart','bar',{
      labels: fs.map(x=>'S'+x.id),
      datasets:[{label:'Engagement %',data:fs.map(x=>x.engagement),backgroundColor:cc.amber+'cc',borderColor:cc.amber,borderWidth:1,borderRadius:3}]
    }, {
      plugins:{tooltip:{callbacks:{title:function(c){return fs[c[0].dataIndex].name;},label:function(c){return '  '+c.parsed.y+'% engaged';}}}},
      scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:8}}},y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>v+'%'}}}
    });
  }

  renderProgressionMinis();

  // ── Live Ops mini — now a real feed from the LiveOps tab ──
  const ops = d.liveops || [];
  if(g('ovLiveOpsList')){
    g('ovLiveOpsList').innerHTML = ops.length
      ? ops.slice(0,3).map(liveopCard).join('')
      : noData('No live ops events in range');
  }
  if(g('ovLiveOps')) g('ovLiveOps').innerHTML = ops.length ? '' : noData('No live ops events in range');

  // ── Stability mini ──
  const crashFree = crashAvg ? 100 - crashAvg : null;
  if(d.missing && d.missing.stability && !crashAvg && !anrAvg){
    g('ovStab').innerHTML = noData(d.missing.stability);
  } else
  g('ovStab').innerHTML = [
    {k:'Crash Rate', v:crashAvg?crashAvg.toFixed(2)+'%':'—', bad:crashAvg>thresholds.crash.val},
    {k:'ANR Rate',   v:anrAvg?anrAvg.toFixed(2)+'%':'—',     bad:anrAvg>thresholds.anr.val},
    {k:'Crash-Free', v:crashFree?crashFree.toFixed(2)+'%':'—', bad:false},
  ].map(x=>`<div class="stat"><div class="stat-lbl">${x.k}</div><div class="stat-val" style="${x.bad?'color:var(--coral)':''}">${x.v}</div></div>`).join('');

  // ── Rating mini ──
  const rd = getWindow((d.ratings&&d.ratings.daily)||[]);
  const ratingAvg = avg(rd.map(x=>+x.rating||0));
  if(g('ovRating')){
    g('ovRating').innerHTML = ratingAvg
      ? '<div style="text-align:center;padding:8px 0"><div style="font-size:34px;font-weight:700;color:var(--amber);font-family:var(--mono)">'+ratingAvg.toFixed(2)+'</div><div style="color:var(--amber);font-size:16px;letter-spacing:2px;margin:4px 0">'+starStr(ratingAvg)+'</div><div class="kpi-sub">in-game rating · period avg</div></div>'
      : noData('No rating rows in range');
  }
}

function starStr(v){
  const full = Math.round(v);
  return '★'.repeat(Math.max(0,Math.min(5,full))) + '☆'.repeat(Math.max(0,5-full));
}

/**
 * Says which source the installs line is drawn from, and for which platform.
 *
 * Two facts decide it, both sent by the backend:
 *
 *   installsSource   'play-console' or 'bytebrew'
 *   consoleHasIos    whether the Console Installs tab carries an iOS column
 *
 * The second is needed because on Combined the source is play-console either
 * way: without the iOS column that figure is Android alone, and saying
 * "Android + iOS" over an Android-only number is the fault this replaces.
 */
function installsNote(d, cur){
  /* g, not $ - this file has no $. Calling one threw a ReferenceError that
     stopped renderGrowth before it drew anything, and the whole Growth tab
     came up empty. */
  const el = g('installsSrcNote'); if(!el) return;

  const row    = cur.find(x => x && x.installsSource) || {};
  const source = row.installsSource || (cur.length ? 'play-console' : '');
  const hasIos = !!row.consoleHasIos;
  const plat   = (d && d.platform) || 'all';

  if(!source){ el.textContent = '—'; return; }

  // What the line actually covers, as opposed to what was selected.
  const covers = plat === 'ios'     ? 'iOS'
               : plat === 'android' ? 'Android'
               : hasIos             ? 'Android + iOS'
                                    : 'Android only — the Console Installs tab has no iOS column yet';

  const gap = ' A gap means the tab has no row for that day, not zero installs.';

  el.textContent = source === 'play-console'
    ? 'Play Console installs · ' + covers + '.' + gap
    : 'Executive KPI installs · ' + covers
      + '. Play Console has no iOS column yet, so iOS stays on its old source.'
      + gap;
}

function renderGrowthUsNotices(us){
  const host = g('growthUsNote');
  if(!host) return;
  const notices = [];
  const onDataTeam = String(CU?.team || '').trim().toLowerCase() === 'data';
  if(us && !us.buyersVerified && onDataTeam){
    notices.push('<div class="notice" style="padding:10px 14px;margin-bottom:10px;'
      + 'border-left:3px solid var(--amber);font-size:11px;color:var(--text3)">'
      + '<b style="color:var(--text2)">Buyers are not reconciled.</b> ' + umEsc(us.buyersNote)
      + '</div>');
  }
  (us?.notes || []).forEach(note => {
    notices.push('<div class="notice" style="padding:8px 14px;margin-bottom:10px;'
      + 'font-size:11px;color:var(--text3)">' + umEsc(note) + '</div>');
  });
  host.innerHTML = notices.join('');
}

function renderGrowth(){
  // Drawn first: the matrix has its own date spine, so it still renders on a
  // game that has no daily rows yet.
  renderSpendMatrix();

  const d = curData(); if(!d.daily) return;
  const cur  = getWindow(d.daily);
  const prior = previousDashboard();
  const prev = prior.daily || [];
  const ua   = d.ua || {channels:[],daily:[],campaigns:[]};
  const uaCur  = getWindow(ua.daily || []);
  const uaPrev = prior.ua?.daily || [];
  const cc   = chartColors();
  const lbls = cur.map(x=>x.date.slice(5));

  const reportedTotal = (rows,key) => {
    const values = rows.map(row=>row[key]).filter(isNum);
    return values.length ? sum(values.map(Number)) : null;
  };
  const totalInstalls = reportedTotal(cur,'installs');
  const prevInstalls  = reportedTotal(prev,'installs');

  // The daily-installs card's subtitle, written from the payload rather than
  // from the markup.
  //
  // It used to be a fixed sentence ending "· Android", which stayed on screen
  // under the iOS filter and told anyone reading it the wrong thing. A label
  // that describes data has to come from that data, or it is only correct
  // until the data moves.
  installsNote(d, cur);

  // Per-day Channel Performance rollup: spend, revenue, and the ad/IAP split.
  // Restricted to the visible window so it lines up with `cur`.
  const curDatesG   = cur.map(x=>x.date);

  // Sheet1 rollup for this window, declared once at the top because both the
  // Acquisition cards (columns AF/AG) and the Monetization cards (block A–E)
  // read from it. Returns {} until Sheet1 lands.
  const shDaysM   = mxDaysForRange(dateFrom, dateTo) || {};
  // Days that actually carry the AC–AG pair, oldest first.
  const agKeys    = Object.keys(shDaysM)
                      .filter(k=>k>=dateFrom && k<=dateTo)
                      .filter(k=>shDaysM[k].spendAG!=null || shDaysM[k].revAF!=null)
                      .sort();
  const useAG     = agKeys.length > 0;
  const chDaily     = getWindow(ua.channelDaily || []);
  const chDailyPrev = prior.ua?.channelDaily || [];
  const chByDate    = {}; chDaily.forEach(x=>{ chByDate[x.date] = x; });

  // ── Organic installs ──
  // Assisted installs are the attributed (paid) ones, from Sheet1 column M —
  // the same figure the Spend & install matrix shows as Total Assisted
  // Installs. Organic is what is left after taking them off the Executive KPI
  // total, so the two views reconcile by construction.
  //
  // mxDaysForRange returns {} until Sheet1 lands, so assisted can legitimately
  // be null on the first render. Null is carried through rather than replaced
  // with 0, which would briefly show organic == total and look like a real
  // reading rather than a pending one.
  const mxDays        = mxDaysForRange(dateFrom, dateTo) || {};
  const mxDayKeys     = Object.keys(mxDays);
  const assistedByDay = {};
  mxDayKeys.forEach(k=>{ assistedByDay[k] = +mxDays[k].instTotal||0; });
  const haveAssisted  = mxDayKeys.length > 0;
  // organicTotal and assistedTotal were removed with the Organic Installs
  // card. They fed nothing else, and a windowed total nobody displays is
  // the kind of leftover that gets picked up later as if it still meant
  // something. The per-day figure below is still needed: the stacked chart
  // splits organic from paid with it.
  //
  // Clamped at 0: attribution windows can credit an install to a day
  // outside this range, so assisted can exceed the Executive KPI total on a
  // single day. A negative organic count is never a true statement.
  const organicByDay  = d0 => {
    const t = (cur.find(x=>x.date===d0)||{}).installs;
    if(t==null || !haveAssisted) return null;
    return Math.max(0, (+t||0) - (assistedByDay[d0]||0));
  };
  // Totals come from the channel rollup so the KPIs agree with the table below.
  const tot           = ua.totals || {};
  const paidInstalls  = +tot.installs || 0;

  // UA Spend, Avg CPI and ROI come from Sheet1 — column L for spend, column M
  // for installs — so they match the Spend & install matrix exactly. The rest
  // of this block still feeds the cards the sheet has no answer for.
  const sheetCards    = scCurrent();
  const sc            = sheetCards && sheetCards.totals;
  const scPrev        = sheetCards && sheetCards.previous;

  // Spend, CPI and ROI have one authority: spend_metrix.gs / Sheet1.
  // Keep them empty while that request is in flight instead of briefly showing
  // similarly named figures from fetchAll that use different sources/definitions.
  const prevSpend     = scPrev ? scPrev.spend : null;
  const uaRevenue     = sc ? sc.revenue : null;
  // Match Overview exactly: daily.installs is built from Executive_KPI's for
  // the selected platform and date range.
  const acqInstalls   = totalInstalls;
  const acqPrevInst   = prevInstalls;
  // CPI uses Sheet1's UA spend but the same Executive KPI install denominator
  // as the two install views above, keeping all three acquisition KPIs aligned.
  // ROAS comes from the Combines_ROAS tab: cohort payback, D7 headline with D0
  // underneath. That is a different question from ROI above — ROI is money in
  // against money out inside the window, this is how much of its own cost an
  // install cohort has paid back. Falls back to the channel rollup if the tab
  // has no rows for this range.
  // ── ROAS, from the Channel Performance table on this page ──
  // Cost-weighted D7 across channels, which is what the table's D7 ROAS column
  // already shows per channel. Both are percentages already (buildChannelPerf
  // scales the raw fraction once), so nothing is multiplied again here — that
  // double scaling is what produced the four-digit "6131%" readings.
  const chans_       = (ua.channels||[]);
  const roasWeighted = (key, channels=chans_) => {
    let n = 0, dsum = 0;
    channels.forEach(c=>{
      const v = c[key], w = +c.spend||+c.cost||0;
      if(v==null || v==='' || !w) return;
      n += (+v)*w; dsum += w;
    });
    return dsum ? n/dsum : null;
  };
  const roasD7Ch      = roasWeighted('roasD7');
  const roasD0Ch      = roasWeighted('roasD0');
  const roas          = roasD7Ch;
  // What the headline above is actually measuring, spelled out on the card.
  const roasSub       = roasD7Ch != null
                          ? 'D7 cohort payback' + (roasD0Ch != null ? ' · D0 ' + roasD0Ch.toFixed(0) + '%' : '')
                       : roasD0Ch != null ? 'D0 cohort payback · D7 not matured'
                       : 'no matured cohorts in range';
  // ROI: revenue over spend inside the window, where 100% is break-even. Both
  // sides come from Channel Performance so this agrees with the chart above;
  // Sheet1 is the fallback when the tab has no rows.
  const chSpendTot    = sum(chDaily.map(x=>+x.spend||0));
  const chRevTot      = sum(chDaily.map(x=>+x.revenue||0));
  const agSpendTot    = sc && sc.spendAG != null ? +sc.spendAG : 0;
  const agSpendPrev   = sheetCards && sheetCards.previous && sheetCards.previous.spendAG != null
                          ? +sheetCards.previous.spendAG : null;

  const chSpendPrev   = sum(chDailyPrev.map(x=>+x.spend||0));

  // ── ONE spend figure, used by every card on this page ──
  // Channel Performance is the authority: it is per-day and per-channel, it
  // already feeds the chart and the table below, and it is the only source
  // where the number behind the headline can be traced to a row. Sheet1 is
  // the fallback when Channel Performance has no rows for the range - one
  // fallback, named on the card, not a second authority.
  const uaSpendTot    = chSpendTot > 0 ? chSpendTot
                      : agSpendTot > 0 ? agSpendTot : null;
  const uaSpendPrev   = chSpendTot > 0 ? (chSpendPrev || null)
                      : agSpendTot > 0 ? agSpendPrev : null;
  const uaSpendSrc    = chSpendTot > 0 ? 'Channel Performance'
                      : agSpendTot > 0 ? 'Sheet1 column AG (fallback)'
                      : 'no spend source for this range';
  const uaSpendCh     = uaSpendTot;
  const uaSpendPrevCh = uaSpendPrev;

  // CPI from that same spend. The denominator is TOTAL installs, not
  // attributed ones, which makes this a blended CPI - and the card says so,
  // because a blended figure compared against a paid one is a comparison
  // nobody can win.
  const avgCpi        = uaSpendTot != null && acqInstalls > 0
    ? uaSpendTot / acqInstalls
    : null;
  const roi           = chSpendTot > 0 && chDaily.some(r=>isNum(r.revenue)) ? chRevTot/chSpendTot*100 : null;
  const prevRoas      = roasWeighted('roasD7',prior.ua?.channels || []);
  const priorRoi     = chSpendPrev > 0 && chDailyPrev.some(r=>isNum(r.revenue))
    ? sum(chDailyPrev.map(x=>+x.revenue||0)) / chSpendPrev * 100 : null;
  const priorCpi     = uaSpendPrev != null && acqPrevInst > 0 ? uaSpendPrev / acqPrevInst : null;
  const ratioLabel   = v => (v / 100).toFixed(2) + '×';
  const priorLtvD0   = averageReported(prior.monetization?.ltv,'d0');
  const ltvRows       = (d.monetization&&d.monetization.ltv)||[];
  const ltvD0         = averageReported(ltvRows,'d0');
  const ltvD7Vals     = ltvRows.map(x=>x.d7).filter(x=>x!=null && x!=='' && !isNaN(x));
  const ltvD28Vals    = ltvRows.map(x=>x.d28).filter(x=>x!=null && x!=='' && !isNaN(x));
  const ltvD7         = ltvD7Vals.length ? avg(ltvD7Vals) : null;
  const ltvD28        = ltvD28Vals.length ? avg(ltvD28Vals) : null;
  const ltvCpi        = avgCpi > 0 && ltvD0 != null ? ltvD0/avgCpi : null;
  const scKey         = currentGame + '|' + dateFrom + '|' + dateTo;
  const scStatus      = _scFailed[scKey] ? 'Sheet1 unavailable' : 'loading Sheet1…';

  // Two headline figures across the top — volume and what it cost — then the
  // three efficiency ratios beneath. The old 3-then-2 split left a gap on the
  // second row.
  // UA Spend now comes from Channel Performance's Spend column so it matches
  // the chart and the table on this page. Sheet1 remains the fallback.
  // UA Spend headline: Sheet1 column AG, summed for the window by
  // smCardTotals, which also sums the preceding window so the delta compares
  // like with like.


  const acqKpis = [
    /* Total Installs, where Organic Installs used to be.

       Organic is a SUBTRACTION — the Executive KPI total less the assisted
       installs from Sheet1 — so it carries both sources' gaps and shows
       neither of them. A day whose install count has not arrived makes it
       null; a day Sheet1 has not reached makes it equal to the total. The
       card gave no way to tell either of those from a real fall in organic.

       The stacked chart below still splits organic from paid, which is
       where that split can actually be read: a missing day there looks
       missing, because the bar beside it is a different height.

       This is new users — Play Console's New Users on Android, first-time
       downloads on iOS. Not re-installs and not updates. The subtitle says
       how many days of the window actually reported, so a short total
       cannot pass for a low one. */
    { cls:'cy', lbl:'Total Installs',
      val: fmtKn(totalInstalls),
      data: cur.map(x=>(x.installs==null ? null : +x.installs||0)),
      dates: curDatesG, col:'--cyan',
      cur: totalInstalls, prev: prevInstalls,
      sub: 'new users · ' + cur.filter(x=>x.installs!=null).length
             + ' of ' + cur.length + ' day(s) reported' },
    { cls:'co', lbl:'UA Spend', val:fmtMoney(uaSpendTot),
      // The sparkline follows whichever source the headline used, so the
      // shape under the number is the number's own history.
      data: chSpendTot>0 ? chDaily.map(x=>+x.spend||0)
          : agSpendTot>0 ? agKeys.map(k=>+shDaysM[k].spendAG||0) : [],
      dates: chSpendTot>0 ? chDaily.map(x=>x.date)
           : agSpendTot>0 ? agKeys : [], col:'--coral',
      cur:uaSpendTot, prev:uaSpendPrev, sub:uaSpendSrc },
    { cls:'lm', lbl:'ROI', val:roi!=null?ratioLabel(roi):'—', cur:roi, prev:priorRoi, fmt:ratioLabel,
      data: chDaily.map(x=>(+x.spend>0 ? (+x.revenue||0)/(+x.spend)*100 : null)),
      dates: chDaily.map(x=>x.date), col:'--lime',
      sub:chSpendTot>0?'revenue / UA spend':'Channel Performance unavailable' },
  ];
  // Paid Installs and Organic Installs were removed: both need attribution,
  // which has no source in this sheet, so one always read 0 and the other just
  // repeated Total Installs.
  /* daily cohort ROAS rows for the visible window (payload: cohortRoas.daily) */
  const growthRoasDaily = (((d.cohortRoas || (d.ua && d.ua.cohortRoas)) || {}).daily || [])
    .filter(x => x && x.date >= dateFrom && x.date <= dateTo);
  const acqKpis2 = [
    /* cheaper installs are the good direction */
    { cls:'mg', lbl:'Avg CPI',   val:fmtMoney(avgCpi, 3), better:'down',
      cur:avgCpi, prev:priorCpi, fmt:v=>fmtMoney(v,3),
      data: chDaily.map(x=>(+x.installs>0 ? (+x.spend||0)/(+x.installs) : null)),
      dates: chDaily.map(x=>x.date), col:'--magenta',
      sub: uaSpendTot!=null ? 'blended · spend / all installs' : scStatus },
    /* The sparkline uses D7, the same cohort age as the headline. */
    { cls:'am', lbl:'ROAS',      val:roas!=null?roas.toFixed(0)+'%':'—', sub:roasSub, col:'--amber',
      cur:roas, prev:prevRoas,
      data: growthRoasDaily.map(x => x.d7 != null ? +x.d7 : null),
      dates: growthRoasDaily.map(x => x.date), fmt: v => (+v).toFixed(0) + '%' },
    /* graph: the period's D0 LTV over each day's CPI. LTV arrives per cohort
       age, not per day, so the day-to-day movement here is CPI's. */
    { cls:'vl', lbl:'LTV : CPI', val:ltvCpi!=null?ltvCpi.toFixed(2)+'x':'—', sub:sc?'D0 LTV vs cost':scStatus, col:'--violet',
      cur:ltvCpi, prev:priorCpi > 0 && priorLtvD0 != null ? priorLtvD0 / priorCpi : null,
      data: ltvD0 > 0 ? chDaily.map(x => (+x.installs > 0 && +x.spend > 0) ? ltvD0 / ((+x.spend) / (+x.installs)) : null) : [],
      dates: chDaily.map(x => x.date), fmt: v => (+v).toFixed(2) + 'x' },
  ];
  // Growth cards now carry the same sparkline as the Overview cards. A card
  // with no series still renders — it just falls back to the plain layout
  // rather than reserving an empty chart box.
  /* A trend is shown only when the same metric has a previous-period value. */
  const trendHtml = kpiTrendHtml;
  const kpiHtml = (k, i, pfx) => {
    const hasData = (k.data||[]).filter(v=>v!=null && v!=='' && isFinite(v)).length >= 2;
    const bottom = trendHtml(k);
    const label = '<div class="kpi-label" title="'+umEsc(k.sub || k.lbl)+'">'+k.lbl+'</div>';
    if(!hasData){
      return '<div class="kpi '+k.cls+'">'+label
        + '<div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div>'
        + bottom + '</div>';
    }
    return '<div class="kpi has-spark '+k.cls+'">'
      + '<div class="kpi-text">'+label
      + '<div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div>'
      + bottom + '</div>'
      + '<div class="kpi-spark-box"><canvas id="'+pfx+i+'"></canvas></div>'
      + '</div>';
  };

  /** Renders one KPI row, then draws each card's sparkline. */
  const paintKpis = (elId, list, pfx) => {
    const el = g(elId); if(!el) return;
    el.innerHTML = list.map((k,i)=>kpiHtml(k,i,pfx)).join('');
    list.forEach((k,i)=>{
      const vals = (k.data||[]).filter(v=>v!=null && v!=='' && isFinite(v));
      if(vals.length < 2) return;
      const color = getComputedStyle(document.documentElement)
        .getPropertyValue(k.col||'--cyan').trim();
      drawSpark(pfx+i, k.data, color, k.fmt || (v=>fmtKn(v)), k.dates||curDatesG);
    });
  };

  paintKpis('growthAcqKpis',  acqKpis,  'gka');
  paintKpis('growthAcqKpis2', acqKpis2, 'gkb');

  const xAx = {grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}};
  const yKn = {grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtKn(v)}};

  // Ad impressions by cohort day — one overall series.
  // The Ad Type and Country splits stay in the source workbook, where somebody
  // comparing them can see both. This card answers the dashboard's question:
  // is ad exposure per user going up or down. The backend sums every row into
  // one curve rather than averaging the per-type curves, so a rewarded type
  // with forty rows does not weigh the same as an interstitial with four
  // thousand.
  const ac   = (d.engagement && d.engagement.adCohort) || null;
  const acKeys = (d.engagement && d.engagement.cohortDayKeys) || [];
  if(g('cvPlayAdCohort')){
    const pts = acKeys.map(k => (ac ? ac[k] : null));
    if(pts.some(v => v != null)){
      makeChart('cvPlayAdCohort','line',{
        labels: acKeys.map(k=>k.replace('day','D')),
        datasets:[{ label:'Impressions per user', data:pts,
          borderColor:cc.cyan, backgroundColor:cc.cyan+'22', fill:true,
          tension:.35, borderWidth:2, pointRadius:2, spanGaps:true }]
      }, { plugins:{legend:{display:false}},
           scales:{x:xAx,y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}}} });
    } else { wrapEmpty('cvPlayAdCohort','No ad cohort rows in range'); }
  }

  // ── ROAS maturity ──
  // A payback curve by cohort AGE, not by date: what cohorts had returned on
  // their install day, at D7, D14, D30. The backend weights each point by that
  // week's spend and drops ages whose window has not closed, so a short curve
  // means "D30 has not happened yet" rather than "D30 is zero". Drawn as a
  // line with the 100% break-even line behind it, because the only question
  // anybody asks of this chart is where it crosses.
  const rc = (d.roasCurve && d.roasCurve.points) || [];
  if(g('cvRoasMaturity')){
    if(rc.length){
      makeChart('cvRoasMaturity','line',{
        labels: rc.map(p=>p.age.toUpperCase()),
        datasets:[{ label:'ROAS', data:rc.map(p=>p.roas),
          borderColor:cc.amber, backgroundColor:cc.amber+'22', fill:true,
          tension:.3, borderWidth:2, pointRadius:4 }]
      }, {
        plugins:{ legend:{display:false},
          tooltip:{callbacks:{label:c=>'  '+(+c.parsed.y).toFixed(1)+'%  ('
            + rc[c.dataIndex].weeks + ' weeks)'}} },
        scales:{ x:xAx,
          y:{ grid:{color:cc.grid}, beginAtZero:true,
              ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>v+'%'} } }
      });
    } else {
      wrapEmpty('cvRoasMaturity',
        (d.roasCurve && d.roasCurve.note) || 'No Weekly Network rows in range');
    }
  }

  // ── Stickiness ──
  // DAU/MAU per day. Both halves come from the one tab that carries them, so
  // the ratio is of two numbers that count a user the same way. The headline
  // is the mean of the daily ratios; a range total would count somebody active
  // on twenty days twenty times above the line and once below it.
  const st = (d.stickiness && d.stickiness.daily) || [];
  if(g('cvStickiness')){
    if(st.length){
      makeChart('cvStickiness','line',{
        labels: st.map(x=>x.date.slice(5)),
        datasets:[{ label:'Stickiness', data:st.map(x=>x.stickiness),
          borderColor:cc.violet, backgroundColor:cc.violet+'22', fill:true,
          tension:.35, borderWidth:2, pointRadius:2, spanGaps:true }]
      }, {
        plugins:{ legend:{display:false},
          tooltip:{callbacks:{label:c=>'  '+(+c.parsed.y).toFixed(1)+'%   DAU '
            + fmtKn(st[c.dataIndex].dau) + ' / MAU ' + fmtKn(st[c.dataIndex].mau)}} },
        scales:{ x:xAx,
          y:{ grid:{color:cc.grid}, beginAtZero:true,
              ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>v+'%'} } }
      });
    } else {
      wrapEmpty('cvStickiness',
        (d.stickiness && d.stickiness.note) || 'No stickiness rows in range');
    }
  }
  const yUsd= {grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtMoney(v)}};

  // A date the source never reported comes back null, not 0. Plotting it as zero
  // would draw a day with no installs, which is a different claim from a day
  // with no data — so the bar is simply absent and the line breaks.
  const nOrNull = v => (v === null || v === undefined) ? null : +v;

  // Sheet1's per-day rows for the dashboard range, shared by the charts below.
  const shDays = mxDaysForRange(dateFrom, dateTo);
  const haveSheet = shDays && Object.keys(shDays).length > 0;

  // Daily installs: one bar per day, split by colour into organic and paid.
  //
  // The bar's full height is the Executive_KPI's install total — the same
  // series Overview shows — so the chart still reads as "total installs" at a
  // glance. Stacking organic under paid means the segments sum to that total
  // rather than sitting beside it, which is what makes the split legible.
  //
  // Paid is the assisted-install count from Sheet1 (column M), the same figure
  // the Spend & install matrix reports. Organic is the remainder. Until Sheet1
  // lands, assisted is unknown, so the chart falls back to a single
  // undifferentiated Installs bar rather than claiming everything is organic.
  if(haveAssisted){
    makeChart('cvGrowthInstalls','bar',{
      labels: lbls,
      datasets:[
        {label:'Organic', data:cur.map(x=>organicByDay(x.date)),
         backgroundColor:cc.cyan+'cc',borderColor:cc.cyan,borderWidth:1,borderRadius:3,stack:'i'},
        {label:'Paid',    data:cur.map(x=>{
           const t = +x.installs||0;
           const o = organicByDay(x.date);
           // Never more than the day's total, so the bar cannot exceed it.
           return o==null ? null : Math.max(0, Math.min(t, t - o));
         }),
         backgroundColor:cc.magenta+'cc',borderColor:cc.magenta,borderWidth:1,borderRadius:3,stack:'i'},
      ]
    }, {
      plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}},
        tooltip:{callbacks:{afterBody:c=>{
          const t = +((cur[c[0].dataIndex]||{}).installs)||0;
          return '  Total ' + fmtKn(t);
        }}}},
      scales:{x:Object.assign({stacked:true},xAx),y:Object.assign({stacked:true},yKn)}
    });
  } else wrapEmpty('cvGrowthInstalls', 'Assisted installs unavailable');

  // Store listing funnel (Play Console + App Store conversions)
  const conv = (d.conversions||[]);                  // all traffic sources in range
  if(g('cvGrowthAcqFunnel')){
    if(conv.length){
      makeChart('cvGrowthAcqFunnel','bar',{
        labels: conv.map(x=>x.source),
        datasets:[
          {label:'Store visitors',data:conv.map(x=>x.visitors),backgroundColor:cc.violet+'cc',borderColor:cc.violet,borderWidth:1,borderRadius:3},
          {label:'Acquisitions', data:conv.map(x=>x.acquisitions),backgroundColor:cc.lime+'cc',borderColor:cc.lime,borderWidth:1,borderRadius:3},
        ]
      }, {
        indexAxis:'y',
        plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}},
          tooltip:{callbacks:{afterBody:c=>{const r=conv[c[0].dataIndex];return '  CVR '+(r.convRate!=null?r.convRate+'%':'—');}}}},
        scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtKn(v)}},y:{grid:{display:false},ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}}}
      });
    } else {
      wrapEmpty('cvGrowthAcqFunnel', d.platform === 'ios'
        ? 'Store listing conversion is a Play Console feed. The App Store equivalent has no rows yet.'
        : 'No store listing rows in range');
    }
  }

  // ── UA Spend vs Revenue ──
  // Both series come from the Channel Performance tab, summed across channels
  // per day by buildChannelDaily: the Spend column and the Revenue column.
  // Same source as the channel table below, so the two can never disagree.
  // Sheet1 columns AG (Spend) and AF (Revenue): one totalled row per
  // game-platform-day, filtered to Supermarket Simulator by spend_metrix.gs.
  // Channel Performance is the fallback when AC–AG has no rows in range.
  const spendDates = useAG ? agKeys : [];
  const costByDate = {}, revByDate = {};
  if(useAG){
    agKeys.forEach(k=>{
      costByDate[k] = +shDaysM[k].spendAG||0;
      revByDate[k]  = +shDaysM[k].revAF||0;
    });
  }

  makeChart('cvGrowthCpi','bar',{
    labels: spendDates.map(x=>x.slice(5)),
    datasets:[
      {type:'bar', label:'UA spend', data:spendDates.map(d0=>costByDate[d0]||0),
       backgroundColor:cc.coral+'99',borderColor:cc.coral,borderWidth:1,borderRadius:3},
      {type:'line',label:'Revenue',  data:spendDates.map(d0=>revByDate[d0]!=null?revByDate[d0]:null),
       borderColor:cc.lime,backgroundColor:'transparent',borderWidth:2,pointRadius:0,tension:.3,spanGaps:true},
    ]
  }, {
    plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}},
      tooltip:{callbacks:{label:c=>'  '+c.dataset.label+': $'+fmtKn(c.parsed.y)}}},
    scales:{x:xAx,y:yUsd}
  });

  // Channel table — from the "Channel Performance" tab, one row per channel
  // for the range. App is not shown: it is what picks the platform, so the
  // Android page already holds Android-only rows and iOS iOS-only.
  const chans = (ua.channels||[]);
  // Share is computed server-side across the range. The local fallback only
  // matters when the legacy "Campaigns data" rollup is being used.
  if(g('growthSourceTbl')){
    g('growthSourceTbl').innerHTML = chans.length ? chans.map(c=>{
      const share = c.share!=null ? +c.share : null;
      const d1Cls = c.d1==null ? '' : c.d1>=thresholds.d1.val?'pill-good':'pill-bad';
      // Column order follows the funnel: what it cost, what it bought, what
      // came back, then how the cohort held. Spend has its own column now, so
      // the old "$X spend" line under the channel name would only repeat it.
      return '<div class="tbl-row eleven"'+(c.organic?' style="opacity:.62"':'')+'>'
        + '<div class="tname">'+c.channel+(c.organic?'<small>organic · no spend</small>':'')+'</div>'
        // The exact value sits above the bar, keeping Share separate from Installs.
        + '<div class="share-cell"><span class="share-val">'+(share!=null?share.toFixed(1)+'%':'—')+'</span>'
          + '<div class="mini-bar"><span style="width:'+(share!=null?share.toFixed(1):0)+'%;background:'+cc.cyan+'"></span></div></div>'
        + '<div class="tnum">$'+fmtKn(c.spend!=null?c.spend:c.cost)+'</div>'
        + '<div class="tnum">'+fmtKn(c.installs)+'</div>'
        + '<div class="tnum">'+fmtMoney(c.cpi, 2)+'</div>'
        + '<div class="tnum '+roasCls(c.organic?null:c.roasD0)+'">'+roasCell(c.organic?null:c.roasD0)+'</div>'
        + '<div class="tnum '+roasCls(c.organic?null:(c.roasD7!=null?c.roasD7:c.roas))+'">'+roasCell(c.organic?null:(c.roasD7!=null?c.roasD7:c.roas))+'</div>'
        + '<div class="tnum '+roasCls(c.organic?null:c.roasD28)+'">'+roasCell(c.organic?null:c.roasD28)+'</div>'
        + '<div class="tnum '+d1Cls+'">'+pctCell(c.d1)+'</div>'
        + '<div class="tnum">'+pctCell(c.d7)+'</div>'
        + '<div class="tnum">'+pctCell(c.d30)+'</div>'
        + '</div>';
    }).join('') : noData('No channel rows in range');
    markTable('growthSourceTbl', chans.length, 'channels');
  }

  // Campaign table — from the "Campaign Performance" tab. App drives the
  // platform filter and is not a column.
  if(g('growthCampaignTbl')){
    const camps = (ua.campaigns||[]);
    g('growthCampaignTbl').innerHTML = camps.length ? camps.map(c=>
      '<div class="tbl-row ten">'
      + '<div class="tname">'+(c.campaign||'—')+'</div>'
      + '<div class="tnum">$'+fmtKn(c.cost)+'</div>'
      + '<div class="tnum">'+fmtKn(c.installs)+'</div>'
      + '<div class="tnum">'+fmtMoney(c.ecpi, 2)+'</div>'
      + '<div class="tnum '+roasCls(c.roasD0)+'">'+roasCell(c.roasD0)+'</div>'
      + '<div class="tnum '+roasCls(c.roasD7)+'">'+roasCell(c.roasD7)+'</div>'
      + '<div class="tnum '+roasCls(c.roasD28)+'">'+roasCell(c.roasD28)+'</div>'
      + '<div class="tnum">'+pctCell(c.d1)+'</div>'
      + '<div class="tnum">'+pctCell(c.d7)+'</div>'
      + '<div class="tnum">'+pctCell(c.d30)+'</div>'
      + '</div>').join('') : noData('No campaign rows in range');
    markTable('growthCampaignTbl', camps.length, 'campaigns');
  }

  // ── Monetization ──
  // Match Overview: reported active users, with the same platform fee treatment.
  const storeCut = { android:0.35, ios:0 }[d.platform] ?? 0;
  const netRow = r => (+r.adRevenue || 0) + (+r.iapRevenue || 0) * (1 - storeCut);
  const hasSplit = rows => sum(rows.map(r=>(+r.adRevenue || 0) + (+r.iapRevenue || 0))) > 0;
  const splitNow = hasSplit(cur), splitPrior = hasSplit(prev);
  const activeTotal = reportedTotal(cur,'activeUsers');
  const previousActive = reportedTotal(prev,'activeUsers');
  const netRevenue = splitNow ? sum(cur.map(netRow)) : reportedTotal(cur,'revenue');
  const previousNetRevenue = splitNow === splitPrior
    ? (splitPrior ? sum(prev.map(netRow)) : reportedTotal(prev,'revenue')) : null;
  const arpdau = activeTotal > 0 && netRevenue != null ? netRevenue / activeTotal : null;
  const prevArpd = previousActive > 0 && previousNetRevenue != null ? previousNetRevenue / previousActive : null;
  const payers   = sum(cur.map(x=>+x.payers||0));
  // ARPPU: IAP revenue per PAYING user. Ad revenue is excluded on purpose —
  // a payer is defined by making a purchase, so crediting ad views to them
  // would inflate the figure with money non-payers generated.
  // ARPPU = sales / paying users, both from the IAP tab (buildDaily reads the
  // tab's `sales` column, not `revenue`, which is blank on every row there).
  const iapSalesT = sum(cur.map(x=>+x.iapSales||0));
  const arppu    = payers>0 && iapSalesT>0 ? iapSalesT/payers : null;
  const payerRate = rows => {
    const rate = ovRate(rows,r=>r.payers,r=>r.activeUsers);
    return rate == null ? null : rate * 100;
  };
  const payerPct = payerRate(cur), priorPayerPct = payerRate(prev);
  const priorArppu = ovRate(prev,r=>r.iapSales,r=>r.payers);

  // ── Revenue split, from Channel Performance ──
  // Revenue / Ad Revenue / IAP Revenue columns, summed across channels per day
  // (buildChannelDaily). Ad + IAP reconciles to Revenue by construction, so
  // the two share cards always add to 100%. Falls back to the daily feed when
  // the tab has no rows for this range.
  // ── Revenue split: Sheet1 block A–E ──
  // Column D carries the row Type ("Ad Revenue" / "In-App Revenue") and
  // column E its Value; spend_metrix.gs folds those into adTotal and
  // inappTotal per day. That block is the same source the Spend & install
  // matrix reports, so these cards, the trend chart and the matrix agree.
  //
  // inappTotal is NET of the platform cut (35% on Android, 0 on iOS, since
  // iOS already arrives as proceeds), which is why it is the right figure to
  // headline rather than the gross Value.
  const shKeysM   = Object.keys(shDaysM).filter(k=>k>=dateFrom && k<=dateTo);
  const useShRev  = shKeysM.length > 0;
  const shIapTot  = useShRev ? sum(shKeysM.map(k=>+shDaysM[k].inappTotal||0)) : 0;
  const shAdTot   = useShRev ? sum(shKeysM.map(k=>+shDaysM[k].adTotal||0))    : 0;

  const chRevTotM = reportedTotal(chDaily,'revenue');
  const useChRev  = chRevTotM != null;
  const revTotM   = useChRev ? chRevTotM : null;
  const iapTot    = useShRev ? shIapTot : null;
  const adTot     = useShRev ? shAdTot : null;
  // The two shares are read against their own total, so they sum to 100%
  // rather than against a Revenue figure from a different source.
  const splitTot  = useShRev ? (shIapTot + shAdTot) : null;
  const shSeries  = (key) => cur.map(x => shDaysM[x.date] ? +shDaysM[x.date][key]||0 : null);
  const prevRevM  = useChRev ? reportedTotal(chDailyPrev,'revenue') : null;
  const revSrc    = useChRev ? 'Channel Performance' : 'Channel Performance unavailable';

  // ARPU: revenue per ACTIVE user, the standard definition. This previously
  // divided by installs, which is ARPI (revenue per install) — a different
  // and much smaller number that made the card look broken next to ARPDAU.
  const dauSum   = sum(cur.map(x=>+x.dau||0));
  const arpu     = dauSum>0 && revTotM!=null ? revTotM/dauSum : null;

  const chDates = chDaily.map(x=>x.date);
  const monKpis = [
    { cls:'lm', lbl:'Revenue', val:fmtMoney(revTotM), cur:revTotM, prev:prevRevM, sub:revSrc,
      data: useChRev ? chDaily.map(x=>+x.revenue||0) : [],
      dates: useChRev ? chDates : [], col:'--lime' },
    { cls:'cy', lbl:'ARPDAU', val:fmtMoney(arpdau, 4), cur:arpdau, prev:prevArpd,
      sub:'per active user', fmt:v=>fmtMoney(v,4),
      data:cur.map(r=>{
        const revenue = splitNow
          ? (isNum(r.adRevenue) || isNum(r.iapRevenue) ? netRow(r) : null)
          : r.revenue;
        return r.activeUsers > 0 && isNum(revenue) ? revenue / r.activeUsers : null;
      }), dates:curDatesG, col:'--cyan' },
    { cls:'mg', lbl:'ARPPU', val:fmtMoney(arppu, 2), cur:arppu, prev:priorArppu, fmt:v=>fmtMoney(v,2), sub:'gross sales / paying user',
      data: cur.map(x=>+x.arppu||null), dates:curDatesG, col:'--magenta' },
    { cls:'am', lbl:'Purchase Rate', val:payerPct!=null?payerPct.toFixed(3)+'%':'—',
      cur:payerPct, prev:priorPayerPct, fmt:v=>v.toFixed(3)+'%', sub:'paying / active users',
      data:cur.map(r=>payerRate([r])), dates:curDatesG, col:'--amber' },
  ];
  // Renamed from "IAP Share" / "Ad Share": the headline is now the dollar
  // amount, with the share carried underneath, so the pair reads as a split of
  // the Revenue card above rather than as two unrelated percentages.
  const iapPct = splitTot>0 ? iapTot/splitTot*100 : null;
  const adPct  = splitTot>0 ? adTot/splitTot*100  : null;
  const monKpis2 = [
    { cls:'vl', lbl:'IAP Revenue', val:fmtMoney(iapTot),
      sub:(iapPct!=null?iapPct.toFixed(1)+'% of revenue':'—')+' · from purchases',
      data: useShRev ? shSeries('inappTotal') : [],
      dates: useShRev ? curDatesG : [], col:'--violet' },
    { cls:'co', lbl:'Ad Revenue', val:fmtMoney(adTot),
      sub:(adPct!=null?adPct.toFixed(1)+'% of revenue':'—')+' · from ads',
      data: useShRev ? shSeries('adTotal') : [],
      dates: useShRev ? curDatesG : [], col:'--coral' },
    { cls:'cy', lbl:'LTV D0 / D7 / D28', val:ltvRows.length?fmtMoney(ltvD0, 3):'—', sub:ltvRows.length?'D7 '+fmtMoney(ltvD7, 3)+' · D28 '+fmtMoney(ltvD28, 3):'no LTV rows' },
    { cls:'lm', lbl:'ARPU', val:fmtMoney(arpu, 4), sub:'per active user',
      data: cur.map(x=>{ const dv=+x.dau||0; return dv>0 ? (+x.revenue||0)/dv : null; }),
      dates:curDatesG, col:'--lime' },
  ];
  paintKpis('growthMonKpis',  monKpis,  'gkc');
  paintKpis('growthMonKpis2', monKpis2, 'gkd');

  g('growthRevenueWrap').innerHTML = '<div class="cv-wrap tall"><canvas id="cvGrowthRevenue"></canvas></div>';
  // IAP and ad revenue come from Sheet1, the same source as the Spend & install
  // matrix, so this chart and the matrix's Total In-App / Total Ad Revenue rows
  // report the same figures. IAP is net of the platform cut on Android.
  // IAP and Ad revenue come from the Channel Performance tab's IAP Revenue and
  // Ad Revenue columns, so this chart, the two KPI cards above it and the
  // channel table all report the same split. Sheet1 is the fallback when the
  // tab has no rows in range.
  makeChart('cvGrowthRevenue','bar',{
    // Same Sheet1 A–E source as the two cards above, so the stack totals match
    // them day for day.
    labels: useShRev ? lbls : [],
    datasets:[
      {label:'IAP',data: useShRev ? shSeries('inappTotal') : [],
        backgroundColor:cc.magenta+'cc',borderColor:cc.magenta,borderWidth:1,borderRadius:3,stack:'r'},
      {label:'Ads',data: useShRev ? shSeries('adTotal') : [],
        backgroundColor:cc.violet+'cc',borderColor:cc.violet,borderWidth:1,borderRadius:3,stack:'r'},
    ]
  }, {
    plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}},
    scales:{x:Object.assign({stacked:true},xAx),y:Object.assign({stacked:true},yUsd)}
  });

  // LTV curve
  if(g('cvGrowthLtv')){
    if(ltvRows.length){
      // Plot every day column present in ltv_overall. Days with no matured
      // cohorts come back as null rather than 0, so the line breaks instead of
      // diving to the axis.
      // Always show every day the tab tracks, even when a column has no data.
      // ltv_overall reports d0/d7/d28; d28 is currently 0 on every row, so the
      // point is absent rather than plotted at zero — a cumulative curve that
      // drops to zero would be worse than an honest gap. Keeping the label makes
      // it obvious that D28 is tracked but not yet reported.
      const dayList = [];
      ltvRows.forEach(r => (r.points||[]).forEach(pt => {
        if(dayList.indexOf(pt.day) === -1) dayList.push(pt.day);
      }));
      dayList.sort((a,b)=>a-b);
      if(!dayList.length) dayList.push(0, 7, 28);
      const missingDays = dayList.filter(day =>
        ltvRows.every(r => { const pt=(r.points||[]).find(q=>q.day===day); return !pt || pt.value == null; }));
      makeChart('cvGrowthLtv','line',{
        labels: dayList.map(x=>'D'+x + (missingDays.indexOf(x)>=0 ? ' •' : '')),
        datasets: ltvRows.map((r,i)=>({
          label:r.platform,
          data: dayList.map(day=>{
            const pt = (r.points||[]).find(q=>q.day===day);
            return pt ? pt.value : null;
          }),
          spanGaps:true,
          borderColor:[cc.lime,cc.cyan,cc.magenta][i%3], backgroundColor:'transparent',
          tension:.35, borderWidth:2, pointRadius:3
        }))
      }, {
        plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}},
          tooltip:{callbacks:{
            label:c=>(c.parsed.y == null)
              ? '  '+c.dataset.label+': not yet reported'
              : '  '+c.dataset.label+': $'+(+c.parsed.y).toFixed(4),
            afterLabel:c=>{
              const r = ltvRows[c.datasetIndex];
              const pt = r && (r.points||[]).find(q=>q.day===dayList[c.dataIndex]);
              return pt && pt.samples ? '  from '+pt.samples+' cohort days' : '';
            }}}},
        onHover:null,
        // Cumulative revenue starts at zero, so the axis must too — otherwise a
        // few cents of movement looks like a cliff.
        scales:{x:xAx,y:{grid:{color:cc.grid},beginAtZero:true,min:0,
          ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtMoney(v, 3)}}}
      });
      const ltvCard = g('cvGrowthLtv') && g('cvGrowthLtv').closest ? g('cvGrowthLtv').closest('.card') : null;
      const ltvHd = ltvCard && ltvCard.querySelector('.card-hd');
      if(ltvHd){
        let tag = ltvHd.querySelector('.row-count');
        if(!tag){ tag = document.createElement('span'); tag.className='row-count'; ltvHd.appendChild(tag); }
        tag.textContent = missingDays.length
          ? missingDays.map(x=>'D'+x).join(', ') + ' not yet reported'
          : 'D' + dayList.join(', D') + ' reported';
      }
    } else { wrapEmpty('cvGrowthLtv','No LTV rows in range'); }
  }

  // Ad network table. Fill rate is responses over attempts, computed server-side
  // from the totals; older rows that report no counts show a dash.
  const nets = (d.monetization&&d.monetization.networks)||[];
  if(g('growthNetworkTbl')){
    g('growthNetworkTbl').innerHTML = nets.length ? nets.map(n=>
      '<div class="tbl-row five">'
      + '<div class="tname">'+n.network+'</div>'
      + '<div class="tnum">$'+fmtKn(n.revenue)+'</div>'
      + '<div class="tnum">'+fmtKn(n.impressions)+'</div>'
      + '<div class="tnum">'+fmtMoney(n.ecpm, 2)+'</div>'
      + '<div class="tnum">'+(n.fillRate!=null?n.fillRate.toFixed(1)+'%':'—')+'</div>'
      + '</div>').join('')
      // The server explains an empty table — which tab, which date, which platform.
      : noData((d.monetization&&d.monetization.networksNote) || 'No ad network rows in range');
    markTable('growthNetworkTbl', nets.length, 'networks');
  }

  /* The same table by AD TYPE, from User Activity Raw.
  
     AdPerformance was the preferred source for eCPM in the payload and does
     not exist in either workbook. User Activity Raw carries the same measures
     AND splits them by ad type, which AdPerformance's one row a day could
     not - so the breakdown comes from the tab that has it. */
  const adTypes = (d.monetization&&d.monetization.adTypes)||[];
  if(g('growthAdTypeTbl')){
    g('growthAdTypeTbl').innerHTML = adTypes.length ? adTypes.map(t=>
      '<div class="tbl-row five">'
      + '<div class="tname">'+t.adType+'</div>'
      + '<div class="tnum">$'+fmtKn(t.revenue)+'</div>'
      + '<div class="tnum">'+fmtKn(t.impressions)+'</div>'
      + '<div class="tnum">'+(t.ecpm!=null?fmtMoney(t.ecpm, 2):'—')+'</div>'
      + '<div class="tnum">'+(t.viewerRate!=null?t.viewerRate.toFixed(1)+'%':'—')+'</div>'
      + '</div>').join('')
      : noData((d.monetization&&d.monetization.adTypesNote) || 'No ad type rows in range');
    markTable('growthAdTypeTbl', adTypes.length, 'ad types');
  }

  // Whale concentration was removed with its card.
  //
  // It read d.monetization.whale, which comes from a tab called Whales, and
  // growthProbe found that tab does not exist - not in the dashboard's
  // workbook and not at the source. So the chart could never fill.
  //
  // What it showed instead was "No whale rows in range (weekly grain)",
  // which reads as a quiet fortnight. Somebody widening the range to find
  // the missing weeks would have found nothing and had no way to learn why.
  // A card that cannot ever be right is worse than no card: it takes the
  // space, and it invites the question every time.
  //
  // The payload still carries the section, and readTab on a tab that is not
  // there costs nothing. If Whales is ever built, this is one card and one
  // chart to restore - the backend half already works.

  // First-time payer conversion
  const ftpRows = getWindow((d.monetization&&d.monetization.ftp)||[]);
  if(g('cvGrowthFtp')){
    if(ftpRows.length){
      const byDate = {};
      ftpRows.forEach(r=>{ if(!byDate[r.date]) byDate[r.date]={date:r.date,installs:0,payers:0}; byDate[r.date].installs+=r.installs; byDate[r.date].payers+=r.firstPayers; });
      const rows = Object.keys(byDate).sort().map(k=>byDate[k]);
      makeChart('cvGrowthFtp','line',{
        labels: rows.map(r=>r.date.slice(5)),
        datasets:[{label:'First-payer conv %',data:rows.map(r=>r.installs>0?+(r.payers/r.installs*100).toFixed(3):null),borderColor:cc.lime,backgroundColor:cc.lime+'22',fill:true,tension:.35,borderWidth:2,pointRadius:0,spanGaps:true}]
      }, { scales:{x:xAx,y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>(+v).toFixed(2)+'%'}}} });
    } else {
      /* Say WHEN it stopped, not just that there is nothing here.

         "No first-payer rows in range" reads as a quiet fortnight, and it
         said exactly that for the three months after the FirstPayers tab
         stopped being written on 2026-08-06. Somebody widening the range to
         find the missing weeks would have found nothing and learnt nothing.

         freshness carries the newest date in each source, so the chart can
         name it. If the entry is absent the old wording stands - an unknown
         date is not worth inventing. */
      const ftpLatest = (d.freshness && (d.freshness.sources||[])
        .filter(s=>s.source==='First payers')[0] || {}).latest;
      wrapEmpty('cvGrowthFtp', ftpLatest
        ? 'FirstPayers stopped on ' + ftpLatest + ' — nothing written since'
        : 'No first-payer rows in range');
    }
  }

  /* -- United States -----------------------------------------------------

     payload.us, built by UsMarket.gs. One platform at a time, matching the
     rest of this tab: Android reads Sales_By_Country, iOS reads the App Store
     territory report, and neither sees the other.

     The Data team sees the reconciliation notice. Buyer-derived KPIs retain
     their unverified status until those inputs are reconciled.

     One axis per chart. Revenue and buyers are different scales, and a second
     y-axis would let any pair of series be drawn as agreeing. */
  const us = d.us || null;

  renderGrowthUsNotices(us);

  const usRows  = (us && us.rows) || [];
  const usTot   = (us && us.totals) || {};
  const usDates = usRows.map(function(r){ return r.date; });
  const usOk    = !!(us && us.buyersVerified);
  /* Appended to the two cards that divide by buyers, so the doubt travels
     with the figure instead of only sitting in the banner above. */
  const usSub   = function(t){ return usOk ? t : t + ' \u00b7 unverified'; };

  const usKpis = [
    { cls:'lm', lbl:'US Revenue', val:fmtMoney(usTot.revenueUsd||0),
      sub:'gross \u00b7 ' + ((us && us.sources && us.sources.all) || 'no source'),
      data: usRows.map(function(r){ return +r.revenueUsd||0; }),
      dates: usDates, col:'--lime' },
    { cls:'vl', lbl:'US Purchases', val:fmtKn(usTot.purchases||0),
      sub:'net of refunds',
      data: usRows.map(function(r){ return +r.purchases||0; }),
      dates: usDates, col:'--violet' },
    { cls:'mg', lbl:'US ARPPU',
      val: usTot.arppu!=null ? fmtMoney(usTot.arppu, 2) : '\u2014',
      sub: usSub('total sales \u00f7 total buyers'),
      data: usRows.map(function(r){
        return (r.buyers>0) ? (+r.revenueUsd||0)/r.buyers : null; }),
      dates: usDates, col:'--magenta' },
    { cls:'am', lbl:'US Buyer Rate',
      val: usTot.buyerRate!=null ? (usTot.buyerRate*100).toFixed(3)+'%' : '\u2014',
      sub: usSub('buyers \u00f7 active users'),
      data: usRows.map(function(r){
        return (r.activeUsers>0 && r.buyers!=null) ? r.buyers/r.activeUsers*100 : null; }),
      dates: usDates, col:'--amber' }
  ];
  paintKpis('growthUsKpis', usKpis, 'gke');

  if(g('cvGrowthUsRev')){
    if(usRows.some(function(r){ return r.revenueUsd > 0; })){
      makeChart('cvGrowthUsRev','bar',{
        labels: usRows.map(function(r){ return r.date.slice(5); }),
        datasets:[{ label:'US revenue',
          data: usRows.map(function(r){ return +r.revenueUsd||0; }),
          backgroundColor: cc.lime+'cc', borderColor: cc.lime, borderWidth:0,
          borderRadius:4, borderSkipped:'bottom' }]
      }, { scales:{ x:xAx, y:{ grid:{color:cc.grid}, ticks:{ color:cc.text,
          font:{family:CHART_FONT,size:9},
          callback:function(v){ return fmtMoney(v); } } } } });
    } else {
      /* No tab at all is somebody's errand; no rows in range is a date
         question. The backend's note says which, and it is already on screen
         above, so this only has to avoid claiming the wrong one. */
      wrapEmpty('cvGrowthUsRev', us ? 'No US revenue rows in this range'
                                    : 'The payload carries no US section');
    }
  }

  if(g('cvGrowthUsBuyers')){
    const usBuy = usRows.filter(function(r){ return r.buyers != null; });
    if(usBuy.length){
      makeChart('cvGrowthUsBuyers','line',{
        labels: usBuy.map(function(r){ return r.date.slice(5); }),
        datasets:[
          { label:'Buyers', data: usBuy.map(function(r){ return +r.buyers||0; }),
            borderColor: cc.cyan, backgroundColor: cc.cyan+'22', fill:true,
            tension:.35, borderWidth:2, pointRadius:0, spanGaps:true },
          { label:'First-time buyers',
            data: usBuy.map(function(r){ return +r.newBuyers||0; }),
            borderColor: cc.magenta, backgroundColor:'transparent',
            tension:.35, borderWidth:2, pointRadius:0, spanGaps:true }
        ]
      }, { scales:{ x:xAx, y:yKn } });
    } else {
      wrapEmpty('cvGrowthUsBuyers', 'No GA4_Daily_US rows in this range');
    }
  }

}

// ═════════════════════════════════════════
// SPEND & INSTALL MATRIX  (mirrors Sheet4)
//
// Rows, labels and number formats are copied 1:1 from Sheet4.
// Columns follow the dashboard range filter, bucketed by the grain
// dropdown: one per day, per Mon–Sun week, or per calendar month.
//
// Renders for whichever game is selected, so it covers both the
// Android and the iOS view; only the title row changes.
// ═════════════════════════════════════════

/* Weeks in Sheet4 run Monday → Sunday. With this on, the matrix snaps
   the dashboard range back to the last complete Sunday so every block
   is a whole sheet week. Turn it off to use the dashboard's exact
   dates instead — trailing part-weeks are then labelled "Total (Nd)". */
// Keep the matrix on the dashboard's exact selected range. Its data is bundled
// into fetchAll, so snapping to a second range would require another request
// and let the two views fall out of sync again.
const MX_SNAP_TO_SUNDAY = false;

/* Title row (Sheet4 row 1), per game. */
const MX_TITLES = {
  mss_ios:     'My Supermarket Simulator 3D® (iOS)',
  mss_android: 'My Supermarket Simulator 3D® (Android)'
};

/* Networks in the order Sheet4 lists them. `platform` pins a network to one
   store; it is only a default, since a network the API actually returns data
   for is always shown whichever platform it turns up on. */
const MX_NETWORKS = [
  {n:'Applovin'},         {n:'Apple', platform:'ios'},  {n:'ironsource'}, {n:'Liftoff'},
  {n:'InMobi'},           {n:'Facebook'},               {n:'NativeX'},    {n:'Aarki'},
  {n:'Unity'},            {n:'Moloco'},                 {n:'Mintegral'},  {n:'TIKTOK'},
  {n:'Google Ads', platform:'android'}
];

/* The rows either side of the two network blocks. band = colour band,
   fmt = int | dec | pct */
const MX_ROWS_HEAD = [
  {type:'group', label:'IAP'},
  {key:'iap',         label:'IN-App (Proceeds)',    band:'b-iap',  fmt:'int'},
  {key:'deduction',   label:'Store Deduction 35%',  band:'b-iap',  fmt:'int', storeLabel:true},
  {key:'inappTotal',  label:'Total In-App Revenue', band:'b-tot',  fmt:'int'},
  {key:'rev_Applovin',label:'Revenue (Applovin)',   band:'b-rev',  fmt:'dec'},
  {key:'rev_GADSME',  label:'Revenue (GADSME)',     band:'b-rev',  fmt:'dec'},
  {key:'rev_Admob',   label:'Revenue (Admob)',      band:'b-rev',  fmt:'dec'},
  {key:'adTotal',     label:'Total Ad Revenue',     band:'b-adt',  fmt:'dec'},
  {key:'revTotal',    label:'Total Revenue',        band:'b-tot',  fmt:'dec'}
];
const MX_ROWS_TAIL = [
  {key:'costTotal',   label:'Total Daily Cost',     band:'b-cost', fmt:'dec'},
  {key:'netProfit',   label:'Net Profit',           band:'b-net',  fmt:'dec'},
  {key:'roi',         label:'ROI',                  band:'b-roi',  fmt:'pct', ratio:true}
];

/** Sheet4's networks for this store, plus any the payload carries that it predates. */
function mxNetworksFor(platform, present){
  present = present || [];
  const base  = MX_NETWORKS.filter(x => !x.platform || x.platform === platform || present.indexOf(x.n) !== -1);
  const extra = present.filter(n => !MX_NETWORKS.some(x => x.n === n)).map(n => ({n:n}));
  return base.concat(extra);
}

/** The full row spine, rebuilt per render because the network list can change. */
function mxRows(platform, present){
  const nets = mxNetworksFor(platform, present);
  return MX_ROWS_HEAD
    .concat(nets.map(x=>({key:'inst_'+x.n, label:'Assisted Installs ('+x.n+')', band:'b-inst', fmt:'int'})))
    .concat([{key:'instTotal', label:'Total Assisted Installs', band:'b-inst', fmt:'int'}])
    .concat(nets.map(x=>({key:'cost_'+x.n, label:'Daily Cost ('+x.n+')', band:'b-cost', fmt:'dec'})))
    .concat(MX_ROWS_TAIL);
}

const MX_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** '2025-01-06' → '06-Jan-2025', the sheet's own date format. */
function mxLabelDate(iso){
  const p = iso.split('-');
  return p[2] + '-' + MX_MON[+p[1]-1] + '-' + p[0];
}
/** Day of week for an ISO date, 0 = Sunday. Parsed as UTC, so no clock drift. */
function mxDow(iso){ return new Date(iso + 'T00:00:00Z').getUTCDay(); }

/* Column grain: one column per day, per Mon–Sun week, or per calendar month.
   The date window itself always comes from the dashboard range filter; the
   grain only decides how those dates are bucketed into columns. */
let MX_GRAIN = 'daily';

function mxSetGrain(v){
  MX_GRAIN = v;
  const badge = g('mxGrainBadge');
  if(badge) badge.textContent = v;
  renderSpendMatrix();
}

/** '2026-07-13' → '13-Jul'. The long form is kept for daily columns. */
function mxShortDate(iso){
  const p = iso.split('-');
  return p[2] + '-' + MX_MON[+p[1]-1];
}

/**
 * Buckets the window's dates into columns.
 *
 * Returns [{ label, dates:[iso], full }]. `full` is false for a week or month
 * the range only partly covers, which the label then says out loud rather than
 * quietly showing a short period next to complete ones.
 */
function mxPeriods(dates, grain){
  if(grain === 'daily'){
    return dates.map(iso => ({ label: mxLabelDate(iso), dates:[iso], full:true }));
  }

  const buckets = [];
  let key = null;
  dates.forEach(iso => {
    // Weeks are keyed by their Monday, months by yyyy-MM.
    const k = (grain === 'weekly')
      ? isoShift(iso, -((mxDow(iso) + 6) % 7))
      : iso.slice(0, 7);
    if(k !== key){ buckets.push({ k:k, dates:[] }); key = k; }
    buckets[buckets.length-1].dates.push(iso);
  });

  return buckets.map(b => {
    const first = b.dates[0], last = b.dates[b.dates.length-1];
    if(grain === 'weekly'){
      const full = b.dates.length === 7;
      return {
        label: mxShortDate(first) + ' → ' + mxShortDate(last) + (full ? '' : ' (' + b.dates.length + 'd)'),
        dates: b.dates, full: full
      };
    }
    const monthLen = new Date(Date.UTC(+first.slice(0,4), +first.slice(5,7), 0)).getUTCDate();
    const full = b.dates.length === monthLen;
    return {
      label: MX_MON[+first.slice(5,7)-1] + ' ' + first.slice(0,4) + (full ? '' : ' (' + b.dates.length + 'd)'),
      dates: b.dates, full: full
    };
  });
}

/**
 * The dates the matrix draws, oldest first, taken from the dashboard range.
 * With MX_SNAP_TO_SUNDAY the window is whole Mon–Sun sheet weeks ending on the
 * last complete Sunday at or before the range end.
 */
function mxDates(){
  const rangeEnd = dateTo || dataThrough();
  let start, n;

  if(MX_SNAP_TO_SUNDAY){
    // Today is still filling, so it can never close a week. dataThrough()
    // already excludes it; this stays for a range the user typed by hand.
    let anchor = (rangeEnd === sheetToday()) ? isoShift(rangeEnd, -1) : rangeEnd;
    const dow  = mxDow(anchor);
    const end  = (dow === 0) ? anchor : isoShift(anchor, -dow);
    n     = Math.max(1, Math.ceil((activeRange || 14) / 7)) * 7;
    start = isoShift(end, -(n - 1));
  } else {
    n     = Math.max(1, activeRange || 14);
    start = dateFrom || isoShift(rangeEnd, -(n - 1));
    n     = Math.round((new Date(rangeEnd+'T00:00:00Z') - new Date(start+'T00:00:00Z'))/86400000) + 1;
  }

  const out = [];
  for(let i = 0; i < n; i++) out.push(isoShift(start, i));
  return out;
}

// ── Data: action=spendMatrix on the same web app as everything else ──────────
//
// The current dashboard window arrives inside fetchAll. The endpoint/store below
// remains as a compatibility fallback for an older deployed backend.

const MX_STORE   = {};    // 'gameId|from|to' → { days, networks, builtAt }
const _mxPending = {};    // windows currently in flight
const _mxFailed  = {};    // windows that errored, so we do not retry in a loop
let   _mxError   = '';

// ── Acquisition cards: action=spendCards, same Sheet1 rollup as the matrix ──
//
// UA Spend, Avg CPI and ROI come from the sheet rather than the fetchAll
// payload, so the cards and the matrix below them can never disagree. These use
// the dashboard's own range, not the matrix's Sunday-snapped window.

const SC_STORE   = {};    // 'gameId|from|to' → { totals, previous }
const _scPending = {};
const _scFailed  = {};

async function scFetch(gameId, from, to){
  const key = gameId + '|' + from + '|' + to;
  if(_scPending[key]) return;
  _scPending[key] = true;

  try {
    const token = getToken();
    const params = [
      'action=spendCards',
      'key='    + encodeURIComponent(SHEET_API_KEY),
      'gameId=' + encodeURIComponent(gameId),
      'from='   + encodeURIComponent(from),
      'to='     + encodeURIComponent(to),
      token ? 'token=' + encodeURIComponent(token) : '',
      '_cb=' + Date.now()
    ].filter(Boolean).join('&');

    const res = await fetch(SHEET_API_URL + '?' + params, { redirect:'follow', cache:'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if(j.error) throw new Error(j.error);

    SC_STORE[key] = { totals: j.totals || null, previous: j.previous || null };
    delete _scFailed[key];
  } catch(err){
    _scFailed[key] = true;
    console.warn('[cards] load failed:', err.message || err);
  } finally {
    delete _scPending[key];
    if(currentTab === 'growth') renderGrowth();
  }
}

/** Sheet figures for the current range, or null while they are still loading. */
function scCurrent(){
  const from = dateFrom, to = dateTo;
  if(!from || !to) return null;
  const bundled = DATA[currentGame] && DATA[currentGame].sheet1;
  if(bundled && bundled.cards && !bundled.error) return bundled.cards;
  const key = currentGame + '|' + from + '|' + to;
  if(!SC_STORE[key] && !_scPending[key] && !_scFailed[key]) scFetch(currentGame, from, to);
  return SC_STORE[key] || null;
}

function mxWindowKey(gameId, from, to){ return gameId + '|' + from + '|' + to; }

/**
 * The matrix's per-day rows for any window, fetched on demand.
 *
 * The matrix card asks for whole Sheet4 weeks; charts want the dashboard's exact
 * range, so this keeps a second window in the same store. Returns {} until the
 * response lands, and the render that follows fills it in.
 */
function mxDaysForRange(from, to){
  if(!from || !to) return null;
  const bundled = DATA[currentGame] && DATA[currentGame].sheet1;
  const meta = DATA[currentGame] && DATA[currentGame].meta;
  if(bundled && bundled.matrix && !bundled.error && meta && meta.from === from && meta.to === to){
    return bundled.matrix.days || {};
  }
  const key = mxWindowKey(currentGame, from, to);
  const store = MX_STORE[key];
  if(!store && !_mxPending[key] && !_mxFailed[key]) mxFetch(currentGame, from, to);
  return store ? store.days : null;
}

async function mxFetch(gameId, from, to){
  const key = mxWindowKey(gameId, from, to);
  if(_mxPending[key]) return;
  _mxPending[key] = true;
  mxSetFlag('loading', 'loading…');

  try {
    const token = getToken();
    const params = [
      'action=spendMatrix',
      'key='    + encodeURIComponent(SHEET_API_KEY),
      'gameId=' + encodeURIComponent(gameId),
      'from='   + encodeURIComponent(from),
      'to='     + encodeURIComponent(to),
      token ? 'token=' + encodeURIComponent(token) : '',
      '_cb=' + Date.now()
    ].filter(Boolean).join('&');

    const res = await fetch(SHEET_API_URL + '?' + params, { redirect:'follow', cache:'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if(j.error) throw new Error(j.error);

    MX_STORE[key] = {
      days:     j.days     || {},
      networks: j.networks || [],
      builtAt:  (j.meta && j.meta.builtAt) || ''
    };
    delete _mxFailed[key];
    _mxError = '';
  } catch(err){
    _mxFailed[key] = true;
    _mxError = err.message || String(err);
    console.warn('[matrix] load failed:', _mxError);
  } finally {
    delete _mxPending[key];
    if(currentTab === 'growth') renderSpendMatrix();
  }
}

/** The amber chip next to the meta line: loading, empty, or an error. */
function mxSetFlag(state, text){
  const el = g('mxFlag');
  if(!el) return;
  el.style.display = state ? '' : 'none';
  el.textContent = text || '';
  el.style.color = el.style.borderColor = (state === 'error') ? 'var(--coral)' : 'var(--amber)';
}

function mxFmt(v, fmt){
  if(v === null || v === undefined || v === '') return '<span class="mx-nil">—</span>';
  if(fmt === 'pct') return (v * 100).toFixed(2) + '%';
  const n = (fmt === 'int')
    ? Math.round(v).toLocaleString('en-US')
    : v.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  return v < 0 ? '<span class="mx-neg">' + n + '</span>' : n;
}

let _mxKey = '';          // game + range the grid was last drawn for
let _mxWheel = false;     // shift-wheel handler attached once

function renderSpendMatrix(){
  const tbl = g('mxTable'), box = g('mxScroll');
  if(!tbl || !box) return;

  const dates    = mxDates();
  const from     = dates[0], to = dates[dates.length - 1];
  const winKey   = mxWindowKey(currentGame, from, to);
  const bundled  = DATA[currentGame] && DATA[currentGame].sheet1;
  const dataMeta = DATA[currentGame] && DATA[currentGame].meta;
  const bundledStore = bundled && bundled.matrix && !bundled.error && dataMeta
    && dataMeta.from === from && dataMeta.to === to ? bundled.matrix : null;
  const store    = bundledStore || MX_STORE[winKey];
  const platform = currentGame === 'mss_ios' ? 'ios' : 'android';

  // Ask the sheet for this window the first time it is drawn. The grid renders
  // as dashes meanwhile and repaints itself when the response lands.
  if(!store && !_mxPending[winKey] && !_mxFailed[winKey]) mxFetch(currentGame, from, to);

  const days = (store && store.days) || {};
  const data = dates.map(iso => days[iso] || {});
  // Keep a row only when at least one displayed day contains a real, non-zero
  // value. This removes unused network rows without hiding partially populated
  // rows or meaningful negative totals such as Net Profit.
  const rows = mxRows(platform, (store && store.networks) || []).filter(function(row){
    if(row.type === 'group') return true;
    return data.some(function(day){
      if(row.ratio){
        const cost = +day.costTotal || 0;
        const ratio = cost ? (+day.revTotal || 0) / cost : 0;
        return Number.isFinite(ratio) && ratio !== 0;
      }
      const value = day[row.key];
      return value !== null && value !== undefined && value !== ''
        && Number.isFinite(+value) && +value !== 0;
    });
  });

  // One column per period. At daily grain each period is a single date, so this
  // is the sheet's own layout; weekly and monthly roll those dates up.
  const periods = mxPeriods(dates, MX_GRAIN);
  const agg = MX_GRAIN !== 'daily';        // aggregated columns get the bolder treatment
  const dayAt = {};
  dates.forEach((iso,i)=>{ dayAt[iso] = data[i]; });

  const title = MX_TITLES[currentGame]
    || ((games.find(x=>x.id===currentGame) || {}).name)
    || 'Spend & install';

  // ── header: title row, then the period row ──
  let head = '<thead>'
    + '<tr class="mx-r-title"><th colspan="' + (1 + periods.length) + '"><span>' + title + '</span></th></tr>'
    + '<tr class="mx-r-dates"><th class="mx-lbl">Date</th>';
  periods.forEach(pd=>{
    head += '<th' + (agg ? ' class="mx-wt"' : '') + '>' + pd.label + '</th>';
  });
  head += '</tr></thead>';

  // ── body ──
  let body = '<tbody>';
  rows.forEach(r=>{
    if(r.type === 'group'){
      body += '<tr class="mx-grp"><td class="mx-lbl">' + r.label + '</td>'
            + '<td colspan="' + periods.length + '"></td></tr>';
      return;
    }
    const rowLabel = r.storeLabel
      ? (platform === 'ios' ? 'App Store Deduction 35%' : 'Google Play Store Deduction 35%')
      : r.label;
    body += '<tr class="' + r.band + '"><td class="mx-lbl" title="' + rowLabel + '">' + rowLabel + '</td>';

    periods.forEach(pd=>{
      let sum = 0, any = false, rev = 0, cost = 0;
      pd.dates.forEach(iso=>{
        const day = dayAt[iso] || {};
        const v = r.nil ? null : day[r.key];
        if(v !== null && v !== undefined){ sum += v; any = true; }
        rev  += +day.revTotal  || 0;
        cost += +day.costTotal || 0;
      });
      let v;
      if(r.ratio)   v = cost ? rev / cost : null;        // ROI is a ratio, not a sum
      else if(!any) v = null;
      else          v = (r.fmt === 'int') ? Math.round(sum) : +sum.toFixed(2);
      body += '<td' + (agg ? ' class="mx-wt"' : '') + '>' + mxFmt(v, r.fmt) + '</td>';
    });
    body += '</tr>';
  });
  body += '</tbody>';

  const keep = box.scrollLeft;
  const key  = currentGame + '|' + MX_GRAIN + '|' + dates[0] + '|' + dates[dates.length-1];
  tbl.innerHTML = head + body;

  if(_mxFailed[winKey])              mxSetFlag('error', 'load failed — ' + (_mxError || 'unknown error'));
  else if(_mxPending[winKey])        mxSetFlag('loading', 'loading…');
  else if(!Object.keys(days).length) mxSetFlag('empty', 'no rows in this range');
  else                               mxSetFlag('', '');

  const meta = g('mxMeta');
  if(meta){
    const unit = MX_GRAIN === 'daily' ? 'daily' : MX_GRAIN === 'weekly' ? 'weekly' : 'monthly';
    meta.innerHTML = '<b>' + periods.length + '</b> ' + unit + ' column'
      + (periods.length === 1 ? '' : 's') + ' · '
      + '<b>' + dates.length + '</b> days · '
      + '<b>' + rows.filter(x=>!x.type).length + '</b> rows · '
      + mxLabelDate(dates[0]) + ' → ' + mxLabelDate(dates[dates.length-1]);
  }

  // Hold the reader's place across a re-render of the same view; a new game or
  // range opens on the newest dates instead.
  if(key === _mxKey) box.scrollLeft = keep;
  else               mxJump('end');
  _mxKey = key;

  if(!_mxWheel){
    box.addEventListener('wheel', function(e){
      if(e.shiftKey && e.deltaY){ e.preventDefault(); this.scrollLeft += e.deltaY; }
    }, {passive:false});
    _mxWheel = true;
  }
}

function mxJump(where){
  const el = g('mxScroll');
  if(!el) return;
  el.scrollLeft = (where === 'end') ? el.scrollWidth : 0;
}

function mxToggleSheetColours(){
  const tbl = g('mxTable'); if(!tbl) return;
  const on = tbl.classList.toggle('sheet');
  const btn = g('mxSheetBtn'); if(btn) btn.classList.toggle('on', on);
}

/**
 * Shows an empty state over a chart slot WITHOUT destroying the canvas.
 * The previous version overwrote the parent's innerHTML, which deleted the
 * <canvas> permanently — so once a card went empty it could never render
 * again, even after real data arrived.
 */
function wrapEmpty(canvasId, reason){
  const el = g(canvasId);
  if(!el) return;
  if(charts[canvasId]){ try{charts[canvasId].destroy();}catch(e){} delete charts[canvasId]; }
  el.style.display = 'none';
  const box = el.parentElement;
  if(!box) return;
  let ph = box.querySelector('.empty-ph');
  if(!ph){
    ph = document.createElement('div');
    ph.className = 'empty-ph';
    box.appendChild(ph);
  }
  ph.innerHTML = noData(reason);
  ph.style.display = '';
}

/** Undoes wrapEmpty so the canvas can be drawn on again. */
/**
 * Tables render every row for the selected range. Past ~15 rows the body
 * scrolls so a long list doesn't push the rest of the page away, and the card
 * header shows the true count.
 */
function markTable(containerId, count, noun){
  const el = g(containerId);
  if(!el) return;
  // Growth's outer table region scrolls the header and rows together.
  const bodyScrolls = !el.closest('.growth-table') && count > 15;
  try { el.classList.toggle('tbl-scroll', bodyScrolls); } catch(e){}
  const card = (el.closest && el.closest('.card')) || null;
  if(!card) return;
  // Keep header tracks aligned with the body when its 8px scrollbar appears.
  try { card.classList.toggle('has-table-scroll', bodyScrolls); } catch(e){}
  const hd = card.querySelector('.card-hd');
  if(!hd) return;
  let tag = hd.querySelector('.row-count');
  if(!tag){
    tag = document.createElement('span');
    tag.className = 'row-count';
    hd.appendChild(tag);
  }
  tag.textContent = count + ' ' + (noun || 'rows') + (count > 15 ? ' · scroll' : '');
}

/**
 * Chart.js measures its container at creation. A pane still hidden (or
 * mid-transition) yields a zero-height canvas that never repaints on its own.
 * Resize once the pane is definitely laid out, retrying while height is 0.
 */
function resizeChartsIn(pane, attempt){
  attempt = attempt || 0;
  if(!pane || attempt > 6) return;
  requestAnimationFrame(function(){
    let anyZero = false;
    Object.keys(charts).forEach(function(id){
      const el = g(id);
      if(!el || !pane.contains || !pane.contains(el)) return;
      const box = el.parentElement;
      const h = box ? box.clientHeight : 0;
      if(h === 0){ anyZero = true; return; }
      try { charts[id].resize(); } catch(e){}
    });
    if(anyZero) setTimeout(function(){ resizeChartsIn(pane, attempt + 1); }, 60);
  });
}

function clearEmpty(canvasId){
  const el = g(canvasId);
  if(!el) return;
  el.style.display = '';
  const box = el.parentElement;
  if(!box) return;
  const ph = box.querySelector('.empty-ph');
  if(ph) ph.style.display = 'none';
}

function renderRetention(){
  const d = curData(); if(!d) return;
  const cohorts = getWindow(d.retCohorts || []);
  const previous = previousDashboard();
  const prevCo  = previous.retCohorts || [];
  const curR    = getWindow(d.retention || []);      // D1-D7 + D14 for this platform
  const cur     = getWindow(d.daily || []);
  const cc      = chartColors();
  // The Retention tab now carries a Platform column, so the full D1-D7 + D14
  // curve is attributable on every view. isSplit is only the degraded path for a
  // payload that carries no curve at all (older sheet, or nothing in range).
  const isSplit = !curR.length || d.curveAvailable === false;
  const RET_DAYS = (d.retDays && d.retDays.length)
    ? d.retDays : ['d1','d2','d3','d4','d5','d6','d7','d14'];

  // Cohort-weighted average, matching how the backend computes the summary.
  const wAvg = function(rows, key){
    let acc = 0, w = 0;
    rows.forEach(function(r){
      const v = r[key];
      if(v == null || isNaN(v)) return;
      const size = +r.cohortSize || 1;
      acc += v * size; w += size;
    });
    return w > 0 ? acc / w : 0;
  };

  const sum = d.retSummary || {};
  // Keep every reported day available for the charts. DAY_STYLE selects the
  // smaller set shown as KPI cards.
  const dayVals = {};
  RET_DAYS.forEach(function(k){
    dayVals[k] = sum[k] != null ? sum[k] : null;
  });
  const prevVals = {};
  RET_DAYS.forEach(function(k){ prevVals[k] = previous.retSummary?.[k] ?? (wAvg(prevCo, k) || null); });

  const cohortSize = sum.cohortSize || sum2(cohorts, 'cohortSize');

  const DAY_STYLE = {
    d1:{cls:'cy',lbl:'D1 Retention'}, d4:{cls:'lm',lbl:'D4 Retention'},
    d7:{cls:'cy',lbl:'D7 Retention'},  d14:{cls:'mg',lbl:'D14 Retention'}
  };

  /* Same card as the Overview: label, value, change pill, and a small graph
     of the metric across the cohort dates in range. */
  const RET_COL = { cy:'--cyan', mg:'--magenta', am:'--amber', lm:'--lime', vl:'--violet', co:'--coral' };
  const kRows   = (isSplit ? cohorts : curR).slice().sort((a,b)=> String(a.date).localeCompare(String(b.date)));
  const kDates  = kRows.map(r => r.date);
  const num     = v => (v == null || v === '' || isNaN(v)) ? null : +v;
  const series  = k => kRows.map(r => num(r[k]));
  const coRows  = cohorts.slice().sort((a,b)=> String(a.date).localeCompare(String(b.date)));

  const retCards = RET_DAYS.filter(k => DAY_STYLE[k]).map(function(k){
    const st  = DAY_STYLE[k];
    const v   = dayVals[k], p = prevVals[k];
    const bad = (k === 'd1' && v && v < thresholds.d1.val)
             || (k === 'd7' && v && v < thresholds.d7.val);
    return { cls:st.cls, lbl:st.lbl, val:v != null ? fmtPct(v) : '—', bad:bad, cur:v, prev:p,
             data:series(k), dates:kDates, fmt:fmtPct };
  }).concat([
    { cls:'lm', lbl:'Cohort Size',   val:fmtKn(cohortSize), cur:cohortSize,
      prev:previous.retSummary?.cohortSize ?? (prevCo.length ? sum2(prevCo,'cohortSize') : null),
      data:coRows.map(r => num(r.cohortSize)), dates:coRows.map(r => r.date), fmt:fmtKn }
  ]);

  g('retKpis').innerHTML = retCards.map(function(c, i){
    return '<div class="kpi has-spark '+c.cls+'"><div class="kpi-text">'
      + '<div class="kpi-label">'+c.lbl+'</div>'
      + '<div class="kpi-val'+(c.bad?' dn':'')+'">'+c.val+'</div>'
      + kpiTrendHtml(c)
      + '</div><div class="kpi-spark-box"><canvas id="rk'+i+'"></canvas></div></div>';
  }).join('');
  retCards.forEach(function(c, i){
    if(!c.data.length) return;
    const color = getComputedStyle(document.documentElement).getPropertyValue(RET_COL[c.cls] || '--cyan').trim();
    drawSpark('rk'+i, c.data, color, c.fmt, c.dates);
  });

  // Churn is the share of the original cohort no longer active on each day.
  const curveKeys = isSplit ? ['d1','d3','d7','d14'] : RET_DAYS;
  const retention = curveKeys.map(k => {
    if(isSplit) return num(dayVals[k]);
    const reported = curR.map(r => num(r[k])).filter(v => v != null);
    return reported.length ? +avg(reported).toFixed(2) : null;
  });
  if(retention.every(v => v == null)){
    wrapEmpty('cvRetCurve', 'No matured retention cohorts in range');
  } else {
    const churn = retention.map(v => v == null ? null : +(100 - v).toFixed(2));
    makeChart('cvRetCurve','line',{
      labels:['D0', ...curveKeys.map(k => k.toUpperCase())],
      datasets:[
        {label:'Retention',data:[100,...retention],borderColor:cc.cyan,backgroundColor:cc.cyan+'22',fill:true,tension:.35,borderWidth:2,pointRadius:3,spanGaps:true},
        {label:'Cumulative churn',data:[0,...churn],borderColor:cc.coral,tension:.35,borderWidth:2,pointRadius:3,spanGaps:true}
      ]
    }, {
      plugins:{
        legend:{display:true,labels:{color:cc.text}},
        tooltip:{callbacks:{label:c => c.dataset.label + ': ' + c.parsed.y + '%'}}
      },
      scales:{y:{grid:{color:cc.grid},min:0,max:100,ticks:{color:cc.text,callback:v=>v+'%'}}}
    });
  }


  // ── Cohort heatmap ──
  // Row labels read "4th Nov", "5th Nov" rather than "11-04".
  const HM_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const hmDay = function(s){
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if(!m) return String(s || '');
    const dd = +m[3], t = dd % 100;
    const suf = (t >= 11 && t <= 13) ? 'th' : ({1:'st',2:'nd',3:'rd'}[dd % 10] || 'th');
    return dd + suf + ' ' + HM_MON[+m[2] - 1];
  };
  const hm = g('retHeatmap');
  if(hm){
    const rows = isSplit ? cohorts : curR;
    const keys = isSplit ? ['d1','d7','d14'] : RET_DAYS;
    if(!rows.length){ hm.innerHTML = noData('No retention rows in range'); }
    else {
      const maxV = Math.max.apply(null, rows.map(r=>Math.max.apply(null, keys.map(k=>+r[k]||0))).concat([1]));
      hm.innerHTML = '<div class="hm-grid" style="grid-template-columns:90px repeat('+keys.length+',1fr)">'
        + '<div class="hm-cell hm-hd"></div>'
        + keys.map(k=>'<div class="hm-cell hm-hd">'+k.toUpperCase()+'</div>').join('')
        + rows.slice(-14).map(r=>'<div class="hm-cell hm-lbl">'+hmDay(r.date)+'</div>'
            + keys.map(k=>{
                const v = +r[k];
                if(!v && v!==0) return '<div class="hm-cell hm-na">—</div>';
                const op = Math.min(1, v/maxV);
                // Inverted scale: the strongest retention is the darkest cell.
                const shade = ((1-op)*0.72+0.08).toFixed(2);
                // Light cells get solid black, heavier text; darker cells keep white.
                const dark = +shade >= 0.55;
                const ink = dark ? '#000' : 'var(--text)';
                return '<div class="hm-cell'+(dark?' hm-ink':'')+'" style="background:rgba(0,229,255,'+shade+');color:'+ink+'" title="'+r.date+' '+k+': '+v+'%">'+v.toFixed(1)+'</div>';
              }).join('')).join('')
        + '</div>';
    }
  }

  // ── Trends ──
  const trendRows = isSplit ? cohorts : curR;
  const allKeys   = isSplit ? ['d1','d7','d14'] : RET_DAYS;
  // Drop series with no values at all — D14 is empty until cohorts mature, and
  // an all-null series made the chart look broken on platform views.
  const trendKeys = allKeys.filter(k => trendRows.some(r => r[k] != null && !isNaN(r[k])));
  const palette = [cc.cyan,cc.magenta,cc.violet,cc.lime,cc.amber,cc.coral,cc.text];
  // Retention needs the cohort to mature, so recent dates are null. With
  // pointRadius 0 a sparse series renders as nothing at all — which is why the
  // platform trends looked like they never plotted. Show markers whenever a
  // series has gaps, so isolated values are still visible.
  const coverage = k => trendRows.filter(r => r[k] != null && !isNaN(r[k])).length;
  const densest  = trendKeys.reduce((m,k)=>Math.max(m, coverage(k)), 0);
  const sparse   = trendRows.length > 0 && densest < trendRows.length;

  if(!trendRows.length || !trendKeys.length){
    wrapEmpty('cvRetTrend', isSplit
      ? 'No matured retention cohorts in range — Executive_KPIs reports D1/D7/D14 only once a cohort has aged.'
      : 'No retention rows in range');
  } else {
    makeChart('cvRetTrend','line',{
      labels: trendRows.map(x=>x.date.slice(5)),
      datasets: trendKeys.map((k,i)=>({
        label:k.toUpperCase() + ' (' + coverage(k) + ')',
        data:trendRows.map(x=>x[k]),
        borderColor:palette[i%palette.length], backgroundColor:'transparent',
        tension:.35, borderWidth:1.8,
        pointRadius: sparse ? 3 : 0,
        pointBackgroundColor: palette[i%palette.length],
        spanGaps:true
      }))
    }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}},
           tooltip:{callbacks:{label:c=>'  '+c.dataset.label.replace(/ \(\d+\)$/,'')+': '+(c.parsed.y!=null?c.parsed.y+'%':'not matured')}}},
         scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
           y:{grid:{color:cc.grid},beginAtZero:true,ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>v+'%'}}} });

    // Say plainly how many dates actually carry data.
    const cardEl = g('cvRetTrend') && g('cvRetTrend').closest ? g('cvRetTrend').closest('.card') : null;
    const hd = cardEl && cardEl.querySelector('.card-hd');
    if(hd){
      let tag = hd.querySelector('.row-count');
      if(!tag){ tag = document.createElement('span'); tag.className='row-count'; hd.appendChild(tag); }
      tag.textContent = densest + ' of ' + trendRows.length + ' days matured';
    }
  }

  // ── Cohort card badge ──
  const badge = g('cohortBadge');
  if(badge){
    const shown = (isSplit ? cohorts : curR).length;
    badge.textContent = shown
      ? shown + ' cohort' + (shown === 1 ? '' : 's') + ' · ' + (d.platform === 'all' ? 'all platforms' : d.platform)
      : 'no data';
  }

  // ── Android vs iOS ──
  renderRetentionPlatform(d, RET_DAYS, cc);
}

/**
 * Shows the selected platform's retention, or compares both on a combined view.
 * Each bar is the cohort-weighted average across the dates in the window.
 */
function renderRetentionPlatform(d, RET_DAYS, cc){
  const canvas = g('cvRetPlatform');
  if(!canvas) return;
  const byP   = d.retByPlatform || {};
  const badge = g('retPlatBadge');

  const platform = currentGame === 'mss_android' ? 'android' : currentGame === 'mss_ios' ? 'ios' : d.platform;
  const SERIES = [
    { key:'android', label:'Android', color:cc.lime },
    { key:'ios',     label:'iOS',     color:cc.cyan }
  ].filter(s => !platform || platform === 'all' || s.key === platform)
    .map(s => ({...s, rows:getWindow(byP[s.key]?.curve || [])}))
    .filter(s => s.rows.some(r => RET_DAYS.some(k => isNum(r[k]))));

  if(!SERIES.length){
    if(badge) badge.textContent = 'unavailable';
    wrapEmpty('cvRetPlatform', d.retentionRaw && d.retentionRaw.platformAware === false
      ? 'The Retention tab has no Platform column — add one (Android / iOS) to see the split.'
      : 'No platform-split retention rows in range');
    return;
  }

  // Cohort-weighted so a big install day counts for more than a quiet one,
  // matching how the KPI cards above are computed.
  const wAvg = (rows, key) => {
    let acc = 0, w = 0, plain = 0, n = 0;
    rows.forEach(r => {
      const v = r[key];
      if(v == null || isNaN(v)) return;
      plain += +v; n++;
      const size = +r.cohortSize || 0;
      if(size > 0){ acc += v * size; w += size; }
    });
    return w > 0 ? +(acc / w).toFixed(2) : (n ? +(plain / n).toFixed(2) : null);
  };

  makeChart('cvRetPlatform','bar',{
    labels: RET_DAYS.map(k => k.toUpperCase()),
    datasets: SERIES.map(s => ({
      label: s.label,
      data: RET_DAYS.map(k => wAvg(s.rows, k)),
      backgroundColor: s.color + 'cc',
      borderColor: s.color,
      borderWidth: 1,
      borderRadius: 3
    }))
  }, {
    plugins:{
      legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}},
      tooltip:{callbacks:{label:c=>'  '+c.dataset.label+': '+(c.parsed.y!=null?c.parsed.y+'%':'—')}}
    },
    scales:{
      x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}},
      y:{grid:{color:cc.grid},beginAtZero:true,ticks:{color:cc.text,font:{family:CHART_FONT,size:10},callback:v=>v+'%'}}
    }
  });

  if(badge){
    const days = Math.max(...SERIES.map(s => s.rows.length));
    badge.textContent = SERIES.map(s => s.label).join(' · ') + ' · ' + days + ' days';
  }
}

/** Sums a numeric field across rows. */
function sum2(rows, key){ return (rows||[]).reduce((a,r)=>a+(+r[key]||0),0); }

function renderPlaytime(){
  const d = curData(); if(!d.daily) return;
  const cur  = getWindow(d.daily);
  const prev = previousDashboard().daily || [];
  const cc   = chartColors();
  const lbls = cur.map(x=>x.date.slice(5));

  const avgD0    = avgNN(cur.map(x=>x.d0Playtime));
  const avgPlay  = avgNN(cur.map(x=>x.playtimeAvg));
  const avgSess  = avgNN(cur.map(x=>x.sessionLenD0));
  const avgSessG = avgNN(cur.map(x=>x.avgSessionLen));
  const spu      = avgNN(cur.map(x=>x.sessionsPerUser));
  const totalHrs = sum(cur.map(x=>+x.playtimeHours||0));
  const totalSes = sum(cur.map(x=>+x.sessions||0));

  const pk = [
    { cls:'mg', lbl:'D0 Playtime',     val:fmtSec(avgD0),   cur:avgD0,  prev:averageReported(prev,'d0Playtime'), sub:'avg per new user', key:'d0Playtime', fmt:fmtSec },
    { cls:'cy', lbl:'Avg Playtime',    val:fmtSec(avgPlay), cur:avgPlay,prev:averageReported(prev,'playtimeAvg'), sub:'avg per active user', key:'playtimeAvg', fmt:fmtSec },
    { cls:'lm', lbl:'Session Len D0',  val:fmtSec(avgSess), cur:avgSess,prev:averageReported(prev,'sessionLenD0'), sub:'day-zero sessions', key:'sessionLenD0', fmt:fmtSec },
    { cls:'vl', lbl:'Avg Session Len', val:fmtSec(avgSessG),cur:avgSessG,prev:averageReported(prev,'avgSessionLen'), sub:'all sessions', key:'avgSessionLen', fmt:fmtSec },
    { cls:'am', lbl:'Sessions / User', val:spu?spu.toFixed(2):'—', cur:spu, prev:averageReported(prev,'sessionsPerUser'), sub:'per active user', key:'sessionsPerUser', fmt:v=>(+v).toFixed(2) },
    { cls:'cy', lbl:'Total Playtime',  val:fmtKn(totalHrs)+'h', cur:totalHrs, prev:prev.length ? sum2(prev,'playtimeHours') : null,
      sub:'period hours', key:'playtimeHours', fmt:v=>fmtKn(v)+'h' },
    { cls:'lm', lbl:'Total Sessions',  val:fmtKn(totalSes), cur:totalSes, prev:prev.length ? sum2(prev,'sessions') : null,
      sub:'period count', key:'sessions', fmt:fmtKn },
  ];
  /* Same card as the Overview: label, value, change pill and a small daily graph */
  const PK_COL = { cy:'--cyan', mg:'--magenta', am:'--amber', lm:'--lime', vl:'--violet', co:'--coral' };
  const pkDates = cur.map(x=>x.date);
  g('playKpis').innerHTML = pk.map((k,i)=>
    '<div class="kpi has-spark '+k.cls+'"><div class="kpi-text">'
    + '<div class="kpi-label">'+k.lbl+'</div><div class="kpi-val">'+k.val+'</div>'
    + kpiTrendHtml(k) + '<div class="kpi-bottom"><span class="kpi-sub">'+k.sub+'</span></div>'
    + '</div><div class="kpi-spark-box"><canvas id="pk'+i+'"></canvas></div></div>').join('');
  pk.forEach((k,i)=>{
    const data = cur.map(x => (x[k.key]==null || x[k.key]==='' || isNaN(x[k.key])) ? null : +x[k.key]);
    const color = getComputedStyle(document.documentElement).getPropertyValue(PK_COL[k.cls] || '--cyan').trim();
    drawSpark('pk'+i, data, color, k.fmt, pkDates);
  });

  const xAx = {grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}};
  const ySec= {grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>Math.round(v)+'s'}};

  makeChart('cvD0Play','line',{ labels:lbls,
    datasets:[{label:'D0 Playtime',data:cur.map(x=>x.d0Playtime),borderColor:cc.magenta,spanGaps:true,backgroundColor:cc.magenta+'22',fill:true,tension:.35,borderWidth:2,pointRadius:2}]
  }, {scales:{x:xAx,y:ySec}});

  makeChart('cvAvgPlay','line',{ labels:lbls,
    datasets:[{label:'Avg Playtime',data:cur.map(x=>x.playtimeAvg),borderColor:cc.cyan,backgroundColor:cc.cyan+'22',fill:true,tension:.35,borderWidth:2,pointRadius:2}]
  }, {scales:{x:xAx,y:ySec}});

  makeChart('cvSessLenPlay','line',{ labels:lbls,
    datasets:[
      {label:'Session length',data:cur.map(x=>x.avgSessionLen),borderColor:cc.lime,spanGaps:true,backgroundColor:cc.lime+'22',fill:true,tension:.35,borderWidth:2,pointRadius:2},
      {label:'Sessions / user',data:cur.map(x=>x.sessionsPerUser),borderColor:cc.amber,spanGaps:true,backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:2,yAxisID:'y2'},
    ]
  }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}},
       scales:{x:xAx,y:ySec,y2:{position:'right',grid:{display:false},ticks:{color:cc.amber,font:{family:CHART_FONT,size:9}}}} });

  makeChart('cvPlayHours','bar',{ labels:lbls,
    datasets:[{label:'Hours',data:cur.map(x=>+x.playtimeHours||0),backgroundColor:cc.cyan+'cc',borderColor:cc.cyan,borderWidth:1,borderRadius:3}]
  }, {scales:{x:xAx,y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtKn(v)+'h'}}}});

  // Ad exposure
  if(g('cvPlayAdExposure')){
    makeChart('cvPlayAdExposure','line',{ labels:lbls,
      datasets:[
        // A day the ad feeds have not reported yet must be a GAP, not a zero.
        // AdPerformance and User Activity Raw lag Network Raw by a day, so the
        // newest day has no ad rows — and a zero there reads as "nobody saw an
        // ad", which is a very different claim from "not reported yet".
        {label:'Impressions / DAU',data:cur.map(x=>x.impPerDau==null?null:+x.impPerDau),borderColor:cc.violet,backgroundColor:cc.violet+'22',fill:true,tension:.35,borderWidth:2,pointRadius:0,spanGaps:false},
        {label:'Ad viewer rate %',  data:cur.map(x=>x.adViewerRate==null?null:+x.adViewerRate),borderColor:cc.amber,backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0,yAxisID:'y2',spanGaps:false},
      ]
    }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}},
         scales:{x:xAx,y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
           y2:{position:'right',grid:{display:false},ticks:{color:cc.amber,font:{family:CHART_FONT,size:9},callback:v=>v+'%'}}} });
  }

  // Rewarded placements
  const pl = (d.engagement&&d.engagement.placements)||[];
  if(g('playPlacementTbl')){
    g('playPlacementTbl').innerHTML = pl.length ? pl.map(r=>
      '<div class="tbl-row five">'
      + '<div class="tname">'+r.location+'<small>'+r.platform+' · wk '+r.week+'</small></div>'
      + '<div class="tnum">'+fmtKn(r.count)+'</div>'
      + '<div class="tnum">'+(+r.eventsPerUser||0).toFixed(2)+'</div>'
      + '<div class="tnum">'+fmtSec(r.playtime)+'</div>'
      + '<div class="tnum">'+(+r.engagement||0).toFixed(2)+'%</div>'
      + '</div>').join('') : noData('No placement rows in range');
    markTable('playPlacementTbl', pl.length, 'placements');
  }

}

function renderFtue(){
  const d = curData();
  const f = d.ftueSteps || [];
  const cc = chartColors();
  const base = d.ftueBase || 0;

  const complete = f.length ? f[f.length-1].engagement : 0;
  // Branch steps (storySkipped vs storyViewed) are alternative paths, so their
  // "drop" is just the split between them and never the worst real churn.
  const biggest  = f.reduce(function(w,s){
    if(s.branch || s.stepDrop==null) return w;
    return (!w || s.stepDrop < w.stepDrop) ? s : w;
  }, null);
  const tenMin   = getWindow(d.tenMin || []);
  const tenPct   = avg(tenMin.map(x=>+x.pct||0));

  /* Same card as the Overview: label, value and a small graph.
     Step cards plot the funnel step by step; 10-min plots by day. */
  const nn = v => (v == null || v === '' || isNaN(v)) ? null : +v;
  const stepNames = f.map(s => s.id + '. ' + s.name);
  const fk = [
    { cls:'cy', col:'--cyan',  noTrend:true, lbl:'Funnel Base',     val:fmtKn(base),                       sub:'active users in range',
      data:f.map(s=>nn(s.users)), dates:stepNames, fmt:fmtKn },
    { cls:'lm', col:'--lime',  noTrend:true, lbl:'Completion',      val:complete?fmtPct(complete):'—',     sub:'final step engagement',
      data:f.map(s=>nn(s.engagement)), dates:stepNames, fmt:fmtPct },
    { cls:'co', col:'--coral', noTrend:true, lbl:'Biggest Drop',    val:biggest?fmtPct(biggest.stepDrop):'—', sub:biggest?biggest.name:'—',
      data:f.map(s=>s.branch ? null : nn(s.stepDrop)), dates:stepNames, fmt:fmtPct },
    { cls:'am', col:'--amber', lbl:'10-min Milestone',val:tenPct?fmtPct(tenPct):'—',         sub:'reached 10 minutes',
      data:tenMin.map(x=>nn(x.pct)), dates:tenMin.map(x=>x.date), fmt:fmtPct },
  ];
  g('ftueKpis').innerHTML = fk.map((k,i)=>
    '<div class="kpi has-spark '+k.cls+'"><div class="kpi-text">'
    + '<div class="kpi-label">'+k.lbl+'</div><div class="kpi-val">'+k.val+'</div>'
    + kpiTrendHtml(k) + '<div class="kpi-bottom"><span class="kpi-sub">'+k.sub+'</span></div>'
    + '</div><div class="kpi-spark-box"><canvas id="fk'+i+'"></canvas></div></div>').join('');
  fk.forEach((k,i)=>{
    if(!k.data.length) return;
    drawSpark('fk'+i, k.data, getComputedStyle(document.documentElement).getPropertyValue(k.col).trim(), k.fmt, k.dates);
  });

  const hidden = (d.ftue && d.ftue.hiddenCount) || 0;
  g('ftueBadge').textContent = f.length + ' steps' + (hidden ? ' · ' + hidden + ' low-volume hidden (<1%)' : '')
    + ((d.ftue && d.ftue.legacy) ? ' · legacy tab' : '');

  if(!f.length){
    if(g('ftueRows')) g('ftueRows').innerHTML = noData('No FTUE rows in range');
    wrapEmpty('cvFtueChart','No FTUE rows in range');
    return;
  }

  makeChart('cvFtueChart','bar',{
    labels: f.map(s=>'S'+s.id),
    datasets:[
      { type:'bar',  label:'Engagement %', data:f.map(s=>s.engagement), backgroundColor:cc.cyan+'cc', borderColor:cc.cyan, borderWidth:1, borderRadius:3, order:2 },
      { type:'line', label:'Playtime (s)', data:f.map(s=>s.playtimeSec), borderColor:cc.amber, backgroundColor:'transparent', borderWidth:2, pointRadius:2, tension:.3, yAxisID:'y2', order:1, spanGaps:true },
    ]
  }, {
    plugins:{ legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}},
      tooltip:{callbacks:{ title:c=>f[c[0].dataIndex].name,
        afterBody:c=>{ const s=f[c[0].dataIndex]; return '  users: '+fmtKn(s.users)+'\n  events/user: '+(s.eventsPerUser||'—'); } }} },
    scales:{ x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
      y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>v+'%'}},
      y2:{position:'right',grid:{display:false},ticks:{color:cc.amber,font:{family:CHART_FONT,size:9},callback:v=>Math.round(v)+'s'}} }
  });

  if(g('ftueRows')){
    g('ftueRows').innerHTML = f.map(s=>{
      const dropCls = (s.branch || s.stepDrop==null) ? '' : s.stepDrop < -15 ? 'pill-bad' : s.stepDrop < -5 ? 'pill-warn' : 'pill-good';
      return '<div class="tbl-row six">'
        + '<div class="tname">'+s.id+'. '+s.name+(s.branch?'<small>alternative path · not a drop-off</small>':'')+'</div>'
        + '<div class="tnum">'+fmtKn(s.users)+'</div>'
        + '<div><div class="mini-bar"><span style="width:'+Math.min(100,s.engagement||0).toFixed(1)+'%;background:'+cc.cyan+'"></span></div></div>'
        + '<div class="tnum">'+(s.engagement!=null?s.engagement.toFixed(1)+'%':'—')+'</div>'
        + '<div class="tnum '+dropCls+'">'+(s.branch?'alt':(s.stepDrop!=null?s.stepDrop.toFixed(1)+'%':'—'))+'</div>'
        + '<div class="tnum">'+(s.playtimeSec!=null?fmtSec(s.playtimeSec):'—')+'</div>'
        + '</div>';
    }).join('');
    markTable('ftueRows', f.length, 'steps');
  }

  if(g('cvTutorialTime')){
    if(tenMin.length){
      makeChart('cvTutorialTime','line',{
        labels: tenMin.map(x=>x.date.slice(5)),
        datasets:[
          {label:'10-min completion %',data:tenMin.map(x=>x.pct),borderColor:cc.magenta,backgroundColor:cc.magenta+'22',fill:true,tension:.35,borderWidth:2,pointRadius:2},
          {label:'Avg playtime at 10min (s)',data:tenMin.map(x=>x.playtime),borderColor:cc.amber,backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0,yAxisID:'y2'},
        ]
      }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}},
           scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
             y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>v+'%'}},
             y2:{position:'right',grid:{display:false},ticks:{color:cc.amber,font:{family:CHART_FONT,size:9},callback:v=>Math.round(v)+'s'}}} });
    } else { wrapEmpty('cvTutorialTime','No FTUE steps within the 10-minute mark in range'); }
  }
}

function renderStability(){
  const d = curData();
  const rows = getWindow(d.stability || []);
  const cc = chartColors();

  const and = rows.filter(r=>r.platform==='android');
  const ios = rows.filter(r=>r.platform==='ios');

  const crashAvg = avg(rows.filter(r=>r.crashRate!=null).map(r=>+r.crashRate));
  const anrAvg   = avg(and.filter(r=>r.anrRate!=null).map(r=>+r.anrRate));
  const crashFree= crashAvg ? 100 - crashAvg : null;

  /* Same card as the Overview: label, value and a small daily graph */
  const sDates = Array.from(new Set(rows.map(r=>r.date))).sort();
  const dayAvg = (arr, key) => sDates.map(d0 => {
    const v = arr.filter(r => r.date === d0 && r[key] != null && r[key] !== '' && !isNaN(r[key])).map(r => +r[key]);
    return v.length ? v.reduce((a,b)=>a+b,0) / v.length : null;
  });
  const crashSeries = dayAvg(rows, 'crashRate');
  const pct3 = v => (+v).toFixed(3) + '%';
  const sk = [
    { cls: crashAvg>thresholds.crash.val?'co':'lm', lbl:'Crash Rate', better:'down', val:crashAvg?crashAvg.toFixed(3)+'%':'—', sub:'limit '+thresholds.crash.val+'%',
      data:crashSeries, fmt:pct3 },
    { cls: anrAvg>thresholds.anr.val?'co':'lm',     lbl:'ANR Rate',   better:'down', val:anrAvg?anrAvg.toFixed(3)+'%':'—',     sub:'Android only · limit '+thresholds.anr.val+'%',
      data:dayAvg(and, 'anrRate'), fmt:pct3 },
    { cls:'cy', lbl:'Crash-Free Users', val:crashFree?crashFree.toFixed(3)+'%':'—', sub:'100 − crash rate',
      data:crashSeries.map(v => v == null ? null : 100 - v), fmt:pct3 },
    { cls:'vl', noTrend:true, lbl:'Days Tracked',     val:sDates.length, sub:(ios.length?'Android + iOS':'Android only'),
      data:sDates.map((_, i) => i + 1), fmt:v => String(Math.round(v)) },
  ];
  const SK_COL = { cy:'--cyan', mg:'--magenta', am:'--amber', lm:'--lime', vl:'--violet', co:'--coral' };
  g('stabKpis').innerHTML = sk.map((k,i)=>
    '<div class="kpi has-spark '+k.cls+'"><div class="kpi-text">'
    + '<div class="kpi-label">'+k.lbl+'</div><div class="kpi-val">'+k.val+'</div>'
    + kpiTrendHtml(k) + '<div class="kpi-bottom"><span class="kpi-sub">'+k.sub+'</span></div>'
    + '</div><div class="kpi-spark-box"><canvas id="sk'+i+'"></canvas></div></div>').join('');
  sk.forEach((k,i)=>{
    if(!k.data.length) return;
    drawSpark('sk'+i, k.data, getComputedStyle(document.documentElement).getPropertyValue(SK_COL[k.cls]).trim(), k.fmt, sDates);
  });

  if(!rows.length){
    wrapEmpty('cvCrash', (d.missing && d.missing.stability) || 'No stability rows in range');
    return;
  }

  const dates = Array.from(new Set(rows.map(r=>r.date))).sort();
  const pick = (arr,key)=>dates.map(d0=>{ const r=arr.find(x=>x.date===d0); return r? r[key] : null; });

  makeChart('cvCrash','line',{
    labels: dates.map(x=>x.slice(5)),
    datasets:[
      {label:'Crash rate (Android)',data:pick(and,'crashRate'),borderColor:cc.coral,backgroundColor:cc.coral+'22',fill:true,tension:.35,borderWidth:2,pointRadius:0,spanGaps:true},
      {label:'ANR rate (Android)',  data:pick(and,'anrRate'),  borderColor:cc.amber,backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0,spanGaps:true},
      {label:'Crash rate (iOS)',    data:pick(ios,'crashRate'),borderColor:cc.cyan, backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0,borderDash:[5,4],spanGaps:true},
    ]
  }, {
    plugins:{
      legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}},
      // The axis already carries a % sign; the hover did not, so 0.16 read as a
      // count rather than a rate. A null stays a dash — iOS reports no ANR, and
      // "0.00%" there would claim it measured none.
      tooltip:{callbacks:{label:c=>'  '+c.dataset.label+': '
        + (c.parsed.y==null ? '—' : (+c.parsed.y).toFixed(2)+'%')}}
    },
    scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
      y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>(+v).toFixed(2)+'%'}}}
  });

  if(g('stabLimits')) g('stabLimits').innerHTML =
    '<span style="color:var(--text2)">Crash: <b style="color:var(--coral)">'+thresholds.crash.val+'%</b></span>'
  + '<span style="color:var(--text2)">ANR: <b style="color:var(--amber)">'+thresholds.anr.val+'%</b></span>'
  + (ios.length ? '' : '<span style="color:var(--text3)">iOS feed connected, awaiting data</span>');

}

function renderRating(){
  const d  = curData();
  const rt = d.ratings || {daily:[]};
  const rows = getWindow(rt.daily || []);
  const cc = chartColors();

  const overall = avg(rows.map(r=>+r.rating||0));
  const first   = rows.length ? +rows[0].rating : 0;
  const last    = rows.length ? +rows[rows.length-1].rating : 0;

  // The Ratings tab has no platform column, so the sheet's figures describe the
  // app as a whole. Splitting them by platform would invent a distinction the
  // data does not make, so the KPIs report NPS alongside the rating instead.
  const sm  = (rt.summary || {});
  const npsRows = getWindow(rt.nps || []);
  const npsVal  = sm.nps != null ? +sm.nps : null;

  /* Same card as the Overview: label, value and a small daily graph */
  const rDates = rows.map(r=>r.date);
  const rSeries = rows.map(r => (r.rating == null || r.rating === '' || isNaN(r.rating)) ? null : +r.rating);
  const rk = [
    { cls:'am', col:'--amber', lbl:'In-Game Rating', val:overall?overall.toFixed(2):'—', sub:overall?starStr(overall):'awaiting data',
      data:rSeries, fmt:v=>(+v).toFixed(2) },
    { cls: last>=first?'lm':'co', col: last>=first?'--lime':'--coral', lbl:'Movement',
      val:(last&&first)?((last-first)>=0?'+':'')+(last-first).toFixed(2):'—', sub:'first vs last day in range',
      data:rSeries.map(v => (v == null || !first) ? null : +(v - first).toFixed(2)), fmt:v=>((+v)>=0?'+':'')+(+v).toFixed(2) },
  ];
  g('ratingKpis').innerHTML = rk.map((k,i)=>
    '<div class="kpi has-spark '+k.cls+'"><div class="kpi-text">'
    + '<div class="kpi-label">'+k.lbl+'</div><div class="kpi-val">'+k.val+'</div>'
    + kpiTrendHtml(k) + '<div class="kpi-bottom"><span class="kpi-sub">'+k.sub+'</span></div>'
    + '</div><div class="kpi-spark-box"><canvas id="rtk'+i+'"></canvas></div></div>').join('');
  rk.forEach((k,i)=>{
    if(!k.data.length) return;
    drawSpark('rtk'+i, k.data, getComputedStyle(document.documentElement).getPropertyValue(k.col).trim(), k.fmt, rDates);
  });
  /* The NPS and Responses tiles stay hidden with the NPS card; npsVal is
     still computed above, only the two tiles are withheld. */

  // ── NPS gauge ──
  if(g('ratingNps')){
    const pro = +sm.promoters||0, pas = +sm.passives||0, det = +sm.detractors||0;
    const tot = pro + pas + det;
    if(!tot && npsVal == null){
      g('ratingNps').innerHTML = noData('No NPS responses in range — the Ratings tab is wired and waiting for data');
    } else {
      // -100..100 mapped onto a 0..100 ring sweep.
      const sweep = Math.max(0, Math.min(100, ((npsVal||0) + 100) / 2));
      const bar = (lbl,v,col)=>'<div class="nps-row"><span class="lbl">'+lbl+'</span>'
        + '<div class="mini-bar"><span style="width:'+(tot?(v/tot*100):0).toFixed(1)+'%;background:'+col+'"></span></div>'
        + '<span class="num">'+(tot?(v/tot*100).toFixed(0)+'%':'—')+'</span></div>';
      const cD = cc.lime, cP = cc.amber, cN = cc.coral;
      g('ratingNps').innerHTML = '<div class="nps-hero">'
        + '<div class="nps-ring" style="border-radius:50%;background:conic-gradient('+cD+' 0% '+sweep.toFixed(1)+'%, var(--surface2) '+sweep.toFixed(1)+'% 100%)">'
        +   '<div class="nps-ring-val" style="background:var(--surface);border-radius:50%;margin:14px">'
        +     '<span class="big">'+(npsVal!=null?npsVal.toFixed(0):'—')+'</span>'
        +     '<span class="sub">NPS</span>'
        +   '</div>'
        + '</div>'
        + '<div class="nps-breakdown">'
        +   bar('Promoters', pro, cD) + bar('Passives', pas, cP) + bar('Detractors', det, cN)
        +   '<div class="nps-row"><span class="lbl">Responses</span><span class="num" style="grid-column:2/4;text-align:left">'+fmtKn(tot)+'</span></div>'
        + '</div></div>';
    }
  }

  if(!rows.length){
    wrapEmpty('cvRatingTrend','No in-game rating rows in range — the Ratings tab is wired and waiting for data');
  }
  else {
    clearEmpty('cvRatingTrend');
    const dates = Array.from(new Set(rows.map(r=>r.date))).sort();
    const pick  = (arr,key) => dates.map(d0=>{ const r=arr.find(x=>x.date===d0); return r? (r[key]!=null?+r[key]:null) : null; });
    // One rating line, not one per platform: the Ratings tab reports the app as
    // a whole. NPS rides a second axis so both trends read off the same dates.
    makeChart('cvRatingTrend','line',{
      labels: dates.map(x=>x.slice(5)),
      datasets:[
        {label:'In-game rating',data:pick(rows,'rating'),borderColor:cc.amber,backgroundColor:cc.amber+'22',fill:true,tension:.35,borderWidth:2,pointRadius:2,spanGaps:true},
        {label:'NPS',data:pick(npsRows,'nps'),borderColor:cc.cyan,backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:2,borderDash:[5,4],spanGaps:true,yAxisID:'y2'},
      ]
    }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}},
         scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
           y:{grid:{color:cc.grid},min:0,max:5,ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
           y2:{position:'right',grid:{display:false},min:-100,max:100,ticks:{color:cc.cyan,font:{family:CHART_FONT,size:9}}}} });
  }

}

/** One live-ops event as a card. Shared by the Overview tile and the Live Ops tab. */
function liveopCard(e){
  const type = ['sale','event','abtest'].indexOf(e.type) >= 0 ? e.type : 'other';
  const dates = (e.start || '?') + (e.end ? ' → ' + e.end : '');
  const up = (e.uplift == null || isNaN(e.uplift)) ? '' :
    '<span class="liveop-uplift ' + (e.uplift >= 0 ? 'pos' : 'neg') + '">'
    + (e.uplift >= 0 ? '▲ +' : '▼ ') + e.uplift + '%'
    + (e.upliftMetric ? ' ' + e.upliftMetric : '') + '</span>';
  return '<div class="liveop-card ' + type + '">'
    + '<div class="liveop-meta">'
    +   (e.status ? '<span class="liveop-status">' + e.status + '</span>' : '')
    +   up
    + '</div>'
    + '<div class="liveop-name">' + e.name + '</div>'
    + '<div class="liveop-type">' + e.type + ' · ' + (e.platform || 'both') + '</div>'
    + '<div class="liveop-dates">' + dates + '</div>'
    + '</div>';
}

function renderLiveOps(){
  const d  = curData();
  const cc = chartColors();
  // Events are filtered server-side to those overlapping the selected range,
  // so no getWindow() here — a two-week sale should not vanish because its
  // start date sits one day before the window.
  const evts = d.liveops || [];

  if(!evts.length){
    const reason = 'No live ops events overlapping ' + (d.meta.from||'?') + ' → ' + (d.meta.to||'?');
    ['liveopsKpis','liveopsGrid'].forEach(function(id){ if(g(id)) g(id).innerHTML = noData(reason); });
    if(g('liveopsUpliftWrap')) g('liveopsUpliftWrap').innerHTML = noData(reason);
    return;
  }

  const active  = evts.filter(e=>/active|running|live/i.test(e.status||''));
  const measured= evts.filter(e=>e.uplift!=null && !isNaN(e.uplift));
  const upAvg   = measured.length ? avg(measured.map(e=>+e.uplift)) : null;
  const best    = measured.slice().sort((a,b)=>b.uplift-a.uplift)[0] || null;
  const types   = Array.from(new Set(evts.map(e=>e.type)));

  g('liveopsKpis').innerHTML = [
    { cls:'cy', lbl:'Active Now',    val:active.length,  sub:evts.length+' in range' },
    { cls:(upAvg!=null && upAvg>=0)?'lm':'co', lbl:'Avg Uplift', val:upAvg!=null?(upAvg>=0?'+':'')+upAvg.toFixed(1)+'%':'—', sub:measured.length+' measured' },
    { cls:'am', lbl:'Best Performer',val:best?(best.uplift>=0?'+':'')+best.uplift+'%':'—', sub:best?best.name:'—' },
    { cls:'vl', lbl:'Event Types',   val:types.length,   sub:types.join(' · ')||'—' },
  ].map(k=>'<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.lbl+'</div><div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">'+k.sub+'</div></div>').join('');

  if(g('liveopsUpliftWrap')){
    if(measured.length){
      g('liveopsUpliftWrap').innerHTML = '<div class="cv-wrap tall"><canvas id="cvLiveopsUplift"></canvas></div>';
      makeChart('cvLiveopsUplift','bar',{
        labels: measured.map(e=>e.name),
        datasets:[{label:'Uplift %',data:measured.map(e=>+e.uplift),
          backgroundColor:measured.map(e=>(e.uplift>=0?cc.lime:cc.coral)+'cc'),
          borderColor:measured.map(e=>e.uplift>=0?cc.lime:cc.coral),
          borderWidth:1,borderRadius:3}]
      }, {
        indexAxis:'y',
        plugins:{tooltip:{callbacks:{label:c=>'  '+(+c.parsed.x).toFixed(1)+'% vs '+(measured[c.dataIndex].upliftMetric||'control')}}},
        scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>v+'%'}},
          y:{grid:{display:false},ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}}}
      });
    } else {
      g('liveopsUpliftWrap').innerHTML = noData('No measured uplift on these events yet');
    }
  }

  if(g('liveopsGrid')){
    g('liveopsGrid').innerHTML = evts.map(liveopCard).join('');
    markTable('liveopsGrid', evts.length, 'events');
  }
}

/**
 * Overview tiles stay a preview — the full set is on Progress Events. They read
 * the same window as that tab so the two never disagree.
 */
function renderProgressionMinis(){
  if(!g('cvOvShopLevel') && !g('cvOvDayCount')) return;
  const cc   = chartColors();
  const p    = currentProgression();
  const shop = (p.shopLevels || []).slice(0,15);
  const days = (p.dayCounts  || []).slice(0,15);
  if(shop.length) makeChart('cvOvShopLevel','bar',{
    labels: shop.map(x=>'L'+x.value),
    datasets:[{label:'Users',data:shop.map(x=>x.users),backgroundColor:cc.cyan+'cc',borderColor:cc.cyan,borderWidth:1,borderRadius:3}]
  }, {scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:8}}},y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtKn(v)}}}});
  if(days.length) makeChart('cvOvDayCount','bar',{
    labels: days.map(x=>'D'+x.value),
    datasets:[{label:'Users',data:days.map(x=>x.users),backgroundColor:cc.violet+'cc',borderColor:cc.violet,borderWidth:1,borderRadius:3}]
  }, {scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:8}}},y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtKn(v)}}}});
}

// ── Progression window ──────────────────────────────────────────
// The dashboard range answers "what happened between these dates". Progression
// answers "how far do players get", which needs a wide enough window to contain
// whole player journeys — so it gets its own selector, anchored to the end of
// the dashboard range and always a whole number of weeks.

function isoShift(dateStr, days){
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

/** N whole weeks ending on the last day of the dashboard range. */
function progWindow(){
  const to = dateTo || dataThrough();
  return { from: isoShift(to, -(progRangeDays - 1)), to: to };
}

function progKey(gameId, w){ return gameId + '_' + w.from + '_' + w.to; }

/**
 * Rows for the window currently selected in the Progress Events bar. Falls back
 * to whatever the main payload carried until ensureProgression() lands, so the
 * first paint is never blank.
 */
function currentProgression(){
  const hit = PROG[progKey(currentGame, progWindow())];
  if(hit) return hit;
  const d = curData();
  return {
    shopLevels: d.shopLevels || [],
    dayCounts:  d.dayCounts  || [],
    window:     d.progWindow || null,
    pending:    true
  };
}

function setProgStatus(msg){
  const el = g('progStatus');
  if(el) el.textContent = msg || '';
}

/** Repaints only what the progression window feeds — never the whole dashboard. */
function paintProgression(){
  /* The overview carries a preview of these charts and the Events section owns
     the full set, so a window landing makes both stale - but only the one on
     screen is worth drawing now. */
  try { renderProgressionMinis(); } catch(e){ console.warn('prog minis', e); }
  staleSections.add('events');
  renderSection('events');
}

/**
 * Loads progression for the selected window, caching per (game, window).
 * fetchRange() is used rather than the main loader because it ignores
 * dateFrom/dateTo — a progression window must never be mistaken for the range
 * the rest of the dashboard is showing.
 */
async function ensureProgression(opts){
  opts = opts || {};
  const w      = progWindow();
  const gameId = currentGame;
  const key    = progKey(gameId, w);

  if(g('progRange')) g('progRange').value = String(progRangeDays);

  if(PROG[key]){
    setProgStatus('');
    if(opts.repaint) paintProgression();
    return;
  }

  const myReq = ++_progSeq;
  setProgStatus('loading ' + w.from + ' → ' + w.to + ' …');

  try {
    const local = readCache(gameId, w.from, w.to);
    const raw   = local ? local.payload : await fetchRange(gameId, w.from, w.to);

    if(myReq !== _progSeq || gameId !== currentGame) return;   // a newer pick won

    // Persist it the same way a prefetch would, so reopening this window later
    // is instant. The payload now carries its own version stamp, so this no
    // longer costs a second request just to label the stored copy.
    if(!local){
      const mm = raw && raw.meta;
      if(mm && mm.from === w.from && mm.to === w.to) writeCache(gameId, raw, w.from, w.to);
    }

    // Same hard stop as the main loader: never chart a window nobody asked for.
    const m = raw && raw.meta;
    if(!m || m.from !== w.from || m.to !== w.to){
      setProgStatus('server answered ' + (m ? m.from + ' → ' + m.to : 'no range') + ' — not charted');
      return;
    }

    // Progression rows travel packed like every other row-heavy section.
    const p = expandPayload(raw).progression || {};
    PROG[key] = {
      shopLevels: p.shopLevels || [],
      dayCounts:  p.dayCounts  || [],
      window:     p.window     || { start: w.from, end: w.to }
    };

    // The source is pre-aggregated into weekly windows, so the span the server
    // returns snaps to those boundaries and will rarely equal the requested
    // dates exactly. What matters is how many weeks it actually found.
    const pw   = p.window;
    const want = Math.max(1, Math.round(progRangeDays / 7));
    const got  = (pw && pw.windows) || 0;
    if(!got)          setProgStatus('no progression windows in that range');
    else if(got < want) setProgStatus(got + ' of ' + want + ' weeks have data');
    else              setProgStatus('');
    paintProgression();
  } catch(e){
    if(myReq !== _progSeq) return;
    console.warn('[dash] progression load failed', e);
    setProgStatus('could not load that window — showing the last one');
  }
}

function onProgRangeChange(){
  progRangeDays = +g('progRange').value || 14;
  ensureProgression({ repaint:true });
}

function renderEvents(){
  const cc = chartColors();
  const p    = currentProgression();
  const shop = p.shopLevels || [];
  const days = p.dayCounts  || [];
  const win  = p.window;

  if(g('progRange')) g('progRange').value = String(progRangeDays);
  if(g('eventsWindow')){
    // Counts are a per-week average across the combined windows, so say how
    // many weeks are in the mix rather than implying one continuous total.
    g('eventsWindow').textContent = win
      ? ('window ' + win.start + ' → ' + win.end + (win.windows > 1 ? ' · ' + win.windows + ' weeks averaged' : ''))
      : '';
  }

  const totalActive = shop.length ? shop[0].totalActive : (days.length ? days[0].totalActive : 0);
  const medLevel = weightedMid(shop);
  const medDay   = weightedMid(days);
  const lvlReach = shop.length ? shop[shop.length-1].value : null;

  /* Same card as the Overview: label, value and a small graph across the
     levels / days (there is no per-date series for progression). */
  const nn  = v => (v == null || v === '' || isNaN(v)) ? null : +v;
  const shopT = shop.length ? trimProgressionTail(shop).rows : [];
  const dayT  = days.length ? trimProgressionTail(days).rows : [];
  const ek = [
    { cls:'cy', col:'--cyan',    noTrend:true, lbl:'Active Players', val:fmtKn(totalActive),        sub:'in progression window',
      data:shopT.map(x=>nn(x.users)), dates:shopT.map(x=>'Level '+x.value), fmt:fmtKn },
    { cls:'mg', col:'--magenta', noTrend:true, lbl:'Median Shop Lvl',val:medLevel!=null?medLevel:'—',sub:'50% of players reach',
      data:shopT.map(x=>nn(x.countPct)), dates:shopT.map(x=>'Level '+x.value), fmt:fmtPct },
    { cls:'lm', col:'--lime',    noTrend:true, lbl:'Median Day',     val:medDay!=null?medDay:'—',    sub:'50% of players reach',
      data:dayT.map(x=>nn(x.users)), dates:dayT.map(x=>'Day '+x.value), fmt:fmtKn },
    { cls:'am', col:'--amber',   noTrend:true, lbl:'Deepest Level',  val:lvlReach!=null?lvlReach:'—',sub:'highest shop level',
      data:shopT.map(x=>nn(x.playtimeSec)), dates:shopT.map(x=>'Level '+x.value), fmt:fmtSec },
  ];
  g('eventsKpis').innerHTML = ek.map((k,i)=>
    '<div class="kpi has-spark '+k.cls+'"><div class="kpi-text">'
    + '<div class="kpi-label">'+k.lbl+'</div><div class="kpi-val">'+k.val+'</div>'
    + kpiTrendHtml(k) + '<div class="kpi-bottom"><span class="kpi-sub">'+k.sub+'</span></div>'
    + '</div><div class="kpi-spark-box"><canvas id="ek'+i+'"></canvas></div></div>').join('');
  ek.forEach((k,i)=>{
    if(!k.data.length) return;
    drawSpark('ek'+i, k.data, getComputedStyle(document.documentElement).getPropertyValue(k.col).trim(), k.fmt, k.dates);
  });

  buildProgressionChart('cvShopLevel', shop, 'L', cc.cyan, 'Shop level');
  buildProgressionChart('cvDayCount',  days, 'D', cc.violet, 'Day completed');

  // Playtime to reach each level
  if(g('cvProgPlaytime')){
    if(shop.length){
      const ps = trimProgressionTail(shop).rows;
      makeChart('cvProgPlaytime','line',{
        labels: ps.map(x=>'L'+x.value),
        datasets:[
          {label:'Median playtime to reach',data:ps.map(x=>x.playtimeSec),borderColor:cc.amber,backgroundColor:cc.amber+'22',fill:true,tension:.35,borderWidth:2,pointRadius:2},
          {label:'Engagement %',data:ps.map(x=>x.engagement),borderColor:cc.lime,backgroundColor:'transparent',tension:.35,borderWidth:2,pointRadius:0,yAxisID:'y2'},
        ]
      }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}},
           scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
             y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtSec(v)}},
             y2:{position:'right',grid:{display:false},ticks:{color:cc.lime,font:{family:CHART_FONT,size:9},callback:v=>v+'%'}}} });
    } else { wrapEmpty('cvProgPlaytime','No progression rows in window'); }
  }

}

function weightedMid(rows){
  if(!rows || !rows.length) return null;
  const total = rows.reduce((a,r)=>a+(+r.users||0),0);
  if(!total) return null;
  let acc = 0;
  for(let i=0;i<rows.length;i++){
    acc += (+rows[i].users||0);
    if(acc >= total*0.5) return rows[i].value;
  }
  return rows[rows.length-1].value;
}

/**
 * Trims the long tail off a progression series. A handful of players reach
 * in-game day 18,009 and shop level 652, which stretches the axis until the
 * real distribution is a single spike against the left edge. Keeps whatever
 * covers `coverage` of players, with a floor so a short series is never cut
 * and a ceiling so the labels stay readable.
 */
function trimProgressionTail(items, coverage, minBars, maxBars){
  coverage = coverage || 0.995; minBars = minBars || 15; maxBars = maxBars || 60;
  const total = items.reduce((a,r)=>a+(+r.users||0),0);
  if(!total) return { rows: items.slice(0, maxBars), hidden: Math.max(0, items.length-maxBars), deepest: items.length?items[items.length-1].value:null };
  let acc = 0, cut = items.length;
  for(let i=0;i<items.length;i++){
    acc += (+items[i].users||0);
    if(acc >= total*coverage){ cut = i+1; break; }
  }
  cut = Math.min(Math.max(cut, minBars), maxBars, items.length);
  return { rows: items.slice(0, cut), hidden: items.length-cut, deepest: items[items.length-1].value };
}

/** Adds a small note to a chart card's header. */
function tagChart(canvasId, text){
  const el = g(canvasId); if(!el || !el.closest) return;
  const card = el.closest('.card'); if(!card) return;
  const hd = card.querySelector('.card-hd'); if(!hd) return;
  let tag = hd.querySelector('.row-count');
  if(!tag){ tag = document.createElement('span'); tag.className='row-count'; hd.appendChild(tag); }
  tag.textContent = text;
}

function buildProgressionChart(canvasId, items, prefix, color, label){
  if(!g(canvasId)) return;
  if(!items || !items.length){ wrapEmpty(canvasId,'No progression rows in window'); return; }
  const cc = chartColors();
  const trim = trimProgressionTail(items);
  items = trim.rows;
  tagChart(canvasId, trim.hidden
    ? trim.hidden + ' beyond ' + prefix + items[items.length-1].value + ' hidden · deepest ' + prefix + trim.deepest
    : items.length + ' tracked');
  makeChart(canvasId,'bar',{
    labels: items.map(x=>prefix+x.value),
    datasets:[{label:'Users',data:items.map(x=>x.users),backgroundColor:color+'cc',borderColor:color,borderWidth:1,borderRadius:3}]
  }, {
    plugins:{tooltip:{callbacks:{
      title:c=>label+' '+items[c[0].dataIndex].value,
      afterBody:c=>{ const r=items[c[0].dataIndex];
        return '  share: '+(+r.countPct||0).toFixed(2)+'%\n  playtime: '+fmtSec(r.playtimeSec)+'\n  events/user: '+(+r.eventsPerUser||0).toFixed(2); }
    }}},
    scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
      y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>fmtKn(v)}}}
  });
}

function renderFeedback(){
  g('fbCount').textContent = feedback.length;
  g('fbList').innerHTML = feedback.map(fbHtml).join('') || '<div class="notice">No entries yet</div>';
}
function addFeedback(){
  const name = g('fbName').value.trim();
  const cat = g('fbCat').value;
  const text = g('fbText').value.trim();
  if(!name || !text){ umAlert('Missing details', 'Please fill in your name and a description.'); return; }
  const today = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  feedback.unshift({ author:name, date:today, category:cat, text });
  g('fbName').value = '';
  g('fbText').value = '';
  renderFeedback();
}

// ═════════════════════════════════════════
// THRESHOLDS
// ═════════════════════════════════════════
function renderThresholds(){
  g('threshGrid').innerHTML = Object.entries(thresholds).map(([k,t])=>`
    <div class="thresh-row">
      <span class="thresh-lbl">${t.label}</span>
      <input class="thresh-input" type="number" id="th-${k}" value="${t.val}" step="0.1"/>
      <span class="thresh-unit">${t.unit}</span>
    </div>
  `).join('');
}
function saveThresh(){
  Object.keys(thresholds).forEach(k=>{
    const el = g('th-'+k);
    if(el) thresholds[k].val = parseFloat(el.value);
  });
  renderAll();
  umAlert('Thresholds saved', 'The new thresholds are applied to every card.');
}

// ═════════════════════════════════════════
// USER MANAGEMENT (admin only)
// ═════════════════════════════════════════

/* Users | Teams admin page (see user_access.md). Every call is a POST to
   this project's backend: a password never rides in a URL. */
const UM = { users:[], teams:{}, team:'', draft:{}, page:'', busy:{} };

/**
 * The dashboard's own confirm / alert, in place of the browser's grey box.
 * Resolves true for the main button, false for Cancel, Escape or a click
 * outside. With no `cancel` it is an alert and only has the one button.
 *
 *   if(!await umDialog({ title:'Delete team?', message:'...', ok:'Delete', danger:true })) return;
 */
function umDialog(o){
  o = o || {};
  return new Promise(function(resolve){
    const prev = document.getElementById('umDialog'); if(prev) prev.remove();
    const wrap = document.createElement('div');
    wrap.id = 'umDialog';
    wrap.className = 'um-dlg-wrap';
    wrap.innerHTML = '<div class="um-dlg" role="dialog" aria-modal="true" aria-labelledby="umDlgTitle">'
      + '<div class="um-dlg-title" id="umDlgTitle">' + umEsc(o.title || 'Are you sure?') + '</div>'
      + (o.message ? '<div class="um-dlg-msg">' + umEsc(o.message) + '</div>' : '')
      + '<div class="um-dlg-actions">'
      +   (o.cancel === false ? '' : '<button type="button" class="um-dlg-btn" data-r="0">' + umEsc(o.cancel || 'Cancel') + '</button>')
      +   '<button type="button" class="um-dlg-btn ' + (o.danger ? 'danger' : 'primary') + '" data-r="1">' + umEsc(o.ok || 'OK') + '</button>'
      + '</div></div>';
    const finish = function(v){ document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(v); };
    const onKey = function(e){
      if(e.key === 'Escape'){ e.preventDefault(); finish(o.cancel === false); }
      if(e.key === 'Enter'){ e.preventDefault(); finish(true); }
    };
    wrap.addEventListener('click', function(e){
      const b = e.target.closest('[data-r]');
      if(b) return finish(b.dataset.r === '1');
      if(e.target === wrap) finish(o.cancel === false);     // click outside
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    const focus = wrap.querySelector(o.cancel === false ? '[data-r="1"]' : '[data-r="0"]');
    if(focus) focus.focus();
  });
}
/** Alert with one button. */
function umAlert(title, message){ return umDialog({ title:title, message:message, ok:'OK', cancel:false }); }

/* Status shown on a row while its change is being written to the sheet. */
function umStatus(text){
  const done = text.charAt(0) === '✓';
  return '<span class="um-status' + (done ? ' done' : '') + '">' + (done ? '' : '<span class="um-spin"></span>') + umEsc(text) + '</span>';
}
/* Busy state for a button while a save runs; returns a function that restores it. */
function umBtnBusy(btn, text){
  if(!btn) return function(){};
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = umEsc(text);
  return function(){ btn.disabled = false; btn.innerHTML = old; };
}

function umEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

/* Current team, role and access for the signed-in user, straight from
   DashUsers. Quiet on failure: the copy already on screen stays. */
async function refreshMyAccess(){
  try {
    const r = await adminApi('myAccess');
    if(!r || !r.access){ console.warn('[dash] myAccess returned no access record', r); return false; }
    /* The username comes from the server when it sends one. After a page
       reload CU starts with an empty username, and requiring it here meant
       the refresh silently did nothing. */
    applyUserRecord({ username: r.username || (CU && CU.username) || 'me',
      name: r.name || (CU && CU.name) || '', role: r.role, team: r.team, access: r.access });
    return true;
  } catch(e){ console.warn('[dash] myAccess failed:', e.message); return false; }
}

async function adminApi(action, body){
  const res = await fetch(SHEET_API_URL, {
    method:'POST', redirect:'follow',
    headers:{ 'Content-Type':'text/plain;charset=utf-8' },   // no CORS preflight
    body: JSON.stringify(Object.assign({ action:action, key:SHEET_API_KEY, token:getToken() }, body || {}))
  });
  const data = await res.json();
  if(data && data.error) throw new Error(data.error);
  return data;
}

function umFlash(id, text, bad){
  const el = g(id); if(!el) return;
  el.textContent = text; el.classList.toggle('bad', !!bad); el.style.display = 'inline';
  clearTimeout(el._t); el._t = setTimeout(function(){ el.style.display = 'none'; }, 3500);
}

function umShow(which){
  document.querySelectorAll('#tab-users .um-tab').forEach(function(b){ b.classList.toggle('on', b.dataset.um === which); });
  g('umUsers').style.display = which === 'users' ? '' : 'none';
  g('umTeams').style.display = which === 'teams' ? '' : 'none';
  if(which === 'teams') renderTeams();
}

function renderUsers(){
  if(!isAdminUser()){
    g('usersList').innerHTML = '<div class="notice">Admin access required.</div>';
    g('addUserCard').style.display = 'none';
    return;
  }
  g('addUserCard').style.display = '';
  loadUsers();
}

async function loadUsers(){
  /* "Loading…" only on the first load. A refresh after an edit keeps the
     current table on screen and swaps in the new one when it arrives, so the
     list never blanks out. */
  if(!UM.users || !UM.users.length) g('usersList').innerHTML = '<div class="notice">Loading…</div>';
  try {
    const both = await Promise.all([ adminApi('listUsers'), adminApi('listTeams') ]);
    UM.users = both[0].users || [];
    UM.teams = both[1].teams || {};
    fillTeamSelects();
    renderUsersList(UM.users);
    if(g('umTeams').style.display !== 'none') renderTeams();
  } catch(e){
    g('usersList').innerHTML = '<div class="notice">Could not load users: ' + umEsc(e.message) + '</div>';
  }
}

function teamNames(){ return Object.keys(UM.teams).sort(); }

function fillTeamSelects(){
  const sel = g('nuTeam'); if(!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="">No team</option>' + teamNames().map(function(t){
    return '<option value="' + umEsc(t) + '">' + umEsc(t) + '</option>';
  }).join('');
  sel.value = keep;
  /* The Team dropdown on every row of All users is built from the same list.
     Redraw it too, or a team created on the Teams tab is missing there until
     the whole list is reloaded. */
  if(UM.users && UM.users.length) renderUsersList(UM.users);
}

function renderUsersList(users){
  if(!users.length){ g('usersList').innerHTML = '<div class="notice">No users found.</div>'; return; }
  const teamOpts = function(cur){
    return '<option value="">No team</option>' + teamNames().map(function(t){
      return '<option value="' + umEsc(t) + '"' + (t === cur ? ' selected' : '') + '>' + umEsc(t) + '</option>';
    }).join('');
  };
  /* No Access column: what a member sees is set by their team. The role
     (column D in DashUsers) is still read by the backend. */
  g('usersList').innerHTML =
    '<div class="tbl-head users-head um-grid"><span>Name / Email</span><span>Team</span><span>Games</span><span>Status</span><span></span></div>'
    + users.map(function(u){
      const me = CU && u.email.toLowerCase() === String(CU.username || '').toLowerCase();
      const e = umEsc(u.email);
      const busy = UM.busy[u.email];
      const lock = busy ? ' disabled' : '';
      return '<div class="users-row um-grid' + (busy ? ' um-busy' : '') + '">'
        + '<div><div class="um-name">' + umEsc(u.name || '—') + '</div><div class="um-email">' + e + '</div></div>'
        + '<div><select class="um-sel" data-popup' + lock + ' onchange="umUpdate(\'' + e + '\',{team:this.value})"' + (u.role !== 'member' ? ' title="Ignored for Full access and Admin"' : '') + '>' + teamOpts(u.team) + '</select></div>'
        + '<div class="um-games">' + umEsc(u.games || '*') + '</div>'
        + '<div><button type="button" class="um-pill ' + (u.active ? 'on' : 'off') + '"' + (me ? ' disabled' : lock)
        +   ' onclick="umUpdate(\'' + e + '\',{active:' + (!u.active) + '})">' + (u.active ? 'Active' : 'Disabled') + '</button></div>'
        + '<div class="um-right">' + (busy ? umStatus(busy) : me ? '<span class="um-you">You</span>'
            : '<button type="button" class="um-link danger" onclick="removeUser(\'' + e + '\')">Remove</button>') + '</div>'
        + '</div>';
    }).join('');
}

async function addUser(){
  const email = g('nuEmail').value.trim().toLowerCase();
  const name  = g('nuName').value.trim();
  const pwd   = g('nuPwd').value;
  if(!email || !pwd){ umFlash('addUserMsg', 'Email and password required.', true); return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ umFlash('addUserMsg', 'That is not a valid email address.', true); return; }
  const done = umBtnBusy(g('nuAddBtn'), 'Adding…');
  umWorking('addUserMsg', 'Adding user…');
  try {
    await adminApi('addUser', {
      email:email, name:name, pwd: await hashPwd(pwd),
      team: g('nuTeam').value, games: g('nuGames').value.trim() || '*'
    });
    umFlash('addUserMsg', '✓ User added. They can sign in after the auth list refreshes (run refreshAuthUsers).');
    g('nuEmail').value = ''; g('nuName').value = ''; g('nuPwd').value = '';
    loadUsers();
  } catch(e){ umFlash('addUserMsg', e.message, true); }
  done();
}

async function umUpdate(email, fields){
  /* Shown at once, saved in the background. Only a failed save re-reads the
     sheet, which puts the row back to what is actually stored. */
  const u = (UM.users || []).find(function(x){ return x.email === email; });
  if(u) Object.assign(u, fields);
  UM.busy[email] = 'Saving…'; renderUsersList(UM.users);
  try {
    await adminApi('updateUser', Object.assign({ email:email }, fields));
    UM.busy[email] = '✓ Saved'; renderUsersList(UM.users);
    // your own team changed: pick it up now, not on the next data download
    if(CU && email.toLowerCase() === String(CU.username || '').toLowerCase()) refreshMyAccess();
    setTimeout(function(){
      if(UM.busy[email] === '✓ Saved'){ delete UM.busy[email]; renderUsersList(UM.users); }
    }, 1800);
  } catch(e){
    delete UM.busy[email];
    loadUsers();
    umAlert('Could not save the change', e.message);
  }
}
/* kept for any old caller */
function changeRole(email, role){ return umUpdate(email, { role:role }); }

async function removeUser(email){
  if(!await umDialog({ title:'Remove user?', ok:'Remove', danger:true,
    message: email + ' will no longer be able to open the dashboard.' })) return;
  UM.busy[email] = 'Removing…'; renderUsersList(UM.users);
  try {
    await adminApi('removeUser', { email:email });
    delete UM.busy[email];
    UM.users = UM.users.filter(function(x){ return x.email !== email; });
    renderUsersList(UM.users);
  } catch(e){
    delete UM.busy[email]; renderUsersList(UM.users);
    umAlert('Could not remove the user', e.message);
  }
}

/* ── Teams tab ── */
function renderTeams(){
  const sel = g('tmSelect'); if(!sel) return;
  const names = teamNames();
  if(!UM.team || names.indexOf(UM.team) === -1) UM.team = names[0] || '';
  sel.innerHTML = names.length
    ? names.map(function(t){ return '<option value="' + umEsc(t) + '">' + umEsc(t) + '</option>'; }).join('')
    : '<option value="">No teams yet: create one</option>';
  sel.value = UM.team;
  tmRenderList();
  tmPick(UM.team, true);
}

/* Right-hand column: every team, how many users are in it, and a Delete for
   each. Clicking a name opens that team on the left. */
function tmRenderList(){
  const box = g('tmList'); if(!box) return;
  const names = teamNames();
  if(!names.length){ box.innerHTML = '<div class="um-hint">No teams yet.</div>'; return; }
  box.innerHTML = names.map(function(t){
    const n = (UM.users || []).filter(function(u){ return u.team === t; }).length;
    const busy = UM.busy['team:' + t];
    return '<div class="um-team-row' + (t === UM.team ? ' sel' : '') + '">'
      + '<button type="button" class="um-team-name" data-team="' + umEsc(t) + '" onclick="tmPick(this.dataset.team)">'
      +   umEsc(t) + '<small>' + n + (n === 1 ? ' user' : ' users') + '</small></button>'
      + (busy ? umStatus(busy)
              : '<button type="button" class="um-team-del" data-team="' + umEsc(t) + '" onclick="tmDelete(this.dataset.team)">Delete</button>')
      + '</div>';
  }).join('');
}

function tmPick(team, keepPage){
  UM.team = team;
  // keep the Team dropdown and the All teams highlight on the same team
  const sel = g('tmSelect'); if(sel && sel.value !== team) sel.value = team;
  tmRenderList();
  UM.draft = JSON.parse(JSON.stringify(UM.teams[team] || {}));
  if(!keepPage || !UM.draft[UM.page]) UM.page = Object.keys(UM.draft)[0] || '';
  tmRenderPages(); tmRenderKpis();
}

function tmRenderPages(){
  const box = g('tmPages');
  if(!UM.team){ box.innerHTML = '<div class="um-hint">Create a team to start.</div>'; return; }
  let group = '';
  box.innerHTML = accessPages().map(function(p){
    const on = Object.prototype.hasOwnProperty.call(UM.draft, p.id);
    const head = p.group !== group ? '<div class="um-group">' + umEsc(group = p.group) + '</div>' : '';
    const k = UM.draft[p.id];
    const note = !on ? '' : (k === '*' ? 'all KPIs' : (Array.isArray(k) ? k.length + ' KPIs' : ''));
    const hasKpis = accessKpis(p.id).length > 0;
    return head + '<div class="um-page' + (UM.page === p.id ? ' sel' : '') + (on ? ' on' : '') + '">'
      + '<label><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="tmTogglePage(\'' + p.id + '\',this.checked)"/> '
      + '<span>' + umEsc(p.label) + '</span></label>'
      + (on && hasKpis ? '<button type="button" class="um-kpi-btn" onclick="tmOpenPage(\'' + p.id + '\')">' + note + ' ›</button>'
                       : (on ? '<span class="um-note">whole page</span>' : ''))
      + '</div>';
  }).join('');
}

function tmTogglePage(id, on){
  if(on){ UM.draft[id] = '*'; UM.page = id; }
  else { delete UM.draft[id]; if(UM.page === id) UM.page = Object.keys(UM.draft)[0] || ''; }
  tmRenderPages(); tmRenderKpis();
}
function tmOpenPage(id){ UM.page = id; tmRenderPages(); tmRenderKpis(); }

function tmRenderKpis(){
  const box = g('tmKpis'), hd = g('tmKpisHd');
  const id = UM.page;
  if(!UM.team || !id || !Object.prototype.hasOwnProperty.call(UM.draft, id)){
    hd.textContent = 'KPIs shown on that page';
    box.innerHTML = '<div class="um-hint">Tick a page, then click its KPI count to choose KPIs.</div>';
    return;
  }
  const meta = SECTION_META[id] || {};
  hd.textContent = 'KPIs on ' + (meta.label || id);
  const kpis = accessKpis(id);
  if(!kpis.length){
    box.innerHTML = '<div class="um-hint">This page has no KPI cards to pick from. The whole page is shown.</div>';
    return;
  }
  const k = UM.draft[id], all = k === '*';
  box.innerHTML = '<label class="um-all"><input type="checkbox"' + (all ? ' checked' : '') + ' onchange="tmAll(this.checked)"/> <b>All KPIs</b> <span class="um-note">(new KPIs added later show too)</span></label>'
    + '<div class="um-kpis' + (all ? ' dim' : '') + '">' + kpis.map(function(x){
      const on = all || (Array.isArray(k) && k.indexOf(x.id) !== -1);
      return '<label class="um-kpi"><input type="checkbox"' + (on ? ' checked' : '') + (all ? ' disabled' : '')
        + ' onchange="tmKpi(\'' + x.id + '\',this.checked)"/> ' + umEsc(x.label) + '</label>';
    }).join('') + '</div>';
}

function tmAll(on){
  UM.draft[UM.page] = on ? '*' : accessKpis(UM.page).map(function(x){ return x.id; });
  tmRenderPages(); tmRenderKpis();
}
function tmKpi(id, on){
  let k = UM.draft[UM.page];
  if(!Array.isArray(k)) k = [];
  k = k.filter(function(x){ return x !== id; });
  if(on) k.push(id);
  UM.draft[UM.page] = k;
  tmRenderPages();
}

function tmCreate(){
  const name = g('tmNew').value.trim();
  if(!name) return;
  if(UM.teams[name]){ umFlash('tmMsg', 'That team already exists.', true); return; }
  UM.teams[name] = {};
  g('tmNew').value = '';
  UM.team = name;
  renderTeams(); fillTeamSelects();
  umFlash('tmMsg', 'Team created. Tick its pages, then Save team.');
}

/* A status that stays up until the save finishes (umFlash hides itself). */
function umWorking(id, text){
  const el = g(id); if(!el) return;
  clearTimeout(el._t); el.classList.remove('bad');
  el.innerHTML = umStatus(text); el.style.display = 'inline';
}

async function tmSave(){
  if(!UM.team) return;
  const done = umBtnBusy(g('tmSaveBtn'), 'Saving…');
  umWorking('tmMsg', 'Saving team…');
  try {
    await adminApi('saveTeam', { team:UM.team, pages: JSON.stringify(UM.draft) });
    UM.teams[UM.team] = JSON.parse(JSON.stringify(UM.draft));
    umFlash('tmMsg', '✓ Saved. Members see the change on their next load.');
    tmRenderPages();
  } catch(e){ umFlash('tmMsg', e.message, true); }
  done();
}

/** Deletes one team from the All teams list. `team` defaults to the one open. */
async function tmDelete(team){
  team = team || UM.team;
  if(!team) return;
  const inUse = UM.users.filter(function(u){ return u.team === team; }).length;
  if(!await umDialog({ title:'Delete team "' + team + '"?', ok:'Delete', danger:true,
    message: inUse
      ? inUse + (inUse === 1 ? ' user is' : ' users are') + ' in this team and will see no pages until you move them to another team.'
      : 'Nobody is in this team. Its page and KPI settings will be removed.' })) return;
  const key = 'team:' + team;
  UM.busy[key] = 'Deleting…'; tmRenderList();
  try {
    await adminApi('deleteTeam', { team:team });
    delete UM.busy[key];
    delete UM.teams[team];
    if(UM.team === team) UM.team = '';
    renderTeams(); fillTeamSelects();
    umFlash('tmMsg', '✓ Team "' + team + '" deleted.');
  } catch(e){
    delete UM.busy[key]; tmRenderList();
    umFlash('tmMsg', e.message, true);
  }
}


// ═════════════════════════════════════════
// CHART FACTORY
// ═════════════════════════════════════════
function makeChart(id, type, data, extra={}){
  const el = g(id); if(!el) return;
  clearEmpty(id);   // remove any empty-state left from a previous render
  if(charts[id]) { charts[id].destroy(); delete charts[id]; }
  const cc = chartColors();
  const base = {
    responsive:true, maintainAspectRatio:false,
    animation:{duration:300},
    interaction:{ mode:'index', intersect:false, axis:'x' },
    plugins:{
      legend:{display:false},
      tooltip:{
        enabled:true,
        animation:false,
        mode:'index',
        intersect:false,
        position:'nearest',
        backgroundColor:'rgba(7,11,20,0.95)',
        titleColor:'#E8ECFF',
        bodyColor:'#C8D0F0',
        borderColor:'rgba(100,130,230,0.28)',
        borderWidth:1,
        padding:10,
        cornerRadius:8,
        titleFont:{family:'Segoe UI',size:11,weight:'600'},
        bodyFont:{family:CHART_FONT,size:11},
        boxPadding:5,
      }
    },
    scales:{
      x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}},
      y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}}
    }
  };
  const opts = {...base, ...extra};
  if(extra.scales) opts.scales = {...base.scales, ...extra.scales};
  if(extra.plugins) {
    opts.plugins = {...base.plugins, ...extra.plugins};
    // Merge tooltip options so extras can add callbacks without clobbering mode/animation
    if(extra.plugins.tooltip) opts.plugins.tooltip = {...base.plugins.tooltip, ...extra.plugins.tooltip};
  }
  if(extra.interaction) opts.interaction = {...base.interaction, ...extra.interaction};

  // Every quantitative axis uses a true zero baseline. Chart.js otherwise
  // auto-crops line charts around their smallest value (for example, the
  // Engagement chart started near 1,000), which visually exaggerates changes.
  // Date/category axes are not numeric, so their first label remains the start.
  //
  // TWO EXCEPTIONS, both of which previously rendered as a blank chart:
  //  1. A series that is entirely negative (churn is -86%, -95%, -99%). Pinning
  //     min to 0 pushed every bar below the visible area and left an empty
  //     0-to-1 axis with no bars — which is exactly what "Churn by day" showed.
  //  2. A caller that deliberately set its own min (the NPS axis runs -100..100).
  //     Overwriting it clipped the whole series.
  const horizontal = extra.indexAxis === 'y';
  const valueAxisPrefix = horizontal ? 'x' : 'y';
  const flat = [];
  (data.datasets || []).forEach(function(ds){
    (ds.data || []).forEach(function(v){
      const n = (v && typeof v === 'object') ? v.y : v;
      if(n != null && !isNaN(n)) flat.push(+n);
    });
  });
  const hasNegative = flat.some(n => n < 0);

  // A line needs two points to draw a segment. With pointRadius:0 and a single
  // day of data the chart renders an axis and nothing else — which is exactly
  // what "Crash & ANR trend" and "First-time payer conversion" showed once
  // their tabs held one row. Sparse series get visible markers instead.
  if(type === 'line'){
    (data.datasets || []).forEach(function(ds){
      const pts = (ds.data || []).filter(v => v != null && !isNaN(v)).length;
      if(pts <= 2 && !ds.pointRadius) ds.pointRadius = 4;
    });
  }
  Object.keys(opts.scales || {}).forEach(function(axisId){
    if(axisId.indexOf(valueAxisPrefix) !== 0) return;
    const explicitMin = extra.scales && extra.scales[axisId] && extra.scales[axisId].min !== undefined;
    opts.scales[axisId] = {
      ...opts.scales[axisId],
      beginAtZero:true
    };
    if(!explicitMin && !hasNegative) opts.scales[axisId].min = 0;
    else if(!explicitMin) delete opts.scales[axisId].min;
  });

  // Horizontal charts must resolve hover/index hits by row (Y), not by the
  // numeric X position. Otherwise moving across one bar can show another row.
  if(extra.indexAxis === 'y'){
    if(!extra.interaction) opts.interaction = {...base.interaction, axis:'y'};
    if(!(extra.plugins && extra.plugins.tooltip && extra.plugins.tooltip.axis)){
      opts.plugins.tooltip = {...opts.plugins.tooltip, axis:'y'};
    }
  }
  charts[id] = new Chart(el, { type, data, options: opts });
}

// ═════════════════════════════════════════
// TAB SWITCH
// ═════════════════════════════════════════
/**
 * Points the topbar at what the current section is actually cut by.
 *
 * Each control has a chip beside it carrying the same information in words.
 * One of the pair is shown at a time; both keep their place in the flex row,
 * so moving between a game section and a report does not shuffle the bar.
 */
function applyScope(scope){
  const rules = SCOPES[scope] || SCOPES.game;
  [['gameSelect', 'gameChip', rules.game],
   ['rangePreset', 'rangeChip', rules.range]].forEach(function(pair){
    const control = g(pair[0]);
    const chip    = g(pair[1]);
    if(!control || !chip) return;
    const asChip = !!pair[2];
    control.style.display = asChip ? 'none' : '';
    chip.style.display    = asChip ? '' : 'none';
    chip.textContent      = pair[2] || '';
  });

  // The typed date range belongs to the game scope alone.
  const inline = g('dateInline');
  if(inline && rules.range) inline.style.display = 'none';
  else if(inline) showDateInputs(rangeMode());

  document.body.setAttribute('data-scope', scope);
}

/**
 * Builds a report section's pane the first time it is opened.
 *
 * The iframe src is set here rather than in markup, so a report is downloaded
 * when somebody asks for it and not before - five reports eagerly loaded would
 * cost more than the whole dashboard. The token is already in sessionStorage
 * by the time this runs, and the report reads it there, which is the entire
 * reason the sign-in work came first.
 */
function ensureReportPane(section){
  let pane = g('tab-' + section.id);
  if(pane) return pane;

  /* No token, no frame. A report started without one spends a document
     download and an Apps Script execution to arrive at "Unauthorized", which
     reads to the person as a broken report rather than an expired session.
     The hub refused for the same reason. */
  if (!getToken()) return null;

  pane = document.createElement('div');
  pane.className = 'tab-pane report-pane';
  pane.id = 'tab-' + section.id;
  pane.innerHTML =
    '<iframe class="report-frame" title="' + esc_(section.label) + '"' +
    ' src="' + reportUrl(section) + '" loading="lazy"></iframe>' +
    /* the shared loading screen covers the pane until the report's page has
       arrived; from there the report shows its own (same) loader */
    '<div class="frame-loader" role="status" aria-label="Loading"></div>';
  const frame = pane.querySelector('iframe');
  if (frame) frame.addEventListener('load', function(){
    const l = pane.querySelector('.frame-loader');
    if (l) l.remove();
  }, { once: true });
  const host = document.querySelector('.content');
  if(host) host.appendChild(pane);
  return pane;
}

/** Minimal escape for the one attribute built from a label. */
function esc_(s){
  return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
  });
}

function goTab(id, el){
  // If requested section isn't enabled (game config or team access), fall back
  // to overview, or to the first page this person may open.
  if(!isEnabled(id)){
    const first = getEnabledSections()[0];
    id = isEnabled('overview') ? 'overview' : (first ? first.id : 'overview');
  }
  currentTab = id;
  if(id === 'alerts') staleSections.add(id);
  if(id === 'overview') scheduleOverviewDataStatus();
  else updateOverviewDataStatus();

  const section = getEnabledSections().find(function(s){ return s.id === id; }) || {};
  if(section.report) ensureReportPane(section);
  applyScope(section.scope || 'game');

  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pane = g('tab-'+id);
  if(pane) pane.classList.add('on');
  if(el) el.classList.add('active');
  else {
    const navEl = document.querySelector('[data-tab="'+id+'"]');
    if(navEl) navEl.classList.add('active');
  }

  // Topbar title from section registry (respects custom labels from sheet Config tab)
  const matched = getEnabledSections().find(function(s){ return s.id === id; });
  const title = matched ? matched.label : (SECTION_META[id] && SECTION_META[id].label) || id;
  g('topTitle').textContent = section.report ? title+' · MSS3D' : title;

  // A report section draws itself, inside its own page. Nothing to render.
  if(section.report) return;

  /* Draw on arrival if the data has moved since this section was last drawn.
     A pane that is already current is left alone - redrawing it would destroy
     and rebuild its charts to produce the same picture, which is what made
     switching tabs feel heavy. resizeChartsIn still runs either way: a chart
     built while its pane was hidden has zero width and has to be told. */
  setTimeout(function(){
    aggregateFtue();
    renderSection(id);
    resizeChartsIn(pane);
  }, 30);
}
// Called from overview summary-card clicks
function goToTab(id){ goTab(id, null); }

// Drop trend visibility is controlled via the chart legend (click on "Churn %" in the chart legend).
// Chart.js built-in legend click handler toggles dataset visibility — no custom toggle needed.

// ═════════════════════════════════════════
// THEME
// ═════════════════════════════════════════
/**
 * Collapse the sidebar to an icon rail, or expand it back.
 *
 * The choice is remembered per browser. Charts read their size from the
 * container, so each one is told to re-measure after the width transition ends
 * — otherwise they keep the old width and sit misaligned until the next render.
 */
const SB_KEY = 'mssdash.sidebar';

function applySidebarState(collapsed){
  document.body.classList.toggle('sb-collapsed', !!collapsed);
  const btn = document.getElementById('sbToggle');
  if(btn) btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  // Give every nav item its label back as a tooltip while it is icon-only.
  document.querySelectorAll('#sbNav .nav-item').forEach(function(el){
    const lbl = el.querySelector('.nav-lbl');
    el.title = collapsed && lbl ? lbl.textContent : '';
  });
}

/* The sidebar footer's user block: initial in a circle, name, role. */
/* The chip under the sidebar shows the person's TEAM, since the team is what
   decides access now ("Data", "UA", ...). The old role column (viewer /
   admin) no longer means anything to the reader. Blank until the server has
   said who this is, rather than a placeholder that is wrong. */
function fillSidebarUser(){
  const name = (CU && (CU.name || CU.username)) || '';
  const known = !!(CU && CU.access);
  const team = known ? (String(CU.team || '').trim() || 'No team') : '';
  const av = g('sbAvatar'), nm = g('sbUserName'), rl = g('sbUserRole'), box = g('sbUser');
  if(av) av.textContent = name ? name.trim().charAt(0).toUpperCase() : '·';
  if(nm) nm.textContent = name;
  if(rl) rl.textContent = team;
  if(box) box.title = name + (team ? ' · ' + team : '');
}

function toggleSidebar(){
  const collapsed = !document.body.classList.contains('sb-collapsed');
  applySidebarState(collapsed);
  try { localStorage.setItem(SB_KEY, collapsed ? '1' : '0'); } catch(e){}

  // .18s is the width transition; resize once it has settled.
  setTimeout(function(){
    Object.keys(charts || {}).forEach(function(k){
      try { charts[k] && charts[k].resize(); } catch(e){}
    });
  }, 220);
}

function restoreSidebarState(){
  let collapsed = false;
  try { collapsed = localStorage.getItem(SB_KEY) === '1'; } catch(e){}
  applySidebarState(collapsed);
}

/* toggleTheme() was here: the light theme was removed, the dashboard is dark only. */

// ═════════════════════════════════════════
// GAME SWITCH
// ═════════════════════════════════════════
async function onGameChange(val){
  currentGame = val;
  updateGameBranding();

  // Hide the platform badge while switching — a stale "COMBINED" label sitting
  // over Android data is worse than no label at all. updateRangeLabel() below
  // repaints it from the payload that actually arrives.
  const pb = g('platBadge'); if(pb) pb.style.display = 'none';

  if(!DATA[currentGame]){
    setSyncState('loading', val);
    showLoadingOverlay(true);
    const result = await loadGameData(currentGame);
    if(result.ok) setSyncState('live');
    else          setSyncState('error', result.error);
    showLoadingOverlay(false);
  } else {
    setSyncState('live');
  }

  feedback = (DATA[currentGame].feedback || []).slice();
  buildNav();
  updateRangeLabel();          // repaints the platform badge
  if(!isEnabled(currentTab)){
    goTab('overview');
    return;
  }
  renderAll();
}

// ═════════════════════════════════════════
// REFRESH
// ═════════════════════════════════════════
/**
 * SYNC — the only path that rebuilds a payload from scratch.
 *
 * Everything else in the dashboard is served from the local store and refreshed
 * only when the server reports a new dataVersion, which happens once a week
 * when the Monday sync appends rows. This button exists for the case where you
 * have just run a sync by hand and do not want to wait for the version check,
 * or you suspect a payload is wrong.
 *
 * It is deliberately expensive: refresh=1 makes the server bypass its own cache
 * and re-read every tab, which takes 30-100 seconds on a cold range.
 */
async function syncNow(){
  const btn = document.getElementById('syncBtn');
  if(btn){ btn.disabled = true; btn.classList.add('spinning'); }
  setSyncState('loading');

  dropAllPayloads();
  PROG = {};                 // progression windows are cached separately
  _prefetchDone = false;     // the whole matrix must be rebuilt after this

  const result = await loadGameData(currentGame, { refresh:true });
  if(result.ok){
    setSyncState('live');
    rememberDataVersion(payloadVersion(result.raw));
  } else {
    setSyncState('error', result.error);
  }

  buildNav();
  renderAll();
  updateRangeLabel();
  updateGameBranding();
  if(!isEnabled(currentTab)) goTab('overview');
  if(btn){ btn.disabled = false; btn.classList.remove('spinning'); }

  // Refill the rest of the matrix so switching stays instant afterwards.
  schedulePrefetch(currentGame, { force:true });
}

/** Kept for the existing header control; same behaviour as Sync. */
async function refreshData(){ return syncNow(); }

// ═════════════════════════════════════════
// DATE RANGE
// ═════════════════════════════════════════
/** Which mode the picker is in: a whole-week preset, "custom", or "single". */
function rangeMode(){
  const sel = g('rangePreset');
  return sel ? sel.value : 'custom';
}

/** From/To only appear for the two modes that need typed dates. */
function showDateInputs(mode){
  const inline = g('dateInline');
  if(!inline) return;
  const single = (mode === 'single');
  inline.style.display = (single || mode === 'custom') ? '' : 'none';
  if(g('dateFromGroup')) g('dateFromGroup').style.display = single ? 'none' : '';
  if(g('rangeToLabel'))  g('rangeToLabel').textContent    = single ? 'Date' : 'To';
}

/** Points the dropdown at whatever range the state currently holds. */
function syncPresetSelect(){
  const sel = g('rangePreset');
  if(!sel) return;
  let mode;
  if(dateFrom && dateFrom === dateTo) mode = 'single';
  else {
    const known = Array.prototype.some.call(sel.options, function(o){ return o.value === String(activeRange); });
    mode = known ? String(activeRange) : 'custom';
  }
  sel.value = mode;
  showDateInputs(mode);
}

function onPresetChange(){
  const v = rangeMode();
  showDateInputs(v);

  // Both typed modes wait for Apply — reloading on every keystroke fired a
  // request per half-edited date.
  if(v === 'custom'){
    if(!g('rangeFrom').value) g('rangeFrom').value = dateFrom;
    if(!g('rangeTo').value)   g('rangeTo').value   = dateTo;
    return;
  }
  if(v === 'single'){
    if(!g('rangeTo').value) g('rangeTo').value = dateTo || dataThrough();
    return;
  }

  applyPresetToInputs(+v);   // sets dateFrom/dateTo, activeRange and the dropdown
  reloadForRange();
}

function onDateInput(){
  const from = g('rangeFrom').value;
  const to   = g('rangeTo').value;
  if(from && to && from <= to) g('rangeFrom').setCustomValidity('');
}

async function applyDateFilter(){
  const single = (rangeMode() === 'single');
  const fromEl = g('rangeFrom');
  const toEl = g('rangeTo');
  const to = toEl.value;
  // A single date is just a range whose ends meet.
  const from = single ? to : fromEl.value;
  if(single && to) fromEl.value = to;
  if(!from || !to){ (single || from) ? toEl.reportValidity() : fromEl.reportValidity(); return; }
  if(from > to){
    fromEl.setCustomValidity('From date must be on or before To date.');
    fromEl.reportValidity();
    return;
  }
  fromEl.setCustomValidity('');
  const btn = g('applyDateBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Loading…'; }
  dateFrom = from;
  dateTo = to;
  activeRange = Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1;
  updateRangeLabel();
  try { await reloadForRange(); }
  finally { if(btn){ btn.textContent = 'Apply'; btn.disabled = false; } }
}

let _busySeq = 0;

async function reloadForRange(){
  // Changing the range twice quickly leaves two of these in flight. Only the
  // most recent may take the veil down — otherwise the first to finish clears
  // it while the range the user actually wants is still loading.
  const mine = ++_busySeq;

  setSyncState('loading');
  showBusy(true, 'Loading ' + dateFrom + ' → ' + dateTo,
           'a range opened for the first time is built on the server');

  try {
    const result = await loadGameData(currentGame);
    // A newer pick already superseded this one; that request owns the veil now.
    if(result.superseded) return;

    setSyncState(result.ok ? 'live' : 'error', result.error);
    markSource(result.source);
    buildNav();
    renderAll();
    if(!isEnabled(currentTab)) goTab('overview');
    updateRangeLabel();
    // The progression window is anchored to the end of the range, so it moves too.
    ensureProgression({ repaint:true });
  } finally {
    // finally, not after the awaits: a thrown fetch must not strand the veil.
    if(mine === _busySeq) showBusy(false);
  }
}

function formatRangeDate(iso){
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if(!match) return iso || '';
  const day = Number(match[3]);
  const suffix = day >= 11 && day <= 13 ? 'th' : ({1:'st', 2:'nd', 3:'rd'}[day % 10] || 'th');
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(match[2]) - 1];
  return day + suffix + ' ' + month;
}

function updateRangeLabel(){
  const el = g('rangeLabel');
  const d  = curData();
  const pl = g('platBadge');
  if(pl){
    const p2 = (d && d.platform) || 'android';
    pl.textContent = p2 === 'ios' ? 'iOS only' : 'Android only';
    pl.style.display = '';
    pl.style.color  = p2 === 'ios' ? 'var(--cyan)' : 'var(--lime)';
    pl.style.borderColor = pl.style.color;
  }
  if(el){
    el.textContent = (dateFrom === dateTo)
      ? formatRangeDate(dateFrom)
      : formatRangeDate(dateFrom) + ' - ' + formatRangeDate(dateTo);
  }
  renderFreshness(d);
}

/**
 * Warns when the selected range sits past the end of the data. Without this a
 * stale feed looks identical to a broken metric — both render as zero.
 */
/** Shows whether this view came from the local copy or a fresh server read. */
function markSource(source){
  const el = g('syncInfo');
  if(!el || !source) return;
  const tag = source === 'local'       ? ' · cached'
            : source === 'local-stale' ? ' · offline copy'
            : '';
  if(tag && el.textContent.indexOf(tag) === -1) el.textContent = el.textContent + tag;
}

function renderFreshness(d){
  const box = g('freshBanner');
  if(!box) return;

  // Auth failure — say so plainly instead of leaving whatever was on screen.
  if(d && d._fetchError){
    box.innerHTML = '<div class="fresh-warn">'
      + '<span>⚠ <b>Could not load data</b> — ' + d._fetchError
      + (/session|expired|auth/i.test(d._fetchError) ? '. Log out and back in.' : '') + '</span>'
      + '<button onclick="hardReset()">Retry</button></div>';
    return;
  }

  // Range or shape mismatch — the exact failure that showed a 45-day payload
  // on a 14-day selection.
  const m = d && d.meta;
  if(m && (m.from !== dateFrom || m.to !== dateTo)){
    box.innerHTML = '<div class="fresh-warn">'
      + '<span>⚠ <b>Stale data</b> — these figures cover ' + (m.from||'?') + ' → ' + (m.to||'?')
      + ', not the ' + dateFrom + ' → ' + dateTo + ' you selected.</span>'
      + '<button onclick="hardReset()">Clear cache &amp; reload</button></div>';
    return;
  }
  if(d && d._source === 'local-stale'){
    box.innerHTML = '<div class="fresh-warn">'
      + '<span>⚠ <b>Offline copy</b> — the server could not be reached, showing the last saved read.</span>'
      + '<button onclick="hardReset()">Retry</button></div>';
    return;
  }
  // The server confirmed newer data exists and the download then failed. The
  // cached figures stay on screen — labelled, not silently.
  if(d && d._staleNotice){
    box.innerHTML = '<div class="fresh-warn">'
      + '<span>⚠ <b>Newer data available</b> — the sheet has been updated since this copy was saved'
      + (d.meta && d.meta.lastUpdated ? ' (' + d.meta.lastUpdated + ')' : '')
      + ', but it could not be downloaded. These figures are behind.</span>'
      + '<button onclick="hardReset()">Retry</button></div>';
    return;
  }
  const f = d && d.freshness;
  if(!f || !f.sources){ box.innerHTML = ''; return; }

  // A source contributes nothing when its newest row falls OUTSIDE the selected
  // window — which can happen on either side. Only checking `latest < dateFrom`
  // missed the tabs dated ahead of the range (a mistyped 10/08 stored as 8 Oct
  // reads as fresher than today), so four empty cards went unflagged.
  const today = sheetToday();
  const stale = f.sources.filter(function(s){
    return !s.latest || s.latest < dateFrom || s.latest > dateTo;
  });
  if(!stale.length){ box.innerHTML = ''; return; }
  // which sources are empty is a note for the data team (and admins), not
  // for everyone reading the dashboard
  if(!isDataTeam()){ box.innerHTML = ''; return; }

  const label = function(s){
    if(!s.latest) return s.source + ' → no data';
    if(s.latest < dateFrom) return s.source + ' → ends ' + s.latest;
    return s.source + ' → dated ' + s.latest + (s.latest > today ? ' (future)' : '') + ', after this range';
  };

  // Never offer to jump to a date that has not happened yet.
  const jumpTo = f.sources.map(function(s){ return s.latest; })
    .filter(function(x){ return x && x <= today; })
    .sort().pop();

  box.innerHTML = '<div class="fresh-warn">'
    + '<span>⚠ <b>' + stale.length + ' of ' + f.sources.length + ' sources</b> have no data in this range, so those cards read zero.</span>'
    + '<span class="fresh-list">' + stale.map(label).join('  ·  ') + '</span>'
    + (jumpTo ? '<button onclick="jumpToLatest()">Jump to latest data (' + jumpTo + ')</button>' : '')
    + '</div>';
}

/* Who can open User Management. The Data team is the admin; the backend's
   access record (edit:true) and the old 'admin' role are accepted too, so a
   team that has not reached the browser yet cannot lock the admin out. */
function isAdminUser(){
  if(!CU) return false;
  return isDataTeam() || !!(CU.access && CU.access.edit) || CU.role === 'admin';
}

/** Anyone in a team whose name has "data" in it. */
function isDataTeam(){
  if(!CU) return false;
  // data team only: admins and everyone else never see the sources warning
  return /data/i.test(String(CU.team || ''));
}

/** Wipes every local copy and forces a fresh server read. */
async function hardReset(){
  lsClearAll();
  PROG = {};                 // progression windows are cached separately
  setSyncState('loading');
  const result = await loadGameData(currentGame, { refresh:true });
  setSyncState(result.ok ? 'live' : 'error', result.error);
  buildNav(); renderAll(); updateRangeLabel();
}

/** Snaps the range to the 14 days ending on the newest data available. */
async function jumpToLatest(){
  const d = curData();
  const f = d && d.freshness;
  if(!f || !f.sources) return;
  const today = sheetToday();
  // Same rule as the banner: the newest date that actually exists, ignoring
  // anything dated in the future.
  const latest = f.sources.map(function(s){ return s.latest; })
    .filter(function(x){ return x && x <= today; })
    .sort().pop();
  if(!latest) return;
  const to = new Date(latest + 'T00:00:00Z');
  const from = new Date(to); from.setUTCDate(from.getUTCDate() - 13);
  dateFrom = from.toISOString().slice(0,10);
  dateTo   = latest;
  g('rangeFrom').value = dateFrom;
  g('rangeTo').value   = dateTo;
  activeRange = 14;
  syncPresetSelect();
  await reloadForRange();
}

// ═════════════════════════════════════════
// AUTH — one shared sign-in, for every report
// ═════════════════════════════════════════
//
// This page used to authenticate by itself: SHA-256 the password in the
// browser, post it to this project's own /exec, receive a token only this
// project would accept. That is gone. One deployment issues the token now and
// every project - UA, Weekly, Till Date, ASO, Negative Spend and this one -
// verifies the same signature, so a person signs in once and everything opens.
// src/shared/session.js owns where the token is kept; the reports read it from
// exactly that place.
//
// The password is sent AS TYPED. Hashing it here would make the hash the
// password - the server compares whatever arrives, so stealing the stored
// value would be enough to sign in without ever knowing what was typed.

let CU = null;   // { username, name, role } - the SERVER decides this, not the token
let _booting = false;   // true while init() waits on access + data; one draw at the end

/** Still used by addUser(); Auth.gs will grow per-user passwords next. */
async function hashPwd(pwd){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/**
 * Adopts the user record the payload carries.
 *
 * The shared token holds a username and nothing else, so the role arrives with
 * the DATA rather than at sign-in. The nav is rebuilt when it changes, because
 * the admin-only sections are gated on it - without this an admin would sign in
 * and find the Users tab missing until something else forced a redraw.
 */
function applyUserRecord(u){
  if(!u || !u.username) return;
  const before = CU ? (CU.team + '|' + JSON.stringify(CU.access || null)) : '';
  CU = {
    username: u.username,
    name: u.name || u.username,
    role: String(u.role || 'viewer').toLowerCase(),
    team: u.team || '',
    // what this person may see; absent = nothing, never everything
    access: u.access || { full:false, pages:{} }
  };
  console.info('[dash] signed in as', CU.username, '| role:', CU.role, '| team:', CU.team || '(none)');
  const el = g('unameEl');
  if(el) el.textContent = CU.name;
  fillSidebarUser();                        // name + team under the sidebar
  // During sign-in init() draws everything once, after access and data are in.
  if(_booting) return;
  // the data-source warning depends on the team
  try { if(typeof DATA !== 'undefined' && DATA[currentGame]) renderFreshness(DATA[currentGame]); } catch(e){}
  if(CU.team + '|' + JSON.stringify(CU.access) !== before){
    buildNav();
    filterKpis();
    scheduleOverviewDataStatus();
    renderGrowthUsNotices(curData().us);
    // the page on screen may have just become off-limits
    if(!isEnabled(currentTab)) goTab(currentTab, null);
  }
}

async function doLogin(){
  const user = g('lUser').value.trim();
  const pass = g('lPass').value;
  const errEl = g('loginErr');

  if(!user || !pass){
    errEl.textContent = 'Enter your username and password.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  const btn = document.querySelector('.loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in\u2026';

  try {
    const res = await sessionLogin(API_URLS.auth, user, pass);
    // Provisional: the real name and role arrive with the first payload.
    CU = { username: res.username, name: res.username, role: 'viewer' };
    loginSuccess();
  } catch(e){
    // The server's own words. Inventing a message here is how "wrong password"
    // and "the backend is unreachable" become indistinguishable to the reader.
    errEl.textContent = e.message || 'Sign in failed.';
    errEl.style.display = 'block';
    g('lPass').value = '';
    g('lPass').focus();
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

function loginSuccess(){
  g('loginScreen').style.display = 'none';
  g('appShell').style.display = '';
  g('unameEl').textContent = (CU && CU.name) || '';
  fillSidebarUser();
  init();
}

/**
 * Restores a session left by this page, by the hub, or by any other report.
 *
 * The previous version of this function was never called: DOMContentLoaded ran
 * clearSession() instead, so every reload forced a fresh sign-in and the
 * eight-hour session was dead code. With one shared token that would be worse
 * than an annoyance - arriving here from a report you are already signed into
 * would still demand a password.
 */
function checkSession(){
  if(!getToken()) return false;
  // Provisional, same as after a login: the payload fills in who this is.
  CU = { username: '', name: '', role: 'viewer' };
  loginSuccess();
  return true;
}

function doLogout(){
  clearSession();
  CU = null;
  g('loginScreen').style.display = 'flex';
  g('appShell').style.display = 'none';
  g('lUser').value = ''; g('lPass').value = '';
  g('loginErr').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function(){
  if(checkSession()) return;
  g('loginScreen').style.display = 'flex';
  g('appShell').style.display = 'none';
  hideBootOverlay();
});


/* ---------------------------------------------------------------------------
 * Test hook.
 *
 * The smoke test cannot sign in, so it never reaches buildNav() and cannot
 * click its way to a report section. Without this it could only prove the
 * module evaluates - which was already true before any of the scope work
 * existed, and so proves nothing about it.
 *
 * Exposes the pieces that decide what the nav and the topbar do, so the test
 * can assert on them directly. Deliberately read-only apart from applyScope,
 * which is the behaviour under test.
 * ------------------------------------------------------------------------- */
window.__shell = {
  get sections(){ return getEnabledSections(); },
  /* Runs the real section logic against a pretend Config tab. The reports
     going missing was invisible to the test because a signed-out page has no
     sheet config, so only the fallback path was ever exercised - the one that
     was not broken. */
  sectionsWithSheetConfig(rows){
    const before = DATA[currentGame];
    DATA[currentGame] = Object.assign({}, before || {}, { sections: rows });
    try { return getEnabledSections(); }
    finally { if(before === undefined) delete DATA[currentGame]; else DATA[currentGame] = before; }
  },
  get scopes(){ return SCOPES; },
  meta: SECTION_META,
  applyScope: applyScope,
  reportUrl: reportUrl,
  /* The stale set and the one-section draw, so the test can check that a data
     change draws what is on screen and leaves the rest marked. Without this
     the only guard is that nobody puts the loop back by hand. */
  stale: staleSections,
  renderSection: renderSection
};

/* ===========================================================================
 * Inline-handler bridge — GENERATED by tools/extract-game.mjs. Do not edit.
 *
 * This document wires its buttons with onclick="doLogin()" style attributes,
 * which the browser evaluates in GLOBAL scope. As a <script> that worked for
 * free; as an ES module it does not, because a module has its own scope, so
 * every one of these would be undefined — buttons that do nothing, with no
 * error to notice.
 *
 * Republished here so the markup keeps working byte-for-byte. Converting the
 * attributes to addEventListener is a real improvement and a SEPARATE change:
 * doing it here would mean the migration altered behaviour, which is the one
 * thing it must not do.
 *
 * 22 functions, discovered by scanning every on*= value in the
 * source and keeping those this script actually declares.
 * ========================================================================= */
Object.assign(window, {
  /* User Management: Users | Teams */
  umShow, umUpdate, tmPick, tmTogglePage, tmOpenPage, tmAll, tmKpi, tmCreate, tmSave, tmDelete,
  alertsScan,
  addFeedback,
  addUser,
  applyDateFilter,
  changeRole,
  doLogin,
  doLogout,
  goTab,
  goToTab,
  hardReset,
  jumpToLatest,
  loadUsers,
  mxSetGrain,
  mxToggleSheetColours,
  onDateInput,
  onGameChange,
  onPresetChange,
  onProgRangeChange,
  removeUser,
  saveThresh,
  syncNow,
  toggleSidebar,
});
