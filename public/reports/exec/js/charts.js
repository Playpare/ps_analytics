function renderAll(){
  renderKPIs();
  renderDaily();
  renderProjected();
  renderMonthly();
  renderTargetChart();
  renderAlerts();
  renderGameAnalysis();
}

/* =========================
   KPIs
========================= */
function aggData(data){ return data.reduce((a,r)=>({rev:a.rev+r.revenue,spd:a.spd+r.spend,pro:a.pro+r.profit}),{rev:0,spd:0,pro:0}); }

function renderKPIs(){
  const c=aggData(filteredData), p=aggData(prevPeriodData);
  const cRoi=c.spd>0?+(c.rev/c.spd).toFixed(2):0;
  const pRoi=p.spd>0?+(p.rev/p.spd).toFixed(2):0;

  setKPI('kRevVal','kRevChg','kRevPrev', c.rev, p.rev, true);
  setKPI('kSpdVal','kSpdChg','kSpdPrev', c.spd, p.spd, false);
  setKPI('kProVal','kProChg','kProPrev', c.pro, p.pro, true);
  setROIKPI(cRoi, pRoi);

  // Daily Avg footer is FIXED to the last 14 days of data (recent run-rate),
  // independent of the selected date range. The active game/platform filter
  // still applies so the avg matches whatever the cards are scoped to.
  const _gm = g('fGame')?.value || '', _pl = g('fPlat')?.value || '';
  const _yd14 = new Date(); _yd14.setDate(_yd14.getDate()-1); _yd14.setHours(0,0,0,0);
  const _ydStr14 = isoDate(_yd14);
  const _cap14 = (window._dataLastDate && window._dataLastDate < _ydStr14) ? window._dataLastDate : _ydStr14;
  const _fromD = new Date(_cap14+'T00:00:00'); _fromD.setDate(_fromD.getDate()-13);
  const _from14 = isoDate(_fromD);   // 14-day inclusive window ending at the data cap
  const last14 = rawData.filter(r => r.date && r.date>=_from14 && r.date<=_cap14
                                   && (!_gm||r.game===_gm) && (!_pl||r.platform===_pl));
  const a14 = aggData(last14);
  const days14 = new Set(last14.map(r=>r.date)).size || 1;
  const kRevDay=g('kRevDay'), kSpdDay=g('kSpdDay'), kProDay=g('kProDay'), kRoiTgt=g('kRoiTgt');
  kRevDay.textContent=fmFull(Math.round(a14.rev/days14));
  kSpdDay.textContent=fmFull(Math.round(a14.spd/days14));
  kProDay.textContent=fmFull(Math.round(a14.pro/days14));
  kRoiTgt.textContent=fr2(TARGETS.roiAlert||1.20);

  // Aggregate by date for sparklines (multiple games per day)
  const sparkByDate={};
  filteredData.forEach(r=>{
    if(!sparkByDate[r.date])sparkByDate[r.date]={rev:0,spd:0,pro:0};
    sparkByDate[r.date].rev+=r.revenue;
    sparkByDate[r.date].spd+=r.spend;
    sparkByDate[r.date].pro+=r.profit;
  });
  const sparkDates=Object.keys(sparkByDate).sort();
  const sparkRoi=sparkDates.map(d=>sparkByDate[d].spd>0?+(sparkByDate[d].rev/sparkByDate[d].spd).toFixed(3):null).filter(v=>v!==null);
  // Draw spark charts with hover tooltips
  requestAnimationFrame(()=>{
    spark('spRev', sparkDates.map(d=>sparkByDate[d].rev), sparkDates, '#4d9fff', v=>fmFull(v));
    spark('spSpd', sparkDates.map(d=>sparkByDate[d].spd), sparkDates, '#ff4d6d', v=>fmFull(v));
    spark('spPro', sparkDates.map(d=>sparkByDate[d].pro), sparkDates, '#00e5c3', v=>fmFull(v));
    spark('spRoi', sparkRoi, sparkDates.slice(0,sparkRoi.length), '#ffb800', v=>'ROI: '+v.toFixed(3));
  });
}

function setKPI(valId,chgId,prevId,curr,prev,upGood){
  const valEl=g(valId), chgEl=g(chgId), prevEl=g(prevId);
  valEl.textContent=fmFull(curr);
  if(prev>0){
    const pct=(curr-prev)/prev*100, up=pct>=0, good=upGood?up:!up;
    chgEl.textContent=(up?'▲':'▼')+' '+Math.abs(pct).toFixed(1)+'%';
    chgEl.className='kpiChg '+(good?'up':'dn');
    prevEl.textContent='Prev: '+fmFull(prev);
  } else {
    chgEl.textContent='No prev data'; chgEl.className='kpiChg neu'; prevEl.textContent='';
  }
}
function setROIKPI(curr,prev){
  const thr=TARGETS.roiAlert||1.20;
  const valEl=g('kRoiVal'), chgEl=g('kRoiChg'), prevEl=g('kRoiPrev');
  valEl.textContent=curr.toFixed(2);
  if(prev>0){
    const diff=curr-prev, up=diff>=0;
    chgEl.textContent=(up?'▲':'▼')+' '+Math.abs(diff).toFixed(3);
    chgEl.className='kpiChg '+(up?'up':'dn');
    prevEl.textContent='Prev: '+fr2(prev);
  } else {
    chgEl.textContent=curr>=thr?'✓ Above Target':'⚠ Below Target';
    chgEl.className='kpiChg '+(curr>=thr?'up':'dn');
    prevEl.textContent='';
  }
}

// Spark charts store - keyed by canvas id
const sparkCharts={};

