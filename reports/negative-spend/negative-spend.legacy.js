/* eslint-disable */
/* --- from negative_spend_report.html · block e20f93c233 --- */
/* ==================================================================
   UA NEGATIVE SPEND MONITOR — front end

   The server ships one snapshot at campaign x channel x day grain.
   Every date filter below is applied against that snapshot in the
   browser, so changing the window costs no server round trip. The one
   exception is a custom range that reaches further back than the
   shipped detail; that asks the server for a slice and says so.
   ================================================================== */

/* ┌──────────────────────────────────────────────────────────────┐
   │  PASTE YOUR WEB APP URL HERE                                 │
   │                                                              │
   │  Apps Script → Deploy → New deployment → Web app             │
   │    Execute as:      Me                                       │
   │    Who has access:  Anyone                                   │
   │  Copy the /exec URL and paste it between the quotes below.   │
   │                                                              │
   │  Leave it blank if Apps Script serves this page itself —     │
   │  the page detects that and talks over google.script.run.     │
   │  A ?api=<url> in the address bar overrides whatever is set   │
   │  here, which is how the hub passes it to an embedded copy.   │
   └──────────────────────────────────────────────────────────────┘ */
const API_URL   = '';
const TOKEN_KEY = 'mss3d_token';

/* ---------------------------- transport ---------------------------- */
const API={
  qs:new URLSearchParams(location.search),
  get url(){return API.qs.get('api')||API_URL||''},
  get token(){
    try{return sessionStorage.getItem(TOKEN_KEY)||API.qs.get('token')||''}
    catch(e){return API.qs.get('token')||''}
  },
  /* Served by HtmlService? Then google.script.run exists and is the faster
     path — same origin, no CORS, no retry dance. */
};

function serverCall(action,params){
  params=params||{};
  if(!API.token){
    try{window.parent.postMessage({type:'mss3d:need-token'},location.origin)}catch(e){}
    return new Promise(resolve=>setTimeout(resolve,150)).then(()=>{
      if(!API.token){
        try{window.parent.postMessage({type:'mss3d:session-expired'},location.origin)}catch(e){}
        throw new Error('Not signed in - open the hub and sign in.');
      }
      return fetchCall(action,params);
    });
  }
  if(!API.url)return Promise.reject(new Error(
    'No Negative Spend backend URL was supplied by the hub.'));
  return fetchCall(action,params);
}

/* Apps Script answers a valid request with a throttling HTML page often
   enough that a single attempt is not reliable. Four tries with backoff, and
   an HTML body is treated as transient rather than fatal. */
async function fetchCall(action,params){
  let last;
  for(let attempt=1;attempt<=4;attempt++){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),120000);
    try{
      const res=await fetch(API.url,{
        method:'POST',
        /* text/plain on purpose: application/json triggers a CORS preflight
           that an Apps Script web app cannot answer. */
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify(Object.assign({action:action,token:API.token},params)),
        redirect:'follow',
        signal:ctrl.signal
      });
      clearTimeout(timer);
      const body=(await res.text()).trim();
      if(!res.ok){
        const e=new Error('HTTP '+res.status+' from Apps Script');
        e.retryable=res.status===404||res.status===429||res.status>=500;
        throw e;
      }
      if(body.charAt(0)==='<'){
        const e=new Error(attempt<4
          ?'Apps Script returned a holding page — retrying.'
          :'Apps Script returned a sign-in page instead of data. Redeploy with "Execute as: Me" and "Who has access: Anyone".');
        e.retryable=attempt<4;
        throw e;
      }
      let data;
      try{data=JSON.parse(body)}catch(e){
        const bad=new Error('Apps Script returned an invalid JSON response.');
        bad.retryable=false;
        throw bad;
      }
      if(data.code===401||/^Unauthorized:/i.test(String(data.error||''))){
        if(attempt<4){
          try{window.parent.postMessage({type:'mss3d:need-token'},location.origin)}catch(e){}
        }else{
          try{window.parent.postMessage({type:'mss3d:session-expired'},location.origin)}catch(e){}
        }
        const denied=new Error(attempt<4?'Authentication rejected - refreshing token and retrying.':'Session expired - reload the hub and sign in again.');
        denied.retryable=attempt<4;
        throw denied;
      }
      return JSON.stringify(data);
    }catch(err){
      clearTimeout(timer);
      last=err;
      const retryable=err.retryable===true||err.name==='AbortError'||err instanceof TypeError;
      if(!retryable||attempt===4)throw err;
      setStatus('Request interrupted — retrying ('+attempt+'/4)…',true);
      await new Promise(r=>setTimeout(r,Math.min(8000,1200*Math.pow(2,attempt-1))));
    }
  }
  throw last||new Error('Request failed');
}

/* ---------------------------- theme ---------------------------- */
(function(){
  var KEY='mss3d_theme';
  function paint(mode){
    var light=(mode==='light');
    if(document.body) document.body.classList.toggle('lt',light);
    document.documentElement.setAttribute('data-theme',light?'light':'dark');
    var b=document.getElementById('themeBtn');
    if(b) b.innerHTML=light?'\u{1F319} Dark':'\u2600 Light';
  }
  window.getTheme=function(){try{return localStorage.getItem(KEY)||'dark'}catch(e){return 'dark'}};
  window.setTheme=function(m){try{localStorage.setItem(KEY,m)}catch(e){}paint(m);
    /* Charts sample their colours from CSS variables when they are built, so a
       theme flip has to rebuild them. Push it behind a paint so the CSS change
       lands first and the redraw does not block it. */
    requestAnimationFrame(function(){setTimeout(function(){if(DATA)render()},0)})};
  window.addEventListener('storage',function(ev){
    if(ev.key===KEY)paint(ev.newValue||'dark');
  });
  paint(window.getTheme());
})();

/* --------------------------- constants --------------------------- */
const MS_DAY=86400000;
const COLORS={blue:'#4d9fff',teal:'#00e5c3',pink:'#ec0a9b',line:'#a6b8d4',green:'#00c47a',amber:'#ffb800',coral:'#ff4d6d'};
/* Verdict → the label and colour the charts use. Order is worst first, which is
   the order the money should be looked at in. */
const VERDICT_VIEW=[
  ['FAIL - cut','Cut','--coral','#ff4d6d'],
  ['OVER BUDGET','Over budget','--pink','#ec0a9b'],
  ['UNDER TARGET','Under target','--amber','#ffb800'],
  ['NO BUDGET - set one','No budget cap','--blue','#4d9fff'],
  ['NO GOAL - map it','No goal mapped','--pink','#ec0a9b'],
  ['INSUFFICIENT DATA','Too young to judge','--t3','#7589a8'],
  ['PENDING','Pending','--blue','#4d9fff'],
  ['PASS','Passing','--green','#00c47a']
];

/* Google Ads cannot be graded on payback here: its install and revenue
   attribution is unusable (eCPI in pennies, margins past -100%), so a ROAS
   verdict on it would be noise dressed up as a decision. It is judged on the
   one number that is certainly true - what it spent against the cap it was
   given. Every other network is judged on budget AND payback. */
/*
 * How a campaign is judged is a SETTING, not a rule in the code.
 *
 *   'budget'  spend against its cap decides. Payback is shown but never votes.
 *   'roas'    payback against its target decides. A cap is shown but never votes.
 *   'both'    either one can put the campaign on the list.
 *
 * A campaign answers for itself in the Judge On column. When it has not, the
 * network default below decides, and anything unlisted is 'both'. Google Ads
 * defaults to 'budget' because its install and revenue data is not reliable
 * enough to grade payback on — but it is only a default now, so a single Google
 * campaign can be moved onto 'both' from Campaign settings without a code change.
 * The defaults ship from the server (CFG.NETWORK_JUDGE) so both ends agree.
 */
const JUDGE_MODES=['budget','roas','both'];
const JUDGE_LABEL={budget:'budget only',roas:'ROAS only',both:'budget + ROAS'};
const normJudge=v=>{const j=String(v||'').trim().toLowerCase();
  return JUDGE_MODES.indexOf(j)>=0?j:''};
const networkJudge=channel=>normJudge((DATA&&DATA.networkJudge||{})[String(channel||'').trim().toLowerCase()])||'both';
/** The rule in force for a campaign on a date, setting first, network second. */
function judgeModeAt(campaign,channel,iso){
  const e=settingOn(campaign,channel,iso);
  return normJudge(e&&e.judge)||networkJudge(channel);
}
/** Kept as a boolean because twenty call sites read it that way. */
const isBudgetOnly=channel=>networkJudge(channel)==='budget';
const GOAL_DAYS={D0:0,D7:7,D28:28,D30:30};

/* The three verdicts that need a human. Everything else the engine can decide
   on its own, so it never reaches the watchlist. Rank orders the table: what
   to cut first, then what to watch, then what is not even being judged. */
const WATCH=['FAIL - cut','OVER BUDGET','UNDER TARGET','NO BUDGET - set one','NO GOAL - map it'];
const WATCH_RANK={'FAIL - cut':0,'OVER BUDGET':1,'UNDER TARGET':2,'NO BUDGET - set one':3,'NO GOAL - map it':4};
const WATCH_LABEL={'FAIL - cut':'CUT','OVER BUDGET':'OVER BUDGET','UNDER TARGET':'UNDER',
  'NO BUDGET - set one':'NO CAP','NO GOAL - map it':'MAP IT'};
const WATCH_BADGE={'FAIL - cut':'b-bad','OVER BUDGET':'b-map','UNDER TARGET':'b-warn',
  'NO BUDGET - set one':'b-info','NO GOAL - map it':'b-map'};
/* Verdicts that rest on cohorts old enough to judge — the payback headline and
   every network payback figure are built from these rows only. */
const JUDGED={'PASS':1,'UNDER TARGET':1,'FAIL - cut':1};
/* Verdicts that need nobody. They are hidden by default - a list of things to
   do should not contain things that are fine - but they stay selectable, so a
   campaign that quietly passed can still be looked at without hunting. */
const QUIET=['PASS','INSUFFICIENT DATA','PENDING'];
const QUIET_LABEL={'PASS':'OK','INSUFFICIENT DATA':'TOO YOUNG','PENDING':'PENDING'};
const QUIET_BADGE={'PASS':'b-ok','INSUFFICIENT DATA':'b-mute','PENDING':'b-mute'};
const decisionLabel=v=>WATCH_LABEL[v]||QUIET_LABEL[v]||v;
const decisionBadge=v=>WATCH_BADGE[v]||QUIET_BADGE[v]||'b-mute';
const WATCH_TOP=25;

/* The window the page opens on.
 *
 * This was 'w2'. Two weeks cannot answer the question the page asks: a D7
 * verdict needs cohorts that have reached day 7 and a D28 verdict cohorts that
 * have reached day 28, and a fortnight contains none of the latter. That is
 * why the payback ladder read 0.000x, why "spend not judged" was 100% of the
 * window, and why "Spend at risk" said $0.00 directly above a list of
 * campaigns to cut. None of those were bugs in the arithmetic - the window was
 * simply too narrow to have an opinion.
 *
 * 13 weeks is the shortest window that can judge both. Where the sheet holds
 * less history than that, the page shows what exists and says so rather than
 * padding the gap.
 */
let DATA=null, FINGERPRINT='', DATE_FILTER='w13', RANGE_START='', RANGE_END='', PLATFORM='android', LAST_LOAD_TIME='';
let LAST_SNAPSHOT_SYNC=0;
let ROWS_BY_DAY=[], DAY_MS=[], WINDOW_CACHE=new Map();
let SLICE=null;                       /* server-computed rows for a deep custom range */
let FILTERS={campChannel:'all',campCampaign:'all',campGoal:'all',campVerdict:'all',decision:'all',campRev:'all',
              hisChannel:'all',hisCampaign:'all',hisPeriod:'daily',mapChannel:'all',
              marginPeriod:'daily',marginChannel:'all',marginCampaign:'all',
              budPeriod:'weekly',budChannel:'all',budCampaign:'all'};
let WATCH_ALL=false;
const charts={};

/* ------------------------- campaign settings -------------------------
   Goal window, target ROAS and budget live in the workbook, not in this
   browser. Settings_Log holds one row per dated change; Campaign_Map holds
   whichever of them is in force today, which is what the sheet's own formulas
   and this dashboard both read.

   A setting is keyed by campaign + channel + REVENUE TYPE, so the same
   campaign can be run on one target for its ad revenue and another for its
   IAP, each with its own dates. Set it on "all" and there is a single row
   covering both streams, which is the usual case.

   A change is a period, not a value: a target set on 23 Aug and moved again
   on 5 Sep gives 23 Aug – 4 Sep on the first figure and 5 Sep onward on the
   second. Every reading below is measured inside its own period, on the
   settings that were in force during it. */
let SETTINGS=[];            /* flat list straight from Settings_Log */
let OVERRIDES={};           /* "campaign||channel||revType" -> [entry, ...] */
let BASE_MAP=null;          /* what Campaign_Map says, so a reset is honest */
let SAVE_TIMER=null,SAVE_QUEUE={};
/* Set only by spanWindow(), which is already reading one named period and must
   not have the window re-resolve settings underneath it. '' everywhere else. */
let SETTINGS_BASIS_FORCE='';
const GOALS=['D0','D7','D28','D30'];
const REV_TYPES=['all','ad','iap'];
const REV_LABEL={all:'all revenue',ad:'ad revenue',iap:'IAP revenue'};

function setKey(campaign,channel,revType){return campaign+'||'+channel+'||'+(revType||'all')}
function keyParts(key){
  const p=String(key).split('||');
  return{campaign:p[0],channel:p[1]||'',revType:p[2]||'all'};
}
/** The campaign+channel half of a settings key — what Campaign_Map is keyed on. */
function campHalf(key){const p=keyParts(key);return p.campaign+'||'+p.channel}
function campKeyOf(row){return row[0]+'||'+DATA.channels[row[1]]}

/** Rebuild the index the settings window works against. */
function indexSettings(){
  OVERRIDES={};
  (SETTINGS||[]).forEach((e,i)=>{
    const k=setKey(e.campaign,e.channel,e.revType||'all');
    (OVERRIDES[k]=OVERRIDES[k]||[]).push({
      from:e.from||'',goal:e.goal||'',revType:e.revType||'all',
      target:(e.target===''||e.target==null)?'':e.target,
      budget:(e.budget===''||e.budget==null)?'':e.budget,
      /* '' = a row written before the mode columns existed, so a blank cell on
         it inherits rather than meaning "deliberately none". */
      tmode:e.tmode==='value'?'value':(e.tmode==='auto'?'auto':''),
      bmode:e.bmode==='value'?'value':(e.bmode==='none'?'none':''),
      judge:normJudge(e.judge),
      updated:e.updated||'',os:e.os||'',seq:i,
      action:e.action==='cleared'?'cleared':'set'
    });
  });
  PERIOD_CACHE.clear();
}

/* ------------------------- settings periods -------------------------
 * Settings_Log records CHANGES. Everything downstream needs PERIODS — what was
 * in force between one change and the next — and the two are not the same
 * thing: a change that moves only the budget says nothing about the target, and
 * the target already running has to carry into the new period rather than
 * disappearing because that box was left alone.
 *
 * periodsFor() does that fold, once per key, cached until the settings change.
 * Nothing is rewritten; the carry-forward happens on the way out, so the log
 * rows stay exactly as the sheet holds them.
 * ------------------------------------------------------------------- */
const PERIOD_CACHE=new Map();

/* Oldest first. Two entries can share a date — the log keeps both — so the
   order they arrived in breaks the tie. */
function entriesFor(key){
  const list=(OVERRIDES[key]||[]).map((e,i)=>({e:e,i:i}));
  list.sort((a,b)=>String(a.e.from||'').localeCompare(String(b.e.from||''))||(a.i-b.i));
  return list.map(x=>x.e);
}

/** The change list for one stream, folded into periods with carry-forward. */
function periodsFor(key){
  if(PERIOD_CACHE.has(key))return PERIOD_CACHE.get(key);
  const out=[];
  let prev=null;
  entriesFor(key).forEach(c=>{
    if(c.action==='cleared'){
      /* A clear ends the run — nothing carries across it, because "stopped
         managing this from here" cannot quietly keep a budget alive. */
      out.push({from:c.from||'',goal:'',revType:c.revType,target:'',budget:'',
                judge:'',action:'cleared',updated:c.updated||''});
      prev=null;
      return;
    }
    let target=c.target,budget=c.budget,goal=c.goal;
    if(target===''&&c.tmode!=='auto'&&prev)target=prev.target;
    if(budget===''&&c.bmode!=='none'&&prev)budget=prev.budget;
    if(!goal&&prev)goal=prev.goal;
    /* Judge On carries forward too — changing a budget must not silently send
       the campaign back to its network's default rule. */
    const judge=c.judge||(prev?prev.judge:'');
    const p={from:c.from||'',goal:goal,revType:c.revType,target:target,budget:budget,
             judge:judge,action:'set',updated:c.updated||'',os:c.os||''};
    out.push(p);
    prev=p;
  });
  PERIOD_CACHE.set(key,out);
  return out;
}

/**
 * The period in force on a date: the last one whose effective date is on or
 * before it. This is the single rule the whole dashboard reads settings by.
 */
function effectiveAt(key,iso){
  const list=periodsFor(key);
  let out=null;
  for(let i=0;i<list.length;i++){
    if(!list[i].from||(iso&&list[i].from<=iso))out=list[i];
  }
  return out;
}
/** The same, but a cleared row means nothing is running on that stream. */
function activeAt(key,iso){
  const e=effectiveAt(key,iso);
  return (e&&e.action!=='cleared')?e:null;
}
/** Every revenue type this campaign has a saved setting for. */
function variantsOf(campaign,channel){
  const half=campaign+'||'+channel;
  return REV_TYPES.map(rt=>setKey(campaign,channel,rt))
    .filter(k=>campHalf(k)===half&&(OVERRIDES[k]||[]).length);
}
/** Streams still being managed from here — a cleared one has stepped out. */
function liveVariantsOf(campaign,channel,asOf){
  return variantsOf(campaign,channel).filter(k=>activeAt(k,asOf));
}
/**
 * The one setting the workbook itself is carrying for a campaign: newest
 * applied wins, whichever revenue type it belongs to, because Campaign_Map has
 * a single row per campaign + channel and L3 reads that row.
 */
function sheetEntry(campaign,channel,asOf){
  let best=null,bestKey='';
  variantsOf(campaign,channel).forEach(k=>{
    const e=activeAt(k,asOf);
    if(!e)return;
    if(!best||String(e.from||'')>=String(best.from||'')){best=e;bestKey=k}
  });
  return best?{entry:best,key:bestKey}:null;
}
function captureBaseMap(){
  BASE_MAP=DATA.campaigns.map(c=>[c[4],c[5],c[6],c[7]]);
}

/** The stretch of days one entry governs, clipped to the data on hand. */
function entrySpan(key,idx){
  const list=periodsFor(key),first=DATA.days[0],last=DATA.days[DATA.days.length-1];
  const e=list[idx];
  /* Nothing saved yet means one period: everything, on the sheet's own values. */
  if(!e)return{from:first,to:last,started:'',open:true};
  let from=e.from||first;
  const next=list[idx+1];
  const nextFrom=next?(next.from||''):'';
  /* Applied and replaced on the same day: it never governed a day of spend. */
  if(next&&String(nextFrom)===String(e.from||'')){
    return{from:e.from||first,to:e.from||first,started:e.from||'',nextFrom:nextFrom,
           open:false,superseded:true,pending:false};
  }
  let to=nextFrom?isoShift(nextFrom,-1):last;
  if(from<first)from=first;
  if(to>last)to=last;
  return{from:e.from||first,to:to,started:e.from||'',nextFrom:nextFrom,
         open:!nextFrom,pending:(e.from||'')>last};
}

/**
 * One window measured over an arbitrary period. Only the campaign being read
 * is re-pointed at the settings it carried then — every other campaign keeps
 * what Campaign_Map says, since nothing else on the row depends on them. The
 * campaign table is put back before this returns and the shared cache cleared
 * on both sides, so nothing outside this call ever sees the swap.
 */
const SPAN_CACHE=new Map();
function spanWindow(from,to,campIdx,entry){
  if(!from||!to||from>to)return null;
  const sig=from+'|'+to+'|'+PLATFORM+'|'+(campIdx==null?'-':campIdx)+'|'+
    (entry?[entry.goal||'',entry.revType||'',entry.target===''?'':entry.target].join(','):'-');
  if(SPAN_CACHE.has(sig))return SPAN_CACHE.get(sig);

  const row=(campIdx!=null&&campIdx>=0)?DATA.campaigns[campIdx]:null;
  const held=row?[row[4],row[5],row[6],row[7]]:null;
  if(row&&entry){
    if(entry.goal)row[4]=entry.goal;
    if(entry.revType)row[5]=entry.revType;
    row[6]=(entry.target===''||entry.target==null)?null:Number(entry.target);
    if(entry.goal)row[7]=true;        /* a goal set here is a goal, mapped or not */
  }
  const saved={filter:DATE_FILTER,start:RANGE_START,end:RANGE_END,slice:SLICE,
               basis:SETTINGS_BASIS_FORCE};
  DATE_FILTER='custom';RANGE_START=from;RANGE_END=to;SLICE=null;
  /* The entry swapped onto the row above IS the period being read, so the
     window must take the row at face value rather than resolving settings for
     itself and overwriting it. */
  SETTINGS_BASIS_FORCE='meta';
  WINDOW_CACHE.clear();
  let W=null;
  try{W=computeWindow()}
  finally{
    DATE_FILTER=saved.filter;RANGE_START=saved.start;RANGE_END=saved.end;SLICE=saved.slice;
    SETTINGS_BASIS_FORCE=saved.basis;
    if(row&&held){row[4]=held[0];row[5]=held[1];row[6]=held[2];row[7]=held[3]}
    WINDOW_CACHE.clear();
  }
  SPAN_CACHE.set(sig,W);
  return W;
}

function campIndexOf(campaign,channel){
  return DATA.campaigns.findIndex(c=>campKeyOf(c)===campaign+'||'+channel);
}

/** Budget in force for one settings row, or null when none was entered. */
function budgetOf(key,asOf){
  const e=activeAt(key,asOf);
  if(!e||e.budget===''||e.budget==null)return null;
  const v=Number(e.budget);
  return isFinite(v)&&v>0?v:null;
}
/** The budget the workbook is carrying for a campaign, across revenue types. */
function liveBudget(campaign,channel,asOf){
  const live=sheetEntry(campaign,channel,asOf);
  if(!live||live.entry.budget===''||live.entry.budget==null)return null;
  const v=Number(live.entry.budget);
  return isFinite(v)&&v>0?v:null;
}

/* -------------------- current rules vs historical rules --------------------
 * Two questions get asked of the settings layer and they want different
 * answers:
 *
 *   "how are we doing under what we are running NOW"   -> latest period
 *   "how did this window actually go"                  -> the period that was
 *                                                         in force on each day
 *
 * A preset window that runs up to the newest day of data is the first question:
 * it is the standing view of the account, and the benchmark it should be read
 * against is the one in force today. A custom range, or a preset that has been
 * pushed back off the end of the data, is the second: it is a look at history,
 * and history has to be graded on the rules that were running at the time.
 * ------------------------------------------------------------------------- */

