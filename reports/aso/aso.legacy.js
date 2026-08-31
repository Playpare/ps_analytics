/* eslint-disable */
/* --- from aso_report.html · block c8fbc38c32 --- */
/* ==========================================================================
   API CONNECTION

   Point this at the Apps Script web app /exec URL from aso_dashboard.gs. Both
   values can also be supplied on the query string, which is what a hub iframe
   would do:
       aso_report.html?api=https://script.google.com/.../exec&token=XXXX
   ========================================================================== */
const API_DEFAULTS = {
  url:   'PASTE_ASO_EXEC_URL',
  token: ''
};
const QS = new URLSearchParams(location.search);
const API = {
  url:   QS.get('api')   || API_DEFAULTS.url,
  token: QS.get('token') || API_DEFAULTS.token
};

/* ==========================================================================
   HUB SESSION

   The hub signs in once against the UA project and stores one HMAC-signed
   token that every project validates locally. This report reads that token on
   each request rather than caching it, so a sign-out in the hub takes effect
   here on the very next call instead of one report behind.

   Opened directly, outside the hub, ?token= still works - useful for testing
   a deployment before wiring it into the nav.
   ========================================================================== */
const TOKEN_KEY = 'mss3d_token';

function sessionToken(){
  try{ const t = sessionStorage.getItem(TOKEN_KEY); if(t) return t; }catch(e){}
  return API.token || '';
}

/* Same-origin messages the hub already listens for. */
function tellHub(type){
  try{ if(window.parent && window.parent !== window) window.parent.postMessage({type:type}, location.origin); }
  catch(e){}
}

/* ==========================================================================
   PERFORMANCE BUDGET

   Three things keep this fast on a sheet with tens of thousands of reviews:

   1. WINDOWED FETCH. The first request asks for 30 days of core data and
      renders the default seven-day view from it. Seven-day reviews follow,
      then 45 days of core data is prefetched in the background.

   2. LAZY VIEWS. A view renders the first time it is opened, not on load.
      Opening the dashboard builds one page of charts instead of five, and
      switching tabs later is instant because each view renders once and is
      then marked clean.

   3. WINDOWED REVIEW TABLE. Review rows are appended a page at a time rather
      than written in one enormous innerHTML. Filtering 40,000 reviews stays
      responsive because only the first PAGE of the result is ever in the DOM.

   Plus a localStorage copy of the core payload, shown immediately on a repeat
   visit while the network request is still in flight.
   ========================================================================== */
const PERF = {
  reviewPage:   50,       // initial rows and each View More increment
  lsKey:        'aso_core_30d_v8',
  /* lsKey is kept only so evictLegacy can find and remove the old
     localStorage entry. Nothing writes to it any more. lsMaxChars is gone:
     IndexedDB has no ceiling worth guarding against. */
  staleAfterMs: 6 * 60 * 60 * 1000,

  /* The browser keeps 30 days locally and prefetches 45 days into memory. */
  firstWindowDays: 30,
  backgroundWindowDays: 45
};

/* Payload blocks, populated by connect(). Null until the first load lands. */
let A = null;             // android
let I = null;             // ios
let ADATES = [], IDATES = [];
let DATE_FILTER='d7', SINGLE_DATE='', RANGE_START='', RANGE_END='';
let LAST_META = { generatedAt: null, warnings: [] };
let REVIEWS_READY = { android: false, ios: false };

/* The dashboard's own today, as reported by Apps Script in the spreadsheet's
   timezone. Anchoring on this rather than the browser clock means a viewer in
   Karachi and a viewer in London are shown the same reporting week - and that
   the week rolls over when the sheet's day rolls over, not the laptop's. */
let SERVER_TODAY = '';

/* True while the payload on screen only covers the opening window. Full
   history has not arrived yet, so wider filters would under-report. */
let PARTIAL = true;
let FULL_RANGE = null;   // {start, end} across all data, even while trimmed
let CORE_WINDOW = null;  // date coverage currently held in A / I
let REVIEW_WINDOW = null;
let REVIEW_LOADING = null;

const COLORS={blue:'#4d9fff',teal:'#00e5c3',pink:'#ec0a9b',line:'#a6b8d4',green:'#00c47a',amber:'#ffb800',coral:'#ff4d6d'};
const SOURCE_COLORS=['#00e5c3','#ec0a9b','#4d9fff','#ffb800','#00c47a','#ff4d6d','#9b6cff','#ff7a45','#42d3ff','#d4e157','#f06292','#26a69a'];
function sourceColorMap(sources){
  const map={};(sources||[]).slice().sort().forEach((s,i)=>map[s]=SOURCE_COLORS[i%SOURCE_COLORS.length]);return map;
}
function sourceRgb(hex){
  const h=String(hex||'').replace('#','');
  return h.length===6?[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]:[77,159,255];
}
function sourceMetricCell(value,max,color,fmt){
  const rgb=sourceRgb(color),ratio=max>0?Math.max(0,Math.min(1,(value||0)/max)):0;
  const alpha=(.07+ratio*.30).toFixed(3);
  return {v:fmt(value),bg:'background:rgba('+rgb.join(',')+','+alpha+')'};
}
const RAMP={coral:'255,77,109',teal:'0,229,195',blue:'77,159,255',amber:'255,184,0',pink:'236,10,155',green:'0,196,122'};
const charts={};
const $=id=>document.getElementById(id);
const cssVar=(n,f)=>{const v=getComputedStyle(document.body).getPropertyValue(n).trim();return v||f};
const nf=(v,dg)=>(v===null||v===undefined||isNaN(v))?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:dg,maximumFractionDigits:dg});
const pc=(v,dg)=>(v===null||v===undefined||isNaN(v))?'—':nf(v,dg===undefined?2:dg)+'%';
const compact=v=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(v||0);
const nn=a=>(a||[]).filter(v=>v!==null&&v!==undefined&&!isNaN(v));
const sum=a=>nn(a).reduce((s,v)=>s+v,0);
const mean=a=>{const v=nn(a);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null};
const minOf=a=>{const v=nn(a);return v.length?Math.min(...v):null};
const maxOf=a=>{const v=nn(a);return v.length?Math.max(...v):null};
const chg=(a,b)=>a?(b-a)/a*100:0;
const arrow=v=>(v>0?'▲ ':'▼ ')+nf(Math.abs(v),Math.abs(v)<0.1?3:1)+'%';
const esc=s=>String(s===null||s===undefined?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const p2=v=>pc(v,2), p3=v=>pc(v,3);
const n0=v=>nf(v,0), n1=v=>nf(v,1), n2=v=>nf(v,2), n3=v=>nf(v,3), cp=v=>compact(v);

/* "2026-06-27" -> "Jun 27"  (parsed by hand so the label never shifts a day) */
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function shortDate(iso){
  if(!iso)return '—';
  const m=String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?MONTHS[+m[2]-1]+' '+(+m[3]):String(iso);
}

function localISO(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
/* Date maths in plain yyyy-mm-dd, done in UTC so it can never drift a day.
   Building a local Date from an ISO string and reading it back is the classic
   source of off-by-one windows in a dashboard viewed from another timezone. */
function addDays(iso,n){
  const p=String(iso).split('-');
  const d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));
  d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}
function dowOf(iso){
  const p=String(iso).split('-');
  return new Date(Date.UTC(+p[0],+p[1]-1,+p[2])).getUTCDay();   // 0 = Sunday
}
function todayIso(){ return SERVER_TODAY || localISO(new Date()); }

function activeDateRange(){
  const today=todayIso();
  if(DATE_FILTER==='single')return {start:SINGLE_DATE,end:SINGLE_DATE};
  if(DATE_FILTER==='custom')return {start:RANGE_START,end:RANGE_END};
  if(DATE_FILTER==='today')return {start:today,end:today};
  /* Rolling windows always end on the most recently completed Sunday, so a
     reporting period is stable all week and rolls forward every Monday - the
     same morning the loader brings in the new week.

       viewed Wed 5 Aug 2026  -> anchor Sun 2 Aug -> Last 7 days = 27 Jul - 2 Aug
       viewed Mon 10 Aug 2026 -> anchor Sun 9 Aug -> Last 7 days = 3 Aug - 9 Aug

     On Sunday itself that day is not yet complete, so the anchor stays on the
     Sunday before it rather than jumping early. */
  const dow=dowOf(today);
  const end=addDays(today,-(dow===0?7:dow));
  const days={today:1,d7:7,d14:14,d30:30,d45:45}[DATE_FILTER]||7;
  return {start:addDays(end,-(days-1)),end:end};
}
function rollingWindow(days){
  const today=todayIso(),dow=dowOf(today),end=addDays(today,-(dow===0?7:dow));
  return {start:addDays(end,-(days-1)),end:end};
}
function rangeContains(outer,inner){
  return !!(outer&&inner&&outer.start&&outer.end&&inner.start&&inner.end&&
    outer.start<=inner.start&&outer.end>=inner.end);
}
function rangeDayCount(r){
  if(!r||!r.start||!r.end)return 0;
  return Math.round((new Date(r.end+'T00:00:00Z')-new Date(r.start+'T00:00:00Z'))/86400000)+1;
}
function dateAllowed(iso){
  if(!iso)return false;
  const r=activeDateRange();return (!r.start||iso>=r.start)&&(!r.end||iso<=r.end);
}
function activeDateLabel(){const r=activeDateRange();return r.start===r.end?shortDate(r.start):shortDate(r.start)+' – '+shortDate(r.end)}
function setDateChip(id){
  const el=$(id);if(!el)return;
  const span=el.querySelector('.date-span');
  if(span)span.textContent=activeDateLabel();else el.textContent=activeDateLabel();
}
async function applyDateFilter(){
  ADATES=collectDates(A);IDATES=collectDates(I);
  /* A new dashboard period gets its own newest review date by default. */
  RVF.from='';RVF.to='';RVSHOWN=PERF.reviewPage;
  syncDateControls();
  loaderMsg('Loading Data');
  $('loader').classList.add('show');
  setStatus('Loading…');

  const wanted=activeDateRange();
  /* Android/iOS review cards use the same row-level review data as the Reviews
     page for sentiment and themes. Keep the current render in place until all
     data for the new filter is ready, then swap every view atomically. */
  const pending=[];
  if(!rangeContains(CORE_WINDOW,wanted)&&!CONNECTING)pending.push(fetchWindowIfNeeded());
  pending.push(ensureReviewsForRange(wanted));
  try{ await Promise.all(pending); }
  catch(e){ console.error('date-filter data fetch failed',e); }
  finally{
    destroyAll();markDirty();ensureRendered(ACTIVE);prefetchViews();
    $('loader').classList.remove('show');
    setStatus('Loaded');
  }
}

