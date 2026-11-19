/* -----------------------------------------------
   LTV TAB
   - Data lives in a different spreadsheet, exposed via
     same Apps Script as ?action=ltv (so auth + URL reuse).
   - Each cohort row has 3 LTV types (Ad / IAP / Total).
   - Default chart/table = D0..D30. Toggle reveals D40/D45/D50.
----------------------------------------------- */
const LTV_DAYS_STD = ['D0','D1','D3','D7','D14','D21','D28','D30'];
const LTV_DAYS_EXT = ['D0','D1','D3','D7','D14','D21','D28','D30','D40','D45','D50'];
// Days that the cumulative-curves chart starts with (other days are
// optional - user toggles them via the chip row). Key milestones default on.
const LTV_DAYS_DEFAULT_VISIBLE = ['D0','D7','D14','D30'];
let   ltvData = null;       // raw rows from Apps Script

// LTV game filter toggle
// Set to true to bring back the per-game dropdown in the LTV bar.
// (Off = all games blended together, no game selector shown.)
const LTV_SHOW_GAME = false;

let   ltvFilters = { type:'Total LTV', game:'', plat:'Android', country:'', from:'', to:'', range:'standard', rangeDays:90 };
let   ltvVisibleDays = new Set(LTV_DAYS_DEFAULT_VISIBLE);
let   ltvPerfDay = 'D28';    // selected day for Performance Trends
let   ltvPerfPeriod = 'daily';
let   ltvLeadSort = { col:'D30', dir:'desc' };
let   ltvShowAll  = false;
let   _ltvLoaded  = false;
// -- LTV forecasting (hybrid: historical scaling -> power-law fallback) --
let   ltvForecastOn     = true;
let   ltvForecastTarget = 'D30';   // 'D28' | 'D30'

// Parse "PS_Android_My Supermarket Simulator" -> { plat:'Android', game:'My Supermarket Simulator' }
function parseAppName(s){
  s = String(s || '').trim();
  // Common shapes: PS_Android_..., PS_iOS_..., PS_IOS_...
  const m = s.match(/^PS_(Android|iOS|IOS|ios|android)_(.*)$/i);
  if(m) return { plat: m[1].toLowerCase()==='android' ? 'Android' : 'iOS', game: m[2].trim() };
  return { plat: '', game: s };
}

// Sheet has an "All" / "All Countries" row that's the team's pre-aggregated
// total (because we deliberately don't pull every country to stay under
// API limits). Treat that row as the dropdown's default "All Countries"
// option - don't surface it as a separate selectable country.
function isAllCountry(s){
  return /^all(\s*countries?)?$/i.test(String(s||'').trim());
}

async function buildLtvUI(){
  // Lazy: fetch once per session, then re-render on filter change.
  if(!_ltvLoaded){
    await loadLtvData();
    populateLtvDropdowns();
    _ltvLoaded = true;
    setLtvDateRange(90); // seed default install-date window (90d) + first render
    return;
  }
  renderLtv();
}

// Force a fresh pull from the sheet - used by the  Refresh button when the
// user has just edited rows in the Google Sheet and the in-memory snapshot
// is stale. Bypasses the _ltvLoaded gate, then re-renders.
async function reloadLtvData(btn){
  const orig = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = '⏳ Refreshing…'; }
  try {
    await loadLtvData();
    populateLtvDropdowns();
    _ltvLoaded = true;
    // If a date preset is active, re-seed it against the new latest date.
    if(ltvFilters.rangeDays){ setLtvDateRange(ltvFilters.rangeDays); } else { renderLtv(); }
    if(btn){ btn.textContent = '✓ Refreshed'; setTimeout(()=>{ btn.textContent = orig; btn.disabled = false; }, 1200); }
  } catch(e){
    if(btn){ btn.textContent = '✗ Failed';   setTimeout(()=>{ btn.textContent = orig; btn.disabled = false; }, 1500); }
  }
}