/** True when the selected window is a look back rather than the standing view. */
/*
 * Every window is read on the settings that were in force on each of its days.
 * Always — a preset and a hand-typed range covering the same dates have to give
 * the same answer, and they did not before: a preset used today's cap across
 * the whole window, so a budget raised on the 9th was applied back over the 1st
 * to the 8th as well. Spend that ran under a $2,000 cap is not measured against
 * $12,000 because that is what the campaign is on now.
 *
 * What the campaign carries TODAY is still kept, in curBudget / curTarget, for
 * the "now running" note and for a cap dated after the range (budgetPending).
 */
function isHistoricalRange(){
  if(SETTINGS_BASIS_FORCE)return SETTINGS_BASIS_FORCE==='perDate';
  /* Before the first snapshot there are no days to resolve against. */
  if(!DATA||!DATA.days||!DATA.days.length)return false;
  return true;
}

/** The settings a campaign is running under right now, whatever the window. */
function currentPeriod(campaign,channel){
  const live=sheetEntry(campaign,channel,todayISO());
  return live?live.entry:null;
}
function currentBudgetOf(campaign,channel){
  const e=currentPeriod(campaign,channel);
  if(!e||e.budget===''||e.budget==null)return null;
  const v=Number(e.budget);
  return isFinite(v)&&v>0?v:null;
}
function currentTargetOf(campaign,channel){
  const e=currentPeriod(campaign,channel);
  if(!e||e.target===''||e.target==null)return null;
  const v=Number(e.target);
  return isFinite(v)?v:null;
}

/* --------------------------- formatting --------------------------- */
/* Canvas text is almost entirely numbers — axis ticks, tooltip values — so the
   charts take the numeric face too. Chart.defaults.color is re-read on every
   render rather than pinned once, otherwise the light theme keeps the dark
   theme's tick colour. */
if(typeof Chart!=='undefined'){
  Chart.defaults.font.family="'Segoe UI',Arial,sans-serif";
  Chart.defaults.font.weight='400';
  Chart.defaults.font.size=11;
  Chart.defaults.plugins.legend.labels.font={family:"'Segoe UI',Arial,sans-serif",size:12.5,weight:'600'};
  Chart.defaults.plugins.legend.labels.padding=16;
  if(Chart.defaults.scales&&Chart.defaults.scales.linear&&Chart.defaults.scales.linear.ticks){
    Chart.defaults.scales.linear.ticks.font={family:'Poppins,system-ui,sans-serif',weight:'400'};
  }
}

const $=id=>document.getElementById(id);
const num=v=>Number(v)||0;
/* Compact above 100K keeps KPI cards short, but a whole million collapsing to
   "$1M" loses the hundreds of thousands — so past a million it keeps a decimal
   and reads $1.3M rather than $1M. */
const money=v=>{const n=Number(v)||0,a=Math.abs(n);
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',
    notation:a>=100000?'compact':'standard',
    maximumFractionDigits:a>=1000000?1:(a>=1000?0:2)}).format(n)};
const money0=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v||0);
const money2=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v||0);
const compact=v=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(v||0);
const pctOf=v=>(v==null||!isFinite(v))?'—':(v*100).toFixed(1)+'%';
const x2=v=>(v==null||!isFinite(v))?'—':v.toFixed(2)+'x';
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const shortDate=iso=>{const d=isoToDate(iso);return d?d.toLocaleDateString('en-US',{month:'short',day:'numeric'}):String(iso)};
const WD=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function isoToDate(iso){if(!iso)return null;const p=String(iso).split('-');const d=new Date(+p[0],+p[1]-1,+p[2]);return isNaN(d)?null:d}
function isoShift(iso,days){const d=isoToDate(iso);d.setDate(d.getDate()+days);return toISO(d)}
function toISO(d){const m=String(d.getMonth()+1).padStart(2,'0'),y=String(d.getDate()).padStart(2,'0');return d.getFullYear()+'-'+m+'-'+y}
function setStatus(s,isError){$('status').textContent=s;$('status').classList.toggle('error',!!isError)}
function loadedNow(){LAST_LOAD_TIME=new Date().toLocaleTimeString('en-US');setLoadedStatus()}
function setLoadedStatus(){if(LAST_LOAD_TIME)setStatus('Loaded')}
function positionLoader(){
  const box=$('loader')&&$('loader').querySelector('.loaderbox');
  if(!box)return;
  let centre=window.innerHeight/2;
  try{
    if(window.frameElement&&window.parent!==window){
      const frameRect=window.frameElement.getBoundingClientRect();
      const visibleTop=Math.max(58,-frameRect.top);
      const visibleBottom=Math.min(window.innerHeight,window.parent.innerHeight-frameRect.top);
      if(visibleBottom>visibleTop)centre=(visibleTop+visibleBottom)/2;
    }
  }catch(e){/* standalone and cross-origin fall back to this viewport */}
  box.style.top=Math.max(70,centre-58)+'px';
}
function showLoader(on){
  $('loader').classList.toggle('show',!!on);
  if(on)positionLoader();
}

/* ============================ DATA LOAD ============================ */

function boot(){
  if(!API.embedded&&!API.url){
    setStatus('No web app URL configured',true);
    document.querySelectorAll('.tablewrap').forEach(el=>{
      el.innerHTML='<div class="empty">This page is not connected to a spreadsheet.<br>'+
        'Open UA Negative Spend from the UA inner-page button in the hub.</div>';
    });
    return;
  }
  /* Paint from the browser's own copy first — it is either current, in which
     case the fingerprint check confirms it in one small call, or it is stale,
     in which case the fresh snapshot overwrites it a second later. Either way
     the user sees numbers immediately instead of a spinner. */
  const cached=readLocal();
  if(cached){
    FINGERPRINT=cached.fingerprint;
    applyPayload(cached.payload,true);
    setStatus('Showing your last load · checking for new data…');
  }else{
    showLoader(true);
    setStatus('Loading…');
  }
  /* Settings rows can be deleted directly in the workbook without changing the
     data fingerprint. Ask for a full snapshot so Settings History mirrors the
     sheet instead of preserving a deleted row from the browser cache. */
  refreshSnapshot();
}

function refreshSnapshot(){
  LAST_SNAPSHOT_SYNC=Date.now();
  fetchSnapshot('');
}

function fetchSnapshot(fp){
  serverCall('getSnapshot',{fingerprint:fp||''})
    .then(txt=>{
      let res;
      try{res=JSON.parse(txt)}catch(e){return failLoad('The server returned a response the page could not read.')}
      if(!res.ok)return failLoad(res.error||'The server could not build the snapshot.');
      if(res.unchanged){
        showLoader(false);
        loadedNow();
        return;
      }
      FINGERPRINT=res.fingerprint;
      writeLocal(res.fingerprint,res.payload);
      applyPayload(res.payload,false);
      showLoader(false);
      loadedNow();
    })
    .catch(err=>failLoad(err&&err.message?err.message:String(err)));
}

function failLoad(msg){
  showLoader(false);
  setStatus(msg,true);
  if(!DATA){
    document.querySelectorAll('.tablewrap').forEach(el=>{
      el.innerHTML='<div class="empty">'+esc(msg)+'<br>Use Refresh once the sheet is reachable.</div>';
    });
  }
}

function readLocal(){
  try{
    const raw=localStorage.getItem('uansm_snapshot');
    if(!raw)return null;
    const obj=JSON.parse(raw);
    return (obj&&obj.payload&&obj.payload.days)?obj:null;
  }catch(e){return null}
}
function writeLocal(fp,payload){
  try{localStorage.setItem('uansm_snapshot',JSON.stringify({fingerprint:fp,payload:payload}))}
  catch(e){/* over quota — the cache is a convenience, not a requirement */}
}

function applyPayload(payload,fromCache){
  DATA=payload;
  SLICE=null;
  WINDOW_CACHE.clear();
  indexPayload();
  captureBaseMap();
  SETTINGS=payload.settings||[];
  indexSettings();
  SPAN_CACHE.clear();
  initDateFilters(!fromCache);
  populateSelectors();
  render();
  try{window.parent.postMessage({type:'mss3d:report-ready',report:'ua-negative-spend'},location.origin)}catch(e){}
}

/** Buckets detail rows by day index so a window is a slice, not a scan. */
function indexPayload(){
  DAY_MS=DATA.days.map(d=>isoToDate(d).getTime());
  ROWS_BY_DAY=DATA.days.map(()=>[]);
  DATA.rows.forEach(r=>{const b=ROWS_BY_DAY[r[1]];if(b)b.push(r)});
}

/* ========================== DATE WINDOWING ========================== */
/* Presets match UA: complete Monday-Sunday weeks only. The current unfinished
   week is excluded even when RAW already contains some of its days. */

function anchorISO(){return DATA.days.length?DATA.days[DATA.days.length-1]:null}

function lastClosedSundayISO(){
  const now=new Date();
  const closed=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  closed.setTime(closed.getTime()-1);          // last instant before today
  closed.setDate(closed.getDate()-closed.getDay());
  return toISO(closed);
}

/* Keep the same calendar-week definition as ua_report.html. Every weekly
   period starts on Monday and is labelled through the following Sunday,
   regardless of which individual days happened to contain spend. */
function weekStartMondayISO(iso){
  const date=isoToDate(iso),shift=(date.getDay()+6)%7;
  return isoShift(iso,-shift);
}

function windowISO(){
  const anchor=anchorISO();
  if(!anchor)return{from:null,to:null};
  if(DATE_FILTER==='all')return{from:DATA.days[0],to:anchor};
  if(DATE_FILTER==='custom')return{from:RANGE_START||DATA.days[0],to:RANGE_END||anchor};
  const weeks=Number(/^w(\d+)$/.exec(DATE_FILTER)[1]);
  const sunday=lastClosedSundayISO();
  return{from:isoShift(sunday,-(weeks*7-1)),to:sunday};
}

function activeRangeLabel(){
  const w=windowISO();
  if(!w.from||!w.to)return '';
  return shortDate(w.from)+' \u2013 '+shortDate(w.to);
}

/** Day indices covered by the current window, within the shipped detail. */
function windowIdx(){
  const w=windowISO();
  const days=SLICE?SLICE.days:DATA.days;
  let si=-1,ei=-1;
  for(let i=0;i<days.length;i++){
    if(days[i]>=w.from&&days[i]<=w.to){if(si<0)si=i;ei=i}
  }
  return{si:si,ei:ei,from:w.from,to:w.to,days:days};
}

/* A custom range that predates the shipped detail is the one case the browser
   cannot answer on its own. Ask the server for exactly that slice and hold it
   until the filter changes again. */
function needsServerSlice(){
  if(DATE_FILTER!=='custom'||!RANGE_START)return false;
  return !!(DATA.meta.detailStart&&RANGE_START<DATA.meta.detailStart);
}

function loadServerSlice(cb){
  const w=windowISO();
  setStatus('That range predates the loaded detail — fetching it…');
  showLoader(true);
  serverCall('getRangeSlice',{from:w.from,to:w.to})
    .then(txt=>{
      let res;
      try{res=JSON.parse(txt)}catch(e){res={ok:false,error:'Unreadable response'}}
      if(!res.ok){showLoader(false);setStatus(res.error||'That range could not be built.',true);return}
      /* The slice carries its own campaign and channel tables; map them onto
         the loaded ones so verdict logic and filters keep working. */
      SLICE=remapSlice(res);
      WINDOW_CACHE.clear();
      cb();
    })
    .catch(err=>{showLoader(false);setStatus(String(err&&err.message||err),true)});
}

function remapSlice(res){
  const campKey=c=>c[0]+'||'+res.channels[c[1]];
  const known={};
  DATA.campaigns.forEach((c,i)=>{known[c[0]+'||'+DATA.channels[c[1]]]=i});
  const campaigns=DATA.campaigns.slice(), channels=DATA.channels.slice();
  const remap=res.campaigns.map(c=>{
    const key=campKey(c);
    if(known[key]!=null)return known[key];
    let ci=channels.indexOf(res.channels[c[1]]);
    if(ci<0){ci=channels.length;channels.push(res.channels[c[1]])}
    const idx=campaigns.length;
    campaigns.push([c[0],ci,c[2],c[3],c[4],c[5],c[6],c[7]]);
    known[key]=idx;
    return idx;
  });
  const rows=res.rows.map(r=>{const o=r.slice();o[0]=remap[r[0]];return o});
  const byDay=res.days.map(()=>[]);
  rows.forEach(r=>byDay[r[1]].push(r));
  return{days:res.days,rows:rows,byDay:byDay,campaigns:campaigns,channels:channels};
}

/* =========================== AGGREGATION =========================== */
/* One pass over the window builds every table and chart on the page. With a
   45-day sheet that is ~2,000 rows, which is a couple of milliseconds — the
   reason a filter change can repaint without touching the server. */

/* platform: omitted follows the header dropdown; 'ios'/'android'/'all' force a
   specific slice, which is how the Platform page holds both at once. */
function computeWindow(platform){
  const plat=platform||PLATFORM;
  const key=DATE_FILTER+'|'+RANGE_START+'|'+RANGE_END+'|'+plat+'|'+(SLICE?'slice':'main')+
            '|'+(SETTINGS_BASIS_FORCE||'auto');
  if(WINDOW_CACHE.has(key))return WINDOW_CACHE.get(key);

  const A=DATA.assumptions;
  const idx=windowIdx();
  const days=idx.days;
  const byDay=SLICE?SLICE.byDay:ROWS_BY_DAY;
  const campaigns=SLICE?SLICE.campaigns:DATA.campaigns;
  const channels=SLICE?SLICE.channels:DATA.channels;

  const out={from:idx.from,to:idx.to,platform:plat,days:[],daily:[],channels:{},os:{},campaigns:[],
             totals:{cost:0,inst:0,ad:0,iap:0},empty:idx.si<0,
             matureDays:{D7:0,D28:0,D30:0,total:0},campaignList:campaigns,channelList:channels};

  if(idx.si<0){WINDOW_CACHE.set(key,out);return out}

  /* Maturity cut-offs are dates, not positions. The sheet writes them as
     "report date minus 8/29/31"; report date is the day after the window ends,
     so the equivalent here is "window end minus 7/28/30". Comparing dates
     rather than array indices keeps this correct when a day carries no spend
     at all and is therefore absent from the day list. */
  const cut={D7:isoShift(idx.to,-7),D28:isoShift(idx.to,-28),D30:isoShift(idx.to,-30)};
  const perCamp={};

  /*
   * Which rules this window is read under.
   *
   *   'meta'       spanWindow is driving and has already pointed the campaign
   *                row at one named period. Leave it alone.
   *   'historical' a look back. Every day is graded on the target in force on
   *                that day, blended by the spend that ran under each, so a
   *                window crossing a change is not judged end-to-end on
   *                whichever setting happens to be newest.
   *   'current'    the standing view. The campaign's latest target is the
   *                benchmark, which is what "how are we doing under what we are
   *                running now" means.
   */
  const winBasis=SETTINGS_BASIS_FORCE==='meta'?'meta'
    :(isHistoricalRange()?'historical':'current');
  const walkSettings=winBasis==='historical'&&Object.keys(OVERRIDES||{}).length>0;
  /* One lookup per campaign per day is enough work to be worth remembering,
     and a window redraw asks for the same pairs over and over. */
  const setCache=new Map();
  const targetOnDay=(camp,chan,iso)=>{
    const ck=camp[0]+'||'+chan+'||'+iso;
    if(setCache.has(ck))return setCache.get(ck);
    const e=settingOn(camp[0],chan,iso);
    const v=(e&&e.target!==''&&e.target!=null&&isFinite(Number(e.target)))?Number(e.target):null;
    setCache.set(ck,v);
    return v;
  };

  for(let di=idx.si;di<=idx.ei;di++){
    const bucket=byDay[di]||[];
    const iso=days[di];
    const day={iso:iso,wd:WD[isoToDate(iso).getDay()],cost:0,inst:0,ad:0,iap:0};
    for(let j=0;j<bucket.length;j++){
      const r=bucket[j];
      const ci=r[0];
      const camp=campaigns[ci];
      const os=String(camp[2]||'unknown').toLowerCase();
      /* Platform lives on the campaign, not the row, so the filter is a lookup
         rather than another column in the payload. */
      if(plat!=='all'&&os!==plat)continue;
      day.cost+=r[2];day.inst+=r[3];day.ad+=r[4];day.iap+=r[5];

      const chan=channels[camp[1]];

      let ch=out.channels[chan];
      if(!ch)ch=out.channels[chan]={name:chan,cost:0,inst:0,ad:0,iap:0};
      ch.cost+=r[2];ch.inst+=r[3];ch.ad+=r[4];ch.iap+=r[5];

      let o=out.os[os];
      if(!o)o=out.os[os]={name:os,cost:0,inst:0,ad:0,iap:0};
      o.cost+=r[2];o.inst+=r[3];o.ad+=r[4];o.iap+=r[5];

      let c=perCamp[ci];
      if(!c)c=perCamp[ci]={cost:0,inst:0,ad:0,iap:0,adD0:0,iapD0:0,
                           cost7:0,adD7:0,iapD7:0,cost28:0,adD28:0,iapD28:0,
                           cost30:0,adD30:0,iapD30:0,tw:0,tc:0};
      c.cost+=r[2];c.inst+=r[3];c.ad+=r[4];c.iap+=r[5];
      /* The rate this day's money was actually held to. Days under no saved
         target contribute nothing, so the blend is over the spend that had one
         and the rest falls back to the sheet exactly as it always did. */
      if(walkSettings&&r[2]>0){
        const dt=targetOnDay(camp,chan,iso);
        if(dt!=null){c.tw+=dt*r[2];c.tc+=r[2]}
      }
      c.adD0+=r[6];c.iapD0+=r[7];
      if(iso<=cut.D7){c.cost7+=r[2];c.adD7+=r[8];c.iapD7+=r[9]}
      if(iso<=cut.D28){c.cost28+=r[2];c.adD28+=r[10];c.iapD28+=r[11]}
      if(iso<=cut.D30){c.cost30+=r[2];c.adD30+=r[10];c.iapD30+=r[11]}
    }
    day.all=day.ad+day.iap;
    day.gp=day.all-day.cost;
    day.margin=day.all?day.gp/day.all:null;
    day.ecpi=day.inst?day.cost/day.inst:null;
    day.roi=day.cost?day.all/day.cost:null;
    out.daily.push(day);
    out.days.push(days[di]);
    out.totals.cost+=day.cost;out.totals.inst+=day.inst;out.totals.ad+=day.ad;out.totals.iap+=day.iap;
  }

  out.matureDays.total=out.daily.length;
  out.matureDays.D7=out.days.filter(d=>d<=cut.D7).length;
  out.matureDays.D28=out.days.filter(d=>d<=cut.D28).length;
  out.matureDays.D30=out.days.filter(d=>d<=cut.D30).length;

  out.totals.all=out.totals.ad+out.totals.iap;
  out.totals.gp=out.totals.all-out.totals.cost;
  out.totals.margin=out.totals.all?out.totals.gp/out.totals.all:null;
  out.totals.ecpi=out.totals.inst?out.totals.cost/out.totals.inst:null;
  out.totals.roi=out.totals.cost?out.totals.all/out.totals.cost:null;

  /* Weekday baseline — mean and sample standard deviation of margin across the
     same weekday inside this window, exactly the test L1_Daily runs. */
  const wd={};
  out.daily.forEach(d=>{if(d.margin==null)return;(wd[d.wd]=wd[d.wd]||[]).push(d.margin)});
  const stats={};
  Object.keys(wd).forEach(k=>{
    const a=wd[k],n=a.length,mean=a.reduce((s,v)=>s+v,0)/n;
    const sd=n>1?Math.sqrt(a.reduce((s,v)=>s+(v-mean)*(v-mean),0)/(n-1)):null;
    stats[k]={mean:mean,sd:sd,n:n};
  });
  out.daily.forEach(d=>{
    const s=stats[d.wd];
    d.wdMean=s?s.mean:null;
    d.wdSd=s?s.sd:null;
    d.delta=(d.margin!=null&&s)?(d.margin-s.mean)*100:null;
    if(d.gp<0)d.status='NEGATIVE';
    else if(s&&s.sd!=null&&d.margin!=null&&d.margin<s.mean-A.marginSigma*s.sd)d.status='BELOW BASELINE';
    else d.status='OK';
  });

  /* Channel derived fields. */
  Object.keys(out.channels).forEach(k=>{
    const c=out.channels[k];
    c.all=c.ad+c.iap;c.gp=c.all-c.cost;
    c.margin=c.all?c.gp/c.all:null;
    c.ecpi=c.inst?c.cost/c.inst:null;
    c.roi=c.cost?c.all/c.cost:null;
    c.share=out.totals.cost?c.cost/out.totals.cost:0;
    c.fake=(c.inst>0&&c.ecpi!=null&&c.ecpi<A.fakeEcpi);
  });
  Object.keys(out.os).forEach(k=>{
    const o=out.os[k];
    o.all=o.ad+o.iap;o.gp=o.all-o.cost;
    o.margin=o.all?o.gp/o.all:null;
    o.ecpi=o.inst?o.cost/o.inst:null;
    o.roi=o.cost?o.all/o.cost:null;
  });

  /* Campaign verdicts — the same decision tree L3_Campaign uses. */
  Object.keys(perCamp).forEach(k=>{
    const ci=Number(k), c=perCamp[k], meta=campaigns[ci];
    const chanName=channels[meta[1]];
    /* Campaign_Map is still the floor. Settings_Log sits on top of it, read
       under whichever basis this window is running: the current period for the
       standing view, the spend-weighted blend of the periods that governed the
       range for a look back. */
    let goal=meta[4]||'';
    const revType=meta[5]||'all';
    let target=(meta[6]!=null&&meta[6]!=='')?Number(meta[6])
      :(goal==='D0'?A.target_d0:goal==='D28'?A.target_d28:goal==='D30'?A.target_d30:A.target_d7);
    let targetBasis='sheet';

    if(winBasis==='current'){
      const cur=currentPeriod(meta[0],chanName);
      if(cur&&cur.goal)goal=cur.goal;
      const ct=currentTargetOf(meta[0],chanName);
      if(ct!=null){target=ct;targetBasis='current'}
      else if(cur){
        /* Carrying a setting with no target of its own means "use Assumptions",
           and the goal above may have moved, so the fallback is re-read. */
        target=goal==='D0'?A.target_d0:goal==='D28'?A.target_d28:goal==='D30'?A.target_d30:A.target_d7;
        targetBasis='current';
      }
    }else if(winBasis==='historical'){
      const endSet=settingOn(meta[0],chanName,idx.to);
      if(endSet&&endSet.goal)goal=endSet.goal;
      if(c.tc>0){target=c.tw/c.tc;targetBasis='blended'}
      else if(endSet){
        target=goal==='D0'?A.target_d0:goal==='D28'?A.target_d28:goal==='D30'?A.target_d30:A.target_d7;
        targetBasis='blended';
      }
    }

    const pick=(ad,iap)=>revType==='ad'?ad:revType==='iap'?iap:ad+iap;

    /* L3's mature-cost formula is a fall-through chain ending at the D7 bucket,
       so an unmapped goal reports D7 mature cost rather than full window cost.
       Kept identical here so the column can be reconciled against the sheet. */
    let matureCost=c.cost7, revAtGoal=null, basis='actual';
    if(goal==='D0'){matureCost=c.cost;revAtGoal=pick(c.adD0,c.iapD0)}
    else if(goal==='D7'){matureCost=c.cost7;revAtGoal=pick(c.adD7,c.iapD7)}
    else if(goal==='D28'){matureCost=c.cost28;revAtGoal=pick(c.adD28,c.iapD28)}
    else if(goal==='D30'){matureCost=c.cost30;revAtGoal=A.m_d28_d30*pick(c.adD30,c.iapD30);
      basis='d28 × '+A.m_d28_d30.toFixed(3)+' (proxy)'}

    const roas=(revAtGoal!=null&&matureCost>0)?revAtGoal/matureCost:null;

    /* The sheet's projection always runs on all-revenue regardless of the
       campaign's revenue type — it is an early warning, not a verdict. */
    let projected=null;
    const allD0=c.adD0+c.iapD0, allD7=c.adD7+c.iapD7;
    if(goal==='D7'&&c.cost>0)projected=(allD0/c.cost)*A.m_d0_d7;
    else if(goal==='D28'&&c.cost7>0)projected=(allD7/c.cost7)*A.m_d7_d28;
    else if(goal==='D30'&&c.cost7>0)projected=(allD7/c.cost7)*A.m_d7_d28*A.m_d28_d30;

    const pace=(roas>0)?roas/target:(projected>0?projected/target:null);

    let verdict;
    if(c.cost<=0)verdict='not active';
    else if(!goal)verdict='NO GOAL - map it';
    else if(matureCost<A.minMatureSpend)verdict='INSUFFICIENT DATA';
    else if(!roas)verdict='PENDING';
    else if(roas>=target)verdict='PASS';
    else if(roas<target*A.atRiskPace)verdict='FAIL - cut';
    else verdict='UNDER TARGET';

    out.campaigns.push({
      campaign:meta[0],channel:channels[meta[1]],os:meta[2],mapped:meta[7],
      goal:goal||'—',revType:revType,target:target,targetBasis:targetBasis,
      cost:c.cost,matureCost:matureCost,installs:c.inst,
      allRev:c.ad+c.iap,revAtGoal:revAtGoal,roas:roas,projected:projected,
      pace:pace,basis:goal?basis:'—',verdict:verdict,
      /* Carried through untouched for the payback ladder, which reads the same
         spend at three fixed ages instead of at each campaign's own goal.
         Nothing above depends on these — they are the accumulator's own sums. */
      revD0:c.adD0+c.iapD0,revD7:c.adD7+c.iapD7,revD28:c.adD28+c.iapD28,
      cost7:c.cost7,cost28:c.cost28,cost30:c.cost30,
      adD0:c.adD0,iapD0:c.iapD0,adD7:c.adD7,iapD7:c.iapD7,
      adD28:c.adD28,iapD28:c.iapD28,adD30:c.adD30,iapD30:c.iapD30
    });
  });
  out.campaigns.sort((a,b)=>b.cost-a.cost);

  WINDOW_CACHE.set(key,out);
  return out;
}