async function fetchWindowIfNeeded(){
  const win=activeDateRange();
  if(!win.start||!win.end)return;
  try{
    const j=await fetchPart('core',false,win);
    applyCore(j);ensureRendered(ACTIVE);prefetchViews();
  }catch(e){ console.error('window fetch failed',e); }
}
function syncDateControls(){
  document.querySelectorAll('.date-controls').forEach(box=>{
    box.classList.toggle('single',DATE_FILTER==='single');box.classList.toggle('custom',DATE_FILTER==='custom');
    box.querySelector('select').value=DATE_FILTER;
    box.querySelector('.single-date').value=SINGLE_DATE;
    box.querySelector('.range-start').value=RANGE_START;box.querySelector('.range-end').value=RANGE_END;
    box.querySelector('.date-span').textContent=activeDateLabel();
  });
}
function initDateFilters(){
  /* Prefer the server's fullRange. While the opening seven-day window is on
     screen the payload itself only spans a week, and seeding the pickers from
     it would silently cap Custom date at seven days. */
  const dates=[...collectDatesUnfiltered(A),...collectDatesUnfiltered(I)].sort();
  const min=(FULL_RANGE&&FULL_RANGE.start)||dates[0]||'';
  const max=(FULL_RANGE&&FULL_RANGE.end)||dates[dates.length-1]||todayIso();
  if(!SINGLE_DATE)SINGLE_DATE=max;if(!RANGE_START)RANGE_START=min;if(!RANGE_END)RANGE_END=max;
  document.querySelectorAll('.sh > .date').forEach(el=>{
    const box=document.createElement('div');box.className='date-controls';box.id=el.id;
    box.innerHTML='<span class="date-span"></span><select class="date" aria-label="Date filter">'+
      '<option value="d7">Last 7 days</option><option value="d14">Last 14 days</option><option value="today">Today</option>'+ 
      '<option value="d30">Last 30 days</option><option value="d45">Last 45 days</option><option value="single">Single date</option><option value="custom">Custom date</option>'+ 
      '</select><input class="single-date" type="date" aria-label="Date"><input class="range-date range-start" type="date" aria-label="From date">'+
      '<input class="range-date range-end" type="date" aria-label="To date"><button type="button" class="date-confirm">Apply</button>';
    el.replaceWith(box);
    const sel=box.querySelector('select'),single=box.querySelector('.single-date'),from=box.querySelector('.range-start'),to=box.querySelector('.range-end');
    sel.onchange=()=>{DATE_FILTER=sel.value;syncDateControls();if(DATE_FILTER!=='single'&&DATE_FILTER!=='custom')applyDateFilter()};
    box.querySelector('button').onclick=()=>{
      SINGLE_DATE=single.value;RANGE_START=from.value;RANGE_END=to.value;
      if(DATE_FILTER==='custom'&&RANGE_START>RANGE_END){const t=RANGE_START;RANGE_START=RANGE_END;RANGE_END=t}
      applyDateFilter();
    };
  });
  syncDateControls();
}

/* ==========================================================================
   KPI CARD BUILDERS
   ========================================================================== */
function kpiSingle(o){
  return '<div class="kpi a-'+o.accent+'"><div class="l">'+o.label+'</div>'+
    '<div class="v'+(o.tone?' '+o.tone:'')+'">'+o.value+'</div>'+
    (o.sub?'<div class="d mut">'+o.sub+'</div>':'')+(o.note?'<div class="p">'+o.note+'</div>':'')+'</div>';
}
/* value with a day-over-day delta underneath */
function kpiDelta(o){
  let d='';
  if(o.prev!==null&&o.prev!==undefined&&o.curr!==null&&o.curr!==undefined&&o.prev!==0){
    const c=chg(o.prev,o.curr), good=(o.lower? c<=0 : c>=0);
    d='<div class="d'+(good?'':' neg')+'">'+arrow(c)+' vs prev day</div>';
  }else if(o.sub){ d='<div class="d mut">'+o.sub+'</div>'; }
  return '<div class="kpi a-'+o.accent+'"><div class="l">'+o.label+'</div>'+
    '<div class="v'+(o.tone?' '+o.tone:'')+'">'+o.value+'</div>'+d+
    (o.note?'<div class="p">'+o.note+'</div>':'')+'</div>';
}
/**
 * Android beside iOS.
 *
 * The better of the two is highlighted rather than shown as a percentage gap:
 * "iOS is 34% better on negative share" invites a comparison the two stores do
 * not really support, whereas marking the leader answers the question the card
 * is actually for. `lower` flips which side wins for metrics where less is more.
 */
function kpiCompare(o){
  const a=o.a, b=o.b, f=o.fmt||n2;
  const has=v=>v!==null&&v!==undefined&&!isNaN(v);
  let aWin=false,bWin=false;
  if(has(a)&&has(b)&&a!==b){ const aBetter=o.lower? a<b : a>b; aWin=aBetter; bWin=!aBetter; }
  return '<div class="kpi a-'+o.accent+'"><div class="l">'+o.label+'</div>'+
    '<div class="duo">'+
      '<div class="wcol"><span class="wl"><i style="background:'+COLORS.green+'"></i>Android</span>'+
        '<span class="wv big'+(aWin?' win':'')+'">'+(has(a)?f(a):'—')+'</span></div>'+
      '<span class="sep vs">vs</span>'+
      '<div class="wcol"><span class="wl"><i style="background:'+COLORS.blue+'"></i>IOS</span>'+
        '<span class="wv big'+(bWin?' win':'')+'">'+(has(b)?f(b):'—')+'</span></div>'+
    '</div>'+
    (o.sub?'<div class="d mut">'+o.sub+'</div>':'')+
    (o.note?'<div class="p">'+o.note+'</div>':'')+'</div>';
}
const row=(host,cards)=>{if($(host))$(host).innerHTML=cards.join('')};

/* ==========================================================================
   CHARTS

   Every builder takes its own `dates` array. The two platforms cover different
   day ranges - iOS is typed in by hand and usually lags - so nothing here may
   assume a single shared x-axis.
   ========================================================================== */
Chart.defaults.font.family='Poppins';
Chart.defaults.font.size=11;
Chart.defaults.font.weight='500';
Chart.defaults.color='#c0ccdf';
Chart.defaults.plugins.legend.labels.font={family:'Poppins',size:12.5,weight:'400'};

/* Chart.js label padding only spaces legend items from each other. This
   reserves a gap below the legend so it does not crowd the top y-axis tick. */
const legendAxisGap={
  id:'legendAxisGap',
  beforeUpdate(chart){
    if(!chart.legend||chart.legend._axisGapApplied)return;
    const fit=chart.legend.fit;
    chart.legend.fit=function(){ fit.call(this); if(this.options.display!==false)this.height+=14; };
    chart.legend._axisGapApplied=true;
  }
};
Chart.register(legendAxisGap);

function destroy(id){if(charts[id]){try{charts[id].destroy()}catch(e){}delete charts[id]}}
function destroyAll(){Object.keys(charts).forEach(destroy)}

function baseX(dates){
  const grid=cssVar('--border','rgba(255,255,255,.08)'), tick=cssVar('--t2','#a6b8d4');
  return {maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    animation:{duration:dates.length>60?0:420},
    plugins:{legend:{position:'top',align:'start',labels:{color:tick,boxWidth:11,boxHeight:11,padding:12}},
      tooltip:{backgroundColor:cssVar('--card2','#070809'),borderColor:cssVar('--borderB','rgba(255,255,255,.14)'),borderWidth:1,
        titleColor:cssVar('--t1','#edf2ff'),bodyColor:tick,padding:10,cornerRadius:8,
        callbacks:{title:it=>shortDate(dates[it[0].dataIndex])}}},
    scales:{x:{ticks:{color:tick,autoSkip:dates.length>18,maxRotation:0},grid:{color:grid}},
            y:{ticks:{color:tick},grid:{color:grid}}}};
}
const labelsOf=dates=>dates.map(shortDate);

function lineX(id,dates,ds,yOpts,extra){
  destroy(id); if(!$(id))return;
  const o=baseX(dates); Object.assign(o.scales.y,yOpts||{});
  if(extra)Object.assign(o.scales,extra);
  charts[id]=new Chart($(id),{type:'line',data:{labels:labelsOf(dates),datasets:ds},options:o});
}
function mixedX(id,dates,ds,yOpts,extra){
  destroy(id); if(!$(id))return;
  const o=baseX(dates); Object.assign(o.scales.y,yOpts||{});
  if(extra)Object.assign(o.scales,extra);
  charts[id]=new Chart($(id),{type:'bar',data:{labels:labelsOf(dates),datasets:ds},options:o});
}
/* horizontal ranked bars — themes, devices, builds, per-source CVR */
function hbar(id,labels,datasets,fmt,stacked){
  destroy(id); if(!$(id))return;
  const grid=cssVar('--border','rgba(255,255,255,.08)'), tick=cssVar('--t2','#a6b8d4');
  charts[id]=new Chart($(id),{type:'bar',
    data:{labels,datasets},
    options:{indexAxis:'y',maintainAspectRatio:false,animation:{duration:420},
      /* Index + non-intersect selected a nearby row/segment even when the
         pointer was over empty plot space. Stacked bars should report only
         the exact coloured segment beneath the cursor. */
      interaction:stacked?{mode:'point',intersect:true,axis:'xy'}:undefined,
      plugins:{legend:{display:datasets.length>1,position:'top',align:'start',labels:{color:tick,boxWidth:11,boxHeight:11,padding:10}},
        tooltip:{mode:stacked?'point':'nearest',intersect:!!stacked,
          backgroundColor:cssVar('--card2','#070809'),borderColor:cssVar('--borderB','#333'),borderWidth:1,
          titleColor:cssVar('--t1','#edf2ff'),bodyColor:tick,padding:10,cornerRadius:8,
          callbacks:{label:c=>' '+c.dataset.label+': '+(fmt?fmt(c.raw):nf(c.raw,0))}}},
      scales:{x:{stacked:!!stacked,beginAtZero:true,ticks:{color:tick,callback:v=>fmt?fmt(v):nf(v,0)},grid:{color:grid}},
              y:{stacked:!!stacked,ticks:{color:tick},grid:{display:false}}}}});
}
/* grouped vertical bars — used by the two Overview comparisons */
function groupBar(id,labels,datasets,fmt){
  destroy(id); if(!$(id))return;
  const grid=cssVar('--border','rgba(255,255,255,.08)'), tick=cssVar('--t2','#a6b8d4');
  charts[id]=new Chart($(id),{type:'bar',data:{labels,datasets},
    options:{maintainAspectRatio:false,animation:{duration:labels.length>60?0:420},
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'top',align:'start',labels:{color:tick,boxWidth:11,boxHeight:11,padding:12}},
        tooltip:{backgroundColor:cssVar('--card2','#070809'),borderColor:cssVar('--borderB','#333'),borderWidth:1,
          titleColor:cssVar('--t1','#edf2ff'),bodyColor:tick,padding:10,cornerRadius:8,
          callbacks:{label:c=>' '+c.dataset.label+': '+(fmt?fmt(c.raw):nf(c.raw,0))}}},
      scales:{x:{ticks:{color:tick,autoSkip:labels.length>18,maxRotation:0},grid:{color:grid}},
              y:{beginAtZero:true,ticks:{color:tick,callback:v=>fmt?fmt(v):nf(v,0)},grid:{color:grid}}}}});
}
/* a flat reference line, e.g. the Play Store threshold or a period average */
const refLine=(label,value,n)=>({label:label,data:new Array(n).fill(value),borderColor:cssVar('--t3','#7589a8'),
  borderDash:[5,4],borderWidth:1.4,pointRadius:0,fill:false,tension:0});

/* ==========================================================================
   TABLES
   ========================================================================== */
function table(host,cols,rows,foot,breakAt){
  if(!$(host))return;
  const th=cols.map(c=>'<th'+(c.num?' class="num"':'')+(c.w?' style="width:'+c.w+'"':'')+'>'+c.label+'</th>').join('');
  const tb=rows.map((r,ri)=>'<tr'+(breakAt!==undefined&&ri===breakAt?' class="wk-break"':'')+'>'+r.map((cell,i)=>{
      const c=cols[i], o=(cell&&typeof cell==='object')?cell:{v:cell};
      const cls=[c.num?'num':(i===0?'wk':''),c.txt?'txt':'',o.cls||''].filter(Boolean).join(' ');
      const st=o.bg?' style="'+o.bg+'"':'';
      const val=o.v;
      return '<td'+(cls?' class="'+cls+'"':'')+st+'>'+(val===null||val===undefined||val===''?'<span style="color:var(--t3)">—</span>':val)+'</td>';
    }).join('')+'</tr>').join('');
  const tf=foot?'<tfoot><tr>'+foot.map((f,i)=>'<td'+(cols[i].num?' class="num"':'')+'>'+(f===null?'':f)+'</td>').join('')+'</tr></tfoot>':'';
  $(host).innerHTML='<table><thead><tr>'+th+'</tr></thead><tbody>'+(tb||'<tr><td colspan="'+cols.length+'" style="color:var(--t3);text-align:center;padding:18px">no rows</td></tr>')+'</tbody>'+tf+'</table>';
}
/* graded cell shading: where this value sits within its own column's range */
function hm(v,arr,ramp,invert,fmt){
  if(v===null||v===undefined)return null;
  const values=[...new Set(nn(arr).map(Number))].sort((a,b)=>a-b);
  if(!values.length)return {v:fmt?fmt(v):v};
  let t=values.length>1?values.indexOf(Number(v))/(values.length-1):1;
  if(invert)t=1-t;
  const a=(0.36-0.20*t).toFixed(3);
  return {v:fmt?fmt(v):v,bg:'background:rgba('+RAMP[ramp]+','+a+')'};
}
function statRows(host,pairs){if($(host))$(host).innerHTML=pairs.map(p=>'<div><span>'+p[0]+'</span><span>'+p[1]+'</span></div>').join('');}

