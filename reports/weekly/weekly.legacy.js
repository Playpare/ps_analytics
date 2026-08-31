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
const AD={"labels": ["07 Apr", "08 Apr", "09 Apr", "10 Apr", "11 Apr", "12 Apr", "13 Apr", "14 Apr", "15 Apr", "16 Apr", "17 Apr", "18 Apr", "19 Apr", "20 Apr", "21 Apr", "22 Apr", "23 Apr", "24 Apr", "25 Apr", "26 Apr", "27 Apr", "28 Apr", "29 Apr", "30 Apr", "01 May", "02 May", "03 May", "04 May", "05 May", "06 May", "07 May", "08 May", "09 May", "10 May", "11 May", "12 May", "13 May", "14 May", "15 May", "16 May", "17 May", "18 May", "19 May", "20 May", "21 May", "22 May", "23 May", "24 May", "25 May", "26 May", "27 May", "28 May", "29 May", "30 May", "31 May", "01 Jun", "02 Jun", "03 Jun", "04 Jun", "05 Jun", "06 Jun", "07 Jun", "08 Jun", "09 Jun", "10 Jun", "11 Jun", "12 Jun", "13 Jun", "14 Jun", "15 Jun", "16 Jun", "17 Jun", "18 Jun", "19 Jun", "20 Jun", "21 Jun", "22 Jun", "23 Jun", "24 Jun", "25 Jun", "26 Jun", "27 Jun", "28 Jun", "29 Jun", "30 Jun", "01 Jul", "02 Jul", "03 Jul", "04 Jul", "05 Jul", "06 Jul"], "iOS": {"dau": [241960.0, 238100.0, 237079.0, 239816.0, 243601.0, 244524.0, 220285.0, 215723.0, 213066.0, 217072.0, 230049.0, 245232.0, 243602.0, 222126.0, 222203.0, 217386.0, 217868.0, 224401.0, 239059.0, 241119.0, 216029.0, 213177.0, 210104.0, 212215.0, 229470.0, 235024.0, 241033.0, 216625.0, 206694.0, 201700.0, 199418.0, 206800.0, 218591.0, 223639.0, 205985.0, 204163.0, 206071.0, 211151.0, 213332.0, 221099.0, 224226.0, 202313.0, 200958.0, 196468.0, 198346.0, 202287.0, 213674.0, 220852.0, 214576.0, 209986.0, 207018.0, 206946.0, 206471.0, 212330.0, 219297.0, 201475.0, 200323.0, 198198.0, 198660.0, 198748.0, 207168.0, 215156.0, 203263.0, 200295.0, 196687.0, 193018.0, 194080.0, 204364.0, 218421.0, 203881.0, 202439.0, 200499.0, 194737.0, 196879.0, 204470.0, 214230.0, 206324.0, 204831.0, 211115.0, 211584.0, 216828.0, 230233.0, 249049.0, 242822.0, 239450.0, 233653.0, 232234.0, 230957.0, 238684.0, 249055.0, 241841.0], "install": [40096.0, 37762.0, 35722.0, 35556.0, 38563.0, 42442.0, 33077.0, 32046.0, 31724.0, 33993.0, 40863.0, 46684.0, 45236.0, 36231.0, 36201.0, 32384.0, 32869.0, 35372.0, 45335.0, 47034.0, 33807.0, 31099.0, 30196.0, 29490.0, 38522.0, 42574.0, 47352.0, 38246.0, 32808.0, 30653.0, 31708.0, 34871.0, 41435.0, 45153.0, 39349.0, 37413.0, 37116.0, 38665.0, 38424.0, 41588.0, 45533.0, 36030.0, 33645.0, 30842.0, 32355.0, 32140.0, 37662.0, 41812.0, 40845.0, 37461.0, 34695.0, 36207.0, 35519.0, 39497.0, 43729.0, 38122.0, 37043.0, 34485.0, 35393.0, 33324.0, 37606.0, 40009.0, 35637.0, 35876.0, 33897.0, 32617.0, 32360.0, 38280.0, 42856.0, 35381.0, 37564.0, 36924.0, 33316.0, 33866.0, 36120.0, 37527.0, 36647.0, 40534.0, 41293.0, 37598.0, 38480.0, 43478.0, 50377.0, 46916.0, 44749.0, 42247.0, 42175.0, 39746.0, 41166.0, 43969.0, 43486.0], "sessions": [5.19, 5.14, 5.04, 4.87, 4.81, 4.95, 5.03, 4.99, 4.94, 4.84, 4.77, 4.8, 5.03, 5.05, 5.08, 5.02, 4.95, 4.78, 4.74, 4.96, 5.05, 4.97, 4.85, 4.71, 4.66, 4.82, 5.0, 5.12, 5.06, 5.01, 4.89, 4.74, 4.74, 4.9, 5.02, 5.14, 5.02, 4.97, 4.89, 4.88, 5.04, 5.0, 4.93, 4.93, 4.82, 4.67, 4.61, 4.68, 4.75, 4.71, 4.64, 4.73, 4.75, 4.73, 4.83, 4.86, 4.9, 4.88, 4.78, 4.69, 5.06, 5.41, 5.04, 4.86, 4.79, 4.67, 4.62, 5.09, 5.38, 4.96, 4.7, 4.61, 4.61, 4.55, 5.12, 5.27, 4.98, 4.78, 4.86, 4.75, 4.65, 5.13, 5.27, 4.92, 4.67, 4.53, 4.48, 4.42, 4.89, 5.06, 4.74], "ret": [0.4263, 0.4212, 0.4206, 0.4148, 0.4217, 0.3949, 0.4231, 0.4194, 0.4185, 0.4209, 0.4202, 0.4171, 0.3945, 0.4271, 0.4247, 0.4246, 0.4185, 0.4102, 0.4154, 0.385, 0.4146, 0.4165, 0.4173, 0.4183, 0.4224, 0.4249, 0.389, 0.4057, 0.4075, 0.4015, 0.4019, 0.391, 0.4004, 0.3775, 0.4029, 0.3897, 0.396, 0.393, 0.3867, 0.3934, 0.3691, 0.4022, 0.3987, 0.3986, 0.4032, 0.3994, 0.4109, 0.3991, 0.4009, 0.3934, 0.4008, 0.4075, 0.4014, 0.4091, 0.386, 0.404, 0.4112, 0.4016, 0.3973, 0.3945, 0.4087, 0.3899, 0.4029, 0.4055, 0.3882, 0.3918, 0.3857, 0.4084, 0.3871, 0.403, 0.3962, 0.39, 0.3997, 0.397, 0.4118, 0.3967, 0.4049, 0.4169, 0.4113, 0.4132, 0.4158, 0.4276, 0.4169, 0.4228, 0.4189, 0.4176, 0.4125, 0.4143, 0.4282, 0.4114, 0.4243]}, "Android": {"dau": [594349.0, 582752.0, 591486.0, 628996.0, 691832.0, 712549.0, 597206.0, 556805.0, 554233.0, 577867.0, 639303.0, 717913.0, 732909.0, 626943.0, 625067.0, 608663.0, 625157.0, 652552.0, 719571.0, 737840.0, 635403.0, 628512.0, 632819.0, 665566.0, 778284.0, 778228.0, 781750.0, 672755.0, 645606.0, 622225.0, 616772.0, 672611.0, 737593.0, 775532.0, 687146.0, 675754.0, 674540.0, 688653.0, 699835.0, 749718.0, 770987.0, 662876.0, 661964.0, 655573.0, 671430.0, 716609.0, 800745.0, 856040.0, 799961.0, 808697.0, 811895.0, 806708.0, 812543.0, 834861.0, 842436.0, 770529.0, 765814.0, 765280.0, 758134.0, 777846.0, 832605.0, 839725.0, 717247.0, 709139.0, 709764.0, 728046.0, 773034.0, 849267.0, 907207.0, 814658.0, 796373.0, 802797.0, 797446.0, 835586.0, 894632.0, 945343.0, 876269.0, 854486.0, 857782.0, 877845.0, 919013.0, 965896.0, 1074058.0, 1043432.0, 1032684.0, 1008731.0, 992671.0, 966036.0, 1020772.0, 1176946.0, 1105453.0], "install": [163318.0, 156157.0, 157838.0, 175378.0, 213779.0, 232048.0, 167469.0, 135193.0, 147596.0, 160622.0, 193820.0, 238761.0, 244886.0, 184505.0, 180649.0, 169526.0, 174800.0, 184564.0, 226756.0, 241470.0, 189272.0, 182282.0, 186317.0, 196062.0, 260949.0, 259175.0, 261169.0, 208798.0, 189713.0, 178221.0, 175625.0, 211391.0, 248319.0, 271738.0, 228683.0, 218303.0, 213734.0, 213299.0, 210348.0, 242351.0, 259701.0, 201346.0, 201328.0, 196848.0, 204709.0, 226540.0, 273663.0, 307370.0, 273296.0, 268726.0, 260493.0, 256891.0, 261019.0, 268448.0, 273637.0, 251283.0, 252342.0, 243153.0, 232584.0, 240193.0, 268035.0, 267422.0, 199646.0, 201746.0, 208832.0, 223318.0, 244353.0, 277272.0, 298173.0, 242602.0, 241381.0, 254676.0, 255572.0, 272881.0, 290324.0, 302362.0, 270167.0, 261293.0, 269244.0, 281146.0, 298075.0, 305840.0, 376673.0, 366783.0, 359828.0, 346392.0, 322111.0, 291529.0, 318377.0, 440042.0, 389817.0], "sessions": [3.44, 3.41, 3.39, 3.39, 3.43, 3.5, 3.39, 3.38, 3.33, 3.3, 3.32, 3.39, 3.49, 3.39, 3.39, 3.36, 3.34, 3.36, 3.37, 3.45, 3.37, 3.36, 3.32, 3.28, 3.3, 3.37, 3.43, 3.34, 3.31, 3.23, 3.18, 3.16, 3.25, 3.29, 3.24, 3.24, 3.23, 3.21, 3.21, 3.3, 3.35, 3.28, 3.29, 3.22, 3.27, 3.28, 3.35, 3.4, 3.36, 3.29, 3.23, 3.28, 3.32, 3.42, 3.51, 3.37, 3.41, 3.43, 3.37, 3.41, 3.48, 3.5, 3.44, 3.45, 3.4, 3.37, 3.36, 3.75, 3.87, 3.52, 3.44, 3.42, 3.38, 3.35, 3.68, 3.77, 3.47, 3.35, 3.35, 3.33, 3.32, 3.71, 3.79, 3.44, 3.37, 3.33, 3.3, 3.29, 3.54, 3.55, 3.32], "ret": [0.2949, 0.2991, 0.3075, 0.3074, 0.2975, 0.2698, 0.2948, 0.2938, 0.2987, 0.3054, 0.3036, 0.3035, 0.2768, 0.3035, 0.2992, 0.306, 0.3031, 0.3088, 0.3037, 0.2707, 0.2983, 0.3029, 0.3004, 0.3052, 0.3017, 0.3002, 0.2711, 0.2943, 0.2937, 0.298, 0.303, 0.2959, 0.2977, 0.2694, 0.2916, 0.2848, 0.2901, 0.2956, 0.3, 0.3001, 0.2669, 0.2987, 0.2987, 0.3025, 0.3049, 0.3061, 0.3037, 0.2816, 0.2974, 0.2895, 0.2885, 0.2965, 0.2975, 0.2974, 0.2784, 0.296, 0.3033, 0.3023, 0.3059, 0.3124, 0.3116, 0.2736, 0.2914, 0.3095, 0.3139, 0.3193, 0.3203, 0.3236, 0.2975, 0.316, 0.314, 0.3121, 0.3187, 0.3138, 0.3206, 0.3007, 0.3159, 0.316, 0.3215, 0.3166, 0.3178, 0.3296, 0.2994, 0.3083, 0.3106, 0.3142, 0.3127, 0.3141, 0.3259, 0.2906, 0.3028]}};(function(){if(typeof Chart==='undefined')return;const _ll={id:'_ll',afterDatasetsDraw(ch,a,o){const {ctx}=ch;const ds=ch.data.datasets[0];const meta=ch.getDatasetMeta(0);const li=ds.data.map((v,i)=>v!=null?i:-1).filter(i=>i>=0).pop();if(li==null||li<0)return;const p=meta.data[li];if(!p)return;ctx.save();ctx.fillStyle=ds.borderColor;ctx.font='700 10px "DM Mono"';ctx.textAlign='left';ctx.fillText(o.fmt?o.fmt(ds.data[li]):ds.data[li],p.x+4,p.y);ctx.restore();}};

if(window.WEEKLY_LIVE_CONFIG)return;
function linTrend(data){const pts=data.map((v,i)=>[i,v]).filter(p=>p[1]!=null);if(pts.length<2)return data.map(()=>null);const n=pts.length;let sx=0,sy=0,sxy=0,sxx=0;pts.forEach(([x,y])=>{sx+=x;sy+=y;sxy+=x*y;sxx+=x*x;});const denom=(n*sxx-sx*sx);const slope=denom!==0?(n*sxy-sx*sy)/denom:0;const intercept=(sy-slope*sx)/n;const first=pts[0][0],last=pts[pts.length-1][0];return data.map((v,i)=>(i>=first&&i<=last)?slope*i+intercept:null);}
function al(id,data,fy,color,lf){const el=document.getElementById(id);if(!el)return;const dsets=[{data:data,borderColor:color,backgroundColor:color+'22',tension:.3,borderWidth:1.5,pointRadius:0,fill:true,spanGaps:true,order:2},{data:linTrend(data),borderColor:'#edf2ff',borderWidth:1.75,borderDash:[6,3],pointRadius:0,fill:false,tension:0,spanGaps:true,order:1,_noLabel:true}];new Chart(el,{type:'line',data:{labels:AD.labels,datasets:dsets},options:{maintainAspectRatio:false,responsive:true,layout:{padding:{right:34}},plugins:{legend:{display:false},_ll:{fmt:lf}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{color:'#a6b8d4',font:{size:8},callback:fy,maxTicksLimit:5}},x:{grid:{display:false},ticks:{color:'#a6b8d4',font:{size:7},maxRotation:0,autoSkip:true,maxTicksLimit:5}}},animation:false},plugins:[_ll]});}[['ios','iOS'],['and','Android']].forEach(([pre,p])=>{al(pre+'AnDau',AD[p].dau,v=>(v/1000).toFixed(0)+'K','#4d9fff',v=>(v/1000).toFixed(0)+'K');al(pre+'AnInstall',AD[p].install,v=>(v/1000).toFixed(0)+'K','#00e5c3',v=>(v/1000).toFixed(0)+'K');al(pre+'AnSes',AD[p].sessions,v=>v.toFixed(1),'#ffb800',v=>v.toFixed(1));al(pre+'AnRet',AD[p].ret.map(x=>x==null?null:x*100),v=>v.toFixed(0)+'%','#a78bfa',v=>v.toFixed(1)+'%');});})();

