# The same number, from more than one place

Where a figure has several possible sources, this says **which one is the
authority** and which the dashboard should stop using. Each row is what the
code does today, followed by what it should do.

The rule behind every verdict: **one number, one source.** Not because one
source is better, but because two are unfalsifiable. When two figures for the
same thing disagree, nobody can say which is wrong without re-deriving both,
and in practice nobody does — they pick the one that suits the conversation.

---

## 1. UA spend — four sources, and two of them are live at once

| Source | Where | Used by |
|---|---|---|
| `Sheet1` column AG, `spendAG` | spend_matrix.gs | **UA Spend headline** |
| `Sheet1`, `spend` (AG, falling back to `costTotal` per day) | spend_matrix.gs | **Avg CPI** |
| `Channel Performance`, `spend` | `buildChannelDaily` | ROI, spend-vs-revenue chart, channel table |
| `Campaigns data`, `cost` | `buildUA` | `ua.totals.cost`, the legacy fallback |

**This one is not a preference, it is a defect.** `spend` and `spendAG` are
different numbers: `smCardTotals` sums `spendAG` where the day has it and
falls back to `costTotal` where it does not. So on any range containing a day
without an AG value, `spend > spendAG` — and the dashboard shows the smaller
figure as **UA Spend** while dividing by the larger one to get **Avg CPI**.
The CPI is then higher than the numbers beside it can produce, and every check
somebody runs by hand disagrees with the card.

**Keep:** `Channel Performance`, `spend`. It is per-day and per-channel, it
already feeds the chart and the table on the same page, and it is the only
source where the spend behind the headline can be traced to a row. Sheet1 stays
as the fallback when Channel Performance has no rows for the range — one
fallback, named on the card, not a second authority.

**Then:** CPI is that same spend over that same installs figure. Both halves
from one place, so the card can be checked against the table beneath it.

---

## 2. Installs — three sources, and the paid/organic split has none

| Source | Where | Used by |
|---|---|---|
| `Executive_KPI's`, `New_Installs` | `buildDaily` | total installs, Overview, the CPI denominator |
| `Channel Performance`, `installs` | `buildChannelPerf` | the channel table |
| `Campaigns data`, `installs` | `buildUA` | campaign table, legacy rollup |

**Keep:** `Executive_KPI's` for the **total**, `Channel Performance` for the
per-channel breakdown.

These are not the same measurement and should not be reconciled: the Executive
KPI figure is every install, the Channel figure is attributed installs only.
The mistake is comparing them, not having both. So the total card says *total
installs* and the table says *attributed*, in those words.

**Paid vs organic stays unavailable** — that split needs attribution this sheet
does not carry. The two cards that claimed it were removed for that reason and
should stay removed.

---

## 3. ROAS — four measures wearing one name

| Measure | Source | What it actually answers |
|---|---|---|
| `ua.totals.roas` | `Campaigns data` | period revenue over period spend |
| ROI card | `Channel Performance` daily | the same question, better source |
| `cohortRoas.d0 / .d7` | `Combines_ROAS` | how much a cohort repaid, D0 and D7 |
| channel table `roasD0/D7/D28` | `Channel Performance` | the same, per channel |
| **ROAS maturity** (new) | `Weekly Network` | the same, D0 to D30, as a curve |

Two genuinely different questions are being called ROAS. *Money in against
money out inside the window* is not *how much of its own cost this cohort has
repaid*, and on a growing account they move in opposite directions.

**Keep both questions**, under two names that cannot be confused — **ROI** for
the window measure and **ROAS** for cohort payback. That is what the page
already does, and it is worth protecting.

Within cohort payback, **keep `Weekly Network`** as the authority: it is the
only source carrying D14 and D30, so one source can answer the whole curve.
`Combines_ROAS` (D0 and D7 only) becomes the fallback. `ua.totals.roas` should
be dropped — nothing reads it, and it is the fourth spelling of a number that
already has three.

**Hold before acting on this row:** the channel table's `roasD0/D7/D28` and the
new curve come from different tabs and must be compared on the same range
before either is retired. Two sources agreeing is the only evidence that
dropping one is safe.

---

## 4. Revenue — three, and they are not the same money

| Source | Where | Covers |
|---|---|---|
| `Revenue`: `adRevenue` + `immersiveAdsRevenue` + `failoverRevenue` + `iapRevenue` | `buildMonetization` | all revenue |
| `Network`, `Est. Revenue` | `buildMonetization` networks | ad revenue only, per network |
| `Channel Performance`, `revenue` | `buildChannelDaily` | attributed revenue only |

**Keep:** `Revenue` as the authority for any total, `Network` for the
per-network table, `Channel Performance` **only** on the spend-vs-revenue
chart, where attributed revenue is the right half of the comparison.

The trap is a total built from `Network`: it is ad revenue only, so it reads
roughly right and is quietly missing IAP.

---

## 5. DAU — two, and one ratio now spans both