/* ==========================================================================
   SHARED RENDER UTILITIES
   ========================================================================== */

/* Pulls one field out of a date-keyed array and lines it up with `dates`, so
   every chart on a page shares one x-axis even though the four tabs behind it
   cover different days. */
function align(arr,field,dates){
  const m={}; (arr||[]).forEach(o=>{ m[o.date]=o[field]; });
  return dates.map(d=>(m[d]===undefined?null:m[d]));
}
function collectDatesUnfiltered(B){
  if(!B)return [];
  const s={};
  const push=arr=>(arr||[]).forEach(o=>{if(o&&o.date)s[o.date]=1});
  if(B.stability)   push(B.stability.series);
  if(B.ratings)     push(B.ratings.series);
  if(B.reviews)     push(B.reviews.volumeByDate);
  if(B.conversions) push(B.conversions.series);
  return Object.keys(s).sort();
}
function datesInActiveRange(){
  const r=activeDateRange();if(!r.start||!r.end)return [];
  const out=[],d=new Date(r.start+'T00:00:00'),end=new Date(r.end+'T00:00:00');
  while(d<=end){out.push(localISO(d));d.setDate(d.getDate()+1)}
  return out;
}
/* Use the complete calendar window rather than only dates present in a tab.
   align() will supply null for absent rows, so Chart.js leaves a visible gap
   while the x-axis still reaches the selected period end. */
function collectDates(B){return datesInActiveRange()}
function statusPill(st){
  const map={healthy:['green','healthy'],warning:['amber','approaching limit'],breach:['coral','over threshold'],unknown:['blue','no data']};
  const m=map[st]||map.unknown;
  return '<span class="pill '+m[0]+'">'+m[1]+'</span>';
}
function banner(host,warnings){
  if(!$(host))return;
  if(!warnings||!warnings.length){$(host).innerHTML='';return}
  $(host).innerHTML=warnings.map(w=>'<div class="note '+(w.level||'info')+'">'+esc(w.message)+'</div>').join('');
}
function rangeBar(host,range,tailNote){
  if(!$(host))return;
  const selected=activeDateRange();
  const chip=shortDate(selected.start)+' – '+shortDate(selected.end);
  const days=selected.start&&selected.end?Math.round((new Date(selected.end+'T00:00:00')-new Date(selected.start+'T00:00:00'))/86400000)+1:0;
  $(host).innerHTML='<span class="wk-pill"><i style="background:#00e5c3"></i>Period · <b>'+chip+'</b></span>'+
    '<span class="wk-arrow">'+days+' day'+(days===1?'':'s')+' · '+tailNote+'</span>';
}

const inWindow=o=>o&&dateAllowed(o.date||'');
function scopedStability(raw,ios){
  const S=Object.assign({},raw||{}),series=(S.series||[]).filter(inWindow),vals=series.map(x=>ios?x.crashes:x.crashRate),latest=series.at(-1)||null;
  S.series=series;S.latest=latest;S.previous=series.length>1?series.at(-2):null;
  if(ios){
    const total=sum(vals),av=mean(vals),sorted=series.slice().sort((a,b)=>(b.crashes||0)-(a.crashes||0));
    S.totals={crashes:total};S.averages={crashesPerDay:av,crashTrendPct:null};
    S.peak=sorted[0]||{};S.low=sorted.at(-1)||{};S.daysAboveAverage=av===null?0:vals.filter(v=>v>av*1.25).length;
    S.ma7=series.map((x,i)=>({date:x.date,ma:mean(vals.slice(Math.max(0,i-6),i+1))}));
  }else{
    const crash=series.map(x=>x.crashRate),anr=series.map(x=>x.anrRate),th=S.thresholds||{crashRatePct:1.09,anrRatePct:.47};
    S.averages={crashRate:mean(crash),anrRate:mean(anr)};
    S.peak={crashRate:maxOf(crash),anrRate:maxOf(anr)};
    S.daysOverThreshold={crash:crash.filter(v=>v>th.crashRatePct).length,anr:anr.filter(v=>v>th.anrRatePct).length};
    const crashAvg=mean(crash),anrAvg=mean(anr);
    S.status={crash:crashAvg===null?'unknown':(crashAvg>th.crashRatePct?'breach':(crashAvg>th.crashRatePct*.75?'warning':'healthy')),
      anr:anrAvg===null?'unknown':(anrAvg>th.anrRatePct?'breach':(anrAvg>th.anrRatePct*.75?'warning':'healthy'))};
  }
  return S;
}
function scopedRatings(raw){
  const R=Object.assign({},raw||{}),series=(R.series||[]).filter(inWindow),values=series.map(x=>x.rating);
  R.series=series;R.current=series.at(-1)||null;R.previous=series.length>1?series.at(-2):null;
  R.storedMean=mean(values);R.storedRows=series.length;R.perDay=(R.perDay||[]).filter(inWindow);
  R.changePts=series.length>1?series.at(-1).rating-series[0].rating:null;
  return R;
}
function scopedReviews(raw){
  const RV=Object.assign({},raw||{}),volume=(RV.volumeByDate||[]).filter(inWindow),all=(RV.all||[]).filter(inWindow);
  RV.volumeByDate=volume;
  const count=sum(volume.map(x=>x.count)),weighted=sum(volume.map(x=>(x.count||0)*(x.avgRating||0)));
  RV.counts=Object.assign({},RV.counts||{},{withText:count});RV.averageRatingWithText=count?weighted/count:null;
  if(all.length||RV.allOmitted===false){
    const dist={},labels={};(RV.themes||[]).forEach(t=>labels[t.key]=t.label);
    all.forEach(r=>{const star=Math.round(r.rating||0);if(star)dist[star]=(dist[star]||0)+1});
    const pos=all.filter(r=>r.rating>=4),neg=all.filter(r=>r.rating<=2),themeRows=(rows)=>{
      const m={};rows.forEach(r=>{const k=r.primary||'other';m[k]=(m[k]||0)+1});
      return Object.keys(m).map(k=>({key:k,label:labels[k]||k,count:m[k],sharePct:rows.length?m[k]/rows.length*100:0,mixed:0})).sort((a,b)=>b.count-a.count);
    };
    RV.all=all;RV.distribution=dist;RV.positiveCount=pos.length;RV.negativeCount=neg.length;
    RV.positiveSharePct=all.length?pos.length/all.length*100:null;RV.negativeSharePct=all.length?neg.length/all.length*100:null;
    RV.themes=themeRows(all);RV.positiveThemes=themeRows(pos);RV.negativeThemes=themeRows(neg);
    const grouped=field=>{const m={};all.forEach(r=>{const k=r[field]||'(unknown)';m[k]=(m[k]||0)+1});return Object.keys(m).map(k=>({key:k,count:m[k]})).sort((a,b)=>b.count-a.count)};
    RV.byDevice=grouped('device');RV.byVersion=grouped('version');
  }else{
    /* The core response deliberately omits individual reviews. Do not show
       full-period sentiment/star aggregates while the filtered rows are still
       downloading; phase two will populate and rerender these cards. */
    RV.distribution={};RV.positiveCount=null;RV.negativeCount=null;
    RV.positiveSharePct=null;RV.negativeSharePct=null;
    RV.themes=[];RV.positiveThemes=[];RV.negativeThemes=[];
  }
  return RV;
}
function scopedConversions(raw,ios){
  const C=Object.assign({},raw||{}),rows=(C.rows||[]).filter(inWindow),by={};
  rows.forEach(r=>{const k=r.source||'(unattributed)',g=by[k]||(by[k]=ios?{source:k,impressions:0,pageViews:0,converters:0}:{source:k,visitors:0,acquisition:0});if(ios){g.impressions+=r.impressions||0;g.pageViews+=r.pageViews||0;g.converters+=r.converters||0}else{g.visitors+=r.visitors||0;g.acquisition+=r.acquisition||0}});
  const sources=Object.values(by);
  sources.forEach(g=>{if(ios){g.conversionRate=g.impressions?g.converters/g.impressions*100:null;g.viewRate=g.impressions?g.pageViews/g.impressions*100:null;g.pageRate=g.pageViews?g.converters/g.pageViews*100:null}else g.conversionRate=g.visitors?g.acquisition/g.visitors*100:null});
  C.rows=rows;C.series=(C.series||[]).filter(inWindow);C.bySource=sources.sort((a,b)=>(ios?b.impressions-a.impressions:b.visitors-a.visitors));
  if(ios){const impressions=sum(rows.map(x=>x.impressions)),pageViews=sum(rows.map(x=>x.pageViews)),converters=sum(rows.map(x=>x.converters));C.totals={impressions,pageViews,converters,conversionRate:impressions?converters/impressions*100:null,viewRate:impressions?pageViews/impressions*100:null,pageRate:pageViews?converters/pageViews*100:null}}
  else{const visitors=sum(rows.map(x=>x.visitors)),acquisition=sum(rows.map(x=>x.acquisition));C.totals={visitors,acquisition,conversionRate:visitors?acquisition/visitors*100:null};C.recent=C.totals}
  C.bestSource=sources.filter(x=>(ios?x.impressions:x.visitors)>0).sort((a,b)=>(b.conversionRate||0)-(a.conversionRate||0))[0]||null;
  return C;
}

/* ==========================================================================
   ANDROID  ·  LIVE RENDER
   ========================================================================== */

