/* eslint-disable */
import { API_URLS, GAME_API_KEY, BUILD_ID, assertConfigured } from '../src/shared/config.js';
import { getToken, clearSession, login as sessionLogin } from '../src/shared/session.js';
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
const CHART_FONT = 'Poppins, Segoe UI, sans-serif';

let charts = {};
let shopRange = { min:1, max:20 };
let dayRange  = { min:1, max:30 };

// Progress Events carries its own window, independent of the dashboard range.
// Its rows are a cumulative "how many players ever reached level X" aggregate
// over the window, not a per-day series, so it only reads sensibly over whole
// weeks and cannot be re-sliced client-side — each window is its own request.
let progRangeDays = 7;
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
  mechanics: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>',
  economy:   '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="6"/><path d="M10.5 5.5H7a1.5 1.5 0 100 3h2a1.5 1.5 0 010 3H5.5"/><line x1="8" y1="3.5" x2="8" y2="12.5"/></svg>',
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
  aso:       '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 1.6l1.9 4 4.3.5-3.2 2.9 .9 4.3L8 11.2 4.1 13.3l.9-4.3L1.8 6.1l4.3-.5z"/></svg>',
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
  growth:     { group:'Growth',         label:'Growth',          order:20,  scope:'game' },
  retention:  { group:'Player Metrics', label:'Retention',       order:30,  scope:'game' },
  playtime:   { group:'Player Metrics', label:'Engagement',      order:40,  scope:'game' },
  ftue:       { group:'Player Metrics', label:'FTUE Funnel',     order:50,  scope:'game' },
  mechanics:  { group:'Gameplay',       label:'Store Ops',       order:60,  scope:'game' },
  economy:    { group:'Gameplay',       label:'Economy',         order:70,  scope:'game' },
  events:     { group:'Gameplay',       label:'Progress Events', order:80,  scope:'game' },
  liveops:    { group:'Live Ops',       label:'Live Ops',        order:90,  scope:'game' },
  stability:  { group:'App Health',     label:'Stability',       order:100, scope:'game' },
  rating:     { group:'App Health',     label:'Player Rating',   order:110, scope:'game' },

  /* The reports. Order puts them after the game sections and before Config,
     which is where a UA manager's eye goes second - the game overview first,
     then what needs a decision today. */
  negative:     { group:'UA Reports', label:'Negative Spend', order:200, scope:'ua',
                  report:'negative-spend' },
  uareport:     { group:'UA Reports', label:'UA Report',      order:210, scope:'ua',
                  report:'ua' },
  monetization: { group:'UA Reports', label:'Monetization',   order:220, scope:'ua',
                  report:'weekly' },
  tilldate:     { group:'All Time',   label:'Till Date',      order:230, scope:'all',
                  report:'till-date' },
  aso:          { group:'Store',      label:'ASO',            order:240, scope:'aso',
                  report:'aso' },

  feedback:   { group:'Config',         label:'Feedback',        order:300, scope:'game' },
  thresholds: { group:'Config',         label:'Thresholds',      order:310, scope:'game' },
  users:      { group:'Config',         label:'User Management', order:320, scope:'game' },
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
  aso:  { game: 'all games',   range: 'set inside the report' }
};

/** Where a report section's page lives, relative to this one. */
function reportUrl(name) {
  return 'reports/' + name + '/?v=' + encodeURIComponent(BUILD_ID);
}

// Section id → render function reference (late-bound so forward decls work)
const SECTION_RENDERS = {
  overview:   function(){ renderOverview(); },
  growth:     function(){ renderGrowth(); },
  retention:  function(){ renderRetention(); },
  playtime:   function(){ renderPlaytime(); },
  ftue:       function(){ renderFtue(); },
  mechanics:  function(){ renderMechanics(); },
  economy:    function(){ renderEconomy(); },
  events:     function(){ renderEvents(); },
  liveops:    function(){ renderLiveOps(); },
  stability:  function(){ renderStability(); },
  rating:     function(){ renderRating(); },
  feedback:   function(){ renderFeedback(); },
  thresholds: function(){ renderThresholds(); },
  users:      function(){ renderUsers(); },
};