/* Equal-length comparison window ending one day before the selected window. */
function computePreviousWindow(W){
  if(!W||!W.from||!W.to||!DATA.days.length)return null;
  const count=Math.round((isoToDate(W.to)-isoToDate(W.from))/MS_DAY)+1;
  const prevTo=isoShift(W.from,-1),prevFrom=isoShift(prevTo,-(count-1));
  if(prevFrom<DATA.days[0])return null;
  const saved={filter:DATE_FILTER,start:RANGE_START,end:RANGE_END,slice:SLICE};
  DATE_FILTER='custom';RANGE_START=prevFrom;RANGE_END=prevTo;SLICE=null;
  let previous;
  try{previous=computeWindow(PLATFORM)}
  finally{DATE_FILTER=saved.filter;RANGE_START=saved.start;RANGE_END=saved.end;SLICE=saved.slice}
  return previous&&previous.daily.length?previous:null;
}

/* ======================== FILTER UI PLUMBING ======================== */

function initDateFilters(announce){
  const min=DATA.days[0]||'', max=DATA.days[DATA.days.length-1]||'';
  const spanMin=DATA.meta.spanStart||min;
  if(!RANGE_START)RANGE_START=isoShift(max,-27)>spanMin?isoShift(max,-27):spanMin;
  if(!RANGE_END)RANGE_END=max;

  document.querySelectorAll('[data-date-range],.date-controls').forEach(el=>{
    const box=document.createElement('div');
    box.className='date-controls';
    box.innerHTML='<span class="date-span" title="Dates covered by the current filter"></span>'+
      '<select class="date">'+
        '<option value="w2">Last 2 weeks</option>'+
        '<option value="w4">Last 4 weeks</option>'+
        '<option value="w6">Last 6 weeks</option>'+
        '<option value="w8">Last 8 weeks</option>'+
        '<option value="w10">Last 10 weeks</option>'+
        /* 13 weeks = 91 days, the shortest window that can carry a D28 verdict:
           a D28 cohort needs 28 days to mature, so anything narrower judges D7
           at best and reports nothing for the rest. Presets snap to complete
           Monday-Sunday weeks, so this can begin up to 97 days back - inside
           the 120 days of detail the server ships, which is why it costs no
           extra request. */
        '<option value="w13">Last 13 weeks</option>'+
        '<option value="custom">Custom range</option>'+
        '<option value="all">All loaded dates</option>'+
      '</select>'+
      '<input class="range-date range-start" type="date" title="From">'+
      '<input class="range-date range-end" type="date" title="To">'+
      '<button type="button" class="date-confirm">Apply</button>';
    const sel=box.querySelector('select.date'),
          start=box.querySelector('.range-start'),
          end=box.querySelector('.range-end'),
          apply=box.querySelector('.date-confirm');
    sel.value=DATE_FILTER;
    [start,end].forEach(i=>{i.min=spanMin;i.max=max});
    sel.onchange=()=>{
      DATE_FILTER=sel.value;
      syncDateControls();
      if(DATE_FILTER!=='custom')applyWindow(sel.options[sel.selectedIndex].text);
    };
    start.onchange=()=>{RANGE_START=start.value};
    end.onchange=()=>{RANGE_END=end.value};
    apply.onclick=()=>{
      if(!RANGE_START||!RANGE_END){setStatus('Pick both a From and a To date.',true);return}
      if(RANGE_START>RANGE_END){const s=RANGE_START;RANGE_START=RANGE_END;RANGE_END=s}
      syncDateControls();
      if(needsServerSlice())loadServerSlice(()=>applyWindow('Custom range'));
      else{SLICE=null;applyWindow('Custom range')}
    };
    el.replaceWith(box);
  });
  const platform=$('platformFilter');
  platform.value=PLATFORM;
  platform.onchange=()=>{
    PLATFORM=platform.value;
    populateCampaignChannels();
    populateMarginFilters();
    syncDateControls();
    applyWindow(platform.options[platform.selectedIndex].text);
    const page=$('page');
    if(page){page.style.animation='none';void page.offsetWidth;page.style.animation='viewIn .3s ease forwards'}
  };
  document.querySelectorAll('#platformDropMenu [data-platform]').forEach(btn=>btn.onclick=()=>{
    platform.value=btn.dataset.platform;
    platform.dispatchEvent(new Event('change',{bubbles:true}));
    $('platformDrop')?.classList.add('menu-dismissed');
    $('platformFilterBtn')?.blur();
  });
  $('platformFilterBtn')?.addEventListener('click',()=> $('platformDrop')?.classList.remove('menu-dismissed'));
  syncDateControls();
  if(announce)loadedNow();
}

function syncDateControls(){
  const label=activeRangeLabel();
  document.querySelectorAll('.date-controls').forEach(box=>{
    box.classList.toggle('custom',DATE_FILTER==='custom');
    box.querySelector('select.date').value=DATE_FILTER;
    box.querySelector('.range-start').value=RANGE_START;
    box.querySelector('.range-end').value=RANGE_END;
    const s=box.querySelector('.date-span');
    if(s)s.textContent=label;
  });
  const platform=$('platformFilter');if(platform)platform.value=PLATFORM;
  const platformBtn=$('platformFilterBtn');
  if(platformBtn)platformBtn.textContent=PLATFORM==='ios'?'IOS':PLATFORM==='all'?'All platforms':'Android';
  document.querySelectorAll('#platformDropMenu [data-platform]').forEach(b=>b.classList.toggle('active',b.dataset.platform===PLATFORM));
}

/* Re-filtering is synchronous, so flipping the overlay on and off in one tick
   paints nothing at all. Yield two frames so the spinner is actually drawn. */
function applyWindow(label){
  setStatus('Applying filter…');
  const el=$('loader');
  el.classList.add('show');
  positionLoader();
  const t0=Date.now();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    try{render()}
    finally{
      setTimeout(()=>el.classList.remove('show'),Math.max(0,250-(Date.now()-t0)));
      setLoadedStatus();
    }
  }));
}

/* ======================= SELECTORS ON THE PAGE ======================= */

function populateSelectors(){
  populateCampaignChannels();
  populateMarginFilters();
  const v=$('campVerdict');
  /* "Needs a decision" is the default and hides anything that passes, which is
     the point of the card. "Every campaign" is the escape hatch: a campaign
     sitting quietly inside its cap is still worth being able to look at without
     hunting for the one verdict that happens to describe it. */
  v.innerHTML='<option value="all">Needs a decision</option>'+
    '<option value="everything">All</option>'+
    WATCH.map(x=>`<option value="${esc(x)}">${esc(WATCH_LABEL[x])}</option>`).join('')+
    QUIET.map(x=>`<option value="${esc(x)}">${esc(QUIET_LABEL[x])} (no action)</option>`).join('');
  v.value=FILTERS.decision;
  v.onchange=()=>{FILTERS.decision=v.value;renderWatchlistOnly()};
  const rev=$('campRev');
  if(rev){rev.value=FILTERS.campRev;rev.onchange=()=>{FILTERS.campRev=rev.value;renderWatchlistOnly()}}
  ['hisChannel','hisCampaign','hisPeriod'].forEach(id=>{
    const sel=$(id);
    if(sel)sel.onchange=()=>{FILTERS[id]=sel.value;renderHistory(computeWindow())};
  });
  const all=$('watchAll');
  all.textContent=WATCH_ALL?'Show worst '+WATCH_TOP:'Show all';
  all.onclick=()=>{
    WATCH_ALL=!WATCH_ALL;
    all.textContent=WATCH_ALL?'Show worst '+WATCH_TOP:'Show all';
    renderWatchlistOnly();
  };
}

/* The margin strip has its own data filters. Campaign choices follow channel
   and platform so every option can produce a value in the current view. */
function populateMarginFilters(){
  if(!DATA)return;
  const period=$('marginPeriod'),channel=$('marginChannel'),campaign=$('marginCampaign');
  const sourceCampaigns=SLICE?SLICE.campaigns:DATA.campaigns,sourceChannels=SLICE?SLICE.channels:DATA.channels;
  const available=sourceCampaigns.filter(c=>PLATFORM==='all'||String(c[2]||'').toLowerCase()===PLATFORM);
  const channels=[...new Set(available.map(c=>sourceChannels[c[1]]).filter(Boolean))].sort();
  if(FILTERS.marginChannel!=='all'&&!channels.includes(FILTERS.marginChannel))FILTERS.marginChannel='all';
  channel.innerHTML='<option value="all">All channels</option>'+channels.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  channel.value=FILTERS.marginChannel;
  const campaigns=[...new Set(available.filter(c=>FILTERS.marginChannel==='all'||sourceChannels[c[1]]===FILTERS.marginChannel).map(c=>c[0]).filter(Boolean))].sort();
  if(FILTERS.marginCampaign!=='all'&&!campaigns.includes(FILTERS.marginCampaign))FILTERS.marginCampaign='all';
  campaign.innerHTML='<option value="all">All campaigns</option>'+campaigns.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  campaign.value=FILTERS.marginCampaign;
  period.value=FILTERS.marginPeriod;
  period.onchange=()=>{FILTERS.marginPeriod=period.value;renderDailyStrip(computeWindow())};
  channel.onchange=()=>{FILTERS.marginChannel=channel.value;FILTERS.marginCampaign='all';populateMarginFilters();renderDailyStrip(computeWindow())};
  campaign.onchange=()=>{FILTERS.marginCampaign=campaign.value;renderDailyStrip(computeWindow())};
}

/* Channels are listed for the selected platform only, so the dropdown never
   offers a network that cannot appear in the table underneath it. */
function populateCampaignChannels(){
  if(!DATA)return;
  const allowed=[...new Set(DATA.campaigns.filter(c=>PLATFORM==='all'||String(c[2]||'').toLowerCase()===PLATFORM)
    .map(c=>DATA.channels[c[1]]).filter(Boolean))].sort();
  if(FILTERS.campChannel!=='all'&&!allowed.includes(FILTERS.campChannel))FILTERS.campChannel='all';
  const sel=$('campChannel');
  sel.innerHTML='<option value="all">All networks</option>'+allowed.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value=FILTERS.campChannel;
  sel.onchange=()=>{FILTERS.campChannel=sel.value;FILTERS.campCampaign='all';populateCampaignDropdown();renderWatchlistOnly()};
  populateCampaignDropdown();
}

function populateCampaignDropdown(){
  if(!DATA)return;
  const names=[...new Set(DATA.campaigns
    .filter(c=>PLATFORM==='all'||String(c[2]||'').toLowerCase()===PLATFORM)
    .filter(c=>FILTERS.campChannel==='all'||DATA.channels[c[1]]===FILTERS.campChannel)
    .map(c=>c[0]).filter(Boolean))].sort();
  if(FILTERS.campCampaign!=='all'&&!names.includes(FILTERS.campCampaign))FILTERS.campCampaign='all';
  const sel=$('campCampaign');
  sel.innerHTML='<option value="all">All campaigns</option>'+names.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value=FILTERS.campCampaign;
  sel.onchange=()=>{FILTERS.campCampaign=sel.value;renderWatchlistOnly()};
}

/* ============================== RENDER ============================== */

const PLAT_LABEL={android:'Android',ios:'iOS',all:'All platforms'};

function render(){
  if(!DATA)return;
  const W=computeWindow();
  const P=computePreviousWindow(W);
  populateMarginFilters();
  if(typeof Chart!=='undefined'){
    Chart.defaults.color=cssVar('--t2','#a6b8d4');
    Chart.defaults.borderColor=cssVar('--border','rgba(255,255,255,.08)');
  }
  $('pageTitle').textContent='Negative Spend · '+(PLAT_LABEL[PLATFORM]||PLATFORM);
  renderTopCards(W,P);
  renderPayback(W,P);
  renderLadder(W);
  renderDailyStrip(W);
  renderCharts(W);
  renderNetworks(W);
  renderWatchlist(W);
  renderHistory(W);
  /* The glance section and performance table, from glance.js. Called from
     inside this one render pass on purpose: they read the same W every other
     section reads, so they cannot end up describing a different window than
     the tables beneath them. Optional - the page works without the module. */
  if(window.__nsBridge&&window.__nsBridge.onRender){
    try{window.__nsBridge.onRender(W)}
    catch(e){console.error('[glance] render failed:',e)}
  }
  if(!$('mapModal').hidden)renderMapTable();
  syncDateControls();
}

function renderWatchlistOnly(){renderWatchlist(computeWindow())}

/**
 * Blended payback for a set of campaigns: every dollar of mature spend against
 * every dollar it has returned by its own goal window. Both figures come
 * straight off the verdict engine, so a row reconciles against the sheet.
 */
function paybackOf(list){
  const spent=list.reduce((s,c)=>s+(c.matureCost||0),0);
  const back=list.reduce((s,c)=>s+(c.revAtGoal||0),0);
  return{n:list.length,spent:spent,back:back,x:spent>0?back/spent:null};
}
const judgedRows=list=>list.filter(c=>JUDGED[c.verdict]);
const payClass=x=>x==null?'':x>=1?'good':x>=0.85?'warn':'bad';

/* ------------- 0 · the five numbers that decide today's action ------------- */
function renderTopCards(W,P){
  const t=W.totals;

  const risk=v=>v.campaigns.filter(c=>c.verdict==='FAIL - cut'||c.verdict==='UNDER TARGET');
  const unjudged=v=>v.campaigns.filter(c=>c.verdict==='INSUFFICIENT DATA'||c.verdict==='PENDING'||c.verdict==='NO GOAL - map it');
  const spendOf=list=>list.reduce((s,c)=>s+c.cost,0);
  const drag=v=>Object.values(v.channels).sort((a,b)=>a.gp-b.gp)[0]||null;
  const fake=v=>Object.values(v.channels).filter(c=>c.fake);

  const atRisk=risk(W),atRiskCost=spendOf(atRisk);
  const kr=$('k_risk');kr.textContent=money(atRiskCost);kr.className='v '+(atRiskCost>0?'neg':'pos');
  $('k_risk_d').textContent=atRisk.length+' campaign'+(atRisk.length===1?'':'s')+' under their target'+
    (t.cost?' · '+pctOf(atRiskCost/t.cost)+' of window spend':'');

  const neg=W.daily.filter(d=>d.status==='NEGATIVE');
  const worst=W.daily.slice().sort((a,b)=>a.gp-b.gp)[0];
  const kn=$('k_negdays');kn.textContent=neg.length+' / '+W.daily.length;
  kn.className='v '+(neg.length?'neg':'pos');
  $('k_negdays_d').textContent=neg.length&&worst
    ? 'worst '+money(worst.gp)+' on '+worst.wd+' '+shortDate(worst.iso)
    : 'every day closed in profit';

  const young=unjudged(W),youngCost=spendOf(young);
  $('k_unjudged').textContent=money(youngCost);
  $('k_unjudged_d').textContent=young.length+' campaign'+(young.length===1?'':'s')+' with no verdict yet'+
    (t.cost?' · '+pctOf(youngCost/t.cost)+' of window spend':'');

  const worstChan=drag(W);
  const kd=$('k_drag');kd.textContent=worstChan?money(worstChan.gp):'—';
  kd.className='v '+(worstChan&&worstChan.gp<0?'neg':'pos');
  $('k_drag_d').textContent=worstChan
    ? worstChan.name+' · '+pctOf(worstChan.margin)+' margin on '+money(worstChan.cost)
    : 'no network spent in this window';

  const flagged=fake(W),fakeCost=flagged.reduce((s,c)=>s+c.cost,0);
  const kf=$('k_fake');kf.textContent=money(fakeCost);kf.className='v '+(fakeCost>0?'neg':'pos');
  $('k_fake_d').textContent=flagged.length
    ? flagged.map(c=>c.name).join(', ')+' · eCPI under '+money2(DATA.assumptions.fakeEcpi)
    : 'every network reports a believable eCPI';

  const pWorst=P?P.daily.slice().sort((a,b)=>a.gp-b.gp)[0]:null,pDrag=P?drag(P):null;
  setComparison('k_risk',atRiskCost,P?spendOf(risk(P)):null,{higherBetter:false,format:money});
  setComparison('k_negdays',neg.length,P?P.daily.filter(d=>d.status==='NEGATIVE').length:null,{higherBetter:false,format:compact});
  setComparison('k_unjudged',youngCost,P?spendOf(unjudged(P)):null,{higherBetter:false,format:money});
  setComparison('k_drag',worstChan&&worstChan.gp,pDrag&&pDrag.gp,{format:money});
  setComparison('k_fake',fakeCost,P?fake(P).reduce((s,c)=>s+c.cost,0):null,{higherBetter:false,format:money});
}

/* ------------- 1b · does the shortfall close as cohorts age? ------------- */
function renderLadder(W){
  const A=DATA.assumptions;
  const steps=[
    {k:'Day 0', rev:'revD0', cost:'cost',  target:A.target_d0, mature:W.matureDays.total,
     note:'revenue on install day against every dollar spent in the window'},
    {k:'Day 7', rev:'revD7', cost:'cost7', target:A.target_d7, mature:W.matureDays.D7,
     note:'cohorts at least 7 days old, against the spend that bought them'},
    {k:'Day 28',rev:'revD28',cost:'cost28',target:A.target_d28,mature:W.matureDays.D28,
     note:'cohorts at least 28 days old, against the spend that bought them'}
  ];
  steps.forEach(st=>{
    st.spent=W.campaigns.reduce((s,c)=>s+(c[st.cost]||0),0);
    st.back=W.campaigns.reduce((s,c)=>s+(c[st.rev]||0),0);
    st.x=st.spent>0?st.back/st.spent:null;
  });
  const scale=Math.max(1.25,Math.max(0,...steps.map(st=>st.x||0),...steps.map(st=>st.target))*1.15);

  $('ladderSub').textContent=steps[2].spent>0
    ? 'Every campaign in the window, blended. The gap to the break-even line is what has not come back yet.'
    : 'Day 28 has no mature cohort inside this window — widen the date range to judge it.';

  $('ladder').innerHTML=steps.map((st,si)=>{
    const cls=st.x==null?'':st.x>=1?'good':st.x>=st.target?'warn':'bad';
    const flag=st.x==null?'':st.x>=1?'past break-even':st.x>=st.target?'past target, short of break-even':'under target';
    const track=st.spent>0
      ? '<div class="lad-track">'+
          '<div class="lad-fill s'+si+'" style="width:'+Math.min(100,st.x/scale*100).toFixed(1)+'%"></div>'+
          '<div class="lad-tg" style="left:'+(st.target/scale*100).toFixed(1)+'%"></div>'+
          '<div class="lad-be" style="left:'+(100/scale).toFixed(1)+'%"></div>'+
        '</div>'
      : '<div class="lad-empty">not mature inside this window</div>';
    const note=st.spent>0
      ? money0(st.back)+' back on '+money0(st.spent)+' spent · target '+x2(st.target)+' · '+
        st.mature+' mature day'+(st.mature===1?'':'s')+' · '+st.note
      : st.note+' — the window ends before any cohort gets there, so widen the range to read this row';
    return '<div class="lad-row">'+
      '<div class="lad-top"><span class="lad-k">'+st.k+'</span>'+track+
        '<span class="lad-v '+cls+'">'+(st.x!=null?st.x.toFixed(3)+'x':'—')+'</span></div>'+
      '<div class="lad-note">'+(flag?'<b class="lad-flag '+cls+'">'+flag+'</b> · ':'')+esc(note)+'</div></div>';
  }).join('');
}