function renderAndroid(){
  if(!A)return;
  const S=scopedStability(A.stability,false), R=scopedRatings(A.ratings), RV=scopedReviews(A.reviews), C=scopedConversions(A.conversions,false);
  ADATES=collectDates(A);
  const D=ADATES;

  const range=A.dateRange||{};
  setDateChip('anDateChip');
  rangeBar('anRangeBar',range,'daily granularity · live from Google Sheets');
  banner('anWarnings',(LAST_META.warnings||[]).filter(w=>!/^iOS |IOS_/.test(w.message||'')));

  /* ---------------- STABILITY ---------------- */
  const crash=align(S.series,'crashRate',D), anr=align(S.series,'anrRate',D);
  const th=(S.thresholds||{crashRatePct:1.09,anrRatePct:0.47});
  const avg=S.averages||{}, peak=S.peak||{}, over=S.daysOverThreshold||{};

  row('anRow2',[
    kpiSingle({label:'Average Crash Rate',accent:'coral',value:p2(avg.crashRate),
      note:'daily mean across the selected period · '+statusPill((S.status||{}).crash)}),
    kpiSingle({label:'Average ANR Rate',accent:'amber',value:p2(avg.anrRate),
      note:'daily mean across the selected period · '+statusPill((S.status||{}).anr)}),
    kpiSingle({label:'Peak Crash Rate',accent:'coral',value:p2(peak.crashRate),
      note:over.crash?over.crash+' day(s) above 1.09%':'never above threshold'}),
    kpiSingle({label:'Peak ANR Rate',accent:'amber',value:p2(peak.anrRate),
      note:over.anr?over.anr+' day(s) above 0.47%':'never above threshold'})]);

  lineX('anCrash',D,[
    {label:'Daily crash %',data:crash,borderColor:COLORS.coral,backgroundColor:'rgba(255,77,109,.10)',fill:true,tension:.25,pointRadius:3,borderWidth:2,spanGaps:false},
    refLine('Threshold 1.09%',th.crashRatePct,D.length)],
    {beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,2)+'%'}});
  lineX('anAnr',D,[
    {label:'Daily ANR %',data:anr,borderColor:COLORS.amber,backgroundColor:'rgba(255,184,0,.10)',fill:true,tension:.25,pointRadius:3,borderWidth:2,spanGaps:false},
    refLine('Threshold 0.47%',th.anrRatePct,D.length)],
    {beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,2)+'%'}});
  /* ---------------- RATINGS ---------------- */
  const ratingRows=R.perDay||[];
  const ratingCounts={
    5:sum(ratingRows.map(r=>r.star5)),4:sum(ratingRows.map(r=>r.star4)),
    3:sum(ratingRows.map(r=>r.star3)),2:sum(ratingRows.map(r=>r.star2)),
    1:sum(ratingRows.map(r=>r.star1))
  };
  const totalRatings=sum(Object.values(ratingCounts));
  const ratingShare=k=>totalRatings?ratingCounts[k]/totalRatings*100:null;
  const ratingColors={5:'green',4:'teal',3:'amber',2:'pink',1:'coral'};
  row('anRow3',[5,4,3,2,1].map(star=>kpiSingle({
    label:star+'★ Share',accent:ratingColors[star],value:pc(ratingShare(star),2),
    sub:n0(ratingCounts[star])+' of '+n0(totalRatings)+' ratings'
  })));

  /* ---------------- REVIEWS ---------------- */
  const cnt=RV.counts||{}, themes=RV.themes||[], negT=RV.negativeThemes||[], posT=RV.positiveThemes||[];
  const volume=align(RV.volumeByDate,'count',D), volAvg=align(RV.volumeByDate,'avgRating',D);

  row('anRow4',[
    kpiSingle({label:'Average Rating · Written',accent:'teal',value:n2(RV.averageRatingWithText),
      sub:'across '+n0(cnt.withText)+' written reviews'}),
    kpiSingle({label:'Positive Share',accent:'green',value:pc(RV.positiveSharePct,1),
      sub:n0(RV.positiveCount)+' reviews at 4★–5★',note:'higher is better'}),
    kpiSingle({label:'Negative Share',accent:'coral',tone:(RV.negativeSharePct>35?'neg':''),value:pc(RV.negativeSharePct,1),
      sub:n0(RV.negativeCount)+' reviews at 1★–2★',note:'lower is better'}),
    kpiSingle({label:'Top Complaint',accent:'amber',value:negT.length?esc(negT[0].label):'—',
      sub:negT.length?(n0(negT[0].count)+' of '+n0(RV.negativeCount)+' negative'):'—',
      note:'most common 1★–2★ theme'})]);

  mixedX('anReviewVol',D,[
    {type:'bar',label:'Reviews',data:volume,backgroundColor:'rgba(77,159,255,.55)',borderRadius:4,yAxisID:'y',order:2},
    {type:'line',label:'Avg rating',data:volAvg,borderColor:COLORS.teal,tension:.25,pointRadius:3,borderWidth:2,spanGaps:false,yAxisID:'y2',order:1}],
    {beginAtZero:true,title:{display:true,text:'Reviews',color:cssVar('--t3','#7589a8')},ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,0)}},
    {y2:{position:'right',suggestedMin:1,suggestedMax:5,grid:{drawOnChartArea:false},
      title:{display:true,text:'Avg rating',color:cssVar('--t3','#7589a8')},ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,1)}}});

  drawThemes('anThemes','tblAnThemes',themes,negT,posT);

  const perDay=R.perDay||[];
  const star5=align(perDay,'star5',D), star4=align(perDay,'star4',D),
    star3=align(perDay,'star3',D), star2=align(perDay,'star2',D), star1=align(perDay,'star1',D);
  mixedX('anRatingDaily',D,[
    {label:'5★',data:star5,backgroundColor:'rgba(0,196,122,.82)',stack:'ratings',borderRadius:2},
    {label:'4★',data:star4,backgroundColor:'rgba(0,229,195,.82)',stack:'ratings',borderRadius:2},
    {label:'3★',data:star3,backgroundColor:'rgba(255,184,0,.82)',stack:'ratings',borderRadius:2},
    {label:'2★',data:star2,backgroundColor:'rgba(236,10,155,.80)',stack:'ratings',borderRadius:2},
    {label:'1★',data:star1,backgroundColor:'rgba(255,77,109,.82)',stack:'ratings',borderRadius:2}
  ],{beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,0)}});
  if(charts.anRatingDaily){
    charts.anRatingDaily.options.scales.x.stacked=true;
    charts.anRatingDaily.options.scales.y.stacked=true;
    charts.anRatingDaily.update('none');
  }

  /* ---------------- CONVERSION ---------------- */
  const tot=C.totals||{}, rec=C.recent||{}, best=C.bestSource;

  row('anRow5',[
    kpiDelta({label:'Conversion Rate',accent:'pink',value:pc(rec.conversionRate,2),
      curr:rec.conversionRate,prev:null,sub:'period total',
      note:'acquisitions ÷ visitors, re-divided from totals'}),
    kpiSingle({label:'Store Visitors',accent:'blue',value:cp(tot.visitors),
      sub:n0(tot.visitors)+' total',note:'across all traffic sources'}),
    kpiSingle({label:'Acquisitions',accent:'green',value:cp(tot.acquisition),
      sub:n0(tot.acquisition)+' total',note:'store listing acquisitions'}),
    kpiSingle({label:'Best Converting Source',accent:'teal',
      value:best?('<span style="font-size:19px">'+esc(best.source)+'</span>'):'—',
      sub:best?(pc(best.conversionRate,2)+' CVR · '+cp(best.visitors)+' visitors → '+cp(best.acquisition)+' installs'):'—',
      note:'highest conversion rate of any traffic source'})]);

  drawConversionCharts(C);

  const allSources=(C.bySource||[]).slice();
  const sourceColors=sourceColorMap(allSources.map(s=>s.source));
  const srcs=allSources.sort((a,b)=>(b.conversionRate??-Infinity)-(a.conversionRate??-Infinity)).slice(0,12);
  hbar('anCvrSource',srcs.map(s=>s.source),
    [{label:'Conversion rate',data:srcs.map(s=>s.conversionRate),
      backgroundColor:srcs.map(s=>sourceColors[s.source]),
      borderRadius:4}],
    v=>nf(v,2)+'%');
  if(charts.anCvrSource){
    charts.anCvrSource.options.plugins.tooltip.callbacks.label=c=>{
      const s=srcs[c.dataIndex],share=tot.visitors?s.visitors/tot.visitors*100:0;
      return [' Conversion rate: '+pc(s.conversionRate,2),
              ' Visitors: '+n0(s.visitors),
              ' Acquisitions: '+n0(s.acquisition),
              ' Share of traffic: '+pc(share,1)];
    };
    charts.anCvrSource.update('none');
  }

  const crows=C.rows||[];
  const dailySources=srcs.map(s=>s.source);
  lineX('anConvSourceDaily',D,dailySources.map(source=>({
    label:source,
    data:D.map(date=>{
      const r=crows.find(x=>x.date===date&&x.source===source);
      return r?r.conversionRate:null;
    }),
    borderColor:sourceColors[source],backgroundColor:sourceColors[source],
    tension:.25,pointRadius:3,borderWidth:2,spanGaps:false
  })),{beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,2)+'%'}});
  if(charts.anConvSourceDaily){
    charts.anConvSourceDaily.options.plugins.tooltip.callbacks.label=c=>' '+c.dataset.label+': '+pc(c.raw,2);
    charts.anConvSourceDaily.update('none');
  }
}

/* Shared by both platforms: the stacked theme chart plus its detail table. */
function drawThemes(chartId,tableId,themes,negT,posT){
  const negMap={}; (negT||[]).forEach(t=>negMap[t.key]=t.count);
  const posMap={}; (posT||[]).forEach(t=>posMap[t.key]=t.count);
  /* neutral = whatever is left once positive and negative are accounted for */
  const midOf=t=>Math.max(0,(t.count||0)-(posMap[t.key]||0)-(negMap[t.key]||0));

  hbar(chartId,themes.map(t=>t.label),[
    {label:'4★–5★',data:themes.map(t=>posMap[t.key]||0),backgroundColor:'rgba(0,196,122,.75)',borderRadius:4,stack:'s'},
    {label:'3★',data:themes.map(midOf),backgroundColor:'rgba(255,184,0,.7)',borderRadius:4,stack:'s'},
    {label:'1★–2★',data:themes.map(t=>negMap[t.key]||0),backgroundColor:'rgba(255,77,109,.8)',borderRadius:4,stack:'s'}],n0,true);

  table(tableId,
    [{label:'Theme'},{label:'Reviews',num:true},{label:'Share',num:true},{label:'Mixed',num:true},
     {label:'4★–5★',num:true},{label:'1★–2★',num:true},{label:'Sentiment',num:true}],
    themes.map(t=>{
      const pos=posMap[t.key]||0, neg=negMap[t.key]||0;
      const net=t.count?(pos-neg)/t.count*100:null;
      return ['<b>'+esc(t.label)+'</b>',
        hm(t.count,themes.map(x=>x.count),'blue',false,n0),
        pc(t.sharePct,1),
        t.mixed?{v:n0(t.mixed),cls:'flat'}:null,
        hm(pos,themes.map(x=>posMap[x.key]||0),'green',false,n0),
        hm(neg,themes.map(x=>negMap[x.key]||0),'coral',false,n0),
        net===null?null:{v:(net>0?'+':'')+nf(net,0)+'%',cls:net>15?'up':(net<-15?'dn':'flat')}];
    }),
    ['All themes',n0(sum(themes.map(t=>t.count))),'100.0%',
     n0(sum(themes.map(t=>t.mixed||0))),
     n0(sum(themes.map(t=>posMap[t.key]||0))),
     n0(sum(themes.map(t=>negMap[t.key]||0))),'']);
}

function drawConversionCharts(C){
  const D=ADATES;
  const rows=C.rows||[];

  /* With a source picked each date has one row, so its stored rate is used
     as-is. Under "All sources" a day spans several rows, and a rate covering
     the whole day only exists if it is re-divided from that day's totals. */
  const byDate={};
  rows.forEach(r=>{
    if(!r.date)return;
    if(!byDate[r.date])byDate[r.date]={v:0,a:0,n:0,stored:null};
    byDate[r.date].v+=r.visitors||0;
    byDate[r.date].a+=r.acquisition||0;
    byDate[r.date].n++;
    byDate[r.date].stored=r.conversionRate;
  });
  const vis=D.map(d=>byDate[d]?byDate[d].v:null);
  const acq=D.map(d=>byDate[d]?byDate[d].a:null);
  const cvr=D.map(d=>{
    const g=byDate[d]; if(!g)return null;
    if(g.n===1&&g.stored!==null&&g.stored!==undefined)return g.stored;
    return g.v?Math.round(g.a/g.v*10000)/100:null;
  });

  if($('cvTitleA'))$('cvTitleA').textContent='all sources';

  lineX('anCvr',D,[
    {label:'Conversion rate',data:cvr,borderColor:COLORS.pink,backgroundColor:'rgba(236,10,155,.10)',fill:true,tension:.25,pointRadius:3,borderWidth:2,spanGaps:false}],
    {beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,2)+'%'}});
  if(charts.anCvr){
    charts.anCvr.options.plugins.tooltip.callbacks.label=c=>' '+c.dataset.label+': '+pc(c.raw,2);
    charts.anCvr.update('none');
  }
}

/* ==========================================================================
   iOS  ·  LIVE RENDER

   Section for section, the same page as Android. Where App Store Connect gives
   a different measurement, the closest honest equivalent is shown and labelled
   as what it is rather than dressed up to match:

     Android crash RATE   ->  iOS crash COUNT. IOS_Stability has no session
                              column, so a rate cannot be derived and none is
                              invented. The comparison is against the app's own
                              period average instead of a Play Store threshold,
                              because Apple publishes no equivalent limit.

     Android version      ->  iOS Build ID.
     Android device       ->  nothing. App Store reviews carry no device.
     Android visitors     ->  iOS impressions, with product page views as the
                              middle step of the funnel that Android does not
                              report at all.
   ========================================================================== */
