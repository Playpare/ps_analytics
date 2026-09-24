# Data mapping — the "no source" cards, with a verdict for each

Every card the mapping marks **no source** is listed below with one of three
verdicts. Tick the ones you want built; leave the rest.

The verdict is about where the numbers live, not about how hard the card is.
"Available" means the columns exist today in a workbook the dashboard already
reaches — no new pipeline, no request to anybody.

---

## AVAILABLE — the columns exist, in another workbook

| Card | Where the numbers actually are | Note |
|---|---|---|
| **UA Spend** | UA `Networks overview` · `network_cost` | Sum over the range. |
| **Paid Installs** | UA `Campaigns data` · `installs` | Sum over the range. |
| **Avg CPI** | UA `Campaigns data` · `cost` ÷ `installs` | **Not** `ecpi_all` averaged — see the ratio note below. |
| **ROAS** | UA `Networks overview` · `network_cost`, `all_revenue` | Ratio computed over the range. |
| **ROAS maturity (D0/D7/D14/D30)** | UA `Weekly Network` · `roas_d0`,`roas_d7`,`roas_d14`,`roas_d30` | Stored as ratios only — plot them per week, never average them across weeks. |
| **Channel performance** | UA `Networks overview` · `channel` + `network_cost`, `all_revenue` | One row per channel. |
| **Campaign performance** | UA `Campaigns data` · `campaign_network` + `cost`, `installs`, `all_revenue` | One row per campaign. |
| **UA spend vs ad revenue** (Acquisition) | spend: UA `network_cost` · revenue: Revenue · `adRevenue` | The spend half is what was missing. |
| **UA spend vs revenue** (Monetization) | same spend source | Same fix, second chart. |
| **Active user base — MAU / stickiness** | Till Date `stickiness_combined` · `dau`, `mau` | DAU already comes from Executive_KPI's; MAU has never been read. |

### The ratio rule — this is where these cards go wrong

CPI, ROAS and LTV:CPI are **ratios**. The sheets store them per row (per day,
per campaign, per week). A range of 30 days must read the **components** and
divide once:

```
CPI  = SUM(cost)     / SUM(installs)
ROAS = SUM(revenue)  / SUM(cost)
```

Averaging 30 stored `ecpi_all` values gives a different — and wrong — number,
because it weights a day with 10 installs the same as a day with 10,000.
Whatever is built here reads cost/installs/revenue and divides at the end.

---

## DERIVABLE — no new source needed, it is arithmetic on what we have

| Card | How |
|---|---|
| **LTV:CPI** | LTV · `D0`…`D30` ÷ the CPI computed above. Both halves exist once UA spend is wired in. |

---

## NO SOURCE — the numbers exist nowhere we read

| Card | What would be needed |
|---|---|
| **Cash & Energy · Store Ops** | An economy/sink export. No tab carries currency balances or sinks. |
| **Session length distribution** | We have the *average* (`Session_Length_D0`), not the distribution. A histogram needs bucketed session counts, which the analytics export does not produce today. |
| **First purchase value** | `FirstPayers` has counts (`installs`, `firstPayers`) but no revenue amount for the first purchase. |
| **Crashes by device** | `Daily` has a single `crash` rate with no device dimension. Needs a Play/Firebase per-device export. |
| **Rating by version** | `Ratings` has no version column. Needs the per-version store export. |

For these five, the honest options are: ask for the export, or remove the card
so the page does not show a permanently empty panel.

---

## The decision — what stays, and what goes

Decided. This is not a list to tick any more; it is what the dashboard will
contain.

### KEPT — built from the columns named above

All ten AVAILABLE cards and the one DERIVABLE card are built. That is UA Spend,
Paid Installs, Avg CPI, ROAS, ROAS maturity, Channel performance, Campaign
performance, both UA-spend-vs-revenue charts, MAU/stickiness, and LTV:CPI.

They share one read of the UA cost/installs/revenue columns and one read of
Till Date `mau`, rather than each card fetching for itself.

### REMOVED — the card goes, not just the empty panel

| Card | Where it is removed from |
|---|---|
| Cash & Energy · Store Ops | Overview mini-charts |
| Session length distribution | Engagement |
| First purchase value | Progress Events |
| Crashes by device | Stability |
| Rating by version | Player Rating |

These are deleted outright - markup, chart code, and the fields they read.
Not hidden behind a flag and not left rendering zeros. A panel that is
permanently empty teaches people to distrust the ones beside it, and a hidden
card is a card somebody re-enables in a year without knowing why it was off.

If an export later arrives for one of them, the card comes back with the data.
What is not kept is a placeholder waiting for it.

### And the payload shrinks with them

Dropping a card drops its columns from what the backend sends. Every field that
no surviving card reads comes out of the payload - the same projection already
applied to `network_rev`, applied to the rest. Less to build, less to cache,
less to send.

---

## Imp/user Cohort — report and dashboard differ, deliberately

The **report** keeps both splits: the cohort-day columns `Day 0`…`Day 30` broken
down by `Ad Type`, and the `Country` dimension. Somebody reading the report is
there to compare them, and collapsing them would remove the reason to open it.

The **dashboard**, in the Growth section, shows this **overall only** - one
series, every ad type and every country summed. The dashboard answers "is ad
exposure per user going up"; the breakdown is the report's job.

So `Country` stays in the source data and stays in the report. The dashboard
aggregates over it rather than the backend dropping it.

---

## Correction, after reading the code rather than the mapping

The AVAILABLE table above said these cards were "simply not read". That was
taken from `Data_Mappng.MD`, and for most of them the mapping is stale. They
are already built and already reading real data:

| Card | Where it is built |
|---|---|
| UA Spend | `acqKpis` · fed by `buildUA` → Channel Performance |
| Avg CPI | `acqKpis2` · spend ÷ installs, derived from totals |
| ROAS | `acqKpis2` |
| LTV : CPI | `acqKpis2` |
| Channel performance | `growthSourceTbl` · `buildChannelPerf` |
| Campaign performance | `growthCampaignTbl` · `buildCampaignPerf` |
| UA spend vs revenue | `cvGrowthCpi` · `buildChannelDaily` |

`buildUA` already states the ratio rule this document arrived at independently,
and already obeys it: *"CPI and eCPI are derived from the totals, never
averaged."* So the trap was found and closed before this list was written.

**Paid Installs** is a separate case. There is a comment in the code saying it
was removed on purpose, with organic installs, because splitting paid from
organic needs attribution and this sheet has none - one card always read 0 and
the other just repeated Total Installs. Campaign-level installs do exist and
the campaign table shows them; what has no source is the paid/organic split of
the *total*. Left removed.

### So what actually remains unbuilt

Two, both genuinely absent end to end - no backend field with data in it, and
no card on the page:

| Card | Source | State |
|---|---|---|
| **ROAS maturity (D0/D7/D14/D30)** | UA `Weekly Network` | `buildUA` returns `roasCurve: []` and nothing on the page reads it. |
| **MAU / stickiness** | Till Date `stickiness_combined` · `dau`, `mau` | No field, no card. `MISSING_SOURCES.mau` still says "blocks stickiness". |

MAU is the more involved of the two: it lives in the Till Date workbook, which
is a different spreadsheet. `Source.js` already opens it - `SRC_BOOKS.tillDate`
is there - so the route exists and this is a new SOURCE entry rather than new
plumbing.

**How this happened, since it is the point:** the list above was built by
reading `Data_Mappng.MD` and the sheet column names, and not by reading the
code that consumes them. The mapping described the state of the dashboard some
months ago. Seven cards were reported as work that is already done.