/* ------------------- 2b · where the money at risk sits ------------------- */
const TOOLTIP_NAMES=8;
function renderCharts(W){
  /* Decisions come from the overall reading so this chart and the table below
     it can never disagree about which bucket a campaign is in. */
  const tally={};
  overallCampaigns(W).forEach(c=>{
    const t=tally[c.verdict]||(tally[c.verdict]={n:0,cost:0,list:[]});
    t.n++;t.cost+=c.cost;t.list.push(c);
  });
  const shown=VERDICT_VIEW.filter(v=>tally[v[0]]&&tally[v[0]].cost>0);
  const detail=shown.map(v=>{
    const list=tally[v[0]].list.slice().sort((a,b)=>b.cost-a.cost);
    const head=list.slice(0,TOOLTIP_NAMES).map(c=>{
      const nm=c.campaign.length>44?c.campaign.slice(0,20)+'…'+c.campaign.slice(-21):c.campaign;
      return '• '+nm+'  '+money(c.cost)+'  ('+c.channel+')';
    });
    if(list.length>TOOLTIP_NAMES){
      const rest=list.slice(TOOLTIP_NAMES).reduce((s,c)=>s+c.cost,0);
      head.push('+ '+(list.length-TOOLTIP_NAMES)+' more · '+money(rest));
    }
    return head;
  });
  barChart('riskChart',
    shown.map(v=>v[1]+' ('+tally[v[0]].n+')'),
    shown.map(v=>tally[v[0]].cost),
    shown.map(v=>cssVar(v[2],v[3])),
    detail);

  const green=cssVar('--green',COLORS.green),coral=cssVar('--coral',COLORS.coral);
  const nets=Object.values(W.channels).sort((a,b)=>a.gp-b.gp);
  barChart('netGpChart',nets.map(c=>c.name),nets.map(c=>c.gp),nets.map(c=>c.gp<0?coral:green));
}

/* --------------- 1 · will the money we spent come back? --------------- */
function renderPayback(W,P){
  const t=W.totals;
  const judged=judgedRows(W.campaigns);
  const pb=paybackOf(judged);

  /* The bar runs to a little past break-even so the marker always sits inside
     it, and a campaign set that is well ahead is not clipped. */
  const scale=Math.max(1.25,(pb.x||0)*1.15);
  $('payFill').style.width=(pb.x!=null?Math.min(100,pb.x/scale*100):0).toFixed(1)+'%';
  $('payMark').style.left=(100/scale).toFixed(1)+'%';

  const x=$('payX');
  x.textContent=pb.x!=null?pb.x.toFixed(3)+'x':'—';
  x.className='pay-x '+payClass(pb.x);

  const gap=pb.back-pb.spent;
  $('payLine').innerHTML=pb.spent>0
    ? 'Spent <b>'+money0(pb.spent)+'</b> → back <b>'+money0(pb.back)+'</b> · '+
      (gap<0?'<span class="short">'+money0(gap)+' short of break-even</span>'
            :'<span class="over">+'+money0(gap)+' past break-even</span>')
    : 'Nothing in this window has cohorts old enough to judge yet.';

  const cash=$('cashV');
  cash.textContent=money0(t.gp);
  cash.className='v '+(t.gp<0?'neg':'pos');
  $('cashNote').textContent=t.cost>0
    ? pctOf(t.margin)+' margin on '+money0(t.cost)+' spend'
    : 'no spend in this window';

  const young=W.campaigns.filter(c=>c.verdict==='INSUFFICIENT DATA'||c.verdict==='PENDING');
  const youngCost=young.reduce((s,c)=>s+c.cost,0);
  const withGoal=W.campaigns.filter(c=>c.mapped&&c.goal!=='—').reduce((s,c)=>s+c.cost,0);
  const unmapped=W.campaigns.filter(c=>!c.mapped).reduce((s,c)=>s+c.cost,0);
  const noGoal=W.campaigns.filter(c=>c.mapped&&c.goal==='—').reduce((s,c)=>s+c.cost,0);
  const cov=t.cost?withGoal/t.cost:0;

  $('payFoot').innerHTML=
    '<b>'+judged.length+'</b> campaigns judged on <b>'+money0(pb.spent)+'</b> of mature spend · '+
    '<b>'+young.length+'</b> too young to judge, holding <b>'+money0(youngCost)+'</b> · '+
    'mature days D7 <b>'+W.matureDays.D7+'</b>, D28 <b>'+W.matureDays.D28+'</b> of '+W.matureDays.total+
    '<br>Goal coverage <b>'+pctOf(cov)+'</b> of window spend · <b>'+money0(unmapped)+'</b> missing from Campaign_Map · '+
    '<b>'+money0(noGoal)+'</b> mapped with no goal window'+
    (DATA.meta.badDates?' · <b style="color:var(--coral)">'+DATA.meta.badDates+' RAW rows have text in column C</b>':'');

  setChip('payChip',pb.x,P?paybackOf(judgedRows(P.campaigns)).x:null,x2,true);
  setChip('cashChip',t.gp,P?P.totals.gp:null,money,true);
}

function setChip(id,cur,prev,format,higherBetter){
  const el=$(id);
  if(!el)return;
  if(cur==null||prev==null||!isFinite(cur)||!isFinite(prev)){el.style.display='none';return}
  el.style.display='';
  const d=cur-prev,good=d===0?null:(higherBetter?d>0:d<0);
  el.className='chip '+(good==null?'':good?'good':'bad');
  el.textContent=(d>0?'▲':d<0?'▼':'•')+' '+(prev!==0?Math.abs(d/prev*100).toFixed(1)+'%':'new')+
    ' vs previous period ('+format(prev)+')';
}

/* --------------------- 2 · did any day lose money --------------------- */
function marginSeries(W){
  const idx=windowIdx(),days=idx.days,byDay=SLICE?SLICE.byDay:ROWS_BY_DAY;
  const campaigns=SLICE?SLICE.campaigns:DATA.campaigns,channels=SLICE?SLICE.channels:DATA.channels;
  const raw=[];
  if(idx.si<0)return raw;
  for(let di=idx.si;di<=idx.ei;di++){
    const iso=days[di],d={iso:iso,to:iso,wd:WD[isoToDate(iso).getDay()],cost:0,ad:0,iap:0};
    (byDay[di]||[]).forEach(r=>{
      const camp=campaigns[r[0]];if(!camp)return;
      const os=String(camp[2]||'unknown').toLowerCase(),channel=channels[camp[1]];
      if(PLATFORM!=='all'&&os!==PLATFORM)return;
      if(FILTERS.marginChannel!=='all'&&channel!==FILTERS.marginChannel)return;
      if(FILTERS.marginCampaign!=='all'&&camp[0]!==FILTERS.marginCampaign)return;
      d.cost+=r[2];d.ad+=r[4];d.iap+=r[5];
    });
    raw.push(d);
  }
  const mode=FILTERS.marginPeriod,activeRaw=raw.filter(d=>d.cost||d.ad||d.iap);
  let out=activeRaw;
  if(mode!=='daily'){
    const buckets=new Map();
    activeRaw.forEach(d=>{
      let key;
      if(mode==='monthly')key=d.iso.slice(0,7);
      else key=weekStartMondayISO(d.iso);
      let b=buckets.get(key);
      if(!b){
        b={iso:mode==='weekly'?key:d.iso,
           to:mode==='weekly'?isoShift(key,6):d.iso,
           wd:mode==='weekly'?'Week':'Month',cost:0,ad:0,iap:0};
        buckets.set(key,b);
      }
      if(mode!=='weekly')b.to=d.iso;
      b.cost+=d.cost;b.ad+=d.ad;b.iap+=d.iap;
    });
    out=[...buckets.values()];
  }
  out.forEach(d=>{d.all=d.ad+d.iap;d.gp=d.all-d.cost;d.margin=d.all?d.gp/d.all:null});
  const A=DATA.assumptions;
  if(mode==='daily'){
    const groups={};out.forEach(d=>{if(d.margin!=null)(groups[d.wd]=groups[d.wd]||[]).push(d.margin)});
    out.forEach(d=>{const a=groups[d.wd]||[],mean=a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
      const sd=a.length>1?Math.sqrt(a.reduce((s,v)=>s+(v-mean)*(v-mean),0)/(a.length-1)):null;
      d.norm=mean;d.delta=d.margin!=null&&mean!=null?(d.margin-mean)*100:null;
      d.status=d.gp<0?'NEGATIVE':(sd!=null&&d.margin<mean-A.marginSigma*sd?'BELOW BASELINE':'OK');});
  }else{
    const vals=out.map(d=>d.margin).filter(v=>v!=null),mean=vals.length?vals.reduce((s,v)=>s+v,0)/vals.length:null;
    const sd=vals.length>1?Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/(vals.length-1)):null;
    out.forEach(d=>{d.norm=mean;d.delta=d.margin!=null&&mean!=null?(d.margin-mean)*100:null;
      d.status=d.gp<0?'NEGATIVE':(sd!=null&&d.margin<mean-A.marginSigma*sd?'BELOW BASELINE':'OK')});
  }
  return out;
}

function renderDailyStrip(W){
  const days=marginSeries(W),mode=FILTERS.marginPeriod,label=mode==='daily'?'Daily':mode==='weekly'?'Weekly':'Monthly';
  /* "Margin" read as though a budget were involved. This card only ever asks
     whether money came back - revenue minus cost - so it now says that. Spend
     against the cap is the card underneath. */
  $('marginTitle').textContent=label+' profit and loss';
  $('marginNormKey').innerHTML='<i style="background:var(--amber)"></i>below its '+(mode==='daily'?'weekday':'period')+' norm';
  if(!days.length){
    $('stripSub').textContent='No periods in this window.';
    $('dailyStrip').innerHTML='';
    $('stripFrom').textContent='';$('stripTo').textContent='';
    return;
  }
  const neg=days.filter(d=>d.status==='NEGATIVE'),below=days.filter(d=>d.status==='BELOW BASELINE');
  const worst=days.slice().sort((a,b)=>a.gp-b.gp)[0];
  const unit=mode==='daily'?'day':mode==='weekly'?'week':'month';
  const scope=[FILTERS.marginChannel!=='all'?FILTERS.marginChannel:'',FILTERS.marginCampaign!=='all'?FILTERS.marginCampaign:''].filter(Boolean).join(' · ');
  $('stripSub').textContent=(scope?scope+' · ':'')+
    (neg.length?neg.length+' '+unit+(neg.length===1?'':'s')+' lost money':'No '+unit+' lost money')+' · '+
    (below.length?below.length+' below the '+(mode==='daily'?'weekday':'period')+' norm':'none below the '+(mode==='daily'?'weekday':'period')+' norm')+
    ' · worst '+unit+' '+money(worst.gp)+' · '+periodLabel(worst,mode);

  /* The baseline sits where the biggest win and the biggest loss say it should,
     so one dollar is the same number of pixels above the line as below it. A
     floor of 4% keeps a small losing day from disappearing into the line. */
  const maxPos=Math.max(0,...days.map(d=>d.gp>0?d.gp:0));
  const maxNeg=Math.max(0,...days.map(d=>d.gp<0?-d.gp:0));
  /* Sparse weekly/monthly views should still read like a chart rather than one
     giant block. Keep the zero line away from the extreme edges and centre a
     small number of bars in a compact plotting group. */
  const upPct=maxPos&&maxNeg
    ?Math.min(75,Math.max(25,Math.round(maxPos/(maxPos+maxNeg)*100)))
    :maxNeg?30:maxPos?70:50;
  const slotPct=days.length===1?16:days.length<=3?14:Math.min(9,82/days.length);
  const heightCap=days.length===1?62:days.length===2?78:100;
  $('dailyStrip').innerHTML='<div class="strip-zero" style="top:'+upPct+'%"></div>'+days.map((d,i)=>{
    let h=d.gp>=0
      ? (maxPos?Math.max(4,Math.min(100,d.gp/maxPos*100)):0)
      : (maxNeg?Math.max(4,Math.min(100,-d.gp/maxNeg*100)):0);
    h=Math.min(heightCap,h);
    const cls=d.status==='NEGATIVE'?'bad':d.status==='BELOW BASELINE'?'warn':'';
    return '<div class="sbar '+cls+'" data-day="'+i+'" style="flex:0 0 '+slotPct.toFixed(2)+'%">'+
      '<div class="sbar-up" style="flex-basis:'+upPct+'%">'+
        (d.gp>=0?'<i style="height:'+h.toFixed(1)+'%"></i>':'')+'</div>'+
      '<div class="sbar-dn" style="flex-basis:'+(100-upPct)+'%">'+
        (d.gp<0?'<i style="height:'+h.toFixed(1)+'%"></i>':'')+'</div></div>';
  }).join('');
  bindStripTooltip(days);
  const ends=$('stripFrom').parentElement;
  ends.classList.toggle('single',days.length===1);
  $('stripFrom').textContent=days[0]?periodLabel(days[0],mode):'';
  $('stripTo').textContent=days.length>1?periodLabel(days[days.length-1],mode):'';
}

/* ------------- 2a - spend against the cap that was running -------------
 * The card above is settings-blind on purpose: profit is revenue minus cost
 * whatever cap anyone set. This one is the opposite - it exists to answer
 * "did we stay inside the budget that was actually in force at the time".
 *
 * So the cap is resolved PER PERIOD, not once for the window. A week that ran
 * under a $20k cap is measured against $20k even if the campaign is on $50k
 * now, which is the same rule Campaigns to act on and Settings history follow.
 * Inside one period a campaign's cap is spend-weighted, so a change landing
 * mid-week is not rounded to whichever side of it happened to have more days.
 *
 * One caveat worth knowing: the budget in Settings_Log is a cap PER WINDOW, so
 * reading it as a weekly or monthly cap only means something if that is how you
 * think of it. Daily grouping will make almost every bar look far under.
 */
function budgetSeries(W){
  const idx=windowIdx(),days=idx.days,byDay=SLICE?SLICE.byDay:ROWS_BY_DAY;
  const campaigns=SLICE?SLICE.campaigns:DATA.campaigns,channels=SLICE?SLICE.channels:DATA.channels;
  const mode=FILTERS.budPeriod;
  const buckets=new Map();
  if(idx.si<0)return [];

  for(let di=idx.si;di<=idx.ei;di++){
    const iso=days[di];
    const key=mode==='monthly'?iso.slice(0,7):mode==='weekly'?weekStartMondayISO(iso):iso;
    let b=buckets.get(key);
    if(!b){
      b={iso:mode==='weekly'?key:iso,to:iso,
         wd:mode==='weekly'?'Week':mode==='monthly'?'Month':WD[isoToDate(iso).getDay()],
         cost:0,camps:new Map()};
      buckets.set(key,b);
    }
    if(iso>b.to)b.to=iso;
    if(mode==='weekly')b.to=isoShift(key,6);

    (byDay[di]||[]).forEach(r=>{
      const camp=campaigns[r[0]];if(!camp)return;
      const os=String(camp[2]||'unknown').toLowerCase(),channel=channels[camp[1]];
      if(PLATFORM!=='all'&&os!==PLATFORM)return;
      if(FILTERS.budChannel!=='all'&&channel!==FILTERS.budChannel)return;
      if(FILTERS.budCampaign!=='all'&&camp[0]!==FILTERS.budCampaign)return;
      b.cost+=r[2];
      const ck=camp[0]+'||'+channel;
      let c=b.camps.get(ck);
      if(!c){c={name:camp[0],cost:0,capW:0,capC:0,caps:new Map()};b.camps.set(ck,c)}
      c.cost+=r[2];
      /* The cap in force on THIS day, never the one running now. */
      const e=settingOn(camp[0],channel,iso);
      const cap=(e&&e.budget!==''&&e.budget!=null&&Number(e.budget)>0)?Number(e.budget):null;
      if(cap!=null&&r[2]>0){
        c.capW+=cap*r[2];c.capC+=r[2];
        /* Which caps ran inside this bucket, and from when. With several
           campaigns or a mid-bucket change the line is a sum of several
           different numbers, and the tooltip has to be able to show them. */
        const from=(e&&e.from)||'';
        const kk=from+'|'+cap;
        if(!c.caps.has(kk))c.caps.set(kk,{from:from,budget:cap,cost:0});
        c.caps.get(kk).cost+=r[2];
      }
    });
  }

  const out=[...buckets.values()];
  out.forEach(b=>{
    let cap=0,capped=0,uncapped=0;
    const parts=[],changes=new Set();
    b.camps.forEach(c=>{
      if(c.capC>0){
        const own=c.capW/c.capC;
        cap+=own;capped+=c.cost;
        parts.push({name:c.name,cap:own,cost:c.cost,caps:[...c.caps.values()]});
        /* More than one cap for one campaign inside one bucket means the budget
           moved partway through it. */
        if(c.caps.size>1)[...c.caps.values()].forEach(x=>{if(x.from>b.iso)changes.add(x.from)});
      }else uncapped+=c.cost;
    });
    b.cap=cap>0?cap:null;
    b.cappedCost=capped;b.uncappedCost=uncapped;
    b.pct=b.cap?capped/b.cap:null;
    b.over=b.cap!=null&&capped>b.cap;
    b.campCount=b.camps.size;
    b.parts=parts.sort((x,y)=>y.cost-x.cost);
    b.changes=[...changes].sort();
  });
  out.sort((a,b)=>a.iso.localeCompare(b.iso));
  return out;
}

function renderBudgetStrip(W){
  const rows=budgetSeries(W),mode=FILTERS.budPeriod;
  const label=mode==='daily'?'Daily':mode==='weekly'?'Weekly':'Monthly';
  const unit=mode==='daily'?'day':mode==='weekly'?'week':'month';
  $('budTitle').textContent=label+' spend against budget';
  const wrap=$('budStrip');
  if(!rows.length){
    $('budSub').textContent='No periods in this window.';
    wrap.innerHTML='';$('budFrom').textContent='';$('budTo').textContent='';
    return;
  }
  const withCap=rows.filter(r=>r.cap!=null),over=rows.filter(r=>r.over);
  const scope=[FILTERS.budChannel!=='all'?FILTERS.budChannel:'',
               FILTERS.budCampaign!=='all'?FILTERS.budCampaign:''].filter(Boolean).join(' \u00b7 ');
  const uncapped=rows.reduce((x,r)=>x+r.uncappedCost,0);

  if(!withCap.length){
    $('budSub').textContent=(scope?scope+' \u00b7 ':'')+
      'No budget was in force between '+periodLabel(rows[0],mode)+' and '+
      periodLabel(rows[rows.length-1],mode)+'.';
    wrap.innerHTML='<div class="empty" style="margin:auto">No budget</div>';
    $('budFrom').textContent='';$('budTo').textContent='';
    return;
  }

  const peakPct=Math.max(...rows.map(r=>r.pct||0));
  /* The 100% line stays on screen whatever the data does, because a chart of
     spend against budget that hides the budget is not answering its question.
     Everything under it is honest headroom. */
  const top=Math.max(1.15,peakPct*1.12);
  const y=v=>(v/top)*100;

  $('budSub').textContent=(scope?scope+' \u00b7 ':'')+
    (over.length?over.length+' '+unit+(over.length===1?'':'s')+' went over the cap running at the time'
                :'no '+unit+' went over the cap running at the time')+
    (uncapped>0?' \u00b7 '+money(uncapped)+' ran with no cap set':'')+
    ' \u00b7 each '+unit+' is measured against its own budget'+
    (mode==='daily'&&peakPct<0.4
      ? ' \u00b7 budgets are a cap per window, so a single day sits far under one \u2014 try Weekly or Monthly'
      : '');

  const marks=[0.25,0.5,0.75].filter(v=>v<top);
  const grid=marks.map(v=>'<div class="bgline" style="bottom:'+y(v).toFixed(2)+'%">'+
      '<b>'+Math.round(v*100)+'%</b></div>').join('')+
    '<div class="bgline cap" style="bottom:'+y(1).toFixed(2)+'%"><b>100%</b></div>';

  const showLabels=rows.length<=24;
  const bars=rows.map((r,i)=>{
    const h=r.pct!=null?Math.max(1.5,Math.min(100,y(r.pct)))
                       :(r.cost>0?Math.max(1.5,y(0.06)):0);
    const cls=r.cap==null?'nocap':(r.over?'over':'');
    const lab=showLabels?'<em>'+(r.pct!=null?Math.round(r.pct*100)+'%':'\u2014')+'</em>':'';
    return '<div class="bbar '+cls+'" data-i="'+i+'">'+lab+
           '<i style="height:'+h.toFixed(2)+'%"></i></div>';
  }).join('');

  wrap.innerHTML=grid+'<div class="bbars">'+bars+'</div>';

  /*
   * The line is one number but it can be a sum of many: every campaign that
   * spent in the period contributes its own cap, and a cap that moved partway
   * through contributes a spend-weighted blend of both. Nobody can infer that
   * from a line, so hovering spells it out.
   */
  const tip=$('budTip');
  wrap.querySelectorAll('.bbar').forEach(el=>{
    el.addEventListener('mouseenter',()=>{
      const r=rows[Number(el.dataset.i)];
      const spent=r.cappedCost+r.uncappedCost;
      let html='<h4>'+esc(periodLabel(r,mode))+'</h4>'+
        '<div class="r"><span>Spend</span><b>'+money(spent)+'</b></div>';
      if(r.cap!=null){
        html+='<div class="r"><span>Budget</span><b>'+money(r.cap)+'</b></div>'+
              '<div class="r"><span>Used</span><b'+(r.over?' style="color:var(--coral)"':'')+'>'+
              pctOf(r.pct)+'</b></div>';
      }else html+='<div class="r"><span>Budget</span><b>none set</b></div>';
      if(r.uncappedCost>0&&r.cap!=null)
        html+='<div class="r"><span>Ran uncapped</span><b>'+money(r.uncappedCost)+'</b></div>';

      if(r.parts&&r.parts.length>1){
        html+='<div class="note"><b>'+r.parts.length+' campaigns make up this budget</b><br>'+
          r.parts.slice(0,4).map(pp=>esc(campHalf(pp.name))+' \u2014 '+money(pp.cap)).join('<br>')+
          (r.parts.length>4?'<br>and '+(r.parts.length-4)+' more':'')+'</div>';
      }else if(r.parts&&r.parts.length===1&&r.parts[0].caps.length>1){
        html+='<div class="note"><b>the cap moved inside this '+unit+'</b><br>'+
          r.parts[0].caps.map(cc=>money(cc.budget)+' from '+(cc.from?dmy(cc.from):'the start')+
            ' \u00b7 '+money(cc.cost)+' spent').join('<br>')+
          '<br>blended by spend to '+money(r.cap)+'</div>';
      }else if(r.changes&&r.changes.length){
        html+='<div class="note">cap changed '+r.changes.map(d=>dmy(d)).join(', ')+
          ' \u2014 blended by spend</div>';
      }
      tip.innerHTML=html;
      tip.classList.add('on');
      const wr=wrap.getBoundingClientRect(),br=el.getBoundingClientRect();
      const left=Math.min(Math.max(br.left-wr.left+br.width/2-110,0),Math.max(wr.width-230,0));
      tip.style.left=left+'px';
      tip.style.top=Math.max(0,br.top-wr.top-tip.offsetHeight-8)+'px';
    });
    el.addEventListener('mouseleave',()=>tip.classList.remove('on'));
  });

  const ends=$('budFrom').parentElement;
  ends.classList.toggle('single',rows.length===1);
  $('budFrom').textContent=periodLabel(rows[0],mode);
  $('budTo').textContent=rows.length>1?periodLabel(rows[rows.length-1],mode):'';
}

/* Its own filters, so the budget read can be narrowed to one campaign while the
   card above stays on everything. Options follow channel and platform. */