function renderIos(){
  if(!I)return;
  const S=scopedStability(I.stability,true), R=scopedRatings(I.ratings), RV=scopedReviews(I.reviews), C=scopedConversions(I.conversions,true);
  IDATES=collectDates(I);
  const D=IDATES;

  const range=I.dateRange||{};
  setDateChip('ioDateChip');
  rangeBar('ioRangeBar',range,'daily granularity · live from Google Sheets');
  banner('ioWarnings',(LAST_META.warnings||[]).filter(w=>/^iOS |IOS_/.test(w.message||'')));

  /* ---------------- STABILITY ---------------- */
  const crashes=align(S.series,'crashes',D);
  const ma=align(S.ma7,'ma',D);
  const avg=S.averages||{}, peak=S.peak||{}, low=S.low||{}, tot=S.totals||{};
  const avgPerDay=avg.crashesPerDay;

  row('ioRow2',[
    kpiSingle({label:'Average Crashes per Day',accent:'coral',value:n1(avgPerDay),
      note:'daily mean across the selected period'}),
    kpiSingle({label:'Total Crashes',accent:'blue',value:cp(tot.crashes),
      sub:n0(tot.crashes)+' across '+D.length+' selected days',note:'sum across the selected period'}),
    kpiSingle({label:'Peak Daily Crashes',accent:'coral',value:n0(peak.crashes),
      note:(S.daysAboveAverage||0)+' day(s) more than 25% above average'}),
    kpiSingle({label:'Days With Crash Data',accent:'amber',value:n0(S.series.length),
      sub:n0(S.series.length)+' of '+D.length+' selected days',
      note:low.date?'lowest daily count: '+n0(low.crashes):'no rows in selected period'})]);

  lineX('ioCrash',D,[
    {label:'Crashes',data:crashes,borderColor:COLORS.coral,backgroundColor:'rgba(255,77,109,.10)',fill:true,tension:.25,pointRadius:3,borderWidth:2,spanGaps:false},
    refLine('Period average',avgPerDay,D.length)],
    {beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>compact(v)}});

  lineX('ioMa',D,[
    {label:'7-day average',data:ma,borderColor:COLORS.amber,backgroundColor:'rgba(255,184,0,.10)',fill:true,tension:.3,pointRadius:2,borderWidth:2,spanGaps:false}],
    {beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>compact(v)}});

  /* ---------------- RATINGS ---------------- */
  const dist0=(RV.distribution||{}), tw=(RV.counts||{}).withText||0;
  const share=k=>tw?(dist0[k]||0)/tw*100:null;
  const ratingColors={5:'green',4:'teal',3:'amber',2:'pink',1:'coral'};
  row('ioRow3',[5,4,3,2,1].map(star=>kpiSingle({
    label:star+'★ Share',accent:ratingColors[star],value:pc(share(star),2),
    sub:n0(dist0[star]||0)+' of '+n0(tw)+' ratings'
  })));

  const ioReviewRows=RV.all||[],ioStars={1:{},2:{},3:{},4:{},5:{}};
  ioReviewRows.forEach(r=>{
    const star=Math.round(r.rating||0),date=r.date;
    if(star>=1&&star<=5&&date)ioStars[star][date]=(ioStars[star][date]||0)+1;
  });
  mixedX('ioRatingDaily',D,[
    {label:'5★',data:D.map(d=>ioStars[5][d]||0),backgroundColor:'rgba(0,196,122,.82)',stack:'ratings',borderRadius:2},
    {label:'4★',data:D.map(d=>ioStars[4][d]||0),backgroundColor:'rgba(0,229,195,.82)',stack:'ratings',borderRadius:2},
    {label:'3★',data:D.map(d=>ioStars[3][d]||0),backgroundColor:'rgba(255,184,0,.82)',stack:'ratings',borderRadius:2},
    {label:'2★',data:D.map(d=>ioStars[2][d]||0),backgroundColor:'rgba(236,10,155,.80)',stack:'ratings',borderRadius:2},
    {label:'1★',data:D.map(d=>ioStars[1][d]||0),backgroundColor:'rgba(255,77,109,.82)',stack:'ratings',borderRadius:2}
  ],{beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,0)}});
  if(charts.ioRatingDaily){charts.ioRatingDaily.options.scales.x.stacked=true;charts.ioRatingDaily.options.scales.y.stacked=true;charts.ioRatingDaily.update('none')}

  /* ---------------- REVIEWS ---------------- */
  const cnt=RV.counts||{}, themes=RV.themes||[], negT=RV.negativeThemes||[], posT=RV.positiveThemes||[];
  const volume=align(RV.volumeByDate,'count',D), volAvg=align(RV.volumeByDate,'avgRating',D);

  row('ioRow4',[
    kpiSingle({label:'Average Rating · Written',accent:'teal',value:n2(RV.averageRatingWithText),
      sub:'across '+n0(cnt.withText)+' written reviews'}),
    kpiSingle({label:'Positive Share',accent:'green',value:pc(RV.positiveSharePct,1),
      sub:n0(RV.positiveCount)+' reviews at 4★–5★',note:'higher is better'}),
    kpiSingle({label:'Negative Share',accent:'coral',tone:(RV.negativeSharePct>35?'neg':''),value:pc(RV.negativeSharePct,1),
      sub:n0(RV.negativeCount)+' reviews at 1★–2★',note:'lower is better'}),
    kpiSingle({label:'Top Complaint',accent:'amber',value:negT.length?esc(negT[0].label):'—',
      sub:negT.length?(n0(negT[0].count)+' of '+n0(RV.negativeCount)+' negative'):'—',
      note:'most common 1★–2★ theme'})]);

  mixedX('ioReviewVol',D,[
    {type:'bar',label:'Reviews',data:volume,backgroundColor:'rgba(77,159,255,.55)',borderRadius:4,yAxisID:'y',order:2},
    {type:'line',label:'Avg rating',data:volAvg,borderColor:COLORS.teal,tension:.25,pointRadius:3,borderWidth:2,spanGaps:false,yAxisID:'y2',order:1}],
    {beginAtZero:true,title:{display:true,text:'Reviews',color:cssVar('--t3','#7589a8')},ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,0)}},
    {y2:{position:'right',suggestedMin:1,suggestedMax:5,grid:{drawOnChartArea:false},
      title:{display:true,text:'Avg rating',color:cssVar('--t3','#7589a8')},ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,1)}}});

  drawThemes('ioThemes','tblIoThemes',themes,negT,posT);

  /* ---------------- CONVERSION ---------------- */
  const cTot=C.totals||{}, rec=C.recent||{}, best=C.bestSource;

  row('ioRow5',[
    kpiDelta({label:'Conversion Rate',accent:'pink',value:pc(cTot.conversionRate,2),
      curr:cTot.conversionRate,prev:null,sub:'period total · converters ÷ impressions',
      note:'App Store Connect definition, re-divided from totals'}),
    kpiSingle({label:'Impressions',accent:'blue',value:cp(cTot.impressions),
      sub:n0(cTot.impressions)+' total',
      note:pc(cTot.viewRate,2)+' went on to open the listing'}),
    kpiSingle({label:'Converters',accent:'green',value:cp(cTot.converters),
      sub:n0(cTot.converters)+' total',note:'App Store conversions'}),
    kpiSingle({label:'Best Converting Source',accent:'teal',
      value:best?('<span style="font-size:19px">'+esc(best.source)+'</span>'):'—',
      sub:best?(pc(best.conversionRate,2)+' CVR · '+cp(best.impressions)+' impressions → '+cp(best.converters)+' installs'):'—',
      note:'highest conversion rate of any traffic source'})]);

  drawIosConversionCharts(C);

  const allSources=(C.bySource||[]).slice();
  const sourceColors=sourceColorMap(allSources.map(s=>s.source));
  const srcs=allSources.sort((a,b)=>(b.conversionRate??-Infinity)-(a.conversionRate??-Infinity)).slice(0,12);
  hbar('ioCvrSource',srcs.map(s=>s.source),
    [{label:'Conversion rate',data:srcs.map(s=>s.conversionRate),
      backgroundColor:srcs.map(s=>sourceColors[s.source]),
      borderRadius:4}],
    v=>nf(v,2)+'%');
  if(charts.ioCvrSource){
    charts.ioCvrSource.options.plugins.tooltip.callbacks.label=c=>{
      const s=srcs[c.dataIndex],share=cTot.impressions?s.impressions/cTot.impressions*100:0;
      return [' Conversion rate: '+pc(s.conversionRate,2),
              ' Impressions: '+n0(s.impressions),
              ' Converters: '+n0(s.converters),
              ' Share of impressions: '+pc(share,1)];
    };
    charts.ioCvrSource.update('none');
  }

  const crows=C.rows||[];
  lineX('ioConvSourceDaily',D,srcs.map(source=>({
    label:source.source,
    data:D.map(date=>{const r=crows.find(x=>x.date===date&&x.source===source.source);return r?r.conversionRate:null}),
    borderColor:sourceColors[source.source],backgroundColor:sourceColors[source.source],
    tension:.25,pointRadius:3,borderWidth:2,spanGaps:false
  })),{beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,2)+'%'}});
  if(charts.ioConvSourceDaily){charts.ioConvSourceDaily.options.plugins.tooltip.callbacks.label=c=>' '+c.dataset.label+': '+pc(c.raw,2);charts.ioConvSourceDaily.update('none')}
}

function drawIosConversionCharts(C){
  const D=IDATES;
  const rows=C.rows||[];

  const byDate={};
  rows.forEach(r=>{
    if(!r.date)return;
    if(!byDate[r.date])byDate[r.date]={imp:0,ppv:0,cnv:0,n:0,stored:null};
    byDate[r.date].imp+=r.impressions||0;
    byDate[r.date].ppv+=r.pageViews||0;
    byDate[r.date].cnv+=r.converters||0;
    byDate[r.date].n++;
    byDate[r.date].stored=r.conversionRate;
  });
  const imp=D.map(d=>byDate[d]?byDate[d].imp:null);
  const cnv=D.map(d=>byDate[d]?byDate[d].cnv:null);
  /* One source picked means one row per date, so the stored rate describes the
     whole day and is quoted as-is. All sources means several rows, and only a
     figure re-divided from that day's totals covers the day. */
  const cvr=D.map(d=>{
    const g=byDate[d]; if(!g)return null;
    if(g.n===1&&g.stored!==null&&g.stored!==undefined)return g.stored;
    return g.imp?Math.round(g.cnv/g.imp*10000)/100:null;
  });

  if($('ioTitleA'))$('ioTitleA').textContent='all sources';

  lineX('ioCvr',D,[
    {label:'Conversion rate',data:cvr,borderColor:COLORS.pink,backgroundColor:'rgba(236,10,155,.10)',fill:true,tension:.25,pointRadius:3,borderWidth:2,spanGaps:false}],
    {beginAtZero:true,ticks:{color:cssVar('--t2','#a6b8d4'),callback:v=>nf(v,2)+'%'}});
  if(charts.ioCvr){charts.ioCvr.options.plugins.tooltip.callbacks.label=c=>' '+c.dataset.label+': '+pc(c.raw,2);charts.ioCvr.update('none')}
}

/* ==========================================================================
   OVERVIEW  ·  ANDROID vs iOS

   Four cards and two charts, and nothing that needs a footnote to be read
   correctly. Store metrics are not automatically comparable across platforms,
   so only measures that mean the same thing on both sides earn a card:

     Average rating over written reviews  same definition, both stores
     Written review volume                same definition
     Negative share                       1-2 stars over written reviews, both
     Conversion rate                      DIFFERENT denominators - Play counts
                                          store-listing visitors, App Store
                                          counts impressions. Kept because it
                                          is the number everybody asks for, and
                                          labelled on the card so the gap is
                                          not read as a performance difference.
   ========================================================================== */