/* --- from weekly_report.html · block 01864ca974 --- */
function showTab(t){document.getElementById('tab-report').classList.toggle('hidden',t!=='report');document.getElementById('tab-analytics').classList.toggle('hidden',t!=='analytics');document.getElementById('btn-report').classList.toggle('active',t==='report');document.getElementById('btn-analytics').classList.toggle('active',t==='analytics');window.scrollTo(0,0);}

/* --- from weekly_report.html · block f7bef454e3 --- */
const AD2={"labels": ["07 Apr", "08 Apr", "09 Apr", "10 Apr", "11 Apr", "12 Apr", "13 Apr", "14 Apr", "15 Apr", "16 Apr", "17 Apr", "18 Apr", "19 Apr", "20 Apr", "21 Apr", "22 Apr", "23 Apr", "24 Apr", "25 Apr", "26 Apr", "27 Apr", "28 Apr", "29 Apr", "30 Apr", "01 May", "02 May", "03 May", "04 May", "05 May", "06 May", "07 May", "08 May", "09 May", "10 May", "11 May", "12 May", "13 May", "14 May", "15 May", "16 May", "17 May", "18 May", "19 May", "20 May", "21 May", "22 May", "23 May", "24 May", "25 May", "26 May", "27 May", "28 May", "29 May", "30 May", "31 May", "01 Jun", "02 Jun", "03 Jun", "04 Jun", "05 Jun", "06 Jun", "07 Jun", "08 Jun", "09 Jun", "10 Jun", "11 Jun", "12 Jun", "13 Jun", "14 Jun", "15 Jun", "16 Jun", "17 Jun", "18 Jun", "19 Jun", "20 Jun", "21 Jun", "22 Jun", "23 Jun", "24 Jun", "25 Jun", "26 Jun", "27 Jun", "28 Jun", "29 Jun", "30 Jun", "01 Jul", "02 Jul", "03 Jul", "04 Jul", "05 Jul", "06 Jul"], "iOS": {"pt_d0": [1993.2, 1991.1, 1936.8, 1902.2, 1910.9, 2038.0, 1957.1, 1904.9, 1857.3, 1843.0, 1834.6, 1920.7, 1995.5, 1920.8, 1952.6, 1876.5, 1924.9, 1811.0, 1835.5, 1936.1, 1845.7, 1885.6, 1930.6, 1803.3, 1866.2, 1907.1, 1958.4, 1917.6, 1893.3, 1839.6, 1765.7, 1761.2, 1813.9, 1850.7, 1878.9, 1808.5, 1814.5, 1784.9, 1749.7, 1807.4, 1907.9, 1839.8, 1833.2, 1827.4, 1785.0, 1763.2, 1777.5, 1878.3, 1807.2, 1769.2, 1724.5, 1762.8, 1758.9, 1784.1, 1828.9, 1754.4, 1805.0, 1762.1, 1780.5, 1784.4, 1853.7, 1940.0, 1828.5, 1825.7, 1781.5, 1755.8, 1751.8, 1890.3, 2021.0, 1815.1, 1787.4, 1768.3, 1751.6, 1774.1, 1895.1, 1889.2, 1794.2, 1741.9, 1735.6, 1702.4, 1679.2, 1808.9, 1851.5, 1723.0, 1698.2, 1644.3, 1665.7, 1626.2, 1726.5, 1794.8, 1698.8], "pt_avg": [1964.8, 1941.5, 1892.0, 1826.2, 1832.5, 1944.1, 1906.8, 1892.5, 1857.0, 1806.1, 1769.4, 1818.4, 1944.7, 1901.3, 1913.2, 1876.8, 1832.9, 1758.4, 1776.6, 1906.9, 1874.2, 1864.6, 1832.4, 1721.0, 1714.4, 1776.3, 1883.6, 1873.1, 1849.0, 1835.2, 1776.9, 1722.7, 1742.2, 1829.0, 1851.0, 1877.8, 1847.9, 1827.4, 1761.0, 1792.1, 1890.9, 1877.6, 1880.3, 1872.9, 1815.8, 1743.2, 1720.8, 1807.7, 1807.7, 1770.2, 1722.7, 1738.9, 1727.6, 1706.1, 1774.2, 1753.6, 1793.5, 1795.3, 1780.0, 1740.8, 1923.7, 2132.6, 1913.3, 1824.5, 1784.3, 1748.5, 1730.8, 1991.1, 2140.4, 1903.5, 1801.4, 1759.8, 1743.7, 1709.0, 1990.1, 2069.3, 1868.5, 1770.5, 1728.6, 1666.5, 1629.0, 1871.4, 1972.9, 1783.4, 1680.1, 1642.5, 1634.5, 1612.0, 1824.1, 1909.8, 1739.4], "sl_d0": [444.9, 447.2, 435.0, 440.1, 443.1, 450.9, 442.8, 437.7, 436.9, 433.8, 427.8, 443.0, 445.2, 435.7, 438.7, 436.3, 428.8, 433.2, 435.0, 438.6, 429.1, 436.7, 443.4, 423.8, 429.5, 430.0, 431.0, 426.3, 426.9, 420.0, 414.8, 411.5, 420.4, 426.3, 432.1, 401.1, 429.7, 426.6, 414.9, 421.5, 427.8, 432.0, 425.7, 426.6, 425.9, 419.3, 427.9, 434.1, 430.5, 418.5, 416.8, 416.0, 418.4, 413.4, 416.4, 415.4, 420.2, 415.4, 417.2, 419.0, 425.5, 437.9, 426.7, 427.8, 423.3, 423.3, 426.2, 435.2, 439.1, 431.1, 438.6, 433.6, 427.6, 434.3, 428.4, 424.2, 425.4, 424.1, 421.2, 414.0, 411.3, 415.4, 419.7, 415.6, 419.9, 420.6, 423.4, 407.8, 407.1, 416.1, 420.8], "shop_lv": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], "shop_e": [64.83, 55.26, 39.74, 29.63, 23.09, 19.07, 16.06, 13.7, 11.85, 10.25, 8.8, 7.55, 6.47, 5.46, 4.62, 3.85, 3.2, 2.64, 2.2, 1.82, 1.49, 1.23, 1.02, 0.85, 0.7, 0.58, 0.49, 0.41, 0.35], "shop_ep": [67.59, 57.3, 41.2, 30.33, 23.34, 19.14, 16.15, 13.78, 11.91, 10.25, 8.78, 7.45, 6.32, 5.3, 4.4, 3.58, 2.94, 2.36, 1.94, 1.57, 1.27, 1.02, 0.82, 0.67, 0.54, 0.46, 0.38, 0.31, 0.26], "day_d": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50], "day_e": [52.93, 34.7, 26.52, 22.0, 19.0, 16.83, 15.13, 13.69, 12.48, 11.41, 10.48, 9.65, 8.85, 8.15, 7.51, 6.88, 6.33, 5.82, 5.4, 5.01, 4.61, 4.26, 3.94, 3.64, 3.37, 3.11, 2.9, 2.67, 2.48, 2.32, 2.16, 2.01, 1.88, 1.75, 1.62, 1.52, 1.43, 1.34, 1.25, 1.17, 1.09, 1.01, 0.96, 0.91, 0.85, 0.8, 0.76, 0.72, 0.67, 0.63], "day_ep": [55.25, 36.15, 27.39, 22.58, 19.53, 17.33, 15.57, 14.12, 12.89, 11.76, 10.81, 9.92, 9.12, 8.42, 7.73, 7.09, 6.53, 5.99, 5.51, 5.05, 4.68, 4.29, 3.96, 3.64, 3.37, 3.12, 2.89, 2.69, 2.5, 2.31, 2.13, 1.97, 1.83, 1.72, 1.6, 1.49, 1.39, 1.3, 1.21, 1.14, 1.07, 1.0, 0.94, 0.89, 0.84, 0.78, 0.73, 0.69, 0.65, 0.62], "ftue": [42.25, 42.57, 41.08, 40.58, 40.98, 42.66, 41.85, 41.13, 40.51, 40.47, 40.12, 41.19, 42.55, 41.45, 42.55, 41.04, 40.82, 39.38, 40.22, 40.99, 40.18, 40.56, 41.24, 39.5, 40.92, 41.53, 46.33, 48.28, 48.08, 47.86, 46.14, 45.61, 46.68, 48.11, 48.53, 45.12, 46.46, 46.2, 45.12, 43.35, 44.04, 42.95, 42.49, 42.17, 42.14, 40.53, 42.08, 43.2, 43.41, 41.83, 41.41, 42.3, 41.95, 42.55, 43.18, 42.89, 42.64, 42.41, 42.91, 42.36, 42.49, 43.63, 43.4, 43.77, 42.88, 42.02, 41.78, 42.55, 44.08, 42.56, 42.54, 42.19, 41.65, 41.82, 42.24, 42.14, 43.32, 43.02, 41.81, 40.65, 40.06, 40.3, 41.75, 41.68, 41.11, 40.58, 40.05, 38.89, 38.41, 39.94, 40.71]}, "Android": {"pt_d0": [1080.5, 1090.3, 1116.4, 1113.3, 1143.3, 1182.7, 1089.9, 1094.3, 1104.1, 1081.4, 1101.3, 1173.8, 1208.3, 1112.5, 1145.7, 1103.7, 1135.4, 1142.7, 1182.5, 1206.7, 1138.4, 1129.4, 1143.4, 1126.0, 1200.4, 1216.9, 1242.6, 1179.5, 1155.9, 1156.6, 1111.2, 1073.2, 1138.7, 1136.2, 1090.8, 1006.3, 1064.2, 1078.4, 1082.2, 1145.3, 1149.1, 1067.8, 1095.0, 1082.2, 1080.5, 1061.3, 1129.0, 1127.4, 1070.0, 1040.7, 1033.6, 1082.9, 1093.0, 1135.4, 1149.6, 1068.4, 1059.4, 1037.1, 1042.4, 1054.4, 1117.9, 1107.2, 1060.7, 1084.0, 1061.8, 1052.6, 1035.5, 1146.4, 1149.5, 1054.7, 1047.3, 1060.8, 1049.9, 1067.5, 1142.6, 1137.8, 1051.5, 1036.9, 1071.6, 1052.0, 1060.7, 1160.4, 1105.4, 1030.0, 1066.2, 1050.1, 1037.8, 1033.5, 1086.2, 1040.1, 1017.0], "pt_avg": [1306.0, 1295.8, 1304.5, 1283.9, 1296.0, 1337.4, 1284.8, 1309.6, 1290.4, 1258.7, 1260.5, 1308.2, 1355.7, 1303.5, 1302.1, 1287.4, 1281.1, 1277.1, 1302.5, 1346.2, 1311.4, 1302.0, 1298.6, 1260.3, 1299.4, 1354.9, 1394.4, 1358.2, 1340.3, 1319.8, 1296.3, 1262.7, 1290.5, 1306.4, 1292.5, 1250.2, 1264.5, 1264.8, 1248.9, 1281.4, 1301.4, 1260.9, 1272.4, 1271.0, 1255.0, 1245.8, 1276.5, 1290.8, 1253.2, 1230.3, 1189.3, 1231.5, 1250.9, 1273.0, 1295.7, 1219.9, 1233.7, 1230.7, 1209.1, 1180.0, 1190.4, 1205.3, 1190.0, 1204.1, 1177.1, 1162.9, 1152.8, 1325.9, 1352.1, 1203.4, 1160.6, 1085.0, 1122.9, 1128.2, 1280.8, 1314.7, 1176.3, 1131.2, 1152.8, 1130.5, 1129.9, 1280.2, 1273.9, 1156.1, 1148.4, 1134.2, 1127.5, 1123.9, 1239.1, 1233.9, 1142.0], "sl_d0": [375.0, 379.9, 385.4, 387.8, 395.2, 401.8, 386.1, 386.9, 390.1, 389.2, 392.2, 410.4, 414.7, 399.5, 404.2, 397.7, 403.9, 403.7, 415.7, 416.7, 406.8, 408.5, 412.4, 414.0, 431.1, 432.8, 432.0, 425.6, 420.4, 418.6, 411.1, 406.1, 414.1, 412.0, 407.5, 370.9, 399.3, 401.0, 402.9, 415.0, 409.2, 391.5, 395.5, 401.3, 393.1, 389.4, 400.9, 397.8, 382.9, 378.0, 374.5, 384.7, 388.1, 387.1, 384.6, 377.6, 374.1, 365.5, 371.2, 365.7, 382.1, 374.1, 366.8, 376.5, 373.4, 380.6, 371.3, 390.0, 377.6, 367.2, 364.9, 366.4, 366.3, 376.6, 386.3, 381.7, 370.9, 376.5, 390.6, 386.1, 390.5, 397.9, 388.7, 382.9, 388.2, 387.4, 383.3, 378.5, 385.3, 378.5, 388.8], "shop_lv": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30], "shop_e": [48.35, 38.04, 22.93, 15.28, 11.04, 8.48, 6.7, 5.37, 4.36, 3.54, 2.9, 2.38, 1.94, 1.58, 1.29, 1.03, 0.83, 0.67, 0.55, 0.44, 0.35, 0.28, 0.23, 0.19, 0.15, 0.13, 0.11, 0.09, 0.08], "shop_ep": [48.82, 38.61, 23.91, 16.13, 11.56, 8.81, 6.92, 5.52, 4.44, 3.61, 2.93, 2.38, 1.94, 1.56, 1.26, 1.01, 0.81, 0.64, 0.53, 0.42, 0.34, 0.27, 0.22, 0.18, 0.14, 0.12, 0.1, 0.09, 0.07], "day_d": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50], "day_e": [39.48, 21.86, 15.01, 11.63, 9.54, 8.09, 6.99, 6.13, 5.43, 4.84, 4.32, 3.89, 3.51, 3.18, 2.88, 2.62, 2.37, 2.17, 1.98, 1.81, 1.65, 1.51, 1.38, 1.26, 1.16, 1.07, 0.99, 0.91, 0.83, 0.77, 0.72, 0.66, 0.61, 0.56, 0.52, 0.48, 0.45, 0.42, 0.39, 0.36, 0.34, 0.32, 0.3, 0.27, 0.26, 0.25, 0.23, 0.21, 0.2, 0.19], "day_ep": [40.03, 22.63, 15.67, 12.13, 9.97, 8.43, 7.26, 6.37, 5.64, 5.02, 4.48, 4.03, 3.62, 3.26, 2.96, 2.67, 2.41, 2.19, 1.99, 1.82, 1.65, 1.51, 1.38, 1.26, 1.15, 1.05, 0.97, 0.89, 0.81, 0.75, 0.69, 0.64, 0.59, 0.54, 0.5, 0.47, 0.43, 0.4, 0.37, 0.35, 0.32, 0.3, 0.28, 0.26, 0.24, 0.23, 0.21, 0.2, 0.19, 0.18], "ftue": [26.72, 26.5, 26.41, 26.47, 27.23, 27.8, 25.82, 25.55, 26.07, 26.36, 26.63, 28.27, 29.34, 27.41, 27.99, 27.82, 28.05, 28.39, 29.8, 30.06, 28.51, 29.2, 29.16, 30.81, 33.28, 33.85, 34.38, 32.62, 31.97, 31.39, 30.11, 28.74, 30.34, 30.59, 28.7, 25.79, 27.02, 27.51, 27.75, 29.59, 29.51, 27.49, 27.49, 27.59, 27.36, 27.27, 28.72, 28.7, 27.48, 26.54, 26.16, 27.45, 27.25, 28.58, 28.43, 26.24, 25.89, 25.32, 24.68, 23.9, 25.37, 25.67, 25.27, 26.53, 25.47, 25.48, 24.37, 25.67, 26.23, 24.91, 25.1, 25.35, 24.52, 25.28, 26.39, 26.49, 25.29, 25.06, 25.62, 24.95, 24.98, 26.61, 25.28, 24.38, 24.58, 24.56, 24.39, 24.23, 24.92, 23.51, 23.77]}};
(function(){if(typeof Chart==='undefined'||window.WEEKLY_LIVE_CONFIG)return;
function linTrend(data){const pts=data.map((v,i)=>[i,v]).filter(p=>p[1]!=null);if(pts.length<2)return data.map(()=>null);const n=pts.length;let sx=0,sy=0,sxy=0,sxx=0;pts.forEach(([x,y])=>{sx+=x;sy+=y;sxy+=x*y;sxx+=x*x;});const denom=(n*sxx-sx*sx);const slope=denom!==0?(n*sxy-sx*sy)/denom:0;const intercept=(sy-slope*sx)/n;const first=pts[0][0],last=pts[pts.length-1][0];return data.map((v,i)=>(i>=first&&i<=last)?slope*i+intercept:null);}
// last-value label plugin
const lastLabel={id:'lastLabel',afterDatasetsDraw(ch,args,opts){const {ctx}=ch;ch.data.datasets.forEach((ds,di)=>{if(ds._noLabel)return;const meta=ch.getDatasetMeta(di);const pts=meta.data.filter((p,i)=>ds.data[i]!=null);if(!pts.length)return;const last=pts[pts.length-1];const li=ds.data.map((v,i)=>v!=null?i:-1).filter(i=>i>=0).pop();ctx.save();ctx.fillStyle=ds.borderColor;ctx.font='400 12.5px Poppins,system-ui,sans-serif';ctx.textAlign='left';const val=ds.data[li];ctx.fillText((opts.fmt?opts.fmt(val):val),last.x+4,last.y);ctx.restore();});}};
function tline(id,datasets,fmtY,fmtLbl){const el=document.getElementById(id);if(!el)return;new Chart(el,{type:'line',data:{labels:AD2.labels,datasets:datasets},options:{maintainAspectRatio:false,responsive:true,layout:{padding:{right:34}},plugins:{legend:{display:datasets.length>1,position:'bottom',labels:{boxWidth:8,font:{size:8},color:'#a6b8d4'}},lastLabel:{fmt:fmtLbl}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{color:'#a6b8d4',font:{size:8},callback:fmtY,maxTicksLimit:5}},x:{grid:{display:false},ticks:{color:'#a6b8d4',font:{size:7},maxRotation:0,autoSkip:true,maxTicksLimit:5}}},animation:false},plugins:[lastLabel]});}
function dist(id,labels,cur,prev,markIdx,fmtLbl){const el=document.getElementById(id);if(!el)return;
 const mark={id:'mark',afterDatasetsDraw(ch){const {ctx}=ch;const mi=labels.indexOf(markIdx);if(mi<0)return;const meta=ch.getDatasetMeta(0);const p=meta.data[mi];if(!p)return;ctx.save();ctx.fillStyle='#ffb800';ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,7);ctx.fill();ctx.font='400 12.5px Poppins,system-ui,sans-serif';ctx.textAlign='center';ctx.fillText(fmtLbl(cur[mi]),p.x,p.y-8);ctx.restore();}};
 new Chart(el,{type:'line',data:{labels:labels,datasets:[{label:'Current',data:cur,borderColor:'#4d9fff',backgroundColor:'#4d9fff22',tension:.3,borderWidth:2,pointRadius:0,fill:true},{label:'Prev window',data:prev,borderColor:'#7589a8',borderWidth:1.5,borderDash:[4,3],pointRadius:0,fill:false,_noLabel:true}]},options:{maintainAspectRatio:false,responsive:true,plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:8,font:{size:8},color:'#a6b8d4'}}},scales:{y:{beginAtZero:true,grid:{color:'rgba(255,255,255,.06)'},ticks:{color:'#a6b8d4',font:{size:8},callback:v=>v+'%',maxTicksLimit:5}},x:{grid:{display:false},ticks:{color:'#a6b8d4',font:{size:7},maxTicksLimit:8}}},animation:false},plugins:[mark]});}
