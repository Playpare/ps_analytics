/* eslint-disable */
/* --- from weekly_report.html · block 8273e79488 --- */
/* Marks this page as live-data mode. Several blocks below check it to skip
   the built-in mock charts. It deliberately holds no URL and no key -
   the web app URL arrives as ?api= and the token from sessionStorage. */
window.WEEKLY_LIVE_CONFIG = { live: true };

/* --- from weekly_report.html · block e28313ffee --- */
/* ---- API client: URL arrives via ?api= from the hub, token via sessionStorage ---- */
window.__themeRerender = function(){ if (STATE && STATE.data) renderAll(STATE.data); };

/* Available before the first API request starts. The report contains large
   embedded fallback datasets later in the document, so defining this helper
   only after those datasets creates a parser-time race when an early request
   needs to report a retry. */
function setStatus(message,error){
  const e=document.getElementById('weeklyLiveStatus');
  if(e){e.textContent=message;e.classList.toggle('err',!!error);}
}
const API = {
  url: new URLSearchParams(location.search).get('api') || '',
  tokenKey: 'mss3d_token',
  get token(){ return sessionStorage.getItem(API.tokenKey) || ''; },
  async call(action, params, options){
    const quiet=!!(options&&options.quiet);
    if(!API.url) throw new Error('No API URL - open this report from the hub, not on its own.');
    if(!API.token){
      try{window.parent.postMessage({type:'mss3d:need-token'},location.origin)}catch(e){}
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    if(!API.token){
      try{window.parent.postMessage({type:'mss3d:session-expired'},location.origin)}catch(e){}
      throw new Error('Not signed in - open the hub and sign in.');
    }
    /* ── Two clocks, not one ──────────────────────────────────────────────
       TRANSPORT failures (dropped connection, Google's HTML throttling page,
       a redirect that re-entered the GET endpoint) are momentary. Retry
       twice, quickly.

       QUEUED answers are not failures at all. The backend NEVER builds inside
       a user request: a cold window is handed to a one-shot trigger and the
       request returns immediately with BUILDING: (build just scheduled) or
       BUSY: (another execution is already building it). A cold buildPayload_
       across 14 tabs takes roughly 40-60s.

       The old schedule - two attempts, 1.5s then 3s, and a pattern that only
       recognised BUSY: - therefore gave up about a minute too early and
       painted the raw "BUILDING: Weekly data is being prepared" string into
       the red error box. That is exactly why clicking a different filter a
       moment later "worked": the trigger had finished in the meantime and the
       second click was a plain cache read.

       Queued answers now get their own budget, ~85s, which covers a cold
       build with room to spare. */
    const TRANSPORT_RETRIES=2;
    const QUEUE_POLLS=8;
    const QUEUE_WAIT_MS=[4000,6000,8000,10000,12000,15000,15000,15000];
    const isQueuedText=t=>/^(BUILDING|BUSY):/.test(String(t||''));
    let lastError,transportTries=0,queuedPolls=0;
    for(;;){
      const controller=new AbortController();
      /* A cold Weekly Apps Script execution can exceed one minute. Aborting
         it at 60s leaves that server execution running and immediately starts
         a duplicate retry, increasing contention instead of helping. */
      const timer=setTimeout(()=>controller.abort(),300000);
      try{
        const res = await fetch(API.url, {
          method: 'POST',
          /* text/plain on purpose: application/json triggers a CORS preflight
             that Apps Script web apps cannot answer. */
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ action: action, token: API.token }, params || {})),
          redirect: 'follow',
          signal: controller.signal
        });
        clearTimeout(timer);
        const body=(await res.text()).trim();
        if(!res.ok){
          const err=new Error('HTTP ' + res.status + ' from Apps Script');
          err.retryable=res.status===404||res.status===429||res.status>=500;
          throw err;
        }
        /* Google intermittently answers a perfectly valid request with an HTML
           page (a throttling interstitial) after 20-40 seconds. Measured on
           this deployment, it hits even a no-op ping, so it is transient
           infrastructure behaviour rather than a misconfiguration - retry it
           instead of failing outright. If it still returns HTML on the last
           attempt, the deployment really is wrong and the message says so. */
        if(body.charAt(0)==='<'){
          const more=transportTries<TRANSPORT_RETRIES;
          const err=new Error(more
            ?'Apps Script returned an HTML page instead of data - retrying.'
            :'Apps Script returned a Google sign-in page instead of data. Redeploy it with "Execute as: Me" and "Who has access: Anyone".');
          err.retryable=more;
          throw err;
        }
        let data;
        try{data=JSON.parse(body);}catch(e){
          const err=new Error('Apps Script returned an invalid JSON response');
          err.retryable=false;
          throw err;
        }
        /* A bare {error:'Unauthorized'} with no code is Apps Script's legacy
           key-gated doGet answering a redirect-downgraded POST - a transient
           routing quirk, NOT a session problem. Retry it; never sign out. */
        if(data.code===undefined&&String(data.error||'')==='Unauthorized'){
          const err=new Error('Apps Script routed the request to its GET endpoint - retrying.');
          err.retryable=true;
          throw err;
        }
        if(data.code === 401||/^Unauthorized:/i.test(String(data.error||''))){
          const more=transportTries<TRANSPORT_RETRIES;
          if(more){
            try{window.parent.postMessage({type:'mss3d:need-token'},location.origin)}catch(e){}
          }else{
            try{window.parent.postMessage({type:'mss3d:session-expired'},location.origin)}catch(e){}
          }
          const err=new Error(more?'Authentication rejected - refreshing token and retrying.':'Session expired - reload the hub and sign in again.');
          err.retryable=more;
          err.authFailure=true;
          throw err;
        }
        if(!data.ok){
          const err=new Error(data.error || 'Request failed');
          /* BUILDING: the backend has just scheduled a trigger to build this
             window. BUSY: another execution is already building it. Neither
             is a failure - both mean "come back shortly", and both are
             answered on the queue budget rather than the transport one. */
          err.queued=isQueuedText(data.error);
          err.retryable=err.queued||data.code>=500;
          throw err;
        }
        return data;
      }catch(e){
        clearTimeout(timer);
        lastError=e;

        /* Queued: poll on the long budget and do NOT flag the status line as
           an error. The backend is working; saying so in red is a lie. */
        if(e&&e.queued){
          if(queuedPolls>=QUEUE_POLLS)throw e;
          const wait=QUEUE_WAIT_MS[Math.min(queuedPolls,QUEUE_WAIT_MS.length-1)];
          queuedPolls++;
          if(!quiet)setStatus(`Preparing weekly data — this finishes by itself (checking again in ${Math.round(wait/1000)}s)…`,false);
          await new Promise(resolve=>setTimeout(resolve,wait));
          continue;
        }

        const retryable=e?.retryable===true||e?.name==='AbortError'||e instanceof TypeError;
        if(!retryable||transportTries>=TRANSPORT_RETRIES)throw e;
        transportTries++;
        if(!quiet)setStatus(e?.authFailure?`Weekly authentication rejected — retrying automatically (${transportTries}/${TRANSPORT_RETRIES})…`
          :`Weekly request interrupted — retrying automatically (${transportTries}/${TRANSPORT_RETRIES})…`,true);
        await new Promise(resolve=>setTimeout(resolve,Math.min(10000,1500*Math.pow(2,transportTries-1))));
      }
    }
    throw lastError||new Error('Weekly request failed');
  }
};
/* Removed: two hardcoded datasets (AD, AD2) and the chart code that drew
   them — ~22 KB of April–July readings baked into the page.

   They were the static rendering this report used before it read live
   data. Both IIFEs opened with `if(window.WEEKLY_LIVE_CONFIG)return;` and
   that flag is set unconditionally at the top of this file, so neither had
   drawn anything in a long time — but every visitor still downloaded and
   parsed the numbers. The live binding further down owns these charts. */

/* --- from weekly_report.html · block 01864ca974 --- */
function showTab(t){document.getElementById('tab-report').classList.toggle('hidden',t!=='report');document.getElementById('tab-analytics').classList.toggle('hidden',t!=='analytics');document.getElementById('btn-report').classList.toggle('active',t==='report');document.getElementById('btn-analytics').classList.toggle('active',t==='analytics');window.scrollTo(0,0);}

/* --- from weekly_report.html · block e57903d84b --- */
/* ============================================================
   LIVE DATA BINDING
   The recovered visual report above remains intact. This layer replaces
   every supported static display value with the consolidated live endpoint
   payload and masks unsupported source metrics instead of showing stale data.
   ============================================================ */