async function loadLtvData(){
  const isRealURL = SHEET_API_URL && SHEET_API_URL.includes('script.google.com') && SHEET_API_URL.includes('/exec');
  if(!isRealURL){ ltvData = []; return; }
  try {
    const token = getToken();
    if(!token) throw new Error('Not logged in');
    // Cache-buster (_cb) defeats Google's edge cache + browser HTTP cache -
    // without it, newly added rows in the LTV sheet take 5-15 min to appear.
    const url = SHEET_API_URL + '?action=ltv&token=' + encodeURIComponent(token) + '&_cb=' + Date.now();
    const res = await fetch(url, { redirect:'follow', mode:'cors', cache:'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const json = JSON.parse(await res.text());
    if(json.error) throw new Error(json.error);
    ltvData = (json.data || []).map(r => {
      const ap = parseAppName(r.app);
      return {
        installDate: r.installDate,
        app:        r.app,
        game:       ap.game,
        plat:       ap.plat,
        country:    r.country,
        cohortSize: +r.cohortSize || 0,
        type:       r.type,
        days:       r.days || {}
      };
    });
  } catch(e){
    ltvData = [];
    toast('LTV fetch failed - ' + e.message, 'warn');
  }
}

function populateLtvDropdowns(){
  const games = new Set(), plats = new Set(), countries = new Set();
  (ltvData||[]).forEach(r => {
    if(r.game) games.add(r.game);
    if(r.plat) plats.add(r.plat);
    // Skip "All"-like values - those become the default option, not a separate one
    if(r.country && !isAllCountry(r.country)) countries.add(r.country);
  });

  // Game selector - disabled for now (LTV_SHOW_GAME). When off we hide the
  // dropdown and don't filter by game (all games blended). Flip the flag to
  // bring it back as a game-wise dropdown.
  const gameList = [...games].sort();
  const gEl = g('ltvGame');
  if(gEl){
    if(LTV_SHOW_GAME){
      gEl.style.display = '';
      const cur = gEl.value;
      gEl.innerHTML = gameList.map(v=>`<option value="${escapeAttr(v)}"> ${escapeHTML(v)}</option>`).join('');
      gEl.value = gameList.includes(cur) ? cur : (gameList[0] || '');
      ltvFilters.game = gEl.value;
    } else {
      gEl.style.display = 'none';
      gEl.innerHTML = '';
      ltvFilters.game = '';
    }
  }

  // Platform tabs - Android / iOS only, no "All". Default to whichever has data
  // (Android preferred); the buttons themselves are fixed in the markup.
  const pEl = g('ltvPlatToggle');
  if(pEl){
    let cur = ltvFilters.plat;
    if(cur!=='Android' && cur!=='iOS') cur = plats.has('Android') ? 'Android' : (plats.has('iOS') ? 'iOS' : 'Android');
    ltvFilters.plat = cur;
    cachedList('ltvPlatButtons','#ltvPlatToggle button').forEach(b=>b.classList.toggle('on', b.dataset.ltvPlat===cur));
  }

  // Country stays a dropdown with an "All Countries" default.
  const cEl = g('ltvCountry');
  if(cEl){
    const cur = cEl.value;
    cEl.innerHTML = `<option value=""> All Countries</option>` +
      [...countries].sort().map(v=>`<option value="${escapeAttr(v)}">${escapeHTML(v)}</option>`).join('');
    cEl.value = cur;
  }
}

function setLtvType(type, btn){
  ltvFilters.type = type;
  cachedList('ltvTypeButtons','#ltvTypeToggle button').forEach(b=>b.classList.toggle('on', b===btn));
  renderLtv();
}

// Platform tab toggle (replaces the old dropdown). '' = All platforms.
function setLtvPlat(plat, btn){
  ltvFilters.plat = plat;
  cachedList('ltvPlatButtons','#ltvPlatToggle button').forEach(b=>b.classList.toggle('on', b===btn));
  renderLtv();
}

function onLtvGameChange(){
  ltvFilters.game = v('ltvGame');
  renderLtv();
}

// Latest install date present in the data (data runs a day behind) - anchor
// for the install-date range presets so they always cover real cohorts.
function ltvAnchorDate(){
  let mx = '';
  (ltvData||[]).forEach(r => { if(r.installDate && r.installDate > mx) mx = r.installDate; });
  return mx; // 'YYYY-MM-DD' or ''
}

// Install-date range presets. days=0 -> All (clears the window). Default is 45d
// so cohorts old enough to have a mature D30 value are included.
function setLtvDateRange(days){
  ltvFilters.rangeDays = days;
  cachedList('ltvDateButtons','#ltvDateToggle button').forEach(b=>b.classList.toggle('on', +b.dataset.ltvDays===days));
  const fromEl=g('ltvFrom'), toEl=g('ltvTo');
  if(!days){
    if(fromEl) fromEl.value=''; if(toEl) toEl.value='';
  } else {
    const anchor = ltvAnchorDate();
    if(anchor){
      const d = new Date(anchor+'T00:00:00');
      d.setDate(d.getDate() - (days-1));
      const pad=n=>String(n).padStart(2,'0');
      const from = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      if(fromEl) fromEl.value=from; if(toEl) toEl.value=anchor;
    }
  }
  renderLtv();
}

// Manual edit of the From/To inputs -> drop the active preset highlight.
function onLtvDateInput(){
  ltvFilters.rangeDays = null;
  cachedList('ltvDateButtons','#ltvDateToggle button').forEach(b=>b.classList.remove('on'));
  renderLtv();
}

function setLtvRange(range, btn){
  ltvFilters.range = range;
  cachedList('ltvRangeButtons','.ltvDayToggle button').forEach(b=>b.classList.toggle('on', b===btn));
  // Re-seed visible-day set so chips list reflects newly available days.
  // Keep currently-checked defaults that still exist in the active range.
  const allDays = range === 'extended' ? LTV_DAYS_EXT : LTV_DAYS_STD;
  const next = new Set();
  LTV_DAYS_DEFAULT_VISIBLE.forEach(d => { if(allDays.includes(d)) next.add(d); });
  // Preserve user-added days that still belong to the range
  ltvVisibleDays.forEach(d => { if(allDays.includes(d)) next.add(d); });
  ltvVisibleDays = next;
  renderLtv();
}

function toggleLtvDay(day){
  if(ltvVisibleDays.has(day)){
    if(ltvVisibleDays.size === 1) return; // need at least one
    ltvVisibleDays.delete(day);
  } else {
    ltvVisibleDays.add(day);
  }
  renderLtvDayChips();
  getLtvFiltered();
  renderLtvCurve(getLtvComparisonRows());
}

function renderLtvDayChips(){
  const wrap = g('ltvDayChips');
  if(!wrap) return;
  const allDays = ltvFilters.range === 'extended' ? LTV_DAYS_EXT : LTV_DAYS_STD;
  wrap.innerHTML = '<span class="ltvChipLbl">Days on chart</span>'
    + allDays.map(d => {
        const on = ltvVisibleDays.has(d);
        return `<button class="ltvDayChip${on?' on':''}" data-ltv-day="${escapeAttr(d)}">${d}</button>`;
      }).join('');
}

function renderLtvPerfDayDropdown(){
  const sel = g('ltvPerfDay');
  if(!sel) return;
  const allDays = ltvFilters.range === 'extended' ? LTV_DAYS_EXT : LTV_DAYS_STD;
  // If the previously selected day isn't available anymore, fall back to D28.
  if(!allDays.includes(ltvPerfDay)) ltvPerfDay = allDays.includes('D28') ? 'D28' : allDays[0];
  sel.innerHTML = allDays.map(d => `<option value="${d}"${d===ltvPerfDay?' selected':''}>${d.replace('D','Day ')}</option>`).join('');
  // Keep period dropdown in sync with state
  const per = g('ltvPerfPeriod');
  if(per) per.value = ltvPerfPeriod;
}


function getLtvFiltered(){
  // Read inputs each time so manual select changes flow through.
  // Platform now comes from the tab toggle (ltvFilters.plat), not a <select>.
  // Game filter only applies when the selector is enabled (LTV_SHOW_GAME).
  ltvFilters.game    = LTV_SHOW_GAME ? v('ltvGame') : '';
  ltvFilters.country = v('ltvCountry');
  ltvFilters.from    = v('ltvFrom');
  ltvFilters.to      = v('ltvTo');
  return (ltvData||[]).filter(r=>{
    if(r.type !== ltvFilters.type) return false;
    if(ltvFilters.game && r.game !== ltvFilters.game) return false;
    if(ltvFilters.plat && r.plat !== ltvFilters.plat) return false;
    // Country filter: empty selection means "All Countries" -> use the
    // pre-aggregated "All" rows in the sheet (NOT a sum of individual
    // countries, since we only have a subset of countries).
    if(ltvFilters.country){
      if(r.country !== ltvFilters.country) return false;
    } else {
      if(!isAllCountry(r.country)) return false;
    }
    if(ltvFilters.from && r.installDate && r.installDate < ltvFilters.from) return false;
    if(ltvFilters.to   && r.installDate && r.installDate > ltvFilters.to)   return false;
    return true;
  });
}

function getLtvComparisonRows(){
  return (ltvData||[]).filter(r=>{
    if(ltvFilters.game && r.game !== ltvFilters.game) return false;
    if(ltvFilters.plat && r.plat !== ltvFilters.plat) return false;
    if(ltvFilters.country){
      if(r.country !== ltvFilters.country) return false;
    } else {
      if(!isAllCountry(r.country)) return false;
    }
    if(ltvFilters.from && r.installDate && r.installDate < ltvFilters.from) return false;
    if(ltvFilters.to   && r.installDate && r.installDate > ltvFilters.to)   return false;
    return true;
  });
}

function renderLtv(){
  if(!_ltvLoaded){ return; } // not opened yet
  // Sync chip + dropdown UIs with current state regardless of data presence
  renderLtvDayChips();
  renderLtvFcBar();
  renderLtvPerfDayDropdown();
  const rows = getLtvFiltered();
  if(!rows.length){
    g('ltvKpis').innerHTML = '<div class="ltvEmpty" style="grid-column:1/-1">No LTV rows match the current filters.</div>';
    g('ltvHeatmapWrap').innerHTML = '<div class="ltvEmpty">No data.</div>';
    g('ltvLeadTable').innerHTML = '';
    g('ltvShowAllBtn').style.display = 'none';
    if(charts.ltvCurve){ charts.ltvCurve.destroy(); charts.ltvCurve = null; }
    if(charts.ltvFc){    charts.ltvFc.destroy();    charts.ltvFc    = null; }
    if(charts.ltvPerf){  charts.ltvPerf.destroy();  charts.ltvPerf  = null; }
    return;
  }
  const comparisonRows = getLtvComparisonRows();
  renderLtvKpis(rows);
  renderLtvCurve(comparisonRows);
  renderLtvForecastChart(rows);
  renderLtvPerformance(comparisonRows);
  renderLtvHeatmap(rows);
  renderLtvLeaderboard(rows);
}

// Cohort-size weighted mean of a day across rows
function ltvAvg(rows, day){
  let num = 0, den = 0;
  rows.forEach(r=>{
    const val = r.days[day];
    if(val == null || isNaN(val)) return;
    const w = r.cohortSize || 1;
    num += val * w; den += w;
  });
  return den > 0 ? num/den : 0;
}

// Weighted mean of a day + coverage (share of cohort weight that actually has it)
function ltvAvgCov(rows, day){
  let num=0, den=0, tot=0;
  rows.forEach(r=>{
    const w = r.cohortSize || 1; tot += w;
    const val = r.days[day];
    if(val == null || isNaN(val)) return;
    num += val*w; den += w;
  });
  return { val: den>0 ? num/den : null, cov: tot>0 ? den/tot : 0 };
}

const _dnum = d => parseInt(String(d).replace('D',''), 10);

/* -- HYBRID LTV FORECAST ---------------------------------------------
   Primary: "shape from history, level from cohort" - scale the current
   anchor value by the average ratio curve of matured cohorts.
   Fallback: power-law (y = a.x^b) fit on the actual points.
   Returns { actual, forecast (per day), anchor, method, targetVal }. */
function ltvForecastFor(rows, days, target){
  if(!rows || !rows.length) return null;
  const tnum = _dnum(target);
  const list = days.filter(d => _dnum(d) <= tnum);
  const actual = {}, cov = {};
  list.forEach(d => { const a = ltvAvgCov(rows, d); actual[d] = a.val; cov[d] = a.cov; });

  // Anchor = latest day ( target) with solid coverage (50%); else latest with any data
  let anchor = null;
  list.forEach(d => { if(actual[d] != null && cov[d] >= 0.5) anchor = d; });
  if(!anchor) list.forEach(d => { if(actual[d] != null) anchor = d; });
  if(!anchor) return null;
  const aNum = _dnum(anchor), aVal = actual[anchor];

  // Matured cohorts = have both anchor and target actuals
  const matured = rows.filter(r => {
    const va = r.days[anchor], vt = r.days[target];
    return va != null && !isNaN(va) && va > 0 && vt != null && !isNaN(vt);
  });
  const maturedWeight = matured.reduce((s,r)=>s+(r.cohortSize||0), 0);
  const forecast = {}; let method;

  if(matured.length >= 3 && maturedWeight > 0){
    method = 'scaling';
    list.forEach(d => {
      if(_dnum(d) <= aNum){ forecast[d] = actual[d]; return; }
      let num=0, den=0;
      matured.forEach(r => {
        const vd=r.days[d], va=r.days[anchor];
        if(vd==null||va==null||isNaN(vd)||isNaN(va)||va<=0) return;
        const w=r.cohortSize||1; num += (vd/va)*w; den += w;
      });
      forecast[d] = den>0 ? aVal*(num/den) : null;
    });
  } else {
    method = 'curve';
    const pts = [];
    list.forEach(d => { const x=_dnum(d); if(x>=1 && actual[d]!=null && actual[d]>0) pts.push([x, actual[d]]); });
    let a=null, b=null;
    if(pts.length >= 2){
      let sx=0,sy=0,sxx=0,sxy=0, n=pts.length;
      pts.forEach(([x,y])=>{ const lx=Math.log(x), ly=Math.log(y); sx+=lx; sy+=ly; sxx+=lx*lx; sxy+=lx*ly; });
      const denom = n*sxx - sx*sx;
      if(denom !== 0){ b = (n*sxy - sx*sy)/denom; a = Math.exp((sy - b*sx)/n); }
    }
    list.forEach(d => {
      const x=_dnum(d);
      if(x <= aNum){ forecast[d] = actual[d]; return; }
      forecast[d] = (a!=null && b!=null) ? a*Math.pow(x, b) : null;
    });
    // Make the fitted curve continuous at the anchor
    if(a!=null){
      const fa = a*Math.pow(aNum, b);
      if(fa > 0){ const k = aVal/fa; list.forEach(d => { if(_dnum(d) > aNum && forecast[d]!=null) forecast[d] *= k; }); }
    }
  }
  return { actual, forecast, anchor, method, cohorts: matured.length, targetVal: forecast[target] };
}

function renderLtvFcBar(){
  const el = g('ltvFcBar'); if(!el) return;
  el.innerHTML = '<span class="ltvChipLbl">Forecast</span>'
    + `<button class="ltvDayChip${ltvForecastOn?' on':''}" data-ltv-forecast-toggle>${ltvForecastOn?'On':'Off'}</button>`
    + '<span class="ltvChipLbl" style="margin-left:10px">to</span>'
    + ['D28','D30'].map(d => `<button class="ltvDayChip${ltvForecastTarget===d?' on':''}" data-ltv-forecast-target="${escapeAttr(d)}">${d}</button>`).join('')
    + '<span id="ltvFcNote" style="font-size:10px;color:var(--t3);margin-left:12px"></span>';
}
function toggleLtvForecast(){ ltvForecastOn = !ltvForecastOn; renderLtvFcBar(); renderLtv(); }
function setLtvForecastTarget(d){ ltvForecastTarget = d; renderLtvFcBar(); renderLtv(); }

function renderLtvKpis(rows){
  const d7  = ltvAvg(rows, 'D7');
  const d14 = ltvAvg(rows, 'D14');
  const d30 = ltvAvg(rows, 'D30');
  const cohortSum = rows.reduce((a,r)=>a+(r.cohortSize||0), 0);
  // Growth: D7 -> D30
  const growth = d7 > 0 ? ((d30 - d7) / d7 * 100) : 0;
  const grCls  = growth >= 0 ? 'up' : 'dn';
  const grSign = growth >= 0 ? '+' : '';
  // D7 -> D14 sub-growth (shown under D14 tile)
  const gr14   = d7 > 0 ? ((d14 - d7) / d7 * 100) : 0;
  // D14 -> D30 sub-growth (shown under D30 tile)
  const gr30   = d14 > 0 ? ((d30 - d14) / d14 * 100) : 0;
  const fmtUSD = n => '$' + n.toFixed(2);

  // Forecast tile (est. D28/D30) - hybrid engine on the current selection
  let fcTile = '';
  if(ltvForecastOn){
    const fdays = (ltvFilters.range === 'extended' ? LTV_DAYS_EXT : LTV_DAYS_STD);
    const fc = ltvForecastFor(rows, fdays, ltvForecastTarget);
    if(fc && fc.targetVal != null){
      const methodLbl = fc.method === 'scaling' ? `scaling . ${fc.cohorts} cohorts` : 'curve-fit';
      fcTile = kpiTile('lkFc', `Forecast ${ltvForecastTarget} LTV`, fmtUSD(fc.targetVal),
        `<span class="ltvGrowth up">est.</span> from ${fc.anchor} . ${methodLbl}`);
    } else {
      fcTile = kpiTile('lkFc', `Forecast ${ltvForecastTarget} LTV`, '-', 'not enough data');
    }
  }

  g('ltvKpis').innerHTML = ''
    + kpiTile('lkD7',  'Avg D7 LTV',  fmtUSD(d7),  rows.length + ' cohorts')
    + kpiTile('lkD14', 'Avg D14 LTV', fmtUSD(d14), gr14 ? `<span class="ltvGrowth ${gr14>=0?'up':'dn'}">${gr14>=0?'+':''}${gr14.toFixed(1)}% vs D7</span>` : '-')
    + kpiTile('lkD30', 'Avg D30 LTV', fmtUSD(d30), gr30 ? `<span class="ltvGrowth ${gr30>=0?'up':'dn'}">${gr30>=0?'+':''}${gr30.toFixed(1)}% vs D14</span>` : '-')
    + kpiTile('lkGr',  'Growth D7->D30', `${grSign}${growth.toFixed(1)}%`, `<span class="ltvGrowth ${grCls}">${grSign}${(d30-d7).toFixed(2)} added</span>`)
    + kpiTile('lkCo',  'Total Installs', cohortSum.toLocaleString(), 'across ' + rows.length + ' cohorts')
    + fcTile;
}
function kpiTile(cls, label, val, sub){
  return `<div class="ltvKpi ${cls}">
    <div class="kpiLbl">${label}</div>
    <div class="kpiVal">${val}</div>
    <div class="kpiSub">${sub}</div>
  </div>`;
}

function renderLtvCurve(comparisonRows){
  const allDays = ltvFilters.range === 'extended' ? LTV_DAYS_EXT : LTV_DAYS_STD;
  // Only include days the user has toggled ON via the chip row.
  // Falls back to all days if the visible-set is somehow empty.
  let days = allDays.filter(d => ltvVisibleDays.has(d));
  if(!days.length) days = allDays;
  const labels = days.map(d => d.replace('D','Day '));
  // Plot all 3 LTV types side-by-side regardless of selected type filter, so
  // user can compare composition (Ad vs IAP vs Total). Selected type drives
  // tables/KPIs only.
  const allFiltered = comparisonRows || getLtvComparisonRows();
  const byType = { 'Total LTV':[], 'Ad LTV':[], 'IAP LTV':[] };
  allFiltered.forEach(r => { if(byType[r.type]) byType[r.type].push(r); });

  const typeColor = { 'Total LTV':'rgb(0,229,195)', 'Ad LTV':'rgb(255,184,0)', 'IAP LTV':'rgb(77,159,255)' };
  // Actual line is null-aware: where a day has no cohort data the line stops
  // (instead of dropping to $0), so the dashed forecast can take over cleanly.
  const dataset = (label, color, type) => ({
    label,
    data: days.map(d => { const a = ltvAvgCov(byType[type], d); return a.val==null ? null : +a.val.toFixed(2); }),
    borderColor: color,
    backgroundColor: color.replace(')', ',.08)').replace('rgb','rgba'),
    borderWidth: type === ltvFilters.type ? 2.6 : 1.6,
    pointRadius: 3, pointHoverRadius: 5,
    tension: .35, fill: type === ltvFilters.type, spanGaps: false
  });

  const datasets = [
    dataset('Total LTV', typeColor['Total LTV'], 'Total LTV'),
    dataset('Ad LTV',    typeColor['Ad LTV'],    'Ad LTV'),
    dataset('IAP LTV',   typeColor['IAP LTV'],   'IAP LTV')
  ];

  if(charts.ltvCurve) charts.ltvCurve.destroy();
  charts.ltvCurve = new Chart(g('ltvCurveChart').getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ labels:{ color:tc(), font:{family:'Poppins',size:11}, boxWidth:11, padding:14 } },
        tooltip:{
          mode:'index', intersect:false,
          callbacks:{
            title: items => items[0].label,
            label: ctx  => ` ${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales:{
        x:{ ticks:{color:tc(), font:{size:10,family:'Poppins'}}, grid:{color:gc()} },
        y:{ ticks:{color:tc(), font:{family:'DM Mono',size:10}, callback:v=>'$'+v.toFixed(2)}, grid:{color:gc()}, beginAtZero:true }
      }
    }
  });
}

/* -- LTV FORECAST CHART (dedicated card) --
   Selected LTV type only: solid actual up to the anchor, dashed projection
   to the target day (D28/D30). Same hybrid engine as the KPI tile. */
function ltvFcChartOpts(){
  return {
    responsive:true, maintainAspectRatio:false,
    interaction:{ mode:'index', intersect:false },
    plugins:{
      legend:{ labels:{ color:tc(), font:{family:'Poppins',size:11}, boxWidth:11, padding:14 } },
      tooltip:{ mode:'index', intersect:false, callbacks:{
        title: items => items[0].label,
        label: ctx  => ` ${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}`
      } }
    },
    scales:{
      x:{ ticks:{color:tc(), font:{size:10,family:'Poppins'}}, grid:{color:gc()} },
      y:{ ticks:{color:tc(), font:{family:'DM Mono',size:10}, callback:v=>'$'+v.toFixed(2)}, grid:{color:gc()}, beginAtZero:true }
    }
  };
}
function renderLtvForecastChart(rows){
  const canvas = g('ltvFcChart'); if(!canvas) return;
  const fcNote = g('ltvFcNote');
  if(charts.ltvFc){ charts.ltvFc.destroy(); charts.ltvFc = null; }
  if(!ltvForecastOn){
    if(fcNote) fcNote.textContent = 'Forecast off - turn On to project.';
    const cx=canvas.getContext('2d'); cx.clearRect(0,0,canvas.width,canvas.height);
    return;
  }
  const allDays = ltvFilters.range === 'extended' ? LTV_DAYS_EXT : LTV_DAYS_STD;
  const tnum = _dnum(ltvForecastTarget);
  const days = allDays.filter(d => _dnum(d) <= tnum);
  const labels = days.map(d => d.replace('D','Day '));
  const type = ltvFilters.type;
  const col  = type==='Ad LTV' ? 'rgb(255,184,0)' : (type==='IAP LTV' ? 'rgb(77,159,255)' : 'rgb(0,229,195)');

  const fc = ltvForecastFor(rows, days, ltvForecastTarget);
  if(!fc || fc.targetVal == null){
    if(fcNote) fcNote.textContent = 'Not enough data to forecast this selection.';
    charts.ltvFc = new Chart(canvas.getContext('2d'), { type:'line', data:{ labels, datasets:[] }, options: ltvFcChartOpts() });
    return;
  }
  const aNum = _dnum(fc.anchor);
  const actualData = days.map(d => fc.actual[d]!=null ? +fc.actual[d].toFixed(2) : null);
  const fcData     = days.map(d => { const x=_dnum(d); if(x < aNum) return null; return fc.forecast[d]!=null ? +fc.forecast[d].toFixed(2) : null; });

  charts.ltvFc = new Chart(canvas.getContext('2d'), {
    type:'line',
    data:{ labels, datasets:[
      { label: type.replace(' LTV','')+' (actual)', data: actualData, borderColor: col,
        backgroundColor: col.replace(')', ',.12)').replace('rgb','rgba'),
        borderWidth:2.6, pointRadius:3, pointHoverRadius:5, tension:.35, fill:true, spanGaps:false },
      { label: 'Forecast -> '+ltvForecastTarget, data: fcData, borderColor: col, borderDash:[6,5],
        borderWidth:2, pointRadius:2, pointStyle:'rectRot', pointHoverRadius:5, tension:.35, fill:false, spanGaps:true }
    ]},
    options: ltvFcChartOpts()
  });
  if(fcNote) fcNote.textContent = `Est. ${ltvForecastTarget} ${type.replace(' LTV','')}: $${fc.targetVal.toFixed(2)} . ${fc.method==='scaling'?('historical scaling . '+fc.cohorts+' cohorts'):'curve-fit'} from ${fc.anchor}`;
}

/* -- Performance Trends --
   X-axis: install date (or week / month bucket)
   Y-axis: avg LTV at the selected cohort day (D7, D14, D30, ...)
   3 lines: Ad / IAP / Total - selected type drawn bold + filled */
function renderLtvPerformance(comparisonRows){
  // Pull current selections from the controls
  const dayEl = g('ltvPerfDay'), perEl = g('ltvPerfPeriod');
  if(dayEl && dayEl.value) ltvPerfDay = dayEl.value;
  if(perEl && perEl.value) ltvPerfPeriod = perEl.value;

  // Match heatmap/leaderboard scoping: respect game/plat/country/date,
  // but plot all 3 LTV types for comparison (ignore type filter here).
  const allFiltered = comparisonRows || getLtvComparisonRows();

  // Bucket key per period
  const bucketOf = dateStr => {
    if(!dateStr) return '';
    if(ltvPerfPeriod === 'monthly') return dateStr.slice(0,7); // YYYY-MM
    if(ltvPerfPeriod === 'weekly'){
      // ISO-week-ish - just snap to Monday so labels stay readable
      const d = new Date(dateStr + 'T00:00:00');
      if(isNaN(d)) return dateStr;
      const dow = d.getDay() || 7;        // Sun=0 -> 7
      d.setDate(d.getDate() - (dow-1));
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    return dateStr;
  };

  // Aggregate by (type, bucket) -> cohort-size weighted avg of selected day
  const agg = {};   // agg[type][bucket] = {num, den}
  ['Total LTV','Ad LTV','IAP LTV'].forEach(t => agg[t] = {});
  allFiltered.forEach(r => {
    if(!agg[r.type]) return;
    const v = r.days?.[ltvPerfDay];
    if(v == null || isNaN(v)) return;
    const w = r.cohortSize || 1;
    const k = bucketOf(r.installDate);
    if(!k) return;
    if(!agg[r.type][k]) agg[r.type][k] = { num:0, den:0 };
    agg[r.type][k].num += v * w;
    agg[r.type][k].den += w;
  });

  // Union of all buckets across types, sorted ascending
  const buckets = [...new Set(
    Object.values(agg).flatMap(o => Object.keys(o))
  )].sort();

  if(!buckets.length){
    if(charts.ltvPerf){ charts.ltvPerf.destroy(); charts.ltvPerf = null; }
    return;
  }

  const valueFor = (type, b) => {
    const c = agg[type][b];
    return c && c.den > 0 ? +(c.num / c.den).toFixed(2) : null;
  };

  const fmtBucketLbl = b => {
    if(ltvPerfPeriod === 'monthly'){
      const [yr, mo] = b.split('-');
      return MONTHS[(+mo)-1] + " '" + yr.slice(2);
    }
    // daily / weekly -> "16 Mar"
    return fmtLbl(b);
  };

  const dataset = (label, color, type) => ({
    label, data: buckets.map(b => valueFor(type, b)),
    borderColor: color,
    backgroundColor: color.replace(')', ',.10)').replace('rgb','rgba'),
    borderWidth: type === ltvFilters.type ? 2.6 : 1.4,
    pointRadius: type === ltvFilters.type ? 3 : 1.5,
    pointHoverRadius: 5,
    tension: .35,
    fill: type === ltvFilters.type,
    spanGaps: true
  });

  if(charts.ltvPerf) charts.ltvPerf.destroy();
  charts.ltvPerf = new Chart(g('ltvPerfChart').getContext('2d'), {
    type:'line',
    data:{
      labels: buckets.map(fmtBucketLbl),
      datasets:[
        dataset('Total LTV', 'rgb(0,229,195)', 'Total LTV'),
        dataset('Ad LTV',    'rgb(255,184,0)', 'Ad LTV'),
        dataset('IAP LTV',   'rgb(77,159,255)','IAP LTV')
      ]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ labels:{ color:tc(), font:{family:'Poppins',size:11}, boxWidth:11, padding:14 } },
        tooltip:{
          mode:'index', intersect:false,
          callbacks:{
            title: items => `${ltvPerfDay} . ${items[0].label}`,
            label: ctx  => ctx.parsed.y == null ? ` ${ctx.dataset.label}: -` : ` ${ctx.dataset.label}: $${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales:{
        x:{ ticks:{color:tc(), font:{size:10,family:'Poppins'}, maxRotation:45, autoSkip:true, maxTicksLimit:14}, grid:{color:gc()} },
        y:{ ticks:{color:tc(), font:{family:'DM Mono',size:10}, callback:v=>'$'+v.toFixed(2)}, grid:{color:gc()}, beginAtZero:true }
      }
    }
  });
}

function renderLtvHeatmap(rows){
  const days = ltvFilters.range === 'extended' ? LTV_DAYS_EXT : LTV_DAYS_STD;

  // Group by install date - when game/country aren't filtered (or even when
  // they are, but multiple rows still match), collapse them into a single
  // cohort-size weighted row per date. This makes the heatmap a clean
  // time-series view; per-game breakdown lives in the Leaderboard below.
  const byDate = {};
  rows.forEach(r => {
    const dt = r.installDate || '';
    if(!dt) return;
    if(!byDate[dt]) byDate[dt] = {
      installDate: dt,
      cohortSize:  0,
      games:       new Set(),
      countries:   new Set(),
      sum:         {}    // sum[day] = { num, den } for weighted mean
    };
    const grp = byDate[dt];
    grp.cohortSize += (r.cohortSize || 0);
    if(r.game)    grp.games.add(r.game);
    if(r.country) grp.countries.add(r.country);
    const w = r.cohortSize || 1;
    days.forEach(d => {
      const v = r.days?.[d];
      if(v == null || isNaN(v)) return;
      if(!grp.sum[d]) grp.sum[d] = { num: 0, den: 0 };
      grp.sum[d].num += v * w;
      grp.sum[d].den += w;
    });
  });

  const sorted = Object.values(byDate)
    .map(g => {
      const dayVals = {};
      days.forEach(d => {
        dayVals[d] = (g.sum[d] && g.sum[d].den > 0) ? g.sum[d].num / g.sum[d].den : null;
      });
      return {
        installDate: g.installDate,
        cohortSize:  g.cohortSize,
        games:       [...g.games],
        countries:   [...g.countries],
        days:        dayVals
      };
    })
    .sort((a,b) => (a.installDate||'').localeCompare(b.installDate||''));

  // Normalize each column independently so colors compare within a day.
  const colMax = {};
  days.forEach(d => {
    let mx = 0;
    sorted.forEach(r => { const v = r.days[d]; if(v != null && v > mx) mx = v; });
    colMax[d] = mx || 1;
  });

  // Smart label: single name if only one in the group, otherwise count.
  const labelOf = (arr, singularName, pluralName) => {
    if(!arr.length)    return '-';
    if(arr.length===1) return arr[0];
    return arr.length + ' ' + (arr.length===1 ? singularName : pluralName);
  };

  const head = '<thead><tr>'
    + '<th>Install Date</th><th>Coverage</th><th>Cohort</th>'
    + days.map(d => `<th>${d}</th>`).join('')
    + '</tr></thead>';

  const body = '<tbody>' + sorted.map(r => {
    const cells = days.map(d => {
      const val = r.days[d];
      if(val == null || isNaN(val)) return '<td>-</td>';
      const a = Math.min(1, val / colMax[d]) * 0.55;
      return `<td class="hmCell" style="--hmCol:rgba(0,229,195,1);--hmAlpha:${a.toFixed(3)}"><div class="hmFill"></div><span>$${val.toFixed(2)}</span></td>`;
    }).join('');

    const gameLbl    = labelOf(r.games,     'game',    'games');
    const countryLbl = labelOf(r.countries, 'country', 'countries');
    // Tooltip shows the actual list when collapsed (helps debugging without clutter)
    const tip = (r.games.length>1 || r.countries.length>1)
      ? `${r.games.join(', ')}${r.countries.length ? ' - ' + r.countries.join(', ') : ''}`
      : '';

    return `<tr>
      <td>${escapeHTML(r.installDate||'-')}</td>
      <td${tip ? ' title="'+escapeAttr(tip)+'"' : ''}>${escapeHTML(gameLbl)} . ${escapeHTML(countryLbl)}</td>
      <td>${(r.cohortSize||0).toLocaleString()}</td>
      ${cells}
    </tr>`;
  }).join('') + '</tbody>';

  g('ltvHeatmapWrap').innerHTML = '<table class="heatmapTable">' + head + body + '</table>';
}

function renderLtvLeaderboard(rows){
  const days = ltvFilters.range === 'extended' ? LTV_DAYS_EXT : LTV_DAYS_STD;
  // Group by game + plat + country
  const groups = {};
  rows.forEach(r => {
    const k = (r.game||r.app) + '|' + r.plat + '|' + r.country;
    if(!groups[k]){
      groups[k] = { game:r.game||r.app, plat:r.plat, country:r.country, cohortSize:0, days:{} };
      days.forEach(d => groups[k].days[d] = { num:0, den:0 });
    }
    const w = r.cohortSize || 1;
    groups[k].cohortSize += (r.cohortSize||0);
    days.forEach(d => {
      const v = r.days[d];
      if(v != null && !isNaN(v)){
        groups[k].days[d].num += v * w;
        groups[k].days[d].den += w;
      }
    });
  });
  const list = Object.values(groups).map(gp => {
    const out = { game:gp.game, plat:gp.plat, country:gp.country, cohortSize:gp.cohortSize };
    days.forEach(d => { out[d] = gp.days[d].den > 0 ? gp.days[d].num/gp.days[d].den : 0; });
    out.growth = out.D7 > 0 ? ((out.D30 - out.D7)/out.D7*100) : 0;
    return out;
  });

  // Sort
  const sortCol = ltvLeadSort.col, dir = ltvLeadSort.dir==='asc' ? 1 : -1;
  list.sort((a,b) => ((a[sortCol]||0) - (b[sortCol]||0)) * dir
    || (a.game||'').localeCompare(b.game||''));

  // Header
  const cols = ['game','plat','country','cohortSize', ...days, 'growth'];
  const colLabels = { game:'Game', plat:'Platform', country:'Country', cohortSize:'Cohort', growth:'D7->D30' };
  days.forEach(d => colLabels[d] = d);

  const head = '<thead><tr>' + cols.map(c => {
    const isNum = c === 'cohortSize' || c === 'growth' || days.indexOf(c) >= 0;
    const sorted = c === sortCol ? ' sorted' : '';
    const arrow  = c === sortCol ? (dir > 0 ? ' ^' : ' v') : '';
    return `<th class="${isNum?'numCol':''}${sorted}" data-ltv-sort="${escapeAttr(c)}">${colLabels[c]||c}${arrow}</th>`;
  }).join('') + '</tr></thead>';

  const visible = ltvShowAll ? list : list.slice(0, 10);
  const fmt = n => '$' + n.toFixed(2);

  const body = '<tbody>' + visible.map(r => {
    return '<tr>'
      + `<td class="gameName" title="${escapeAttr(r.game||'')}">${r.game ? escapeHTML(r.game) : '-'}</td>`
      + `<td>${r.plat ? escapeHTML(r.plat) : '-'}</td>`
      + `<td>${r.country ? escapeHTML(r.country) : '-'}</td>`
      + `<td class="numCol">${(r.cohortSize||0).toLocaleString()}</td>`
      + days.map(d => `<td class="numCol">${fmt(r[d]||0)}</td>`).join('')
      + `<td class="numCol ${r.growth>=0?'posGr':'negGr'}">${r.growth>=0?'+':''}${r.growth.toFixed(1)}%</td>`
      + '</tr>';
  }).join('') + '</tbody>';

  g('ltvLeadTable').innerHTML = head + body;
  const showBtn = g('ltvShowAllBtn');
  if(list.length > 10){
    showBtn.style.display = 'inline-block';
    showBtn.textContent = ltvShowAll ? 'Show top 10' : `Show all (${list.length})`;
  } else {
    showBtn.style.display = 'none';
  }
}
function setLtvLeadSort(col){
  if(ltvLeadSort.col === col){
    ltvLeadSort.dir = ltvLeadSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    ltvLeadSort.col = col;
    ltvLeadSort.dir = (col === 'game' || col === 'plat' || col === 'country') ? 'asc' : 'desc';
  }
  renderLtv();
}
function toggleLtvShowAll(){ ltvShowAll = !ltvShowAll; renderLtv(); }
