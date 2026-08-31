/**
 * snapshot.js - the one disk-cache + boot sequence for every report.
 *
 * This was `snapshot-client.js`, pasted byte-identically into ua_report.html,
 * weekly_report.html and aso_report.html. Three copies meant three places to
 * fix a caching bug and three chances to fix only two of them. It is one
 * module now; the body below is unchanged from those copies.
 *
 * It publishes `window.SnapshotStore` and `window.SnapshotBoot` exactly as
 * before, because the report code that calls them still refers to them as
 * globals. Importing this module for its side effects is what installs them,
 * so it must be imported before any report code that uses them.
 */
/**
 * ============================================================
 * snapshot-client.js â€” one cache layer for every report
 * ------------------------------------------------------------
 * Paste this inside a <script> tag in weekly_report.html and
 * ua_report.html, ABOVE their existing code. It defines two globals:
 *
 *   SnapshotStore   IndexedDB read/write
 *   SnapshotBoot    the paint-first-verify-after load sequence
 *
 * WHY INDEXEDDB AND NOT localStorage
 *
 * The hub and all four reports share one origin, so they share ONE
 * localStorage quota of about 5MB. Weekly's payloads are 47-73KB each and
 * its persistence code already has to handle running out of room: on a
 * quota error persistSave() wipes every stored range and keeps only the one
 * it was writing. UA's payload is around 1MB, which is why ua_report.html
 * never even tried to persist and refetched on every single load.
 *
 * IndexedDB gives hundreds of megabytes, is asynchronous so it never blocks
 * the first paint, and stores real objects - so a 1MB payload costs no
 * JSON.stringify on write and no JSON.parse on read.
 *
 * WHAT THE BOOT SEQUENCE DOES
 *
 * Old order: ask the server, wait, then paint. A cold morning meant a
 * spinner for 40-90 seconds and sometimes an error.
 *
 * New order: paint whatever is on disk immediately, THEN check whether it is
 * still current. The check is one request that answers `unchanged` in about
 * 90 bytes without the server opening a spreadsheet, so the usual outcome is
 * that nothing else happens and the user never sees a loading state at all.
 *
 * And after the first check of the day, even that request is skipped: a copy
 * verified after today's data hour is trusted until tomorrow.
 * ============================================================ */