function renderOverview(){
  const AR=scopedReviews(A&&A.reviews), IR=scopedReviews(I&&I.reviews);
  const AC=scopedConversions(A&&A.conversions,false), IC=scopedConversions(I&&I.conversions,true);
  const aRange=(A&&A.dateRange)||{}, iRange=(I&&I.dateRange)||{};
  const selectedDays=datesInActiveRange().length||1;

  /* One chip per platform: the two windows genuinely differ, and averaging them
     into a single "period" would misstate both. */
  const chip=(a,b)=>shortDate(a)+' – '+shortDate(b);
  setDateChip('ovDateChip');
  if($('ovRangeBar')){
    const selected=activeDateLabel();
    $('ovRangeBar').innerHTML=
      (A?'<span class="wk-pill"><i style="background:'+COLORS.green+'"></i>Android · <b>'+selected+'</b></span>':'')+
      (I?'<span class="wk-pill"><i style="background:'+COLORS.blue+'"></i>IOS · <b>'+selected+'</b></span>':'')+
      '<span class="wk-arrow">live from Google Sheets</span>';
  }
  banner('ovWarnings',LAST_META.warnings||[]);

  const aCvr=(AC.totals||{}).conversionRate, iCvr=(IC.totals||{}).conversionRate;

  row('ovRow1',[
    kpiCompare({label:'Average Rating · Written',accent:'teal',
      a:AR.averageRatingWithText,b:IR.averageRatingWithText,fmt:n2,lower:false,
      sub:n0((AR.counts||{}).withText)+' vs '+n0((IR.counts||{}).withText)+' written reviews',
      note:'mean star rating of reviews that carry text'}),

    kpiCompare({label:'Written Reviews',accent:'blue',
      a:(AR.counts||{}).withText,b:(IR.counts||{}).withText,fmt:cp,lower:false,
      sub:n1(((AR.counts||{}).withText||0)/selectedDays)+' vs '+
          n1(((IR.counts||{}).withText||0)/selectedDays)+' per day',
      note:'one row per review, both stores'}),

    kpiCompare({label:'Negative Share',accent:'coral',
      a:AR.negativeSharePct,b:IR.negativeSharePct,fmt:v=>pc(v,1),lower:true,
      sub:n0(AR.negativeCount)+' vs '+n0(IR.negativeCount)+' reviews at 1★–2★',
      note:'lower is better · share of each platform\u2019s own written reviews'}),

    kpiCompare({label:'Store Conversion Rate',accent:'pink',
      a:aCvr,b:iCvr,fmt:v=>pc(v,2),lower:false,
      sub:cp((AC.totals||{}).visitors)+' visitors vs '+cp((IC.totals||{}).impressions)+' impressions',
      note:'different denominators: Play counts listing visitors, App Store counts impressions'})]);

  /* ---- chart 1: star mix, as a share so volume does not decide the shape ---- */
  const aTot=(AR.counts||{}).withText||0, iTot=(IR.counts||{}).withText||0;
  const aDist=AR.distribution||{}, iDist=IR.distribution||{};
  const stars=[1,2,3,4,5];
  groupBar('ovDist',stars.map(s=>s+'★'),[
    {label:'Android',data:stars.map(s=>aTot?(aDist[s]||0)/aTot*100:null),backgroundColor:'rgba(0,196,122,.75)',borderRadius:4},
    {label:'IOS',data:stars.map(s=>iTot?(iDist[s]||0)/iTot*100:null),backgroundColor:'rgba(77,159,255,.75)',borderRadius:4}],
    v=>nf(v,1)+'%');

  /* ---- chart 2: daily written-review volume over the union of both windows ---- */
  const days=datesInActiveRange();
  groupBar('ovVolume',days.map(shortDate),[
    {label:'Android',data:align(AR.volumeByDate,'count',days),backgroundColor:'rgba(0,196,122,.7)',borderRadius:3},
    {label:'IOS',data:align(IR.volumeByDate,'count',days),backgroundColor:'rgba(77,159,255,.7)',borderRadius:3}],
    n0);
}

/* ==========================================================================
   REVIEWS PAGE  ·  both platforms behind one dropdown

   Android and iOS reviews do not carry the same columns. Rather than showing
   empty Device and Language dropdowns on iOS, the payload states which fields
   it has (reviews.fields) and the filter bar hides the rest. The version
   dropdown relabels itself, because "App Version 1.34.0" and "Build ID 4821"
   are not the same thing and a shared label would be wrong for one of them.
   ========================================================================== */
const RVF={from:'',to:'',ver:'',dev:'',lang:'',star:'',theme:'',text:''};
let RVPLAT='android';
let RVSORT={key:'date',dir:-1};
let RVBUILT=false;
let RVSHOWN=PERF.reviewPage;
let RVROWS=[];

const rvBlock=()=>(RVPLAT==='ios'?I:A);
const rvFields=()=>{
  const b=rvBlock();
  const f=(b&&b.reviews&&b.reviews.fields)||{};
  return {device:f.device!==false,language:f.language!==false,versionLabel:f.versionLabel||'App Version'};
};

function fillSelect(id,label,values,current){
  const el=$(id); if(!el)return;
  el.innerHTML='<option value="">'+label+'</option>'+
    values.map(v=>'<option value="'+esc(v.value)+'"'+(v.value===current?' selected':'')+'>'+esc(v.label)+'</option>').join('');
}
/* Placeholders the loader substitutes for empty cells. They still count in
   every total; they are only kept out of the dropdowns, where an
   "All devices → (unknown)" option is noise rather than a filter. */
const BLANKS=['(unspecified)','(unknown)','(unattributed)',''];
const isBlank_=v=>BLANKS.indexOf(String(v===null||v===undefined?'':v))!==-1;
const blankable_=(v,prefix)=>isBlank_(v)?null:esc((prefix||'')+v);
const STARS=n=>{const k=Math.round(n||0);return '★'.repeat(k)+'☆'.repeat(Math.max(0,5-k))};

/* distinct values with their review counts, most common first */
function facet(rows,field,fmt){
  const c={};
  rows.forEach(r=>{const k=r[field]; if(isBlank_(k))return; c[k]=(c[k]||0)+1});
  return Object.keys(c).sort((a,b)=>c[b]-c[a]||String(a).localeCompare(String(b)))
    .map(k=>({value:k,label:(fmt?fmt(k):k)+'  ('+c[k]+')'}));
}
function buildReviewFilters(all){
  const F=rvFields();
  const days=[...new Set(all.map(r=>r.date))].filter(Boolean).sort();
  const dateOptions=days.slice().reverse().map(d=>({value:d,label:shortDate(d)}));
  fillSelect('fFrom','From date',dateOptions,RVF.from);
  fillSelect('fTo','To date',dateOptions,RVF.to);

  if($('lVer'))$('lVer').textContent=F.versionLabel;
  fillSelect('fVer','All '+F.versionLabel.toLowerCase()+'s',
    facet(all,'version',v=>(F.versionLabel==='App Version'?'v':'')+v),RVF.ver);

  if($('gDev'))$('gDev').classList.toggle('hide',!F.device);
  if($('gLang'))$('gLang').classList.toggle('hide',!F.language);
  if(F.device)   fillSelect('fDev','All devices',facet(all,'device'),RVF.dev);
  if(F.language) fillSelect('fLang','All languages',facet(all,'language',v=>String(v).toUpperCase()),RVF.lang);

  fillSelect('fStar','All ratings',[5,4,3,2,1].map(n=>({value:String(n),label:n+'★'})),RVF.star);

  const themes={};
  all.forEach(r=>{const k=r.primary||'other';themes[k]=(themes[k]||0)+1});
  const b=rvBlock();
  const labels={}; ((b&&b.reviews&&b.reviews.themes)||[]).forEach(t=>labels[t.key]=t.label);
  fillSelect('fTheme','All themes',Object.keys(themes).sort((a,b2)=>themes[b2]-themes[a])
    .map(k=>({value:k,label:(labels[k]||k)+'  ('+themes[k]+')'})),RVF.theme);
}
function applyReviewFilters(all){
  const q=RVF.text.trim().toLowerCase();
  return all.filter(r=>
    dateAllowed(r.date||'') &&
    (!RVF.from  || (r.date||'')>=RVF.from) &&
    (!RVF.to    || (r.date||'')<=RVF.to) &&
    (!RVF.ver   || r.version===RVF.ver) &&
    (!RVF.dev   || r.device===RVF.dev) &&
    (!RVF.lang  || r.language===RVF.lang) &&
    (!RVF.star  || Math.round(r.rating)===+RVF.star) &&
    (!RVF.theme || r.primary===RVF.theme) &&
    (!q         || String(r.text).toLowerCase().indexOf(q)!==-1)
  );
}
function sortReviews(rows){
  const k=RVSORT.key, d=RVSORT.dir;
  return rows.slice().sort((a,b)=>{
    let x=a[k], y=b[k];
    if(k==='rating'){ x=x||0; y=y||0; return (x-y)*d; }
    x=String(x||''); y=String(y||'');
    return x.localeCompare(y)*d;
  });
}
function rvCols(){
  const F=rvFields();
  const cols=[{key:'rating',label:'Rating',num:true,w:'11%'},{key:'date',label:'Date',w:'13%'}];
  if(F.language) cols.push({key:'language',label:'Lang'});
  cols.push({key:'themes',label:'Themes'},{key:'text',label:'Review',txt:true,w:'50%'});
  return cols;
}
function reviewRowCells(r,COLS,F){
  const cells=[
    {v:'<span class="stars star'+Math.round(r.rating||0)+'">'+STARS(r.rating)+'</span>'},
    '<span class="rv-number">'+shortDate(r.date)+'</span>'];
  if(F.language) cells.push(esc(r.language).toUpperCase());
  cells.push('<span class="chip main">'+esc(r.primary||'other')+'</span>'+ 
    (r.themes||[]).filter(t=>t!==r.primary).map(t=>'<span class="chip">'+esc(t)+'</span>').join(''));
  cells.push(esc(r.textEnglish||r.textEn||r.text));
  return cells;
}

/**
 * Renders the first RVSHOWN rows and offers the rest on demand.
 *
 * The whole filtered set is never written to the DOM at once. On a catalogue
 * with tens of thousands of reviews that single innerHTML assignment is the
 * slowest thing on the page by a wide margin, and it happens again on every
 * keystroke in the search box. Capping it keeps filtering instant no matter how
 * large the result, and the count line still reports the true total so nothing
 * about the data is hidden.
 */
function renderReviewTable(){
  const b=rvBlock();
  if(!b||!b.reviews){ table('tblReviews',[{label:'Review'}],[]); return; }
  const all=b.reviews.all||[];
  const F=rvFields();

  RVROWS=sortReviews(applyReviewFilters(all));
  const shown=RVROWS.slice(0,RVSHOWN);

  if($('fCount')){
    const pending=!REVIEWS_READY[RVPLAT];
    $('fCount').innerHTML='<b>'+nf(RVROWS.length,0)+'</b> of '+nf(all.length,0)+' reviews'+
      (RVROWS.length?' · avg <b>'+nf(mean(RVROWS.map(r=>r.rating)),2)+'★</b>':'')+
      (pending?' · <span style="color:var(--amber)">still loading…</span>':'');
  }

  const COLS=rvCols();
  const cols=COLS.map(c=>({label:c.label+(RVSORT.key===c.key?'<span class="sortmark">'+(RVSORT.dir>0?'▲':'▼')+'</span>':''),
    num:c.num,txt:c.txt}));
  table('tblReviews',cols,shown.map(r=>reviewRowCells(r,COLS,F)));

  if($('rvMore')){
    if(RVROWS.length>shown.length){
      $('rvMore').innerHTML='<button class="btn" id="rvMoreBtn">View More ('+
        Math.min(PERF.reviewPage,RVROWS.length-shown.length)+')</button>'+ 
        '<span>showing '+nf(shown.length,0)+' of '+nf(RVROWS.length,0)+'</span>';
      $('rvMoreBtn').onclick=()=>{RVSHOWN+=PERF.reviewPage;renderReviewTable()};
    }else{
      $('rvMore').innerHTML=RVROWS.length?'<span>all '+nf(RVROWS.length,0)+' rows shown</span>':'';
    }
  }

  /* header sorting is wired after each build because table() replaces the DOM */
  document.querySelectorAll('#tblReviews th').forEach((th,i)=>{th.onclick=()=>{
    const key=COLS[i].key;
    if(RVSORT.key===key)RVSORT.dir=-RVSORT.dir;
    else {RVSORT.key=key;RVSORT.dir=(key==='date'||key==='rating')?-1:1}
    RVSHOWN=PERF.reviewPage;
    renderReviewTable();
  }});
}

