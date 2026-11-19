/*TAB SWITCHING*/
function switchTab(name, btn) {
  // Targets is admin-only — block viewers even if they reach it programmatically.
  if(name==='targets' && CU?.r!=='admin') return;
  cachedList('tabPanels','.tabPanel').forEach(p=>p.classList.remove('active'));
  cachedList('tabButtons','.tabBtn').forEach(b=>b.classList.remove('active'));
  g('tab-'+name).classList.add('active');
  btn.classList.add('active');
  // Date bar now lives inside the dashboard panel — no manual show/hide needed.
  // CSV / PDF still only relevant on the dashboard tab.
  const isDash = name==='dashboard';
  g('csvBtn').style.display  = isDash ? 'flex' : 'none';
  g('pdfBtn').style.display  = isDash ? 'flex' : 'none';
  if(name==='targets') buildTargetsUI();
  if(name==='ltv')     buildLtvUI();
}


function toggleTheme() {
  isLight=!isLight;
  document.body.classList.toggle('lt',isLight);
  g('themeBtn').textContent = isLight?'🌙 Dark':'☀ Light';
  Object.values(charts).forEach(c=>{ if(c) c.update(); });
  renderProjected(); // re-render gauges with correct params
}

/*DATA LOADING*/
async function loadData(forceRefresh=false) {
  showLoader(true, forceRefresh ? 'Refreshing data…' : 'Loading data…');
  try {
    const isRealURL = SHEET_API_URL &&
                     !SHEET_API_URL.includes('PASTE_YOUR') &&
                     SHEET_API_URL.includes('script.google.com') &&
                     SHEET_API_URL.includes('/exec');
    if(isRealURL) {
      // forceRefresh=true when user clicks Refresh button — bypasses cache
      const refreshParam = forceRefresh ? '&refresh=1' : '';
      const token = getToken();
      if(!token) throw new Error('Session expired — please log in again');
      const url = SHEET_API_URL + '?action=data&token=' + encodeURIComponent(token) + refreshParam;
      const res = await fetch(url, { redirect:'follow', mode:'cors' });
      if(!res.ok) throw new Error('Fetch failed: HTTP ' + res.status);
      const txt = await res.text();
      let json;
      try { json = JSON.parse(txt); }
      catch(pe) { throw new Error('Invalid JSON — check Apps Script deployment'); }
      if(json.error === 'Unauthorized') { clearSession(); throw new Error('Session expired — please log in again'); }
      if(json.error) throw new Error('Apps Script: ' + json.error);
      if(!json.data || !Array.isArray(json.data)) throw new Error('No data array in response');
      rawData = parseJSON(json.data);
      roasData = parseRoasJSON(json.roas || json.roasData || []);
      if(!roasData.length) roasData = await fetchRoasData(token, forceRefresh);
      if(!rawData.length) throw new Error('0 rows — check column names in Apps Script');
      window._fromCache = json._cached || false;
    } else {
      window._fromCache = false;
      rawData = [];
      roasData = [];
      console.warn('No SHEET_API_URL configured — connect your Apps Script /exec URL');
    }
    lastRefresh = new Date();
    updateRefreshInfo();
    populateFilterDropdowns();
    // Compute last available date from sheet data
    const allDates = rawData.map(r=>r.date).filter(Boolean).sort();
    window._dataLastDate = allDates[allDates.length-1] || '';
    // Sync SHARED targets from the server so every user sees the same goals
    // (no-op fallback to the local copy if the backend doesn't support it yet).
    try { const srvT = await fetchTargetsFromServer(); if(srvT){ TARGETS = srvT; saveTargetsStore(); } } catch(e){}
    applyPresetDates(currentPreset);
    const _cs = window._fromCache ? ' ⚡ cached' : ' ✓ fresh';
    toast('Data loaded' + _cs + ' — ' + (window._dataLastDate||''), 'ok');
  } catch(e) {
    rawData = [];
    roasData = [];
    populateFilterDropdowns();
    applyPresetDates(currentPreset);
    toast('No data — ' + e.message,'warn');
  }
  showLoader(false);
}
async function fetchRoasData(token, forceRefresh=false) {
  try {
    const refreshParam = forceRefresh ? '&refresh=1' : '';
    const url = SHEET_API_URL + '?action=roas&token=' + encodeURIComponent(token) + refreshParam;
    const res = await fetch(url, { redirect:'follow', mode:'cors' });
    if(!res.ok) return [];
    const json = JSON.parse(await res.text());
    if(json.error) return [];
    return parseRoasJSON(json.roas || json.roasData || json.data || []);
  } catch(e) {
    return [];
  }
}
function refreshData() {
  loadData(true);                 // force bypass cache (dashboard data)
  if(_ltvLoaded) reloadLtvData(); // keep the LTV tab in sync with the top Refresh
}
function setupAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadData, 60*60*1000);
}
function updateRefreshInfo() {
  if(!lastRefresh) { g('refreshInfo').textContent='—'; return; }
  const m = Math.floor((new Date()-lastRefresh)/60000);
  g('refreshInfo').textContent = m<1?'Just updated':`Updated ${m}m ago`;
}
setInterval(updateRefreshInfo, 30000);