function populateBudgetFilters(){
  if(!DATA)return;
  const period=$('budPeriod'),channel=$('budChannel'),campaign=$('budCampaign');
  if(!period||!channel||!campaign)return;
  const srcC=SLICE?SLICE.campaigns:DATA.campaigns,srcCh=SLICE?SLICE.channels:DATA.channels;
  const available=srcC.filter(c=>PLATFORM==='all'||String(c[2]||'').toLowerCase()===PLATFORM);
  const channels=[...new Set(available.map(c=>srcCh[c[1]]).filter(Boolean))].sort();
  if(FILTERS.budChannel!=='all'&&!channels.includes(FILTERS.budChannel))FILTERS.budChannel='all';
  channel.innerHTML='<option value="all">All channels</option>'+
    channels.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  channel.value=FILTERS.budChannel;
  const camps=[...new Set(available
    .filter(c=>FILTERS.budChannel==='all'||srcCh[c[1]]===FILTERS.budChannel)
    .map(c=>c[0]).filter(Boolean))].sort();
  if(FILTERS.budCampaign!=='all'&&!camps.includes(FILTERS.budCampaign))FILTERS.budCampaign='all';
  campaign.innerHTML='<option value="all">All campaigns</option>'+
    camps.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
  campaign.value=FILTERS.budCampaign;
  period.value=FILTERS.budPeriod;
  period.onchange=()=>{FILTERS.budPeriod=period.value;renderBudgetStrip(computeWindow())};
  channel.onchange=()=>{FILTERS.budChannel=channel.value;FILTERS.budCampaign='all';
    populateBudgetFilters();renderBudgetStrip(computeWindow())};
  campaign.onchange=()=>{FILTERS.budCampaign=campaign.value;renderBudgetStrip(computeWindow())};
}

function periodLabel(d,mode){
  if(mode==='monthly')return isoToDate(d.iso).toLocaleDateString('en-US',{month:'short',year:'numeric'});
  if(mode==='weekly')return shortDate(d.iso)+' – '+shortDate(d.to);
  return d.wd+' '+shortDate(d.iso);
}

/* ------------------- 3 · which network is leaking ------------------- */
function renderNetworks(W){
  const list=Object.values(W.channels).sort((a,b)=>b.cost-a.cost);
  if(!list.length){$('networkTable').innerHTML='<div class="empty">No network spent in this window.</div>';return}

  /* Payback is a campaign-level verdict, so a network's figure is the blend of
     its own judgeable campaigns rather than anything new. */
  const byChan={};
  judgedRows(W.campaigns).forEach(c=>{
    (byChan[c.channel]=byChan[c.channel]||[]).push(c);
  });
  const pay={};
  list.forEach(c=>{pay[c.name]=paybackOf(byChan[c.name]||[])});
  const scale=Math.max(1.25,Math.max(0,...list.map(c=>pay[c.name].x||0))*1.15);
  /* Google Ads is judged on budget, so this card needs the cap the network was
     actually running under. On the standing view that is the current cap; on a
     look back it is the cap in force at the end of the range, which is the
     period the range closes in. Reading today's cap for a closed historical
     range would report a ceiling that did not exist then. */
  const asOf=isHistoricalRange()?(W.to||todayISO()):todayISO();
  const googleBudgets={};
  W.campaigns.forEach(c=>{
    /* Whichever campaigns are judged on budget alone, not a hardcoded network. */
    if(judgeModeAt(c.campaign,c.channel,asOf)!=='budget')return;
    const key=c.campaign+'||'+c.channel;
    if(googleBudgets[key]==null)googleBudgets[key]=liveBudget(c.campaign,c.channel,asOf)||0;
  });
  const googleBudget=Object.values(googleBudgets).reduce((sum,v)=>sum+v,0);

  buildTable('networkTable',
    ['Channel','Spend','Cash','Margin','Payback at goal',''],
    list.map(c=>{
      const pb=pay[c.name],cls=payClass(pb.x);
      /* A network reads as budget-only when every campaign that spent on it is
         judged that way — across all of them, not just the gradeable ones. */
      const onNet=W.campaigns.filter(x=>x.channel===c.name);
      const isGoogle=onNet.length>0&&onNet.every(x=>x.judgeMode==='budget');
      const cash=isGoogle?googleBudget-c.cost:c.gp;
      const margin=isGoogle?(googleBudget?cash/googleBudget:(c.cost>0?-1:null)):c.margin;
      let name='<div class="nm">'+esc(c.name)+'</div>';
      if(c.fake)name+='<div class="sub bad">install count unusable · eCPI '+money2(c.ecpi)+'</div>';
      else if(!pb.n)name+='<div class="sub">no cohort old enough to judge</div>';

      let read='<div class="val '+cls+'">'+(pb.x!=null?pb.x.toFixed(3)+'x':'—')+'</div>';
      if(pb.x!=null&&cash>0&&pb.x<1)read+='<div class="sub bad">cash says fine, cohorts don\'t</div>';
      else if(pb.x!=null&&cash<0&&pb.x>=1)read+='<div class="sub warn">cohorts say fine, cash doesn\'t</div>';

      const w=pb.x!=null?Math.min(100,pb.x/scale*100):0;
      const bar='<div class="pbar"><i class="'+cls+'" style="width:'+w.toFixed(1)+'%"></i>'+
        '<b style="left:'+(100/scale).toFixed(1)+'%"></b></div>';

      return[
        {v:name,title:c.name},
        {v:money(c.cost),n:true,heat:c.cost,col:'cost'},
        {v:money(cash)+(isGoogle?'<div class="sub">budget '+money(googleBudget)+'</div>':''),n:true,heat:cash,col:'gp',neg:cash<0},
        {v:pctOf(margin),n:true,heat:NaN,neg:margin<0},
        {v:read,n:true,heat:NaN},          /* a ratio is not a magnitude — no heat fill */
        {v:bar}
      ];
    }),{number:false});
}


/* ==================================================================
   OVERALL SETTINGS ENGINE
   Campaign_Map holds one setting per campaign; Settings_Log holds every
   dated change. Anything that reports "overall" has to read the log, not
   the map, or a window that straddles a change is graded against rules
   that were not running for half of it.

   Two readings are built here and used everywhere below:
     - overallCampaigns()  one row per campaign, whole window, settings
                           blended by the spend that ran under each.
     - settingsSeries()    the same money split by date bucket, each bucket
                           read on the settings in force during it.
   Both judge on ALL revenue (ad + IAP), because negative spend is total
   cash out against total cash in, whatever stream a target was aimed at.
   ================================================================== */

/** Goal window in days, or null when the campaign has none. */
function goalDaysOf(goal){const g=String(goal||'').toUpperCase();return GOAL_DAYS[g]!=null?GOAL_DAYS[g]:null}

/** Newest setting in force on a date, across every revenue-type variant. */
function settingOn(campaign,channel,iso){
  const live=sheetEntry(campaign,channel,iso);
  return live?live.entry:null;
}

/** Target the sheet would fall back to when a campaign carries none. */
function fallbackTarget(goal,A){
  return goal==='D0'?A.target_d0:goal==='D28'?A.target_d28:goal==='D30'?A.target_d30:A.target_d7;
}

/** Cost per campaign per day inside the window, keyed campaign||channel. */
function dailyCostByCampaign(W){
  const idx=windowIdx(),days=idx.days,byDay=SLICE?SLICE.byDay:ROWS_BY_DAY;
  const campaigns=SLICE?SLICE.campaigns:DATA.campaigns,channels=SLICE?SLICE.channels:DATA.channels;
  const out=new Map();
  if(idx.si<0)return out;
  for(let di=idx.si;di<=idx.ei;di++){
    const iso=days[di];
    (byDay[di]||[]).forEach(r=>{
      const camp=campaigns[r[0]];if(!camp)return;
      if(PLATFORM!=='all'&&String(camp[2]||'').toLowerCase()!==PLATFORM)return;
      const key=camp[0]+'||'+channels[camp[1]];
      let m=out.get(key);
      if(!m){m=[];out.set(key,m)}
      m.push({iso:iso,cost:r[2]});
    });
  }
  return out;
}

/**
 * Every setting that governed a campaign inside the window, weighted by the
 * spend that actually ran under it. A target that covered $30k at 0.80 and
 * $10k at 0.60 blends to 0.75 - the rate the money was really held to.
 */
function blendSettings(campaign,channel,dayCosts,base,A){
  const periods=[];
  let target=null,budget=null,goal=base.goal||'',spend=0,cappedSpend=0;
  (dayCosts||[]).forEach(d=>{
    if(!(d.cost>0))return;
    spend+=d.cost;
    const e=settingOn(campaign,channel,d.iso);
    const g=(e&&e.goal)?e.goal:(base.goal||'');
    const t=(e&&e.target!==''&&e.target!=null)?Number(e.target)
      :(base.target!=null&&base.target!==''?Number(base.target):fallbackTarget(g,A));
    const b=(e&&e.budget!==''&&e.budget!=null&&Number(e.budget)>0)?Number(e.budget):null;
    if(b!=null)cappedSpend+=d.cost;
    const sig=g+'|'+t+'|'+(b==null?'':b);
    const last=periods[periods.length-1];
    if(last&&last.sig===sig){last.cost+=d.cost;last.to=d.iso}
    else periods.push({sig:sig,goal:g,target:t,budget:b,cost:d.cost,from:d.iso,to:d.iso});
  });
  if(!periods.length){
    /* No spend to grade, so there is no history to respect — the settings it is
       carrying now are the only meaningful thing to report. */
    const g=base.goal||'';
    const cur=currentPeriod(campaign,channel);
    const cb=currentBudgetOf(campaign,channel),ct=currentTargetOf(campaign,channel);
    return{goal:(cur&&cur.goal)||g,
           target:ct!=null?ct:(base.target!=null&&base.target!==''?Number(base.target):fallbackTarget(g,A)),
           budget:cb,periods:[],changed:false,spend:0,cappedSpend:0,
           histTarget:null,histBudget:null,histCappedSpend:0,
           curBudget:cb,curTarget:ct,curFrom:(cur&&cur.from)||'',basis:'current',
           judgeMode:normJudge(cur&&cur.judge)||networkJudge(channel),
           budgetChanged:false,targetChanged:false};
  }
  const wt=periods.reduce((x,pd)=>x+pd.target*pd.cost,0);
  target=spend>0?wt/spend:periods[periods.length-1].target;
  /* A cap is a ceiling, not a rate, so blending it the same way keeps the
     comparison honest: spend that ran under a $20k cap is measured against
     $20k, and the row's single figure is what those caps average out to. */
  const withB=periods.filter(pd=>pd.budget!=null);
  const bSpend=withB.reduce((x,pd)=>x+pd.cost,0);
  budget=withB.length?(bSpend>0?withB.reduce((x,pd)=>x+pd.budget*pd.cost,0)/bSpend
                              :withB[withB.length-1].budget):null;
  goal=periods[periods.length-1].goal;

  /* What the campaign is running under NOW, kept apart from what governed the
     window. Apply stamps a change with today's date and the data always lags
     that, so a cap set this morning governed none of this window — it belongs
     on the row as context, never as the yardstick the window is measured by.
     Folding it into `budget` was how spend from before a cap existed ended up
     being judged against it. */
  const curB=currentBudgetOf(campaign,channel);
  const curT=currentTargetOf(campaign,channel);
  const curFrom=(()=>{const e=currentPeriod(campaign,channel);return e?(e.from||''):''})();

  /* The standing view of the account asks a different question from a look
     back at a closed range, so it gets the current rules rather than the
     blended historical ones. A historical range keeps the blend. */
  const live=!isHistoricalRange();
  /* A cap set today has governed none of a range that ended yesterday. Reporting
     that as "no cap set" was wrong in the way that matters: it reads as nobody
     having set one, and invites setting it again. The cap IS shown, with the
     date it starts, and the spend measured under it stays at zero so it cannot
     produce a false overrun. */
  const pendingBudget=!live&&budget==null&&curB!=null;
  const judgeBudget=live&&curB!=null?curB:(pendingBudget?curB:budget);
  const judgeCapped=live&&curB!=null?spend:cappedSpend;
  const pendingTarget=!live&&target==null&&curT!=null;
  const judgeTarget=live&&curT!=null?curT:(pendingTarget?curT:target);

  const uniq=k=>[...new Set(periods.map(pd=>String(pd[k])))].length>1;
  /* The rule the campaign is on now decides how it is judged, even on a look
     back: "should this be on my list today" is a question about today's policy,
     while the numbers either side of it stay historical. */
  return{goal:goal,target:judgeTarget,budget:judgeBudget,periods:periods,
         judgeMode:judgeModeAt(campaign,channel,todayISO()),
         budgetPending:pendingBudget,targetPending:pendingTarget,
         spend:spend,cappedSpend:judgeCapped,
         histTarget:target,histBudget:budget,histCappedSpend:cappedSpend,
         curBudget:curB,curTarget:curT,curFrom:curFrom,basis:live?'current':'historical',
         targetChanged:uniq('target'),budgetChanged:uniq('budget'),
         changed:uniq('target')||uniq('budget')||uniq('goal')};
}

/**
 * The verdict, under the rule that applies to this network.
 * Google Ads: budget only. Everyone else: budget and payback together, with
 * the more urgent of the two winning the badge.
 */
function judgeOverall(o,A){
  /* Spend from before a cap existed cannot breach it. */
  const over=o.budget!=null&&!o.budgetPending&&o.cappedCost>o.budget;
  const mode=o.judgeMode||'both';
  if(mode==='budget'){
    if(o.cost<=0)return 'not active';
    if(o.budget==null)return 'NO BUDGET - set one';
    return over?'OVER BUDGET':'PASS';
  }
  let byRoas;
  if(o.cost<=0)byRoas='not active';
  else if(!o.goal||o.goal==='—')byRoas='NO GOAL - map it';
  else if(o.matureCost<A.minMatureSpend)byRoas='INSUFFICIENT DATA';
  else if(o.roas==null)byRoas='PENDING';
  else if(o.roas>=o.target)byRoas='PASS';
  else if(o.roas<o.target*A.atRiskPace)byRoas='FAIL - cut';
  else byRoas='UNDER TARGET';
  /* A campaign that is both failing and over its cap is still a cut - the
     budget breach is extra evidence, not a softer verdict. */
  if(byRoas==='FAIL - cut'||byRoas==='UNDER TARGET')return byRoas;
  /* 'roas' means the cap is context, not a verdict — a campaign paying back
     well is not put on the list for outspending a number somebody typed. */
  if(over&&mode!=='roas')return 'OVER BUDGET';
  return byRoas;
}

/** One row per campaign, whole window, settings blended, all revenue. */
function overallCampaigns(W){
  const A=DATA.assumptions,costs=dailyCostByCampaign(W);
  return W.campaigns.map(c=>{
    const key=c.campaign+'||'+c.channel;
    const base={goal:c.mapped?c.goal:'',target:null};
    const bs=blendSettings(c.campaign,c.channel,costs.get(key),
      {goal:(c.goal&&c.goal!=='—')?c.goal:'',target:null},A);
    const goal=(bs.goal&&bs.goal!=='—')?bs.goal:'';
    /* All revenue, always - the configured stream decides the target, never
       which dollars count as money coming back. */
    let matureCost=c.cost7,revAtGoal=null,basis='actual';
    if(goal==='D0'){matureCost=c.cost;revAtGoal=c.adD0+c.iapD0}
    else if(goal==='D7'){matureCost=c.cost7;revAtGoal=c.adD7+c.iapD7}
    else if(goal==='D28'){matureCost=c.cost28;revAtGoal=c.adD28+c.iapD28}
    else if(goal==='D30'){matureCost=c.cost30;revAtGoal=A.m_d28_d30*(c.adD30+c.iapD30);
      basis='d28 x '+A.m_d28_d30.toFixed(3)+' (proxy)'}
    const roas=(revAtGoal!=null&&matureCost>0)?revAtGoal/matureCost:null;
    const o=Object.assign({},c,{
      goal:goal||'—',mapped:!!goal,revType:'all',confRevType:c.revType||'all',basis:goal?basis:'—',
      target:bs.target,budget:bs.budget,matureCost:matureCost,revAtGoal:revAtGoal,roas:roas,
      cashBack:c.allRev,cashGap:c.allRev-c.cost,
      settings:bs,judgeMode:bs.judgeMode,budgetOnly:bs.judgeMode==='budget',
      roasOnly:bs.judgeMode==='roas',
      budgetPending:!!bs.budgetPending,budgetFrom:bs.curFrom||'',
      cappedCost:bs.cappedSpend||0,uncappedCost:Math.max(0,c.cost-(bs.cappedSpend||0))
    });
    o.verdict=judgeOverall(o,A);
    o.overBy=(o.budget!=null&&o.cappedCost>o.budget)?o.cappedCost-o.budget:0;
    return o;
  });
}

/* ------------------ 4 · what needs a decision today ------------------ */
/* This card reports the workbook and only the workbook: Campaign_Map's goal,
   revenue type and target, judged by the untouched engine. Nothing typed into
   the Campaign settings window reaches it. */

/** Why this row is here, in the words someone would use out loud. */
function whyText(c){
  const cap=c.budget!=null;
  if(c.verdict==='PASS'){
    if(c.budgetOnly)return 'Within its '+money0(c.budget)+' cap ('+pctOf(c.cappedCost/c.budget)+
      ' used). Judged on budget only, so its payback of <b>'+
      (c.roas!=null?'$'+c.roas.toFixed(2):'—')+' per $1</b> is shown for information and does not change this verdict.';
    return 'Brought back <b>$'+(c.roas!=null?c.roas.toFixed(2):'—')+'</b> per $1 against a <b>$'+
      (c.target!=null?c.target.toFixed(2):'—')+'</b> target'+(cap?', and stayed inside its '+money0(c.budget)+' cap':'')+'.';
  }
  if(c.verdict==='INSUFFICIENT DATA'||c.verdict==='PENDING'){
    return money0(c.cost)+' spent, but only '+money0(c.matureCost)+
      ' of it is old enough to grade — not enough to call yet.';
  }
  const partial=cap&&c.uncappedCost>0
    ? ' (the cap covered '+money0(c.cappedCost)+' of '+money0(c.cost)+' spent)':'';
  const overTxt=cap&&c.overBy>0
    ? 'Spend ran <span class="bad">'+money0(c.overBy)+' over</span> its '+money0(c.budget)+' cap'+partial+'.'
    : cap?'Spend used '+pctOf(c.cappedCost/c.budget)+' of its '+money0(c.budget)+' cap'+partial+'.':'';

  if(c.budgetPending){
    return 'Its '+money0(c.budget)+' cap takes effect <b>'+dmy(c.budgetFrom)+
      '</b>, which is after this date range, so none of the '+money0(c.cost)+
      ' shown here ran under it. Nothing to act on yet — the cap starts biting from that date.';
  }
  if(c.budgetOnly){
    /* No payback sentence for these - the install and revenue numbers behind
       one would be untrustworthy, so the row says only what is certain. */
    if(!cap)return 'Judged on budget only, and <b>no cap is set</b>, so nothing is holding it back. '+
      money0(c.cost)+' has gone out unchecked - set a budget in Campaign settings.';
    return overTxt+' Judged on budget only, because this network\'s install and revenue data is not reliable enough to grade payback.';
  }
  if(c.verdict==='NO GOAL - map it'){
    return 'No goal window is set for it, so nothing can tell whether it pays back. <b>'+
      money0(c.cost)+'</b> has gone out unwatched - give it a goal in Campaign_Map.'+(overTxt?' '+overTxt:'');
  }
  if(c.verdict==='NO BUDGET - set one'){
    return 'No budget cap is set, so overspend cannot be caught. '+money0(c.cost)+' has run so far.';
  }
  const day=String(c.goal||'').replace('D','day ');
  const back=c.revAtGoal||0,gap=c.matureCost-back;
  if(c.roas!=null){
    return 'Every <b>$1</b> spent has brought back <b>$'+c.roas.toFixed(2)+'</b> by '+day+
      '. It needs <b>$'+c.target.toFixed(2)+'</b>, so '+money0(c.matureCost)+' of graded spend has returned '+
      money0(back)+(gap>0?' - <span class="bad">'+money0(gap)+' still missing</span>.':'.')+
      (overTxt?' '+overTxt:'');
  }
  if(c.projected!=null){
    return 'Too early to measure at '+day+', but its day-0 revenue projects to <b>'+x2(c.projected)+
      '</b> against a <b>'+x2(c.target)+'</b> target, which is under the line.'+(overTxt?' '+overTxt:'');
  }
  return money0(c.cost)+' spent and still short of its <b>'+x2(c.target)+'</b> target.'+(overTxt?' '+overTxt:'');
}

/** Compact note on which rules were running, for the settings column. */
function ruleNote(c){
  const bs=c.settings||{};
  const bits=[];
  bits.push(JUDGE_LABEL[c.judgeMode]||'budget + ROAS');
  if(bs.basis==='historical')bits.push('rules in force per day');
  if(bs.targetChanged)bits.push('target changed');
  if(bs.budgetChanged)bits.push('budget changed');
  /* A cap set today governed none of a closed range, so the row is graded
     without it. Saying so stops that reading as "no budget is set". */
  if(bs.basis==='historical'&&bs.curBudget!=null&&bs.curBudget!==bs.histBudget){
    bits.push('now '+money0(bs.curBudget)+(bs.curFrom?' from '+dmy(bs.curFrom):''));
  }
  return bits.join(' · ');
}

