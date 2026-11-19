/* ═══════════════════════════════════════════════
   THEME — shared with Playspare Pulse, not owned by this page
   ───────────────────────────────────────────────
   Pulse stores the choice in localStorage['mss3d_theme'] ('light' | 'dark')
   and marks light with `lt` on <body>. This page already used the very same
   `lt` class for its own toggle, which is the whole reason the two can be
   joined in a few lines instead of a restyle.

   WHY NOT THE <!--THEME_BOOT--> MARKER the other reports use. That marker is
   replaced at build time by an INLINE script, and this document carries a
   Content-Security-Policy of its own with no 'unsafe-inline' in script-src.
   Admitting inline script to keep one marker would throw away the only
   page-level protection this document has, to solve something a plain file
   solves. The cost is a possible flash of the dark background on a light
   theme, for one frame, because this file is not render-blocking.

   The `storage` listener is what makes the two feel like one app: toggle the
   theme in the Pulse topbar and this iframe follows immediately, because
   same-origin documents are notified of each other's localStorage writes.
   Without it you would switch the shell to light and leave a black panel
   sitting inside it until the next reload.
═══════════════════════════════════════════════ */
const THEME_KEY = 'mss3d_theme';

function readSharedTheme(){
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
  catch(e) { return 'dark'; }
}

/** Applies a theme without writing it back, and without re-entering the toggle. */
function applySharedTheme(mode){
  const light = mode === 'light';
  if(light === isLight) return;
  isLight = light;
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  document.body.classList.toggle('lt', light);
  const btn = g('themeBtn');
  if(btn) btn.textContent = light ? '🌙 Dark' : '☀ Light';
  /* Guarded because this also runs at boot, BEFORE any data has loaded.
     toggleTheme could assume a rendered page; this cannot - on a light theme
     it fires during DOMContentLoaded, when rawData is still empty and the
     gauges have nothing to redraw. A throw here would take the sign-in check
     with it and leave the page blank over a correct session. */
  try {
    Object.values(charts).forEach(c => { if(c) c.update(); });
    renderProjected();
    if(typeof _ltvLoaded !== 'undefined' && _ltvLoaded &&
       g('tab-ltv') && g('tab-ltv').classList.contains('active')) renderLtv();
  } catch(e) {
    /* Nothing to redraw yet. loadData() paints everything in the right
       theme a moment later, because isLight is already set above. */
  }
}

window.addEventListener('DOMContentLoaded', () => {
  cacheStaticDom();
  applySharedTheme(readSharedTheme());
  if(!checkSession()) {
    showAuthGate();
    // Warn if opened as file://
    if(location.protocol === 'file:') {
      setTimeout(showFileProtocolWarning, 800);
    }
  }
});

/* Another document in this app changed the theme - follow it. */
window.addEventListener('storage', ev => {
  if(ev.key === THEME_KEY) applySharedTheme(ev.newValue === 'light' ? 'light' : 'dark');
});

/* Re-render LTV charts on theme toggle so colors stay accurate, and persist
   the choice where Pulse and every other report will read it. */
