/* TARGETS STORE */
const CY = new Date().getFullYear();
function defaultTargets(yr) {
  const t = { year:yr, roiAlert:1.20, quarter:null, annual:null, months:{}, gameRoi:{} };
  MONTHS.forEach((_,i) => { t.months[`${yr}-${String(i+1).padStart(2,'0')}`] = {profit:350000,roi:1.20}; });
  return t;
}
function loadTargets() {
  try { const s=localStorage.getItem('ed_targets'); return s ? JSON.parse(s) : defaultTargets(CY); }
  catch(e) { return defaultTargets(CY); }
}
let TARGETS = loadTargets();
const saveTargetsStore = () => localStorage.setItem('ed_targets', JSON.stringify(TARGETS));
let targetsEventsBound = false;

/* ── SHARED TARGETS (server) ───────────────────────────────────────────
   Targets used to live only in this browser's localStorage, so they were
   invisible on other people's machines. These two helpers sync them through
   the Apps Script backend so every user sees the SAME goals. They fail soft:
   if the backend / network is unavailable, we keep using the local copy.

   Matches the backend contract (doGet, no doPost):
   ▸ getTargets  → returns { targets: "<JSON string>" | null }
   ▸ saveTargets → GET with &targets=<encoded JSON>, returns { success:true }
                   (admin-only, enforced server-side via the login token)
──────────────────────────────────────────────────────────────────────── */
async function fetchTargetsFromServer(){
  try{
    const token = getToken(); if(!token) return null;
    // _cb busts the browser cache so a freshly-saved set shows up immediately.
    const json = await apiFetch({ action:'getTargets', token, _cb: Date.now() });
    if(!json || json.error) return null;
    let t = json.targets;                       // backend sends it as a JSON STRING
    if(typeof t === 'string'){ try{ t = JSON.parse(t); }catch(e){ return null; } }
    return (t && typeof t === 'object' && t.months) ? t : null;
  }catch(e){ return null; }
}

async function saveTargetsToServer(){
  try{
    const token = getToken(); if(!token) return false;
    const json = await apiFetch({ action:'saveTargets', token, targets: JSON.stringify(TARGETS) });
    return !!(json && (json.success || json.ok) && !json.error);
  }catch(e){ return false; }
}

// Compute quarter/annual from monthly targets
function computeAutoTargets() {
  const yr = TARGETS.year || CY;
  let q1=0, total=0;
  MONTHS.forEach((_,i) => {
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const p = TARGETS.months?.[ym]?.profit || 0;
    total += p;
    if(i<3) q1 += p;
  });
  return { quarter: TARGETS.quarter || q1, annual: TARGETS.annual || total };
}


/* TARGETS UI */
function buildTargetsUI(){
  const isAdmin=CU?.r==='admin';
  g('viewerMsg').classList.toggle('show',!isAdmin);
  g('targetsEditArea').style.display=isAdmin?'block':'none';
  if(!isAdmin)return;

  const yr=TARGETS.year||CY;
  g('tYear').value=yr;
  g('tQuarter').value=TARGETS.quarter||'';
  g('tAnnual').value=TARGETS.annual||'';

  // Auto-calc notes
  const auto=computeAutoTargets();
  g('qAutoNote').textContent=`Auto from monthly: ${fmK(auto.quarter)}`;
  g('aAutoNote').textContent=`Auto from monthly: ${fmK(auto.annual)}`;

  // Monthly inputs
  g('monthlyInputs').innerHTML=MONTHS.map((_,i)=>{
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const mT=TARGETS.months?.[ym]||{profit:'',roi:''};
    return`<div class="tMonthRow">
      <div class="tMonthLbl">${MONTHS[i]}</div>
      <input type="number" class="tInput" id="tp_${ym}" placeholder="0" value="${mT.profit||''}"/>
      <input type="number" class="tInput" id="tr_${ym}" placeholder="1.20" step="0.01" value="${mT.roi||''}"/>
    </div>`;
  }).join('');

  // Per-game ROI
  const games=[...new Set(rawData.map(r=>r.game))].filter(Boolean).sort();
  if(games.length){
    g('gameRoiInputs').innerHTML=games.map(gm=>{
      const saved=TARGETS.gameRoi?.[gm]||'';
      const key=gm.replace(/[^a-zA-Z0-9]/g,'_');
      return`<div class="gameRoiRow">
        <div class="gameRoiName" title="${escapeAttr(gm)}">${escapeHTML(gm)}</div>
        <input type="number" class="tInput" id="gr_${key}" data-game="${escapeAttr(gm)}" placeholder="${fr2(TARGETS.roiAlert||1.20)}" step="0.01" value="${saved}"/>
      </div>`;
    }).join('');
  } else {
    g('gameRoiInputs').innerHTML='<div style="font-size:12px;color:var(--t3)">Load data first to see games.</div>';
  }
  g('bulkYearLbl').textContent=yr;
  updateTargetPreview();
  if(!targetsEventsBound){
    g('monthlyInputs').addEventListener('input',onMonthInput);
    g('tQuarter').addEventListener('input',updateTargetPreview);
    g('tAnnual').addEventListener('input',updateTargetPreview);
    targetsEventsBound = true;
  }
}

