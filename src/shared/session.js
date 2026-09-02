/**
 * session.js — the one signed-in session the whole app shares.
 *
 * One Apps Script deployment issues a token; UA, Weekly, Till Date, ASO,
 * Negative Spend and Game Analytics all verify that same HMAC signature
 * locally against a shared AUTH_HMAC_SECRET_V1. So a person signs in once and
 * every report opens — nobody calls anybody else at request time.
 *
 * THE STORAGE MODEL IS A CONTRACT, NOT A PREFERENCE
 * -------------------------------------------------
 * Two places, on purpose, and both are load-bearing:
 *
 *   localStorage['mss3d_auth_v4']   the durable record {token, savedAt, expiresAt}
 *   sessionStorage['mss3d_token']   the bare token string
 *
 * The durable copy exists because sessionStorage alone loses the session on
 * every new tab, bookmark and window restore, which is what used to make
 * signing in feel random. The sessionStorage mirror exists because that is
 * where every report already looks, and changing that key would mean editing
 * five reports to fix one.
 *
 * Any code that writes a token must write BOTH. writeSession() does.
 *
 * Extracted from src/hub/hub.js, which still carries its own copy. Migrating
 * the hub onto this module is a separate change — doing it in the same commit
 * that introduces the module would put the one working sign-in at risk to save
 * a duplicate that has been harmless for months.
 */

/** Where the reports look. Changing this breaks all of them at once. */
export const AUTH_TOKEN_KEY = 'mss3d_token';

/** The durable record. The v4 suffix forced one clean sign-in when the app
    moved from three project-local tokens to one shared signed token. */
const AUTH_KEY = 'mss3d_auth_v4';

/** Matches AUTH.TTL_MINUTES in Auth.gs. Used only when the server does not say. */
export const DEFAULT_SESSION_MS = 480 * 60 * 1000;

/* Apps Script cold starts are slow, so a sign-in gets room before giving up. */
const REQUEST_TIMEOUT_MS = 50000;
const REQUEST_RETRIES = 2;

/**
 * The live session, or null.
 *
 * The expiry is capped by savedAt + DEFAULT_SESSION_MS as well as by the
 * server's own figure. An older build stored 8-hour expiries while the server
 * was issuing 2-hour tokens, so a stale record could hide the login gate long
 * after the session had actually ended — the user then met "session expired"
 * on every panel instead of a sign-in box.
 */
export function readSession() {
  let raw = null;
  try { raw = localStorage.getItem(AUTH_KEY); } catch (e) { /* storage blocked */ }
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    if (!rec || !rec.token || typeof rec.token !== 'string') return null;
    const trustedUntil = Math.min(
      Number(rec.expiresAt) || 0,
      (Number(rec.savedAt) || 0) + DEFAULT_SESSION_MS
    );
    if (!trustedUntil || trustedUntil <= Date.now()) return null;
    rec.expiresAt = trustedUntil;
    return rec;
  } catch (e) { return null; }
}

/** Stores a token in both places. Returns the record it wrote. */
export function writeSession(token, expiresAt) {
  const rec = {
    token: token,
    savedAt: Date.now(),
    expiresAt: expiresAt || (Date.now() + DEFAULT_SESSION_MS)
  };
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(rec)); } catch (e) { /* blocked */ }
  mirrorToSession(rec);
  return rec;
}

/** Republishes the token where the reports read it. */
export function mirrorToSession(rec) {
  const token = rec && rec.token ? rec.token : null;
  try {
    if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    else sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch (e) { /* storage blocked */ }
}

/** Ends the session everywhere, including keys older builds left behind. */
export function clearSession() {
  try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
  try { sessionStorage.removeItem(AUTH_TOKEN_KEY); } catch (e) {}
  ['tok_ua', 'tok_weekly', 'tok_tilldate', 'gd_session'].forEach((key) => {
    try { sessionStorage.removeItem(key); } catch (e) {}
  });
}

/** The token to put on a request, or '' when signed out. */
export function getToken() {
  const rec = readSession();
  if (rec) {
    // A different tab may have signed in since this one loaded.
    mirrorToSession(rec);
    return rec.token;
  }
  try { return sessionStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch (e) { return ''; }
}

/**
 * POST to an Apps Script web app.
 *
 * text/plain is deliberate and must not be "corrected" to application/json:
 * a JSON content type triggers a CORS preflight, and Apps Script web apps do
 * not answer OPTIONS. The request would fail before it was ever sent.
 */
export async function postJson(url, payload) {
  let lastError;

  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timer);
      const body = (await res.text()).trim();
      try {
        return JSON.parse(body);
      } catch (e) {
        // Apps Script answers overload and some errors with an HTML page.
        throw new Error(
          body.slice(0, 120).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ||
          ('HTTP ' + res.status)
        );
      }
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < REQUEST_RETRIES) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('Request failed');
}

/** When the server's answer says the session ends, in epoch ms. */
export function readExpiry(data) {
  if (data && data.expiresAt) {
    const parsed = Date.parse(data.expiresAt) || Number(data.expiresAt);
    if (parsed > Date.now()) return parsed;
  }
  // Auth.gs reports expiresInMinutes rather than an absolute time.
  const mins = Number(data && data.expiresInMinutes);
  if (mins > 0) return Date.now() + mins * 60000;
  return Date.now() + DEFAULT_SESSION_MS;
}

/**
 * Signs in against the token-issuing deployment and stores the result.
 *
 * The password is sent AS TYPED. Hashing it in the browser would be worse
 * than useless: the server compares against whatever it receives, so the hash
 * would simply become the password — stealing it would be enough to sign in,
 * without ever knowing what the user typed.
 *
 * Throws with the server's own message on rejection, so the caller can show
 * "Invalid username or password" rather than inventing one.
 */
export async function login(authUrl, username, password) {
  if (!authUrl) throw new Error('No sign-in endpoint configured (VITE_API_AUTH).');

  const data = await postJson(authUrl, {
    action: 'login',
    username: String(username || '').trim(),
    password: String(password || '')
  });

  if (!data || !data.ok || !data.token) {
    throw new Error((data && data.error) || 'Sign in was rejected.');
  }

  writeSession(data.token, readExpiry(data));
  return {
    token: data.token,
    username: (data.user && data.user.username) || String(username || '').trim()
  };
}