/*CSV PARSE */
function parseCSV(text) {
  const nl = text.includes('\r\n')?'\r\n':'\n';
  const lines = text.trim().split(nl).filter(l=>l.trim());
  if(lines.length<2) return [];
  const H = splitLine(lines[0]).map(h=>h.toLowerCase().trim().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_'));
  const ci = (...keys) => { for(const k of keys){const i=H.findIndex(h=>h.includes(k));if(i>=0)return i;}return -1; };
  const iD=ci('date'), iG=ci('game_name','game','title'), iL=ci('platform','os','channel'),
        iR=ci('revenue','rev','income'), iSp=ci('spend','cost','expense'),
        iPr=ci('profit','gp'), iRo=ci('roi','return');
  return lines.slice(1).map(line=>{
    const c=splitLine(line);
    const raw=idx=>idx>=0?(c[idx]||'').trim().replace(/[$,\s]/g,''):'';
    const num=idx=>{const vv=raw(idx);return vv===''||isNaN(+vv)?null:+vv;};
    const date=raw(iD);
    if(!date||date.toLowerCase()==='date') return null;
    const rev=num(iR)||0, spd=num(iSp)||0;
    let pro=num(iPr); if(pro===null) pro=rev-spd;
    let roi=num(iRo); if(roi===null) roi=spd>0?+(rev/spd).toFixed(4):0;
    return {date:normDate(date),game:raw(iG)||'Unknown',platform:raw(iL)||'Unknown',revenue:rev,spend:spd,profit:pro,roi};
  }).filter(Boolean);
}
function splitLine(l){const r=[];let c='',q=false;for(const ch of l){if(ch==='"'){q=!q;}else if(ch===','&&!q){r.push(c);c='';}else c+=ch;}r.push(c);return r;}
function isoDate(d){
  // Use local date, not UTC — avoids timezone off-by-one
  const yr=d.getFullYear(), mo=String(d.getMonth()+1).padStart(2,'0'), dy=String(d.getDate()).padStart(2,'0');
  return `${yr}-${mo}-${dy}`;
}
function normDate(d){
  if(!d)return'';
  const s=String(d).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  // DD-Mon-YY or DD-Mon-YYYY  e.g. 01-Jan-25
  const m=s.match(/^(\d{1,2})[-\/]([A-Za-z]+)[-\/](\d{2,4})$/);
  if(m){
    const mo={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12}[m[2].toLowerCase().slice(0,3)];
    if(!mo)return s;
    let yr=+m[3]; if(yr<100)yr+=2000;
    return`${yr}-${String(mo).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;
  }
  // DD/MM/YYYY
  const m2=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m2)return`${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  // Mon DD, YYYY or full date string from Apps Script
  const dt=new Date(s);
  if(!isNaN(dt.getTime())){
    // Use local components to avoid timezone shift
    return`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  }
  return s;
}

function parseRoasJSON(rows) {
  if(!Array.isArray(rows) || !rows.length) return [];
  const norm = k=>(k||'').toLowerCase().trim().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_');
  const toNum = v => {
    if(v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[%,$\s]/g,''));
    if(isNaN(n)) return null;
    return n > 10 ? n / 100 : n;
  };
  return rows.map(row => {
    const keys = Object.keys(row || {});
    const get = (...names) => {
      for(const name of names){
        const key = keys.find(k => norm(k).includes(name));
        if(key !== undefined) return row[key];
      }
      return null;
    };
    const date = normDate(get('date','day','install_date','cohort_date'));
    const plat = String(get('platform','plat','os') || '').trim() || 'Unknown';
    const d0 = toNum(get('d0','roas_d0','day0','day_0'));
    const d7 = toNum(get('d7','roas_d7','day7','day_7'));
    if(!date || (d0 === null && d7 === null)) return null;
    return { date, plat, d0, d7 };
  }).filter(Boolean);
}

/* PARSE JSON FROM APPS SCRIPT*/
function parseJSON(rows) {
  if(!Array.isArray(rows)||!rows.length) return [];
  const norm = k=>(k||'').toLowerCase().trim().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_');
  return rows.map(row=>{
    const keys=Object.keys(row);
    const get=(...names)=>{for(const n of names){const k=keys.find(k=>norm(k).includes(n));if(k!==undefined)return row[k];}return null;};
    const toNum=v=>{const n=+(String(v||'').replace(/[$,\s]/g,''));return isNaN(n)?null:n;};
    let dateRaw=get('date');
    // Handle all date formats Apps Script might return
    if(dateRaw instanceof Date){
      dateRaw=`${dateRaw.getFullYear()}-${String(dateRaw.getMonth()+1).padStart(2,'0')}-${String(dateRaw.getDate()).padStart(2,'0')}`;
    } else if(typeof dateRaw==='number'){
      // Excel/Sheets serial date
      const d=new Date(Math.round((dateRaw-25569)*86400000));
      dateRaw=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    } else {
      dateRaw=String(dateRaw||'').trim();
    }
    const date=normDate(dateRaw);
    if(!date||date.toLowerCase()==='date') return null;
    const rev=toNum(get('revenue','rev','income'))||0;
    const spd=toNum(get('spend','cost','expense'))||0;
    // Sheet only has Date,Game,Platform,Revenue,Spend — profit & ROI calculated
    const pro = rev - spd;
    const roi = spd>0 ? +(rev/spd).toFixed(4) : 0;
    return {
      date:date, // already normalized above
      game:String(get('game_name','game','title')||'Unknown'),
      platform:String(get('platform','os','channel')||'Unknown'),
      revenue:rev, spend:spd, profit:pro, roi
    };
  }).filter(Boolean);
}


/*  DATE PRESETS*/
// Yesterday = last valid date (current date excluded)
// yesterday() removed — sheet data already reflects previous day


function applyPreset(btnEl) {
  const preset = btnEl.dataset.preset;
  currentPreset = preset;
  cachedList('presetButtons','.presetBtn').forEach(b=>b.classList.remove('active'));
  btnEl.classList.add('active');
  if(preset!=='custom') applyPresetDates(preset);
}
function onCustomDate() {
  // User manually changed date inputs — switch to custom mode
  currentPreset='custom';
  cachedList('presetButtons','.presetBtn').forEach(b=>b.classList.remove('active'));
  // Cap fTo at yesterday
  const _capYd = new Date(); _capYd.setDate(_capYd.getDate()-1); _capYd.setHours(0,0,0,0);
  const _capStr = isoDate(_capYd);
  const fromEl=g('fFrom'), toEl=g('fTo');
  if(toEl && toEl.value > _capStr) toEl.value = _capStr;
  if(fromEl && fromEl.value > _capStr) fromEl.value = _capStr;
  dateFrom = fromEl.value;
  dateTo   = toEl.value;
  applyFilters();
}
function applyPresetDates(preset) {
  // Use last available data date as "to", not just yesterday
  const _ydBase = new Date(); _ydBase.setDate(_ydBase.getDate()-1); _ydBase.setHours(0,0,0,0);
  const _ydStr2 = isoDate(_ydBase);
  // If data loaded and last date is before yesterday, use data's last date
  const _toStr = (window._dataLastDate && window._dataLastDate < _ydStr2) ? window._dataLastDate : _ydStr2;
  const yd = new Date(_toStr + 'T00:00:00');
  let from, to;
  switch(preset){
    case '7d':
      to=new Date(yd); from=new Date(yd); from.setDate(from.getDate()-6); break;
    case '28d':
      to=new Date(yd); from=new Date(yd); from.setDate(from.getDate()-27); break;
    case 'thisMonth':
      to=new Date(yd); from=new Date(yd.getFullYear(),yd.getMonth(),1); break;
    case 'lastMonth':
      to=new Date(yd.getFullYear(),yd.getMonth(),0);
      from=new Date(to.getFullYear(),to.getMonth(),1); break;
    case 'thisQuarter':
      const qStart=Math.floor(yd.getMonth()/3)*3;
      from=new Date(yd.getFullYear(),qStart,1); to=new Date(yd); break;
    case 'thisYear':
      from=new Date(yd.getFullYear(),0,1); to=new Date(yd); break;
    default: return;
  }
  dateFrom=isoDate(from); dateTo=isoDate(to);
  // Update visible date inputs
  const fromEl=g('fFrom'), toEl=g('fTo');
  if(fromEl) fromEl.value=dateFrom;
  if(toEl)   toEl.value=dateTo;
  applyFilters();
}

/* FILTERS */
function populateFilterDropdowns() {
  const games=[...new Set(rawData.map(r=>r.game))].filter(Boolean).sort();
  const plats=[...new Set(rawData.map(r=>r.platform))].filter(Boolean).sort();
  setOpts('fGame',games); setOpts('fPlat',plats);
  // Populate game trend dropdown
  const sel=g('gameTrendSelect');
  if(sel){const cur=sel.value;sel.innerHTML='<option value="">All Games (Top 6)</option>'+games.map(gm=>`<option value="${escapeAttr(gm)}">${escapeHTML(gm)}</option>`).join('');if(games.includes(cur))sel.value=cur;}
}
function setOpts(id,arr){
  const el=g(id), cur=el.value;
  const label = id==='fGame' ? '🎮 All Games' : id==='fPlat' ? '📱 All Platforms' : 'All';
  el.innerHTML='<option value="">'+label+'</option>'+arr.map(o=>`<option value="${escapeAttr(o)}">${escapeHTML(o)}</option>`).join('');
  if(arr.includes(cur)) el.value=cur;
}

function applyFilters() {
  const gm=g('fGame').value, pl=g('fPlat').value;
  // Cap = last date in data OR yesterday, whichever is earlier
  const _yd = new Date(); _yd.setDate(_yd.getDate()-1); _yd.setHours(0,0,0,0);
  const _ydStr = isoDate(_yd);
  const _cap = (window._dataLastDate && window._dataLastDate < _ydStr) ? window._dataLastDate : _ydStr;
  // dateFrom/dateTo are set by presets or onCustomDate — never read raw input here
  const effectiveTo   = (dateTo && dateTo <= _cap) ? dateTo : _cap;
  const effectiveFrom = dateFrom || '';
  // Keep inputs in sync with actual values
  if(g('fTo'))   g('fTo').value   = effectiveTo;
  if(g('fFrom') && effectiveFrom) g('fFrom').value = effectiveFrom;

  filteredData = rawData.filter(r=>{
    if(!r.date) return false;
    if(effectiveFrom && r.date<effectiveFrom) return false;
    if(r.date>effectiveTo) return false;
    if(gm && r.game!==gm) return false;
    if(pl && r.platform!==pl) return false;
    return true;
  });

  // Previous period (same duration, immediately before)
  if(effectiveFrom && effectiveTo) {
    const days = Math.round((new Date(effectiveTo)-new Date(effectiveFrom))/(1000*86400));
    const prevTo = new Date(effectiveFrom); prevTo.setDate(prevTo.getDate()-1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate()-days);
    const pFrom=isoDate(prevFrom), pTo=isoDate(prevTo);
    prevPeriodData = rawData.filter(r=>{
      if(!r.date) return false;
      if(r.date<pFrom||r.date>pTo) return false;
      if(gm && r.game!==gm) return false;
      if(pl && r.platform!==pl) return false;
      return true;
    });
  } else { prevPeriodData=[]; }

  renderAll();
}

/* RENDER ALL */