// Fallback enabled set when a game's sheet has no Config tab yet.
// Once you add a Config tab per game, those rows override this list.
const DEFAULT_ENABLED_SECTIONS = [
  'overview', 'growth', 'retention', 'playtime', 'ftue',
  'mechanics', 'events', 'liveops', 'stability', 'rating',
  /* The five reports. They are listed here rather than left to the sheet's
     Config tab because they are not per-game features to be switched on and
     off - they are the rest of the dashboard. */
  'negative', 'uareport', 'monetization', 'tilldate', 'aso',
  'feedback', 'thresholds'
];
// Users section is always available but only shown to admins (filtered in getEnabledSections)
const ADMIN_ONLY_SECTIONS = ['users'];

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
        icon:  NAV_ICONS[id] || '',
        render:SECTION_RENDERS[id],
      };
    }).filter(function(s){ return s.render || s.report; });
  }

  // Always add admin-only sections for admin users
  if(CU && CU.role === 'admin'){
    ADMIN_ONLY_SECTIONS.forEach(function(id){
      if(!list.find(function(s){ return s.id === id; })){
        const meta = SECTION_META[id] || {};
        if(SECTION_RENDERS[id]){
          list.push({
            id:    id,
            label: meta.label || id,
            order: meta.order || 999,
            group: meta.group || 'Config',
            icon:  NAV_ICONS[id] || '',
            render:SECTION_RENDERS[id],
          });
        }
      }
    });
  }

  return list.sort(function(a,b){ return a.order - b.order; });
}

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
const fmt     = n => n==null?'—':Number(n).toLocaleString();
const fmtKn   = n => n==null?'—':(Math.abs(n)>=1e6?(n/1e6).toFixed(2)+'M':Math.abs(n)>=1e3?(n/1e3).toFixed(1)+'K':Math.round(n).toString());
const fmtPct  = n => n==null?'—':(+n).toFixed(1)+'%';
const fmtPct2 = n => n==null?'—':(+n).toFixed(2)+'%';
const fmtSec  = n => n==null?'—':Math.round(n)+'s';
const fmtPlaytime = n => (n==null||n==='')?'—':Math.round(+n)+'s';
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
function getWindow(arr){
  if(!arr || !arr.length) return [];
  if(dateFrom && dateTo){
    return arr.filter(r => r.date && r.date >= dateFrom && r.date <= dateTo);
  }
  return arr.slice(-activeRange);
}
function getPrevWindow(arr){
  if(!arr || !arr.length) return [];
  const cur = getWindow(arr);
  if(!cur.length) return [];
  const len = cur.length;
  const firstDate = cur[0].date;
  const idx = arr.findIndex(r => r.date === firstDate);
  return idx > 0 ? arr.slice(Math.max(0, idx-len), idx) : [];
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
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    // Axis ticks and legends. Kept in step with --text2 in the stylesheet;
    // Chart.js cannot read a CSS variable, so the value is repeated here.
    text:  dark ? '#C2C9E8' : '#3E4767',
    grid:  dark ? 'rgba(100,130,230,0.07)' : 'rgba(30,60,160,0.07)',
    cyan:  dark ? '#00E5FF' : '#0095B8',
    magenta: dark ? '#FF4DC9' : '#C4277D',
    lime:  dark ? '#A6FF4D' : '#4B9B00',
    amber: dark ? '#FFB800' : '#B87400',
    coral: dark ? '#FF5470' : '#D2324A',
    violet:dark ? '#A78BFA' : '#6D4BCE',
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
  'monetization.ftp','engagement.adCohort','engagement.placements',
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
    ratings:     raw.ratings     || { daily:[], versions:[] },
    ua:          raw.ua          || { daily:[], channels:[], campaigns:[], roasCurve:[] },
    cohortRoas:  raw.cohortRoas  || null,
    sheet1:      raw.sheet1      || null,
    monetization:raw.monetization|| { networks:[], ltv:[], whale:[], ftp:[] },
    engagement:  raw.engagement  || { adCohort:[], placements:[], cohortDayKeys:[] },
    conversions: raw.conversions || [],
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

    if(!opts.refresh){
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
    applyUserRecord(raw.user);
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
    stability:[], ratings:{daily:[],versions:[]},
    ua:{daily:[],channels:[],campaigns:[],roasCurve:[]},
    monetization:{networks:[],ltv:[],whale:[],ftp:[]},
    engagement:{adCohort:[],placements:[],cohortDayKeys:[]},
    conversions:[], liveops:[], benchmark:[], feedback:[], missing:{}, freshness:null,
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

  sparkCharts[id] = new Chart(c, {
    type: 'line',
    data: {
      labels: vals.map((_, i) => (dates && dates[i]) ? dates[i] : i),
      datasets: [{
        data: vals,
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

            const i = tt.dataPoints[0].dataIndex;
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
              const col = diff > 0 ? '#A6FF4D' : (diff < 0 ? '#FF5470' : '#8A94BE');
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
          display: false, beginAtZero: true, min: 0, grid: { display: false },
          border: { display: false },
          max: sparkMax
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

/** N days before the sheet's today. Shifts the date STRING, so no clock drift. */
function isoDaysAgo(n){
  return isoShift(sheetToday(), -n);
}

/**
 * The background queue, in the order a user is most likely to need it.
 *
 * The OTHER platform's default view comes first: switching Android ⇄ iOS is a
 * single click and by far the most common next action, whereas widening to 30
 * days takes a deliberate choice. Deeper history goes last.
 */
/** Every preset the range dropdown offers. Custom ranges are not warmed. */
const PRESET_DAYS = [14, 28, 42, 56];

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
    const w = { from: isoDaysAgo(days - 1), to: isoDaysAgo(0) };
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

  // ── Instant path ──
  // A stored payload for this exact range is rendered without waiting on the
  // network. The data version is checked afterwards, and only rows actually
  // being appended triggers a refetch, so the common case is one small request
  // and no redraw.
  const cached = readCache(currentGame, dateFrom, dateTo);
  let servedFromCache = false;

  if(cached){
    try {
      DATA[currentGame] = normalizeSheetData(cached.payload);
      DATA[currentGame]._source = 'local';
      applySheetThresholds(cached.payload.thresholds || []);
      applyUserRecord(cached.payload.user);
      if(cached.payload.games) applyGameList(cached.payload.games);
      servedFromCache = true;
      setSyncState('live');
      markSource('local');
    } catch(e){
      // A stored payload that cannot be rendered is worse than none. Delete it
      // before falling through, or loadGameData() would simply read the same
      // broken entry back and fail the same way.
      console.warn('[dash] stored payload could not be rendered, refetching:', e.message);
      dropCache(currentGame, dateFrom, dateTo);
      servedFromCache = false;
    }
  }

  if(!servedFromCache){
    const result = await loadGameData(currentGame);
    if(result.ok){
      if(result.raw && result.raw.games) applyGameList(result.raw.games);
      setSyncState('live');
      markSource(result.source);
    } else {
      setSyncState('error', result.error);
    }
  }

  feedback = (DATA[currentGame] && DATA[currentGame].feedback || []).slice();
  buildNav();
  restoreSidebarState();
  if(!isEnabled(currentTab)) currentTab = 'overview';
  renderAll();
  goTab(currentTab);
  updateRangeLabel();
  showLoadingOverlay(false);

  // The dashboard is now interactive. Everything below is background work and
  // must never block or alter what is on screen.
  if(servedFromCache) revalidateInBackground(currentGame, payloadVersion(cached.payload));
  schedulePrefetch(currentGame);
  startVersionPoll();
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
}

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
  // Both ends derived from the sheet's today, so a preset lands on exactly the
  // window the server warmed.
  const toStr   = sheetToday();
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
}

function updateGameBranding(){
  const game = games.find(x=>x.id===currentGame) || games[0];
  g('sbGameName').textContent = game.name;
  g('sbMark').textContent = gameBadge(game.name);
}

function renderAll(){
  setTimeout(function(){ resizeChartsIn(g('tab-' + currentTab)); }, 50);
  aggregateFtue();
  const sections = getEnabledSections();
  sections.forEach(function(s){
    // Reports render themselves in their own page; there is nothing to call.
    if(s.report) return;
    if(typeof s.render === 'function'){
      try { s.render(); }
      catch(e) { console.warn('Render error:', s.id, e); }
    }
  });
  // No-op once this window is cached; otherwise it lands and repaints itself.
  ensureProgression();
}

// ═════════════════════════════════════════
// OVERVIEW
// ═════════════════════════════════════════
function renderOverview(){
  const d = curData(); if(!d.daily) return;
  const cur  = getWindow(d.daily);
  const prev = getPrevWindow(d.daily);
  const curR = getWindow(d.retention);
  const prevR= getPrevWindow(d.retention);
  const cc   = chartColors();
  const curDates = cur.map(x=>x.date);

  const totalInstalls = sum(cur.map(x=>+x.installs||0));
  const prevInstalls  = sum(prev.map(x=>+x.installs||0));

  const dauAvg        = avg(cur.map(x=>+x.dau||0));
  const prevDau       = avg(prev.map(x=>+x.dau||0));
  // D1 comes from Executive_KPIs (cohort-weighted, platform-aware) so the value
  // has the same meaning whichever platform is selected.
  const retSum        = d.retSummary || {};
  const cohortsCur    = getWindow(d.retCohorts || []);
  const d1            = (retSum.d1 != null) ? retSum.d1 : null;
  const prevD1        = avg(prevR.map(x=>x.d1));
  const d0Play        = avgNN(cur.map(x=>x.d0Playtime));
  const prevD0Play    = avgNN(prev.map(x=>x.d0Playtime));
  const ftueSteps     = d.ftueSteps || [];
  // Measured at the deepest step every platform reaches, so Android, iOS and
  // Combined are comparable. The old "last step" figure was not.
  const ftueRef       = (d.ftue && d.ftue.referenceStep) || {};
  const ftueComplete  = (ftueRef.engagement != null) ? ftueRef.engagement : null;

  const kpis = [
    { cls:'cy', lbl:'Installs',      val:fmtKn(totalInstalls),  data:cur.map(x=>+x.installs||0), dates:curDates, cur:totalInstalls, prev:prevInstalls, sub:'period total', col:'--cyan',    fmt:fmtKn },
    { cls:'mg', lbl:'DAU',           val:fmtKn(dauAvg),         data:cur.map(x=>+x.dau||0),      dates:curDates, cur:dauAvg,        prev:prevDau,      sub:'period avg',   col:'--magenta', fmt:fmtKn },
    { cls:'vl', lbl:'D1 Retention',  val:d1?fmtPct(d1):'—',     data:cohortsCur.map(x=>+x.d1||0), dates:cohortsCur.map(x=>x.date), cur:d1, prev:prevD1, sub:'cohort-weighted',   col:'--violet',  fmt:fmtPct },
    { cls:'lm', lbl:'D0 Playtime',   val:fmtSec(d0Play),        data:cur.map(x=>+x.d0Playtime||0), dates:curDates, cur:d0Play,     prev:prevD0Play,   sub:'avg new user', col:'--lime',    fmt:fmtSec },
    { cls:'am', lbl:'FTUE Complete', val:ftueComplete?fmtPct(ftueComplete):'—', data:[], dates:[], cur:ftueComplete, prev:null,     sub:(ftueRef.name ? 'reached ' + ftueRef.name : 'final step'), col:'--amber', fmt:fmtPct },
  ];

  g('heroKpis').innerHTML = kpis.map((k,i)=>`
    <div class="kpi has-spark ${k.cls}">
      <div class="kpi-text">
        <div class="kpi-label">${k.lbl}</div>
        <div class="kpi-val${String(k.val).length>6?' small':''}">${k.val}</div>
        <div class="kpi-bottom">${k.prev!=null?deltaHtml(k.cur,k.prev):''}<span class="kpi-sub">${k.sub}</span></div>
      </div>
      <div class="kpi-spark-box"><canvas id="sp${i}"></canvas></div>
    </div>
  `).join('');
  kpis.forEach((k,i)=>{
    if(!k.data.length) return;
    const color = getComputedStyle(document.documentElement).getPropertyValue(k.col).trim();
    drawSpark('sp'+i, k.data, color, k.fmt, k.dates);
  });

  // ── Row 2: money + engagement depth ──
  const revTot   = sum(cur.map(x=>+x.revenue||0));
  const revPrev  = sum(prev.map(x=>+x.revenue||0));
  const arpdau   = dauAvg>0 ? revTot/(dauAvg*(cur.length||1)) : 0;
  const arpdauP  = prevDau>0 ? revPrev/(prevDau*(prev.length||1)) : 0;
  const payerPct = avg(cur.map(x=>+x.payerRate||0));
  const payerPrv = avg(prev.map(x=>+x.payerRate||0));
  const spd      = avgNN(cur.map(x=>x.sessionsPerUser));
  const spdPrev  = avgNN(prev.map(x=>x.sessionsPerUser));
  const adShare  = revTot>0 ? sum(cur.map(x=>+x.adRevenue||0))/revTot*100 : 0;

  const kpis2 = [
    { cls:'lm', lbl:'Revenue',         val:'$'+fmtKn(revTot),        data:cur.map(x=>+x.revenue||0), cur:revTot, prev:revPrev, sub:'ads + IAP',      col:'--lime' },
    { cls:'cy', lbl:'ARPDAU',          val:'$'+arpdau.toFixed(4),    data:cur.map(x=>+x.arpdau||0),  cur:arpdau, prev:arpdauP, sub:'per active user',col:'--cyan' },
    { cls:'mg', lbl:'Payer Conv.',     val:payerPct?payerPct.toFixed(3)+'%':'—', data:cur.map(x=>+x.payerRate||0), cur:payerPct, prev:payerPrv, sub:'of DAU', col:'--magenta' },
    { cls:'am', lbl:'Sessions / User', val:spd?spd.toFixed(2):'—',   data:cur.map(x=>+x.sessionsPerUser||0), cur:spd, prev:spdPrev, sub:'per active user', col:'--amber' },
    { cls:'vl', lbl:'Ad Share',        val:adShare?adShare.toFixed(1)+'%':'—', data:[], cur:adShare, prev:null, sub:'rest is IAP', col:'--violet' },
  ];
  if(g('heroKpis2')){
    g('heroKpis2').innerHTML = kpis2.map((k,i)=>`
      <div class="kpi has-spark ${k.cls}">
        <div class="kpi-text">
          <div class="kpi-label">${k.lbl}</div>
          <div class="kpi-val${String(k.val).length>6?' small':''}">${k.val}</div>
          <div class="kpi-bottom">${k.prev!=null?deltaHtml(k.cur,k.prev):''}<span class="kpi-sub">${k.sub}</span></div>
        </div>
        <div class="kpi-spark-box"><canvas id="sq${i}"></canvas></div>
      </div>
    `).join('');
    kpis2.forEach((k,i)=>{
      if(!k.data.length) return;
      const color = getComputedStyle(document.documentElement).getPropertyValue(k.col).trim();
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

  // ── Store Ops / Economy / LiveOps — awaiting Cellar ──
  if(g('ovMechanics')) g('ovMechanics').innerHTML = noData(d.missing.storeOps || 'Store Ops events');
  if(g('ovEconomy'))   g('ovEconomy').innerHTML   = noData(d.missing.economy  || 'Economy events');

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

function renderGrowth(){
  // Drawn first: the matrix has its own date spine, so it still renders on a
  // game that has no daily rows yet.
  renderSpendMatrix();

  const d = curData(); if(!d.daily) return;
  const cur  = getWindow(d.daily);
  const prev = getPrevWindow(d.daily);
  const ua   = d.ua || {channels:[],daily:[],campaigns:[],roasCurve:[]};
  const uaCur  = getWindow(ua.daily || []);
  const uaPrev = getPrevWindow(ua.daily || []);
  const cc   = chartColors();
  const lbls = cur.map(x=>x.date.slice(5));

  const totalInstalls = sum(cur.map(x=>+x.installs||0));
  const prevInstalls  = sum(prev.map(x=>+x.installs||0));

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
  const chDailyPrev = getPrevWindow(ua.channelDaily || []);
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
  const assistedTotal = haveAssisted ? sum(mxDayKeys.map(k=>assistedByDay[k])) : null;
  // Clamped at 0: attribution windows can credit an install to a day outside
  // this range, so assisted can exceed the Executive KPI total on a single day.
  // A negative organic count is never a true statement.
  const organicTotal  = (assistedTotal!=null)
    ? Math.max(0, totalInstalls - assistedTotal) : null;
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
  const uaSpend       = sc ? sc.spend : null;
  const prevSpend     = scPrev ? scPrev.spend : null;
  const uaRevenue     = sc ? sc.revenue : null;
  // Match Overview exactly: daily.installs is built from Executive_KPI's for
  // the selected platform and date range.
  const acqInstalls   = totalInstalls;
  const acqPrevInst   = prevInstalls;
  // CPI uses Sheet1's UA spend but the same Executive KPI install denominator
  // as the two install views above, keeping all three acquisition KPIs aligned.
  const avgCpi        = uaSpend != null && acqInstalls > 0
    ? uaSpend / acqInstalls
    : null;
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
  const roasWeighted = (key) => {
    let n = 0, dsum = 0;
    chans_.forEach(c=>{
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
  const chSpendPrev   = sum(chDailyPrev.map(x=>+x.spend||0));
  const roi           = chSpendTot>0 ? chRevTot/chSpendTot*100 : null;
  const prevRoas      = null;
  const ltvRows       = (d.monetization&&d.monetization.ltv)||[];
  const ltvD0         = ltvRows.length ? avg(ltvRows.map(x=>+x.d0||0)) : 0;
  const ltvD7Vals     = ltvRows.map(x=>x.d7).filter(x=>x!=null && x!=='' && !isNaN(x));
  const ltvD28Vals    = ltvRows.map(x=>x.d28).filter(x=>x!=null && x!=='' && !isNaN(x));
  const ltvD7         = ltvD7Vals.length ? avg(ltvD7Vals) : null;
  const ltvD28        = ltvD28Vals.length ? avg(ltvD28Vals) : null;
  const ltvCpi        = avgCpi>0 ? ltvD0/avgCpi : null;
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
  const agSpendTot    = sc && sc.spendAG != null ? +sc.spendAG : 0;
  const agSpendPrev   = sheetCards && sheetCards.previous && sheetCards.previous.spendAG != null
                          ? +sheetCards.previous.spendAG : null;
  const uaSpendCh     = agSpendTot>0 ? agSpendTot : null;
  const uaSpendPrevCh = agSpendTot>0 ? agSpendPrev : null;
  const uaSpendSrc    = agSpendTot>0 ? 'Sheet1 column AG' : 'Sheet1 unavailable';

  const acqKpis = [
    { cls:'cy', lbl:'Organic Installs',
      val: organicTotal!=null ? fmtKn(organicTotal) : '—',
      data: cur.map(x=>organicByDay(x.date)), dates:curDatesG, col:'--cyan',
      cur: organicTotal, prev: null,
      sub: organicTotal!=null
             ? 'total '+fmtKn(totalInstalls)+' − assisted '+fmtKn(assistedTotal)
             : 'loading Sheet1…' },
    { cls:'co', lbl:'UA Spend', val:uaSpendCh!=null?'$'+fmtKn(uaSpendCh):'—',
      data: agSpendTot>0 ? agKeys.map(k=>+shDaysM[k].spendAG||0) : [],
      dates: agSpendTot>0 ? agKeys : [], col:'--coral',
      cur:uaSpendCh, prev:uaSpendPrevCh, sub:uaSpendSrc },
    { cls:'lm', lbl:'ROI', val:roi!=null?roi.toFixed(0)+'%':'—',
      data: chDaily.map(x=>(+x.spend>0 ? (+x.revenue||0)/(+x.spend)*100 : null)),
      dates: chDaily.map(x=>x.date), col:'--lime',
      sub:chSpendTot>0?'revenue / UA spend':'Channel Performance unavailable' },
  ];
  // Paid Installs and Organic Installs were removed: both need attribution,
  // which has no source in this sheet, so one always read 0 and the other just
  // repeated Total Installs.
  const acqKpis2 = [
    { cls:'mg', lbl:'Avg CPI',   val:avgCpi!=null?'$'+(+avgCpi).toFixed(3):'—',
      data: chDaily.map(x=>(+x.installs>0 ? (+x.spend||0)/(+x.installs) : null)),
      dates: chDaily.map(x=>x.date), col:'--magenta',
      sub:sc?'UA spend / Executive KPI installs':scStatus },
    { cls:'am', lbl:'ROAS',      val:roas!=null?roas.toFixed(0)+'%':'—', sub:roasSub, col:'--amber' },
    { cls:'vl', lbl:'LTV : CPI', val:ltvCpi!=null?ltvCpi.toFixed(2)+'x':'—', sub:sc?'D0 LTV vs cost':scStatus, col:'--violet' },
  ];
  // Growth cards now carry the same sparkline as the Overview cards. A card
  // with no series still renders — it just falls back to the plain layout
  // rather than reserving an empty chart box.
  const kpiHtml = (k, i, pfx) => {
    const hasData = (k.data||[]).filter(v=>v!=null && v!=='' && isFinite(v)).length >= 2;
    const bottom = k.prev!=null
      ? '<div class="kpi-bottom" style="margin-top:8px">'+deltaHtml(k.cur,k.prev)+'<span class="kpi-sub">'+k.sub+'</span></div>'
      : '<div class="kpi-sub" style="margin-top:6px">'+k.sub+'</div>';
    if(!hasData){
      return '<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.lbl+'</div>'
        + '<div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div>'
        + bottom + '</div>';
    }
    return '<div class="kpi has-spark '+k.cls+'">'
      + '<div class="kpi-text"><div class="kpi-label">'+k.lbl+'</div>'
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
  const yUsd= {grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>'$'+fmtKn(v)}};

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
        + '<div class="tnum">'+(c.cpi!=null?'$'+(+c.cpi).toFixed(2):'—')+'</div>'
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
      + '<div class="tnum">'+(c.ecpi!=null?'$'+(+c.ecpi).toFixed(2):'—')+'</div>'
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
  const revTot   = sum(cur.map(x=>+x.revenue||0));
  const prevRev  = sum(prev.map(x=>+x.revenue||0));
  const dauAvg   = avg(cur.map(x=>+x.dau||0)) || 1;
  const arpdau   = revTot/(dauAvg*(cur.length||1));
  const prevDauA = avg(prev.map(x=>+x.dau||0)) || 1;
  const prevArpd = prevRev/(prevDauA*(prev.length||1));
  const payers   = sum(cur.map(x=>+x.payers||0));
  // ARPPU: IAP revenue per PAYING user. Ad revenue is excluded on purpose —
  // a payer is defined by making a purchase, so crediting ad views to them
  // would inflate the figure with money non-payers generated.
  // ARPPU = sales / paying users, both from the IAP tab (buildDaily reads the
  // tab's `sales` column, not `revenue`, which is blank on every row there).
  const iapSalesT = sum(cur.map(x=>+x.iapSales||0));
  const arppu    = payers>0 && iapSalesT>0 ? iapSalesT/payers : null;
  const payerPct = avg(cur.map(x=>+x.payerRate||0));

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

  const chRevTotM = sum(chDaily.map(x=>+x.revenue||0));
  const useChRev  = chRevTotM > 0;
  const revTotM   = useChRev ? chRevTotM : null;
  const iapTot    = useShRev ? shIapTot : null;
  const adTot     = useShRev ? shAdTot : null;
  // The two shares are read against their own total, so they sum to 100%
  // rather than against a Revenue figure from a different source.
  const splitTot  = useShRev ? (shIapTot + shAdTot) : null;
  const shSeries  = (key) => cur.map(x => shDaysM[x.date] ? +shDaysM[x.date][key]||0 : null);
  const prevRevM  = useChRev ? sum(chDailyPrev.map(x=>+x.revenue||0)) : null;
  const revSrc    = useChRev ? 'Channel Performance' : 'Channel Performance unavailable';

  // ARPU: revenue per ACTIVE user, the standard definition. This previously
  // divided by installs, which is ARPI (revenue per install) — a different
  // and much smaller number that made the card look broken next to ARPDAU.
  const dauSum   = sum(cur.map(x=>+x.dau||0));
  const arpu     = dauSum>0 && revTotM!=null ? revTotM/dauSum : null;

  const chDates = chDaily.map(x=>x.date);
  const monKpis = [
    { cls:'lm', lbl:'Revenue', val:revTotM!=null?'$'+fmtKn(revTotM):'—', cur:revTotM, prev:prevRevM, sub:revSrc,
      data: useChRev ? chDaily.map(x=>+x.revenue||0) : [],
      dates: useChRev ? chDates : [], col:'--lime' },
    { cls:'cy', lbl:'ARPDAU', val:'$'+arpdau.toFixed(4), cur:arpdau, prev:prevArpd,
      sub:'per active user', data: cur.map(x=>+x.arpdau||0), dates:curDatesG, col:'--cyan' },
    { cls:'mg', lbl:'ARPPU', val:arppu?'$'+arppu.toFixed(2):'—', sub:'sales / paying user',
      data: cur.map(x=>+x.arppu||null), dates:curDatesG, col:'--magenta' },
    { cls:'am', lbl:'Purchase Rate', val:payerPct?payerPct.toFixed(3)+'%':'—', sub:'paying / active users',
      data: cur.map(x=>+x.payerRate||null), dates:curDatesG, col:'--amber' },
  ];
  // Renamed from "IAP Share" / "Ad Share": the headline is now the dollar
  // amount, with the share carried underneath, so the pair reads as a split of
  // the Revenue card above rather than as two unrelated percentages.
  const iapPct = splitTot>0 ? iapTot/splitTot*100 : null;
  const adPct  = splitTot>0 ? adTot/splitTot*100  : null;
  const monKpis2 = [
    { cls:'vl', lbl:'IAP Revenue', val:iapTot!=null?'$'+fmtKn(iapTot):'—',
      sub:(iapPct!=null?iapPct.toFixed(1)+'% of revenue':'—')+' · from purchases',
      data: useShRev ? shSeries('inappTotal') : [],
      dates: useShRev ? curDatesG : [], col:'--violet' },
    { cls:'co', lbl:'Ad Revenue', val:adTot!=null?'$'+fmtKn(adTot):'—',
      sub:(adPct!=null?adPct.toFixed(1)+'% of revenue':'—')+' · from ads',
      data: useShRev ? shSeries('adTotal') : [],
      dates: useShRev ? curDatesG : [], col:'--coral' },
    { cls:'cy', lbl:'LTV D0 / D7 / D28', val:ltvRows.length?'$'+ltvD0.toFixed(3):'—', sub:ltvRows.length?'D7 '+(ltvD7!=null?'$'+ltvD7.toFixed(3):'—')+' · D28 '+(ltvD28!=null?'$'+ltvD28.toFixed(3):'—'):'no LTV rows' },
    { cls:'lm', lbl:'ARPU', val:arpu?'$'+arpu.toFixed(4):'—', sub:'per active user',
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
          ticks:{color:cc.text,font:{family:CHART_FONT,size:9},callback:v=>'$'+(+v).toFixed(3)}}}
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
      + '<div class="tnum">'+(n.ecpm!=null?'$'+n.ecpm.toFixed(2):'—')+'</div>'
      + '<div class="tnum">'+(n.fillRate!=null?n.fillRate.toFixed(1)+'%':'—')+'</div>'
      + '</div>').join('')
      // The server explains an empty table — which tab, which date, which platform.
      : noData((d.monetization&&d.monetization.networksNote) || 'No ad network rows in range');
    markTable('growthNetworkTbl', nets.length, 'networks');
  }

  // Whale concentration (weekly)
  const whales = (d.monetization&&d.monetization.whale)||[];
  if(g('cvGrowthWhale')){
    if(whales.length){
      makeChart('cvGrowthWhale','bar',{
        labels: whales.map(w=>w.week.slice(5)+' '+w.platform),
        datasets:[
          {type:'bar', label:'Whale revenue',data:whales.map(w=>w.whaleRev),backgroundColor:cc.magenta+'cc',borderColor:cc.magenta,borderWidth:1,borderRadius:3},
          {type:'bar', label:'Other revenue',data:whales.map(w=>w.totalRev-w.whaleRev),backgroundColor:cc.violet+'66',borderColor:cc.violet,borderWidth:1,borderRadius:3},
          {type:'line',label:'Whale share %',data:whales.map(w=>w.whaleShare),borderColor:cc.amber,backgroundColor:'transparent',borderWidth:2,pointRadius:2,tension:.3,yAxisID:'y2'},
        ]
      }, {
        plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}},
        scales:{x:Object.assign({stacked:true},xAx),y:Object.assign({stacked:true},yUsd),
          y2:{position:'right',grid:{display:false},ticks:{color:cc.amber,font:{family:CHART_FONT,size:9},callback:v=>v+'%'}}}
      });
    } else { wrapEmpty('cvGrowthWhale','No whale rows in range (weekly grain)'); }
  }

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
    } else { wrapEmpty('cvGrowthFtp','No first-payer rows in range'); }
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
  const rangeEnd = dateTo || sheetToday();
  let start, n;

  if(MX_SNAP_TO_SUNDAY){
    // Today is still filling, so it can never close a week.
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
  try { el.classList.toggle('tbl-scroll', count > 15); } catch(e){}
  const card = (el.closest && el.closest('.card')) || null;
  if(!card) return;
  // Keep header tracks aligned with the body when its 8px scrollbar appears.
  try { card.classList.toggle('has-table-scroll', count > 15); } catch(e){}
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
  const prevCo  = getPrevWindow(d.retCohorts || []);
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
  // Every day the sheet reports, so D2/D4/D5/D6 and D14 are first-class rather
  // than only reachable from the curve. Backend summary wins; the windowed
  // cohorts are the fallback when the dashboard range differs from the payload's.
  const dayVals = {};
  RET_DAYS.forEach(function(k){
    dayVals[k] = sum[k] != null ? sum[k] : null;
  });
  const prevVals = {};
  RET_DAYS.forEach(function(k){ prevVals[k] = wAvg(prevCo, k) || null; });

  const d1  = dayVals.d1, d3 = dayVals.d3, d7 = dayVals.d7, d14 = dayVals.d14;
  const p1  = prevVals.d1, p7 = prevVals.d7, p14 = prevVals.d14;
  const cohortSize = sum.cohortSize || sum2(cohorts, 'cohortSize');

  const DAY_STYLE = {
    d1:{cls:'cy',lbl:'D1 Retention'},  d2:{cls:'mg',lbl:'D2 Retention'},
    d3:{cls:'am',lbl:'D3 Retention'},  d4:{cls:'lm',lbl:'D4 Retention'},
    d5:{cls:'vl',lbl:'D5 Retention'},  d6:{cls:'co',lbl:'D6 Retention'},
    d7:{cls:'cy',lbl:'D7 Retention'},  d14:{cls:'mg',lbl:'D14 Retention'}
  };

  g('retKpis').innerHTML = RET_DAYS.map(function(k){
    const st  = DAY_STYLE[k] || { cls:'cy', lbl:k.toUpperCase()+' Retention' };
    const v   = dayVals[k], p = prevVals[k];
    const bad = (k === 'd1' && v && v < thresholds.d1.val)
             || (k === 'd7' && v && v < thresholds.d7.val);
    return '<div class="kpi '+st.cls+'"><div class="kpi-label">'+st.lbl+'</div>'
      + '<div class="kpi-val'+(bad?' dn':'')+'">'+(v?fmtPct(v):'—')+'</div>'
      + '<div class="kpi-bottom" style="margin-top:8px">'+(p?deltaHtml(v,p):'')
      + '<span class="kpi-sub">'+(bad?'below target':'cohort-weighted')+'</span></div></div>';
  }).join('')
  + '<div class="kpi co"><div class="kpi-label">D1 Churn</div><div class="kpi-val">'+(d1?fmtPct(d1-100):'—')+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">engagement − 100%</div></div>'
  + '<div class="kpi mg"><div class="kpi-label">D1 → D7 Drop</div><div class="kpi-val">'+((d1&&d7)?fmtPct(d1-d7):'—')+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">points lost in week 1</div></div>'
  + '<div class="kpi am"><div class="kpi-label">D7 → D14 Drop</div><div class="kpi-val">'+((d7&&d14)?fmtPct(d7-d14):'—')+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">points lost in week 2</div></div>'
  + '<div class="kpi lm"><div class="kpi-label">Cohort Size</div><div class="kpi-val'+(cohortSize>99999?' small':'')+'">'+fmtKn(cohortSize)+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">D0 installs in range</div></div>';

  // ── Decay curve ──
  // The full D1-D7 curve lives on the Retention tab, which has no platform
  // column. On a platform view we plot the three points we can attribute.
  if(isSplit || !curR.length){
    const vals = [100, d1 || null, d3 || null, d7 || null, d14 || null];
    makeChart('cvRetCurve','line',{
      labels:['D0','D1','D3','D7','D14'],
      datasets:[{label:'Still active',data:vals,borderColor:cc.cyan,backgroundColor:cc.cyan+'22',fill:true,tension:.35,borderWidth:2,pointRadius:3,spanGaps:true}]
    }, {
      plugins:{tooltip:{callbacks:{label:c=>'  '+c.parsed.y+'% still active'}}},
      scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}},
        y:{grid:{color:cc.grid},min:0,max:100,ticks:{color:cc.text,font:{family:CHART_FONT,size:10},callback:v=>v+'%'}}}
    });
    const churn = [d1, d3, d7, d14].map(v => v ? +(v-100).toFixed(2) : null);
    makeChart('cvRetChurn','bar',{
      labels:['D1','D3','D7','D14'],
      datasets:[{label:'Churn %',data:churn,backgroundColor:cc.coral+'cc',borderColor:cc.coral,borderWidth:1,borderRadius:3}]
    }, {
      plugins:{tooltip:{callbacks:{label:c=>'  '+c.parsed.y+'% churned vs install day'}}},
      scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}},
        y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:10},callback:v=>v+'%'}}}
    });
  } else {
    const keys = RET_DAYS;
    // A day is missing only when NO cohort reported it. avg() returns 0 both for
    // "no rows" and for "every row was 0.00%", so the presence check has to look
    // at the rows themselves — otherwise a real 0% retention day renders as a
    // gap in the curve and drops out of the churn chart entirely.
    const has = k => curR.some(x => x[k] != null && x[k] !== '' && !isNaN(x[k]));
    const dayVal = k => has(k) ? +avg(curR.map(x=>x[k])).toFixed(2) : null;
    const curveVals = [100].concat(keys.map(dayVal));
    makeChart('cvRetCurve','line',{
      labels:['D0'].concat(keys.map(k=>k.toUpperCase())),
      datasets:[{label:'Still active',data:curveVals,borderColor:cc.cyan,backgroundColor:cc.cyan+'22',fill:true,tension:.35,borderWidth:2,pointRadius:3,spanGaps:true}]
    }, {
      plugins:{tooltip:{callbacks:{label:c=>'  '+c.parsed.y+'% still active'}}},
      scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}},
        y:{grid:{color:cc.grid},min:0,max:100,ticks:{color:cc.text,font:{family:CHART_FONT,size:10},callback:v=>v+'%'}}}
    });
    const churn = keys.map(k=>{ const v = dayVal(k); return v==null ? null : +(v-100).toFixed(2); });
    makeChart('cvRetChurn','bar',{
      labels:keys.map(k=>k.toUpperCase()),
      datasets:[{label:'Churn %',data:churn,backgroundColor:cc.coral+'cc',borderColor:cc.coral,borderWidth:1,borderRadius:3}]
    }, {
      plugins:{tooltip:{callbacks:{label:c=>'  '+c.parsed.y+'% churned vs install day'}}},
      scales:{x:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}},
        y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:10},callback:v=>v+'%'}}}
    });
  }

  // ── Cohort heatmap ──
  const hm = g('retHeatmap');
  if(hm){
    const rows = isSplit ? cohorts : curR;
    const keys = isSplit ? ['d1','d7','d14'] : RET_DAYS;
    if(!rows.length){ hm.innerHTML = noData('No retention rows in range'); }
    else {
      const maxV = Math.max.apply(null, rows.map(r=>Math.max.apply(null, keys.map(k=>+r[k]||0))).concat([1]));
      hm.innerHTML = '<div class="hm-grid" style="grid-template-columns:70px repeat('+keys.length+',1fr)">'
        + '<div class="hm-cell hm-hd"></div>'
        + keys.map(k=>'<div class="hm-cell hm-hd">'+k.toUpperCase()+'</div>').join('')
        + rows.slice(-14).map(r=>'<div class="hm-cell hm-lbl">'+r.date.slice(5)+'</div>'
            + keys.map(k=>{
                const v = +r[k];
                if(!v && v!==0) return '<div class="hm-cell hm-na">—</div>';
                const op = Math.min(1, v/maxV);
                // Inverted scale: the strongest retention is the darkest cell.
                const shade = ((1-op)*0.72+0.08).toFixed(2);
                const ink = op < 0.45 ? '#061022' : 'var(--text)';
                return '<div class="hm-cell" style="background:rgba(0,229,255,'+shade+');color:'+ink+'" title="'+r.date+' '+k+': '+v+'%">'+v.toFixed(1)+'</div>';
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
 * D1-D7 + D14 side by side for Android and iOS, from retention.byPlatform.
 * Built on every view, so the split is visible without switching platform.
 * Each bar is the cohort-weighted average across the dates in the window.
 */
function renderRetentionPlatform(d, RET_DAYS, cc){
  const canvas = g('cvRetPlatform');
  if(!canvas) return;
  const byP   = d.retByPlatform || {};
  const badge = g('retPlatBadge');

  const SERIES = [
    { key:'android', label:'Android', color:cc.lime },
    { key:'ios',     label:'iOS',     color:cc.cyan }
  ].filter(s => byP[s.key] && (byP[s.key].curve || []).length);

  if(!SERIES.length){
    wrapEmpty('cvRetPlatform', d.retentionRaw && d.retentionRaw.platformAware === false
      ? 'The Retention tab has no Platform column — add one (Android / iOS) to see the split.'
      : 'No platform-split retention rows in range');
    if(badge) badge.textContent = 'unavailable';
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

  const windows = {};
  SERIES.forEach(s => { windows[s.key] = getWindow(byP[s.key].curve || []); });

  makeChart('cvRetPlatform','bar',{
    labels: RET_DAYS.map(k => k.toUpperCase()),
    datasets: SERIES.map(s => ({
      label: s.label,
      data: RET_DAYS.map(k => wAvg(windows[s.key], k)),
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
    const days = Math.max.apply(null, SERIES.map(s => windows[s.key].length).concat([0]));
    badge.textContent = SERIES.map(s => s.label).join(' · ') + ' · ' + days + ' days';
  }
}

/** Sums a numeric field across rows. */
function sum2(rows, key){ return (rows||[]).reduce((a,r)=>a+(+r[key]||0),0); }

function renderPlaytime(){
  const d = curData(); if(!d.daily) return;
  const cur  = getWindow(d.daily);
  const prev = getPrevWindow(d.daily);
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
    { cls:'mg', lbl:'D0 Playtime',     val:fmtSec(avgD0),   cur:avgD0,  prev:avgNN(prev.map(x=>x.d0Playtime)),   sub:'avg per new user' },
    { cls:'cy', lbl:'Avg Playtime',    val:fmtSec(avgPlay), cur:avgPlay,prev:avgNN(prev.map(x=>x.playtimeAvg)),  sub:'avg per active user' },
    { cls:'lm', lbl:'Session Len D0',  val:fmtSec(avgSess), cur:avgSess,prev:avgNN(prev.map(x=>x.sessionLenD0)), sub:'day-zero sessions' },
    { cls:'vl', lbl:'Avg Session Len', val:fmtSec(avgSessG),cur:avgSessG,prev:avgNN(prev.map(x=>x.avgSessionLen)),sub:'all sessions' },
    { cls:'am', lbl:'Sessions / User', val:spu?spu.toFixed(2):'—', cur:spu, prev:avgNN(prev.map(x=>x.sessionsPerUser)), sub:'per active user' },
    { cls:'cy', lbl:'Total Playtime',  val:fmtKn(totalHrs)+'h', sub:'period hours' },
    { cls:'lm', lbl:'Total Sessions',  val:fmtKn(totalSes), sub:'period count' },
  ];
  g('playKpis').innerHTML = pk.map(k=>
    '<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.lbl+'</div><div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div>'
    + (k.prev!=null ? '<div class="kpi-bottom" style="margin-top:8px">'+deltaHtml(k.cur,k.prev)+'<span class="kpi-sub">'+k.sub+'</span></div>'
                    : '<div class="kpi-sub" style="margin-top:6px">'+k.sub+'</div>')
    + '</div>').join('');

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

  // Ad impressions by cohort day
  const ac = (d.engagement&&d.engagement.adCohort)||[];
  const keys = (d.engagement&&d.engagement.cohortDayKeys)||[];
  if(g('cvPlayAdCohort')){
    if(ac.length && keys.length){
      makeChart('cvPlayAdCohort','line',{
        labels: keys.map(k=>k.replace('day','D')),
        datasets: ac.map((r,i)=>({
          label:r.adType, data:keys.map(k=>r[k]),
          borderColor:[cc.cyan,cc.magenta,cc.lime,cc.amber,cc.violet][i%5],
          backgroundColor:'transparent', tension:.35, borderWidth:2, pointRadius:2
        }))
      }, { plugins:{legend:{display:true,labels:{color:cc.text,font:{family:CHART_FONT,size:10},boxWidth:10}}},
           scales:{x:xAx,y:{grid:{color:cc.grid},ticks:{color:cc.text,font:{family:CHART_FONT,size:9}}}} });
    } else { wrapEmpty('cvPlayAdCohort','No ad cohort rows in range'); }
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

  if(g('playDistWrap')) g('playDistWrap').innerHTML = noData(d.missing.buckets || 'Session length buckets');
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

  g('ftueKpis').innerHTML = [
    { cls:'cy', lbl:'Funnel Base',     val:fmtKn(base),                       sub:'active users in range' },
    { cls:'lm', lbl:'Completion',      val:complete?fmtPct(complete):'—',     sub:'final step engagement' },
    { cls:'co', lbl:'Biggest Drop',    val:biggest?fmtPct(biggest.stepDrop):'—', sub:biggest?biggest.name:'—' },
    { cls:'am', lbl:'10-min Milestone',val:tenPct?fmtPct(tenPct):'—',         sub:'reached 10 minutes' },
  ].map(k=>'<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.lbl+'</div><div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">'+k.sub+'</div></div>').join('');

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

function renderMechanics(){
  const d = curData();
  const reason = (d.missing && d.missing.storeOps) || 'Store Ops events';
  ['mechKpis','mechBarWrap','mechTrendWrap','mechFunnelWrap'].forEach(function(id){
    if(g(id)) g(id).innerHTML = noData(reason);
  });
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

  g('stabKpis').innerHTML = [
    { cls: crashAvg>thresholds.crash.val?'co':'lm', lbl:'Crash Rate', val:crashAvg?crashAvg.toFixed(3)+'%':'—', sub:'limit '+thresholds.crash.val+'%' },
    { cls: anrAvg>thresholds.anr.val?'co':'lm',     lbl:'ANR Rate',   val:anrAvg?anrAvg.toFixed(3)+'%':'—',     sub:'Android only · limit '+thresholds.anr.val+'%' },
    { cls:'cy', lbl:'Crash-Free Users', val:crashFree?crashFree.toFixed(3)+'%':'—', sub:'100 − crash rate' },
    { cls:'vl', lbl:'Days Tracked',     val:new Set(rows.map(r=>r.date)).size, sub:(ios.length?'Android + iOS':'Android only') },
  ].map(k=>'<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.lbl+'</div><div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">'+k.sub+'</div></div>').join('');

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
  const rt = d.ratings || {daily:[],versions:[]};
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

  g('ratingKpis').innerHTML = [
    { cls:'am', lbl:'In-Game Rating', val:overall?overall.toFixed(2):'—', sub:overall?starStr(overall):'awaiting data' },
    { cls:(npsVal && npsVal>=thresholds.nps.val)?'lm':'co', lbl:'NPS', val:npsVal?npsVal.toFixed(0):'—', sub:'target '+thresholds.nps.val },
    { cls:'cy', lbl:'Responses',      val:sm.responses?fmtKn(sm.responses):'—', sub:'surveyed in range' },
    { cls: last>=first?'lm':'co', lbl:'Movement', val:(last&&first)?((last-first)>=0?'+':'')+(last-first).toFixed(2):'—', sub:'first vs last day in range' },
  ].map(k=>'<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.lbl+'</div><div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">'+k.sub+'</div></div>').join('');

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

  // Rating by app version — no source in this sheet, kept for when one lands.
  const vers = (rt.versions || []);
  if(g('cvRatingVersion')){
    if(vers.length){
      makeChart('cvRatingVersion','bar',{
        labels: vers.map(v=>v.version),
        datasets:[{label:'Rating',data:vers.map(v=>v.rating),
          backgroundColor:vers.map(v=>(v.rating>=4?cc.lime:v.rating>=3?cc.amber:cc.coral)+'cc'),
          borderColor:vers.map(v=>v.rating>=4?cc.lime:v.rating>=3?cc.amber:cc.coral),
          borderWidth:1,borderRadius:4}]
      }, {
        indexAxis:'y',
        plugins:{tooltip:{callbacks:{label:c=>'  '+(+c.parsed.x).toFixed(2)+' ★  ('+vers[c.dataIndex].samples+' samples)'}}},
        scales:{x:{grid:{color:cc.grid},min:0,max:5,ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}},
          y:{grid:{display:false},ticks:{color:cc.text,font:{family:CHART_FONT,size:10}}}}
      });
    } else { wrapEmpty('cvRatingVersion','No per-version rating source in this sheet — the Ratings tab has no app version column'); }
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

function renderEconomy(){
  const d = curData();
  const reason = (d.missing && d.missing.economy) || 'Economy events';
  ['econKpis','econSources','econSinks','econFlowWrap','econLevelWrap','econSinkTbl'].forEach(function(id){
    if(g(id)) g(id).innerHTML = noData(reason);
  });
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
  const to = dateTo || sheetToday();
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
  try { renderProgressionMinis(); } catch(e){ console.warn('prog minis', e); }
  try { renderEvents(); }          catch(e){ console.warn('prog events', e); }
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
  progRangeDays = +g('progRange').value || 7;
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

  g('eventsKpis').innerHTML = [
    { cls:'cy', lbl:'Active Players', val:fmtKn(totalActive),        sub:'in progression window' },
    { cls:'mg', lbl:'Median Shop Lvl',val:medLevel!=null?medLevel:'—',sub:'50% of players reach' },
    { cls:'lm', lbl:'Median Day',     val:medDay!=null?medDay:'—',    sub:'50% of players reach' },
    { cls:'am', lbl:'Deepest Level',  val:lvlReach!=null?lvlReach:'—',sub:'highest shop level' },
  ].map(k=>'<div class="kpi '+k.cls+'"><div class="kpi-label">'+k.lbl+'</div><div class="kpi-val'+(String(k.val).length>6?' small':'')+'">'+k.val+'</div><div class="kpi-sub" style="margin-left:0;margin-top:6px">'+k.sub+'</div></div>').join('');

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

  if(g('eventsFirstPurchaseWrap')) g('eventsFirstPurchaseWrap').innerHTML = noData('First purchase price points');
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
  if(!name || !text){ alert('Please fill in name and description.'); return; }
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
  alert('Thresholds saved!');
}

// ═════════════════════════════════════════
// USER MANAGEMENT (admin only)
// ═════════════════════════════════════════

function renderUsers(){
  // Only admin can see this section
  if(!CU || CU.role !== 'admin'){
    g('usersList').innerHTML = '<div class="notice">Admin access required.</div>';
    g('addUserCard').style.display = 'none';
    return;
  }
  g('addUserCard').style.display = '';
  loadUsers();
}

async function loadUsers(){
  // DEMO MODE — show dummy users instead of network call
  g('usersList').innerHTML = '<div class="notice">Loading…</div>';
  const demoUsers = [
    { email:'demo@playspare.com',     name:'Demo Admin',      role:'admin',   games:'*',                 status:'active' },
    { email:'ua.lead@playspare.com',  name:'UA Lead',         role:'manager', games:'mss,mbs',          status:'active' },
    { email:'aso@playspare.com',      name:'ASO Manager',     role:'manager', games:'mss',              status:'active' },
    { email:'analyst@playspare.com',  name:'Data Analyst',    role:'viewer',  games:'*',                 status:'active' },
    { email:'creative@playspare.com', name:'Creative Lead',   role:'viewer',  games:'mss,mcw',          status:'active' },
  ];
  setTimeout(function(){ renderUsersList(demoUsers); }, 250);
}

function renderUsersList(users){
  if(!users.length){ g('usersList').innerHTML = '<div class="notice">No users found.</div>'; return; }
  const roleColor = {admin:'var(--magenta)', manager:'var(--cyan)', viewer:'var(--text3)'};
  g('usersList').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 110px 80px 90px 80px;gap:10px;padding:0 4px 10px;font-family:var(--mono);font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--border);margin-bottom:8px">
      <span>Email / Name</span><span>Role</span><span>Games</span><span>Status</span><span></span>
    </div>
    ${users.map(u => `
    <div style="display:grid;grid-template-columns:1fr 110px 80px 90px 80px;gap:10px;align-items:center;padding:10px 4px;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text)">${u.name || '—'}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--text3)">${u.email}</div>
      </div>
      <div>
        <select onchange="changeRole('${u.email}',this.value)" style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;font-family:var(--mono);font-size:10px;color:${roleColor[u.role]||'var(--text)'};padding:4px 6px;cursor:pointer">
          <option value="viewer"   ${u.role==='viewer'   ?'selected':''}>Viewer</option>
          <option value="manager"  ${u.role==='manager'  ?'selected':''}>Manager</option>
          <option value="admin"    ${u.role==='admin'    ?'selected':''}>Admin</option>
        </select>
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--text2)">${u.games||'*'}</div>
      <div>
        <span style="font-family:var(--mono);font-size:9px;padding:3px 8px;border-radius:10px;background:${u.active?'var(--limeBg)':'var(--coralBg)'};color:${u.active?'var(--lime)':'var(--coral)'}">
          ${u.active ? 'Active' : 'Disabled'}
        </span>
      </div>
      <div style="text-align:right">
        ${u.email !== CU.email ? `<button onclick="removeUser('${u.email}')" style="font-family:var(--mono);font-size:10px;color:var(--coral);background:none;border:none;cursor:pointer;font-weight:600">Remove</button>` : '<span style="font-family:var(--mono);font-size:10px;color:var(--text3)">You</span>'}
      </div>
    </div>`).join('')}
  `;
}

async function addUser(){
  const email  = g('nuEmail').value.trim().toLowerCase();
  const name   = g('nuName').value.trim();
  const pwd    = g('nuPwd').value;
  const role   = g('nuRole').value;
  const games  = g('nuGames').value.trim() || '*';
  const msgEl  = g('addUserMsg');

  if(!email || !pwd){ alert('Email and password required.'); return; }

  // Hash password before sending (same as login)
  const hashed = await hashPwd(pwd);
  const token  = getToken();
  const url = SHEET_API_URL
    + '?action=addUser&key='+encodeURIComponent(SHEET_API_KEY)
    + '&token='+encodeURIComponent(token)
    + '&email='+encodeURIComponent(email)
    + '&name='+encodeURIComponent(name)
    + '&pwd='+encodeURIComponent(hashed)
    + '&role='+encodeURIComponent(role)
    + '&games='+encodeURIComponent(games)
    + '&_cb='+Date.now();

  try {
    const res = await fetch(url, {redirect:'follow'});
    const data = await res.json();
    if(data.error){ alert('Error: '+data.error); return; }
    msgEl.textContent = '✓ User added!'; msgEl.style.display='inline';
    setTimeout(()=>{ msgEl.style.display='none'; }, 3000);
    g('nuEmail').value=''; g('nuName').value=''; g('nuPwd').value='';
    loadUsers();
  } catch(e){ alert('Error: '+e.message); }
}

async function changeRole(email, newRole){
  const token = getToken();
  const url = SHEET_API_URL
    + '?action=updateRole&key='+encodeURIComponent(SHEET_API_KEY)
    + '&token='+encodeURIComponent(token)
    + '&email='+encodeURIComponent(email)
    + '&role='+encodeURIComponent(newRole)
    + '&_cb='+Date.now();
  try {
    const res = await fetch(url, {redirect:'follow'});
    const data = await res.json();
    if(data.error){ alert('Error: '+data.error); return; }
    loadUsers();
  } catch(e){ alert('Error: '+e.message); }
}

async function removeUser(email){
  if(!confirm('Remove user: '+email+'?')) return;
  const token = getToken();
  const url = SHEET_API_URL
    + '?action=removeUser&key='+encodeURIComponent(SHEET_API_KEY)
    + '&token='+encodeURIComponent(token)
    + '&email='+encodeURIComponent(email)
    + '&_cb='+Date.now();
  try {
    const res = await fetch(url, {redirect:'follow'});
    const data = await res.json();
    if(data.error){ alert('Error: '+data.error); return; }
    loadUsers();
  } catch(e){ alert('Error: '+e.message); }
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
        titleFont:{family:'Inter',size:11,weight:'600'},
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

  pane = document.createElement('div');
  pane.className = 'tab-pane report-pane';
  pane.id = 'tab-' + section.id;
  pane.innerHTML =
    '<iframe class="report-frame" title="' + esc_(section.label) + '"' +
    ' src="' + reportUrl(section.report) + '" loading="lazy"></iframe>';
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
  // If requested section isn't enabled for the current game, fall back to overview
  if(!isEnabled(id)) id = 'overview';
  currentTab = id;

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
  g('topTitle').textContent = matched ? matched.label : (SECTION_META[id] && SECTION_META[id].label) || id;

  // A report section draws itself, inside its own page. Nothing to render.
  if(section.report) return;

  // Re-render target tab (refresh charts)
  setTimeout(function(){
    aggregateFtue();
    const fn = SECTION_RENDERS[id];
    if(typeof fn === 'function'){ try{ fn(); }catch(e){ console.error('Render error:', id, e); } }
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

function toggleTheme(){
  const root = document.documentElement;
  const dark = root.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  g('themeLbl').textContent = dark ? 'Dark mode' : 'Light mode';

  /* The reports read localStorage['mss3d_theme'] and follow it, and the hub
     used to be what wrote it. Now that they load inside this page and the hub
     is gone, this is. Without it the shell switches to light and every report
     framed inside it stays dark - which is exactly what happened the moment
     the reports became iframes.

     A storage write does not raise an event in the tab that made it, but it
     does in every OTHER same-origin context, and each report is one. So the
     frames repaint without being told anything else. */
  try { localStorage.setItem('mss3d_theme', next); } catch (e) { /* blocked */ }

  setTimeout(renderAll, 30);
}

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
    if(!g('rangeTo').value) g('rangeTo').value = dateTo || sheetToday();
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
    const n = (d.meta && d.meta.days) || activeRange;
    el.textContent = (dateFrom === dateTo)
      ? 'Single day · ' + dateFrom
      : n + ' days · ' + dateFrom + ' → ' + dateTo;
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
  const before = CU && CU.role;
  CU = {
    username: u.username,
    name: u.name || u.username,
    role: String(u.role || 'viewer').toLowerCase()
  };
  const el = g('unameEl');
  if(el) el.textContent = CU.name;
  if(CU.role !== before) buildNav();
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
  get scopes(){ return SCOPES; },
  meta: SECTION_META,
  applyScope: applyScope,
  reportUrl: reportUrl
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
  toggleTheme,
});
