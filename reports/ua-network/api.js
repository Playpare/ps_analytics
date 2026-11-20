/**
 * UA Network Performance - reaching the backend.
 *
 * Kept apart from ua-network.js, which holds the arithmetic. That split is
 * not tidiness: config.js reads `import.meta.env`, which Vite replaces at
 * build time and which is simply undefined under Node. With the two in one
 * file, importing a function that only divides two numbers pulled in the
 * build environment, and the arithmetic could not be tested without a
 * browser. The sums are the part most worth testing.
 */

import { API_URLS, GAME_API_KEY } from '../../src/shared/config.js';

/* ====================================================================
   DATA
   ==================================================================== */

const qs = new URLSearchParams(location.search);

const API = {
  /* ?api= when the shell opened this report; the build-time value when the
     page is opened directly in development. */
  url: qs.get('api') || API_URLS.game || '',
  key: qs.get('key') || GAME_API_KEY || '',
  get token() {
    try { return sessionStorage.getItem('mss3d_token') || ''; } catch (e) { return ''; }
  }
};

const GAME_IDS = { android: 'mss_android', ios: 'mss_ios' };

const iso = (d) => d.getFullYear() + '-'
  + String(d.getMonth() + 1).padStart(2, '0') + '-'
  + String(d.getDate()).padStart(2, '0');

/**
 * The two windows, both ending on the last finished day.
 *
 * Today is excluded on purpose: a part-finished day is always down against a
 * whole one, and a page whose top-line figure falls every morning and
 * recovers overnight teaches people to ignore it.
 */
function windows(days) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return {
    cur:  { from: iso(start),     to: iso(end) },
    prev: { from: iso(prevStart), to: iso(prevEnd) }
  };
}

async function fetchWindow(gameId, win) {
  if (!API.url) throw new Error('No API URL — open this report from the dashboard, not on its own.');
  if (!API.token) throw new Error('Not signed in — open the dashboard and sign in.');

  const params = [
    'action=fetchAll',
    'gameId=' + encodeURIComponent(gameId),
    'from=' + encodeURIComponent(win.from),
    'to=' + encodeURIComponent(win.to),
    'token=' + encodeURIComponent(API.token),
    API.key ? 'key=' + encodeURIComponent(API.key) : '',
    '_cb=' + Date.now()
  ].filter(Boolean).join('&');

  const res = await fetch(API.url + '?' + params, { redirect: 'follow', cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from the game backend');
  const body = (await res.text()).trim();
  /* Apps Script answers an unauthorised or throttled request with an HTML
     page and a 200, so the status alone proves nothing. */
  if (body.charAt(0) === '<') {
    throw new Error('The backend returned a web page instead of data. It may need redeploying, or the sign-in may have expired.');
  }
  let data;
  try { data = JSON.parse(body); } catch (e) {
    throw new Error('The backend returned something that is not JSON.');
  }
  /* It reports its refusals in the body, also with a 200. */
  if (data && data.error) throw new Error(String(data.error));
  return data || {};
}

export { API, GAME_IDS, windows, fetchWindow, iso };
