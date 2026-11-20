/* ═══════════════════════════════════════════════
   session.js — REPLACES login.js
   ───────────────────────────────────────────────
   This page no longer signs anybody in.

   It used to carry a whole sign-in: an email/password form, a SHA-256 hash
   check against a DashUsers tab, lockout counters in localStorage, and its
   own session record under 'ed_session'. That was a SECOND FRONT DOOR into
   the same analytics - separate from the one Playspare Pulse already had,
   aging separately, and another place to edit whenever a login rule changed.

   Now there is one door. Pulse's auth deployment signs people in and issues
   an HMAC-signed token; this page reads that token and verifies nothing
   itself. Verification happens where it can actually be trusted - in the
   Apps Script backend, which holds AUTH_HMAC_SECRET_V1.

   WHERE THE TOKEN LIVES (a contract, see src/shared/session.js)
     sessionStorage['mss3d_token']   the bare token - what every report reads
     localStorage['mss3d_auth_v4']   the durable {token, savedAt, expiresAt}

   Both are read here, sessionStorage first. The durable copy is the fallback
   because sessionStorage does not survive a new tab or a window restore, and
   this page can be opened in its own tab as well as inside the Pulse shell.

   ROLE IS NOT IN THE TOKEN, and that is the one thing that changed shape.
   The signed payload carries { username, issued, expires, version } and
   nothing else - auth-host sends role and games beside the token at sign-in,
   and Pulse does not persist them. So this page cannot know, client side,
   whether you are an admin.

   That costs less than it sounds. The admin gate on Targets was never a
   security control - a viewer could show the tab from the console in one
   line. The real gate is in the backend, which looks the username up in
   DashUsers on every saveTargets. So the tab is shown to everyone and a
   viewer is refused by the server, in words, when they try to save. User
   Management is gone from this page entirely: Pulse has one, on the same
   DashUsers sheet, and two of them editing one list is how a list rots.
═══════════════════════════════════════════════ */

const AUTH_TOKEN_KEY  = 'mss3d_token';
const AUTH_RECORD_KEY = 'mss3d_auth_v4';

/** The signed token Pulse wrote, or '' if nobody is signed in here. */
function readPulseToken() {
  try {
    const t = sessionStorage.getItem(AUTH_TOKEN_KEY);
    if (t) return t;
  } catch (e) { /* storage blocked - fall through to the durable copy */ }
  try {
    const rec = JSON.parse(localStorage.getItem(AUTH_RECORD_KEY) || 'null');
    if (rec && typeof rec.token === 'string' && rec.token &&
        (!Number(rec.expiresAt) || Number(rec.expiresAt) > Date.now())) {
      return rec.token;
    }
  } catch (e) { /* no durable copy either */ }
  return '';
}

/**
 * The token's payload, unverified.
 *
 * UNVERIFIED IS THE POINT. The signature cannot be checked in a browser - the
 * secret that would check it is the one thing a static page must never hold.
 * So this reads the payload only to fill in a name and an expiry for the UI,
 * and every request still carries the whole token for the backend to verify.
 * Nothing here is allowed to decide what data anyone may see.
 */
function tokenPayload(token) {
  const part = String(token || '').split('.')[0];
  if (!part) return null;
  try {
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}

/** The live session, or null. Shape kept from the old ed_session record so
    nothing downstream of getSession() had to change. */
function getSession() {
  const token = readPulseToken();
  if (!token) return null;
  const p = tokenPayload(token);
  if (!p || !p.username) return null;
  const expires = Number(p.expires) || 0;
  if (expires && Date.now() >= expires) return null;
  return {
    email:   String(p.username),
    name:    String(p.username).split('@')[0],
    role:    '',          // not in the token; the backend decides
    token:   token,
    expires: expires
  };
}

function getToken() { return (getSession() || {}).token || ''; }

/** Signs out of PULSE, not just this page - there is only one session now. */
function clearSession() {
  try { sessionStorage.removeItem(AUTH_TOKEN_KEY); } catch (e) {}
  try { localStorage.removeItem(AUTH_RECORD_KEY); } catch (e) {}
}

/* ── Showing the app, or explaining why it is not shown ───────────────── */

function enterApp(session) {
  g('app').style.display = 'block';
  const gate = g('authGate');
  if (gate) gate.style.display = 'none';

  const pill = g('rolePill');
  if (pill) {
    pill.textContent = 'SIGNED IN';
    pill.className = 'rolePill rViewer';
  }
  const uname = g('unameEl');
  if (uname) uname.textContent = session.name || session.email;

  if (session.expires) {
    const remaining = session.expires - Date.now();
    /* setTimeout saturates past ~24.8 days and would fire immediately. A
       token lasts hours, but a clock-skewed machine can produce anything. */
    if (remaining > 0 && remaining < 2147483647) {
      setTimeout(() => {
        toast('Session expired. Sign in again from Playspare Pulse.', 'warn');
        setTimeout(doLogout, 3000);
      }, remaining);
    }
  }

  setupAutoRefresh();
  loadData();
}

/** True if a session was found and the app was shown. */
function checkSession() {
  const session = getSession();
  if (!session) return false;
  CU = { u: session.email, name: session.name, r: session.role };
  enterApp(session);
  return true;
}

/**
 * Shown when there is no token.
 *
 * Framed inside Pulse this should never appear - the shell does not render a
 * section until somebody is signed in. It appears when this page is opened on
 * its own, and then a login form would be the wrong answer: there is nothing
 * here to log in to any more.
 */
function showAuthGate(reason) {
  const gate = g('authGate');
  if (!gate) return;
  const msg = g('authGateMsg');
  if (msg && reason) msg.textContent = reason;
  gate.style.display = 'flex';
  g('app').style.display = 'none';
}

function doLogout() {
  clearSession();
  CU = null;
  clearInterval(refreshTimer);
  showAuthGate('You have been signed out.');
  /* Inside the Pulse shell, tell it as well - otherwise its nav still looks
     signed in while every panel behind it has stopped answering. */
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'ps-signed-out' }, location.origin);
    }
  } catch (e) { /* cross-origin parent - nothing to tell */ }
}

/**
 * file:// cannot reach the Apps Script endpoint; fetch fails with no useful
 * error. Kept from login.js because the failure is still possible and still
 * unexplained without it.
 */
function showFileProtocolWarning() {
  showAuthGate('Open this through Playspare Pulse, not as a file on disk - '
    + 'a file:// page cannot reach the Apps Script endpoint.');
}
