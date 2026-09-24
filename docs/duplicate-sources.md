
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
