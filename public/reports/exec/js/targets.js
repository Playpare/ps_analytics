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

/* THE EDITOR WAS HERE - buildTargetsUI, saveTargets, the bulk modal and the
   live preview, about 150 lines.
 *
 * Targets are set in Playspare Pulse now, under Config > Thresholds. This
 * file keeps the half that this report actually needs: the store, and the
 * read from the backend. It no longer writes.
 *
 * saveTargetsToServer went with the editor. Nothing here calls it, and a
 * save function left behind in the project that no longer owns saving is an
 * invitation to end up with two writers of one value.
 */
