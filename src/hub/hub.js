/**
 * hub.js — the shell: sign-in, the four report tabs, and one shared session.
 *
 * Extracted from index.html. The only edit to the logic below is where the
 * endpoints come from: they were six literals at the top of this file, and
 * they now arrive from the build environment via src/shared/config.js, so a
 * public repository never carries them. Everything else — the session
 * handling, the retry policy, the lazy iframe loading, the UA→Weekly prefetch
 * — is unchanged.
 */

import { API_URLS, assertConfigured, BUILD_ID } from '../shared/config.js';

(function () {
    'use strict';

    /* A mis-set secret should say so once, here, rather than surfacing four
       tabs later as an unexplained "could not reach the web app". */
    try { assertConfigured(); }
    catch (err) { console.error('[hub] configuration problem:', err.message); }

    /* The one backend that issues tokens. The Authentication tab lives in the
       Weekly workbook, and every project verifies the resulting token locally
       with the shared AUTH_HMAC_SECRET_V1, so nobody signs in twice. */
    const AUTH_BACKEND = 'auth';

    /* How long a hub session is trusted for when the backend does not say.
       Keep this at or below the server-side token lifetime in Auth.gs —
       if the hub trusts a token for longer than the server does, users get
       a signed-in hub full of reports that all fail with "session expired". */
    const DEFAULT_SESSION_MS = 480 * 60 * 1000;   // matches Auth.gs TTL_MINUTES

    /* Apps Script cold starts are slow, so give login room before giving up. */
    const REQUEST_TIMEOUT_MS = 50000;
    const REQUEST_RETRIES    = 2;

    /* UA issues one signed token. Every Apps Script project - Weekly, Till
       Date and ASO - validates that same signature locally using the shared
       AUTH_HMAC_SECRET_V1. Nobody logs in more than once. */
    const TOKEN_KEY   = 'mss3d_token';

    /* Report id (used in the URL hash and on the buttons) -> backend name. */
    const BACKEND_OF  = { 'till-date': 'tilldate', 'weekly': 'weekly', 'ua': 'ua', 'aso': 'aso' };
    const REPORT_IDS  = ['ua', 'weekly', 'till-date', 'aso'];
    const LABEL_OF    = { tilldate: 'Till Date', weekly: 'Weekly', ua: 'UA', aso: 'ASO', negative: 'UA Negative Spend', auth: 'Sign-in' };

    const $ = (id) => document.getElementById(id);

    /* ============================================================
       1. Session storage
       ------------------------------------------------------------
       sessionStorage alone loses the session on every new tab, bookmark
       and window restore, which is what made signing in feel random. The
       durable copy lives in localStorage with an explicit expiry; it is
       mirrored into sessionStorage on every load so the reports keep
       reading it exactly where they already look.
       ============================================================ */
    /* v4 migrates the browser from three project-local tokens to one shared
       HMAC-signed token and forces one clean sign-in after deployment. */
    const AUTH_KEY = 'mss3d_auth_v4';
    try { localStorage.removeItem('mss3d_auth_v1'); } catch (e) {}
    try { localStorage.removeItem('mss3d_auth_v2'); } catch (e) {}
    try { localStorage.removeItem('mss3d_auth_v3'); } catch (e) {}

    function readSession() {
      let raw = null;
      try { raw = localStorage.getItem(AUTH_KEY); } catch (e) { /* storage blocked */ }
      if (!raw) return null;
      try {
        const rec = JSON.parse(raw);
        if (!rec || !rec.token || typeof rec.token !== 'string') return null;
        /* Older hub builds saved 8-hour expiries even though Auth.gs issued
           120-minute tokens. Cap every stored record by its save time so an
           old localStorage entry cannot hide the login gate after the server
           session has ended. */
        const trustedUntil = Math.min(
          Number(rec.expiresAt) || 0,
          (Number(rec.savedAt) || 0) + DEFAULT_SESSION_MS
        );
        if (!trustedUntil || trustedUntil <= Date.now()) return null;
        rec.expiresAt = trustedUntil;
        return rec;
      } catch (e) { return null; }
    }

    function writeSession(token, expiresAt) {
      const rec = {
        token: token,
        savedAt: Date.now(),
        expiresAt: expiresAt || (Date.now() + DEFAULT_SESSION_MS)
      };
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(rec)); } catch (e) { /* storage blocked */ }
      mirrorToSession(rec);
      return rec;
    }

    /* Every report reads this same-origin sessionStorage key on each request. */
    function mirrorToSession(rec) {
      const token = rec && rec.token ? rec.token : null;
      try { token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY); }
      catch (e) { /* storage blocked */ }
    }

    function clearSession() {
      try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
      /* Remove legacy per-project browser keys left by older hub builds. */
      ['tok_ua', 'tok_weekly', 'tok_tilldate'].forEach((key) => {
        try { sessionStorage.removeItem(key); } catch (e) {}
      });
    }

    /* ============================================================
       2. Network
       ------------------------------------------------------------
       Three things go wrong with an Apps Script /exec endpoint that a
       bare fetch().json() cannot tell apart, and all three used to
       surface as the same unhelpful failure:
         - it answers 200 with an HTML Google sign-in page
         - it never answers at all (cold start, dropped connection)
         - it answers with a real JSON error
       ============================================================ */
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function fail(message, opts) {
      const err = new Error(message);
      Object.assign(err, opts || {});
      return err;
    }

    async function postJson(url, payload, label) {
      let lastError;

      for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const res = await fetch(url, {
            method: 'POST',
            // text/plain on purpose: application/json triggers a CORS preflight
            // that Apps Script web apps cannot answer.
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow',
            signal: controller.signal
          });
          clearTimeout(timer);

          const body = (await res.text()).trim();

          if (!res.ok) {
            throw fail(label + ': the web app answered HTTP ' + res.status + '.',
              { retryable: res.status === 404 || res.status === 429 || res.status >= 500 });
          }
          // Apps Script serves its own login page with a 200, so status is not
          // enough — anything starting with a tag is Google, not our JSON.
          // This is retryable on purpose: Google intermittently answers a valid
          // request with an HTML throttling page after 20-40 seconds, and it
          // does so even for a no-op ping. Treating that as fatal is what made
          // sign-in fail outright instead of quietly succeeding on the retry.
          if (body.charAt(0) === '<') {
            throw fail(label + ': the web app returned an HTML page instead of data.\n' +
              'If this keeps happening, redeploy it with "Execute as: Me" and ' +
              '"Who has access: Anyone", or open the /exec URL once in this browser ' +
              'and approve access.',
              { retryable: true, code: 'GOOGLE_LOGIN' });
          }
          try {
            return JSON.parse(body);
          } catch (e) {
            throw fail(label + ': the web app returned something that is not JSON.',
              { retryable: false });
          }
        } catch (err) {
          clearTimeout(timer);
          lastError = describeNetworkError(err, label);
          if (lastError.retryable === false || attempt === REQUEST_RETRIES) throw lastError;
          /* Jittered backoff. When several documents retry at once, a fixed
             delay makes them retry in lockstep and rebuild the very burst
             that caused the failure. */
          await sleep(1200 * Math.pow(2, attempt) + Math.random() * 600);
        }
      }
      throw lastError;
    }

    function describeNetworkError(err, label) {
      if (err && err.retryable !== undefined) return err;           // already ours
      if (err && err.name === 'AbortError') {
        return fail(label + ': the web app did not answer within ' +
          Math.round(REQUEST_TIMEOUT_MS / 1000) + ' seconds.', { retryable: true });
      }
      return fail(label + ': could not reach the web app.\n' +
        'Serve this page over http or https (not file://), check the URL ends in /exec, ' +
        'and set the deployment to Execute as Me + Anyone.', { retryable: true });
    }

    /* A backend may hand back an expiry; if it does, trust it over our default. */
    function readExpiry(data) {
      if (data.expiresAt) {
        const parsed = Date.parse(data.expiresAt) || Number(data.expiresAt);
        if (parsed > Date.now()) return parsed;
      }
      if (data.expiresIn) {
        const n = Number(data.expiresIn);
        // Accept either seconds or milliseconds.
        if (n > 0) return Date.now() + (n > 1e6 ? n : n * 1000);
      }
      if (data.expiresInMinutes) {
        const minutes = Number(data.expiresInMinutes);
        if (minutes > 0) return Date.now() + minutes * 60 * 1000;
      }
      return null;
    }

    /* Apps Script sometimes answers a POST through a redirect chain that
       re-enters /exec as a GET, which lands in the legacy key-gated doGet and
       returns a bare {error:'Unauthorized'} — no `code`, no detail text. A
       real credential rejection always carries a code (400/401/429) and a
       descriptive message, so a bare 'Unauthorized' is a transport quirk to
       retry, never a reason to tell the user their password is wrong. */
    function isBogusGetAnswer(data) {
      return data && data.code === undefined && String(data.error || '') === 'Unauthorized';
    }

    async function apiLogin(name, username, password) {
      const url = API_URLS[name];
      const label = LABEL_OF[name];
      if (!url || /^(hidden|paste)/i.test(url)) {
        throw fail(label + ': no web app URL set in index.html.', { retryable: false });
      }
      if (url.indexOf('/exec') < 0) {
        throw fail(label + ': the URL must end in /exec, not /dev.', { retryable: false });
      }

      let data;
      for (let attempt = 1; attempt <= 3; attempt++) {
        data = await postJson(url, { action: 'login', username: username, password: password }, label);
        if (!isBogusGetAnswer(data)) break;
        if (attempt === 3) {
          throw fail(label + ': the web app keeps answering through its GET endpoint. ' +
            'Try again in a moment.', { retryable: false });
        }
        await sleep(600 * attempt);
      }
      if (!data.ok || !data.token) {
        throw fail(label + ': ' + (data.error || 'sign in was rejected.'),
          { retryable: false, credentials: true });
      }
      return { token: data.token, expiresAt: readExpiry(data) };
    }

    /* NO warm-up ping here, deliberately. An earlier build pinged the Weekly
       backend the moment the gate appeared, on the theory that it would spin
       up the container before the user pressed Sign in. Measuring it showed
       the opposite: a warm login and a warm ping both cost ~2.7s, so the ping
       saved nothing, while making login the SECOND request in quick
       succession to the same deployment - exactly the burst pattern that
       makes Google answer with an HTML throttling page. The connection is
       still pre-warmed by the <link rel=preconnect> tags below, which cost no
       Apps Script execution at all. */

    /* ============================================================
       3. Frames — one page at a time (pagination)
       ------------------------------------------------------------
       A report loads ONLY when its tab is opened. Nothing is prefetched.

       Opening the hub used to start all four reports, so a person looking at
       one report still spent four Apps Script executions on the same account
       budget - and four requests landing together is exactly the burst that
       makes Google answer with an HTML throttling page instead of data.
       Now opening the hub costs exactly one request: UA, the default page.

       A report that has been opened KEEPS its document, so going back to it
       is instant and costs nothing. Only the first visit to each tab pays a
       load. This is lazy loading, not the old one-at-a-time CHAIN, which is
       a different thing and was removed for good reason: that chain made
       every report wait on the one before it, so a single slow report held
       the rest hostage for minutes. Nothing waits on anything here.
       ============================================================ */
    const frameBase = {};
    REPORT_IDS.forEach((id) => {
      const frame = $('report-' + id);
      if (!frame || !frame.dataset.src) return;
      /* The markup carries the path; the build supplies the version. These
         used to be one hand-edited string per iframe — 'ua_report.html?v=
         20260827-ranked-table-heatmaps-v68' — which meant remembering to bump
         four separate stamps on every deploy, and shipping a stale report to
         everyone whose browser had the old one cached whenever somebody
         forgot. Vite fingerprints the JS and CSS by content; this covers the
         HTML documents themselves, which it cannot. */
      frameBase[id] = frame.dataset.src + '?v=' + encodeURIComponent(BUILD_ID);
    });

    /* True while the sign-in screen is up. */
    function gateOpen() {
      return !$('authGate').classList.contains('done');
    }

    function startFrame(id) {
      const frame = $('report-' + id);
      if (!frame || frame.src) return false;          // already loaded: keep it
      /* HARD GATE — nothing loads behind the sign-in screen.
         Every call site already checks, but the checks were spread across
         showReport(), the prefetch timer and the pageshow restore, and a
         single missed one costs the person a ~340 KB report document plus an
         Apps Script execution while they are still typing a password. One
         refusal here makes that structurally impossible. */
      if (gateOpen()) return false;
      const base = frameBase[id];
      if (!base) return false;
      const backend = BACKEND_OF[id];
      /* A report must not start without a token and fail as "Unauthorized". */
      if (!isAvailable(backend)) return false;
      const join = base.indexOf('?') >= 0 ? '&' : '?';
      /* No cache-buster. UA used to append '&cb=' + Date.now(), which forced
         a fresh download of this ~100 KB document on every hub open while
         Weekly, Till Date and ASO were served from the browser cache - on the
         one report that is the default tab, so it sat directly on the path
         everybody waits for. The '?v=' string in data-src already busts the
         cache on deploy, which is the only time it needs busting. */
      frame.src = base + join + 'api=' + encodeURIComponent(API_URLS[backend]) +
        (id === 'ua' ? '&negativeApi=' + encodeURIComponent(API_URLS.negative) : '');
      frame.removeAttribute('data-src');
      return true;
    }

    function stopFrames() {
      REPORT_IDS.forEach((id) => {
        const frame = $('report-' + id);
        if (!frame) return;
        // about:blank first, or some browsers keep painting the old document.
        try { frame.src = 'about:blank'; } catch (e) {}
        frame.removeAttribute('src');
        frame.dataset.src = frameBase[id];
      });
    }

    /* ============================================================
       4. Report switching
       ============================================================ */
    const reportButtons = document.querySelectorAll('[data-report]');
    let currentReport = 'ua';

    function isAvailable(backend) {
      const rec = readSession();
      return !!(rec && rec.token);
    }

    /* ============================================================
       Background prefetch: UA -> Weekly
       ------------------------------------------------------------
       Weekly is the report people open next, and it is the only one that
       needs more than one request (a payload plus the preset bundle). So as
       soon as UA has settled, Weekly's document is started in a hidden
       iframe. Clicking the Weekly tab then reveals a report that has already
       painted, with no request at all.

       AFTER UA settles, never alongside it. Two reports fetching at once is
       exactly the burst that makes Apps Script answer with an HTML throttling
       page - the "Weekly request interrupted" message. The trigger is UA's
       own mss3d:report-ready. There is deliberately no timeout fallback:
       starting Weekly merely because UA is slow would overlap both Apps
       Script requests and recreate the interruption this sequencing prevents.
       A manual Weekly-tab click still starts Weekly immediately.

       ASO and Till Date are deliberately NOT prefetched. They stay lazy and
       load on their first click, exactly as now.
       ============================================================ */
    const PREFETCH_AFTER = { ua: 'weekly' };
    const prefetchDone = {};

    function schedulePrefetch(afterId) {
      const target = PREFETCH_AFTER[afterId];
      if (!target || prefetchDone[target]) return;

      const go = () => {
        if (prefetchDone[target]) return;
        prefetchDone[target] = true;
        window.removeEventListener('message', onReady);
        /* Never start a report without a token: it would fail as
           "Unauthorized" and burn a request for nothing. Keep the gate check
           as a sign-out can briefly leave a valid-looking session record while
           the sign-in screen is already back up. */
        if (!readSession() || gateOpen()) return;
        const frame = $('report-' + target);
        if (frame && frame.src) return;        // already opened by hand
        startFrame(target);
      };

      const onReady = (ev) => {
        if (ev.origin !== location.origin) return;
        const data = ev.data;
        /* Only the report this handoff is waiting for may release it. */
        if (data && data.type === 'mss3d:report-ready' && data.report === afterId) go();
      };

      window.addEventListener('message', onReady);
    }

    function showReport(id) {
      if (!REPORT_IDS.includes(id)) id = 'ua';
      currentReport = id;

      reportButtons.forEach((button) => {
        const selected = button.dataset.report === id;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
      });

      REPORT_IDS.forEach((other) => {
        const frame = $('report-' + other);
        if (frame) frame.hidden = other !== id;
      });

      const frame = $('report-' + id);

      if (frame && !gateOpen()) {
        /* First visit to this tab: load it now. A tab opened before keeps its
           document, so startFrame() returns false and the report is simply
           revealed - no request, no waiting. */
        const started = startFrame(id);
        const text = $('framePlaceholderText');
        if (text) text.textContent = 'Loading ' + LABEL_OF[BACKEND_OF[id]] + '…';
        $('framePlaceholder').classList.toggle('show', started || !frame.src);
        if (started) frame.addEventListener('load', () => $('framePlaceholder').classList.remove('show'), { once: true });
        else $('framePlaceholder').classList.remove('show');

        /* Queue the next report's document once this one is on its way. */
        if (started) schedulePrefetch(id);

        /* A chart built while its iframe was display:none has zero width.
           Nudging the document on show makes Chart.js re-measure. */
        try {
          const win = frame.contentWindow;
          if (win) requestAnimationFrame(() => {
            try { win.dispatchEvent(new Event('resize')); } catch (e) {}
          });
        } catch (e) { /* cross-origin, nothing to do */ }
      }

      try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// */ }
    }

    /* ============================================================
       5. Sign in / sign out
       ============================================================ */
    let signingIn = false;

    function setNote(text) {
      const note = $('hubNote');
      if (!text) { note.classList.remove('show'); return; }
      $('hubNoteText').textContent = text;
      note.classList.add('show');
    }

    function applyAvailability() {
      reportButtons.forEach((button) => {
        const backend = BACKEND_OF[button.dataset.report];
        const ok = isAvailable(backend);
        /* A pending backend is a loading state, not a reason to lock report
           navigation. Clicking it opens that report and it starts as soon as
           background authentication supplies the token. */
        button.disabled = false;
        button.setAttribute('aria-disabled', 'false');
        button.title = ok ? '' : LABEL_OF[backend] + ' is connecting\u2026';
      });
    }

    function openHub(preferred) {
      $('authGate').classList.add('done');
      applyAvailability();

      /* UA is the default page. showReport() loads it and nothing else; the
         other tabs load on their first click. */
      const target = preferred === 'ua' ? 'ua' : currentReport;
      showReport(REPORT_IDS.includes(target) ? target : 'ua');
      setNote('');
    }

    function showGate(message) {
      $('authGate').classList.remove('done');
      $('framePlaceholder').classList.remove('show');
      setNote('');
      const msg = $('authMsg');
      msg.style.color = message ? '#ffb800' : '#ff4d6d';
      msg.textContent = message || '';
      $('authPass').value = '';
      const focusTarget = $('authUser').value ? $('authPass') : $('authUser');
      setTimeout(() => focusTarget.focus(), 0);
    }

    async function doLogin() {
      if (signingIn) return;

      const button = $('authBtn');
      const user = $('authUser').value.trim();
      const pass = $('authPass').value;
      const msg = $('authMsg');

      if (!user || !pass) {
        msg.style.color = '#ff4d6d';
        msg.textContent = 'Enter your username and password.';
        return;
      }

      signingIn = true;
      button.disabled = true;
      msg.style.color = '#7589a8';
      msg.textContent = 'Signing in\u2026';

      try {
        /*
         * WEEKLY is the single authentication authority — the Authentication
         * sheet lives in the Weekly spreadsheet, whose id all three Auth.gs
         * files carry. UA, Till Date and ASO validate this same signed token
         * locally; none of them log in again.
         */
        const login = await apiLogin(AUTH_BACKEND, user, pass);
        writeSession(login.token, login.expiresAt);
        $('authPass').value = '';
        msg.textContent = '';
        openHub('ua');
      } catch (err) {
        clearSession();
        msg.style.color = '#ff4d6d';
        msg.textContent = err.message || 'Sign in failed.';
      } finally {
        signingIn = false;
        button.disabled = false;
      }
    }

    function doLogout() {
      clearSession();
      stopFrames();
      location.reload();
    }

    /* Session ran out while the hub was open. Reports would start failing one
       request at a time; take the session down cleanly instead. */
    function handleExpiry() {
      clearSession();
      stopFrames();
      showGate('Your session ended. Sign in again to reload the reports.');
    }

    /* Confirms a restored token is still accepted by the auth authority.
       Only a definite "no" from the server ends the session — a network
       hiccup must never log out a working dashboard. */
    async function verifySessionInBackground(token) {
      try {
        const data = await postJson(API_URLS[AUTH_BACKEND], { action: 'ping', token: token }, 'Session check');
        if (data && data.ok && data.authed === false) handleExpiry();
      } catch (e) { /* unreachable backend: keep the session, reports will retry */ }
    }

    setInterval(() => {
      if (!gateOpen() && !readSession()) handleExpiry();
    }, 60000);

    /* A report can ask the hub to re-check the session — same-origin only. */
    window.addEventListener('message', (ev) => {
      if (ev.origin !== location.origin) return;
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'mss3d:session-expired') { handleExpiry(); return; }
      if (data.type === 'mss3d:need-token') {
        const rec = readSession();
        if (rec) mirrorToSession(rec); else handleExpiry();
        return;
      }
      if (data.type === 'mss3d:report-ready') {
        /* Nothing to start: reports load only when their tab is opened. The
           message still arrives, and clearing the placeholder here covers the
           case where a report finishes rendering after its iframe 'load'
           event has already fired. */
        if (data.report && BACKEND_OF[currentReport] &&
            $('report-' + currentReport) && $('report-' + currentReport).src) {
          $('framePlaceholder').classList.remove('show');
        }
      }
    });

    /* Another tab signed out, or signed in. Follow it. */
    window.addEventListener('storage', (ev) => {
      if (ev.key !== AUTH_KEY) return;
      const rec = readSession();
      if (rec) { mirrorToSession(rec); }
      else if ($('authGate').classList.contains('done')) { handleExpiry(); }
    });

    /* Reconcile both storage and visible UI whenever Chrome restores this
       document from its back/forward cache. Merely mirroring tokens left a
       restored tab showing whichever screen it had before it was cached. */
    window.addEventListener('pageshow', (ev) => {
      const rec = readSession();
      if (rec) {
        mirrorToSession(rec);
        if (!$('authGate').classList.contains('done')) openHub(currentReport);
      } else {
        clearSession();
        if ($('authGate').classList.contains('done') || ev.persisted) {
          stopFrames();
          showGate();
        }
      }
    });

    /* ---- wiring ---- */
    reportButtons.forEach((button) => {
      button.addEventListener('click', () => {
        showReport(button.dataset.report);
      });
    });

    $('authBtn').addEventListener('click', doLogin);
    $('authOut').addEventListener('click', doLogout);
    $('hubNoteAction').addEventListener('click', () => { clearSession(); stopFrames(); showGate(); });
    $('themeBtn').addEventListener('click', () => window.toggleThemeGlobal());
    ['authUser', 'authPass'].forEach((id) => {
      $(id).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doLogin(); });
    });

    /* ---- boot ---- */
    const requested = location.hash.slice(1);
    currentReport = REPORT_IDS.includes(requested) ? requested : 'ua';

    /* Shaving a round trip off the first request: warm the TLS connection to
       the Apps Script host while the user is still typing. */
    (function preconnect() {
      const seen = new Set();
      Object.values(API_URLS).forEach((url) => {
        if (!url || url.indexOf('http') !== 0) return;
        let origin;
        try { origin = new URL(url).origin; } catch (e) { return; }
        if (seen.has(origin)) return;
        seen.add(origin);
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = origin;
        link.crossOrigin = '';
        document.head.appendChild(link);
      });
    })();

    /* A stored session that has not expired is trusted immediately, so a
       reload never shows the login gate for no reason — that forced re-login
       was what made signing in feel random, and the localStorage wipe it did
       here fired a `storage` event that killed the session in EVERY OTHER
       open tab, which surfaced there as a connection error mid-load.
       The token is still verified in the background against the auth
       authority; a token the server no longer accepts closes the session
       cleanly within a second or two. */
    const existing = readSession();
    if (existing) {
      mirrorToSession(existing);
      openHub(currentReport);
      schedulePrefetch(currentReport);
      verifySessionInBackground(existing.token);
    } else {
      clearSession();          // drop half-written tokens from an earlier attempt
      /* Gate FIRST. showReport() is layout-only while the gate is up, because
         startFrame() refuses, but doing it in this order makes that a
         guarantee rather than something that happens to hold. */
      showGate();
      showReport(currentReport);
    }
  })();