(function(){
'use strict';

const STATE={data:null,charts:{},cohortChoice:{},loading:false,asOf:null,rendered:new Set(),fromCache:false};
/* Weeks run Monday to Sunday. weekEndSunday() returns the Sunday closing the
   most recent COMPLETE week on or before d, so "last 2 weeks" is a whole
   Mon-Sun pair (22 Jun - 5 Jul), never a rolling 14 days ending mid-week. */
function weekEndSunday(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function weekWindow(weeks, anchor){
  const sun = weekEndSunday(anchor);
  const mon = new Date(sun); mon.setDate(mon.getDate() - (weeks * 7 - 1));
  return {
    start: new Date(mon.getFullYear(), mon.getMonth(), mon.getDate()).getTime(),
    end:   new Date(sun.getFullYear(), sun.getMonth(), sun.getDate(), 23, 59, 59, 999).getTime()
  };
}
/* A Mon-Sun week has not closed until its Sunday has finished, so no anchor may
   reach today. Without this, viewing on a Sunday makes weekEndSunday() return
   that same Sunday (getDay() is 0, so it subtracts nothing), the window jumps a
   week forward, and the newest slot is a week still being written. */
function lastClosedInstant(){
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - 1;
}
function weekAnchor(){
  return new Date(lastClosedInstant());
}
const isoDay=ms=>{const d=new Date(ms);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};

const COLORS=['#ff8a3d','#ffb800','#ff5c8a','#c77dff','#7b6cff','#06d6a0','#4d9fff','#00e5c3','#f472b6','#00c47a','#ffd166','#ef476f','#118ab2','#83c5be','#e29578','#a78bfa','#5af0dc','#7ab5fb','#f4a261','#e76f51','#2a9d8f','#ff6b6b','#4ecdc4','#c44dff','#ffe66d'];
const FORMAT={Rewarded:{field:'rewarded',ecpm:'ecpm_r',avr:'avr_r',imp:'impdau_r',color:'#a78bfa'},Interstitial:{field:'interstitial',ecpm:'ecpm_i',avr:'avr_i',imp:'impdau_i',color:'#f472b6'},Banner:{field:'banner',ecpm:'ecpm_b',avr:'avr_b',imp:'impdau_b',color:'#ffb800'}};

const clean=s=>(s||'').replace(/\s+/g,' ').trim();
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const num=(v,d=0)=>finite(v)?v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'N/A';
const money=(v,d=0)=>finite(v)?'$'+v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'N/A';
const pct=(v,d=1,ratio=true)=>finite(v)?num(ratio?v*100:v,d)+'%':'N/A';
const shortDate=s=>{if(!s)return 'N/A';const d=new Date(s+'T00:00:00');return Number.isNaN(d.getTime())?s:d.toLocaleDateString('en-US',{month:'short',day:'2-digit'});};
/* Pinned to en-US 12-hour rather than left to toLocaleTimeString()'s default,
   which follows the browser locale and prints 23:52:41 on a 24-hour machine.
   The three reports state the load time identically. */
const clockTime=d=>new Date(d).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});
const longRange=(a,b)=>a&&b?shortDate(a)+' - '+shortDate(b)+', '+String(b).slice(0,4):'N/A';
const change=(cur,prev)=>finite(cur)&&finite(prev)&&prev!==0?(cur-prev)/Math.abs(prev):null;
const deltaText=(cur,prev,suffix='')=>{const d=change(cur,prev);if(!finite(d))return 'Previous comparison unavailable';return (d>=0?'+':'-')+num(Math.abs(d)*100,1)+'%'+suffix;};
const deltaHTML=(cur,prev,formatter)=>{const d=change(cur,prev);if(!finite(d))return '<span style="color:var(--t3)">Previous comparison unavailable</span>';return '<span class="'+(d>=0?'up':'down')+'">'+(d>=0?'+':'-')+num(Math.abs(d)*100,1)+'% WoW</span> <span style="color:var(--t3);font-family:\'DM Mono\'">vs '+formatter(prev)+' previous</span>';};
const sum=o=>Object.values(o||{}).reduce((a,v)=>a+(finite(v)?v:0),0);

function slide(title){return [...document.querySelectorAll('.slide')].find(s=>clean(s.querySelector('.h1')?.textContent).includes(title));}
function kpiBox(s,label){return s&&[...s.querySelectorAll('.kpi')].find(k=>clean(k.querySelector('.l')?.textContent).toLowerCase().startsWith(label.toLowerCase()));}
function setKpi(s,label,value,cur,prev,formatter,note){
  const k=kpiBox(s,label);if(!k)return;
  const v=k.querySelector('.v');if(v)v.textContent=value;
  const ds=[...k.querySelectorAll('.d')];
  if(ds.length){ds[0].innerHTML=note!==undefined?note:deltaHTML(cur,prev,formatter||num);for(let i=1;i<ds.length;i++)ds[i].textContent='';}
}
/* .status is hidden in the header bar, so the covered range gets its own
   element beside the picker rather than riding along in the status text. */
function setRangeSpan(start,end){const e=document.getElementById('weeklyRangeSpan');if(!e)return;e.textContent=(start&&end)?shortDate(start)+' – '+shortDate(end):'';}
function destroyChart(id){const c=document.getElementById(id);if(!c)return;const old=(window.Chart&&Chart.getChart)?Chart.getChart(c):null;if(old)old.destroy();delete STATE.charts[id];const box=c.parentElement;box?.querySelectorAll('.live-no-chart').forEach(x=>x.remove());}
function noChart(id,message){destroyChart(id);const c=document.getElementById(id);if(!c)return;const box=c.parentElement;box.style.position='relative';const n=document.createElement('div');n.className='live-no-chart';n.textContent=message;box.appendChild(n);}
function trimTrend(data){
  const tr=data&&data.trend; if(!tr||!Array.isArray(tr.labels)||!tr.labels.length)return;
  const N=tr.labels.length, core=[];
  ['iOS','Android'].forEach(pf=>{
    const t=tr[pf]; if(!t)return;
    ['Rewarded','Interstitial','Banner'].forEach(at=>{
      ['ecpm','avr','impdau'].forEach(m=>{ if(t[m]&&t[m][at])core.push(t[m][at]); });
      if(t.cohort&&t.cohort[at]) ['d0','d7','d27'].forEach(k=>{ if(t.cohort[at][k])core.push(t.cohort[at][k]); });
    });
    if(t.analytics) ['dau','installs','sessions','d1','d7'].forEach(k=>{ if(t.analytics[k])core.push(t.analytics[k]); });
    if(t.iap) ['arppu','prate'].forEach(k=>{ if(t.iap[k])core.push(t.iap[k]); });
  });
  const has=i=>core.some(sr=>sr&&sr[i]!=null&&isFinite(sr[i]));
  let first=-1,last=-1; for(let i=0;i<N;i++){ if(has(i)){ if(first<0)first=i; last=i; } }
  if(first<0||(first===0&&last===N-1))return;
  const cut=a=>Array.isArray(a)&&a.length===N?a.slice(first,last+1):a;
  const cutObj=o=>{ if(o&&typeof o==='object')Object.keys(o).forEach(k=>{ o[k]=cut(o[k]); }); };
  tr.labels=cut(tr.labels);
  ['iOS','Android'].forEach(pf=>{
    const t=tr[pf]; if(!t)return;
    ['ecpm','avr','impdau'].forEach(m=>cutObj(t[m]));
    if(t.cohort)Object.keys(t.cohort).forEach(at=>{ const c=t.cohort[at]; if(c){ c.labels=cut(c.labels); ['d0','d7','d27'].forEach(k=>{c[k]=cut(c[k]);}); } });
    if(t.iap){ t.iap.labels=cut(t.iap.labels); ['arppu','prate'].forEach(k=>{t.iap[k]=cut(t.iap[k]);}); }
    if(t.analytics){ t.analytics.labels=cut(t.analytics.labels); ['dau','installs','sessions','d1','d7','playtimeD0','playtimeAvg','sessionLengthD0'].forEach(k=>{t.analytics[k]=cut(t.analytics[k]);}); }
    if(t.ftue){ t.ftue.labels=cut(t.ftue.labels); t.ftue.ftue=cut(t.ftue.ftue); }
  });
}
// copy_weekly2 method: exact net proceeds when available; otherwise estimate
// net as 65% of gross for date ranges without a weekly Breakdown anchor.
function iapRevenue(w,data){
  if(!w)return 0;
  if(finite(w.iap_net)&&w.iap_net>0)return w.iap_net;
  if(finite(w.iap_gross)&&w.iap_gross>0)return w.iap_gross*.65;
  if(finite(w.arppu)&&finite(w.payers)&&w.arppu>0&&w.payers>0){
    const m=data&&data.meta||{}; const days=Math.max(1,Math.round((new Date(m.curEnd+'T00:00:00')-new Date(m.curStart+'T00:00:00'))/864e5)+1);
    return w.arppu*w.payers*days*.65;
  }
  return 0;
}
function hideCardByHeading(s,heading){
  const h=[...(s?.querySelectorAll('h2')||[])].find(x=>clean(x.textContent).includes(heading));
  const card=h?.closest('.card'); if(card)card.style.display='none';
}
function maskCardByHeading(s,heading,message){
  const h=[...(s?.querySelectorAll('h2')||[])].find(x=>clean(x.textContent).includes(heading));const card=h?.closest('.card');if(!card)return;
  card.style.position='relative';card.querySelectorAll('.live-cover').forEach(x=>x.remove());const cover=document.createElement('div');cover.className='live-cover';cover.textContent=message;card.appendChild(cover);
}
function chartLabels(labels){return (labels||[]).map(shortDate);}
Chart.defaults.font.family='Poppins';Chart.defaults.font.size=11;Chart.defaults.font.weight='400';Chart.defaults.color='#c0ccdf';
Chart.defaults.plugins.legend.labels.font={family:'Poppins',size:12.5,weight:'400'};
function commonOptions(yFormatter,stacked){return {responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,labels:{color:'#a6b8d4',boxWidth:10,font:{family:'Poppins',size:12.5,weight:'400'}}},tooltip:{callbacks:{title:items=>{const v=items&&items[0]?items[0].label:'';return /^\d{4}-\d{2}-\d{2}/.test(v)?shortDate(v):v;},label:c=>' '+c.dataset.label+': '+yFormatter(c.parsed.y)}}},scales:{x:{stacked:!!stacked,grid:{display:false},ticks:{color:'#a6b8d4',font:{family:'Poppins',size:11,weight:'400'},maxRotation:0,autoSkip:false,callback:function(value){const label=this.getLabelForValue(value);if(!/^\d{4}-\d{2}-\d{2}/.test(label))return label;const d=new Date(label.slice(0,10)+'T00:00:00');return !isNaN(d)&&d.getDay()===1?shortDate(label):'';}}},y:{stacked:!!stacked,beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{color:'#a6b8d4',font:{family:'Poppins',size:11,weight:'400'},callback:yFormatter,maxTicksLimit:5}}}};}
function fitLineWindow(labels,series){
  labels=Array.isArray(labels)?labels:[];
  const actual=(series||[]).filter(s=>!s.dash&&Array.isArray(s.data));
  let first=-1,last=-1;
  for(let i=0;i<labels.length;i++){
    if(actual.some(s=>finite(s.data[i]))){if(first<0)first=i;last=i;}
  }
  if(first<0||(first===0&&last===labels.length-1))return {labels,series};
  return {
    labels:labels.slice(first,last+1),
    series:(series||[]).map(s=>Object.assign({},s,{data:Array.isArray(s.data)?s.data.slice(first,last+1):s.data}))
  };
}
function linearTrend(values){
  const source=Array.isArray(values)?values:[],points=source.map((value,index)=>({value,index})).filter(point=>finite(point.value));
  if(points.length<2)return source.map(()=>null);
  const n=points.length,sx=points.reduce((sum,p)=>sum+p.index,0),sy=points.reduce((sum,p)=>sum+p.value,0),sxy=points.reduce((sum,p)=>sum+p.index*p.value,0),sxx=points.reduce((sum,p)=>sum+p.index*p.index,0),den=n*sxx-sx*sx,slope=den?(n*sxy-sx*sy)/den:0,intercept=(sy-slope*sx)/n,first=points[0].index,last=points[points.length-1].index;
  return source.map((value,index)=>index>=first&&index<=last?slope*index+intercept:null);
}
const liveEndLabels={
  id:'liveEndLabels',
  afterDatasetsDraw(chart,args,options){
    const {ctx,chartArea}=chart,formatter=options?.formatter||String;
    const labels=[];
    ctx.save();ctx.font='400 12.5px Poppins,system-ui,sans-serif';
    chart.data.datasets.forEach((dataset,datasetIndex)=>{
      const meta=chart.getDatasetMeta(datasetIndex);if(meta.hidden)return;
      let last=-1;for(let i=(dataset.data||[]).length-1;i>=0;i--){if(finite(dataset.data[i])){last=i;break;}}
      const point=last>=0?meta.data[last]:null;if(!point)return;
      const text=formatter(dataset.data[last]);
      labels.push({text,x:Math.min(point.x+7,chartArea.right+7),naturalY:point.y,y:point.y,color:dataset.borderColor||'#edf2ff',width:ctx.measureText(text).width});
    });
    labels.sort((a,b)=>a.y-b.y);
    const gap=15,top=chartArea.top+7,bottom=chartArea.bottom-7;
    labels.forEach((label,index)=>{label.y=Math.max(label.y,index?labels[index-1].y+gap:top);});
    if(labels.length&&labels[labels.length-1].y>bottom){
      labels[labels.length-1].y=bottom;
      for(let i=labels.length-2;i>=0;i--)labels[i].y=Math.min(labels[i].y,labels[i+1].y-gap);
      if(labels[0].y<top){
        const shift=top-labels[0].y;labels.forEach(label=>{label.y+=shift;});
      }
    }
    labels.forEach(label=>{
      const bx=label.x-3,by=label.y-7,bw=label.width+6,bh=14;
      ctx.fillStyle='rgba(5,7,11,.88)';ctx.beginPath();ctx.roundRect(bx,by,bw,bh,3);ctx.fill();
      if(Math.abs(label.y-label.naturalY)>2){ctx.strokeStyle=label.color;ctx.globalAlpha=.55;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(label.x-5,label.naturalY);ctx.lineTo(label.x-1,label.y);ctx.stroke();ctx.globalAlpha=1;}
      ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle=label.color;ctx.fillText(label.text,label.x,label.y);
    });
    ctx.restore();
  }
};
const livePiePercentLabels={
  id:'livePiePercentLabels',
  afterDatasetsDraw(chart,args,pluginOpts){
    const ink=(pluginOpts&&pluginOpts.color)||'#000';
    const {ctx}=chart,dataset=chart.data.datasets[0],values=dataset?.data||[],total=values.reduce((sum,value)=>sum+(finite(value)?value:0),0);
    if(total<=0)return;
    const meta=chart.getDatasetMeta(0);
    meta.data.forEach((arc,index)=>{
      const value=values[index],percent=finite(value)?value/total*100:0,arcLength=(arc.endAngle-arc.startAngle)*arc.outerRadius,thickness=arc.outerRadius-arc.innerRadius;
      const text=num(percent,1)+'%';
      ctx.save();ctx.font='500 14px Poppins,system-ui,sans-serif';const width=ctx.measureText(text).width;
      if(percent<3||arcLength<width+10||thickness<18){ctx.restore();return;}
      const angle=(arc.startAngle+arc.endAngle)/2,radius=(arc.innerRadius+arc.outerRadius)/2,point={x:arc.x+Math.cos(angle)*radius,y:arc.y+Math.sin(angle)*radius};
      ctx.textAlign='center';ctx.textBaseline='middle';
      /* Drawn straight on the slice - no pill behind it, which read as a smudge.
         Colour is per chart: black on the bright palettes, white on the darker
         translucent ring used by the platform split. */
      ctx.fillStyle=ink;ctx.fillText(text,point.x,point.y);ctx.restore();
    });
  }
};
function lineChart(id,labels,series,yFormatter){
  destroyChart(id);const el=document.getElementById(id);if(!el)return;
  const fitted=fitLineWindow(labels,series);labels=fitted.labels;series=fitted.series;
  const datasets=series.filter(s=>Array.isArray(s.data)).map((s,i)=>({label:s.label,data:s.data.map(v=>finite(v)?v:null),borderColor:s.color||COLORS[i%COLORS.length],backgroundColor:(s.color||COLORS[i%COLORS.length])+'20',borderWidth:s.dash?1.4:1.8,borderDash:s.dash?[6,4]:[],pointRadius:labels.length<=2?3:0,pointHoverRadius:3,tension:.28,spanGaps:true,fill:!!s.fill}));
  const formatter=yFormatter||num,options=commonOptions(formatter,false);options.layout={padding:{right:82}};options.plugins.liveEndLabels={formatter};
  STATE.charts[id]=new Chart(el,{type:'line',data:{labels,datasets},options,plugins:[liveEndLabels]});
}
function doughnut(id,labels,values,colors,labelColor){
  destroyChart(id);const el=document.getElementById(id);if(!el)return;const valid=values.map(v=>finite(v)&&v>0?v:0);if(!valid.some(Boolean)){noChart(id,'No live data returned for this chart');return;}
  STATE.charts[id]=new Chart(el,{type:'doughnut',data:{labels,datasets:[{data:valid,backgroundColor:colors,borderColor:'#0b0c0f',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,animation:false,cutout:'66%',plugins:{legend:{display:false},livePiePercentLabels:{color:labelColor||'#000'},tooltip:{callbacks:{label:c=>' '+c.label+': '+money(c.raw,0)}}}},plugins:[livePiePercentLabels]});
}
function barChart(id,labels,series){
  destroyChart(id);const el=document.getElementById(id);if(!el)return;
  const options=commonOptions(v=>money(v,0),true);
  // Keep the visual stack blue on the bottom and green on top, while the
  // hover popup reads naturally from the top segment down.
  options.plugins.tooltip.itemSort=(a,b)=>b.datasetIndex-a.datasetIndex;
  STATE.charts[id]=new Chart(el,{type:'bar',data:{labels,datasets:series.map((s,i)=>({label:s.label,data:s.data,backgroundColor:s.color||COLORS[i],borderRadius:4}))},options});
}
function rowHtml(label,actual,us,bench,prev,formatter){
  const f=formatter||num,b=finite(bench),d1=b?change(actual,bench):null,d2=change(actual,prev);
  const metricRanks=[...new Set([actual,us,bench,prev].filter(finite).map(v=>Math.abs(v)))].sort((a,b)=>a-b);
  const metricRank=value=>{const v=Math.abs(value),i=metricRanks.indexOf(v);return metricRanks.length>1?i/(metricRanks.length-1):1};
  const cmpRanks=[...new Set([d1,d2].filter(finite).map(v=>Math.abs(v)))].sort((a,b)=>a-b);
  const cmpRank=value=>{const v=Math.abs(value),i=cmpRanks.indexOf(v);return cmpRanks.length>1?i/(cmpRanks.length-1):1};
  const metricRgb=/ecpm/i.test(label)?'236,10,155':/viewer/i.test(label)?'77,159,255':/imp\/dau/i.test(label)?'139,92,246':/d0/i.test(label)?'255,184,0':/d7/i.test(label)?'167,139,250':/d27/i.test(label)?'34,211,238':/^dau$/i.test(label)?'249,115,22':/arpdau/i.test(label)?'59,130,246':'139,92,246';
  const heat=value=>finite(value)?'background:rgba('+metricRgb+','+(0.36-0.20*metricRank(value)).toFixed(3)+')':'';
  const cmpCell=v=>{if(!finite(v))return '<td class="num" style="color:var(--t3)">no comp</td>';const up=v>=0,rgb=up?'77,159,255':'255,77,109',alpha=(0.36-0.20*cmpRank(v)).toFixed(3);return '<td class="num" style="color:'+(up?'var(--blue)':'var(--coral)')+';background:rgba('+rgb+','+alpha+')">'+(up?'+':'-')+num(Math.abs(v)*100,0)+'%</td>';};
  return '<tr><td class="fmt-name">'+label+'</td><td class="num b" style="'+heat(actual)+'">'+f(actual)+'</td><td class="num" style="color:var(--t2);'+heat(us)+'">'+(finite(us)?f(us):'\u2014')+'</td><td class="num mut" style="'+heat(bench)+'">'+(b?f(bench):'--')+'</td>'+cmpCell(d1)+'<td class="num mut" style="'+heat(prev)+'">'+f(prev)+'</td>'+cmpCell(d2)+'</tr>';
}
// Inserts a "US" <th> right after the current-week "Actual" column (once).
// Robust to the leading "#" column that numberTables() adds on later renders.
function ensureUsHeader_(s){
  const tr=s&&s.querySelector('table.airy thead tr');if(!tr)return;
  if([...tr.children].some(th=>clean(th.textContent)==='US'))return;
  const th=document.createElement('th');th.className='num';th.textContent='US';
  const cells=[...tr.children];
  let anchor=cells.find(c=>/actual/i.test(clean(c.textContent)))||cells[cells.length>1?1:0];
  anchor.insertAdjacentElement('afterend',th);
}
function benchValue(data,platform,format,metric){
  const m=data?.benchmark?.[platform]?.[format]?.[metric];
  return m?.overall?.global??m?.overall?.us??m?.industry?.global??m?.industry?.us??m?.target?.global??m?.target?.us??null;
}
function selfValue(data,platform,format,metric){const m=data?.selfBenchmark?.[platform]?.[format];return m&&finite(m[metric])?m[metric]:null;}

function installControls(){
  if(document.getElementById('weeklyLiveControls'))return;
  const controlsHost=document.getElementById('weeklyDateHost');const box=document.createElement('div');box.id='weeklyLiveControls';box.className='date-controls';
  // Date filter: previous week-based options + logic, styled as ua_report.html's
  // gradient-pill control, placed in the persistent report navigation so it is visible in every view.
  box.innerHTML=
    '<span id="weeklyRangeSpan" class="date-span" title="Dates covered by the current filter"></span>'+
    '<select id="weeklyMode" class="date">'+
      '<option value="w2">Last 2 weeks</option>'+
      '<option value="w4">Last 4 weeks</option>'+
      '<option value="w6">Last 6 weeks</option>'+
      '<option value="w8">Last 8 weeks</option>'+
      '<option value="w10">Last 10 weeks</option>'+ 
      '<option value="single">Single date</option>'+
      '<option value="range">Custom range</option>'+
    '</select>'+
    '<input id="weeklyDate" class="single-date" type="date">'+
    '<input id="weeklyStart" class="range-date range-start" type="date" title="From date">'+
    '<input id="weeklyEnd" class="range-date range-end" type="date" title="To date">'+
    '<button id="weeklyLoad" type="button" class="date-confirm">Apply</button>';
  controlsHost.appendChild(box);
  document.querySelectorAll('.sf > :first-child').forEach(label=>{
    label.textContent=label.textContent.replace(/^Slide\s+\S+\s*·\s*/i,'');
  });
  // Benchmark comparison cells must never fall back to the HTML snapshot.
  // They are populated only after the live Benchmark payload is received.
  document.querySelectorAll('table.airy').forEach(table=>{
    const headings=[...table.querySelectorAll('thead th')].map(th=>clean(th.textContent));
    if(headings.includes('Comp. Bench')&&headings.includes('vs Bench')){
      const body=table.querySelector('tbody');if(body)body.innerHTML='';
    }
  });
  const g=id=>document.getElementById(id);
  /* The dashboard ALWAYS opens on Last 2 weeks: it is the smallest window,
     so the first paint is the fastest possible, and the wider presets are
     warmed in the background right after. Restoring the previously saved
     mode here used to make the first load as slow as the heaviest filter
     the user had ever picked. Saved dates are still restored for the
     single/range inputs so switching to them keeps the old values. */
  g('weeklyMode').value='w2';
  g('weeklyDate').value=localStorage.getItem('weekly_date')||'';
  g('weeklyStart').value=localStorage.getItem('weekly_start')||'';
  g('weeklyEnd').value=localStorage.getItem('weekly_end')||'';
  function syncMode(){
    const m=g('weeklyMode').value;
    box.classList.toggle('single',m==='single');
    box.classList.toggle('custom',m==='range');
  }
  g('weeklyMode').addEventListener('change',()=>{syncMode();const m=g('weeklyMode').value;if(m!=='single'&&m!=='range')loadLive(false);});
  g('weeklyLoad').addEventListener('click',()=>loadLive(false));
  /* Refresh is the deliberate "the sheets moved, go and look again" action, so
     it drops every remembered range rather than just the one on screen - a
     stale preset served instantly is worse than a slow accurate one. */
  /* Refresh must be a real refresh: clear the stored copies as well as the
     in-memory ones, or the reload after it would restore what was just
     discarded. force=1 then makes the backend rebuild too. */
  g('weeklyRefresh').addEventListener('click',()=>{weeklyRefresh();});
  syncMode();
}

function renderDates(data){
  const m=data.meta||{},week=longRange(m.curStart,m.curEnd),compare=longRange(m.prevStart,m.prevEnd)+' vs '+longRange(m.curStart,m.curEnd);
  const tl=data.trend?.labels||[],trend=tl.length?longRange(tl[0],tl[tl.length-1])+' | '+tl.length+' Days':'Trend unavailable';
  document.querySelectorAll('.slide').forEach(s=>{
    const title=clean(s.querySelector('.h1')?.textContent),date=s.querySelector('.date');if(!date)return;
    if(title.includes('Trends')||title.includes('ARPPU & Purchase Rate')||title.includes('Player Analytics'))date.textContent=trend;
    else if(title.includes('Full Products')||title.includes('Network Revenue'))date.textContent=compare;
    else date.textContent=week;
  });
  document.querySelectorAll('.h1,.l,h2,th').forEach(el=>{[...el.childNodes].filter(n=>n.nodeType===3).forEach(n=>{n.nodeValue=n.nodeValue.replace(/W4/g,'Current').replace(/W3/g,'Previous').replace(/\d+-Day/g,(m.trendDays||90)+'-Day').replace(/\d+d\b/g,(m.trendDays||90)+'d');});});
  const overview=slide('Total Monetization Overview'),trendHeading=overview?.querySelector('h2');
  if(trendHeading)trendHeading.textContent='Combined Revenue by Week | Monday-Sunday totals inside the selected range';
}

function renderOverview(data){
  const s=slide('Total Monetization Overview'),iw=data.iOS.W_current,ip=data.iOS.W_prev,aw=data.Android.W_current,ap=data.Android.W_prev;
  const iIap=iapRevenue(iw,data),ipIap=iapRevenue(ip,data),aIap=iapRevenue(aw,data),apIap=iapRevenue(ap,data);
  const iTot=(iw.totad||0)+iIap,ipTot=(ip.totad||0)+ipIap,aTot=(aw.totad||0)+aIap,apTot=(ap.totad||0)+apIap;
  const combined=iTot+aTot,combinedPrev=ipTot+apTot;
  setKpi(s,'Combined Revenue',money(combined),combined,combinedPrev,money);
  setKpi(s,'iOS Revenue',money(iTot),iTot,ipTot,money);
  setKpi(s,'Android Revenue',money(aTot),aTot,apTot,money);
  setKpi(s,'Revenue Streams','Ad + IAP',null,null,null,'Live totals from all available ad and IAP sources');
  const weekly=data.weeklySeries||[];
  const barLabels=weekly.map(x=>shortDate(x.meta.curStart)+'-'+shortDate(x.meta.curEnd));
  const weeklyAd=weekly.map(x=>(x.iOS.W_current.totad||0)+(x.Android.W_current.totad||0));
  const weeklyIap=weekly.map(x=>iapRevenue(x.iOS.W_current,x)+iapRevenue(x.Android.W_current,x));
  barChart('trendChart',barLabels.length?barLabels:[shortDate(data.meta.curStart)+'-'+shortDate(data.meta.curEnd)],[{label:'Ad Revenue',data:barLabels.length?weeklyAd:[(iw.totad||0)+(aw.totad||0)],color:'#4d9fff'},{label:'IAP Net',data:barLabels.length?weeklyIap:[iIap+aIap],color:'#00e5c3'}]);
  /* White on this pair: the ring uses a dark platform colour and a translucent
     tint of it, neither of which black reads against. */
  doughnut('iosSplit',['Ad Revenue','IAP'],[iw.totad,iIap],['#4d9fff','rgba(77,159,255,.42)'],'#fff');
  doughnut('andSplit',['Ad Revenue','IAP'],[aw.totad,aIap],['#00ad99','rgba(0,126,111,.72)'],'#fff');
  const vals=[iw.totad/(iTot||1),iIap/(iTot||1),aw.totad/(aTot||1),aIap/(aTot||1)];
  [...s.querySelectorAll('.legi .legv')].slice(0,4).forEach((e,i)=>e.textContent=pct(vals[i],0,true));
}

function showLiveError(err){
  let box=document.getElementById('liveErrorBox');
  if(!box){box=document.createElement('div');box.id='liveErrorBox';document.body.appendChild(box);}
  const stack=(err&&err.stack)?String(err.stack).split('\n').slice(0,4).join('\n'):'';
  box.textContent='Live load failed\n'+(err&&err.message?err.message:String(err))+(stack?'\n\n'+stack:'');
}
function clearLiveError(){
  const box=document.getElementById('liveErrorBox');
  if(box)box.remove();
  document.body.classList.remove('live-error');
}

// Same six colours as the static placePie() palette, redeclared here because
// PLACE_PAL lives in an earlier script block that this layer cannot reach.
const PLACEMENT_COLORS=['#ff8a3d','#ffb800','#ff5c8a','#c77dff','#7b6cff','#06d6a0','#4d9fff','#00e5c3','#f4a261','#ec0a9b','#5af0dc','#a3e635'];

function renderPlacementShare(data,platform,s){
  const id=platform==='iOS'?'iosPlacePie':'andPlacePie';
  const card=[...(s?.querySelectorAll('.card')||[])].find(c=>clean(c.querySelector('h2')?.textContent).includes('Rewarded Placement Share'));
  if(!card)return;
  const share=data.placements?.[platform]||{};
  const items=(share.items||[]).filter(x=>finite(x.impressions)&&x.impressions>0);
  const row=card.closest('.ad-format-wide');
  if(!items.length){
    card.style.display='none';row?.classList.add('no-placement');
    console.warn('[placements] nothing to draw for '+platform+' \u2014 data.placements is '+(data.placements?'present but empty for this platform':'MISSING from the payload (main.gs not redeployed?)'));
    noChart(id,'Placement-level data is unavailable for this period');return;
  }
  card.style.display='';row?.classList.remove('no-placement');
  const total=finite(share.total)&&share.total>0?share.total:items.reduce((a,x)=>a+x.impressions,0);
  const heading=card.querySelector('h2');if(heading)heading.textContent='Rewarded Placement Share';
  destroyChart(id);
  const el=document.getElementById(id);
  if(el)STATE.charts[id]=new Chart(el,{type:'doughnut',
    data:{labels:items.map(x=>x.placement),datasets:[{data:items.map(x=>x.impressions),backgroundColor:items.map((x,i)=>PLACEMENT_COLORS[i%PLACEMENT_COLORS.length]),borderColor:'#0b0c0f',borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,cutout:'55%',plugins:{legend:{display:false},
      livePiePercentLabels:{color:'#000'},
      tooltip:{callbacks:{label:c=>' '+c.label+': '+num(c.raw)+' imp ('+pct(c.raw/(total||1),1,true)+')'}}}},
    /* This chart was built without the percent-label plugin, so its slices
       never carried a value the way every other donut here does. */
    plugins:[livePiePercentLabels]});
  const legend=card.querySelector('.legi')?.parentElement;
  if(legend)legend.innerHTML=items.map((x,i)=>'<div class="legi" style="margin-bottom:6px"><span class="legn">'+(i+1)+'</span><span class="dot" style="background:'+PLACEMENT_COLORS[i%PLACEMENT_COLORS.length]+'"></span><span style="font-size:10.5px">'+escapeHtml(x.placement)+'</span><span class="legv">'+pct(x.share,1,true)+'</span></div>').join('');
  const note=[...card.querySelectorAll('div')].find(x=>clean(x.textContent).startsWith('Top placement:'));
  if(note){
    const top=items[0],second=items[1],color=platform==='iOS'?'var(--ios)':'var(--and)';
    const from=share.weekStart||data.meta?.curStart||'',to=share.weekEnd||data.meta?.curEnd||'';
    note.innerHTML='<b style="color:'+color+'">Top placement:</b> '+escapeHtml(top.placement)+' drives '+pct(top.share,1,true)+' of rewarded impressions'
      +(second?', followed by '+escapeHtml(second.placement)+' ('+pct(second.share,1,true)+')':'')
      +'. Week '+(from&&to?longRange(from,to):'selected')+' \u00b7 '+num(total)+' impressions.';
  }
}

function renderAdOverview(data,platform){
  const prefix=platform==='iOS'?'iOS':'Android',s=slide(prefix+' Total Ad Revenue Overview'),w=data[platform].W_current,p=data[platform].W_prev,color=platform==='iOS'?'var(--ios)':'var(--and)';
  setKpi(s,'Total Ad Revenue',money(w.totad),w.totad,p.totad,money,'Includes standard formats, immersive, and failover | '+deltaHTML(w.totad,p.totad,money));
  setKpi(s,'ARPDAU',money(w.arpdau,4),w.arpdau,p.arpdau,v=>money(v,4));
  setKpi(s,'Ad Viewer Rate',pct(w.avr_all,1,true),w.avr_all,p.avr_all,v=>pct(v,1,true));
  setKpi(s,'Imp / DAU',num(w.impdau_all,1),w.impdau_all,p.impdau_all,v=>num(v,1));
  const card=[...s.querySelectorAll('.card')].find(c=>clean(c.querySelector('h2')?.textContent).includes('Ad Revenue by Format'));
  if(card){
    const items=[['Rewarded',w.rewarded],['Interstitial',w.interstitial],['Banner',w.banner],['Failover (AdMob)',w.failover],['Immersive',w.immersive]],den=w.totad||1;
    card.querySelectorAll('.src-row').forEach((r,i)=>{const item=items[i];if(!item)return;const share=item[1]/den*100;r.querySelector('.src-name').textContent=item[0];r.querySelector('.src-val').textContent=money(item[1]);const bar=r.querySelector('.src-bar');if(bar){bar.style.width=Math.max(0,share)+'%';bar.style.background=color;bar.textContent=share>=9?num(share,1)+'%':'';}const extra=[...r.querySelectorAll('span')].find(x=>x!==bar);if(extra)extra.textContent=share<9?num(share,1)+'%':'';});
    const ranked=Object.entries(w.networks||{}).sort((a,b)=>b[1]-a[1]).slice(0,3);const note=[...card.querySelectorAll('div')].find(x=>clean(x.textContent).startsWith('Top networks:'));if(note)note.innerHTML='<b>Top networks:</b> '+(ranked.length?ranked.map(x=>x[0]+' ('+money(x[1])+')').join(', '):'No network rows returned');
  }
  try{ renderPlacementShare(data,platform,s); }
  catch(err){ console.error('renderPlacementShare failed for '+platform,err);
              noChart(platform==='iOS'?'iosPlacePie':'andPlacePie','Placement chart failed: '+(err.message||err)); }
}

function renderImmersive(data,platform){
  const name=platform==='iOS'?'iOS':'Android',s=slide(name+' Immersive Ads'),w=data[platform].W_current,p=data[platform].W_prev,imp=w.gadsme_imp+w.anzu_imp,blend=imp?w.immersive/imp*1000:null,fill=imp?(w.gadsme_fill*w.gadsme_imp+w.anzu_fill*w.anzu_imp)/imp:null;
  setKpi(s,'Total Immersive Rev',money(w.immersive),w.immersive,p.immersive,money);
  setKpi(s,'Blended eCPM',money(blend,3),null,null,null,'Revenue / impressions x 1000');
  setKpi(s,'Blended Fill Rate',pct(fill,2,false),null,null,null,'Impression-weighted Gadsme + Anzu');
  setKpi(s,'AdMob Failover',pct(w.failover_pct,1,false),null,null,null,(finite(w.failover_pct)&&w.failover_pct<=10?'Within':'Above')+' 10% target | '+money(w.failover));
  const table=s.querySelector('table'),tbody=table?.querySelector('tbody');if(tbody){const winner=(a,b,low)=>!finite(a)||!finite(b)?'N/A':((low?a<b:a>b)?'Gadsme':'Anzu'),rows=[['Revenue',w.gadsme,w.anzu,money,'139,92,246'],['Impressions',w.gadsme_imp,w.anzu_imp,num,'77,159,255'],['eCPM',w.gadsme_ecpm,w.anzu_ecpm,v=>money(v,3),'236,10,155'],['Fill Rate',w.gadsme_fill,w.anzu_fill,v=>pct(v,2,false),'255,184,0']];tbody.innerHTML=rows.map(r=>{const values=[...new Set([r[1],r[2]].filter(finite).map(v=>Math.abs(v)))].sort((a,b)=>a-b),shade=v=>{const i=values.indexOf(Math.abs(v||0)),t=values.length>1?i/(values.length-1):1;return'background:rgba('+r[4]+','+(0.36-0.20*t).toFixed(3)+')'},win=winner(r[1],r[2]);return '<tr><td class="fmt-name">'+r[0]+'</td><td class="num b" style="'+shade(r[1])+'">'+r[3](r[1])+'</td><td class="num b" style="'+shade(r[2])+'">'+r[3](r[2])+'</td><td class="num" style="color:var(--blue);background:rgba(77,159,255,.16);font-weight:600!important">'+win+'</td></tr>';}).join('');}
  const failoverLabel=[...s.querySelectorAll('div')].find(el=>clean(el.textContent).startsWith('AdMob Failover (')&&el.children.length===0);
  if(failoverLabel){
    failoverLabel.textContent='AdMob Failover (Current)';
    const detail=failoverLabel.nextElementSibling;
    if(detail)detail.innerHTML=money(w.failover)+' revenue · '+num(w.failover_imp)+' impressions · eCPM '+money(w.failover_ecpm,3)+' · <span style="color:'+(finite(w.failover_pct)&&w.failover_pct<=10?'var(--green)':'var(--coral)')+';font-weight:600">'+pct(w.failover_pct,1,false)+' of impressions ('+(finite(w.failover_pct)&&w.failover_pct<=10?'within':'above')+' 10% target)</span> <span style="color:var(--t3)">— live Google Sheets · Admob Failover</span>';
  }
}

function renderFormatSnapshot(data,platform,format){
  const name=platform==='iOS'?'iOS':'Android',s=[...document.querySelectorAll('.slide')].find(x=>{const t=clean(x.querySelector('.h1')?.textContent);return t.includes(name+' '+format+' Ads')&&t.includes('Performance Snapshot');}),cfg=FORMAT[format],w=data[platform].W_current,p=data[platform].W_prev,c=w.cohort?.[format]||{},pc=p.cohort?.[format]||{};
  const u=(data[platform]&&data[platform].us)?data[platform].us:{};
  ensureUsHeader_(s);
  setKpi(s,'Revenue',money(w[cfg.field]),w[cfg.field],p[cfg.field],money);
  const bEcpm=benchValue(data,platform,format,'eCPM'),bAvr=benchValue(data,platform,format,'Viewer_Rate');
  setKpi(s,'eCPM',money(w[cfg.ecpm],2),w[cfg.ecpm],p[cfg.ecpm],v=>money(v,2),(finite(bEcpm)?'vs '+money(bEcpm,2)+' live benchmark | ':'')+deltaHTML(w[cfg.ecpm],p[cfg.ecpm],v=>money(v,2)));
  setKpi(s,'Viewer Rate',pct(w[cfg.avr],1,true),w[cfg.avr],p[cfg.avr],v=>pct(v,1,true),(finite(bAvr)?'vs '+pct(bAvr,1,true)+' live benchmark | ':'')+deltaHTML(w[cfg.avr],p[cfg.avr],v=>pct(v,1,true)));
  setKpi(s,'Imp / DAU',num(w[cfg.imp],2),w[cfg.imp],p[cfg.imp],v=>num(v,2));
  const table=s.querySelector('table.airy'),tbody=table?.querySelector('tbody'),bD0=benchValue(data,platform,format,'D0_IPU');
  const uc=(u.cohort&&u.cohort[format])?u.cohort[format]:{};   // US cumulative Imp/User
  if(tbody)tbody.innerHTML=rowHtml('eCPM',w[cfg.ecpm],u[cfg.ecpm],bEcpm,p[cfg.ecpm],v=>money(v,2))+rowHtml('Viewer Rate',w[cfg.avr],u[cfg.avr],bAvr,p[cfg.avr],v=>pct(v,1,true))+rowHtml('Imp/DAU',w[cfg.imp],u[cfg.imp],null,p[cfg.imp],v=>num(v,2))+rowHtml('Imp/User D0',c.d0,uc.d0,bD0,pc.d0,v=>num(v,2))+rowHtml('Imp/User D7 cumulative'+(c.projected?' | projected':''),c.d7,uc.d7,null,pc.d7,v=>num(v,2))+rowHtml('Imp/User D27 cumulative'+(c.projected?' | projected':''),c.d27,uc.d27,null,pc.d27,v=>num(v,2))+rowHtml('DAU',w.dau,u.dau,null,p.dau,v=>num(v,0))+rowHtml('ARPDAU blended',w.arpdau,u.arpdau,null,p.arpdau,v=>money(v,4));
  const share=(w.rib_total? w[cfg.field]/w.rib_total:null);setKpi(s,'Revenue Share of Ad Mix',pct(share,0,true),null,null,null,'of standard-format revenue | live');
  const checks=[[w[cfg.ecpm],bEcpm],[w[cfg.avr],bAvr],[c.d0,bD0]].filter(x=>finite(x[1])),passed=checks.filter(x=>x[0]>=x[1]).length;setKpi(s,'Benchmark Scorecard',checks.length?passed+'/'+checks.length:'N/A',null,null,null,checks.length?'metrics at/above returned benchmarks':'No comparable benchmark returned');
  const reporting=[...s.querySelectorAll('div')].find(x=>clean(x.textContent).startsWith('Reporting week')&&x.style.fontSize==='8.5px');
  if(reporting)reporting.innerHTML='<b>Reporting week = '+longRange(data.meta.curStart,data.meta.curEnd)+'.</b> Current and Previous values come from the selected live week pair. Cohort D0/D7/D27 values are cumulative and retain the returned projection flag. Benchmark cells use the live Benchmark sheet response; unavailable comparisons are shown as no comp.';
}

function renderFormatTrends(data,platform,format){
  const pre=platform==='iOS'?'ios':'and',cfg=FORMAT[format],t=data.trend?.[platform],labels=data.trend?.labels||[];
  const benchEcpm=benchValue(data,platform,format,'eCPM'),benchAvr=benchValue(data,platform,format,'Viewer_Rate'),selfEcpm=selfValue(data,platform,format,'ecpm'),selfAvr=selfValue(data,platform,format,'avr'),selfImp=selfValue(data,platform,format,'impdau');
  const constant=(v)=>finite(v)?new Array(labels.length).fill(v):null;
  lineChart(pre+format+'Ecpm',labels,[{label:'Actual',data:t?.ecpm?.[format],color:cfg.color,fill:true},{label:'Competitor global',data:constant(benchEcpm),color:'#edf2ff',dash:true},{label:'Self benchmark',data:constant(selfEcpm),color:'#00e5c3',dash:true}],v=>money(v,2));
  lineChart(pre+format+'Avr',labels,[{label:'Actual',data:(t?.avr?.[format]||[]).map(v=>finite(v)?v*100:null),color:cfg.color,fill:true},{label:'Competitor / industry',data:constant(finite(benchAvr)?benchAvr*100:null),color:'#edf2ff',dash:true},{label:'Self benchmark',data:constant(finite(selfAvr)?selfAvr*100:null),color:'#00e5c3',dash:true}],v=>num(v,1)+'%');
  lineChart(pre+format+'Imp',labels,[{label:'Actual',data:t?.impdau?.[format],color:cfg.color,fill:true},{label:'Self benchmark',data:constant(selfImp),color:'#00e5c3',dash:true}],v=>num(v,1));
  const base=pre+format+'D0';STATE.cohortChoice[base]=STATE.cohortChoice[base]||'d0';drawCohort(data,platform,format,base,STATE.cohortChoice[base]);
}
function drawCohort(data,platform,format,base,metric){
  const c=data.trend?.[platform]?.cohort?.[format],vals=c?.[metric]||[],b=metric==='d0'?benchValue(data,platform,format,'D0_IPU'):null,labels=c?.labels||data.trend?.labels||[],cfg=FORMAT[format];
  lineChart(base,labels,[{label:metric.toUpperCase()+' cumulative',data:vals,color:cfg.color,fill:true},{label:'Competitor global',data:finite(b)?new Array(labels.length).fill(b):null,color:'#edf2ff',dash:true}],v=>num(v,1));
  const pending=document.getElementById(base+'_pending');if(pending)pending.style.display='none';
}
window.switchCohort=function(base,metric,button){STATE.cohortChoice[base]=metric;button?.parentElement?.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===button));if(!STATE.data)return;const platform=base.startsWith('ios')?'iOS':'Android',format=base.includes('Rewarded')?'Rewarded':base.includes('Interstitial')?'Interstitial':'Banner';drawCohort(STATE.data,platform,format,base,metric);};

function renderIAP(data,platform){
  const name=platform==='iOS'?'iOS':'Android',pre=platform==='iOS'?'ios':'and',w=data[platform].W_current,p=data[platform].W_prev,products=Object.entries(w.products||{}).filter(x=>finite(x[1])&&x[1]>0).sort((a,b)=>b[1]-a[1]),prodTotal=products.reduce((a,x)=>a+x[1],0);
  const shareSlide=slide(name+' IAP Revenue Breakdown');doughnut(pre+'IapPie',products.map(x=>x[0]),products.map(x=>x[1]),products.map((x,i)=>COLORS[i%COLORS.length]));
  const shareHeading=shareSlide&&[...shareSlide.querySelectorAll('h2')].find(h=>clean(h.textContent).includes('Products by Revenue Share'));if(shareHeading)shareHeading.textContent='Products by Revenue Share (Current)';
  const legend=shareSlide?.querySelector('.legend2');if(legend){legend.innerHTML=products.map((x,i)=>'<div class="legi2"><span class="lrank">'+(i+1)+'</span><span class="dot" style="background:'+COLORS[i%COLORS.length]+'"></span><span class="lname">'+escapeHtml(x[0])+'</span><span class="legv">'+pct(x[1]/(prodTotal||1),1,true)+'</span></div>').join('');legend.style.gridTemplateRows='repeat('+Math.max(1,Math.ceil(products.length/2))+',auto)';}
  const totalNote=[...(shareSlide?.querySelectorAll('.note')||[])][0];if(totalNote)totalNote.innerHTML='<b>Total product revenue (Current):</b> '+money(prodTotal)+' | '+deltaText(prodTotal,sum(p.products||{}),' WoW')+' | live values';
  lineChart(pre+'ArppuLine',data.trend?.[platform]?.iap?.labels||data.trend?.labels||[],[{label:'ARPPU',data:data.trend?.[platform]?.iap?.arppu,color:platform==='iOS'?'#4d9fff':'#00e5c3',fill:true}],v=>money(v,2));
  lineChart(pre+'PrateLine',data.trend?.[platform]?.iap?.labels||data.trend?.labels||[],[{label:'Purchase Rate',data:(data.trend?.[platform]?.iap?.prate||[]).map(v=>finite(v)?v*100:null),color:platform==='iOS'?'#4d9fff':'#00e5c3',fill:true}],v=>num(v,2)+'%');
  const detail=[...document.querySelectorAll('.slide')].find(x=>{const t=clean(x.querySelector('.h1')?.textContent);return t.includes(name+' IAP')&&t.includes('Full Products');});
  setKpi(detail,'IAP Sales',money(w.iap_gross),w.iap_gross,p.iap_gross,money);
  setKpi(detail,'ARPPU',money(w.arppu,2),w.arppu,p.arppu,v=>money(v,2));
  setKpi(detail,platform==='iOS'?'Paying Users':'Paying Buyers',num(w.payers),w.payers,p.payers,v=>num(v));
  setKpi(detail,'Purchase Rate',pct(w.prate,3,true),w.prate,p.prate,v=>pct(v,3,true));
  renderProductTables(detail,w.products||{},p.products||{});
  const productHeading=[...(detail?.querySelectorAll('h2')||[])].find(h=>clean(h.textContent).includes('All IAP Products'));if(productHeading)productHeading.textContent='All IAP Products (Previous to Current | live product values)';
  hideCardByHeading(detail,'Purchase Timing');
  // The Purchase Timing card is hidden, so let the products card take the full row width
  const prodCard=[...(detail?.querySelectorAll('.card')||[])].find(c=>clean(c.querySelector('h2')?.textContent).includes('All IAP Products'));
  if(prodCard){const row=prodCard.closest('.row-23');if(row){row.style.gridTemplateColumns='1fr';[...row.children].forEach(ch=>{if(ch!==prodCard)ch.style.display='none';});}}
}
function renderProductTables(s,current,previous){
  if(!s)return;const card=[...s.querySelectorAll('.card')].find(c=>clean(c.querySelector('h2')?.textContent).includes('All IAP Products')),tables=card?[...card.querySelectorAll('table')]:[];if(!tables.length)return;
  const names=[...new Set([...Object.keys(current),...Object.keys(previous)])].sort((a,b)=>(current[b]||0)-(current[a]||0)),mid=Math.ceil(names.length/2);
  const previousRanks=[...new Set(names.map(n=>previous[n]||0))].sort((a,b)=>a-b),currentRanks=[...new Set(names.map(n=>current[n]||0))].sort((a,b)=>a-b);
  const heat=(value,values,rgb)=>{const i=values.indexOf(value),t=values.length>1?i/(values.length-1):1;return'--heat-rgb:'+rgb+';--heat-alpha:'+(0.36-0.20*t).toFixed(3)+';font-size:9.5px'};
  const grid=tables[0]?.parentElement;if(grid)grid.classList.add('product-split-grid');
  const wowByName=Object.fromEntries(names.map(n=>[n,change(current[n]||0,previous[n]||0)])),wowRanks=[...new Set(names.map(n=>wowByName[n]).filter(finite).map(Math.abs))].sort((a,b)=>a-b);
  [names.slice(0,mid),names.slice(mid)].forEach((list,i)=>{if(!tables[i])return;const table=tables[i];table.classList.add('product-split-table');table.dataset.rowStart=String(i===0?1:mid+1);const tb=table.querySelector('tbody');if(tb)tb.innerHTML=list.map(n=>{const c=current[n]||0,p=previous[n]||0,d=wowByName[n],wi=wowRanks.indexOf(Math.abs(d)),wowStrength=wowRanks.length>1?wi/(wowRanks.length-1):1;return '<tr><td style="font-size:9.5px">'+escapeHtml(n)+'</td><td class="num mut product-value-cell" style="'+heat(p,previousRanks,'77,159,255')+'">'+money(p)+'</td><td class="num b product-value-cell" style="'+heat(c,currentRanks,'0,229,195')+'">'+money(c)+'</td><td class="num product-wow-cell" style="--heat-rgb:'+(finite(d)&&d>=0?'0,224,154':'255,61,103')+';--heat-alpha:'+(0.36-0.20*wowStrength).toFixed(3)+'"><span class="delta '+(finite(d)&&d>=0?'up':'down')+'">'+(finite(d)?(d>=0?'+':'-')+num(Math.abs(d)*100,0)+'%':(c?'new':'N/A'))+'</span></td></tr>';}).join('');});
}

function canonicalNetworkName(raw){
  const n=clean(raw);
  if(/^applovin\b/i.test(n))return 'AppLovin';
  if(/^mintegral\b/i.test(n))return 'Mintegral';
  if(/^inmobi\b/i.test(n))return 'InMobi';
  if(/^google ad manager(?: native)?$/i.test(n))return 'Google Ad Manager';
  if(/^liftoff(?: monetize)?\b/i.test(n))return 'Liftoff';
  return n.replace(/\s+native\s+bidding$/i,'').replace(/\s+bidding$/i,'').replace(/\s+exchange$/i,'').trim()||'Unknown';
}
function aggregateNetworks(revenueMap,metricsMap){
  const out={};
  const rawNames=[...new Set([...Object.keys(revenueMap||{}),...Object.keys(metricsMap||{})])];
  rawNames.forEach(raw=>{
    const name=canonicalNetworkName(raw),metric=(metricsMap||{})[raw]||{};
    const revenue=finite((revenueMap||{})[raw])?(revenueMap||{})[raw]:(finite(metric.revenue)?metric.revenue:0);
    let impressions=finite(metric.impressions)?metric.impressions:0;
    if(!impressions&&revenue&&finite(metric.ecpm)&&metric.ecpm>0)impressions=revenue/metric.ecpm*1000;
    const item=out[name]||(out[name]={revenue:0,impressions:0});
    item.revenue+=revenue||0;item.impressions+=impressions||0;
  });
  Object.values(out).forEach(item=>{item.ecpm=item.impressions>0?item.revenue/item.impressions*1000:null});
  return out;
}
function renderNetworks(data,platform){
  const name=platform==='iOS'?'iOS':'Android',pre=platform==='iOS'?'ios':'and',w=data[platform].W_current,p=data[platform].W_prev,s=slide(name+' Network Revenue & GAM Fill Rate');
  const currentRaw=w.networks||{},previousRaw=p.networks||{},currentMetrics=w.network_metrics||{},previousMetrics=p.network_metrics||{};
  const current=aggregateNetworks(currentRaw,currentMetrics),previous=aggregateNetworks(previousRaw,previousMetrics);
  const names=[...new Set([...Object.keys(current),...Object.keys(previous)])].sort((a,b)=>(current[b]?.revenue||0)-(current[a]?.revenue||0));

  const tableRow=s?.querySelector('.row2');
  const cards=tableRow?[...tableRow.children].filter(el=>el.classList?.contains('card')):[];
  if(tableRow)tableRow.style.gridTemplateColumns='1fr';
  if(cards[0]){cards[0].style.display='block';cards[0].style.width='100%';cards[0].style.gridColumn='1 / -1';}
  if(cards[1])cards[1].style.display='none';
  const tbody=cards[0]?.querySelector('tbody');
  if(tbody)tbody.innerHTML=names.map(n=>{
    const c=current[n]?.revenue||0,pv=previous[n]?.revenue||0,d=change(c,pv),ecpm=current[n]?.ecpm,prevEcpm=previous[n]?.ecpm,ecpmDelta=change(ecpm,prevEcpm);
    return '<tr><td style="font-size:10px">'+escapeHtml(n)+'</td><td class="num b">'+money(c)+'</td><td class="num"><span class="delta '+(finite(d)&&d>=0?'up':'down')+'">'+(finite(d)?(d>=0?'+':'-')+num(Math.abs(d)*100,0)+'%':(c?'new':'N/A'))+'</span></td><td class="num" style="font-size:9.5px;color:var(--t2)">'+(finite(ecpm)?money(ecpm,2):'--')+'</td><td class="num" style="font-size:9px">'+(finite(ecpmDelta)?'<span style="color:'+(ecpmDelta>=0?'var(--green)':'var(--coral)')+'">'+(ecpmDelta>=0?'▲+':'▼-')+num(Math.abs(ecpmDelta)*100,0)+'%</span>':'--')+'</td></tr>';
  }).join('');

  const total=Object.values(current).reduce((sum,item)=>sum+(item.revenue||0),0),prevTotal=Object.values(previous).reduce((sum,item)=>sum+(item.revenue||0),0),top=names[0],notes=s?[...s.querySelectorAll('.note')]:[];
  if(notes[0])notes[0].innerHTML='<div><b>Total '+name+' Ad Network Revenue:</b> Previous '+money(prevTotal)+' to Current '+money(total)+' ('+deltaText(total,prevTotal)+')'+(top?' | Top: '+escapeHtml(top)+' ('+pct((current[top]?.revenue||0)/(total||1),0,true)+')':'')+'</div>';
  const gamTotal=metrics=>{const rows=Object.entries(metrics||{}).filter(([network])=>/^Google Ad Manager(?: Native)?$/i.test(clean(network)));const rates=rows.map(([,item])=>item?.fillRate).filter(finite);return rates.length?rates.reduce((sum,rate)=>sum+rate,0)/rates.length:null;};
  const gam=notes.find(n=>clean(n.textContent).includes('Google Ad Manager'));if(gam){const curFill=gamTotal(currentMetrics),prevFill=gamTotal(previousMetrics),target=.05,gap=finite(curFill)?(curFill-target)*100:null,gapPct=finite(curFill)?(curFill/target-1)*100:null,meets=finite(curFill)&&curFill>=target;gam.style.justifyContent='space-between';gam.innerHTML=finite(curFill)?'<div><b>Google Ad Manager - Total Fill Rate</b> (Default + Native)<br><span style="font-size:10px;font-weight:600">Benchmark: ≥5% · '+(gap>=0?'+':'')+num(gap,2)+'pp vs target ('+(gapPct>=0?'+':'')+num(gapPct,0)+'%)</span></div><div style="text-align:right"><span style="font-size:26px;font-weight:800">'+pct(curFill,2,true)+'</span><br><span style="font-size:9.5px;font-weight:700">'+(meets?'AT/ABOVE TARGET':'BELOW TARGET')+(finite(prevFill)?' · W3 '+pct(prevFill,2,true):'')+'</span></div>':'<div><b>Google Ad Manager - Total Fill Rate</b> (Default + Native)<br><span style="font-size:10px;font-weight:600">Fill-rate inputs unavailable for this period</span></div>';}
  if(notes.length>2)notes[notes.length-1].innerHTML='<b style="color:'+(platform==='iOS'?'var(--ios)':'var(--and)')+'">Live finding:</b> Network revenue '+deltaText(total,prevTotal).toLowerCase()+'. '+(top?escapeHtml(top)+' is the leading network at '+pct((current[top]?.revenue||0)/(total||1),1,true)+' of returned network revenue.':'No network rows were returned.');

  const share=[...document.querySelectorAll('.slide')].find(x=>{const t=clean(x.querySelector('.h1')?.textContent);return t.includes(name+' Ad Network Revenue')&&t.includes('Share');});
  const ranked=names.filter(n=>(current[n]?.revenue||0)>0);doughnut(pre+'NetPie',ranked,ranked.map(n=>current[n].revenue),ranked.map((n,i)=>COLORS[i%COLORS.length]));
  const shareTotal=share&&[...share.querySelectorAll('div')].find(el=>{const directBold=[...el.children].find(child=>child.tagName==='B');return directBold&&clean(directBold.textContent).startsWith('Total Ad Network Rev (');});
  if(shareTotal)shareTotal.innerHTML='<b style="color:var(--t1)">Total Ad Network Rev (Current):</b> '+money(total)+' · '+ranked.length+' networks';
  const legend=share?.querySelector('.legend2');if(legend)legend.innerHTML=ranked.map((n,i)=>'<div class="legi2"><span class="lrank">'+(i+1)+'</span><span class="dot" style="background:'+COLORS[i%COLORS.length]+'"></span><span class="lname">'+escapeHtml(n)+'</span><span class="legv">'+pct(current[n].revenue/(total||1),1,true)+'</span></div>').join('');
}
function validAnalyticsSeries(values,test){return (values||[]).map((value,index)=>finite(value)&&(!test||test(value,index))?value:null);}

function renderAnalytics(data,platform){
  const name=platform==='iOS'?'iOS':'Android',pre=platform==='iOS'?'ios':'and',s=slide(name+' Player Analytics Overview'),w=data.analytics[platform].W_current,p=data.analytics[platform].W_prev,t=data.trend?.[platform]?.analytics||{},labels=t.labels||data.trend?.labels||[];
  setKpi(s,'DAU',num(w.dau),w.dau,p.dau,v=>num(v));setKpi(s,'New Installs / Day',num(w.installs),w.installs,p.installs,v=>num(v));setKpi(s,'Sessions / User',num(w.sessions,2),w.sessions,p.sessions,v=>num(v,2));setKpi(s,'Playtime / User',num(w.playtimeAvg,0)+'s',w.playtimeAvg,p.playtimeAvg,v=>num(v,0)+'s');setKpi(s,'D1 Retention',pct(w.d1,1,true),w.d1,p.d1,v=>pct(v,1,true));setKpi(s,'D7 Retention',pct(w.d7,1,true),w.d7,p.d7,v=>pct(v,1,true));setKpi(s,'Data Window',(labels.length||data.meta.trendDays)+' days',null,null,null,(labels[0]?longRange(labels[0],labels[labels.length-1]):'Live trend window'));setKpi(s,'Reporting Week',shortDate(data.meta.curStart)+' - '+shortDate(data.meta.curEnd),null,null,null,'Current selection');
  // The live analytics endpoint already returns retention in percentage
  // points (for example 0.4114 in Sheets becomes 41.14 here). Keep the
  // returned live values unchanged so Daily and its fitted Trend share units.
  const color=platform==='iOS'?'#4d9fff':'#00e5c3',withTrend=(values,label,lineColor,test)=>{values=validAnalyticsSeries(values,test);return [{label:'Trend',data:linearTrend(values),color:'#edf2ff',dash:true},{label:label||'Daily',data:values,color:lineColor,fill:true}];};lineChart(pre+'AnDau',labels,withTrend(t.dau,'Daily',color,v=>v>0),v=>num(v));lineChart(pre+'AnInstall',labels,withTrend(t.installs,'Daily','#00e5c3',v=>v>=0),v=>num(v));lineChart(pre+'AnSes',labels,withTrend(t.sessions,'Daily','#ffb800',v=>v>0&&v<=20),v=>num(v,2));lineChart(pre+'AnRet',labels,withTrend(t.d1,'Daily','#a78bfa',v=>v>=0&&v<=100),v=>num(v,1)+'%');
}

function renderEngagement(data,platform){
  const name=platform==='iOS'?'iOS':'Android',pre=platform==='iOS'?'ios':'and',s=slide(name+' Engagement Depth'),w=data.analytics[platform].W_current,p=data.analytics[platform].W_prev,shop=data.shopDayCount[platform]||{},ft=data.ftue[platform]||{},t=data.trend?.[platform]?.analytics||{},tf=data.trend?.[platform]?.ftue||{},labels=t.labels||data.trend?.labels||[];
  setKpi(s,'Playtime D0',num(w.playtimeD0,0)+'s',w.playtimeD0,p.playtimeD0,v=>num(v,0)+'s');setKpi(s,'Playtime Avg',num(w.playtimeAvg,0)+'s',w.playtimeAvg,p.playtimeAvg,v=>num(v,0)+'s');setKpi(s,'Session Length D0',num(w.sessionLengthD0,0)+'s',w.sessionLengthD0,p.sessionLengthD0,v=>num(v,0)+'s');
  setKpi(s,'Reach Shop Lvl 10',pct(shop.shopLevel?.reachAt10,1,false),shop.shopLevel?.reachAt10,shop.shopLevelPrev?.reachAt10,v=>pct(v,1,false));setKpi(s,'Reach Day 10',pct(shop.dayCount?.reachAt10,1,false),shop.dayCount?.reachAt10,shop.dayCountPrev?.reachAt10,v=>pct(v,1,false));setKpi(s,'FTUE @10 min Engaged',pct(ft.W_current,1,false),ft.W_current,ft.W_prev,v=>pct(v,1,false));
  const color=platform==='iOS'?'#4d9fff':'#00e5c3',withTrend=(values,lineColor,test)=>{values=validAnalyticsSeries(values,test);return [{label:'Trend',data:linearTrend(values),color:'#edf2ff',dash:true},{label:'Daily',data:values,color:lineColor,fill:true}];};lineChart(pre+'PlaytimeD0',labels,withTrend(t.playtimeD0,color,v=>v>0),v=>num(v,0)+'s');lineChart(pre+'PlaytimeAvg',labels,withTrend(t.playtimeAvg,'#00e5c3',v=>v>0),v=>num(v,0)+'s');lineChart(pre+'SessLen',labels,withTrend(t.sessionLengthD0,'#ffb800',v=>v>0),v=>num(v,0)+'s');const ftValues=validAnalyticsSeries(tf.ftue,v=>v>=0&&v<=100),ftHasData=ftValues.some(v=>finite(v));const ftCard=document.getElementById(pre+'Ftue')?.closest('.card');if(ftCard)ftCard.style.display=ftHasData?'':'none';if(ftHasData)lineChart(pre+'Ftue',tf.labels||labels,withTrend(ftValues,'#a78bfa'),v=>num(v,1)+'%');
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function renderWeeklyCategory(cat){
  const data=STATE.data;if(!data||STATE.rendered.has(cat))return;
  if(cat==='overview'){
    renderOverview(data);
  }else{
    const platform=cat==='ios'?'iOS':cat==='android'?'Android':null;
    if(!platform)return;
    renderAdOverview(data,platform);renderImmersive(data,platform);
    ['Rewarded','Interstitial','Banner'].forEach(format=>{renderFormatSnapshot(data,platform,format);renderFormatTrends(data,platform,format);});
    renderIAP(data,platform);renderNetworks(data,platform);renderAnalytics(data,platform);renderEngagement(data,platform);
  }
  STATE.rendered.add(cat);numberTables();
}

function renderAll(data){
  STATE.data=data;STATE.rendered=new Set();trimTrend(data);renderDates(data);
  renderWeeklyCategory('overview');
  if(weeklyReportCategory&&weeklyReportCategory!=='overview')renderWeeklyCategory(weeklyReportCategory);
  if(weeklyActiveTab==='analytics'&&weeklyPlatform)renderWeeklyCategory(weeklyPlatform);
  document.body.classList.remove('live-error');document.body.classList.add('live-ready');
}

// Adds a sequential "#" column (1,2,3...) to the front of every table. Idempotent
// and re-run after each render so dynamically-filled rows stay correctly numbered.
function numberTables(){
  document.querySelectorAll('table').forEach(tb=>{
    const headRow=tb.querySelector('thead tr');
    if(headRow && !headRow.querySelector('.rownum')){
      const th=document.createElement('th');th.className='rownum';th.textContent='#';
      headRow.insertBefore(th,headRow.firstChild);
    }
    let n=Math.max(1,Number(tb.dataset.rowStart)||1);
    tb.querySelectorAll('tbody tr').forEach(tr=>{
      let cell=tr.querySelector('.rownum');
      if(!cell){cell=document.createElement('td');cell.className='rownum';tr.insertBefore(cell,tr.firstChild);}
      cell.textContent=n++;
    });
  });
}

/* ── Payload cache ────────────────────────────────────────────────────────────
   ua_report.html feels instant on every filter change because one request hands
   it every raw row and each change is pure in-memory work. Weekly cannot copy
   that shape: Apps Script returns a payload already aggregated for the range
   that was asked for - eCPM, ARPPU, retention, cohort D0/D7/D27 and the WoW
   pairs are ratios derived from rows the browser never receives - so carving a
   wide payload down to a narrower range would print numbers that are simply
   wrong.
   What is both safe and fast is remembering each range's own payload. A range
   costs one round trip the first time and renders straight from memory every
   time after, which is the same instant response without inventing any figure
   the server did not compute. loadSnapshot() puts every preset into that map
   before the first render, so in practice each one is already warm. */
/* ── Daily refresh boundary ──────────────────────────────────────────────
   The source sheets are appended to once a DAY, roughly 06:00-08:00
   Asia/Karachi, and are not touched in between, so a payload fetched after
   that import stays correct for the rest of the day.

   The hour used to be 9 here, and that was wrong in both directions. The
   sync lands by 08:00, so anyone opening between 07:00 and 09:00 was served
   a copy marked stale and triggered a refetch - which landed right on top of
   the 08:30 warm and queued behind it. SnapshotBoot.dataBoundary() owns this
   now and uses 08:00, matching the 08:15 warm in WeeklySnapshot.gs.

   Freshness is also no longer a clock question at all. The server publishes
   a stamp that moves when the DATA moves, so a range is current because the
   stamp says so, not because it is younger than an arbitrary hour. The
   boundary only decides how often we bother to ASK. */
const refreshBoundary=()=>SnapshotBoot.dataBoundary();
const isFresh=entry=>!!entry&&entry.at>=refreshBoundary();

const payloadCache=new Map();      // canonical params key -> {at, json}
const inflight=new Map();          // canonical params key -> in-progress request
const cacheKey=params=>JSON.stringify(Object.keys(params).sort().map(k=>[k,params[k]]));

/* ── Ranges that survive a reload ────────────────────────────────────────
   This was localStorage: one key per range, a hard 1,500,000-character
   ceiling per entry, and a panic path that wiped every stored range when the
   quota ran out. The quota is ~5MB and is shared by the hub and all four
   reports, which is why the ceiling had to exist and why a wide range
   sometimes silently failed to persist and refetched the next morning.

   SnapshotBoot owns the disk copy now, in IndexedDB, where none of that
   applies. What remains here is the in-memory map a single page session uses
   to answer repeat renders - unchanged. */

/* Every render gets its own copy. renderAll() runs trimTrend(), which
   rewrites data.trend in place, so handing out the stored object would let
   one render edit what the next one reads. */
function clonePayload(json){
  try{return structuredClone(json)}catch(e){return JSON.parse(JSON.stringify(json))}
}

/* One-off: drop the localStorage tier this replaces, so it stops competing
   for the origin quota with the hub's auth token. */
try{
  const dropped=SnapshotStore.evictLegacy(['mss3d_weekly_payload_']);
  if(dropped)console.log('[weekly] evicted '+dropped+' legacy localStorage range(s)');
}catch(e){}

async function requestPayload(opts){
  const {mode='latest',date='',start='',end='',trend='56',selfStart='',selfEnd='',force=false}=opts||{};
  const params = { trendDays: Math.min(56,Number(trend)||56) };
  if(mode==='week'){ if(date) params.week=date; }
  else if(mode==='single'){ if(date){ params.start=date; params.end=date; } }
  else if(mode==='range'){ if(start&&end){ params.start=start; params.end=end; } }
  else if(mode==='all'){ params.all='1'; }
  if(selfStart&&selfEnd){ params.selfBenchStart=selfStart; params.selfBenchEnd=selfEnd; }
  const key=cacheKey(params),cached=payloadCache.get(key);
  if(force){payloadCache.delete(key);}
  else if(isFresh(cached)){STATE.fromCache=true;return clonePayload(cached.json);}
  STATE.fromCache=false;
  /* Clicking a preset that the background warm-up is already fetching should
     join that request, not open a second identical Apps Script execution. */
  if(!force&&inflight.has(key))return clonePayload(await inflight.get(key));
  /* After the key is computed, so a forced and a normal request share one
     cache slot. force=1 tells the backend to rebuild instead of serving its
     own server-side cache - that is what makes Refresh a real refresh. */
  if(force)params.force='1';
  const pending=(async()=>{
    const json=(await API.call('payload', params)).data;if(json.error)throw new Error(json.error);if(!json.meta||!json.iOS||!json.Android)throw new Error('Unexpected payload: required live report fields are missing');if(!json.benchmark)throw new Error('Live Benchmark payload is missing; redeploy the current Apps Script project');
    const entry={at:Date.now(),json};
    payloadCache.set(key,entry);
    return json;
  })();
  inflight.set(key,pending);
  try{ return clonePayload(await pending); }
  finally{ inflight.delete(key); }
}

/* ── The snapshot: one request IS the load ───────────────────────────────
   The order used to be backwards, and that is where "Weekly request
   interrupted" came from.

   loadLive() sent a single { action:'payload' } request for the selected
   range, then 1.2 seconds later a background hydratePresets() fetched
   { action:'payload_bundle' } to fill in the rest. But those two actions are
   not equivalent risks. `payload` CAN miss its cache, and when it does the
   router refuses to build inside a request - it schedules a trigger and
   answers "BUILDING:", so the browser polls for up to 85 seconds.
   `payload_bundle` never builds at all: it serves only what the morning warm
   already cached. The reliable path was running second.

   Now the bundle IS the first request. All five presets arrive together, so
   2/4/6/8/10 are in payloadCache before the first click and every one of them
   is a memory read. A second request only happens for a Single or Custom
   date, which no bundle can contain.

   And because SnapshotBoot compares stamps, the usual case is not even that:
   a browser that already has this morning's data sends ~90 bytes and is told
   nothing changed, or - after the first check of the day - sends nothing.

   Must stay identical to WEEKLY_CACHE.presets in Router.gs. */
const PRESET_WEEKS=[2,4,6,8,10];

/** The stamp our stored copy carries. Refresh watches this for movement. */
let SNAPSHOT_STAMP='';

/** Unpacks a snapshot response into payloadCache under the exact keys
    requestPayload() will look for. */
function absorbSnapshot(presets){
  let n=0;
  Object.keys(presets||{}).forEach(k=>{
    const item=presets[k];
    if(!item||!item.payload)return;          // that preset was not warmed yet
    const key=cacheKey({trendDays:56,start:item.start,end:item.end});
    payloadCache.set(key,{at:Date.now(),json:item.payload});
    n++;
  });
  return n;
}

async function loadSnapshot(){
  return SnapshotBoot.load({
    name:'weekly',
    request:(stamp)=>API.call('snapshot',{stamp:stamp||''},{quiet:true})
                      .then(r=>(r&&r.data)||r),
    extract:(res)=>res.presets,
    render:(presets,meta)=>{
      SNAPSHOT_STAMP=meta.stamp||SNAPSHOT_STAMP;
      absorbSnapshot(presets);
    },
    /* Silent by design. The snapshot is an optimisation that runs before
       loadLive() paints anything, so it must never write the status line,
       the spinner or the error banner. */
    onStatus:()=>{}
  });
}

/**
 * The Refresh button: "the sheet changed, go and look again".
 *
 * Schedules a real rebuild on the server and returns immediately, then polls
 * the cheap stamp action until it moves. Nothing blocks - the current view
 * stays on screen and readable for the whole rebuild.
 */
async function weeklyRefresh(){
  const button=document.getElementById('weeklyRefresh');
  if(button)button.disabled=true;
  try{
    const moved=await SnapshotBoot.refresh({
      name:'weekly',
      forceRequest:()=>API.call('snapshot',{force:'1'},{quiet:true}).then(r=>(r&&r.data)||r),
      stampRequest:()=>API.call('stamp',{},{quiet:true}).then(r=>(r&&r.data)||r),
      request:(stamp)=>API.call('snapshot',{stamp:stamp||''},{quiet:true}).then(r=>(r&&r.data)||r),
      extract:(res)=>res.presets,
      render:(presets,meta)=>{
        SNAPSHOT_STAMP=meta.stamp||SNAPSHOT_STAMP;
        /* A rebuild retires every range at once, including the Single and
           Custom ones the bundle does not carry. */
        payloadCache.clear();
        absorbSnapshot(presets);
      },
      onStatus:(text,kind)=>{ if(text)setStatus(text,kind==='error'); }
    });
    if(moved)loadLive(true);
  }finally{
    if(button)button.disabled=false;
  }
}

function probeLastDataDate(probe){
  const tl=(probe.trend&&probe.trend.labels)||[];
  const series=[];
  ['iOS','Android'].forEach(pf=>{
    const t=probe.trend&&probe.trend[pf]; if(!t)return;
    ['Rewarded','Interstitial','Banner'].forEach(at=>{ if(t.ecpm&&t.ecpm[at])series.push(t.ecpm[at]); if(t.impdau&&t.impdau[at])series.push(t.impdau[at]); });
    if(t.analytics&&t.analytics.dau)series.push(t.analytics.dau);
    if(t.iap&&t.iap.arppu)series.push(t.iap.arppu);
  });
  for(let i=tl.length-1;i>=0;i--){ if(series.some(v=>v&&v[i]!=null&&isFinite(v[i])))return tl[i]; }
  return (probe.meta&&(probe.meta.dataEnd||probe.meta.asOf))||tl[tl.length-1]||'';
}
async function loadLive(auto,force){
  if(STATE.loading)return;STATE.loading=true;const button=document.getElementById('weeklyLoad'),refreshButton=document.getElementById('weeklyRefresh');if(button)button.disabled=true;if(refreshButton)refreshButton.disabled=true;document.body.classList.remove('live-error');document.body.classList.add('live-busy');if(!STATE.data)document.body.classList.remove('live-ready');
  clearLiveError();
  const g=id=>document.getElementById(id);
  const mode=g('weeklyMode')?.value||'w2',date=g('weeklyDate')?.value||'',start=g('weeklyStart')?.value||'',end=g('weeklyEnd')?.value||'',trend='56';
  /* Hold the overlay for a beat. A cached or quick payload can come back in
     under 100ms, and an overlay that appears and vanishes inside one or two
     frames reads as nothing having happened at all - the exact thing the
     spinner is here to prevent. The STATE.loading check stops a stale timer
     from tearing down the overlay belonging to a newer load. */
  const busyStarted=Date.now();
  const clearBusy=()=>setTimeout(()=>{if(!STATE.loading)document.body.classList.remove('live-busy');},Math.max(0,400-(Date.now()-busyStarted)));
  const stop=(msg)=>{setStatus(msg,true);STATE.loading=false;clearBusy();if(button)button.disabled=false;if(refreshButton)refreshButton.disabled=false;};
  if(mode==='single'&&!date)return stop('Choose a date for this filter mode');
  if(mode==='range'&&(!start||!end))return stop('Choose both From and To dates');
  if(mode==='range'&&start>end)return stop('From date must be on or before To date');
  localStorage.setItem('weekly_mode',mode);localStorage.setItem('weekly_date',date);localStorage.setItem('weekly_start',start);localStorage.setItem('weekly_end',end);
  setStatus('Loading...');
  try{
    let data;
    const wk=/^w(\d+)$/.exec(mode);
    if(wk){
      // Monday-anchored window of N complete weeks, ending on the last full Sunday.
      // The backend returns all overview bars in weeklySeries from this one
      // execution, using the same already-loaded raw arrays.
      const w=weekWindow(Number(wk[1]), weekAnchor());
      data=await requestPayload({mode:'range',start:isoDay(w.start),end:isoDay(w.end),trend,force});
      if(!Array.isArray(data.weeklySeries)||!data.weeklySeries.length){
        throw new Error('Weekly payload is missing weeklySeries; deploy the current Weekly backend files');
      }
      STATE.asOf=data.meta.asOf||STATE.asOf;
    } else {
      data=await requestPayload({mode,date,start,end,trend,force});
      if(mode==='latest'&&data.meta?.asOf&&data.meta?.curEnd&&data.meta.asOf<data.meta.curEnd){const d=new Date(data.meta.curStart+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);const latestComplete=d.toISOString().slice(0,10);data=await requestPayload({mode:'week',date:latestComplete,trend,force});}
    }
    renderAll(data);
    clearLiveError();
    const modeLabel=wk?('Last '+wk[1]+' weeks'):({single:'Single date',range:'Custom range'}[mode]||'Live');
    /* Label the picker with the range the server actually returned, not the one
       requested - if the payload is short of the window, the dates say so. */
    setRangeSpan(data.meta.curStart,data.meta.curEnd);
    /* Cached and freshly fetched renders report identically - where the payload
       came from is an implementation detail, not something the reader needs.
       window.__weeklyDebug exposes it for checking from the console. */
    setStatus('Loaded');
    try{window.parent.postMessage({type:'mss3d:report-ready',report:'weekly'},location.origin)}catch(e){}
    /* The presets are already in payloadCache - loadSnapshot() put them there
       before this function was ever called. Nothing to hydrate. */
  }catch(err){
    console.error(err);
    /* A queued answer that outlived the poll budget means the build is just
       slow, not that anything broke. Say that plainly and keep the red stack
       trace box - which is for real faults - out of it. */
    if(err&&err.queued){
      setStatus('Weekly data is still being prepared — press Apply again in a minute.',true);
    }else{
      document.body.classList.add('live-error');
      setStatus('Error: '+(err.message||String(err)),true);
      showLiveError(err);
    }
  }
  finally{STATE.loading=false;clearBusy();if(button)button.disabled=false;if(refreshButton)refreshButton.disabled=false;}
}

// Sub-page navigation: within each main tab, split slides into Overview/iOS/Android
// (classified by each slide's eyebrow) and show one group at a time.
let weeklyActiveTab='report';
let weeklyPlatform=null;
let weeklyReportCategory='overview';
function setupSubnav(){
  // Classify each slide once. The shared Platform control then applies the same
  // iOS/Android choice to both Monetization and Analytics.
  ['tab-report','tab-analytics'].forEach(id=>{
    const tab=document.getElementById(id);if(!tab)return;
    tab.querySelectorAll(':scope > .slide').forEach(sl=>{
      const t=(sl.querySelector('.eyebrow')?.textContent)||'';
      sl.dataset.plat=/Platform:\s*iOS/i.test(t)?'ios':/Platform:\s*Android/i.test(t)?'android':'overview';
    });
  });
  selectSub(document.getElementById('tab-report'),'overview');
  selectSub(document.getElementById('tab-analytics'),'ios');

  /* Native pill select, matching the UA Negative Spend platform control. */
  const oldPlatform=document.getElementById('platform-nav');
  if(oldPlatform){
    const wrap=document.createElement('span');wrap.className='platform-drop';wrap.id='weeklyPlatformDrop';
    const select=document.createElement('select');
    select.id='weeklyPlatformSelect';select.hidden=true;
    select.setAttribute('aria-label','Platform');
    select.innerHTML='<option value="overview">Overview</option><option value="ios">IOS</option><option value="android">Android</option>';
    wrap.innerHTML='<button id="weeklyPlatformBtn" class="navbtn" type="button" aria-haspopup="true">Overview</button>'+ 
      '<span class="platform-drop-menu" id="weeklyPlatformDropMenu"><button type="button" data-platform="overview" class="active">Overview</button>'+ 
      '<button type="button" data-platform="ios">IOS</button><button type="button" data-platform="android">Android</button></span>';
    wrap.appendChild(select);oldPlatform.replaceWith(wrap);
    const paintPlatform=choice=>{
      const btn=document.getElementById('weeklyPlatformBtn');if(btn)btn.textContent=choice==='ios'?'IOS':choice==='android'?'Android':'Overview';
      wrap.querySelectorAll('[data-platform]').forEach(b=>b.classList.toggle('active',b.dataset.platform===choice));
    };
    select.onchange=()=>{
      const choice=select.value;
      paintPlatform(choice);
      if(choice==='overview'){
        weeklyPlatform=null;weeklyReportCategory='overview';weeklyActiveTab='report';
        showTab('report');selectSub(document.getElementById('tab-report'),'overview');
      }else{
        weeklyPlatform=choice;weeklyReportCategory=choice;
        selectSub(document.getElementById('tab-report'),choice);
        selectSub(document.getElementById('tab-analytics'),choice);
      }
    };
    wrap.querySelectorAll('[data-platform]').forEach(btn=>btn.onclick=()=>{
      select.value=btn.dataset.platform;select.dispatchEvent(new Event('change',{bubbles:true}));
      wrap.classList.add('menu-dismissed');
      document.getElementById('weeklyPlatformBtn')?.blur();
    });
    document.getElementById('weeklyPlatformBtn')?.addEventListener('click',()=>wrap.classList.remove('menu-dismissed'));
  }

  document.getElementById('btn-report')?.addEventListener('click',()=>{
    weeklyActiveTab='report';showTab('report');
    const target=weeklyPlatform||'overview';
    selectSub(document.getElementById('tab-report'),target);
    const select=document.getElementById('weeklyPlatformSelect');if(select){select.value=target;select.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  document.getElementById('btn-analytics')?.addEventListener('click',()=>{
    weeklyActiveTab='analytics';showTab('analytics');
    const target=weeklyPlatform||'ios';
    selectSub(document.getElementById('tab-analytics'),target);
    const select=document.getElementById('weeklyPlatformSelect');if(select){select.value=target;select.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  document.querySelectorAll('#tabnav .navbtn[data-toggle]').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();const drop=btn.closest('.navdrop'),open=drop.classList.contains('open');document.querySelectorAll('.navdrop.open').forEach(d=>d.classList.remove('open'));if(!open)drop.classList.add('open');});
  });
  document.querySelectorAll('#platform-nav .navmenu button').forEach(item=>{
    item.addEventListener('click',e=>{
      e.stopPropagation();weeklyPlatform=item.dataset.platform;weeklyReportCategory=weeklyPlatform;
      if(weeklyPlatform==='overview'){
        weeklyPlatform=null;weeklyReportCategory='overview';weeklyActiveTab='report';
        showTab('report');
        document.getElementById('btn-platform').textContent='Platform: Overview ▾';
        selectSub(document.getElementById('tab-report'),'overview');
      }else{
        document.getElementById('btn-platform').textContent='Platform: '+(weeklyPlatform==='ios'?'iOS':'Android')+' ▾';
        selectSub(document.getElementById('tab-report'),weeklyPlatform);
        selectSub(document.getElementById('tab-analytics'),weeklyPlatform);
      }
      item.closest('.navmenu').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===item));
      item.closest('.navdrop').classList.remove('open');
    });
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.navdrop'))document.querySelectorAll('.navdrop.open').forEach(d=>d.classList.remove('open'));});
}
function selectSub(tab,cat){
  renderWeeklyCategory(cat);
  const nav=tab.querySelector(':scope > .subnav');
  if(nav)nav.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.cat===cat));
  tab.querySelectorAll(':scope > .slide').forEach(sl=>{
    const visible=sl.dataset.plat===cat;sl.style.display=visible?'':'none';
    if(visible){sl.style.animation='none';sl.style.opacity='0';void sl.offsetWidth;sl.style.animation='weeklyPlatformIn .3s ease forwards'}
  });
  // charts rendered while a slide was hidden have 0 size; nudge them to resize
  requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
}

/* STATE and payloadCache are IIFE-scoped and unreachable from the console, so
   there is otherwise no way to confirm from a running page which build is live
   or whether a render was served from memory. build reads back the ?v= the hub
   loaded this file with, so it can never drift out of step with index.html. */
window.__weeklyDebug={
  get build(){return new URLSearchParams(location.search).get('v')||'(no ?v= - opened directly)'},
  get cachedRanges(){return [...payloadCache.keys()]},
  get lastRenderFromCache(){return STATE.fromCache},
  /* Why a load did or did not hit the network: everything cached at or after
     `boundary` is served from memory until `nextRefresh`. */
  get cacheStatus(){
    const b=refreshBoundary(),next=new Date(b+86400000);
    return {
      refreshHour:SnapshotBoot.DATA_HOUR,
      stamp:SNAPSHOT_STAMP,
      boundary:new Date(b).toLocaleString(),
      nextRefresh:next.toLocaleString(),
      ranges:[...payloadCache.entries()].map(([k,v])=>({
        range:k,fetched:new Date(v.at).toLocaleString(),fresh:isFresh(v)
      }))
    };
  },
  state:STATE
};

/* Before the first load, so a range fetched earlier today is already in hand
   and loadLive() paints from it without touching the network. */

installControls();
setupSubnav();
document.body.insertAdjacentHTML('beforeend','<div id="uaLoader"><div class="lbox"><div class="spin"></div><b>Loading Data</b><div class="pulse"></div></div></div>');

/* Snapshot first, render second.
   Every preset the picker offers is in payloadCache before loadLive() runs,
   so the first paint is a memory read and so is every filter change after it.
   A failure here is not fatal: loadLive() still behaves exactly as it did,
   it just pays a network round trip for the selected range. */
(async()=>{
  try{ await loadSnapshot(); }
  catch(e){ console.warn('[weekly] snapshot unavailable, falling back:',e&&e.message); }
  loadLive(true);
})();
})();
