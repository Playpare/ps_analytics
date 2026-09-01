/**
 * ============================================================================
 * glance.js — the decision summary and the performance table
 * ============================================================================
 *
 * WHAT THIS IS FOR
 *
 * The page below this answers, in nine sections, what happened. A UA manager
 * opens it to answer something narrower: what needs a decision today. These
 * two sections answer that, and everything below them is the working.
 *
 * THE ONE RULE
 *
 * Every number here is a rollup of rows this file also renders, produced by
 * negative-spend.legacy.js's own verdict engine through the bridge. Nothing is
 * recomputed independently.
 *
 * That rule is the whole reason this file is careful. The live page currently
 * shows "Spend at risk $0.00 — 0 campaigns under their target" directly above
 * a list of three campaigns marked CUT, because two verdict engines answer the
 * same question on different bases: the KPI reads mature cohorts and goal-
 * window revenue, the table reads the whole window and all revenue. Both are
 * defensible; showing them side by side without saying so is not. A summary
 * that can disagree with the table beneath it is worse than no summary.
 *
 * So: one classification pass over overallCampaigns(W), and the three tiles
 * are three filters over that one list.
 */

import './glance.css';

const B = () => window.__nsBridge;
const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------------------
 * Vocabulary — the report's own verdict strings, not a parallel set.
 * ------------------------------------------------------------------------- */
const CHIP = {
  'FAIL - cut':          ['c-bad',  'minus', 'cut'],
  'OVER BUDGET':         ['c-bad',  'warn',  'over budget'],
  'UNDER TARGET':        ['c-warn', 'warn',  'under target'],
  'NO BUDGET - set one': ['c-warn', 'warn',  'no budget cap'],
  'NO GOAL - map it':    ['c-none', 'info',  'no goal mapped'],
  'INSUFFICIENT DATA':   ['c-none', 'info',  'too young to judge'],
  'PENDING':             ['c-none', 'info',  'pending'],
  'PASS':                ['c-good', 'check', 'passing'],
};
const ICON = {
  warn: '<path d="M8 1.6 1.4 13.2h13.2L8 1.6Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.2v3.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.2" r=".95" fill="currentColor"/>',
  minus: '<circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.5"/><path d="M5.4 8h5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  check: '<circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.2 7.1 10l3.7-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  info:  '<circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.8v3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.1" r=".95" fill="currentColor"/>',
  up:    '<path d="M2.2 10.6 6 6.6l2.7 2.5 4.9-5.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.4 3.5h3.4v3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};
const svgIcon = (k, cls) => `<svg class="${cls}" viewBox="0 0 16 16" fill="none" aria-hidden="true">${ICON[k]}</svg>`;
const chip = (verdict) => {
  const c = CHIP[verdict];
  if (!c) return '';
  return `<span class="g-chip ${c[0]}">${svgIcon(c[1], 'g-ic')}${c[2]}</span>`;
};

/* Verdicts that mean "nothing to decide" and are left out of the table. */
const INERT = { 'not active': 1, 'NO SPEND': 1 };

/* ---------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------- */
let GRAIN = 'weekly';
let MODE = null;                 // null = follow the row's own judge mode
let SELECTED = null;
const OPEN = new Set();
let MODEL = null;                // last built model, for redraws without a full render

/* ---------------------------------------------------------------------------
 * Model — one classification pass, shared by the tiles and the table
 * ------------------------------------------------------------------------- */
function build(W) {
  const b = B();
  const rows = b.overallCampaigns(W).filter((c) => !INERT[c.verdict] && c.cost > 0);
  const series = b.dailySeriesByCampaign();

  const nets = new Map();
  rows.forEach((c) => {
    const s = series.byKey.get(c.campaign + '||' + c.channel) || { cost: [], rev: [] };
    c._cost = s.cost; c._rev = s.rev;
    let n = nets.get(c.channel);
    if (!n) {
      n = { name: c.channel, campaigns: [], cost: 0, allRev: 0,
            matureCost: 0, revAtGoal: 0, target: null, budgetOnly: true };
      nets.set(c.channel, n);
    }
    n.campaigns.push(c);
    n.cost += c.cost;
    n.allRev += c.allRev;
    /* A network's ROAS is graded revenue over graded cost - never the mean of
       its campaigns' ratios, which would let a $200 campaign outvote a
       $40,000 one. Only rows carrying a real verdict contribute. */
    if (c.roas != null && c.target != null) {
      n.matureCost += c.matureCost;
      n.revAtGoal += c.revAtGoal;
      if (n.target == null) n.target = c.target;
    }
    if (!c.budgetOnly) n.budgetOnly = false;
  });

  const networks = [...nets.values()].map((n) => {
    n.cashGap = n.allRev - n.cost;
    n.roas = n.matureCost > 0 ? n.revAtGoal / n.matureCost : null;
    n.goal = [...new Set(n.campaigns.map((c) => c.goal).filter((g) => g && g !== '—'))].join(' / ');
    /* The worst thing true of any campaign under it, in the report's own order
       of severity. Over budget outranks a missing cap: a breach is a fact, an
       absent cap is the lack of one. */
    const order = ['FAIL - cut', 'OVER BUDGET', 'UNDER TARGET', 'NO BUDGET - set one',
                   'NO GOAL - map it', 'INSUFFICIENT DATA', 'PENDING', 'PASS'];
    n.verdict = order.find((v) => n.campaigns.some((c) => c.verdict === v)) || 'PASS';
    n.budget = n.campaigns.every((c) => c.budget != null)
      ? n.campaigns.reduce((s, c) => s + c.budget, 0) : null;
    n.uncapped = n.campaigns.filter((c) => c.budget == null).length;
    n._cost = sumSeries(n.campaigns.map((c) => c._cost));
    n._rev = sumSeries(n.campaigns.map((c) => c._rev));
    return n;
  }).sort((a, b2) => b2.cost - a.cost);

  return { W, rows, networks, days: series.days };
}

function sumSeries(list) {
  const n = Math.max(0, ...list.map((a) => a.length));
  const out = new Array(n).fill(0);
  list.forEach((a) => a.forEach((v, i) => { out[i] += v; }));
  return out;
}

/* ---------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------- */
const money = (v) => B().money(v);
const esc = (s) => B().esc(s);
const kmoney = (v) => (v < 0 ? '−' : '') +
  '$' + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(v)));