function renderWatchlist(W){
  const A=DATA.assumptions;
  /* Everything on this card is the overall reading: one row per campaign,
     whole window, every setting that governed it blended by the spend that
     ran under it, judged on all revenue. */
  /* Picking a quiet verdict by name is an explicit request to see it; the
     default view stays limited to what actually needs a decision. */
  const showEverything=FILTERS.decision==='everything';
  const picked=FILTERS.decision;
  const quietPick=picked!=='all'&&!showEverything&&WATCH_RANK[picked]==null;
  const rows=filteredCampaigns({campaigns:overallCampaigns(W)})
    .filter(c=>c.verdict!=='not active'&&c.cost>0)
    .filter(c=>showEverything?true
              :quietPick?c.verdict===picked
                       :(WATCH_RANK[c.verdict]!=null&&(picked==='all'||picked===c.verdict)))
    .map(c=>({c:c,decision:c.verdict}))
    .sort((a,b)=>(WATCH_RANK[a.decision]!=null?WATCH_RANK[a.decision]:99)-
                 (WATCH_RANK[b.decision]!=null?WATCH_RANK[b.decision]:99)||b.c.cost-a.c.cost);

  const behind=rows.reduce((s,r)=>s+r.c.cost,0);
  const shown=WATCH_ALL?rows:rows.slice(0,WATCH_TOP);
  const changed=rows.filter(r=>r.c.settings&&r.c.settings.changed).length;
  $('watchSub').textContent=rows.length
    ? rows.length+' campaign'+(rows.length===1?'':'s')+(showEverything?' with spend in this range'
        :quietPick?' marked '+decisionLabel(picked)
        :' need a decision')+' · '+money(behind)+
      ' of spend behind them'+(changed?' · '+changed+' had a settings change inside this window':'')+
      ' · '+(shown.length<rows.length?'worst '+shown.length+' shown':'all shown')
    : (showEverything?'No campaign spent anything under the current filters.'
       :quietPick?'No campaign is marked '+decisionLabel(picked)+' under the current filters.'
                :'Nothing needs a decision under the current filters.');

  const cutGap=rows.filter(r=>r.decision==='FAIL - cut')
    .reduce((s,r)=>s+((r.c.revAtGoal||0)-r.c.matureCost),0);

  emptyOr('watchTable',shown.length,()=>buildTable('watchTable',
    ['Campaign','Network','Goal','Spend','Judged','Budget','Back per $1','Target ROAS','Result','Decision'],
    shown.map(r=>{
      const c=r.c,bs=c.settings||{},est=/proxy/.test(c.basis||'');
      const over=c.overBy>0;
      const young=Math.max(0,c.cost-(c.matureCost||0));
      return[
        {v:'<div class="nm">'+esc(c.campaign)+'</div><div class="sub">'+esc(ruleNote(c))+'</div>',
         cls:'name',title:c.campaign},
        {v:'<div>'+esc(c.channel)+'</div>'+(c.os?'<div class="sub">'+esc(c.os)+'</div>':'')},
        {v:'<div'+(c.budgetOnly?' class="sub"':'')+'>'+esc(c.goal)+'</div>'+
           (est?'<div class="sub">est</div>':'')},
        {v:money(c.cost),n:true,heat:c.cost,col:'spend',
         overBudget:c.budget!=null&&!c.budgetPending&&c.cappedCost>c.budget},
        {v:c.budgetOnly?'<span class="sub">—</span>'
            :money(c.matureCost||0)+(young>0?'<div class="sub">'+money(young)+' too new</div>'
                                            :'<div class="sub">all of it</div>'),
         n:true,heat:c.budgetOnly?NaN:(c.matureCost||0),col:'spend',
         title:'Spend old enough to grade - Back per $1 is measured on this, not on Spend'},
        {v:c.budget!=null
            ? money(c.budget)+
              (c.budgetPending
                 ? '<div class="sub">from '+esc(dmy(c.budgetFrom))+'</div>'+
                   '<div class="sub">not yet in force here</div>'
                 : (over?'<div class="sub bad">'+money(c.overBy)+' over</div>'
                       :'<div class="sub">'+pctOf(c.cappedCost/c.budget)+' used</div>')+
                   (bs.budgetChanged?'<div class="sub">blended</div>':''))
            : '<span class="sub">no cap set</span>',
         n:true,heat:c.budget!=null?c.budget:NaN,col:'budget',neg:!!over},
        /* Shown even where it is not part of the verdict: a Google Ads row at
           $0.20 against a $0.60 target is worth seeing, even though the cap is
           what decides its badge. */
        {v:c.roas!=null?'$'+c.roas.toFixed(2):'—',
         n:true,heat:NaN,neg:!c.budgetOnly&&c.roas!=null&&c.roas<c.target},
        {v:(c.target!=null?'$'+c.target.toFixed(2):'—')+
           (bs.targetChanged?'<div class="sub">blended</div>':''),
         n:true,heat:NaN},
        {v:whyText(c),cls:'why'},
        {v:badge(decisionLabel(r.decision),decisionBadge(r.decision))}
      ];
    }),
    {number:true,
     totals:(()=>{
       const spend=shown.reduce((s,r)=>s+r.c.cost,0);
       const judged=shown.reduce((s,r)=>s+(r.c.budgetOnly?0:(r.c.matureCost||0)),0);
       const back=shown.reduce((s,r)=>s+(r.c.budgetOnly?0:(r.c.revAtGoal||0)),0);
       const capped=shown.filter(r=>r.c.budget!=null).reduce((s,r)=>s+r.c.budget,0);
       return[
         {v:'These '+shown.length+' campaigns'},{v:''},{v:''},
         {v:money(spend),n:true},
         {v:judged>0?money(judged):'—',n:true},
         {v:capped>0?money(capped):'—',n:true},
         {v:judged>0?'$'+(back/judged).toFixed(2):'—',n:true,neg:judged>0&&back<judged},
         {v:''},
         {v:judged>0?money(judged-back)+' of graded spend has not come back':''},
         {v:''}
       ];
     })(),
     footer:cutGap<0?'Money already spent on the CUT rows that has not come back: '+money(cutGap):''}),
    'Nothing here is failing, over budget, under target, or missing a goal window.');
}

/* ------------- 5 · dated settings log, read on the rules in force ------------- */
/* This card answers "what were we holding this campaign to, and what did it do
   under those rules". It is a time series, not a list of periods: one row per
   campaign per date bucket. A settings change does not open a new row - it is
   written into the row for the bucket it landed in, so the history reads as a
   diary rather than as a set of disconnected spans.

   Only campaigns whose target ROAS or budget actually moved appear. A campaign
   that was set once and never touched has no history to tell.

   Maturity is measured from each row's OWN date against today, not against the
   end of the selected window. A D7 row for 14 Aug settles on 21 Aug and never
   moves again, whatever date filter is applied afterwards. */

/**
 * Campaigns whose effective target ROAS or budget actually moved.
 *
 * Detection runs on the campaign's EFFECTIVE timeline - what `sheetEntry`
 * would answer on each date a change was applied - rather than on each
 * revenue-type variant separately. Two things fall out of that, both wanted:
 * an entry replaced on the same day never shows up, because no date resolves
 * to it; and adding a second revenue-type row that takes over the campaign
 * counts as a change, because the rule the campaign runs under did move.
 */
function changedKeys(){
  const byHalf=new Map();
  Object.keys(OVERRIDES).forEach(key=>{
    const p=keyParts(key),half=p.campaign+'||'+p.channel;
    if(!byHalf.has(half))byHalf.set(half,new Set());
    entriesFor(key).forEach(e=>byHalf.get(half).add(e.from||''));
  });
  const floor=(DATA.days&&DATA.days[0])||'';
  const out=new Map();
  byHalf.forEach((dates,half)=>{
    const cut=half.indexOf('||'),campaign=half.slice(0,cut),channel=half.slice(cut+2);
    const marks=[];
    let t='',b='',first=true;
    [...dates].sort().forEach(d=>{
      const asOf=d||floor;
      const live=sheetEntry(campaign,channel,asOf);
      const e=live?live.entry:null;
      const nt=(e&&e.target!==''&&e.target!=null)?String(Number(e.target)):'';
      const nb=(e&&e.budget!==''&&e.budget!=null&&Number(e.budget)>0)?String(Number(e.budget)):'';
      if(!first&&(nt!==t||nb!==b)){
        marks.push({from:d||floor,tFrom:t,tTo:nt,bFrom:b,bTo:nb,
                    tMoved:nt!==t,bMoved:nb!==b,cleared:!e});
      }
      t=nt;b=nb;first=false;
    });
    if(marks.length)out.set(half,marks);
  });
  return out;
}

/** How the spend rate is expressed under the current grouping. */
const HIS_RATE={daily:{n:1,word:'a day'},weekly:{n:7,word:'a week'},monthly:{n:30,word:'a month'}};

/**
 * ONE row per campaign. A settings change never opens a second row - the
 * change is written into the "What changed" column of the campaign's own row,
 * which is what makes this readable as a diary rather than a pile of periods.
 *
 * Everything is measured across the whole selected range, because the budget
 * in Settings_Log is a cap PER WINDOW. Slicing it per day and reporting
 * "5% used" compares a window cap against one day of spend, which is a
 * number that cannot be acted on.
 */
function settingsSeries(W){
  const A=DATA.assumptions,today=todayISO();
  const marks=changedKeys();
  const idx=windowIdx(),days=idx.days,byDay=SLICE?SLICE.byDay:ROWS_BY_DAY;
  const campaigns=SLICE?SLICE.campaigns:DATA.campaigns,channels=SLICE?SLICE.channels:DATA.channels;
  const rows=new Map();

  /* Every campaign carrying a saved setting appears, whether or not it has
     changed yet. Waiting for a second record before showing anything left the
     card blank exactly when someone had just set a budget and wanted to see
     it land. The change history is a column on the row, not the reason for it. */
  const tracked=new Set();
  Object.keys(OVERRIDES||{}).forEach(k=>{if((OVERRIDES[k]||[]).length)tracked.add(campHalf(k))});
  const blank=half=>{
    const cut=half.indexOf('||'),campaign=half.slice(0,cut),channel=half.slice(cut+2);
    const ci=campIndexOf(campaign,channel),meta=ci>=0?DATA.campaigns[ci]:null;
    const os=meta?String(meta[2]||'unknown').toLowerCase():'';
    if(PLATFORM!=='all'&&os&&os!==PLATFORM)return null;
    return{key:half,campaign:campaign,channel:channel,os:os,
           cost:0,cappedCost:0,uncappedCost:0,matureCost:0,revAtGoal:0,
           matureDays:0,youngDays:0,dayCount:0,seen:new Set(),
           goals:new Set(),targets:[],budgets:[],firstDay:'',lastDay:'',
           budgetFrom:'',judgeMode:judgeModeAt(campaign,channel,todayISO()),
           budgetOnly:judgeModeAt(campaign,channel,todayISO())==='budget',meta:meta};
  };
  tracked.forEach(half=>{const r=blank(half);if(r)rows.set(half,r)});
  if(idx.si<0)return finishSeries([...rows.values()],A,marks,today);

  for(let di=idx.si;di<=idx.ei;di++){
    const iso=days[di];
    (byDay[di]||[]).forEach(r=>{
      const camp=campaigns[r[0]];if(!camp)return;
      const os=String(camp[2]||'unknown').toLowerCase();
      if(PLATFORM!=='all'&&os!==PLATFORM)return;
      const channel=channels[camp[1]],half=camp[0]+'||'+channel;
      if(!rows.has(half))return;

      const e=settingOn(camp[0],channel,iso);
      const goal=(e&&e.goal)?e.goal:(camp[4]||'');
      const target=(e&&e.target!==''&&e.target!=null)?Number(e.target)
        :((camp[6]!=null&&camp[6]!=='')?Number(camp[6]):fallbackTarget(goal,A));
      const budget=(e&&e.budget!==''&&e.budget!=null&&Number(e.budget)>0)?Number(e.budget):null;

      const row=rows.get(half);
      if(!row.firstDay){row.firstDay=iso;row.lastDay=iso}
      row.cost+=r[2];
      if(budget!=null){row.cappedCost+=r[2];row.budgetFrom=(e&&e.from)||''}
      else row.uncappedCost+=r[2];
      if(!row.seen.has(iso)){row.seen.add(iso);row.dayCount++}
      if(iso<row.firstDay)row.firstDay=iso;
      if(iso>row.lastDay)row.lastDay=iso;
      if(goal)row.goals.add(goal);
      row.targets.push({t:target,cost:r[2]});
      row.budgets.push({b:budget,cost:r[2]});

      /* Revenue at this campaign's own goal, counted only once the install day
         has actually reached that goal - measured against today, not against
         the end of whatever range happens to be selected. */
      const gd=goalDaysOf(goal);
      if(gd==null){row.youngDays++;return}
      if(iso>isoShift(today,-gd)){row.youngDays++;return}
      let rev;
      if(gd===0)rev=r[6]+r[7];
      else if(gd===7)rev=r[8]+r[9];
      else if(gd===28)rev=r[10]+r[11];
      else rev=A.m_d28_d30*(r[10]+r[11]);
      row.matureCost+=r[2];row.revAtGoal+=rev;row.matureDays++;
    });
  }

  return finishSeries([...rows.values()],A,marks,today);
}

/** Blend the settings that governed each row and grade it. */
function finishSeries(out,A,marks,today){
  out.forEach(row=>{
    /* A campaign with no spend in the range still shows the settings it is
       carrying, so an Apply is visible the moment it lands. */
    if(!row.targets.length){
      const anchor=(DATA.days&&DATA.days[DATA.days.length-1])||today;
      const e=settingOn(row.campaign,row.channel,anchor);
      const goal=(e&&e.goal)?e.goal:(row.meta?(row.meta[4]||''):'');
      if(goal)row.goals.add(goal);
      row.targets.push({t:(e&&e.target!==''&&e.target!=null)?Number(e.target):fallbackTarget(goal,A),cost:0});
      row.budgets.push({b:(e&&e.budget!==''&&e.budget!=null&&Number(e.budget)>0)?Number(e.budget):null,cost:0});
      row.budgetFrom=(e&&e.from)||'';
    }
    const wt=row.targets.reduce((x,v)=>x+v.t*v.cost,0),tc=row.targets.reduce((x,v)=>x+v.cost,0);
    row.target=tc>0?wt/tc:(row.targets.length?row.targets[row.targets.length-1].t:null);
    row.targetChanged=[...new Set(row.targets.map(v=>v.t.toFixed(4)))].length>1;
    const capped=row.budgets.filter(v=>v.b!=null),cc=capped.reduce((x,v)=>x+v.cost,0);
    row.budget=capped.length?(cc>0?capped.reduce((x,v)=>x+v.b*v.cost,0)/cc:capped[capped.length-1].b):null;
    row.budgetChanged=[...new Set(row.budgets.map(v=>v.b==null?'':v.b.toFixed(2)))].length>1;
    row.goal=row.goals.size?[...row.goals].join(' / '):'—';
    row.roas=row.matureCost>0?row.revAtGoal/row.matureCost:null;
    if(!row.goals.size){row.target=null;row.targetChanged=false;row.roas=null}
    row.settled=row.youngDays===0&&row.matureDays>0;
    row.noSpend=row.cost<=0;
    /* Two readings, kept apart.

       row.histBudget / row.histTarget are what actually governed the days in
       range, blended by the spend that ran under each. They are what the row is
       GRADED on whenever the range is a look back, because spend from before a
       cap existed cannot be measured against that cap.

       row.curBudget / row.curTarget are what the campaign is carrying today.
       Apply stamps a change with today's date and the data always lags that, so
       a budget set this morning governed none of the window — it is shown as
       context next to its effective date. Overwriting the blended figure with
       it, which is what used to happen here, applied today's cap backwards over
       history and is exactly what the range view must not do. */
    const cur=settingOn(row.campaign,row.channel,today);
    row.curFrom=(cur&&cur.from)||'';
    /*
     * The date the Date column shows is the one that governed THIS range, not
     * the one running today.
     *
     * A budget backdated to 01-08 and a later one dated 28-08 are both real
     * records. Looking at 10-20 August, the record that governed those days is
     * the 01-08 one, and dating the row 28-08 pointed at a period the range
     * never touched — the number beside it came from 01-08, so the date has to
     * as well. Today's date is still kept, in curFrom, for the "now running"
     * note where the two differ.
     */
    const atEnd=settingOn(row.campaign,row.channel,row.lastDay||today);
    row.rangeFrom=(atEnd&&atEnd.from)||'';
    row.curBudget=(cur&&cur.budget!==''&&cur.budget!=null&&Number(cur.budget)>0)?Number(cur.budget):null;
    row.curTarget=(cur&&cur.target!==''&&cur.target!=null)?Number(cur.target):null;
    row.histBudget=row.budget;row.histTarget=row.target;
    row.histCappedCost=row.cappedCost;row.histUncappedCost=row.uncappedCost;

    /* The standing view of the account is a question about the rules running
       now, so there it does read the current setting across the window. A
       custom range, or a preset pushed back off the end of the data, is a
       question about history and keeps the blend. */
    row.basis=isHistoricalRange()?'historical':'current';
    if(row.basis==='current'){
      if(row.curBudget!=null){
        row.budget=row.curBudget;row.budgetChanged=false;
        row.cappedCost=row.cost;row.uncappedCost=0;
      }
      if(row.curTarget!=null&&row.goals.size){row.target=row.curTarget;row.targetChanged=false}
    }else if(row.budget==null&&row.curBudget!=null){
      /* Shown with its start date rather than as "none", but with nothing
         measured against it — see blendSettings for why. */
      row.budget=row.curBudget;row.budgetPending=true;
      row.cappedCost=0;row.uncappedCost=row.cost;
    }
    /* Every change this campaign has ever had, flagged for whether it landed
       inside the range on screen. */
    row.over=row.budget!=null&&!row.budgetPending&&row.cappedCost>row.budget;
    row.overBy=row.over?row.cappedCost-row.budget:0;
    row.marks=(marks.get(row.key)||[]).map(m=>
      Object.assign({},m,{inWindow:!!(row.firstDay&&m.from>=row.firstDay&&m.from<=row.lastDay)}));
    row.verdict=hisVerdict(row,A);
  });
  out.sort((a,b)=>b.cost-a.cost||a.campaign.localeCompare(b.campaign));
  return out;
}

/** The two tests, per network rule, for one campaign row. */
function hisVerdict(row,A){
  const over=row.over&&!row.budgetPending&&row.judgeMode!=='roas';
  if(row.budgetOnly&&row.budgetPending)return 'PASS';
  if(row.cost<=0)return 'NO SPEND';
  if(row.budgetOnly)return row.budget==null?'NO BUDGET - set one':(row.over?'OVER BUDGET':'PASS');
  if(row.target==null)return 'NO GOAL - map it';
  if(row.roas==null)return over?'OVER BUDGET':'INSUFFICIENT DATA';
  if(row.roas<row.target*A.atRiskPace)return 'FAIL - cut';
  if(row.roas<row.target)return 'UNDER TARGET';
  return over?'OVER BUDGET':'PASS';
}

/**
 * The latest change only - "25-08-2026 · budget $10,000 → $20,000 · target
 * ROAS unchanged at $0.60". Settings_Log already holds every change ever
 * applied, so restacking them all here just makes the cell unreadable; the
 * count is kept so it is obvious more history exists in the sheet.
 */
function changeText(row){
  if(!row.marks.length){
    return '<div>no budget change</div><div>no Target ROAS change</div>';
  }
  const m=row.marks[row.marks.length-1];
  const bShow=v=>v===''?'none':money0(Number(v));
  const tShow=v=>v===''?'auto':Number(v).toFixed(2);
  const budget=m.bMoved?bShow(m.bFrom)+' → '+bShow(m.bTo):'no budget change';
  const target=m.tMoved?tShow(m.tFrom)+' → '+tShow(m.tTo):'no Target ROAS change';
  return '<div>'+budget+'</div><div>'+target+'</div>';
}

/** Did it breach the cap, and did it reach target. Nothing else. */
function resultText(row){
  const bits=[];
  if(row.noSpend){
    return '<span class="sub">no spend inside this date range — the settings above are what it is carrying</span>';
  }
  if(row.budgetPending){
    bits.push('the '+money0(row.budget)+' budget starts '+dmy(row.curFrom)+
      ', after this range — none of this spend ran under it');
  }else if(row.budget!=null){
    const part=row.uncappedCost>0
      ? ' <span class="sub">(the cap covered '+money0(row.cappedCost)+' of '+money0(row.cost)+' spent)</span>':'';
    bits.push(row.over
      ? '<span class="bad">'+money0(row.overBy)+' over the '+money0(row.budget)+' budget</span>'+part
      : 'within the '+money0(row.budget)+' budget ('+pctOf(row.cappedCost/row.budget)+' used)'+part);
  }else bits.push('<span class="sub">no budget cap set</span>');

  if(row.budgetOnly){
    bits.push('<span class="sub">payback not part of the verdict on this network</span>');
  }else if(row.roas==null){
    bits.push(row.youngDays>0
      ? '<span class="sub">no day here has reached '+esc(row.goal)+' yet</span>'
      : '<span class="sub">nothing old enough to grade</span>');
  }else{
    bits.push(row.roas>=row.target
      ? '<span class="ok">reached target</span> — $'+row.roas.toFixed(2)+' against $'+row.target.toFixed(2)
      : '<span class="bad">fell below target</span> — $'+row.roas.toFixed(2)+' against $'+row.target.toFixed(2));
  }

  /* On a look back the row is graded on the rules that were running then, which
     is right but leaves an obvious question when a setting has moved since:
     "so what is it on now?". Answering it here is what lets the range view stay
     historically honest without a change appearing to have done nothing. */
  if(row.basis==='historical'){
    const now=[];
    if(row.curBudget!=null&&row.curBudget!==row.histBudget)now.push('budget '+money0(row.curBudget));
    if(row.curTarget!=null&&row.curTarget!==row.histTarget)now.push('target $'+row.curTarget.toFixed(2));
    if(now.length){
      bits.push('<span class="sub">now running '+now.join(' · ')+
        (row.curFrom?' from '+dmy(row.curFrom):'')+', which did not govern this range</span>');
    }
  }
  return bits.join(' · ');
}

/**
 * What the settings layer currently holds, so an empty table can say WHY it is
 * empty. "No campaign has changed" was covering four different failures - no
 * records loaded at all, records loaded but only one per campaign, records that
 * changed outside the range, and an outright error - and they need different
 * actions from whoever is reading.
 */
function settingsDiag(){
  const keys=Object.keys(OVERRIDES||{});
  const records=keys.reduce((n,k)=>n+(OVERRIDES[k]||[]).length,0);
  const campaigns=new Set(keys.map(k=>campHalf(k))).size;
  let changed=0,error='';
  try{changed=changedKeys().size}catch(e){error=e&&e.message?e.message:String(e)}
  const multi=[...new Set(keys.map(k=>campHalf(k)))].filter(half=>{
    const dates=new Set();
    keys.filter(k=>campHalf(k)===half).forEach(k=>entriesFor(k).forEach(e=>dates.add(e.from||'')));
    return dates.size>1;
  }).length;
  return{keys:keys.length,records:records,campaigns:campaigns,changed:changed,multi:multi,error:error};
}