function spark(id,vals,dates,color,labelFmt){
  const canvas=g(id);if(!canvas||vals.length<2)return;
  if(sparkCharts[id]){sparkCharts[id].destroy();delete sparkCharts[id];}

  let dVals=vals, dDates=dates||[];
  if(vals.length>60){
    const step=Math.ceil(vals.length/60);
    dVals=[]; dDates=[];
    for(let i=0;i<vals.length;i+=step){
      const chunk=vals.slice(i,i+step);
      dVals.push(chunk.reduce((a,b)=>a+b,0)/chunk.length);
      if(dates&&dates[i]) dDates.push(dates[i]);
    }
  }

  const hasNeg=dVals.some(v=>v<0);
  const mn=hasNeg?Math.min(...dVals)*1.1:0;

  const ctx=canvas.getContext('2d');
  // Use container height for gradient
  const boxH=canvas.parentElement?.offsetHeight||80;
  const grad=ctx.createLinearGradient(0,0,0,boxH);
  grad.addColorStop(0,color+'99');
  grad.addColorStop(0.6,color+'44');
  grad.addColorStop(1,color+'00');

  sparkCharts[id]=new Chart(canvas,{
    type:'line',
    data:{
      labels:dDates.length?dDates.map(d=>fmtLbl(d)):dVals.map((_,i)=>i),
      datasets:[{
        data:dVals,
        borderColor:color,
        backgroundColor:grad,
        borderWidth:1.8,
        pointRadius:0,
        pointHoverRadius:4,
        pointHoverBackgroundColor:color,
        pointHoverBorderColor:'#fff',
        pointHoverBorderWidth:2,
        fill:true,
        tension:0.4
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{
          enabled:true,
          backgroundColor:'rgba(10,18,32,0.92)',
          borderColor:color,
          borderWidth:1,
          padding:8,
          titleFont:{family:'Poppins',size:10,weight:'600'},
          bodyFont:{family:'DM Mono',size:12},
          titleColor:'#7a8fad',
          bodyColor:color,
          callbacks:{
            title:items=>{
              const i=items[0].dataIndex;
              return dDates[i]?fmtLbl(dDates[i]):'';
            },
            label:item=>{
              const v=item.parsed.y;
              return labelFmt ? labelFmt(v) : fmFull(v);
            }
          }
        }
      },
      scales:{
        x:{display:false},
        y:{display:false, min:mn}
      }
    }
  });
}

/* =========================
   DAILY CHART (with weekend highlights + rich tooltip)
========================= */
// Weekend highlight plugin
const weekendPlugin = {
  id:'weekends',
  beforeDraw(chart){
    const {ctx,chartArea,scales:{x}}=chart;
    if(!x||!chartArea||!chart._dateMap) return;
    const {top,bottom}=chartArea;
    chart.data.labels.forEach((lbl,i)=>{
      const date=chart._dateMap[i];
      if(!date) return;
      const dt=new Date(date+'T00:00:00');
      const day=dt.getDay();
      if(day===0||day===6){
        const xPx=x.getPixelForValue(i);
        const bw=Math.max(Math.abs((x.getPixelForValue(1)||0)-(x.getPixelForValue(0)||0)),8);
        ctx.save();
        ctx.fillStyle=isLight?'rgba(0,0,0,.04)':'rgba(255,255,255,.04)';
        ctx.fillRect(xPx-bw/2,top,bw,bottom-top);
        ctx.restore();
      }
    });
  }
};

Chart.register(weekendPlugin);

// --- ROAS data match with date array ---
function buildRoasArray(dates, platform, field) {
  if (!roasData || !roasData.length || !dates || !dates.length) return [];
  
  var roasMap = {};
  roasData.forEach(function(r) {
    if (platform && r.plat !== platform) return;
    var val = r[field];
    if (val !== null && val !== undefined && !isNaN(Number(val))) {
      if (!roasMap[r.date]) roasMap[r.date] = [];
      roasMap[r.date].push(Number(val));
    }
  });
  
  return dates.map(function(d) {
    var arr = roasMap[d];
    if (!arr || !arr.length) return null;
    var sum = arr.reduce(function(a, b) { return a + b; }, 0);
    return Math.round((sum / arr.length) * 10000) / 10000;
  });
}

function renderDaily(){
  const byDate={};
  filteredData.forEach(r=>{
    if(!byDate[r.date])byDate[r.date]={rev:0,spd:0,pro:0};
    byDate[r.date].rev+=r.revenue;byDate[r.date].spd+=r.spend;byDate[r.date].pro+=r.profit;
  });
  const dates=Object.keys(byDate).sort();
  const labels=dates.map(d=>fmtLbl(d));
  const rois=dates.map(d=>byDate[d].spd>0?+(byDate[d].rev/byDate[d].spd).toFixed(3):null);
  const validRois=rois.filter(r=>r!==null);
  const roiMin=0;
  const roiMax=validRois.length?Math.max(...validRois)*1.1:3;

  // -- ROAS arrays (hidden by default) --
  const roasPlatform = g('fPlat')?.value || '';
  const roasD0 = buildRoasArray(dates, roasPlatform, 'd0');
  const roasD7 = buildRoasArray(dates, roasPlatform, 'd7');
  const getVisibleSecondaryAxisMax = chart => {
    const values = [];
    chart.data.datasets.forEach((ds, idx) => {
      if(ds.yAxisID !== 'y2') return;
      const meta = chart.getDatasetMeta(idx);
      const visible = meta.hidden == null ? !ds.hidden : !meta.hidden;
      if(!visible) return;
      (ds.data || []).forEach(v => {
        const n = Number(v);
        if(v !== null && v !== undefined && !isNaN(n)) values.push(n);
      });
    });
    return values.length ? Math.max(...values) * 1.1 : 3;
  };

  if(charts.daily)charts.daily.destroy();
  const ch=g('dailyChart').getContext('2d');
  charts.daily=new Chart(ch,{
    type:'bar',
    data:{labels,datasets:[
      {label:'Revenue',data:dates.map(d=>byDate[d].rev),backgroundColor:'rgba(77,159,255,.68)',yAxisID:'y',order:2,borderRadius:2},
      {label:'Spend',  data:dates.map(d=>byDate[d].spd),backgroundColor:'rgba(255,77,109,.68)',yAxisID:'y',order:2,borderRadius:2},
      {label:'Profit', data:dates.map(d=>byDate[d].pro),backgroundColor:'rgba(0,229,195,.72)',  yAxisID:'y',order:2,borderRadius:2},
      {label:'ROI',type:'line',data:rois,borderColor:'#ffb800',backgroundColor:'transparent',
       pointBackgroundColor:'rgba(255,184,0,.45)',pointRadius:3,borderWidth:2.5,yAxisID:'y2',order:1,tension:.38,spanGaps:false},
      // -- ROAS Datasets (HIDDEN by default) --
      {label:'ROAS D0',type:'line',data:roasD0,borderColor:'#8B5CF6',backgroundColor:'rgba(139,92,246,0.15)',
       borderWidth:2,borderDash:[6,3],pointRadius:0,pointHoverRadius:4,yAxisID:'y2',order:3,tension:.35,fill:false,hidden:true},
      {label:'ROAS D7',type:'line',data:roasD7,borderColor:'#14B8A6',backgroundColor:'rgba(20,184,166,0.15)',
       borderWidth:2,borderDash:[6,3],pointRadius:0,pointHoverRadius:4,yAxisID:'y2',order:4,tension:.35,fill:false,hidden:true}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      layout:{padding:{left:4,right:8,top:4,bottom:0}},
      plugins:{
        legend:{labels:{color:tc(),font:{family:'Poppins',size:11},boxWidth:11,padding:12},
          onClick: function(e, item, legend) {
            var index = item.datasetIndex;
            var ci = legend.chart;
            var meta = ci.getDatasetMeta(index);
            meta.hidden = meta.hidden === null ? !ci.data.datasets[index].hidden : null;
            ci.options.scales.y2.max = getVisibleSecondaryAxisMax(ci);
            ci.update();
          }
        },
        tooltip:{
          mode:'index',intersect:false,
          callbacks:{
            title:items=>{
              const i=items[0].dataIndex;
              const date=dates[i];
              const dt=new Date(date+'T00:00:00');
              const dayName=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
              return `${dayName}, ${fmtLbl(date)}`;
            },
            label:ctx=>{
              if(ctx.dataset.label.startsWith('ROAS')) return ` ${ctx.dataset.label}: ${ctx.parsed.y==null?'-':(ctx.parsed.y*100).toFixed(1)+'%'}`;
              if(ctx.dataset.yAxisID==='y2') return ` ROI: ${ctx.parsed.y.toFixed(2)}`;
              return ` ${ctx.dataset.label}: ${fmK(ctx.parsed.y)}`;
            },
            afterBody:items=>{
              const i=items[0].dataIndex;
              const d=byDate[dates[i]];
              const margin=(d.pro/d.rev*100).toFixed(1);
              return[` Margin: ${margin}%`];
            }
          }
        }
      },
      scales:{
        x:{ticks:{color:tc(),font:{size:10,family:'Poppins'},maxRotation:45,padding:4},grid:{display:false},border:{display:false}},
        y:{ticks:{color:tc(),callback:v=>fmK(v),font:{family:'Poppins',size:10},padding:6},grid:{display:false},border:{display:false}},
        y2:{position:'right',min:roiMin,max:roiMax,ticks:{color:'#ffb800',callback:v=>v.toFixed(2),font:{family:'DM Mono',size:10},padding:6},grid:{display:false},border:{display:false}}
      }
    }
  });
  charts.daily._dateMap = Object.fromEntries(dates.map((d,i)=>[i,d]));
}

/*  PROJECTED MONTH END */
/*  MONTH FILTER STATE  */
let projSelectedMonth = ''; // '' = current month
let selectedQuarter = Math.floor(dataNow().getMonth() / 3) + 1; // default = current quarter (yesterday-based, data ke hisab se)

function selectQuarter(q, btnEl) {
  selectedQuarter = q;
  cachedList('qPills','.qPill').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  renderProjected();
}

// Get months in a quarter
function quarterMonths(q, yr) {
  if(q === 0) return Array.from({length:12},(_,i)=>`${yr}-${String(i+1).padStart(2,'0')}`);
  const start = (q-1)*3;
  return [0,1,2].map(i=>`${yr}-${String(start+i+1).padStart(2,'0')}`);
}

// Quarter target = sum of monthly targets for that quarter
function quarterTarget(q, yr) {
  return quarterMonths(q, yr).reduce((s,ym)=>s+(TARGETS.months?.[ym]?.profit||0),0);
}

function completedQuarterCount(yr) {
  const now = dataNow();
  if(now.getFullYear() < yr) return 0;
  if(now.getFullYear() > yr) return 4;
  return [
    new Date(yr, 2, 31),
    new Date(yr, 5, 30),
    new Date(yr, 8, 30),
    new Date(yr, 11, 31)
  ].filter(end => end <= now).length;
}

function buildMonthFilter(){
  const yr = TARGETS.year || CY;
  const now = dataNow();   // yesterday-based - data is a day behind
  // Show months that have data or are current/past
  const available = MONTHS.map((_,i)=>{
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const hasData=rawData.some(r=>r.date&&r.date.startsWith(ym));
    const isPast=i<=now.getMonth()&&yr<=now.getFullYear();
    return{ym,label:MONTHS[i],show:hasData||isPast};
  }).filter(m=>m.show);

  const wrap=g('monthFilterWrap');
  if(!wrap)return;
  // Current month default
  if(!projSelectedMonth) projSelectedMonth=`${yr}-${String(now.getMonth()+1).padStart(2,'0')}`;

  wrap.innerHTML=available.map(m=>`
    <button class="monthPill${projSelectedMonth===m.ym?' active':''}" data-proj-month="${escapeAttr(m.ym)}">
      ${escapeHTML(m.label)}
    </button>`).join('');
}

/*  EXPONENTIAL SMOOTHING PROJECTION  */
function expSmoothingProjection(dailyProfits){
  // Holt's simple exponential smoothing
  // alpha = smoothing factor (0.3 = give more weight to history, 0.7 = recent biased)
  if(!dailyProfits.length) return 0;
  if(dailyProfits.length===1) return dailyProfits[0];

  const alpha=0.35; // balance between history and recent
  let smoothed=dailyProfits[0];
  for(let i=1;i<dailyProfits.length;i++){
    smoothed=alpha*dailyProfits[i]+(1-alpha)*smoothed;
  }
  return smoothed;
}

// Daily-profit series for the most recent 14 days of data (yesterday-based cap).
// This drives the "smart daily" run-rate for ALL projections. A rolling 14-day
// window is steadier than using only the current calendar month (which can be
// just 12 days early in a month). Returns oldest->newest so exp-smoothing
// weights the most recent days highest.
function last14DailyProfits(){
  const yd=new Date(); yd.setDate(yd.getDate()-1); yd.setHours(0,0,0,0);
  const ydStr=isoDate(yd);
  const cap=(window._dataLastDate && window._dataLastDate<ydStr) ? window._dataLastDate : ydStr;
  const from=new Date(cap+'T00:00:00'); from.setDate(from.getDate()-13); // 14-day inclusive
  const fromStr=isoDate(from);
  const byDate={};
  rawData.forEach(r=>{ if(r.date && r.date>=fromStr && r.date<=cap){ byDate[r.date]=(byDate[r.date]||0)+r.profit; } });
  return Object.keys(byDate).sort().map(d=>byDate[d]);
}

function getYearProgressInsight(actual, target) {
  if (target <= 0) {
    return actual > 0 ? { text: `▲ Ahead ${fmK(actual)}`, className: 'pos' } : { text: '● On Track', className: 'hi' };
  }

  const diff = actual - target;
  const tolerance = target * 0.01;
  if (Math.abs(diff) <= tolerance) {
    return { text: '● On Track', className: 'hi' };
  }

  return diff >= 0
    ? { text: `▲ Ahead ${fmK(diff)}`, className: 'pos' }
    : { text: `▼ Behind ${fmK(Math.abs(diff))}`, className: 'neg' };
}

function renderProjected(){
  buildMonthFilter();

  // sync the active pill with selectedQuarter
  cachedList('qPills','.qPill').forEach(b =>
    b.classList.toggle('active', +b.dataset.q === selectedQuarter));

  const yr=TARGETS.year||CY;
  const ym=projSelectedMonth||`${yr}-${String(dataNow().getMonth()+1).padStart(2,'0')}`;
  const [pymYr,pymMo]=ym.split('-').map(Number);
  const mT=TARGETS.months?.[ym]||{profit:350000,roi:1.20};
  const target=mT.profit;

  // All month data aggregated by date
  const monthRows=rawData.filter(r=>r.date&&r.date.startsWith(ym));
  const byDate={};
  monthRows.forEach(r=>{
    if(!byDate[r.date])byDate[r.date]=0;
    byDate[r.date]+=r.profit;
  });
  const sortedDates=Object.keys(byDate).sort();
  const dailyProfits=sortedDates.map(d=>byDate[d]);

  const curProfit=dailyProfits.reduce((s,v)=>s+v,0);
  const dim=new Date(pymYr,pymMo,0).getDate(); // days in month
  const elapsed=sortedDates.length; // actual days with data

  // Smart projection run-rate: exp-smoothing over the LAST 14 DAYS of data
  // (rolling window) rather than only this month's days  steadier projection.
  const series14=last14DailyProfits();
  const smartDailyAvg=expSmoothingProjection(series14);
  const daysLeft=dim-elapsed;
  // A month is COMPLETE/past when our latest data day (yesterday) is on/after its
  // last calendar day -> nothing to project, judge on actuals. On the 1st of a
  // month yesterday is the prior month's last day, so the just-ended month reads
  // as complete (e.g. on 1 Jun, May shows "Achieved/Missed", not "projected").
  const _dn=dataNow();
  const isPastMonth=new Date(pymYr,pymMo,0) <= _dn;          // last day of month  yesterday
  const isCurrentMonth=!isPastMonth && new Date(pymYr,pymMo-1,1) <= _dn; // started but not finished
  const proj=isPastMonth ? curProfit : curProfit+(smartDailyAvg*daysLeft); // past = actual; live = actual + projected remaining
  const pct=target>0?Math.min(proj/target*100,999):0;
  const rem=target-curProfit;
  const reqD=daysLeft>0&&rem>0?rem/daysLeft:0;
  const exceeded=curProfit>=target;

  const projValEl=g('projVal'), projTargetLblEl=g('projTargetLbl'), projPctEl=g('projPct');
  projValEl.textContent=fmFull(Math.round(proj));
  projTargetLblEl.textContent=`Projected vs ${fmFull(target)} target`;
  projPctEl.textContent=pct.toFixed(1)+'% of target';

  // Badge
  const badge=g('projBadge');
  if(isPastMonth){
    // Completed (past) month  judged on actuals: green if hit, red if missed
    const finalPct=target>0?curProfit/target*100:0;
    if(finalPct>=100){badge.textContent='OK Achieved '+finalPct.toFixed(1)+'%';badge.className='projBadge projExceeded';}
    else{badge.textContent='X Missed '+finalPct.toFixed(1)+'%';badge.className='projBadge projOff';}
  } else if(exceeded){
    // Target already hit before month end
    badge.textContent=' Exceeded!';badge.className='projBadge projExceeded';
  } else if(pct>=100){
    // Projected month-end  100% of target
    badge.textContent='On Track';badge.className='projBadge projOntrack';
  } else if(pct>=90){
    // Projected 90-99% of target
    badge.textContent='At Risk';badge.className='projBadge projBehind';
  } else {
    // Projected < 90% of target
    badge.textContent='Off Track';badge.className='projBadge projOff';
  }

  // Progress bar
  const fillPct=target>0?Math.min(curProfit/target*100,100):0;
  const projBarEl=g('projBar'), projMarkerEl=g('projMarker'), projMarkerLblEl=g('projMarkerLbl');
  projBarEl.style.width=fillPct+'%';
  projMarkerEl.style.left='100%';
  projMarkerLblEl.textContent=fmFull(target);

  // Metrics
  g('profitMetLbl').textContent=exceeded?' Profit (Exceeded!)':'Current Profit';
  g('mCurProfit').textContent=fmFull(curProfit);
  g('mCurProfit').className='metVal '+(curProfit>=0?'good':'bad');

  if(exceeded){
    g('remMetLbl').textContent='Exceeded By';
    g('mRemaining').textContent=fmFull(curProfit-target);
    g('mRemaining').className='metVal good';
  } else {
    g('remMetLbl').textContent='Remaining';
    g('mRemaining').textContent=fmFull(Math.max(0,rem));
    g('mRemaining').className='metVal warn';
  }
  g('mDailyAvg').textContent=fmFull(Math.round(smartDailyAvg));
  g('mReqDaily').textContent=reqD>0?fmFull(Math.round(reqD)):'-';
  g('mReqDaily').className='metVal '+(reqD>smartDailyAvg?'bad':'warn');

  // Gap: Smart Daily Avg - Required Daily (explicit, so user doesn't subtract)
  const gapWrap=g('projGapWrap'), gapEl=g('projGap');
  if(gapWrap&&gapEl){
    if(reqD>0){
      const gap=smartDailyAvg-reqD;
      gapWrap.style.display='block';
      gapEl.textContent=(gap>=0?'+':'-')+fmFull(Math.round(Math.abs(gap)))+'/day';
      gapEl.style.color=gap>=0?'var(--green)':'var(--coral)';
    } else {
      gapWrap.style.display='none';
    }
  }

  // Method note
  const noteEl=g('projMethodNote');
  if(noteEl){
    if(isCurrentMonth&&elapsed>0){
      noteEl.textContent=` EXP smoothing (=0.35) on last ${series14.length} days - recent days weighted higher`;
    } else if(!isCurrentMonth){
      noteEl.textContent=elapsed>=dim?`OK Month complete - actual: ${fmFull(curProfit)}`:`${elapsed} of ${dim} days recorded`;
    }
  }

  //  GAUGES  Quarter filter based on selectedQuarter (0=annual, 1-4=Q1-Q4)
  const q = selectedQuarter;
  const qMonths = quarterMonths(q, yr);
  const qLabel = q===0 ? 'Annual GP Target' : `Q${q} GP Target (${MONTHS[(q-1)*3]} - ${MONTHS[Math.min((q-1)*3+2,11)]})`;

  // Quarter: profit from selected quarter's months
  const qProfit = rawData.filter(r=>r.date&&qMonths.includes(r.date.slice(0,7))).reduce((s,r)=>s+r.profit,0);
  const qTarget = q===0 ? computeAutoTargets().annual : quarterTarget(q, yr);

  // Update quarter gauge title
  const qGaugeTitleEl=g('qGaugeTitle');
  if(qGaugeTitleEl) qGaugeTitleEl.textContent = qLabel;

  // Quarter gauge
  gaugeState.q = Math.min(qTarget>0?qProfit/qTarget:0, 2);
  drawGauge('gaugeQ', gaugeState.q, '#00e5c3', null, '$0', fmK(qTarget));
  const gQpctEl=g('gQpct'), gQamtEl=g('gQamt');
  gQpctEl.textContent = (gaugeState.q*100).toFixed(2)+'%';
  gQamtEl.textContent = 'Profit: '+fmK(qProfit);
  const qVar = qProfit - qTarget;
  const gDetailEl=document.querySelector('.gDetail');
  if(gDetailEl) gDetailEl.classList.toggle('yearView', q===0);
  const gQTargetEl=g('gQTarget'), gQAchievedEl=g('gQAchieved'), gQRemainingEl=g('gQRemaining'),
        gQVarianceEl=g('gQVariance'), gQVarianceLabelEl=g('gQVarianceLabel'), gQReqQuarterEl=g('gQReqQuarter');
  if(gQTargetEl)  gQTargetEl.textContent  = fmK(qTarget);
  if(gQAchievedEl){gQAchievedEl.textContent=fmK(qProfit); gQAchievedEl.className='gDetailVal hi';}
  if(q===0) {
    const remainingTarget = qTarget - qProfit;
    const remainingQuarters = 4 - completedQuarterCount(yr);
    const requiredAvgQuarter = remainingQuarters > 0 ? remainingTarget / remainingQuarters : null;
    if(gQRemainingEl){
      gQRemainingEl.textContent = fmK(remainingTarget);
      gQRemainingEl.className = 'gDetailVal ' + (remainingTarget<=0?'pos':'neg');
    }
    if(gQReqQuarterEl){
      gQReqQuarterEl.textContent = requiredAvgQuarter===null ? '-' : fmK(requiredAvgQuarter);
      gQReqQuarterEl.className = 'gDetailVal ' + (requiredAvgQuarter!==null && requiredAvgQuarter<=0?'pos':'hi');
    }
  }
  if(gQVarianceLabelEl) gQVarianceLabelEl.textContent = q===0 ? 'Year Progress' : 'Variance';
  if(gQVarianceEl){
    if(q===0){
      const yearProgress = getYearProgressInsight(qProfit, qTarget);
      gQVarianceEl.textContent = yearProgress.text;
      gQVarianceEl.className = 'gDetailVal ' + yearProgress.className;
    } else {
      gQVarianceEl.textContent = (qVar>=0?'+':'')+fmK(qVar);
      gQVarianceEl.className = 'gDetailVal '+(qVar>=0?'pos':'neg');
    }
  }
  // (Annual gauge removed  "Year" pill on the quarter gauge shows the full-year view)
}

function drawGauge(id,pct,fill,track,startLbl,endLbl){
  const c=g(id);if(!c)return;
  const ctx=c.getContext('2d'),W=c.width,H=c.height,cx=W/2,cy=H-18,r=Math.min(W*.40,H*.75);
  ctx.clearRect(0,0,W,H);
  // Track arc
  ctx.beginPath();ctx.arc(cx,cy,r,Math.PI,2*Math.PI);
  ctx.strokeStyle=track||(isLight?'#dde5f0':'#1a2d47');ctx.lineWidth=16;ctx.lineCap='round';ctx.stroke();
  // Glow on fill
  ctx.shadowBlur=pct>0?10:0; ctx.shadowColor=fill;
  // Fill arc
  ctx.beginPath();ctx.arc(cx,cy,r,Math.PI,Math.PI+Math.min(pct,1)*Math.PI);
  ctx.strokeStyle=fill;ctx.lineWidth=16;ctx.lineCap='round';ctx.stroke();
  ctx.shadowBlur=0;
  // Left endpoint label  at arc start
  const lx=cx-r, ly=cy+2;
  ctx.font='700 9px Poppins';
  ctx.fillStyle=isLight?'#7a8fad':'#7a8fad';
  ctx.textAlign='center';
  ctx.fillText(startLbl||'$0', lx, ly+16);
  // Right endpoint label  at arc end
  const rx=cx+r;
  ctx.fillStyle=isLight?'#7a8fad':'#7a8fad';
  ctx.fillText(endLbl||'', rx, ly+16);
}

/* MONTHLY TABLE */
function renderMonthly(){
  const yr=TARGETS.year||CY;
  const now=dataNow();   // yesterday-based  data is a day behind
  const todayYm=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  // Is the data month already COMPLETE? (our latest data day = its last calendar
  // day) -> then it's judged on actuals, not shown as "projected / days left".
  const curMonthDone = now.getDate() >= new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  // Aggregate by month and track days with data for each month
  const byM={};
  const daysInMonth={};
  rawData.forEach(r=>{
    const ym=(r.date||'').slice(0,7);
    if(!ym.startsWith(String(yr)))return;
    if(!byM[ym])byM[ym]={rev:0,spd:0,pro:0};
    byM[ym].rev+=r.revenue;byM[ym].spd+=r.spend;byM[ym].pro+=r.profit;
    if(!daysInMonth[ym])daysInMonth[ym]=new Set();
    daysInMonth[ym].add(r.date);
  });
  // Smart daily avg  drives current & future month projections. Based on the
  // LAST 14 DAYS of data (rolling window), not just the current month's days.
  const smartDaily=expSmoothingProjection(last14DailyProfits());

  const rows=MONTHS.map((mn,i)=>{
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const mT=TARGETS.months?.[ym]||{profit:0,roi:1.20};
    const d=byM[ym];
    const dim=new Date(yr,i+1,0).getDate(); // total days in month
    const roi=d&&d.spd>0?+(d.rev/d.spd).toFixed(2):null;
    const tgtRoi=mT.roi||TARGETS.roiAlert||1.20;

    // A complete current-data month (e.g. May on 1 Jun) counts as PAST -> actual
    // status, not "projected". The next month only becomes current once it has data.
    const isFuture=ym > todayYm;
    const isCurrent=ym === todayYm && !curMonthDone;
    const isPast=ym < todayYm || (ym === todayYm && curMonthDone);

    const hasTgt=mT.profit>0;
    const proj=smartDaily*dim;             // projected full-month profit at current run-rate
    const reqFull=hasTgt?mT.profit/dim:0;  // required daily across whole month

    let profitCell='', deltaCell='', dailyCell='',
        roiCell='<span class="pillN"></span>', status='<span class="pill pillN"></span>';

    if(isPast){
      const pro=d?d.pro:0;
      const delta=hasTgt?pro-mT.profit:null;
      const ach=hasTgt?+(pro/mT.profit*100).toFixed(1):null;
      const daysWithData=daysInMonth[ym]?daysInMonth[ym].size:0;
      const actualDaily=daysWithData>0?pro/daysWithData:0;
      profitCell=d?fmK(pro):'';
      deltaCell=delta!==null?`<span class="${delta>=0?'deltaPos':'deltaNeg'}">${delta>=0?'+':''}${fmK(delta)}</span>`:'';
      dailyCell=d?`<span style="color:var(--t1)">${fmK(actualDaily)}</span>${hasTgt?`<div style="font-size:9px;color:var(--t3);margin-top:1px">req ${fmK(reqFull)}</div>`:''}`:'';
      roiCell=roi!==null?`<span class="pill ${roi>=tgtRoi?'pillG':'pillR'}">${fr2(roi)}</span>`:'<span class="pillN"></span>';
      if(ach!==null) status=`<span class="pill ${ach>=100?'pillG':'pillR'}">${ach>=100?'OK ':''}${ach}%</span>`;
    }
    else if(isCurrent){
      const pro=d?d.pro:0;
      const elapsedC=daysInMonth[ym]?daysInMonth[ym].size:0;
      const daysLeft=Math.max(0,dim-now.getDate()+1);
      const reqNow=(hasTgt&&daysLeft>0)?(mT.profit-pro)/daysLeft:0; // required/day from today
      const projCur=pro+smartDaily*Math.max(0,dim-elapsedC);        // projected month-end
      const projPct=hasTgt?projCur/mT.profit*100:0;
      const delta=hasTgt?pro-mT.profit:null;
      profitCell=`${fmK(pro)}<div style="font-size:9px;color:var(--t3);margin-top:1px">${daysLeft} days left</div>`;
      deltaCell=delta!==null?`<span class="${delta>=0?'deltaPos':'deltaNeg'}">${delta>=0?'+':''}${fmK(delta)}</span>`:'';
      dailyCell=`<span style="color:var(--t1)">${fmK(smartDaily)}</span>${hasTgt&&reqNow>0?`<div style="font-size:9px;color:var(--t3);margin-top:1px">req ${fmK(reqNow)}</div>`:''}`;
      roiCell=roi!==null?`<span class="pill ${roi>=tgtRoi?'pillG':'pillR'}">${fr2(roi)}</span>`:'<span class="pillN"></span>';
      status=hasTgt?`<span class="pill pillC">o ${projPct.toFixed(1)}% projected</span>`:`<span class="pill pillC">In Progress</span>`;
    }
    else if(isFuture){
      const projPct=hasTgt?proj/mT.profit*100:0;
      const delta=hasTgt?proj-mT.profit:null;
      profitCell=hasTgt?`<span style="color:var(--t3)">~${fmK(proj)}</span>`:'';
      deltaCell=delta!==null?`<span style="color:var(--t3)">~${delta>=0?'+':'-'}${fmK(Math.abs(delta))}</span>`:'';
      dailyCell=hasTgt?`<span style="color:var(--t1)">${fmK(smartDaily)}</span><div style="font-size:9px;color:var(--t3);margin-top:1px">need ${fmK(reqFull)}</div>`:'';
      roiCell=`<span style="color:var(--t3);font-family:'DM Mono',monospace">${fr2(tgtRoi)}</span>`;
      if(hasTgt){
        const cls=projPct>=100?'pillG':projPct>=80?'pillA':'pillR';
        const arr=projPct>=80?'>':'<';
        status=`<span class="pill ${cls}">${arr} ${projPct.toFixed(1)}% proj</span>`;
      }
    }

    // Highlight the CURRENT DATA month (data is a day behind, so on 1 Jun the
    // latest data is 31 May -> May stays highlighted even though it's complete).
    return`<tr${ym===todayYm?' class="curRow"':''}>
      <td class="nameCol">${mn} '${String(yr).slice(2)}</td>
      <td>${hasTgt?fm(mT.profit):'<span class="pillN"></span>'}</td>
      <td>${profitCell}</td>
      <td>${deltaCell}</td>
      <td>${dailyCell}</td>
      <td>${roiCell}</td>
      <td>${status}</td>
    </tr>`;
  });
  g('monthlyBody').innerHTML=rows.join('');
}

/* TARGET vs ACTUAL CHART (with rich tooltip + variance) */
function renderTargetChart(){
  const yr=TARGETS.year||CY;
  // Force destroy existing chart completely
  if(charts.target){
    try{charts.target.destroy();}catch(e){}
    charts.target=null;
  }
  const byM={};
  rawData.forEach(r=>{
    const ym=(r.date||'').slice(0,7);
    if(!ym.startsWith(String(yr)))return;
    if(!byM[ym])byM[ym]={rev:0,spd:0,pro:0};
    byM[ym].rev+=r.revenue;byM[ym].spd+=r.spend;byM[ym].pro+=r.profit;
  });
  const yms=MONTHS.map((_,i)=>`${yr}-${String(i+1).padStart(2,'0')}`);
  const actP=yms.map(ym=>byM[ym]?byM[ym].pro:null);
  const tgtP=yms.map(ym=>TARGETS.months?.[ym]?.profit||null);
  const actROI=yms.map(ym=>byM[ym]&&byM[ym].spd>0?+(byM[ym].rev/byM[ym].spd).toFixed(2):null);
  const tgtROI=yms.map(ym=>TARGETS.months?.[ym]?.roi||TARGETS.roiAlert||1.20);
  // Only show variance for COMPLETE months. An in-progress month (partial data
  // vs full-month target) would otherwise draw a misleadingly large red bar.
  const _tn=dataNow();
  const _todayYm=`${_tn.getFullYear()}-${String(_tn.getMonth()+1).padStart(2,'0')}`;
  const _curDone=_tn.getDate() >= new Date(_tn.getFullYear(), _tn.getMonth()+1, 0).getDate();
  const isCompleteMonth=ym => ym < _todayYm || (ym === _todayYm && _curDone);
  const variance=yms.map((ym,i)=>(actP[i]!==null&&tgtP[i]!==null&&isCompleteMonth(ym))?actP[i]-tgtP[i]:null);

  if(charts.target)charts.target.destroy();
  charts.target=new Chart(g('targetChart').getContext('2d'),{
    type:'bar',
    data:{labels:MONTHS,datasets:[
      {label:'Actual Profit',data:actP,backgroundColor:'rgba(0,229,195,.68)',yAxisID:'y',order:3,borderRadius:3},
      {label:'Variance (Actual-Target)',data:variance,
       backgroundColor:variance.map(v=>v===null?'transparent':v>=0?'rgba(0,196,122,.5)':'rgba(255,77,109,.5)'),
       yAxisID:'y',order:2,borderRadius:3},
      {label:'Target Profit',type:'line',data:tgtP,borderColor:'#4d9fff',borderDash:[5,4],
       backgroundColor:'transparent',pointRadius:4,pointBackgroundColor:'#4d9fff',yAxisID:'y',order:1,tension:.2},
      {label:'Actual ROI',type:'line',data:actROI,borderColor:'#ffb800',backgroundColor:'transparent',
       pointRadius:4,pointBackgroundColor:'#ffb800',yAxisID:'y2',order:1,tension:.35},
      {label:'Target ROI',type:'line',data:tgtROI,borderColor:'#ff4d6d',borderDash:[4,3],
       backgroundColor:'transparent',pointRadius:0,yAxisID:'y2',order:1}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{labels:{color:tc(),font:{family:'Poppins',size:11},boxWidth:11,padding:12}},
        tooltip:{
          mode:'index',intersect:false,
          callbacks:{
            title:items=>MONTHS[items[0].dataIndex]+' '+yr,
            label:ctx=>{
              const i=ctx.dataIndex;
              const lbl=ctx.dataset.label;
              if(lbl.includes('ROI')||lbl.includes('roi')) return ` ${lbl}: ${ctx.parsed.y!==null?fr2(ctx.parsed.y):''}`;
              return ` ${lbl}: ${ctx.parsed.y!==null?fmK(ctx.parsed.y):''}`;
            },
            afterBody:items=>{
              const i=items[0].dataIndex;
              const ym=yms[i];
              const d=byM[ym];
              if(!d) return [];
              const tgt=TARGETS.months?.[ym]?.profit||0;
              const ach=tgt?+(d.pro/tgt*100).toFixed(1):null;
              // In-progress month: partial actual vs full target is misleading,
              // so flag it as "so far" and skip the variance line.
              if(!isCompleteMonth(ym)){
                return ach!==null ? [` Achievement: ${ach}% so far`,` (month in progress)`] : [` (month in progress)`];
              }
              const achStr=ach!==null?(ach>=100?'OK '+ach+'%':'X '+ach+'%'):'';
              const variance=tgt?d.pro-tgt:null;
              const varStr=variance!==null?(variance>=0?'+':'')+fmK(variance):'';
              return[` Achievement: ${achStr}`,` vs Target: ${varStr}`];
            }
          }
        }
      },
      scales:{
        x:{ticks:{color:tc(),font:{size:11,family:'Poppins'}},grid:{color:gc()}},
        y:{ticks:{color:tc(),callback:v=>fmK(v),font:{family:'Poppins',size:10}},grid:{color:gc()}},
        y2:{position:'right',min:0,max:2.5,ticks:{color:'#ffb800',callback:v=>v.toFixed(2),font:{family:'DM Mono',size:10}},grid:{display:false}}
      }
    }
  });
}

/* 
   ALERTS (current month, per-game threshold)
 */
// 
//   ALERT SYSTEM TOGGLE                                          
//   Set to  true  to turn the ROI alert badge + banner back on. 
// 
const ALERTS_ENABLED = false;

function renderAlerts(){
  // When disabled, make sure the topbar badge + banner are hidden, then stop.
  if(!ALERTS_ENABLED){
    const p=g('alertPanel'), b=g('alertBadge');
    if(p) p.classList.remove('show');
    if(b) b.classList.remove('show');
    return;
  }
  // current DATA month (yesterday-based  data is a day behind, so on 1 Jun we
  // still alert on May's games, not the empty June)
  const _ad=dataNow();
  const ym=`${_ad.getFullYear()}-${String(_ad.getMonth()+1).padStart(2,'0')}`;
  const curMonthData=rawData.filter(r=>r.date&&r.date.startsWith(ym));
  // Group by game+platform
  const byKey={};
  curMonthData.forEach(r=>{
    const key=r.game+'|||'+r.platform;
    if(!byKey[key])byKey[key]={game:r.game,platform:r.platform,rev:0,spd:0};
    byKey[key].rev+=r.revenue;byKey[key].spd+=r.spend;
  });
  const defaultThr=TARGETS.roiAlert||1.20;
  const alerts=Object.values(byKey)
    .filter(d=>d.spd>0)
    .map(d=>{
      const roi=+(d.rev/d.spd).toFixed(2);
      const thr=TARGETS.gameRoi?.[d.game]||defaultThr;
      return{name:d.game+' ('+d.platform+')',roi,thr,below:roi<thr};
    })
    .filter(a=>a.below)
    .sort((a,b)=>a.roi-b.roi);

  const panel=g('alertPanel'),badge=g('alertBadge');
  if(alerts.length){
    panel.classList.add('show');badge.classList.add('show');
    g('alertCount').textContent=alerts.length;
    g('alertList').innerHTML=alerts.map(a=>`<div class="alertItem">* <b>${escapeHTML(a.name)}</b>  ROI: <b>${fr2(a.roi)}</b> (threshold: ${fr2(a.thr)})</div>`).join('');
  } else {
    panel.classList.remove('show');badge.classList.remove('show');
  }
}
function scrollToAlerts(){g('alertPanel').scrollIntoView({behavior:'smooth'});}


/* 
   GAME ANALYSIS
 */
let gamePlatFilter = ''; // '' = all platforms

function setGamePlatform(plat, btnEl) {
  gamePlatFilter = plat;
  document.querySelectorAll('[data-gplat]').forEach(b => b.classList.remove('active'));
  btnEl.classList.add('active');
  // Update label
  const lbl = g('gameBarPlatLbl');
  if(lbl) lbl.textContent = plat ? '. ' + plat : '';
  renderGameBar();
  renderROIRanking();
}

function getGameData() {
  // Apply platform filter on top of existing filteredData
  return gamePlatFilter
    ? filteredData.filter(r => r.platform === gamePlatFilter)
    : filteredData;
}

function renderGameAnalysis(){
  renderGameBar();
  renderROIRanking();
}

let legacyExpanded = false;  // is the Legacy Portfolio drill-down open?

function toggleLegacy(){ legacyExpanded = !legacyExpanded; renderGameBar(); }

// One bar-list row. rank 0 = leader (teal), <0 value = coral, otherwise muted blue.
function gbarRow(name, tag, rev, pro, maxRev, rank){
  const w = Math.max(2, Math.abs(rev)/maxRev*100);
  const col = rev<0 ? 'var(--coral)' : rank===0 ? 'var(--teal)' : 'rgba(77,159,255,.45)';
  const proCol = pro>=0 ? 'var(--green)' : 'var(--coral)';
  const safeName = escapeHTML(name);
  const safeTag = escapeHTML(tag);
  return `<div class="gbar-row">
    <div class="gbar-nameWrap"><div class="gbar-name">${safeName}${tag?` <span class="gbar-tag">${safeTag}</span>`:''}</div></div>
    <div class="gbar-track"><div class="gbar-fill" style="width:${w}%;background:${col}"></div></div>
    <div class="gbar-vals"><div class="gbar-rev"${rev<0?' style="color:var(--coral)"':''}>${fmK(rev)}</div><div class="gbar-pro">profit <span style="color:${proCol}">${fmK(pro)}</span></div></div>
  </div>`;
}

function renderGameBar(){
  const data = getGameData();
  // Merge platforms per game so each game is one entry (MSS etc. show combined).
  // plats set drives the COMBINED tag; platform toggle already narrows the data.
  const byGame={};
  data.forEach(r=>{
    if(!byGame[r.game]) byGame[r.game]={game:r.game,rev:0,pro:0,plats:new Set()};
    byGame[r.game].rev+=r.revenue; byGame[r.game].pro+=r.profit;
    if(r.platform) byGame[r.game].plats.add(r.platform);
  });
  const games=Object.values(byGame).sort((a,b)=>b.rev-a.rev);
  // Only Supermarket shows individually; EVERY other title (Dino, Hero, etc.)
  // rolls into the combined "Legacy Portfolio" (expandable to list them all).
  const CORE_RX=/supermarket/i;
  const top=games.filter(gm=>CORE_RX.test(gm.game));
  const rest=games.filter(gm=>!CORE_RX.test(gm.game));
  const legacy=rest.reduce((a,gm)=>({rev:a.rev+gm.rev,pro:a.pro+gm.pro}),{rev:0,pro:0});
  const tagFor=gm=>gm.plats.size>1?'COMBINED':(gm.plats.size===1?[...gm.plats][0]:'');
  const maxRev=Math.max(...top.map(gm=>gm.rev), legacy.rev, 1);

  let html=top.map((gm,i)=>gbarRow(gm.game, tagFor(gm), gm.rev, gm.pro, maxRev, i)).join('');

  if(rest.length){
    html+=gbarRow('Legacy Portfolio', `${rest.length} titles`, legacy.rev, legacy.pro, maxRev, 99);
    const subMax=Math.max(...rest.map(gm=>Math.abs(gm.rev)),1);
    const subRows=rest.map(gm=>gbarRow(gm.game, tagFor(gm), gm.rev, gm.pro, subMax, 1)).join('');
    html+=`<div class="gbar-sub" style="display:${legacyExpanded?'block':'none'}">${subRows}</div>`;
    html+=`<button class="gbar-expand" data-action="toggleLegacy">${legacyExpanded?'^ Collapse':'v Expand'} Legacy Portfolio (${rest.length} titles)</button>`;
  }

  g('gameBarList').innerHTML = html || '<div style="text-align:center;color:var(--t3);padding:30px;font-size:12px">No data</div>';
}

function renderROIRanking(){
  // Combine platforms per game (mirror the Revenue & Profit card): Supermarket
  // shows on its own; every other title rolls into a combined "Legacy Portfolio"
  // row whose ROI = pooled revenue / pooled spend, expandable to list each game.
  const byGame={};
  getGameData().forEach(r=>{
    if(!byGame[r.game]) byGame[r.game]={game:r.game,rev:0,spd:0,pro:0,plats:new Set()};
    byGame[r.game].rev+=r.revenue; byGame[r.game].spd+=r.spend; byGame[r.game].pro+=r.profit;
    if(r.platform) byGame[r.game].plats.add(r.platform);
  });
  const defaultThr=TARGETS.roiAlert||1.20;
  const CORE_RX=/supermarket/i;

  const tagPill=txt=>txt?`<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;background:rgba(255,255,255,.08);color:var(--t3);letter-spacing:.04em">${escapeHTML(txt)}</span>`:'';
  const platTag=g=>tagPill(g.plats.size>1?'COMBINED':(g.plats.size===1?[...g.plats][0]:''));

  const all=Object.values(byGame).filter(g=>g.spd>0).map(g=>{
    const roi=+(g.rev/g.spd).toFixed(2);
    const thr=TARGETS.gameRoi?.[g.game]||defaultThr;
    return {...g, roi, thr};
  });
  const core=all.filter(g=>CORE_RX.test(g.game)).sort((a,b)=>b.roi-a.roi);
  const legacyGames=all.filter(g=>!CORE_RX.test(g.game)).sort((a,b)=>b.roi-a.roi);

  // Combined legacy aggregate -> single pooled ROI
  const legAgg=legacyGames.reduce((a,g)=>({rev:a.rev+g.rev,spd:a.spd+g.spd}),{rev:0,spd:0});
  const legRoi=legAgg.spd>0?+(legAgg.rev/legAgg.spd).toFixed(2):null;

  const maxRoi=Math.max(...core.map(g=>g.roi), legRoi||0, 1);

  const row=(name, tagHtml, roi, thr, rank, sub)=>`
    <tr style="border-bottom:1px solid var(--border)${sub&&!roiRankExpanded?';display:none':''}">
      <td style="padding:7px 6px;font-size:11px;color:var(--t3);font-family:'DM Mono',monospace;width:22px;vertical-align:middle">${rank}</td>
      <td style="padding:7px 6px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:12px;font-weight:${sub?500:600};color:var(--${sub?'t2':'t1'})">${escapeHTML(name)}</span>
          ${tagHtml}
        </div>
        <div style="flex:1;height:4px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;border-radius:99px;width:${roi!==null?Math.min((roi/maxRoi*100),100).toFixed(0):0}%;background:${roi!==null&&roi>=thr?'var(--teal)':'var(--coral)'}"></div>
        </div>
      </td>
      <td style="padding:7px 6px;text-align:right;vertical-align:middle;white-space:nowrap">
        <span class="pill ${roi!==null&&roi>=thr?'pillG':'pillR'}">${roi!==null?fr2(roi):''}</span>
        <div style="font-size:9px;color:var(--t3);margin-top:2px">thr: ${fr2(thr)}</div>
      </td>
    </tr>`;

  let html='', rank=1;
  core.forEach(g=>{ html+=row(g.game, platTag(g), g.roi, g.thr, rank++, false); });
  if(legacyGames.length){
    html+=row('Legacy Portfolio', tagPill(`${legacyGames.length} titles`), legRoi, defaultThr, rank++, false);
    legacyGames.forEach(g=>{ html+=row(g.game, platTag(g), g.roi, g.thr, '.', true); });
  }
  g('roiRankTable').innerHTML = html ||
    `<tr><td style="padding:24px;text-align:center;color:var(--t3);font-size:12px">No ROI data</td></tr>`;

  // Expand button toggles the legacy sub-rows (mirrors the Revenue card).
  const btn=g('roiExpandBtn');
  if(btn){
    if(legacyGames.length){
      btn.style.display='block';
      btn.textContent=`${roiRankExpanded?'^ Collapse':'v Expand'} Legacy Portfolio (${legacyGames.length} titles)`;
    } else {
      btn.style.display='none';
    }
  }
}

let roiRankExpanded=false;
function toggleRoiRank(){ roiRankExpanded=!roiRankExpanded; renderROIRanking(); }

function renderGameTrend(){
  const sel=g('gameTrendSelect')?.value||'';
  const baseData=getGameData();
  const data=sel?baseData.filter(r=>r.game===sel):baseData;
  const allDates=[...new Set(data.map(r=>r.date))].sort();

  if(sel){
    const byDate={};
    data.forEach(r=>{if(!byDate[r.date])byDate[r.date]=0;byDate[r.date]+=r.revenue;});
    if(charts.gameTrend)charts.gameTrend.destroy();
    charts.gameTrend=new Chart(g('gameTrendChart').getContext('2d'),{
      type:'line',
      data:{labels:allDates.map(fmtLbl),datasets:[{
        label:sel+' Revenue',data:allDates.map(d=>byDate[d]||null),
        borderColor:'#00e5c3',backgroundColor:'rgba(0,229,195,.08)',
        pointRadius:2,borderWidth:2,tension:.35,fill:true,spanGaps:true
      }]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{labels:{color:tc(),font:{family:'Poppins',size:11}}},
          tooltip:{callbacks:{label:ctx=>` Revenue: ${fmK(ctx.parsed.y)}`}}},
        scales:{x:{ticks:{color:tc(),font:{size:10},maxRotation:45},grid:{color:gc()}},
                y:{ticks:{color:tc(),callback:v=>fmK(v),font:{family:'Poppins',size:10}},grid:{color:gc()}}}}
    });
  } else {
    // Top 6 games multi-line
    const byGame={};
    filteredData.forEach(r=>{
      if(!byGame[r.game])byGame[r.game]={};
      if(!byGame[r.game][r.date])byGame[r.game][r.date]=0;
      byGame[r.game][r.date]+=r.revenue;
    });
    const topGames=Object.keys(byGame)
      .sort((a,b)=>Object.values(byGame[b]).reduce((s,v)=>s+v,0)-Object.values(byGame[a]).reduce((s,v)=>s+v,0))
      .slice(0,6);
    const allD=[...new Set(baseData.map(r=>r.date))].sort();
    const colors=['#00e5c3','#4d9fff','#ffb800','#ff4d6d','#a78bfa','#34d399'];
    const datasets=topGames.map((gm,i)=>({
      label:gm,data:allD.map(d=>byGame[gm][d]||null),
      borderColor:colors[i],backgroundColor:'transparent',
      pointRadius:1,borderWidth:2,tension:.35,spanGaps:true
    }));
    if(charts.gameTrend)charts.gameTrend.destroy();
    charts.gameTrend=new Chart(g('gameTrendChart').getContext('2d'),{
      type:'line',data:{labels:allD.map(fmtLbl),datasets},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{labels:{color:tc(),font:{family:'Poppins',size:11},boxWidth:10,padding:10}},
          tooltip:{mode:'index',intersect:false,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${fmK(ctx.parsed.y)}`}}},
        scales:{x:{ticks:{color:tc(),font:{size:10},maxRotation:45},grid:{color:gc()}},
                y:{ticks:{color:tc(),callback:v=>fmK(v),font:{family:'Poppins',size:10}},grid:{color:gc()}}}}
    });
  }
}


/* 
   DAILY SUMMARY TABLE
 */
function renderDailySummary(){
  // Find last available date in filtered data
  const dates = [...new Set(filteredData.map(r=>r.date))].filter(Boolean).sort();
  if(!dates.length){ g('dailySummaryBody').innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--t3)">No data</td></tr>'; return; }
  const lastDate = dates[dates.length-1];

  // Update date label
  const lbl=g('dailySummaryDate');
  if(lbl) lbl.textContent = fmtLbl(lastDate);

  // Get rows for last date
  const dayRows = filteredData.filter(r=>r.date===lastDate);

  // Aggregate by game+platform
  const byKey={};
  dayRows.forEach(r=>{
    const key=r.game+'|||'+r.platform;
    if(!byKey[key])byKey[key]={game:r.game,platform:r.platform,rev:0,spd:0,pro:0};
    byKey[key].rev+=r.revenue; byKey[key].spd+=r.spend; byKey[key].pro+=r.profit;
  });

  // Platform colors
  const platCol={'Android':'#3ddc84','iOS':'#007aff','Amazon':'#ff9900'};
  const platBg={'Android':'rgba(61,220,132,.12)','iOS':'rgba(0,122,255,.12)','Amazon':'rgba(255,153,0,.12)'};

  const rows=Object.values(byKey)
    .sort((a,b)=>b.rev-a.rev);

  if(!rows.length){
    g('dailySummaryBody').innerHTML='<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--t3)">No data for last date</td></tr>';
    return;
  }

  // Total row
  const totRev=rows.reduce((s,r)=>s+r.rev,0);
  const totSpd=rows.reduce((s,r)=>s+r.spd,0);
  const totPro=rows.reduce((s,r)=>s+r.pro,0);
  const totRoi=totSpd>0?+(totRev/totSpd).toFixed(2):0;


  g('dailySummaryBody').innerHTML=rows.map(r=>{
    const roi=r.spd>0?+(r.rev/r.spd).toFixed(2):0;
    const col=platCol[r.platform]||'#7a8fad';
    const bg=platBg[r.platform]||'rgba(255,255,255,.05)';
    const roiGood=roi>=(TARGETS.roiAlert||1.20);
    return`<tr>
      <td class="nameCol" style="font-size:12px">${escapeHTML(r.game)}</td>
      <td><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:${bg};color:${col}">${escapeHTML(r.platform)}</span></td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--blue)">${fmFull(Math.round(r.rev))}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--coral)">${fmFull(Math.round(r.spd))}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:${r.pro>=0?'var(--green)':'var(--coral)'}">${fmFull(Math.round(r.pro))}</td>
      <td style="text-align:right"><span class="pill ${roiGood?'pillG':'pillR'}" style="font-size:11px">${fr2(roi)}</span></td>
    </tr>`;
  }).join('')+`
    <tr style="border-top:2px solid var(--borderB);background:var(--card2)">
      <td class="nameCol" colspan="2" style="font-size:12px;color:var(--t1)">Total</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--blue);font-weight:700">${fmFull(Math.round(totRev))}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--coral);font-weight:700">${fmFull(Math.round(totSpd))}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:${totPro>=0?'var(--green)':'var(--coral)'};font-weight:700">${fmFull(Math.round(totPro))}</td>
      <td style="text-align:right"><span class="pill ${totRoi>=(TARGETS.roiAlert||1.20)?'pillG':'pillR'}" style="font-size:11px;font-weight:700">${fr2(totRoi)}</span></td>
    </tr>`;
}
/* 
   EXPORT
 */
function exportCSV(){
  const h=['Date','Game','Platform','Revenue','Spend','Profit','ROI'];
  const csvCell = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
  const rows=filteredData.map(r=>[r.date,r.game,r.platform,r.revenue.toFixed(2),r.spend.toFixed(2),r.profit.toFixed(2),r.roi.toFixed(4)]);
  dlBlob(new Blob([[h,...rows].map(r=>r.map(csvCell).join(',')).join('\n')],{type:'text/csv'}),'dashboard_export.csv');
  toast('CSV exported','ok');
}
function exportPDF(){
  if(!window.jspdf?.jsPDF){
    toast('PDF export library is not loaded. Check your internet/CDN access.','err');
    return;
  }
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape'});
  const yr=TARGETS.year||CY;
  doc.setFontSize(18);doc.setFont('helvetica','bold');doc.text('Executive Dashboard Report',14,16);
  doc.setFontSize(9);doc.setTextColor(120);doc.setFont('helvetica','normal');
  doc.text(`Year: ${yr}  |  Generated: ${new Date().toLocaleString()}  |  Period: ${dateFrom} -> ${dateTo}`,14,23);
  const c=aggData(filteredData),roi=c.spd>0?+(c.rev/c.spd).toFixed(2):0;
  doc.setTextColor(0);doc.setFontSize(10);
  doc.text(`Revenue: ${fm(c.rev)}   Spend: ${fm(c.spd)}   Profit: ${fm(c.pro)}   ROI: ${fr2(roi)}`,14,30);
  const yms=MONTHS.map((_,i)=>`${yr}-${String(i+1).padStart(2,'0')}`);
  const byM={};
  rawData.forEach(r=>{const ym=(r.date||'').slice(0,7);if(!byM[ym])byM[ym]={rev:0,spd:0,pro:0};byM[ym].rev+=r.revenue;byM[ym].spd+=r.spend;byM[ym].pro+=r.profit;});
  doc.autoTable({
    head:[['Month','Target','Revenue','Profit','vs Target','ROI','Achievement']],
    body:yms.map((ym,i)=>{
      const d=byM[ym],mT=TARGETS.months?.[ym]||{profit:0,roi:1.20};
      const roi2=d&&d.spd>0?+(d.rev/d.spd).toFixed(2):'-';
      const delta=d&&mT.profit?d.pro-mT.profit:null;
      const ach=d&&mT.profit?+(d.pro/mT.profit*100).toFixed(1)+'%':'-';
      return[MONTHS[i]+" '"+String(yr).slice(2),mT.profit?fm(mT.profit):'-',d?fm(d.rev):'-',d?fm(d.pro):'-',delta!==null?(delta>=0?'+':'')+fm(delta):'-',String(roi2),ach];
    }),
    startY:35,styles:{fontSize:8,cellPadding:3},headStyles:{fillColor:[16,24,40],textColor:255}
  });
  doc.save('executive_report.pdf');toast('PDF exported','ok');
}
function dlBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();}