/* ---------------------------------------------------------------------------
 * Headline + the three decisions
 * ------------------------------------------------------------------------- */
function renderHead(m) {
  const spend = m.rows.reduce((s, c) => s + c.cost, 0);
  const cash = m.rows.reduce((s, c) => s + c.cashGap, 0);
  const w = m.W;
  const span = w.from && w.to ? `${B().shortDate(w.from)} – ${B().shortDate(w.to)}` : '';

  /* Two facts the old KPI row carried that nothing above replaces. They are a
     line rather than tiles because neither is a decision: a losing day is an
     outcome, and unusable install data is a caveat on everything else. The
     three tiles are reserved for things somebody can act on. */
  const neg = (w.daily || []).filter((d) => d.status === 'NEGATIVE');
  const worst = (w.daily || []).slice().sort((a, b2) => a.gp - b2.gp)[0];
  const fake = Object.values(w.channels || {}).filter((c) => c.fake);
  const asides = [];
  if (neg.length) {
    asides.push(`<b>${neg.length} of ${w.daily.length}</b> days lost money` +
      (worst && worst.gp < 0 ? `, worst ${money(worst.gp)} on ${esc(B().dmy(worst.iso))}` : ''));
  }
  if (fake.length) {
    asides.push(`install counts are unusable on <b>${fake.map((c) => esc(c.name)).join(', ')}</b>` +
      ` — anything per-install is unreliable there`);
  }

  $('glanceHead').innerHTML =
    `<div class="gh">${money(spend)} spent. ` +
    (cash < 0
      ? `<span class="lost">${money(Math.abs(cash))} did not come back.</span>`
      : `<span>${money(cash)} came back on top.</span>`) + `</div>` +
    `<div class="gs">Three things need a decision${span ? ' across ' + esc(span) : ''}. ` +
    `The table below is the same money, broken down as far as you want to take it.` +
    (asides.length ? `<br><span class="aside">${asides.join(' · ')}</span>` : '') + `</div>`;

  const pick = (v) => m.rows.filter((c) => c.verdict === v);
  const sum = (l) => l.reduce((s, c) => s + c.cost, 0);
  const tally = (l) => [...new Set(l.map((c) => c.channel))]
    .map((n) => `<b>${esc(n)}</b> ×${l.filter((c) => c.channel === n).length}`).join(' · ');

  /* 1 — spend nothing is holding back */
  const over = pick('OVER BUDGET'), nocap = pick('NO BUDGET - set one');
  const loose = over.concat(nocap);
  const overBy = over.reduce((s, c) => s + (c.overBy || 0), 0);
  const t1 = loose.length
    ? { amt: money(sum(loose)), quiet: false,
        why: (over.length ? `${over.length} campaign${over.length > 1 ? 's are' : ' is'} <b>over budget</b> by ${money(overBy)}. ` : '') +
             (nocap.length ? `${nocap.length} ${over.length ? 'other ' : ''}campaign${nocap.length > 1 ? 's have' : ' has'} no cap set.` : ''),
        who: `<b>${Math.round(sum(loose) / (spend || 1) * 100)}%</b> of everything spent · ${tally(loose)}`,
        fix: loose[0].channel }
    : { amt: 'Nothing', quiet: true, why: 'Every campaign is inside a budget.', who: '', fix: null };

  /* 2 — cut. Under target is a different decision (watch it, or move the bid)
     and folding it in is how a "cut" figure stops meaning cut. It gets its own
     line rather than being added in. */
  const cut = pick('FAIL - cut'), under = pick('UNDER TARGET');
  const t2 = {
    amt: cut.length ? money(sum(cut)) : 'Nothing', quiet: !cut.length,
    why: cut.length
      ? `${cut.length} campaign${cut.length > 1 ? 's are' : ' is'} below <b>${Math.round(B().data.assumptions.atRiskPace * 100)}%</b> of target ROAS on mature cohorts.`
      : 'No campaign is below the cut threshold.',
    who: (cut.length ? tally(cut) : '') +
         (under.length ? `${cut.length ? '<br>' : ''}${under.length} more under target — ${money(sum(under))}` : ''),
    fix: null,
  };

  /* 3 — scale */
  const pass = pick('PASS').filter((c) => c.roas != null && c.target != null);
  const room = pass.filter((c) => c.budget == null || c.cappedCost < c.budget * 0.9);
  const t3 = room.length
    ? { amt: money(sum(room)), quiet: false,
        why: `${room.length} campaign${room.length > 1 ? 's are' : ' is'} beating target at <b>${(room.reduce((s, c) => s + c.roas / c.target, 0) / room.length).toFixed(2)}×</b> with budget headroom.`,
        who: room.slice(0, 3).map((c) => `<b>${esc(c.channel)}</b> — ${esc(shortName(c.campaign))}`).join('<br>'),
        fix: null }
    : { amt: 'Nothing yet', quiet: true,
        why: 'No campaign is beating its target with room to spend more.',
        who: pass.length ? `${pass.length} passing, but already at budget.` : '', fix: null };

  const card = (cls, icon, title, t) =>
    `<article class="act ${cls}">
       <div class="hd">${svgIcon(icon, 'g-ic')}${title}</div>
       <div class="amt${t.quiet ? ' quiet' : ''}">${t.amt}</div>
       <div class="g-why">${t.why}</div>
       ${t.who ? `<div class="who">${t.who}</div>` : ''}
       ${t.fix ? `<button type="button" class="fix" data-fix="${esc(t.fix)}">Set budgets →</button>` : ''}
     </article>`;

  $('glanceActs').innerHTML =
    card('a1', 'warn', 'No budget cap', t1) +
    card('a2', 'minus', 'Cut', t2) +
    card('a3', 'up', 'Scale', t3);

  $('glanceActs').querySelectorAll('[data-fix]').forEach((btn) => {
    btn.onclick = () => B().openSettings(btn.dataset.fix);
  });
}