const _origToggleTheme = toggleTheme;
toggleTheme = function(){
  _origToggleTheme();
  document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
  try { localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark'); }
  catch(e) { /* storage blocked - the theme still applies for this page */ }
  if(_ltvLoaded && g('tab-ltv').classList.contains('active')) renderLtv();
};

function bindStaticHandlers(){
  const bind = (selector, eventName, handler) => {
    document.querySelectorAll(selector).forEach(el => {
      el.addEventListener(eventName, function(event){
        handler.call(this, event);
      });
    });
  };
  const bindId = (id, eventName, handler) => {
    const el = g(id);
    if(el) el.addEventListener(eventName, handler);
  };
  const delegate = (selector, eventName, handler) => {
    document.addEventListener(eventName, event => {
      const el = event.target.closest(selector);
      if(el) handler.call(el, event);
    });
  };

  bind('#bulkOverlay .bClose,#bulkOverlay .tbtn:not(.primary)', 'click', () => closeBulkModal());
  bind('#bulkOverlay .tbtn.primary', 'click', () => saveBulkTargets());
  /* No #userOverlay and no .loginBtn bindings any more. User Management moved
     to Pulse, which edits the same DashUsers sheet, and sign-in moved to the
     auth deployment. Both sets of markup are gone from index.html, so these
     selectors would have matched nothing - silently, which is the kind of
     dead binding that outlives the feature it belonged to. */
  bind('.tabBtn[data-tab]', 'click', function(){ switchTab(this.dataset.tab, this); });
  bindId('alertBadge', 'click', () => scrollToAlerts());
  bindId('refreshBtn', 'click', () => refreshData());
  bindId('csvBtn', 'click', () => exportCSV());
  bindId('pdfBtn', 'click', () => exportPDF());
  bindId('themeBtn', 'click', () => toggleTheme());
  bindId('logoutBtn', 'click', () => doLogout());

  bind('.presetBtn[data-preset]', 'click', function(){ applyPreset(this); });
  bindId('fGame', 'change', () => applyFilters());
  bindId('fPlat', 'change', () => applyFilters());
  bindId('fFrom', 'change', () => onCustomDate());
  bindId('fTo', 'change', () => onCustomDate());

  bind('.qPill[data-q]', 'click', function(){ selectQuarter(Number(this.dataset.q), this); });
  bind('.presetBtn[data-gplat]', 'click', function(){ setGamePlatform(this.dataset.gplat, this); });
  bindId('roiExpandBtn', 'click', () => toggleRoiRank());
  bind('.tBulkBtn', 'click', () => openBulkModal());
  bind('.tSaveBtn', 'click', () => saveTargets());

  bind('[data-ltv-plat]', 'click', function(){ setLtvPlat(this.dataset.ltvPlat, this); });
  bind('[data-ltv-type]', 'click', function(){ setLtvType(this.dataset.ltvType, this); });
  bindId('ltvGame', 'change', () => onLtvGameChange());
  bindId('ltvCountry', 'change', () => renderLtv());
  bind('[data-ltv-days]', 'click', function(){ setLtvDateRange(Number(this.dataset.ltvDays)); });
  bindId('ltvFrom', 'change', () => onLtvDateInput());
  bindId('ltvTo', 'change', () => onLtvDateInput());
  bind('[data-ltv-range]', 'click', function(){ setLtvRange(this.dataset.ltvRange, this); });
  bindId('ltvPerfPeriod', 'change', () => renderLtvPerformance());
  bindId('ltvPerfDay', 'change', () => renderLtvPerformance());
  bindId('ltvShowAllBtn', 'click', () => toggleLtvShowAll());

  delegate('[data-close-file-warning]', 'click', function(){
    const warning = g('fileProtoWarning');
    if(warning) warning.style.display = 'none';
  });
  delegate('[data-proj-month]', 'click', function(){
    projSelectedMonth = this.dataset.projMonth;
    buildMonthFilter();
    renderProjected();
  });
  delegate('[data-action="toggleLegacy"]', 'click', () => toggleLegacy());
  delegate('.uRoleSel[data-user-index]', 'change', function(){
    changeRole(Number(this.dataset.userIndex), this.value);
  });
  delegate('.uDel[data-user-index]', 'click', function(){
    deleteUser(Number(this.dataset.userIndex));
  });
  delegate('[data-ltv-day]', 'click', function(){
    toggleLtvDay(this.dataset.ltvDay);
  });
  delegate('[data-ltv-forecast-toggle]', 'click', () => toggleLtvForecast());
  delegate('[data-ltv-forecast-target]', 'click', function(){
    setLtvForecastTarget(this.dataset.ltvForecastTarget);
  });
  delegate('[data-ltv-sort]', 'click', function(){
    setLtvLeadSort(this.dataset.ltvSort);
  });
}

bindStaticHandlers();