function renderReviews(){
  const b=rvBlock();
  const all=(b&&b.reviews&&b.reviews.all)||[];
  const dated=all.filter(r=>dateAllowed(r.date||''));
  const range=(b&&b.dateRange)||{};
  const isIos=RVPLAT==='ios';

  /* On first open, include the full active dashboard window (seven days by
     default). From/To use the actual earliest/latest review dates found inside
     that window, so absent boundary dates do not create invalid selections. */
  if(dated.length&&!RVF.from&&!RVF.to){
    const reviewDates=dated.map(r=>r.date||'').filter(Boolean).sort();
    if(reviewDates.length){RVF.from=reviewDates[0];RVF.to=reviewDates.at(-1)}
  }

  if($('fPlatform'))$('fPlatform').value=RVPLAT;
  if($('rvEyebrow'))$('rvEyebrow').textContent=isIos?'Platform: IOS · App Store':'Platform: Android · Google Play';
  if($('rvTitle'))$('rvTitle').textContent=isIos?'IOS Reviews':'Android Reviews';
  setDateChip('rvDateChip');
  if($('rvRangeBar'))$('rvRangeBar').innerHTML=
    '<span class="wk-pill"><i style="background:'+(isIos?COLORS.blue:COLORS.green)+'"></i>'+
      (isIos?'IOS':'Android')+' reviews · <b>'+nf(dated.length,0)+'</b></span>'+
    '<span class="wk-arrow">'+activeDateLabel()+'</span>';

  banner('rvNote',REVIEWS_READY[RVPLAT]?[]:[{level:'info',
    message:'Review text is still downloading in the background. Filters and counts will fill in as it arrives.'}]);

  buildReviewFilters(dated);

  if(!RVBUILT){
    RVBUILT=true;
    const bind=(id,key)=>{const el=$(id); if(el)el.onchange=()=>{RVF[key]=el.value;RVSHOWN=PERF.reviewPage;renderReviewTable()}};
    bind('fFrom','from'); bind('fTo','to'); bind('fVer','ver');
    bind('fStar','star'); bind('fTheme','theme');

    const plat=$('fPlatform');
    if(plat)plat.onchange=()=>{
      RVPLAT=plat.value;
      /* Filters are cleared on switch. A device or build filter from the other
         platform would match nothing and read as "no reviews" rather than as a
         stale filter, which is the more confusing of the two failures. */
      Object.keys(RVF).forEach(k=>RVF[k]='');
      if($('fText'))$('fText').value='';
      RVSORT={key:'date',dir:-1};
      RVSHOWN=PERF.reviewPage;
      renderReviews();
    };

    const t=$('fText');
    if(t){let timer;t.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{
      RVF.text=t.value;RVSHOWN=PERF.reviewPage;renderReviewTable();},180)}}

    const rst=$('fReset');
    if(rst)rst.onclick=()=>{
      Object.keys(RVF).forEach(k=>RVF[k]='');
      ['fFrom','fTo','fVer','fStar','fTheme'].forEach(id=>{if($(id))$(id).value=''});
      if($('fText'))$('fText').value='';
      RVSHOWN=PERF.reviewPage;
      buildReviewFilters(dated); renderReviewTable();
    };
  }
  renderReviewTable();
}

/* ==========================================================================
   VIEW MANAGER

   Each view renders the first time it is shown and is then marked clean, so
   opening the dashboard builds one page of charts instead of five. New data or
   a theme change marks every view dirty again; the visible one re-renders
   immediately and the rest wait until they are opened.

   Chart.js has to lay out against a real box, so rendering a hidden view would
   produce a chart sized to a zero-height canvas. Deferring is both faster and
   more correct.
   ========================================================================== */
const VIEWS={
  overview:{render:renderOverview,dirty:true},
  android: {render:renderAndroid, dirty:true},
  ios:     {render:renderIos,     dirty:true},
  reviews: {render:renderReviews, dirty:true}
};
let ACTIVE='overview';

function markDirty(names){
  (names||Object.keys(VIEWS)).forEach(n=>{if(VIEWS[n])VIEWS[n].dirty=true});
}
window.__themeRerender=function(){
  Chart.defaults.color=cssVar('--t2','#a6b8d4');
  Chart.defaults.borderColor=cssVar('--border','rgba(255,255,255,.08)');
  destroyAll();markDirty();ensureRendered(ACTIVE);prefetchViews();
};
function ensureRendered(name){
  const v=VIEWS[name];
  if(!v||!v.dirty)return;
  try{ v.render(); v.dirty=false; }
  catch(e){ console.error(name+' render failed',e); v.dirty=false; }
}
/* Renders the pages nobody is looking at, one per idle slice, so switching
   tabs later is instant without delaying the first paint. */
function prefetchViews(){
  const queue=Object.keys(VIEWS).filter(n=>n!==ACTIVE&&VIEWS[n].dirty);
  const idle=window.requestIdleCallback||(fn=>setTimeout(()=>fn({timeRemaining:()=>50}),120));
  const step=()=>{
    const next=queue.shift();
    if(!next)return;
    ensureRendered(next);
    if(queue.length)idle(step);
  };
  idle(step);
}
function showView(name){
  if(!VIEWS[name])return;
  ACTIVE=name;
  document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===name));
  if($('reviewMenuBtn'))$('reviewMenuBtn').classList.toggle('active',name==='reviews');
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===name));
  ensureRendered(name);
  /* Charts laid out while their container was hidden need a nudge once it is
     visible, or they keep the width they were built at. */
  requestAnimationFrame(()=>{Object.values(charts).forEach(c=>{try{c.resize()}catch(e){}})});
  window.scrollTo({top:0,behavior:'instant'});
}

/* ==========================================================================
   CLIENT-SIDE CACHE

   The core payload is kept in localStorage and painted immediately on a repeat
   visit, while the network request runs in the background. A stale dashboard
   on screen in 50ms that corrects itself a second later beats a blank one that
   is perfectly accurate whenever the round trip finishes.

   Only core is cached. Review text is far larger and would blow the ~5MB
   localStorage budget, so it is always fetched fresh.
   ========================================================================== */
/* The cached copy is stamped with a fingerprint of the session that fetched
   it. A different sign-in reads a different fingerprint, misses, and starts
   clean - so one person's numbers can never be painted onto another person's
   screen from this browser's storage. The fingerprint is a short hash, never
   the token itself. */
function sessionFingerprint(){
  const t=sessionToken();
  if(!t)return '';
  let h=0;
  for(let i=0;i<t.length;i++){ h=((h<<5)-h+t.charCodeAt(i))|0; }
  return String(h);
}

/* ── Where the cached copy lives ─────────────────────────────────────────
   This was localStorage, with lsMaxChars set to 3,500,000 - and that number
   was the problem. The hub and all four reports share ONE ~5MB localStorage
   quota, so a single ASO core payload was permitted to take 70% of it. When
   it did, Weekly's stored ranges were evicted to make room and refetched the
   next morning, and UA never attempted to persist at all.

   IndexedDB is per-origin too but measured in hundreds of megabytes, stores
   real objects with no stringify step, and is asynchronous so it never blocks
   the first paint. The ceiling and the "too big to be worth the quota" check
   both go away.

   ASO_STORE is its own key, so it cannot collide with the weekly and ua
   entries in the same database. */
const ASO_STORE='aso';

/** The stamp our stored copy carries. Empty until the server has published one. */
let ASO_STAMP='';

/* The stored copy boot() painted, so connect() can compare its stamp without
   reading IndexedDB a second time. Declared here, beside ASO_STAMP, rather
   than next to boot() at the bottom: connect() reads it, and a `let` used
   above its declaration is a temporal-dead-zone error waiting for the first
   person who calls connect() from anywhere new. */
let BOOT_CACHE=null;

async function cacheSave(core, stamp){
  return SnapshotStore.put(ASO_STORE,{
    stamp: stamp||ASO_STAMP||'',
    who: sessionFingerprint(),
    /* checkedAt is what lets SnapshotBoot skip the network for the rest of
       the day. Without a stamp there is nothing to trust, so leave it at 0
       and the next load checks again. */
    checkedAt: (stamp||ASO_STAMP) ? Date.now() : 0,
    builtAt: Date.now(),
    data: core
  });
}

async function cacheLoad(){
  try{
    const rec=await SnapshotStore.get(ASO_STORE);
    if(!rec||!rec.data)return null;
    if(rec.who!==sessionFingerprint())return null;   // different session; start clean
    return { at: rec.builtAt||0, core: rec.data, stamp: rec.stamp||'', checkedAt: rec.checkedAt||0 };
  }catch(e){ return null; }
}

/** One-off: reclaim the 3.5MB the old localStorage tier could occupy. */
try{
  const dropped=SnapshotStore.evictLegacy([PERF.lsKey,'aso_core_']);
  if(dropped)console.log('[aso] evicted '+dropped+' legacy localStorage entry(ies)');
}catch(e){}

/**
 * Asks the server whether our stored copy is still current.
 * One Script Property read on its side, ~120 bytes on the wire.
 */
async function fetchStamp(){
  const token=sessionToken();
  if(!token)return '';
  try{
    const res=await fetch(API.url,{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'stamp',token:token}),
      redirect:'follow'
    });
    const text=(await res.text()).trim();
    if(!res.ok||text.charAt(0)==='<')return '';
    const data=JSON.parse(text);
    if(!data||!data.ok)return '';
    return (data.data&&data.data.stamp)||'';
  }catch(e){ return ''; }
}

/* ==========================================================================
   CONNECT
   ========================================================================== */
let CONNECTING=false;
function setStatus(s,cls){
  const el=$('status');if(!el)return;
  el.textContent=s;
  el.classList.toggle('error',cls==='error');
  el.classList.toggle('stale',cls==='stale');
}
function clockTime(t){try{return new Date(t).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}catch(e){return ''}}
function loaderMsg(m){if($('loaderMsg'))$('loaderMsg').textContent=m}

/**
 * @param {string} part    'core' | 'reviews'
 * @param {boolean} force  ask Apps Script to rebuild rather than serve cache
 * @param {object}  win    optional {start,end} to trim the response to
 */
/**
 * One authenticated request to the ASO Apps Script project.
 *
 * POST, not GET, because that is the door Auth.gs guards. Content-Type is
 * text/plain on purpose: application/json triggers a CORS preflight, and an
 * Apps Script web app cannot answer OPTIONS.
 *
 * @param {string}  part   'core' | 'reviews'
 * @param {boolean} force  ask the server to rebuild rather than serve cache
 * @param {object}  win    optional {start,end} to trim the response to
 */
