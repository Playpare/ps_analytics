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

## What is being asked

Tick the AVAILABLE rows you want built. Everything ticked is one job — the UA
spend/install/revenue columns and the Till Date MAU column, read once and shared
across the cards that need them, with the ratios computed over the range.
