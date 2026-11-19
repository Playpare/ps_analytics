/* ═══════════════════════════════════════════════
   UTILS — DEFINED FIRST
═══════════════════════════════════════════════ */
const domCache = Object.create(null);
function g(id) {
  const cached = domCache[id];
  if(cached && cached.isConnected) return cached;
  const el = document.getElementById(id);
  if(el) domCache[id] = el;
  else delete domCache[id];
  return el;
}
const v  = id => {
  const el = g(id);
  return el ? el.value.trim() : '';
};
const fm  = n => '$' + Math.abs(Math.round(n)).toLocaleString();
const fmK = n => { const a=Math.abs(n); return(n<0?'-':'')+(a>=1e6?'$'+(a/1e6).toFixed(2)+'M':a>=1e3?'$'+(a/1e3).toFixed(1)+'K':'$'+Math.round(a)); };
// Full number with commas — for KPI cards
const fmFull = n => { const neg=n<0; const a=Math.abs(Math.round(n)); return(neg?'-':'')+'$'+a.toLocaleString(); };
const fr2 = n => (+n).toFixed(2);
const gc  = () => isLight ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.055)';
const tc  = () => isLight ? '#4d6080' : '#7a8fad';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const staticDom = {
  tabPanels: [],
  tabButtons: [],
  presetButtons: [],
  qPills: []
};
function cacheStaticDom() {
  staticDom.tabPanels = Array.from(document.querySelectorAll('.tabPanel'));
  staticDom.tabButtons = Array.from(document.querySelectorAll('.tabBtn'));
  staticDom.presetButtons = Array.from(document.querySelectorAll('.presetBtn'));
  staticDom.qPills = Array.from(document.querySelectorAll('.qPill'));
}
function cachedList(name, selector) {
  return staticDom[name]?.length ? staticDom[name] : Array.from(document.querySelectorAll(selector));
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}
const escapeAttr = escapeHTML;

/* ═══════════════════════════════════════════════
   CONFIG — the endpoint arrives on the URL, as ?api=
   ───────────────────────────────────────────────
   It is no longer written here, for two reasons, and the second is the one
   that matters:

   1. This repository is public. A literal here publishes the deployment to
      anyone who opens the file. Pulse keeps every /exec in a VITE_API_*
      build variable for exactly that reason, and its deploy workflow fails
      the build when one is unset.

   2. The Pulse shell is what knows which backend a section belongs to. It
      builds this iframe's URL in reportUrl() and appends ?api=. A page that
      carried its own endpoint would be a second place to edit on every
      redeployment - and the two would eventually disagree, silently, with
      the stale one still answering.

   Opened with no ?api= there is deliberately nothing to fall back to. Say so
   once, plainly, instead of letting every panel fail on its own with
   "could not reach the web app".
═══════════════════════════════════════════════ */
const QS = new URLSearchParams(location.search);
const SHEET_API_URL = QS.get('api') || '';
if (!SHEET_API_URL) {
  console.error('Executive Dashboard: no ?api= endpoint on the URL. '
    + 'Open this section from Playspare Pulse, which supplies it.');
}

function ensureChartFallback() {
  if(window.Chart) return;
  console.warn('Chart.js did not load. Charts will be skipped until the library is available.');
  window.Chart = class MissingChart {
    static register() {}
    constructor() {
      this.data = { labels: [], datasets: [] };
      this.options = {};
      this._missingLibrary = true;
    }
    destroy() {}
    update() {}
  };
  window.Chart.__missingLibrary = true;
}
ensureChartFallback();

/* ═══════════════════════════════════════════════
   AUTH IS NOT IN THIS FILE ANY MORE
   ───────────────────────────────────────────────
   What stood here - the SHA-256 password hasher, the 8-hour session record
   under 'ed_session', the lockout counters keyed by btoa(email), and
   createSession/getSession/getToken/clearSession - all of it belonged to a
   sign-in this page no longer performs.

   js/session.js has what is left: reading the token Playspare Pulse issued.
   Nothing here hashes a password or counts a failed attempt, because nothing
   here is asked for a password.

   getSession() and getToken() still exist, with the same shape and the same
   names, so every caller below and in dashboard.js, ltv.js and targets.js is
   unchanged. They just read a different session now.
═══════════════════════════════════════════════ */

/* Every request to the backend. The token travels on each one; the backend
   verifies its HMAC signature, which is the only place that check can
   honestly happen. */
async function apiFetch(params) {
  // file:// protocol cannot make cross-origin requests
  if(location.protocol === 'file:') {
    throw new Error('FILE_PROTOCOL');
  }
  const qs  = Object.entries(params).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');
  const url = SHEET_API_URL + '?' + qs;
  try {
    const res = await fetch(url, { redirect:'follow', mode:'cors' });
    const txt = await res.text();
    try { return JSON.parse(txt); }
    catch(e) { throw new Error('Invalid JSON from server'); }
  } catch(err) {
    if(err.message === 'FILE_PROTOCOL') throw err;
    throw new Error('NETWORK_ERROR');
  }
}


/* ═══════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════ */
let CU=null, isLight=false;
let rawData=[], filteredData=[], prevPeriodData=[], roasData=[];
let refreshTimer=null, lastRefresh=null;
let charts={};
let currentPreset='28d';
let dateFrom='', dateTo='';
let gaugeState={q:0,a:0};
// Initialize lastDate to yesterday so presets work before data loads
window._dataLastDate = (()=>{const d=new Date();d.setDate(d.getDate()-1);d.setHours(0,0,0,0);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;})();

// ── Data reference "today" ──
// Our pipeline is always a day behind: yesterday is the latest complete day of
// data. So every "current month / current day" HIGHLIGHT must use YESTERDAY,
// not the wall-clock date — otherwise on the 1st of a month the projection +
// monthly table jump to the new month before any data for it exists. This keeps
// the month projection, the monthly table's current-row, and "days left" all
// aligned with the data (1-day shift).
function dataNow(){ const d=new Date(); d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return d; }


/* ═══════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════ */
function showLoader(on,txt='Loading…'){
  const loader=g('loader'), loaderTxt=g('loaderTxt');
  loader.classList.toggle('on',on);
  if(txt) loaderTxt.textContent=txt;
}
let toastT=null;
function toast(msg,type='ok'){
  const el=g('toast');el.textContent=msg;
  el.className='toast '+({ok:'tOk',warn:'tWarn',err:'tErr'}[type]||'tOk')+' on';
  clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('on'),3500);
}
function fmtLbl(d){if(!d)return'';const dt=new Date(d+'T00:00:00');return isNaN(dt)?d:dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});}