['iOS','Android'].forEach(p=>{const pre=p==='iOS'?'ios':'and';const A=AD2[p];
 tline(pre+'PlaytimeD0',[{label:'Daily',data:A.pt_d0,borderColor:'#00e5c3',backgroundColor:'#00e5c322',tension:.3,borderWidth:1.5,pointRadius:0,fill:true,order:2},{label:'Trend',data:linTrend(A.pt_d0),borderColor:'#edf2ff',borderWidth:1.75,borderDash:[6,3],pointRadius:0,fill:false,tension:0,order:1,_noLabel:true}],v=>v+'s',v=>Math.round(v)+'s');
 tline(pre+'PlaytimeAvg',[{label:'Daily',data:A.pt_avg,borderColor:'#4d9fff',backgroundColor:'#4d9fff22',tension:.3,borderWidth:1.5,pointRadius:0,fill:true,order:2},{label:'Trend',data:linTrend(A.pt_avg),borderColor:'#edf2ff',borderWidth:1.75,borderDash:[6,3],pointRadius:0,fill:false,tension:0,order:1,_noLabel:true}],v=>v+'s',v=>Math.round(v)+'s');
 tline(pre+'SessLen',[{label:'Daily',data:A.sl_d0,borderColor:'#ffb800',backgroundColor:'#ffb80022',tension:.3,borderWidth:1.5,pointRadius:0,fill:true,order:2},{label:'Trend',data:linTrend(A.sl_d0),borderColor:'#edf2ff',borderWidth:1.75,borderDash:[6,3],pointRadius:0,fill:false,tension:0,order:1,_noLabel:true}],v=>v+'s',v=>Math.round(v)+'s');
 tline(pre+'Ftue',[{label:'Daily',data:A.ftue,borderColor:'#a78bfa',backgroundColor:'#a78bfa22',tension:.3,borderWidth:1.5,pointRadius:0,fill:true,order:2},{label:'Trend',data:linTrend(A.ftue),borderColor:'#edf2ff',borderWidth:1.75,borderDash:[6,3],pointRadius:0,fill:false,tension:0,order:1,_noLabel:true}],v=>v+'%',v=>v.toFixed(0)+'%');
});
})();

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