(function () {
  'use strict';

  /* The hour the daily sync finishes. weekly_report.html used 9, which was
     wrong in both directions: the sync lands 06:00-08:00, so anyone opening
     between 07:00 and 09:00 was served a copy marked stale, and the refetch
     it triggered landed on top of the 08:30 warm. */
  const DATA_HOUR = 8;

  const DB_NAME = 'mss3d';
  const DB_VERSION = 1;
  const STORE = 'snapshots';

  /* ============================================================
   * 1. IndexedDB
   * ============================================================ */

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }

      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      /* Another tab is holding an old version open. Rather than hang, give
         up and run without a disk cache - the report still works, it just
         pays the network once. */
      req.onblocked = function () { reject(new Error('IndexedDB blocked')); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let out;
        try { out = fn(store); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('aborted')); };
      });
    });
  }

  const SnapshotStore = {
    /** Returns the stored record, or null. Never throws. */
    get: function (name) {
      return tx('readonly', function (s) { return s.get(name); })
        .catch(function () { return null; });
    },
    /** Returns true on success. Never throws. */
    put: function (name, record) {
      return tx('readwrite', function (s) { return s.put(record, name); })
        .then(function () { return true; })
        .catch(function (e) {
          console.warn('[snapshot] could not persist:', e && e.message);
          return false;
        });
    },
    clear: function (name) {
      return tx('readwrite', function (s) { return s.delete(name); })
        .then(function () { return true; })
        .catch(function () { return false; });
    },
    /**
     * One-time cleanup of the localStorage tier this replaces. Safe to call
     * on every boot; it only removes keys this project wrote.
     */
    evictLegacy: function (prefixes) {
      try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          for (let j = 0; j < prefixes.length; j++) {
            if (k.indexOf(prefixes[j]) === 0) { doomed.push(k); break; }
          }
        }
        doomed.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
        return doomed.length;
      } catch (e) { return 0; }
    }
  };

  /* ============================================================
   * 2. The daily boundary
   * ============================================================ */

  /**
   * The most recent DATA_HOUR that has actually happened.
   *
   * Before 08:00 the day's boundary is still ahead of us, so yesterday's is
   * the one in force - otherwise every load between midnight and 08:00 would
   * look stale and send a request for data that has not been replaced yet.
   */
  function dataBoundary() {
    const now = new Date();
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate(), DATA_HOUR, 0, 0, 0);
    if (b.getTime() > now.getTime()) b.setDate(b.getDate() - 1);
    return b.getTime();
  }

  /** True when this record was verified against the server after the boundary. */
  function verifiedToday(record) {
    return !!record && Number(record.checkedAt) >= dataBoundary();
  }

  /* ============================================================
   * 3. The boot sequence
   * ============================================================ */

  /**
   * Loads a report, painting from disk first whenever possible.
   *
   * @param {Object} opts
   *   name      {string}   IndexedDB key for this report ('weekly' | 'ua')
   *   request   {Function} (stamp) => Promise<serverResponse>
   *   render    {Function} (data, meta) => void        MUST be synchronous-safe
   *   onStatus  {Function} (text, kind) => void        optional
   *   alwaysCheck {boolean} skip the once-a-day shortcut (default false)
   *
   * The server response is expected to be either
   *   { unchanged:true, stamp }
   * or
   *   { stamp, complete, presets|datasets, retryAfter }
   *
   * @return {Promise<{source:string, stamp:string}>}
   */
  async function load(opts) {
    const name = opts.name;
    const say = opts.onStatus || function () {};

    let stored = null;
    try { stored = await SnapshotStore.get(name); } catch (e) { stored = null; }

    /* ---- Fast path: painted from disk, no network at all ---------------
       A copy verified after this morning's boundary is correct until
       tomorrow, because the sheets are append-only and appended to once a
       day. This is what almost every load after the first one hits. */
    if (stored && stored.data && verifiedToday(stored) && !opts.alwaysCheck) {
      opts.render(stored.data, { source: 'disk', stamp: stored.stamp, builtAt: stored.builtAt });
      say('');
      return { source: 'disk', stamp: stored.stamp };
    }

    /* ---- Paint anything we have, THEN verify --------------------------
       Even a copy from last week is better than a spinner: it is on screen
       in a few milliseconds and gets corrected a moment later if it is
       wrong. The old code showed nothing until the server answered. */
    let painted = false;
    if (stored && stored.data) {
      opts.render(stored.data, { source: 'disk-stale', stamp: stored.stamp, builtAt: stored.builtAt });
      painted = true;
      say('Checking for new data\u2026', 'busy');
    } else {
      say('Loading\u2026', 'busy');
    }

    let res;
    try {
      res = await opts.request(stored && stored.stamp ? stored.stamp : '');
    } catch (err) {
      /* A failed check when we already have something on screen is a
         non-event. Say so quietly and keep the painted view. */
      if (painted) {
        say('Showing your saved copy \u2014 could not reach the server.', 'warn');
        return { source: 'disk-stale', stamp: stored.stamp };
      }
      throw err;
    }

    /* ---- Still current -------------------------------------------------
       Stamp the record so the rest of today takes the fast path above. */
    if (res && res.unchanged) {
      await SnapshotStore.put(name, {
        stamp: stored.stamp,
        builtAt: res.builtAt || stored.builtAt || 0,
        checkedAt: Date.now(),
        data: stored.data
      });
      if (!painted) opts.render(stored.data, { source: 'disk', stamp: stored.stamp });
      say('');
      return { source: 'disk-verified', stamp: stored.stamp };
    }

    /* ---- New data ------------------------------------------------------ */
    const data = opts.extract ? opts.extract(res) : res;
    opts.render(data, { source: 'network', stamp: res.stamp, builtAt: res.builtAt });

    /* A partial answer is stored anyway - a browser with four of five
       presets is better off than one with none - but NOT marked as verified,
       so the next load checks again instead of trusting a gap. */
    await SnapshotStore.put(name, {
      stamp: res.stamp,
      builtAt: res.builtAt || 0,
      checkedAt: res.complete === false ? 0 : Date.now(),
      data: data
    });

    if (res.complete === false) {
      say('Some views are still being prepared\u2026', 'busy');
      scheduleRecheck(opts, res.retryAfter || 45);
    } else {
      say('');
    }

    return { source: 'network', stamp: res.stamp };
  }

  /**
   * Comes back for the rest of a partial bundle, once, quietly.
   *
   * Deliberately not a loop: the warm either finishes in the next minute or
   * something is wrong, and a page that keeps polling all afternoon is how a
   * quiet problem turns into a throttled deployment.
   */
  function scheduleRecheck(opts, seconds) {
    setTimeout(function () {
      load(Object.assign({}, opts, { alwaysCheck: true })).catch(function () {});
    }, Math.max(10, seconds) * 1000);
  }

  /**
   * The Refresh button: ask the server to rebuild, then poll the stamp.
   *
   * Nothing blocks. The current view stays on screen and readable for the
   * whole rebuild.
   *
   * @param {Object} opts   same shape as load(), plus:
   *   forceRequest {Function} () => Promise<{status, retryAfter}>
   *   stampRequest {Function} () => Promise<{stamp}>
   */
  async function refresh(opts) {
    const say = opts.onStatus || function () {};
    const before = await SnapshotStore.get(opts.name);
    const beforeStamp = before && before.stamp;

    say('Rebuilding from the sheet\u2026', 'busy');

    let ack;
    try { ack = await opts.forceRequest(); }
    catch (err) { say('Could not start a rebuild: ' + (err.message || err), 'error'); return false; }

    if (ack && ack.status === 'THROTTLED') {
      say('A rebuild just ran. Try again in about ' +
          Math.ceil((ack.retryAfter || 300) / 60) + ' minute(s).', 'warn');
      return false;
    }

    /* Poll the cheap stamp action, not the payload. Each poll is a Script
       Property read - it never opens the workbook and never builds. */
    const deadline = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(function (r) { setTimeout(r, 10000); });
      let now;
      try { now = await opts.stampRequest(); } catch (e) { continue; }
      if (now && now.stamp && now.stamp !== beforeStamp) {
        await SnapshotStore.clear(opts.name);
        await load(Object.assign({}, opts, { alwaysCheck: true }));
        return true;
      }
    }

    say('The rebuild is taking longer than usual. Your current view is still accurate ' +
        'as of the last sync.', 'warn');
    return false;
  }

  /* ============================================================
   * 4. Export
   * ============================================================ */

  window.SnapshotStore = SnapshotStore;
  window.SnapshotBoot = {
    load: load,
    refresh: refresh,
    dataBoundary: dataBoundary,
    verifiedToday: verifiedToday,
    DATA_HOUR: DATA_HOUR
  };
})();