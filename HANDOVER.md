# Handover — MSS3D analytics

Everything a new maintainer needs to take this over. Read the whole thing
before changing anything; several of the notes below are about faults that
have already been made here and cost time to find.

---

## There is no single file. There are two repositories.

| | |
|---|---|
| **Frontend** | https://github.com/Playpare/ps_analytics |
| **Backend** | https://github.com/Playpare/ps_analytics_backend |

Both are current as of this document. Nothing is outstanding in either — no
open pull requests, no unmerged branches carrying work.

```
git clone https://github.com/Playpare/ps_analytics.git
git clone https://github.com/Playpare/ps_analytics_backend.git
```

Ask the repo owner for access to the `Playpare` org. Ask separately for the
Apps Script projects and the Google Sheets they read — repo access does not
carry either.

---

## Deploying is a separate step from merging

**Merging to `main` does not put anything live.** The backend runs in Google
Apps Script, and the repo is a mirror of it. Pushing is a separate act:

```bash
cd ps-analytics-backend/projects/game-dashboard && npx clasp push
```

And then — this is the part that catches people — **`clasp push` updates
*Head*, not the deployed *Version*.** `doPost` serves whichever Version was
last deployed, so a pushed change is invisible to the live reports until a new
version is deployed from the Apps Script editor. Triggers run Head, so a
scheduled job picks the change up immediately while the web app does not. That
asymmetry has produced "the fix didn't work" more than once.

**Always `npm run pull` before pushing.** `clasp push` overwrites the live
project with whatever is on disk, so a push from a stale checkout silently
reverts anything edited in the browser since. Pulling first puts the diff in
front of you. That is not hypothetical here: the pull that preceded this
document found the live copy of `imp/user_automation.js` a thousand lines
shorter than the repo's, which a blind push would have undone.

As of this document, Head matches the repo for every project. Whether the
deployed **Version** matches Head is a separate question, answered only in the
Apps Script editor.

## What is where

### Backend — `ps-analytics-backend`

One Apps Script project per report. `projects/<name>/.clasp.json` holds each
script id.

| Project | Script id |
|---|---|
| `game-dashboard` | `1jy2LS0KaC25TQXXw0Br_GPop2tF5SiuxHxMEmgYDW-L125VdHjCz4CzW` |
| `monetization` | `1xPEF-mvSxqCW2-dD6oxRS_BKkERBZYOhCB5GykTo5NCmelTSJS6jwuUS` |
| `ua-report` | `10RtUwwVLgjJiqzb52m8RZ4RU7PoYPzi2fM7672dRjxo5GTGiXseb-Uju` |
| `till-date` | `1k5NaxJUT9rfh6LYgClmVspfP0wksEIntBFW33wMJ4EYYKJJZQz06-0wD` |
| `aso` | `1S_rooVrneeHTrw1mz1jNSCTBlMonOws1TNIYseqX9G-dCroh56dFrXMk` |
| `negative-spend` | `1BYtRN2eSGLev_59i-GzuG-5_Ls2ZawHuEN4Gr5uTnfppoVu_CweMq4Fw` |
| `auth-host` | `1OBnjvAvZ-msHcpa8p0KS25HQL1OLjEhr0Ke04VvJhPo_uCk3aZUsNg-H` |

`shared/` holds the canonical copies of code used by several projects.
`tools/sync-shared.mjs` writes the per-project copies; `--check` fails on
drift. **Edit `shared/`, never a generated copy** — the copies carry a header
saying so.

`npm run pull` fetches the live Apps Script code, so you can diff what is
deployed against what is committed. Worth doing before believing anything in
this document about deployment state.

### Frontend — `ps-analytics`

A Vite multi-page app. `game-analytics/` is the dashboard; `reports/` holds
the five standalone reports (ua, weekly, till-date, aso, negative-spend).

The `*.legacy.js` files are large and were moved byte-for-byte from older
standalone HTML. They are not written the way a new file would be. Two traps
live in them: they are **not** strict-mode clean, and some handlers are still
inline in the HTML, so a function renamed in JS without the matching change in
the markup fails silently at click time.

---

## Read these two documents first

They are in `docs/`, and they are the reasoning behind most of the current
shape of the dashboard.

- **`docs/data-mapping-verdicts.md`** — every card that had no data source,
  with a decision: built, derivable, or deleted. Eleven were built, five were
  deleted outright rather than left rendering an empty panel. It also records
  a correction worth reading: seven cards reported as missing were already
  built, because the list had been made from a stale mapping document instead
  of from the code.

- **`docs/duplicate-sources.md`** — the seven figures that have more than one
  possible source, which one is the authority, and why. Ends with the measured
  outcome of the agreement probe.

The rule both documents come back to: **one number, one source.** Not because
one source is better, but because two are unfalsifiable — when two figures for
the same thing disagree, nobody can say which is wrong without re-deriving
both, and in practice people pick whichever suits the conversation.

---

## Two numbers that disagree, on purpose

Both were measured, both were left alone, and both are labelled on the card.
**Do not "fix" either by making them agree.** Making them agree means choosing
a population on somebody else's behalf.

**DAU.** `stickiness_combined` reports about **20% more DAU** than
`Executive_KPI's` — median 19.9%, worst 22.6%, on every one of 30 shared
dates. A gap that steady in one direction is not noise. The stickiness card
reads both halves of its ratio from its own tab, which is what makes the ratio
correct, and says on its face that its DAU is not the DAU beside it.