function renderHistory(W){
  let all=[],seriesError='';
  try{all=settingsSeries(W)}catch(e){all=[];seriesError=(e&&e.message)||String(e)}
  populateHistoryFilters(all);
  const rows=all.filter(r=>
    (FILTERS.hisChannel==='all'||r.channel===FILTERS.hisChannel)&&
    (FILTERS.hisCampaign==='all'||r.campaign===FILTERS.hisCampaign));

  const rate=HIS_RATE[FILTERS.hisPeriod]||HIS_RATE.daily;
  const openRows=rows.filter(r=>!r.settled).length;
  const d=settingsDiag();

  let why;
  if(all.length){
    const withChange=rows.filter(r=>r.marks&&r.marks.length).length;
    why=rows.length+' campaign'+(rows.length===1?'':'s')+' carrying a saved target ROAS or budget · one row each · '+
      withChange+' with a change on record · each row is measured on the settings running now, '+
      'against the spend in the selected range'+
      (openRows?' · <b>'+openRows+'</b> still filling in until every day reaches its goal window':'');
  }else if(d.error||seriesError){
    why='<b class="bad">Could not read the settings log:</b> '+esc(d.error||seriesError)+
        ' · press Refresh, and report this if it repeats.';
  }else if(!d.records){
    why='<b class="bad">No settings records loaded.</b> Settings_Log came back empty, so no change can be shown. '+
        'Press <b>Refresh</b> — if it stays empty after an Apply, the write has not reached the workbook yet.';
  }else if(!d.changed){
    why=d.records+' settings record'+(d.records===1?'':'s')+' loaded across '+d.campaigns+' campaign'+
        (d.campaigns===1?'':'s')+', but none of them match the current platform or campaign filter.';
  }else{
    why='<b>'+d.campaigns+'</b> campaign'+(d.campaigns===1?'':'s')+' carry a saved setting, but nothing '+
        'matches the current filters — check the platform and network pickers.';
  }
  $('hisSub').innerHTML=why;

  emptyOr('historyTable',rows.length,()=>buildTable('historyTable',
    ['Date','Campaign','Network','Goal','Target ROAS','Budget','Spend','ROAS at goal','What changed','Result'],
    rows.map(r=>{
      const perRate=r.dayCount>0?(r.cost/r.dayCount)*rate.n:null;
      return[
        /* The date a setting STARTED, not the stretch of days that happen to
           have spend in the range on screen. The old reading answered "when did
           this campaign spend", which nobody was asking — the column sits next
           to Target ROAS and Budget, so it has to say when those took effect. */
        {v:'<div class="nm">'+(r.rangeFrom?dmy(r.rangeFrom):
             (r.curFrom?dmy(r.curFrom):'from the start'))+'</div>'+
           '<div class="sub">'+(r.marks&&r.marks.length
             ? 'changed '+r.marks.length+'&times;'
             : 'first setting')+'</div>'+
           '<div class="sub">'+(r.dayCount
             ? r.dayCount+' day'+(r.dayCount===1?'':'s')+' with spend '+dmy(r.firstDay)+' → '+dmy(r.lastDay)
             : 'no spend in range')+'</div>',cls:'period'},
        {v:'<div class="nm">'+esc(r.campaign)+'</div>',cls:'name',title:r.campaign},
        {v:'<div>'+esc(r.channel)+'</div>'+(r.os?'<div class="sub">'+esc(r.os)+'</div>':'')},
        {v:esc(r.goal)},
        {v:(r.target!=null?'$'+r.target.toFixed(2):'—')+
           (r.targetChanged?'<div class="sub">blended</div>':'')+
           (r.budgetOnly?'<div class="sub">not used here</div>':''),n:true,heat:NaN},
        {v:(r.budget!=null?money(r.budget):'<span class="sub">none</span>')+
           (r.budgetChanged?'<div class="sub">blended</div>':''),
         n:true,heat:r.budget!=null?r.budget:NaN,col:'budget',neg:!!r.over,
         title:'From Settings_Log — a cap per window, not per day'},
        {v:money(r.cost)+(perRate!=null?'<div class="sub">'+money(perRate)+' '+rate.word+'</div>':''),
         n:true,heat:r.cost,col:'spend',overBudget:!!r.over},
        {v:r.roas!=null
            ? '$'+r.roas.toFixed(2)+'<div class="sub">'+r.matureDays+' of '+
              (r.matureDays+r.youngDays)+' days mature</div>'
            : '<span class="sub">not yet</span>',
         n:true,heat:NaN,neg:!r.budgetOnly&&r.roas!=null&&r.target!=null&&r.roas<r.target},
        {v:changeText(r),cls:'why'},
        {v:resultText(r)+'<div style="margin-top:5px">'+
           badge(WATCH_LABEL[r.verdict]||(r.verdict==='PASS'?'OK':r.verdict),
                 WATCH_BADGE[r.verdict]||(r.verdict==='PASS'?'b-ok':'b-mute'))+'</div>',cls:'why'}
      ];
    }),{number:true}),
    'Nothing matches these filters.');
}

