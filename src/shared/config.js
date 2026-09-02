/**
 * config.js — where the Apps Script endpoints come from.
 *
 * They used to be six literals in index.html. In a public repository that
 * publishes the endpoints to anyone who opens the file, so they are read from
 * the build environment instead: .env.local in development, GitHub Actions
 * secrets in CI. See .env.example for the full explanation of what is and is
 * not secret about them.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time, so the values still end
 * up in the shipped bundle — that is unavoidable for a static site that talks
 * to these endpoints from the browser. What changes is that the repository
 * itself no longer carries them, so forks, clones and the commit history stay
 * clean, and rotating a deployment is a secret change rather than a commit.
 */

export const API_URLS = {
  /* The login-only deployment: a standalone project with no bound workbook and
     one daily trigger. Sign-in used to run on 'negative', which has seven
     triggers including onWorkbookChange — so any edit to that workbook could
     make a login queue behind a full rebuild. That is what made signing in
     feel random. */
  auth: import.meta.env.VITE_API_AUTH,
  ua: import.meta.env.VITE_API_UA,
  weekly: import.meta.env.VITE_API_WEEKLY,
  tilldate: import.meta.env.VITE_API_TILLDATE,
  aso: import.meta.env.VITE_API_ASO,
  negative: import.meta.env.VITE_API_NEGATIVE,
  game: import.meta.env.VITE_API_GAME,
};

/**
 * The shared key game-analytics puts on every request as `key=`.
 *
 * It is here for the same reason the URLs are: to keep it out of the
 * repository. It should not be read as a security control. A static site
 * cannot hold a secret — Vite inlines this into the bundle, and anyone who
 * opens the page can read it — so what this actually is today is a password
 * that every visitor already has.
 *
 * It exists because the deployed Apps Script still checks it. Replacing it
 * with a per-user session token, so that authorisation belongs to the person
 * rather than the page, is the security work that follows this migration.
 */
export const GAME_API_KEY = import.meta.env.VITE_API_GAME_KEY || '';

/**
 * A missing endpoint used to surface deep inside a report as an unexplained
 * "could not reach the web app". Checking here turns a mis-set secret into one
 * clear message at boot, naming the variable that is missing.
 */
export function assertConfigured() {
  const missing = Object.entries(API_URLS)
    .filter(([, url]) => !url || /REPLACE_ME/.test(url))
    .map(([name]) => `VITE_API_${name.toUpperCase()}`);

  if (missing.length) {
    throw new Error(
      'These build variables are not set: ' + missing.join(', ') + '.\n' +
      'Copy .env.example to .env.local and fill in the /exec URLs, or add them ' +
      'as repository secrets if this is a CI build.'
    );
  }

  const bad = Object.entries(API_URLS)
    .filter(([, url]) => url && url.indexOf('/exec') < 0)
    .map(([name]) => name);

  if (bad.length) {
    throw new Error(
      'These endpoints do not end in /exec: ' + bad.join(', ') + '. ' +
      'A /dev URL only works for the account that owns the script.'
    );
  }
}

/** Stamped into iframe URLs so a deploy busts the browser cache exactly once. */
export const BUILD_ID = import.meta.env.VITE_BUILD_ID || 'dev';
