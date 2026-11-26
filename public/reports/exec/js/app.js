/* The dashboard is dark only: <html data-theme="dark"> is in the markup. */

window.addEventListener('DOMContentLoaded', () => {
  cacheStaticDom();
  if(!checkSession()) {
    showAuthGate();
    // Warn if opened as file://
    if(location.protocol === 'file:') {
      setTimeout(showFileProtocolWarning, 800);
    }
  }
});

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
  bindId('logoutBtn', 'click', () => doLogout());

  bind('.presetBtn[data-preset]', 'click', function(){ applyPreset(this); });
  bindId('fGame', 'change', () => applyFilters());
  bindId('fPlat', 'change', () => applyFilters());
  bindId('fFrom', 'change', () => onCustomDate());
  bindId('fTo', 'change', () => onCustomDate());

  bind('.qPill[data-q]', 'click', function(){ selectQuarter(Number(this.dataset.q), this); });
  bind('.presetBtn[data-gplat]', 'click', function(){ setGamePlatform(this.dataset.gplat, this); });
  bindId('roiExpandBtn', 'click', () => toggleRoiRank());
  /* The Targets and LTV bindings went with their tabs. querySelectorAll on a
     selector that matches nothing is a silent no-op, so these would never
     have thrown - which is exactly why they are worth deleting rather than
     leaving: a binding that quietly matches nothing outlives the feature it
     belonged to and reads, later, as a feature that is merely broken. */
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
  /* The delegated LTV handlers went with the tab. They were listeners on
     the document for elements that no longer exist, calling functions that
     no longer exist - harmless until the day somebody reuses one of those
     data attributes and gets a ReferenceError from a feature deleted months
     earlier. */
}

bindStaticHandlers();