function populateHistoryFilters(all){
  const fill=(id,values,current,label)=>{
    const sel=$(id);
    if(!sel)return current;
    const opts=['<option value="all">'+label+'</option>']
      .concat(values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>'));
    sel.innerHTML=opts.join('');
    const next=values.indexOf(current)>=0?current:'all';
    sel.value=next;
    return next;
  };
  const chans=[...new Set(all.map(r=>r.channel))].sort();
  const camps=[...new Set(all.map(r=>r.campaign))].sort();
  FILTERS.hisChannel=fill('hisChannel',chans,FILTERS.hisChannel,'All networks');
  FILTERS.hisCampaign=fill('hisCampaign',camps,FILTERS.hisCampaign,'All campaigns');
  const per=$('hisPeriod');
  if(per)per.value=FILTERS.hisPeriod||'daily';
}

function filteredCampaigns(W){
  return W.campaigns.filter(c=>{
    if(FILTERS.campChannel!=='all'&&c.channel!==FILTERS.campChannel)return false;
    if(FILTERS.campCampaign!=='all'&&c.campaign!==FILTERS.campCampaign)return false;
    if(FILTERS.campGoal==='none'){if(c.goal!=='—')return false}
    else if(FILTERS.campGoal!=='all'&&c.goal!==FILTERS.campGoal)return false;
    if(FILTERS.campVerdict!=='all'&&c.verdict!==FILTERS.campVerdict)return false;
    /* 'allrev' means the campaigns judged on both streams together, which the
       engine spells 'all' — the filter's own 'all' means no filter at all. */
    if(FILTERS.campRev!=='all'){
      const want=FILTERS.campRev==='allrev'?'all':FILTERS.campRev;
      /* Overall rows are always judged on all revenue, so this filter reads
         the stream the campaign is CONFIGURED on rather than the one it was
         graded on - otherwise every row would answer to 'all'. */
      if((c.confRevType||c.revType||'all')!==want)return false;
    }
    return true;
  });
}

/* A bar is only a shape until it says what it is. One floating panel is reused
   for the whole strip, positioned against the bar rather than the cursor so it
   does not jitter while the mouse moves inside a bar. */
function bindStripTooltip(days){
  const strip=$('dailyStrip');
  if(!strip)return;
  let tip=$('striptip');
  if(!tip){
    tip=document.createElement('div');
    tip.id='striptip';tip.className='striptip';
    document.body.appendChild(tip);
  }
  const row=(label,value,cls)=>'<span><i>'+label+'</i><em style="font-style:normal'+
    (cls?';color:var(--'+cls+')':'')+'">'+value+'</em></span>';

  strip.onmouseover=ev=>{
    const bar=ev.target.closest('.sbar');
    if(!bar||!strip.contains(bar))return;
    const d=days[Number(bar.dataset.day)];
    if(!d)return;
    const mode=FILTERS.marginPeriod;
    tip.innerHTML='<b>'+periodLabel(d,mode)+'</b>'+
      row('spend',money2(d.cost))+
      row('revenue',money2(d.all))+
      row('profit',money2(d.gp),d.gp<0?'coral':'green')+
      row('margin',pctOf(d.margin))+
      (d.norm!=null?row(mode==='daily'?'weekday norm':'period norm',pctOf(d.norm)):'')+
      (d.delta!=null?row('vs norm',(d.delta>0?'+':'')+d.delta.toFixed(1)+' pp',d.delta<0?'coral':'green'):'')+
      row('status',d.status,d.status==='NEGATIVE'?'coral':d.status==='BELOW BASELINE'?'amber':'green');
    const r=bar.getBoundingClientRect();
    tip.classList.add('show');
    const w=tip.offsetWidth,h=tip.offsetHeight;
    let left=r.left+r.width/2-w/2;
    left=Math.max(10,Math.min(left,window.innerWidth-w-10));
    let top=r.top-h-10;
    if(top<10)top=r.bottom+10;
    tip.style.left=left+'px';
    tip.style.top=top+'px';
  };
  strip.onmouseleave=()=>tip.classList.remove('show');
}

/* ============================== WIDGETS ============================== */

function emptyOr(id,count,build,message){
  if(count)build();
  else $(id).innerHTML='<div class="empty">'+esc(message)+'</div>';
}

function setComparison(valueId,current,previous,opts){
  opts=opts||{};
  const value=$(valueId),card=value&&value.closest('.kpi');
  if(!card)return;
  let line=card.querySelector('.cmp');
  if(!line){line=document.createElement('div');line.className='cmp';card.appendChild(line)}
  const cur=Number(current),prev=Number(previous);
  if(current==null||previous==null||!isFinite(cur)||!isFinite(prev)){
    line.className='cmp';line.textContent='Previous period unavailable';return;
  }
  const delta=cur-prev,pct=prev!==0?Math.abs(delta/prev*100):null;
  const higherBetter=opts.higherBetter!==false,good=delta===0?null:(higherBetter?delta>0:delta<0);
  line.className='cmp '+(good==null?'':good?'good':'bad');
  const arrow=delta>0?'▲':delta<0?'▼':'•',change=pct==null?'new':pct.toFixed(1)+'%';
  const format=opts.format||compact;
  line.textContent=arrow+' '+change+' vs previous period (prev: '+format(prev)+')';
}

function cssVar(name,fallback){
  try{const v=getComputedStyle(document.body).getPropertyValue(name).trim();return v||fallback}
  catch(e){return fallback}
}
function destroy(id){if(charts[id]){charts[id].destroy();delete charts[id]}}

/**
 * A bar chart, optionally with a list of lines shown under the value when a
 * bar is hovered. `detail` is an array parallel to the bars; each entry is an
 * array of strings. A bar with a total but no names behind it is a shape, not
 * an answer - the names are what make it actionable.
 */
function barChart(id,labels,values,colors,detail){
  destroy(id);
  const el=$(id);if(!el)return;
  charts[id]=new Chart(el,{
    type:'bar',
    data:{labels:labels,datasets:[{label:'Spend in window',data:values,backgroundColor:colors,borderRadius:4}]},
    options:{indexAxis:'y',maintainAspectRatio:false,animation:{duration:400},
      plugins:{legend:{display:false},
        tooltip:{
          /* Chart.js caps nothing itself, so the caller trims the list; this
             just keeps the box from wrapping into an unreadable block. */
          bodyFont:{size:11.5},boxPadding:4,caretPadding:6,
          callbacks:{
            label:c=>money2(c.raw),
            afterBody:items=>{
              if(!detail||!items||!items.length)return '';
              const lines=detail[items[0].dataIndex];
              return (lines&&lines.length)?[''].concat(lines):'';
            }
          }
        }},
      scales:{x:{beginAtZero:true,ticks:{callback:v=>compact(v)}},y:{grid:{display:false}}}}
  });
}

function badge(text,cls){return '<span class="badge '+cls+'">'+esc(text)+'</span>'}

function tableNumber(value){
  const text=String(value==null?'':value).replace(/<[^>]*>/g,'').trim();
  if(!text||text==='—'||/[A-Za-z]{2,}/.test(text.replace(/(?:K|M|B|x)$/i,'')))return null;
  const match=text.replace(/,/g,'').match(/[-+]?\$?\s*(\d+(?:\.\d+)?)([KMB])?\s*(%|x)?/i);
  if(!match)return null;
  let n=Number(match[1]);if(/^\s*-/.test(text))n=-n;
  const mult={K:1e3,M:1e6,B:1e9}[String(match[2]||'').toUpperCase()]||1;
  return n*mult;
}

/**
 * Cells arrive as {v, n, cls, heat, col, neg, title}. `heat` and `col` drive a
 * per-column intensity fill so the eye lands on the large numbers first, which
 * is the whole point of a monitoring table.
 */
function buildTable(id,headers,rows,opts){
  opts=opts||{};
  const el=$(id);
  if(!el)return;
  if(!rows.length){el.innerHTML='<div class="empty">No rows in this window</div>';return}

  const HUE={cost:[0,229,195],spend:[0,158,111],budget:[27,115,88],
             warning:[255,184,0],rev:[77,159,255],gp:[236,10,155],count:[255,184,0]};
  const ranks={};
  const columnKind=h=>/cost|spend|ecpi|shortfall/i.test(h)?'cost':
    /rev|revenue/i.test(h)?'rev':/profit|margin|roi|roas|pace|delta|target|projected|coverage/i.test(h)?'gp':'count';
  rows.forEach(r=>r.forEach((c,i)=>{if(!c.n)return;const value=c.heat!=null?Number(c.heat):tableNumber(c.v);if(value==null||!isFinite(value))return;(ranks[i]||(ranks[i]=[])).push(value)}));
  Object.keys(ranks).forEach(i=>ranks[i]=[...new Set(ranks[i])].sort((a,b)=>a-b));
  const fill=(c,i)=>{
    if(!c.n||!ranks[i])return '';
    const value=c.heat!=null?Number(c.heat):tableNumber(c.v);
    if(value==null||!isFinite(value))return '';
    const values=ranks[i],t=values.length>1?values.indexOf(value)/(values.length-1):1;
    const kind=c.overBudget?'warning':(c.col||columnKind(headers[i]));
    const[r,g,b]=HUE[kind]||HUE.count;
    /* On the black table background, lower opacity is the visibly darker
       shade. Rank upward toward that shade so the highest value is darkest. */
    const alpha=0.36-0.20*t;
    return `background:rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  };
  const showNum=opts.number!==false;

  el.innerHTML='<table><thead><tr>'+
    (showNum?'<th class="idx">#</th>':'')+
    headers.map((h,i)=>{
      const isNum=rows[0][i]&&rows[0][i].n;
      return `<th class="${isNum?'num':''}">${esc(h)}</th>`;
    }).join('')+
    '</tr></thead><tbody>'+
    rows.map((r,i)=>'<tr>'+(showNum?`<td class="idx">${i+1}</td>`:'')+
      r.map((c,j)=>{
        const cls=[c.n?'num':'',c.cls||''].filter(Boolean).join(' ');
        const style=[c.bg?'background:'+c.bg:fill(c,j),c.neg?'color:var(--coral)':''].filter(Boolean).join(';');
        const title=c.title?` title="${esc(c.title)}"`:'';
        return `<td class="${cls}" style="${style}"${title}>${c.v}</td>`;
      }).join('')+'</tr>').join('')+
    '</tbody>'+
    (opts.totals&&opts.totals.length
      ? '<tfoot><tr>'+(showNum?'<td class="idx"></td>':'')+
        opts.totals.map(c=>`<td class="${[c.n?'num':'',c.cls||''].filter(Boolean).join(' ')}"${c.neg?' style="color:var(--coral)"':''}>${c.v}</td>`).join('')+
        '</tr></tfoot>'
      : '')+
    '</table>'+
    (opts.footer?`<div style="padding:11px 12px;color:var(--amber);background:rgba(255,184,0,.08);border-top:1px solid rgba(255,184,0,.24);font:650 12.5px Poppins,system-ui,sans-serif">${esc(opts.footer)}</div>`:'');
}


/* ==================== CAMPAIGN SETTINGS POP-UP ==================== */
/* One row per campaign, holding the settings that are running today. Typing
   only fills a draft; Apply is what writes. Applying stamps today's date on
   the new settings, which closes the period before it — the history of those
   periods belongs in the Settings history table, not in here. */

let MAP_SEARCH='';
let DRAFTS={};              /* key -> {field: value} not yet applied */

function openMap(){
  $('mapModal').hidden=false;
  $('mapSearch').value=MAP_SEARCH;
  renderMapTable();
}

function campaignWithCurrentSetting(c,A,asOf){
  const live=sheetEntry(c.campaign,c.channel,asOf);
  if(!live)return c;
  const e=live.entry,goal=e.goal||'',revType=e.revType||keyParts(live.key).revType||'all';
  const target=(e.target!==''&&e.target!=null)?Number(e.target)
    :(goal==='D0'?A.target_d0:goal==='D28'?A.target_d28:goal==='D30'?A.target_d30:A.target_d7);
  const pick=(ad,iap)=>revType==='ad'?ad:revType==='iap'?iap:ad+iap;
  let matureCost=c.cost7,revAtGoal=null,basis='actual';
  if(goal==='D0'){matureCost=c.cost;revAtGoal=pick(c.adD0,c.iapD0)}
  else if(goal==='D7'){matureCost=c.cost7;revAtGoal=pick(c.adD7,c.iapD7)}
  else if(goal==='D28'){matureCost=c.cost28;revAtGoal=pick(c.adD28,c.iapD28)}
  else if(goal==='D30'){
    matureCost=c.cost30;revAtGoal=A.m_d28_d30*pick(c.adD30,c.iapD30);
    basis='d28 × '+A.m_d28_d30.toFixed(3)+' (proxy)';
  }
  const roas=(revAtGoal!=null&&matureCost>0)?revAtGoal/matureCost:null;
  const allD0=c.adD0+c.iapD0,allD7=c.adD7+c.iapD7;
  let projected=null;
  if(goal==='D7'&&c.cost>0)projected=(allD0/c.cost)*A.m_d0_d7;
  else if(goal==='D28'&&c.cost7>0)projected=(allD7/c.cost7)*A.m_d7_d28;
  else if(goal==='D30'&&c.cost7>0)projected=(allD7/c.cost7)*A.m_d7_d28*A.m_d28_d30;
  const pace=(roas>0)?roas/target:(projected>0?projected/target:null);
  let verdict;
  if(c.cost<=0)verdict='not active';
  else if(!goal)verdict='NO GOAL - map it';
  else if(matureCost<A.minMatureSpend)verdict='INSUFFICIENT DATA';
  else if(!roas)verdict='PENDING';
  else if(roas>=target)verdict='PASS';
  else if(roas<target*A.atRiskPace)verdict='FAIL - cut';
  else verdict='UNDER TARGET';
  return Object.assign({},c,{mapped:!!goal,goal:goal||'—',revType:revType,target:target,
    matureCost:matureCost,revAtGoal:revAtGoal,roas:roas,projected:projected,
    pace:pace,basis:goal?basis:'—',verdict:verdict});
}
function closeMap(){$('mapModal').hidden=true}
function dismissMap(){
  DRAFTS={};
  updateMapUnsaved();
  $('mapModal').hidden=true;
}

function statsByKey(W){
  const m={};
  W.campaigns.forEach(c=>{m[c.campaign+'||'+c.channel]=c});
  return m;
}

/**
 * The campaign's figures inside one settings row's own period, measured on
 * that row's revenue type and target rather than whatever is current.
 */
function periodStat(key,idx){
  const span=entrySpan(key,idx);
  if(!span)return null;
  const p=keyParts(key);
  const ci=campIndexOf(p.campaign,p.channel);
  const entry=entriesFor(key)[idx]||null;
  const W=spanWindow(span.from,span.to,ci,entry);
  if(!W)return{span:span,c:null,W:null};
  const stats=statsByKey(W);
  return{span:span,c:stats[p.campaign+'||'+p.channel]||null,W:W};
}

function todayISO(){return toISO(new Date())}
/** 2026-08-24 -> 24-08-2026, the way the sheet's own dates read. */
function dmy(iso){
  if(!iso)return '';
  const p=String(iso).split('-');
  return p.length===3?p[2]+'-'+p[1]+'-'+p[0]:String(iso);
}
/** What is running today on one settings row, draft included. */
function currentSettings(key,base){
  /* Resolved periods, not raw log rows: a change that moved only the budget
     leaves the target cell blank on its row, and the box has to show the target
     that is still running rather than going empty. */
  const periods=periodsFor(key);
  const last=periods.length?periods[periods.length-1]:null;
  const live=(last&&last.action!=='cleared')?last:null;
  const draft=DRAFTS[key]||{};
  const pick=(field,fallback)=>{
    if(draft[field]!==undefined)return draft[field];
    if(live&&live[field]!==''&&live[field]!=null)return live[field];
    return fallback;
  };
  return{
    live:live,idx:periods.length?periods.length-1:0,saved:!!live,
    goal:pick('goal',base.goal),
    revType:pick('revType',keyParts(key).revType),
    target:pick('target',''),
    budget:pick('budget',''),
    judge:pick('judge',''),
    since:live?(live.from||''):''
  };
}

/**
 * The settings rows to draw for one campaign: every revenue type it has been
 * given settings for, plus anything half-typed, or a single row on the sheet's
 * own revenue type when it has none.
 */
function rowKeysFor(r,base){
  const half=r.name+'||'+r.channel;
  const keys=liveVariantsOf(r.name,r.channel,todayISO())
    .concat(Object.keys(DRAFTS).filter(k=>campHalf(k)===half));
  const seen={},out=[];
  keys.forEach(k=>{if(!seen[k]){seen[k]=1;out.push(k)}});
  if(!out.length)out.push(setKey(r.name,r.channel,base.revType||'all'));
  return out.sort((a,b)=>REV_TYPES.indexOf(keyParts(a).revType)-REV_TYPES.indexOf(keyParts(b).revType));
}
function isDirty(key){
  const d=DRAFTS[key];
  return !!d&&Object.keys(d).length>0;
}
function updateMapUnsaved(){
  const count=Object.keys(DRAFTS).filter(isDirty).length,el=$('mapUnsaved');
  if(!el)return;
  el.classList.toggle('clean',count===0);
  const badge=el.querySelector('b');if(badge)badge.textContent=count;
}

function renderMapTable(){
  updateMapUnsaved();
  const today=DATA.days[DATA.days.length-1]||'';
  const term=MAP_SEARCH.trim().toLowerCase();
  const liveW=computeWindow(),liveStats=statsByKey(liveW);

  /* The pop-up follows the header dropdown, so what is on screen is what the
     rest of the page is judging. */
  const forPlatform=DATA.campaigns
    .map((row,i)=>({row:row,i:i,name:row[0],channel:DATA.channels[row[1]],os:String(row[2]||'').toLowerCase()}))
    .filter(r=>PLATFORM==='all'||r.os===PLATFORM);
  populateMapChannels(forPlatform);

  const list=forPlatform
    .filter(r=>FILTERS.mapChannel==='all'||r.channel===FILTERS.mapChannel)
    .filter(r=>!term||(r.name+' '+r.channel).toLowerCase().indexOf(term)>=0)
    .map(r=>{r.key=r.name+'||'+r.channel;r.stat=liveStats[r.key]||null;return r})
    .sort((a,b)=>(b.stat?b.stat.cost:0)-(a.stat?a.stat.cost:0)||a.name.localeCompare(b.name));

  const saved=Object.keys(OVERRIDES).filter(k=>OVERRIDES[k]&&OVERRIDES[k].length).length;
  $('mapSub').textContent=list.length+' campaign'+(list.length===1?'':'s')+' on '+
    (PLAT_LABEL[PLATFORM]||PLATFORM)+' · '+saved+' with settings saved to the workbook'+
    ' · each change carries the date you set it to take effect from';

  if(!list.length){
    $('mapTable').innerHTML='<div class="empty">No campaign matches. Clear the search, or pick another channel.</div>';
    return;
  }

  const goalSel=(v,sheet)=>'<select class="chan-filter sm" data-f="goal">'+
    '<option value="">'+(sheet?'use sheet':'none')+'</option>'+
    GOALS.map(g=>'<option value="'+g+'"'+(v===g?' selected':'')+'>'+g+'</option>').join('')+'</select>';
  const revSel=(v)=>'<select class="chan-filter sm" data-f="revType">'+
    REV_TYPES.map(t=>'<option value="'+t+'"'+(v===t?' selected':'')+'>'+t+'</option>').join('')+'</select>';
  const judgeSel=(v,chan)=>{
    const selected=JUDGE_MODES.indexOf(v)>=0?v:networkJudge(chan);
    const choices=[['both','Both'],['budget','Budget only'],['roas','Target ROAS only']];
    return '<select class="chan-filter sm" data-f="judge">'+
      choices.map(([value,label])=>'<option value="'+value+'"'+
        (selected===value?' selected':'')+'>'+label+'</option>').join('')+'</select>';
  };

  let html='<table><thead><tr>'+
    '<th>#</th><th>Campaign</th><th>Goal window</th><th>Revenue type</th>'+
    '<th>Judge on</th><th>Target ROAS</th><th>Budget</th><th>In force from</th>'+
    '<th>What this means now</th><th>Action</th>'+
    '</tr></thead><tbody>';

  let rowNo=0;
  list.forEach(r=>{
    const base=DATA_BASE(r.i);
    const keys=rowKeysFor(r,base);
    const live=sheetEntry(r.name,r.channel,todayISO());
    keys.forEach((key,n)=>{
      const cur=currentSettings(key,base);
      const dirty=isDirty(key);
      const period=periodStat(key,cur.idx);
      const cls=[dirty?'pending':'',n?'variant':''].filter(Boolean).join(' ');
      html+='<tr data-key="'+esc(key)+'"'+(cls?' class="'+cls+'"':'')+'>'+ 
        '<td class="mp-index">'+String(++rowNo).padStart(2,'0')+'</td>'+ 
        '<td title="'+esc(r.name)+'">'+(n
          ? '<div class="mp-sub">&#8627; '+esc(REV_LABEL[keyParts(key).revType]||'')+' only</div>'
          : '<div class="mp-name">'+esc(r.name)+'</div>'+
            '<div class="mp-sub">'+esc(r.channel)+' &middot; '+esc(r.os||'—')+'</div>')+
        (keys.length>1&&live&&live.key===key?'<div class="mp-sub tealt">the sheet judges on this row</div>':'')+
        '</td>'+
        '<td>'+goalSel(cur.goal,base.goal)+'</td>'+
        '<td>'+revSel(cur.revType)+'</td>'+
        '<td>'+judgeSel(cur.judge,r.channel)+'</td>'+
        '<td><input class="cell-input" data-f="target" type="text" inputmode="decimal" '+
            'placeholder="'+esc(base.targetHint)+'" value="'+esc(cur.target)+'"></td>'+
        '<td><input class="cell-input" data-f="budget" type="text" inputmode="numeric" '+
            'placeholder="none" value="'+esc(cur.budget)+'"></td>'+
        '<td class="mp-since">'+sinceCell(cur,dirty,key)+'</td>'+
        '<td>'+mapStatus(r,cur.live||{from:cur.since},period,today)+'</td>'+
        '<td class="mp-acts">'+
          '<button class="mini apply" data-act="apply"'+(dirty?'':' disabled')+'>Apply</button>'+
        '</td>'+
        '</tr>';
    });
  });
  html+='</tbody></table>';
  const host=$('mapTable'),at=host.scrollTop;
  host.innerHTML=html;
  host.scrollTop=at;                 /* a repaint should not lose your place */
  wireMapTable();
}

/*
 * The date the change TOOK EFFECT, and it is typed in, not assumed.
 *
 * A budget is usually changed in the ad network first and recorded here
 * afterwards - sometimes days afterwards. Stamping the record with today would
 * date the change to the day somebody got round to logging it, and every day in
 * between would then be graded against the cap it was no longer running under.
 * So the date is an input, defaulted to today because that is the common case,
 * and the date currently in force is shown underneath it for reference.
 */
function sinceCell(cur,dirty,key){
  const draft=DRAFTS[key]||{};
  const val=draft.from!==undefined?draft.from:todayISO();
  return '<input class="cell-input" data-f="from" type="date" value="'+esc(val)+'">'+
    (cur.since
      ? '<div class="mp-hint">now: '+esc(dmy(cur.since))+'</div>'
      : '<div class="mp-hint">nothing set yet</div>');
}

function populateMapChannels(forPlatform){
  const sel=$('mapChannel');
  if(!sel)return;
  const chans=[...new Set(forPlatform.map(r=>r.channel).filter(Boolean))].sort();
  if(FILTERS.mapChannel!=='all'&&chans.indexOf(FILTERS.mapChannel)<0)FILTERS.mapChannel='all';
  const html='<option value="all">All channels</option>'+
    chans.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
  if(sel.dataset.sig!==html){sel.innerHTML=html;sel.dataset.sig=html}
  sel.value=FILTERS.mapChannel;
  sel.onchange=()=>{FILTERS.mapChannel=sel.value;renderMapTable()};
}

/** What the sheet itself said for this campaign, so a reset is honest. */
function DATA_BASE(i){
  const b=BASE_MAP?BASE_MAP[i]:['','all',null,false];
  const A=DATA.assumptions;
  const fallback=b[0]==='D0'?A.target_d0:b[0]==='D28'?A.target_d28:b[0]==='D30'?A.target_d30:A.target_d7;
  return{goal:b[0]||'',revType:b[1]||'all',target:b[2],mapped:b[3],
         targetHint:(b[2]!=null&&b[2]!=='')?String(b[2]):'auto '+fallback.toFixed(2)};
}

/**
 * How the campaign did while THIS setting was the one in force. A change made
 * on 23 Aug and replaced on 5 Sep is read on 23 Aug – 4 Sep; the one that
 * replaced it is read from 5 Sep onward.
 */
function mapStatus(r,e,period,today){
  if(e.from&&e.from>today){
    return '<span class="st-line info"><span class="st-span">'+esc(dmy(e.from))+' &rarr; now</span>'+ 
      '<b class="st-head">Recently changed</b> No spend recorded under it yet — the sheet has data to '+esc(dmy(today))+'.</span>';
  }
  if(!period)return '<span class="st-line">No period to read.</span>';
  const c=period.c,span=period.span;
  const label=dmy(span.from)+' → '+(span.open?'now':dmy(span.nextFrom||span.to));
  if(!c){
    return '<span class="st-line"><span class="st-span">'+esc(label)+'</span>'+
      (span.pending?'Nothing spent under these settings yet.':'No spend in this period.')+'</span>';
  }

  const budget=budgetOf(r.key,span.to);
  const over=budget&&c.cost>budget;
  let cls='st-line',head,tail;
  if(c.verdict==='NO GOAL - map it'){
    cls+=' warn';head='No goal set.';
    tail=money0(c.cost)+' spent with nothing judging it.';
  }else if(c.verdict==='INSUFFICIENT DATA'||c.verdict==='PENDING'){
    cls+=' warn';
    head='Too young to judge.';tail=money0(c.cost)+' spent in this period.';
  }else if(c.roas!=null){
    const bad=c.roas<c.target;
    cls+=bad?' bad':' good';
    head=bad?'Losing money.':'Paying back.';
    tail='$'+c.roas.toFixed(2)+' back per $1 by '+c.goal+', needs $'+c.target.toFixed(2)+'.';
  }else{
    head='';tail=money0(c.cost)+' spent in this period.';
  }
  if(budget){
    tail+=' Budget '+money0(c.cost)+' of '+money0(budget)+(over?' — over.':' used.');
    if(over&&cls.indexOf('bad')<0){cls='st-line bad';head=head||'Over budget.'}
  }
  return '<span class="'+cls+'"><span class="st-span">'+esc(label)+'</span>'+
    (head?'<b class="st-head">'+esc(head)+'</b> ':'')+esc(tail)+'</span>';
}

function wireMapTable(){
  const host=$('mapTable');
  host.querySelectorAll('select[data-f],input[data-f]').forEach(el=>{
    const capture=()=>{
      const tr=el.closest('tr');
      noteDraft(tr,el.dataset.f,el.value);
    };
    if(el.tagName==='INPUT')el.oninput=capture;
    else el.onchange=capture;
  });
  host.querySelectorAll('button[data-act]').forEach(btn=>{
    const key=btn.closest('tr').dataset.key,act=btn.dataset.act;
    btn.onclick=()=>{
      if(act==='apply')applyRow(key);
      else if(act==='drop')dropRow(key);
    };
  });
}

/* Typing changes nothing yet. It marks the row, lights up Apply and shows the
   date the change would carry — the table is not repainted, so the field you
   are working in keeps its cursor. */
function noteDraft(tr,field,value){
  const key=tr.dataset.key;
  const draft=DRAFTS[key]||(DRAFTS[key]={});
  draft[field]=value;
  updateMapUnsaved();
  tr.classList.add('pending');
  const btn=tr.querySelector('button[data-act="apply"]');
  if(btn)btn.disabled=false;
  /* The date cell is an input now, so repainting it here would destroy whatever
     the user was in the middle of typing. */
}

/**
 * Stop managing one revenue stream from here. Nothing is forgotten — the log
 * records that the settings were cleared today, and the periods before it stay
 * exactly as they were.
 */
function dropRow(key){
  const p=keyParts(key);
  delete DRAFTS[key];
  (OVERRIDES[key]=OVERRIDES[key]||[]).push({
    from:todayISO(),goal:'',revType:p.revType,target:'',budget:'',action:'cleared'});
  SAVE_QUEUE[key+'|clear']={action:'deleteSetting',
    entry:{campaign:p.campaign,channel:p.channel,revType:p.revType,all:true}};
  scheduleFlush();
}

/**
 * Write the row as it now stands. The first Apply on a revenue type is undated
 * — it stands for everything up to now — and every Apply after it carries
 * today's date, which closes the period before it and opens a new one.
 *
 * The revenue dropdown says which stream the row is being set for, so applying
 * against a different one records a setting for that stream and leaves the
 * first alone: the campaign then has a row per stream.
 */
function applyRow(key){
  const draft=DRAFTS[key];
  if(!draft)return;
  const p=keyParts(key);
  const idx=campIndexOf(p.campaign,p.channel);
  const base=DATA_BASE(idx);
  const revType=(draft.revType!==undefined?draft.revType:p.revType)||'all';
  const dest=setKey(p.campaign,p.channel,revType);

  /* The date the change actually took effect. Typed in, defaulted to today,
     and validated here because a bad one would put the record somewhere nobody
     would ever find it. Backdating is the point: it is how a change made in the
     network last week gets graded against the week it really governed. */
  let from=String(draft.from||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from))from=todayISO();
  const prev=effectiveAt(dest,from);
  const carried=(prev&&prev.action!=='cleared')?prev:null;

  /* Which boxes the user actually edited. This is the difference between
     "leave the target alone" and "clear the target back to auto", and only the
     draft knows it — once the value reaches the sheet both look like a blank. */
  const targetTouched=draft.target!==undefined;
  const budgetTouched=draft.budget!==undefined;
  const judgeTouched=draft.judge!==undefined;

  const val=(field,touched,fallback)=>{
    if(touched)return draft[field];
    if(carried&&carried[field]!==''&&carried[field]!=null)return carried[field];
    return fallback;
  };
  const entry={
    /* Every period is dated, including the first. An undated one would reach
       back over spend that ran long before anybody decided on this budget, and
       judging old money against a new cap is the thing this must not do. */
    from:from,
    goal:val('goal',draft.goal!==undefined,base.goal||''),
    revType:revType,
    target:val('target',targetTouched,''),
    budget:val('budget',budgetTouched,''),
    judge:judgeTouched?draft.judge:((carried&&carried.judge)||''),
    targetTouched:targetTouched,
    budgetTouched:budgetTouched,
    judgeTouched:judgeTouched
  };
  /* Settings_Log never overwrites, so a second Apply on the same day is a
     second record — the earlier one shows as replaced rather than vanishing. */
  (OVERRIDES[dest]=OVERRIDES[dest]||[]).push({
    from:entry.from,goal:entry.goal,revType:entry.revType,
    target:entry.target,budget:entry.budget,judge:normJudge(entry.judge),
    tmode:entry.target===''?'auto':'value',
    bmode:entry.budget===''?'none':'value',
    updated:from,os:osOfKey(dest)||'',action:'set'
  });
  /* Keep SETTINGS in step with OVERRIDES so anything rebuilt from the flat list
     before the save returns sees the new row too. */
  SETTINGS=(SETTINGS||[]).concat([{
    campaign:p.campaign,channel:p.channel,os:osOfKey(dest)||'',
    goal:entry.goal,revType:entry.revType,target:entry.target,budget:entry.budget,
    judge:normJudge(entry.judge),
    tmode:entry.target===''?'auto':'value',bmode:entry.budget===''?'none':'value',
    from:entry.from,updated:from,action:'set'
  }]);
  PERIOD_CACHE.clear();
  delete DRAFTS[key];
  queueSave(dest,entry);
  /* Paint the change now; the sheet's own answer replaces it a beat later. */
  repaintSettings();
  /* Apply is a commit, not a keystroke — there is nothing left to debounce, and
     Settings History must not sit on a stale read while a timer runs down. */
  flushSaves();
}

/* ---------------------- writing back to the workbook ----------------------
   Typing lands in the local copy at once so the window stays responsive, and
   the write follows a beat later. Campaign_Map and Settings_Log are the record;
   the reply carries the sheet's own view back and replaces ours. */
function queueSave(key,entry){
  const p=keyParts(key);
  SAVE_QUEUE[key+'|'+(entry.from||'')]={
    action:'saveSetting',
    entry:{campaign:p.campaign,channel:p.channel,os:osOfKey(key),
           goal:entry.goal||'',revType:entry.revType||p.revType||'all',
           target:entry.target===''?'':entry.target,
           budget:entry.budget===''?'':entry.budget,
           /* Blank means two different things and only the page knows which:
              left alone (carry the running value forward) or emptied on purpose
              (auto target / no cap). */
           targetTouched:!!entry.targetTouched,
           budgetTouched:!!entry.budgetTouched,
           judge:entry.judge||'',judgeTouched:!!entry.judgeTouched,
           from:entry.from||''}
  };
  scheduleFlush();
}
function queueDelete(key,from){
  const p=keyParts(key);
  SAVE_QUEUE[key+'|'+(from||'')+'|del']={
    action:'deleteSetting',
    entry:{campaign:p.campaign,channel:p.channel,revType:p.revType,from:from||''}
  };
  scheduleFlush();
}
function osOfKey(key){
  const p=keyParts(key);
  const row=DATA.campaigns.find(c=>campKeyOf(c)===p.campaign+'||'+p.channel);
  return row?String(row[2]||''):'';
}
function scheduleFlush(){
  repaintSettings();
  if(SAVE_TIMER)clearTimeout(SAVE_TIMER);
  SAVE_TIMER=setTimeout(flushSaves,700);
}
/* The commit arrives on blur, and replacing the table inside that event is what
   makes the browser complain about a node it is still using, so the repaint is
   handed to the next tick. */
function repaintSettings(){
  SPAN_CACHE.clear();
  WINDOW_CACHE.clear();
  setTimeout(()=>{
    if(!DATA)return;
    /* Budgets and targets now decide the watchlist verdicts and the decision
       chart as well as this card, so an Apply has to repaint the whole page.
       Repainting only the history table left Campaigns to act on showing the
       old cap until someone pressed Refresh. */
    render();
    if(!$('mapModal').hidden)renderMapTable();
  },0);
}

/*
 * The write is what makes Settings History real, so nothing here may quietly
 * give up on a job.
 *
 * The old shape emptied SAVE_QUEUE before the first request and only advanced
 * the chain inside the success branch, so one refused or dropped job discarded
 * every job behind it with no retry and no message — which is precisely how the
 * settings window ends up showing a budget the history tab never received.
 *
 * Now a job leaves the queue only once the sheet has confirmed it. Failures go
 * back in, the chain runs to the end regardless, and one retry follows. What
 * finally lands on screen is re-read from the sheet, not assumed.
 */
let FLUSH_RUNNING=false,FLUSH_RETRIED={};
function flushSaves(){
  if(SAVE_TIMER){clearTimeout(SAVE_TIMER);SAVE_TIMER=null}
  if(FLUSH_RUNNING)return;                       /* the running pass will pick these up */
  const keys=Object.keys(SAVE_QUEUE);
  if(!keys.length)return;
  FLUSH_RUNNING=true;
  /* The workbook is about to move, so drop the browser's copy now rather than
     at the end — a reload midway through must not restore a snapshot that
     predates the change. */
  try{localStorage.removeItem('uansm_snapshot')}catch(e){}
  setStatus('Saving to Settings_Log…');

  const failed=[];
  const run=i=>{
    if(i>=keys.length){
      FLUSH_RUNNING=false;
      if(!failed.length){
        FLUSH_RETRIED={};
        confirmSettings();
        return;
      }
      /* One retry, then say so plainly. A silent failure here is worse than a
         visible one, because the page would keep showing the new value. */
      const again=failed.filter(k=>!FLUSH_RETRIED[k]);
      again.forEach(k=>{FLUSH_RETRIED[k]=1});
      if(again.length){
        setStatus('Retrying '+again.length+' unsaved change'+(again.length===1?'':'s')+'…');
        setTimeout(flushSaves,600);
      }else{
        setStatus(failed.length+' change'+(failed.length===1?'':'s')+
          ' could not be written to Settings_Log — reopen Campaign settings and apply again.',true);
      }
      return;
    }
    const k=keys[i],job=SAVE_QUEUE[k];
    if(!job)return run(i+1);
    const fail=msg=>{failed.push(k);setStatus(msg,true);run(i+1)};
    serverCall(job.action,{entry:job.entry})
      .then(txt=>{
        let res;try{res=JSON.parse(txt)}catch(e){res={ok:false,error:'The sheet sent back a reply the page could not read.'}}
        if(!res.ok)return fail(res.error||'The sheet refused that change.');
        /* Confirmed — and only now does it leave the queue. */
        delete SAVE_QUEUE[k];
        SETTINGS=res.settings||SETTINGS;
        indexSettings();
        repaintSettings();
        run(i+1);
      })
      .catch(err=>fail(String(err&&err.message||err)));
  };
  run(0);
}

/*
 * Re-read Settings_Log after a write and paint from that.
 *
 * Everything up to here has been the page's own optimistic copy plus whatever
 * saveSetting echoed back. This one call closes the loop: the history table is
 * showing the sheet's record, not the page's guess about it, so there is no
 * window in which Campaign Settings and Settings History can disagree.
 */
function confirmSettings(){
  serverCall('getSettings',{})
    .then(txt=>{
      let res;try{res=JSON.parse(txt)}catch(e){res=null}
      if(res&&res.ok&&res.settings){
        SETTINGS=res.settings;
        indexSettings();
        repaintSettings();
      }
      setStatus('Saved to Settings_Log · '+new Date().toLocaleTimeString('en-US'));
      /* The snapshot behind the charts moved too, so pull it fresh. Settings
         History is already correct above; this is for the rest of the page. */
      refreshSnapshot();
    })
    .catch(()=>{
      /* The write succeeded, so the local copy is still trustworthy. */
      setStatus('Saved to Settings_Log · '+new Date().toLocaleTimeString('en-US'));
    });
}

/* =============================== WIRING =============================== */

$('mapBtn').onclick=()=>openMap();
$('mapClose').onclick=()=>closeMap();
$('mapDismiss').onclick=()=>dismissMap();
$('mapModal').onclick=ev=>{if(ev.target===$('mapModal'))closeMap()};
document.addEventListener('keydown',ev=>{if(ev.key==='Escape'&&!$('mapModal').hidden)closeMap()});
/* A common workflow is edit Settings in Sheets, then return to this tab. Pull a
   fresh copy on return; the small guard avoids duplicate focus/visibility calls. */
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&DATA&&Date.now()-LAST_SNAPSHOT_SYNC>15000)refreshSnapshot();
});
$('mapSearch').oninput=ev=>{MAP_SEARCH=ev.target.value;renderMapTable()};

/* ===========================================================================
 * Bridge to glance.js
 * ---------------------------------------------------------------------------
 * The glance section and the performance table live in their own module. This
 * is the only surface they are allowed to touch, and it exists so that:
 *
 *   - a reviewer can see, in one place, exactly what the new sections depend
 *     on, without reading 3,900 lines to find out;
 *   - the new sections reuse THIS file's domain functions rather than
 *     reimplementing them. A summary that computes its own verdicts will
 *     eventually disagree with the table under it, which is precisely the
 *     fault the new section exists to fix - the live KPI reads "$0.00 at risk"
 *     above a list of campaigns to cut because two verdict engines answer the
 *     same question differently;
 *   - whoever breaks this file up later knows what is load-bearing from
 *     outside it.
 *
 * Nothing here is new logic. dailySeriesByCampaign is the one addition, and
 * only because the existing dailyCostByCampaign returns cost alone while a
 * cost-and-revenue sparkline needs both.
 * ======================================================================== */

/**
 * Per-campaign daily cost and revenue across the current window, as arrays
 * aligned to a shared day list so a chart can index straight into them.
 *
 * Same walk as dailyCostByCampaign, same platform filter, same SLICE
 * handling - deliberately, so the two cannot drift on which rows count.
 *
 * @return {{days:string[], byKey:Map<string,{cost:number[],rev:number[]}>}}
 */
function dailySeriesByCampaign(){
  const idx=windowIdx(),days=idx.days,byDay=SLICE?SLICE.byDay:ROWS_BY_DAY;
  const campaigns=SLICE?SLICE.campaigns:DATA.campaigns;
  const channels=SLICE?SLICE.channels:DATA.channels;
  const out={days:[],byKey:new Map()};
  if(idx.si<0)return out;

  for(let di=idx.si;di<=idx.ei;di++)out.days.push(days[di]);
  const n=out.days.length;

  for(let di=idx.si;di<=idx.ei;di++){
    const slot=di-idx.si;
    (byDay[di]||[]).forEach(r=>{
      const camp=campaigns[r[0]];if(!camp)return;
      if(PLATFORM!=='all'&&String(camp[2]||'').toLowerCase()!==PLATFORM)return;
      const key=camp[0]+'||'+channels[camp[1]];
      let m=out.byKey.get(key);
      if(!m){m={cost:new Array(n).fill(0),rev:new Array(n).fill(0)};out.byKey.set(key,m)}
      m.cost[slot]+=r[2];
      m.rev[slot]+=r[4]+r[5];      // ad + iap, the same "all revenue" used above
    });
  }
  return out;
}

window.__nsBridge={
  /* live state, read through getters so the module never holds a stale copy */
  get data(){return DATA},
  get platform(){return PLATFORM},
  get dateFilter(){return DATE_FILTER},

  /* window + rows */
  computeWindow:computeWindow,
  overallCampaigns:overallCampaigns,
  filteredCampaigns:filteredCampaigns,
  dailySeriesByCampaign:dailySeriesByCampaign,

  /* domain - reused, never reimplemented */
  paybackOf:paybackOf,
  judgedRows:judgedRows,
  judgeModeAt:judgeModeAt,
  liveBudget:liveBudget,
  settingOn:settingOn,
  isHistoricalRange:isHistoricalRange,

  /* formatting, so the new sections render numbers identically */
  money:money, pctOf:pctOf, esc:esc,
  shortDate:shortDate, dmy:dmy, isoShift:isoShift, todayISO:todayISO,

  /* opens the existing Campaign settings modal, optionally pre-filtered, so a
     tile that says "6 campaigns have no cap" can hand the user straight to
     the place where a cap is set */
  openSettings:function(channel){
    if(channel){FILTERS.mapChannel=channel;MAP_SEARCH=''; }
    const btn=$('mapBtn');
    if(btn)btn.click();
  },

  /* the new sections ask to be redrawn from here, so there is one render
     order rather than two competing ones */
  onRender:null
};

boot();