function onMonthInput(){
  const yr=+v('tYear')||TARGETS.year||CY;
  let qSum=0,aSum=0;
  MONTHS.forEach((_,i)=>{
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const p=+(g(`tp_${ym}`)?.value||0);
    aSum+=p; if(i<3)qSum+=p;
  });
  g('qAutoNote').textContent=`Auto from monthly: ${fmK(qSum)}`;
  g('aAutoNote').textContent=`Auto from monthly: ${fmK(aSum)}`;
  updateTargetPreview();
}

function updateTargetPreview(){
  const yr=+v('tYear')||TARGETS.year||CY;
  const q=+v('tQuarter')||null, a=+v('tAnnual')||null;
  let qAuto=0,aAuto=0;
  MONTHS.forEach((_,i)=>{const ym=`${yr}-${String(i+1).padStart(2,'0')}`;const p=+(g(`tp_${ym}`)?.value||0);aAuto+=p;if(i<3)qAuto+=p;});
  const rows=MONTHS.map((_,i)=>{
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const p=g(`tp_${ym}`)?.value, r=g(`tr_${ym}`)?.value;
    return`<div class="tPrevRow"><span class="tPrevM">${MONTHS[i]}</span><div class="tPrevVals"><span class="tPrevP">${p?fmK(+p):'—'}</span><span class="tPrevR">${r?fr2(+r):'—'}</span></div></div>`;
  }).join('');
  g('targetPreview').innerHTML=`
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      <div class="metItem" style="flex:1"><div class="metLbl">Quarter</div><div class="metVal good">${q?fmK(q):'Auto: '+fmK(qAuto)}</div></div>
      <div class="metItem" style="flex:1"><div class="metLbl">Annual</div><div class="metVal good">${a?fmK(a):'Auto: '+fmK(aAuto)}</div></div>
    </div>
    <div style="font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t3);display:flex;justify-content:space-between;margin-bottom:6px">
      <span>Month</span><span style="display:flex;gap:20px"><span style="color:var(--teal)">Profit</span><span style="color:var(--amber)">ROI</span></span>
    </div>${rows}`;
}

function saveTargets(){
  const yr=+v('tYear')||CY;
  TARGETS.year=yr;
  // ROI target default — the editable field was removed (alerts are off); keep the
  // existing value (or 1.20). Per-game / per-month ROI targets still override this.
  TARGETS.roiAlert=TARGETS.roiAlert||1.20;
  TARGETS.quarter=+v('tQuarter')||null; // null = auto
  TARGETS.annual =+v('tAnnual') ||null;
  if(!TARGETS.months)TARGETS.months={};
  MONTHS.forEach((_,i)=>{
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const p=g(`tp_${ym}`)?.value, r=g(`tr_${ym}`)?.value;
    TARGETS.months[ym]={profit:p?+p:0,roi:r?+r:1.20};
  });
  // per-game ROI
  if(!TARGETS.gameRoi)TARGETS.gameRoi={};
  document.querySelectorAll('[id^="gr_"]').forEach(el=>{
    const gm=el.dataset.game;
    if(gm) TARGETS.gameRoi[gm]=el.value?+el.value:null;
  });
  saveTargetsStore();
  g('savedInfo').textContent='✓ Saved at '+new Date().toLocaleTimeString();
  if(rawData.length) renderAll();
  updateTargetPreview();
  // Push to the server so the change is visible to all users (not just this PC).
  saveTargetsToServer().then(ok=>{
    if(ok){
      toast('Targets saved & synced to all users','ok');
      g('savedInfo').textContent='✓ Saved & synced to all users at '+new Date().toLocaleTimeString();
    } else {
      toast('Saved on this device — server sync unavailable','warn');
      g('savedInfo').textContent='⚠ Saved locally only (server sync not set up) — '+new Date().toLocaleTimeString();
    }
  });
}

/* BULK MODAL */
function openBulkModal(){
  const yr=+v('tYear')||TARGETS.year||CY;
  g('bulkYearLbl').textContent=yr;
  g('bulkGrid').innerHTML=MONTHS.map((_,i)=>{
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const mT=TARGETS.months?.[ym]||{profit:'',roi:''};
    return`<div class="tMonthRow">
      <div class="tMonthLbl">${MONTHS[i]}</div>
      <input type="number" class="tInput" id="bp_${ym}" placeholder="0" value="${mT.profit||''}"/>
      <input type="number" class="tInput" id="br_${ym}" placeholder="1.20" step="0.01" value="${mT.roi||''}"/>
    </div>`;
  }).join('');
  g('bulkOverlay').classList.add('open');
}
function closeBulkModal(){g('bulkOverlay').classList.remove('open');}
function saveBulkTargets(){
  const yr=+v('tYear')||TARGETS.year||CY;
  MONTHS.forEach((_,i)=>{
    const ym=`${yr}-${String(i+1).padStart(2,'0')}`;
    const p=g(`bp_${ym}`)?.value, r=g(`br_${ym}`)?.value;
    if(g(`tp_${ym}`))g(`tp_${ym}`).value=p||'';
    if(g(`tr_${ym}`))g(`tr_${ym}`).value=r||'';
  });
  closeBulkModal();
  onMonthInput();
  updateTargetPreview();
  toast('Full year filled — click Save to apply','warn');
}