| Source | Where |
|---|---|
| `Executive_KPI's`, `DAU` | `buildDaily` — every DAU card, ARPDAU, payer conversion |
| `stickiness_combined`, `dau` | `buildStickiness` — the stickiness ratio |

**Keep:** `Executive_KPI's` for every card that shows DAU.

Stickiness deliberately reads **both** halves from `stickiness_combined` rather
than taking DAU from Executive KPI's and MAU from Till Date. Two sources for
the halves of one ratio is how a ratio comes to disagree with both its own
components. This is the one place a second DAU is correct, and the reason sits
in a comment beside it so nobody tidies it away.

**Worth checking once:** whether the two DAU figures agree on a shared date. If
they do not, the stickiness percentage is right and the DAU on the rest of the
dashboard is answering a different question — which is worth knowing.

---

## 6. Retention — three

| Source | Where |
|---|---|
| `Retention` tab | `buildRetention` — the retention page |
| `Channel Performance`, D1/D7/D30 | the channel table |
| `Campaigns data`, `retention_rate_d1/d7` | the legacy fallback |

**Keep:** `Retention` for the retention page, `Channel Performance` for the
per-channel columns. `Campaigns data` retention is the third spelling and is
only reached when Channel Performance is empty — leave it as the fallback, and
do not surface it anywhere else.

---

## 7. CPI and eCPI — stored and derived, both present

`Campaigns data` and `Channel Performance` both carry a stored `ecpi_all`, and
the code also derives CPI from cost over installs.

**Keep the derived one, always.** `buildUA` already says why and already does
it — *"CPI and eCPI are derived from the totals, never averaged"* — because a
mean of per-row CPIs weights a 27-install row the same as a 53,000-install one.
The stored column is fine per row and wrong the moment a range covers more than
one.

Same rule for every stored ratio: **ROAS, CPI, retention, stickiness.** Read
the components, divide once, at the end.

---

## The order to do these in

1. **UA spend (#1)** — a live defect, not a preference. CPI and the spend
   headline disagree today.
2. **ROAS (#3)** — after comparing `Weekly Network` against the channel table
   on one range, not before.
3. **Revenue (#4), Retention (#6), CPI (#7)** — mostly labelling: say on each
   card which population it covers, so nobody compares two cards that were
   never the same number.
4. **DAU (#5)** — one check, then either nothing or something worth knowing.
5. **Installs (#2)** — naming only. Total against attributed, in those words.

---

# Measured: what the agreement probe found

Items #3 and #5 were held open because neither could be settled by reading
code. `agreementProbe()` was run over **2026-08-25 .. 2026-09-23**, all
platforms. Both came back the same way, and it is the outcome people skip.

## #5 DAU — they disagree, by about a fifth

| | |
|---|---|
| shared dates | 30 of 30 |
| median disagreement | **19.9%** |
| worst | 22.6% |

`stickiness_combined` reports consistently **more** DAU than `Executive_KPI's`
— about 20% more, on every single day. A steady gap in one direction is not
noise; the two tabs are counting a different population, and neither is wrong
about its own.

**Verdict: nothing is retired, nothing is reconciled.**

- `Executive_KPI's` stays the authority for every card that shows DAU.
- Stickiness keeps both halves from `stickiness_combined`, which was always
  the point — the ratio is of two numbers that count a user the same way, and
  it is correct.
- The stickiness card now says on its face that its DAU is not the DAU on the
  cards beside it. That is the whole fix. Making the two agree would mean
  choosing a population for somebody else.

**Still worth asking whoever owns that tab:** which one includes what. A 20%
gap that steady usually has a plain answer — an extra app, a different
timezone boundary, or bots counted on one side.

## #3 ROAS — D0 agrees, D7 does not

| age | Channel Performance | Weekly Network | apart |
|---|---|---|---|
| D0 | 36.7% | 36.9% | **0.7%** |
| D7 | 73.9% | 61.1% | **17.3%** |
| D14 | — | 69.7% | |
| D30 | — | no closed cohort in range | |

D0 agreeing to within a point says the two tabs start from the same place.
D7 being 17% apart says they do not stay there — the cohort, the week
boundary, or what counts as revenue diverges once a window has to close.

**Verdict: nothing is retired.** The hold this document placed on #3 holds.
`Combines_ROAS` stays, `ua.totals.roas` stays, and the maturity curve stays,
because retiring a source is only safe when it was saying the same thing.

Note on the D30 blank: the probe ran on a 30-day range, so **no cohort in it
is thirty days old**. That is the curve working, not a missing column — the
builder drops ages whose window has not closed. Its warning used to say
"check the header names" in that case and sent somebody hunting for a column
that was there; it now tells the two causes apart.

## What this leaves

Two duplicates that are not duplicates, stated on the cards rather than
merged. That is the honest end state for both, and it is worth saying plainly:
the goal was never one number — it was never two numbers presented as though
they were one.