const shortName = (s) => String(s).replace(/^PS_AND_Supermarket_Simulator_/, '')
  .replace(/^Android_com\.playspare\.supermarket\.store\.simulator_/, '…');

/* ---------------------------------------------------------------------------
 * Buckets — daily / weekly / monthly
 * ------------------------------------------------------------------------- */
function bucketise(arr, days) {
  const size = GRAIN === 'daily' ? 1 : GRAIN === 'weekly' ? 7 : 30;
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    const end = Math.min(i + size - 1, arr.length - 1);
    out.push({
      v: arr.slice(i, i + size).reduce((a, b2) => a + b2, 0),
      from: days[i], to: days[end],
      label: size === 1 ? B().shortDate(days[i])
                        : B().shortDate(days[i]) + ' – ' + B().shortDate(days[end]),
    });
  }
  return out;
}

function spark(cost, rev, days) {
  const c = bucketise(cost, days).map((b2) => b2.v);
  const r = bucketise(rev, days).map((b2) => b2.v);
  if (c.length < 2) return '';
  const w = 88, h = 24, max = Math.max(...c, ...r, 1);
  const path = (a) => a.map((v, i) =>
    (i ? 'L' : 'M') + (i / (a.length - 1) * w).toFixed(1) + ' ' + (h - v / max * (h - 3) - 1.5).toFixed(1)).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="display:block">
    <path d="${path(c)}" fill="none" stroke="var(--g-cost)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${path(r)}" fill="none" stroke="var(--g-rev)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/* ---------------------------------------------------------------------------
 * Cells
 * ------------------------------------------------------------------------- */
function spendCell(o, isNet) {
  const n = money(o.cost);
  let budget = null, uncapped = 0, total = 1;
  if (isNet) { total = o.campaigns.length; uncapped = o.uncapped; budget = o.budget; }
  else { budget = o.budget; uncapped = budget == null ? 1 : 0; }

  if (budget == null) {
    const label = !isNet || total === 1 ? 'no cap set'
      : uncapped === total ? `none of the ${total} has a cap`
      : `${uncapped} of ${total} have no cap`;
    return `<div class="g-spend"><b>${n}</b><span class="nocap">${label}</span></div>`;
  }
  /* Measured against capped spend, not raw spend: money that ran before the
     cap existed cannot have breached it, and blendSettings already separates
     the two. */
  const used = isNet ? o.campaigns.reduce((s, c) => s + (c.cappedCost || 0), 0) : (o.cappedCost || 0);
  const pct = used / budget;
  const cls = pct > 1 ? 's-over' : pct > 0.9 ? 's-near' : 's-ok';
  /* A window this wide usually contains more than one budget, so the figure is
     a blend weighted by the spend that ran under each. Marked, because an
     unmarked blend reads as a single standing number. */
  const blended = !isNet && o.settings && o.settings.budgetChanged;
  return `<div class="g-spend ${cls}"><b>${n}</b>
    <span class="bar"><span class="lb">${Math.round(pct * 100)}% of ${money(budget)}` +
    (blended ? `<span class="g-blend" title="The budget changed inside this window. This is the blend, weighted by the spend that ran under each.">*</span>` : '') +
    `</span><span class="t"><span class="f" style="width:${Math.min(pct, 1) * 100}%"></span></span></span></div>`;
}

function bullet(o) {
  if (o.budgetOnly) return '<span class="g-dash">budget-only</span>';
  if (o.roas == null || o.target == null) return '<span class="g-dash">—</span>';
  const pct = o.roas / o.target;
  const pace = B().data.assumptions.atRiskPace;
  const cls = pct >= 1 ? 'gb-good' : pct >= pace ? 'gb-warn' : 'gb-bad';
  const blended = o.settings && o.settings.targetChanged;
  return `<div class="g-bul ${cls}"><span class="g-v">${o.roas.toFixed(2)} / ${o.target.toFixed(2)}` +
    (blended ? `<span class="g-blend" title="The target changed inside this window; this is the blend.">*</span>` : '') +
    `</span><span class="t"><span class="f" style="width:${(Math.min(pct / 1.4, 1) * 100).toFixed(1)}%"></span><span class="mk"></span></span></div>`;
}

/* ---------------------------------------------------------------------------
 * Table
 * ------------------------------------------------------------------------- */
function renderTable(m) {
  const head = `<table><thead><tr>
    <th style="width:26%">Network / campaign</th>
    <th style="width:11%">Trend<em>cost vs revenue</em></th>
    <th class="n" style="width:15%">Spend<em>against budget</em></th>
    <th class="n">Revenue<em>came back</em></th>
    <th class="n">Cash<em>revenue − spend</em></th>
    <th class="n" style="width:16%">Back per $1<em>against target</em></th>
    <th>Needs</th></tr></thead><tbody>`;

  let html = head;
  m.networks.forEach((net, ni) => {
    const open = OPEN.has(net.name);
    html += `<tr class="grow${SELECTED === 'n:' + net.name ? ' on' : ''}" data-k="n:${esc(net.name)}">
      <td><div class="g-nm${open ? ' open' : ''}"><span class="tw">▶</span><span>${esc(net.name)}
        <small>${net.campaigns.length} campaign${net.campaigns.length > 1 ? 's' : ''}${net.goal ? ' · goal ' + esc(net.goal) : ''}</small></span></div></td>
      <td>${spark(net._cost, net._rev, m.days)}</td>
      <td class="n">${spendCell(net, true)}</td>
      <td class="n">${money(net.allRev)}</td>
      <td class="n ${net.cashGap < 0 ? 'neg' : 'pos'}">${money(net.cashGap)}</td>
      <td class="n">${bullet(net)}</td>
      <td>${chip(net.verdict)}</td></tr>`;

    if (open) net.campaigns.slice().sort((a, b2) => b2.cost - a.cost).forEach((c) => {
      html += `<tr class="grow camp${SELECTED === 'c:' + c.campaign + '||' + c.channel ? ' on' : ''}"
          data-k="c:${esc(c.campaign)}||${esc(c.channel)}">
        <td><div class="g-nm"><span>${esc(shortName(c.campaign))}<small>goal ${esc(c.goal)}</small></span></div></td>
        <td>${spark(c._cost, c._rev, m.days)}</td>
        <td class="n">${spendCell(c, false)}</td>
        <td class="n">${money(c.allRev)}</td>
        <td class="n ${c.cashGap < 0 ? 'neg' : 'pos'}">${money(c.cashGap)}</td>
        <td class="n">${bullet(c)}</td>
        <td>${chip(c.verdict)}</td></tr>`;
    });
  });
  html += '</tbody></table>';

  $('perfTable').innerHTML = m.networks.length ? html
    : '<div class="empty">Nothing spent in this window.</div>';
  $('perfCard').hidden = !m.networks.length;
  $('perfKeys').innerHTML =
    `<span class="key" style="--k:var(--g-cost)"><i></i>Cost</span>
     <span class="key" style="--k:var(--g-rev)"><i></i>Revenue</span>`;

  $('perfTable').querySelectorAll('tr.grow').forEach((tr) => {
    tr.onclick = () => {
      const k = tr.dataset.k;
      if (k.startsWith('n:')) {
        const name = k.slice(2);
        OPEN.has(name) ? OPEN.delete(name) : OPEN.add(name);
      }
      SELECTED = k;
      renderTable(m); drawDetail(m);
    };
  });
}

/* ---------------------------------------------------------------------------
 * Detail chart — three readings of the same row
 *
 * Cost against revenue is not the default, deliberately. Both of its lines are
 * driven by how much was spent, so spending more widens the gap whether or not
 * anything got worse: the chart reads scale as if it were efficiency. ROAS
 * against target is scale-free and answers the test the row is graded on;
 * spend against budget answers it for the rows graded on budget. Which one
 * opens follows the row's own judgeMode.
 * ------------------------------------------------------------------------- */
const GOAL_DAYS = { D0: 0, D7: 7, D28: 28, D30: 30 };

function selected(m) {
  if (!SELECTED) return null;
  if (SELECTED.startsWith('n:')) {
    const o = m.networks.find((n) => n.name === SELECTED.slice(2));
    return o ? { o, title: o.name, isNet: true } : null;
  }
  const [campaign, channel] = SELECTED.slice(2).split('||');
  const o = m.rows.find((c) => c.campaign === campaign && c.channel === channel);
  return o ? { o, title: shortName(o.campaign), isNet: false } : null;
}

function modeFor(sel) {
  if (MODE) return MODE;
  if (sel.o.budgetOnly) return 'budget';
  return sel.o.target != null ? 'roas' : 'money';
}

/**
 * Per-bucket ROAS on cohorts old enough to have reached the goal window.
 * Trailing buckets carry no value at all, and that is the point: a line drawn
 * through them would show a collapse to zero that is missing data, not lost
 * money — the same mistake a two-week window makes when it reports $0.00.
 */
function roasBuckets(o, goalDays, days) {
  const today = B().todayISO();
  const cost = bucketise(o._cost, days), rev = bucketise(o._rev, days);
  return cost.map((b2, i) => {
    const mature = B().isoShift(b2.to, goalDays) <= today;
    return { v: mature && b2.v > 0 ? rev[i].v / b2.v : null, label: b2.label,
             mc: mature ? b2.v : 0, mr: mature ? rev[i].v : 0 };
  });
}

function drawDetail(m) {
  const sel = selected(m), box = $('perfDetail');
  if (!sel) { box.classList.remove('on'); return; }
  box.classList.add('on');

  const mode = modeFor(sel);
  $('perfMode').querySelectorAll('button').forEach((b2) =>
    b2.setAttribute('aria-pressed', String(b2.dataset.m === mode)));

  const W = 900, H = 210, PL = 58, PR = 14, PT = 12, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB;
  const cost = bucketise(sel.o._cost, m.days), rev = bucketise(sel.o._rev, m.days);
  const n = cost.length;
  if (!n) { box.classList.remove('on'); return; }
  const x = (i) => PL + (n === 1 ? iw / 2 : i / (n - 1) * iw);

  let body = '', yFmt = kmoney, max = 1, yOf = (v) => v, note = '', pts = [];

  if (mode === 'roas') {
    const goal = (sel.o.goal || '').split(' / ')[0];
    const gd = GOAL_DAYS[goal] != null ? GOAL_DAYS[goal] : 7;
    const target = sel.o.target;
    const b2 = roasBuckets(sel.o, gd, m.days);
    const vals = b2.filter((k) => k.v != null).map((k) => k.v);
    max = Math.max(...vals, target || 0, 0.1) * 1.25;
    yOf = (v) => PT + ih - v / max * ih;
    yFmt = (v) => v.toFixed(2);

    let last = -1; b2.forEach((k, i) => { if (k.v != null) last = i; });
    if (last < n - 1) {
      const x0 = x(Math.max(last, 0));
      body += `<rect x="${x0.toFixed(1)}" y="${PT}" width="${(W - PR - x0).toFixed(1)}" height="${ih}" fill="var(--g-none)" opacity=".14"/>
        <line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="${PT}" y2="${PT + ih}" stroke="var(--t3)" stroke-width="1" stroke-dasharray="3 3"/>
        <text x="${(x0 + 9).toFixed(1)}" y="${PT + 14}" font-size="10.5" fill="var(--t3)">not old enough to judge yet</text>`;
    }
    if (target != null) {
      body += `<line x1="${PL}" x2="${W - PR}" y1="${yOf(target).toFixed(1)}" y2="${yOf(target).toFixed(1)}" stroke="var(--t2)" stroke-width="1.5" stroke-dasharray="5 4"/>
        <text x="${PL + 7}" y="${(yOf(target) - 6).toFixed(1)}" font-size="10.5" fill="var(--t2)">target ${target.toFixed(2)}</text>`;
    }
    const line = [];
    b2.forEach((k, i) => { if (k.v != null) line.push([x(i), yOf(k.v), k.v]); });
    if (line.length > 1) {
      const allUnder = target != null && line.every((q) => q[2] < target);
      body += `<path d="${line.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')}"
        fill="none" stroke="${allUnder ? 'var(--g-bad)' : 'var(--g-rev)'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    note = `${goal || 'cohort'} cohorts, dashed line is the target`;
    pts = b2.map((k, i) => ({ x: x(i), y: k.v == null ? null : yOf(k.v), label: k.label,
      rows: [['Back per $1', k.v == null ? 'not judged yet' : k.v.toFixed(2)],
             ['Graded spend', k.mc > 0 ? money(k.mc) : '—'],
             ['Target', target != null ? target.toFixed(2) : '—']] }));

  } else if (mode === 'budget') {
    const bud = sel.isNet ? sel.o.budget : sel.o.budget;
    let run = 0; const cum = cost.map((k) => (run += k.v));
    max = Math.max(...cum, bud || 0) * 1.08;
    yOf = (v) => PT + ih - v / max * ih;
    const p = cum.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yOf(v).toFixed(1)).join(' ');
    body += `<path d="${p} L ${x(n - 1).toFixed(1)} ${PT + ih} L ${x(0).toFixed(1)} ${PT + ih} Z" fill="var(--g-cost)" opacity=".14"/>
      <path d="${p}" fill="none" stroke="var(--g-cost)" stroke-width="2.5" stroke-linejoin="round"/>`;
    if (bud != null) {
      const isOver = cum[n - 1] > bud;
      body += `<line x1="${PL}" x2="${W - PR}" y1="${yOf(bud).toFixed(1)}" y2="${yOf(bud).toFixed(1)}"
        stroke="${isOver ? 'var(--g-bad)' : 'var(--g-warn)'}" stroke-width="1.5" stroke-dasharray="5 4"/>
        <text x="${PL + 7}" y="${(yOf(bud) - 6).toFixed(1)}" font-size="10.5" fill="${isOver ? 'var(--g-bad)' : 'var(--g-warn)'}">budget ${money(bud)}</text>`;
      note = isOver ? `over budget by ${money(cum[n - 1] - bud)}`
                    : `${Math.round(cum[n - 1] / bud * 100)}% of budget used`;
    } else note = 'no cap set, so there is nothing to pace against';
    pts = cum.map((v, i) => ({ x: x(i), y: yOf(v), label: cost[i].label,
      rows: [['Spent so far', money(v)], ['This period', money(cost[i].v)],
             ['Budget', bud != null ? money(bud) : 'none set']] }));

  } else {
    max = Math.max(...cost.map((k) => k.v), ...rev.map((k) => k.v), 1);
    yOf = (v) => PT + ih - v / max * ih;
    const ln = (a) => a.map((k, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yOf(k.v).toFixed(1)).join(' ');
    const dn = rev.slice().reverse().map((k, i) => 'L' + x(n - 1 - i).toFixed(1) + ' ' + yOf(k.v).toFixed(1)).join(' ');
    body += `<path d="${ln(cost)} ${dn} Z" fill="var(--g-bad)" opacity=".15"/>
      <path d="${ln(cost)}" fill="none" stroke="var(--g-cost)" stroke-width="2" stroke-linejoin="round"/>
      <path d="${ln(rev)}" fill="none" stroke="var(--g-rev)" stroke-width="2" stroke-linejoin="round"/>`;
    note = 'the shaded gap is cash';
    pts = cost.map((k, i) => ({ x: x(i), y: yOf(k.v), label: k.label,
      rows: [['Cost', money(k.v)], ['Revenue', money(rev[i].v)], ['Cash', money(rev[i].v - k.v)]] }));
  }

  let grid = '';
  for (let g = 0; g <= 3; g++) {
    const v = max * g / 3, yy = yOf(v);
    grid += `<line x1="${PL}" x2="${W - PR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--g-grid)" stroke-width="1"/>
      <text x="${PL - 9}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" font-family="DM Mono,monospace" fill="var(--t3)">${yFmt(v)}</text>`;
  }
  const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" font-size="10" fill="var(--t3)">${cost[i].label}</text>`).join('');

  const svg = $('pdSvg');
  svg.innerHTML = grid + body + ticks +
    `<line id="pdCross" x1="0" x2="0" y1="${PT}" y2="${PT + ih}" stroke="var(--t3)" stroke-width="1" opacity="0"/>
     <circle id="pdDot" r="4.5" fill="var(--t1)" stroke="var(--card)" stroke-width="2" opacity="0"/>`;

  const o = sel.o;
  $('pdTitle').textContent = sel.title;
  $('pdMeta').innerHTML = `${money(o.cost)} spent · ${money(o.allRev)} back · ` +
    `<span class="${o.cashGap < 0 ? 'neg' : 'pos'}">${money(o.cashGap)} cash</span>` +
    (o.goal && o.goal !== '—' ? ` · judged on ${esc(o.goal)}` : '') +
    (o.budgetOnly ? ' · budget, not ROAS' : '');
  $('pdRef').textContent = note;

  const plot = $('pdPlot'), tip = $('pdTip');
  const cross = svg.querySelector('#pdCross'), dot = svg.querySelector('#pdDot');
  plot.onmousemove = (ev) => {
    const bb = svg.getBoundingClientRect();
    let i = Math.round(((ev.clientX - bb.left) / bb.width * W - PL) / (iw || 1) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const p = pts[i];
    cross.setAttribute('x1', p.x); cross.setAttribute('x2', p.x); cross.setAttribute('opacity', '.5');
    if (p.y == null) dot.setAttribute('opacity', '0');
    else { dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('opacity', '1'); }
    tip.innerHTML = `<div class="d">${esc(p.label)}</div>` +
      p.rows.map((kv) => `<div class="r"><span>${kv[0]}</span><b>${kv[1]}</b></div>`).join('');
    tip.classList.add('on');
    tip.style.left = Math.min(p.x / W * bb.width + 16, bb.width - 190) + 'px';
    tip.style.top = '6px';
  };
  plot.onmouseleave = () => {
    tip.classList.remove('on');
    cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0');
  };
}

/* ---------------------------------------------------------------------------
 * Wiring
 * ------------------------------------------------------------------------- */
function wireOnce() {
  if (wireOnce.done) return;
  wireOnce.done = true;

  $('perfGrain').querySelectorAll('button').forEach((b2) => {
    b2.onclick = () => {
      $('perfGrain').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b2.setAttribute('aria-pressed', 'true');
      GRAIN = b2.dataset.g;
      if (MODEL) { renderTable(MODEL); drawDetail(MODEL); }
    };
  });

  /* Once chosen, the mode sticks. Moving down the table then compares like
     with like instead of silently changing the question under the reader. */
  $('perfMode').querySelectorAll('button').forEach((b2) => {
    b2.onclick = () => { MODE = b2.dataset.m; if (MODEL) drawDetail(MODEL); };
  });
}

window.__nsBridge.onRender = function (W) {
  wireOnce();
  MODEL = build(W);

  /* Open on the biggest spender rather than on nothing. An empty chart well
     is worse than a chart of the row the eye lands on first, and the network
     carrying the most money is the one worth a default. A selection that no
     longer exists — the window moved, the platform changed — falls back the
     same way instead of leaving a stale title above a blank plot. */
  const stillThere = SELECTED && (
    (SELECTED.startsWith('n:') && MODEL.networks.some((n) => 'n:' + n.name === SELECTED)) ||
    (SELECTED.startsWith('c:') && MODEL.rows.some((c) => 'c:' + c.campaign + '||' + c.channel === SELECTED)));
  if (!stillThere) SELECTED = MODEL.networks.length ? 'n:' + MODEL.networks[0].name : null;

  renderHead(MODEL);
  renderTable(MODEL);
  drawDetail(MODEL);
};

/* Exposed for the smoke test, which asserts the tiles and the table agree —
   the one invariant this file exists to hold. */
window.__glanceModel = () => MODEL;