**ROAS.** Channel Performance and Weekly Network agree at D0 (36.7% vs 36.9%)
and are **17.3% apart at D7** (73.9% vs 61.1%). Starting in the same place and
diverging once a window closes means the cohort, the week boundary, or the
revenue definition differs.

**Two open questions for whoever owns those sheets** — they are not answerable
from the code:

1. Which population does each DAU figure include? A 20% gap that steady
   usually has a plain answer — an extra app, a timezone boundary, or bots
   counted on one side.
2. How is a D7 cohort or a week defined in each of those two tabs?

---

## Running things

```bash
# frontend
npm install
npm run dev            # local server
npm run build
npm run test:fmt       # 22 assertions on the number formatters
npm run smoke          # add --url to check a deployed site

# backend
npm test               # dates, adjust-dates, schema-watch, tilldate-columns
npm run pull           # fetch the live Apps Script code, to diff against
```

### Probes, run from the Apps Script editor

Read-only. They exist because reading the code has repeatedly failed to answer
questions the sheets could answer directly.

| Function | Project | Answers |
|---|---|---|
| `headerProbe()` | game-dashboard | the real column names of every source tab, plus one row so an always-blank column is visible |
| `stickinessShapeProbe()` | game-dashboard | how many rows a date has in `stickiness_combined`, and whether the worldwide row contains the country cuts |
| `agreementProbe()` | game-dashboard | whether two sources that should agree, do |
| `sourceHeaderProbe()` | game-dashboard | the same as `headerProbe` but through `SOURCE` |
| `verifyStamp()` | ua-report | rebuilds every dataset and compares against what is served |
| `schemaWatch()` | ua-report | a column that has stopped arriving |

---

## Traps that have already cost time here

Every one of these was found the hard way. They are listed so the next person
finds them in a document instead.

**`Utilities.formatDate` is a JS↔Java bridge call, roughly 1ms each.** Calling
it per row is the single most expensive mistake available in this codebase,
and it was found **five separate times**. Every one of those versions returned
*correct* dates, which is why nobody noticed. The tests for this count calls,
not just answers.

**`Logger.log` has no width specifiers.** `%-22s` prints literally *and* shifts
every later argument, so the whole line is wrong in a way that looks like a
data fault. Pad in JavaScript instead. Found twice.

**Cache fingerprints of `name:lastRow:lastColumn` are blind to edits in
place.** Change a value without changing the shape and the cache serves the
old one forever. This pattern existed in four projects.

**`const` and the temporal dead zone in the big render functions.** These
functions are hundreds of lines and declare consts throughout. Putting a block
where it *reads* best rather than where its dependencies are declared throws
at runtime, every time that tab opens. Hit twice in
`game-analytics.legacy.js`.

**Stored ratios must never be averaged over a range.** ROAS, CPI, retention and
stickiness are stored per row. Averaging thirty stored ratios weights a
10-install day the same as a 10,000-install one. Read the components, sum them,
divide once, at the end. `buildUA` says this in a comment and obeys it; follow
that.

**Zero is not the same as absent.** A range with no rows means nobody knows
what happened, not that the answer was zero. The formatters return an em dash
for `NaN`, `Infinity` and `''`, but still print a real `0` as `0` — the
obvious overcorrection is a `!n` guard that turns a genuine zero into a dash.

**Do not stack pull requests.** A PR based on another PR's branch loses its
commits when the base is merged first, and the loss is silent. This happened
**five times** in one week of work here, and once it produced not an error but
a truncated markdown file that read as though it were complete. One unit of
work, one branch off `main`, one PR — and confirm the push reached the remote
before opening it.

---

## Before you are handed the keys

These are the repo owner's to action, not the new maintainer's, but they
should be done as part of the transfer rather than after it.

- **`AUTH_PASSWORD` is four characters.** Independently of whether it has ever
  leaked, that is too short. It should be replaced, and the auth should use a
  salted PBKDF2 hash rather than what is there now.
- **`ADJUST_API_TOKEN` and `BB_API_KEY`** should be rotated on transfer, as
  any credential should when the set of people holding it changes.
- **`TOKEN_SECRET` and `AUTH_USER_LIST`** are unused and should be deleted from
  Script Properties rather than handed on.
- **`C:\Users\PS` is itself a git repository**, with `.clasprc.json` untracked
  inside it. That file is a Google OAuth token for the clasp account. It should
  not be anywhere near a repository.
- **A Google service-account private key** was last seen at
  `Downloads\play-console-automation-498412-*.json`. It should be moved
  somewhere deliberate and removed from Downloads.

---

## A trigger that may be calling a function that is gone

`imp/user_automation.js` once held `installCohortCombinedTrigger`, which
installs a **daily trigger at about 08:00 PKT** with the handler string
`'syncCohortCombined'`. That function is no longer in the live project.

A trigger survives the deletion of the function it names, and then fails every
morning into an execution log nobody is required to read. **Open the
game-dashboard project, look at Triggers for a handler called
`syncCohortCombined`, and at Executions for how long it has been failing.**
Either the function comes back or the trigger goes.

---

## Still open, and deliberately so

- **The Android Immersive slide still shows AdMob failover.** It was removed
  from the iOS slide because that is what was asked. The same argument applies
  to Android — failover is not an immersive network and the slide is a Gadsme
  vs Anzu comparison — but it was left rather than widened past the request.
- **Frontend look and feel.** A list of presentation changes was expected and
  has not been worked through.
- **Progressive loading and a lighter first paint.** Raised early, never
  started.
- **BigQuery.** The intended destination. Nothing has moved yet; the source
  layout in `Source.js` was arranged with it in mind.