async function fetchPart(part,force,win){
  if(!API.url||API.url.indexOf('PASTE_')===0){
    throw new Error('No ASO web app URL. Open this report from the hub, or set API_DEFAULTS.url.');
  }

  const token=sessionToken();
  if(!token){
    const err=new Error('Not signed in');
    err.expired=true;
    throw err;
  }

  const body={action:'payload',token:token,parts:part};
  /* Explicit start and end rather than a day count, so the window the server
     trims to is exactly the window the chips on screen describe. */
  if(win&&win.start&&win.end){ body.start=win.start; body.end=win.end; }
  if(force)body.force='1';

  let lastError;
  for(let attempt=1;attempt<=3;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),90000);
    try{
      const res=await fetch(API.url,{
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify(body),
        redirect:'follow',
        signal:controller.signal
      });
      clearTimeout(timer);
      const text=(await res.text()).trim();

      if(!res.ok){
        const err=new Error('HTTP '+res.status+' from Apps Script');
        err.retryable=res.status===429||res.status>=500;
        throw err;
      }
      // Apps Script serves its own sign-in page with a 200, so the status code
      // alone cannot tell that apart from real data.
      if(text.charAt(0)==='<'){
        throw new Error('Apps Script returned a sign-in page — redeploy with access "Anyone"');
      }

      let data;
      try{ data=JSON.parse(text); }
      catch(e){ throw new Error('Apps Script returned invalid JSON'); }

      /* The session ran out, or the token was never valid. Retrying cannot fix
         either, so tell the hub and let it put the sign-in gate back up. */
      if(data.code===401||/^Unauthorized/i.test(String(data.error||''))){
        const err=new Error('Your session ended. Sign in again.');
        err.expired=true;
        err.retryable=false;
        throw err;
      }
      if(data.ok===false)throw new Error(data.error||'Request failed');

      const payload=data.data||data;
      if(payload.error)throw new Error(payload.message||'Request failed');
      return payload;

    }catch(e){
      clearTimeout(timer);
      lastError=e;
      if(e.expired){ tellHub('mss3d:session-expired'); throw e; }
      const retryable=e.retryable===true||e.name==='AbortError'||e instanceof TypeError;
      if(!retryable||attempt===3)break;
      await new Promise(r=>setTimeout(r,600*attempt));
    }
  }
  throw lastError||new Error('Request failed');
}

function applyCore(j){
  /* A background core refresh deliberately omits full review text. Preserve
     the recent review rows already shown while a wider core window arrives,
     instead of briefly emptying the Reviews page between phases. */
  const oldAndroidReviews=A&&A.reviews&&A.reviews.all;
  const oldIosReviews=I&&I.reviews&&I.reviews.all;
  const keptAndroid=!!(oldAndroidReviews&&oldAndroidReviews.length);
  const keptIos=!!(oldIosReviews&&oldIosReviews.length);
  A=j.android||null;
  I=j.ios||null;
  if(A&&A.reviews&&A.reviews.allOmitted&&oldAndroidReviews&&oldAndroidReviews.length){
    A.reviews.all=oldAndroidReviews;A.reviews.allOmitted=false;
  }
  if(I&&I.reviews&&I.reviews.allOmitted&&oldIosReviews&&oldIosReviews.length){
    I.reviews.all=oldIosReviews;I.reviews.allOmitted=false;
  }
  LAST_META={generatedAt:j.generatedAt||null,warnings:j.warnings||[]};
  if(j.today)SERVER_TODAY=j.today;
  if(j.fullRange&&j.fullRange.start)FULL_RANGE=j.fullRange;
  if(j.reviewWindow&&j.reviewWindow.start)REVIEW_WINDOW=j.reviewWindow;
  PARTIAL=!!j.window;                    // a window block means the reply was trimmed
  CORE_WINDOW=j.window||j.fullRange||FULL_RANGE;
  ADATES=collectDates(A);
  IDATES=collectDates(I);
  REVIEWS_READY={android:keptAndroid,ios:keptIos};
  initDateFilters();
  markDirty();
}

/**
 * Merges the background review fetch into the blocks already on screen.
 *
 * Only the Reviews page cares, so nothing else is re-rendered - marking every
 * view dirty here would rebuild all five pages of charts for data none of them
 * display.
 */
function applyReviews(j){
  if(A&&A.reviews&&j.android&&j.android.reviews){
    A.reviews.all=j.android.reviews.all||[];
    A.reviews.allOmitted=false;
    REVIEWS_READY.android=true;
  }
  if(I&&I.reviews&&j.ios&&j.ios.reviews){
    I.reviews.all=j.ios.reviews.all||[];
    I.reviews.allOmitted=false;
    REVIEWS_READY.ios=true;
  }
  if(j.window)REVIEW_WINDOW=j.window;
  /* Review-derived cards and overview comparisons also depend on the full
     review rows, so refresh every view when phase two arrives. */
  markDirty();
  ensureRendered(ACTIVE);
}

async function ensureReviewsForRange(win){
  if(!win||!win.start||!win.end||rangeContains(REVIEW_WINDOW,win))return;
  if(REVIEW_LOADING){
    try{await REVIEW_LOADING}catch(e){}
    if(rangeContains(REVIEW_WINDOW,win))return;
  }
  const request=(async()=>{
    const reviews=await fetchPart('reviews',false,win);
    applyReviews(reviews);
    return reviews;
  })();
  REVIEW_LOADING=request;
  try{return await request}finally{if(REVIEW_LOADING===request)REVIEW_LOADING=null}
}

async function connect(force){
  if(CONNECTING)return;
  CONNECTING=true;
  const btn=$('refreshBtn');
  if(btn)btn.disabled=true;

  /* A cached copy means the page is already readable, so the blocking overlay
     is skipped and the refresh happens quietly behind it. */
  const hadData=!!(A||I);
  if(!hadData){ loaderMsg('Loading Data'); $('loader').classList.add('show'); }
  setStatus(hadData?'Refreshing…':'Loading…');

  try{
    /* ── Is a fetch needed at all? ────────────────────────────────────────
       boot() has already painted whatever was on disk. If the server's stamp
       matches what that copy carries, the data behind it has not moved and
       there is nothing to fetch - not the 30-day core, not the 7-day reviews,
       not the 45-day background window. The whole load becomes one ~120-byte
       request.

       Skipped entirely on Refresh, which means "go and look again" and must
       reach the server whatever the stamp says. */
    if(!force&&hadData&&BOOT_CACHE&&BOOT_CACHE.stamp){
      const serverStamp=await fetchStamp();
      if(serverStamp&&serverStamp===BOOT_CACHE.stamp){
        ASO_STAMP=serverStamp;
        /* Re-stamp the stored copy as verified, so the rest of today skips
           even this request. */
        await cacheSave(BOOT_CACHE.core,serverStamp);
        ensureRendered(ACTIVE);
        prefetchViews();
        $('loader').classList.remove('show');
        setStatus('Loaded');
        tellHub('mss3d:report-ready');
        return;
      }
      /* Different, or the server has not published one yet. Fall through and
         fetch exactly as before. */
      if(serverStamp)ASO_STAMP=serverStamp;
    }else if(!ASO_STAMP){
      /* No usable stored copy. Learn the stamp alongside the fetch so the
         payload can be stored under it. */
      fetchStamp().then(s=>{ if(s)ASO_STAMP=s; }).catch(()=>{});
    }
    /* PHASE 1 - browser/server 30-day core window. The visual filter remains
       Last 7 Days, while 7/14/30-day switches all render from this one block. */
    const win30=rollingWindow(PERF.firstWindowDays);
    /* Refresh follows the same key as a cold opening. The forced core:d30
       rebuild refreshes both platform source caches; reviews:d7 is then read
       from that fresh source and persisted under its normal opening key. */
    const core30=await fetchPart('core',force,win30);
    applyCore(core30);
    /* Review-derived cards need row-level data for sentiment and themes. Load
       the small opening review window before the first visible render, then
       persist the merged result so later openings paint it in one pass. */
    try{
      await ensureReviewsForRange(rollingWindow(7));
      await cacheSave(Object.assign({},core30,{android:A,ios:I,reviewWindow:REVIEW_WINDOW}),ASO_STAMP);
    }catch(e){
      console.error('initial review fetch failed',e);
      await cacheSave(core30,ASO_STAMP);
      banner('rvNote',[{level:'warn',message:'Recent reviews could not be loaded: '+(e.message||e)}]);
    }
    ensureRendered(ACTIVE);
    prefetchViews();
    $('loader').classList.remove('show');
    setStatus('Loaded');

    /* Refresh only changes refresh behavior; it deliberately uses the same
       30-day core + 7-day reviews shape as an ordinary fast opening. */
    if(force){
      setStatus('Loaded');
      tellHub('mss3d:report-ready');
      return;
    }

    /* Start the 45-day memory-only prefetch immediately. It is deliberately
       not written to localStorage, so the next cold browser load stays small. */
    const core45Promise=fetchPart('core',false,rollingWindow(PERF.backgroundWindowDays));

    /* The hub queues the other reports one at a time so they never fight for
       the single Apps Script execution slot. This is its cue that ASO is
       through the heavy part and the next report may start. */
    tellHub('mss3d:report-ready');

    /* PHASE 2 - 45 days of core data in memory, never full history. Wider
       single/custom ranges are fetched only when the user asks for them. */
    try{
      const core45=await core45Promise;
      applyCore(core45);
      ensureRendered(ACTIVE);
      prefetchViews();
      setStatus('Loaded');
    }catch(e){
      console.error('45-day core fetch failed',e);
      setStatus('Loaded','stale');
    }
  }catch(e){
    setStatus(e.message||String(e),'error');
    /* An expired session is the hub's problem to solve, and it is already
       putting the gate back up. Repeating it across three banners here just
       adds noise to a screen that is about to be covered anyway. */
    if(!e.expired){
      const msg=[{level:'error',message:e.message||String(e)}];
      banner('anWarnings',msg); banner('ovWarnings',msg); banner('ioWarnings',msg);
    }
  }finally{
    CONNECTING=false;
    if(btn)btn.disabled=false;
    $('loader').classList.remove('show');
    const wanted=activeDateRange();
    if(sessionToken()&&!rangeContains(CORE_WINDOW,wanted))fetchWindowIfNeeded();
    if(sessionToken())ensureReviewsForRange(wanted).catch(e=>console.error('review range fetch failed',e));
  }
}

document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.querySelectorAll('[data-review-platform]').forEach(b=>b.onclick=()=>{
  RVPLAT=b.dataset.reviewPlatform;
  b.blur();
  document.getElementById('reviewMenuBtn')?.blur();
  Object.keys(RVF).forEach(k=>RVF[k]='');
  RVSHOWN=PERF.reviewPage;RVSORT={key:'date',dir:-1};
  if(VIEWS.reviews)VIEWS.reviews.dirty=true;
  showView('reviews');
  ensureReviewsForRange(rollingWindow(30)).catch(e=>{
    console.error('30-day review fetch failed',e);
    banner('rvNote',[{level:'warn',message:'The remaining 30-day reviews could not be loaded: '+(e.message||e)}]);
  });
});
$('refreshBtn').onclick=()=>connect(true);

/* Cached 30-day core paints immediately; reviews always come from Apps
   Script's translation-aware window caches. */
(async function boot(){
  /* cacheLoad is asynchronous now - IndexedDB never blocks the paint - so the
     boot function awaits it rather than reading synchronously. In practice
     this resolves in a few milliseconds. */
  const cached=await cacheLoad();
  if(cached){
    try{
      applyCore(cached.core);ensureRendered(ACTIVE);
      BOOT_CACHE=cached;
      ASO_STAMP=cached.stamp||'';

      /* Verified after this morning's data hour means nothing has changed
         since we last checked, so the page is simply loaded - no "updating…",
         no request. SnapshotBoot.verifiedToday owns that boundary and uses
         08:00, matching the 09:00 warm. */
      const settled=SnapshotBoot.verifiedToday({checkedAt:cached.checkedAt});
      setStatus(settled
        ? 'Loaded'
        : 'Cached · '+clockTime(cached.at)+' · updating…',
        (!settled&&Date.now()-(cached.at||0)>PERF.staleAfterMs)?'stale':null);

      if(settled){
        prefetchViews();
        tellHub('mss3d:report-ready');
        return;                       // zero network requests for this load
      }
    }catch(e){console.error('cached render failed',e);A=null;I=null;PARTIAL=true;BOOT_CACHE=null}
  }
  connect(false);
})();
