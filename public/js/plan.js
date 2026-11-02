// Monthly plan: a saved plan per person per month, with several funds per section, a Nifty 50
// share schedule (like the Excel "Monthly Schedule" sheet), the US basket, and recording/editing
// of what was actually bought.
import { api, esc, inr, num, pct, today, thisMonth, monthLabel, toast, openModal, waitForXLSX } from './util.js';
import { SLOTS } from './ranking.js';
import { loadDataset } from './tickertape.js';
import { usPriceLookup } from './stocks.js';

const FUND_SECTIONS = ['largecap', 'midsmall', 'debt', 'international', 'gold'];
const ORDER = ['largecap', 'nifty50', 'midsmall', 'debt', 'international', 'gold', 'usstocks'];
export const NIFTY_ID = '__nifty50__', US_ID = '__usbasket__';
const uid = () => Math.random().toString(36).slice(2, 10);
const monthIndex = (m) => { const [y, mo] = m.split('-').map(Number); return y * 12 + (mo - 1); };
const addMonths = (m, n) => { const i = monthIndex(m) + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };
const shortMonth = (m) => `${monthLabel(m).slice(0, 3)} ${m.slice(2, 4)}`;
const WEEKS_PER_MONTH = 52 / 12;

// ---------------------------------------------------------------- Nifty 50 plan
// Modes:
//   whole   – whole shares on a fixed schedule: each stock has {qty, every, offset}, e.g. HDFCBANK
//             3 shares every month, BRITANNIA 1 share every 3 months starting in the 2nd month.
//   monthly – fractional quantities by index weight, once a month
//   weekly  – the same, split into weekly buys
export const NIFTY_MODES = {
  whole: 'Whole shares on a schedule (e.g. 3 HDFCBANK every month, 1 ULTRACEMCO every 6 months)',
  monthly: 'Fractional shares by index weight, bought once a month',
  weekly: 'Fractional shares by index weight, bought every week',
};

function niftyStocks(S, excluded) {
  const ex = new Set(excluded ?? S.settings.niftyPlan?.excluded ?? []);
  const list = S.nifty.filter((x) => !ex.has(x.symbol));
  const w = list.reduce((a, x) => a + x.weight, 0) || 1;
  return list.map((x) => ({ ...x, share: x.weight / w }));
}

const dueIn = (sch, k) => (sch && sch.qty > 0 && k >= 0 && ((k - sch.offset) % sch.every + sch.every) % sch.every === 0 ? sch.qty : 0);
export const cadence = (sch) => (!sch || !sch.qty ? 'not bought' : sch.every === 1 ? `${sch.qty} every month` : `${sch.qty} every ${sch.every} months`);

// Build a whole-share schedule for a monthly budget, then stagger start months so spend is even
export function buildSchedule(stocks, amount, horizon = 24) {
  const sched = {};
  for (const x of stocks) {
    const rate = x.ltp ? (amount * x.share) / x.ltp : 0;
    if (!rate) { sched[x.symbol] = { qty: 0, every: 1, offset: 0 }; continue; }
    if (rate >= 0.75) sched[x.symbol] = { qty: Math.max(1, Math.round(rate)), every: 1, offset: 0 };
    else sched[x.symbol] = { qty: 1, every: Math.min(24, Math.max(2, Math.round(1 / rate))), offset: 0 };
  }
  return staggerSchedule(stocks, sched, horizon);
}
export function staggerSchedule(stocks, sched, horizon = 24) {
  const load = new Array(horizon).fill(0);
  const price = Object.fromEntries(stocks.map((x) => [x.symbol, x.ltp || 0]));
  const add = (sym, s, sign) => { for (let k = 0; k < horizon; k++) load[k] += sign * dueIn(s, k) * price[sym]; };
  // monthly buys first, then the costliest occasional buys get the emptiest months
  const syms = Object.keys(sched).filter((k) => sched[k].qty > 0 && price[k] !== undefined);
  syms.filter((k) => sched[k].every === 1).forEach((k) => add(k, sched[k], 1));
  syms.filter((k) => sched[k].every > 1).sort((a, b) => sched[b].qty * price[b] - sched[a].qty * price[a]).forEach((k) => {
    const s = sched[k];
    let best = 0, bestV = Infinity;
    for (let o = 0; o < s.every; o++) {
      let v = 0; for (let m = o; m < horizon; m += s.every) v = Math.max(v, load[m] + s.qty * price[k]);
      if (v < bestV) { bestV = v; best = o; }
    }
    s.offset = best; add(k, s, 1);
  });
  return sched;
}

// What the Nifty plan says to buy in a given month
export function niftyLinesFor(S, month, amount, planOverride) {
  const plan = planOverride || S.settings.niftyPlan || { mode: 'monthly' };
  const stocks = niftyStocks(S, plan.excluded);
  if (plan.mode === 'whole') {
    const k = monthIndex(month) - monthIndex(plan.startMonth || month);
    return stocks.map((x) => {
      const sch = plan.schedule?.[x.symbol];
      const qty = dueIn(sch, k);
      let next = null;
      if (!qty && sch?.qty) for (let j = Math.max(k + 1, 0); j < k + 1 + 48; j++) if (dueIn(sch, j)) { next = addMonths(plan.startMonth, j); break; }
      return { ...x, sch, qty, next, cost: qty * (x.ltp || 0) };
    });
  }
  return stocks.map((x) => {
    const qty = x.ltp ? (amount * x.share) / x.ltp : 0;
    return { ...x, qty, perWeek: plan.mode === 'weekly' ? qty / WEEKS_PER_MONTH : null, cost: qty * (x.ltp || 0) };
  });
}

// ---------------------------------------------------------------- plan page
let month = thisMonth();

export async function renderPlan(main, ctx) {
  const { S, saveSettings } = ctx;
  main.innerHTML = '<div class="boot" style="height:200px">Loading plan…</div>';
  const [{ plan, previous }, { transactions }] = await Promise.all([api('GET', `/api/plans/${month}`), api('GET', `/api/transactions?month=${month}`)]);
  let usDs = null;
  if (S.settings.usSlot) { try { usDs = await loadDataset('us'); } catch { /* not loaded */ } }
  const usPrice = usPriceLookup(usDs);
  const s = S.settings;
  const sum = (arr, k) => arr.reduce((a, t) => a + (t[k] || 0), 0);
  const fundOf = (code) => S.funds.find((f) => f.code === code);
  const rerender = () => renderPlan(main, ctx);

  // A month without a saved plan shows a draft: last month's plan (or your allocation). It is
  // saved as soon as you change or record anything.
  const draft = !plan;
  const lines = plan ? plan.lines : previous ? previous.lines.map((l) => ({ ...l, id: uid() })) : fromAllocation(ctx);
  const persist = () => api('PUT', `/api/plans/${month}`, { lines, note: plan?.note || '' });
  const save = async (msg) => { await persist(); if (msg) toast(msg); rerender(); };
  const ensureSaved = async () => { if (draft) await persist(); };

  // First time a Nifty line appears with no Nifty plan: set up the whole-share schedule
  const niftyLine = lines.find((l) => l.slot === 'nifty50');
  if (niftyLine && !s.niftyPlan) {
    const startMonth = month;
    await saveSettings({ niftyPlan: { mode: 'whole', startMonth, amount: niftyLine.amount, excluded: [], schedule: buildSchedule(niftyStocks(S, []), niftyLine.amount) } }, null);
  }

  const planned = sum(lines, 'amount');
  const recorded = sum(transactions, 'amount');
  main.innerHTML = `
    <div class="page-head"><div><h2>Monthly plan</h2><p>${esc(S.me.name)}'s plan for ${esc(monthLabel(month))}: what's due this month and what you bought.</p></div><div class="grow"></div>
      <div class="row tight" style="flex:0 0 auto"><button class="btn" id="mprev" title="Previous month">‹</button>
      <div><label class="f" for="pm">Month</label><input class="input" type="month" id="pm" value="${month}"></div><button class="btn" id="mnext" title="Next month">›</button></div></div>
    ${draft ? `<div class="card" style="border-color:var(--accent)"><b>Draft for ${esc(monthLabel(month))}.</b> <span class="note">Based on ${previous ? `${esc(monthLabel(previous.month))}'s plan` : 'your Setup allocation'}. It's saved when you change or record anything.</span>
      <div class="row tight" style="margin-top:8px"><button class="btn primary small" id="keepdraft">Save this plan</button>${previous ? '<button class="btn small" id="draftalloc">Use my Setup allocation instead</button>' : ''}</div></div>` : ''}
    <div class="stats">
      <div class="stat"><div class="k">Planned</div><div class="v">${inr(planned)}</div><div class="d">${planned !== s.monthlyTotal ? `<span class="warn">Setup says ${inr(s.monthlyTotal)}</span>` : 'matches Setup'}</div></div>
      <div class="stat"><div class="k">Recorded</div><div class="v">${inr(recorded)}</div><div class="d">${planned ? Math.round(recorded / planned * 100) : 0}% of plan</div></div>
      <div class="stat"><div class="k">Still to invest</div><div class="v">${inr(Math.max(0, planned - recorded))}</div></div>
    </div>
    ${draft ? '' : `<div class="row tight" style="margin-bottom:16px;flex-wrap:wrap">${previous ? `<button class="btn" id="copyprev">Replace with ${esc(monthLabel(previous.month))}'s plan</button>` : ''}
      <button class="btn" id="rebuild">Rebuild from my allocation</button><button class="btn danger" id="delplan">Delete this month's plan</button></div>`}
    ${ORDER.filter((slot) => lines.some((l) => l.slot === slot) || FUND_SECTIONS.includes(slot) || slot === 'nifty50' || (slot === 'usstocks' && s.usSlot)).map(section).join('')}
    <div class="card"><details ${transactions.length <= 15 ? 'open' : ''}><summary style="cursor:pointer"><h3 style="display:inline">Everything recorded in ${esc(monthLabel(month))}</h3> <span class="muted">(${transactions.length} purchase${transactions.length === 1 ? '' : 's'}, ${inr(recorded)}) · edit or delete here</span></summary>
      <div class="tablewrap" style="margin-top:10px"><table class="t"><thead><tr><th>Date</th><th>Section</th><th>Bought</th><th class="r">Units</th><th class="r">Price</th><th class="r">Amount</th><th></th></tr></thead>
      <tbody>${transactions.map((t) => `<tr><td>${esc(t.tradeDate)}</td><td>${SLOTS[t.slot]?.short || t.slot}</td><td class="nm">${esc(t.assetName)}</td><td class="r">${num(t.units, 4)}</td><td class="r">${num(t.price, 4)}</td><td class="r">${inr(t.amount, 2)}</td>
        <td><button class="btn small" data-edit="${t.id}">Edit</button> <button class="btn small danger" data-del="${t.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing recorded yet this month.</td></tr>'}</tbody></table></div></details></div>`;

  function section(slot) {
    const ls = lines.filter((l) => l.slot === slot);
    const tx = transactions.filter((t) => t.slot === slot);
    const head = (extra = '') => `<div class="sechead"><div><h3 style="margin:0">${SLOTS[slot].label}</h3>
      <p class="note" style="margin:2px 0 0">Planned ${inr(sum(ls, 'amount'))} · recorded ${inr(sum(tx, 'amount'))}</p></div><div class="row tight">${extra}</div></div>`;
    if (FUND_SECTIONS.includes(slot)) {
      return `<div class="card">${head(`<button class="btn small" data-add="${slot}">+ Add ${slot === 'gold' ? 'gold fund / ETF' : 'fund'}</button>`)}
        <div class="tablewrap"><table class="t"><thead><tr><th>Fund</th><th class="r">Planned ₹</th><th class="r">Latest NAV</th><th class="r">Est. units</th><th class="r">Bought</th><th></th></tr></thead>
        <tbody>${ls.map((l) => { const f = fundOf(l.assetId); const b = tx.filter((t) => t.assetId === l.assetId); return `<tr>
          <td class="nm">${esc(l.assetName)}<span class="a">${f ? esc(f.amc) : '<span class="warn">no longer in the fund list</span>'}${slot === 'gold' ? ' · buy on Kite' : ''}</span></td>
          <td class="r"><input class="input num amt" data-line="${l.id}" type="number" min="0" step="100" value="${l.amount}" style="width:110px;padding:4px 8px"></td>
          <td class="r">${f ? num(f.nav, 4) : '–'}</td><td class="r">${f?.nav ? num(l.amount / f.nav, 3) : '–'}</td>
          <td class="r">${b.length ? `${num(sum(b, 'units'), 3)} <span class="muted">(${inr(sum(b, 'amount'))})</span>` : '–'}</td>
          <td style="white-space:nowrap"><button class="btn small" data-rec="${l.id}">Record</button> <button class="btn small danger" data-drop="${l.id}">Drop</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">No funds in this section this month.</td></tr>'}</tbody></table></div></div>`;
    }
    if (slot === 'nifty50') return niftySection(ls[0], tx, head);
    if (slot === 'usstocks') {
      const line = ls[0];
      if (!line) return `<div class="card">${head(`<button class="btn small" data-addbasket="usstocks">+ Add US stocks to this month</button>`)}<p class="note">Not in this month's plan.</p></div>`;
      const basket = s.usBasket || [];
      const wT = basket.reduce((a, x) => a + (x.weight || 0), 0) || 1;
      return `<div class="card">${head(`<a class="btn small" href="#/stocks-us">Edit basket</a><button class="btn small danger" data-drop="${line.id}">Drop</button>`)}
        <div class="row" style="align-items:center;margin-bottom:10px"><div style="flex:0 0 200px"><label class="f">Amount this month (₹)</label><input class="input num amt" data-line="${line.id}" type="number" min="0" step="100" value="${line.amount}"></div>
          <p class="note" style="margin:0">${s.usdInr ? `About $${num(line.amount / s.usdInr, 2)} at ₹${num(s.usdInr, 2)} per dollar.` : '<span class="warn">Set the rupee–dollar rate in Setup to see quantities.</span>'}</p></div>
        <div class="tablewrap"><table class="t"><thead><tr><th>Stock</th><th class="r">Share</th><th class="r">Amount ₹</th><th class="r">Price $</th><th class="r">Qty</th><th class="r">Bought</th><th></th></tr></thead>
        <tbody>${basket.map((x, i) => { const inrAmt = line.amount * (x.weight || 0) / wT; const usd = usPrice(x.key); const q = usd && s.usdInr ? inrAmt / s.usdInr / usd : null; const b = tx.filter((t) => t.assetId === x.key); return `<tr>
          <td class="nm">${esc(x.name)}</td><td class="r">${pct((x.weight || 0) / wT * 100, 0)}</td><td class="r">${inr(inrAmt, 2)}</td><td class="r">${num(usd, 2)}</td><td class="r">${q ? num(q, 4) : '–'}</td>
          <td class="r">${b.length ? num(sum(b, 'units'), 4) : '–'}</td><td><button class="btn small" data-recus="${i}" data-q="${q ?? ''}" data-p="${usd && s.usdInr ? (usd * s.usdInr).toFixed(2) : ''}">Record</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Your US basket is empty. Add stocks on the US stocks page.</td></tr>'}</tbody></table></div></div>`;
    }
    return '';
  }

  function niftySection(line, tx, head) {
    if (!line) return `<div class="card">${head(`<button class="btn small" data-addbasket="nifty50">+ Add Nifty 50 to this month</button>`)}<p class="note">Not in this month's plan.</p></div>`;
    const np = S.settings.niftyPlan || { mode: 'monthly' };
    const whole = np.mode === 'whole';
    const rows = niftyLinesFor(S, month, line.amount);
    const boughtOf = (sym) => tx.filter((t) => t.assetId === sym);
    const due = whole ? rows.filter((r) => r.qty > 0 || boughtOf(r.symbol).length) : rows;
    const notDue = whole ? rows.filter((r) => !r.qty && !boughtOf(r.symbol).length && r.sch?.qty) : [];
    const cost = sum(due, 'cost');
    const before = whole && np.startMonth && month < np.startMonth;
    return `<div class="card">${head(`<button class="btn small" id="niftyplan">Edit Nifty 50 plan</button>${whole ? '<button class="btn small" id="niftysched">Full schedule</button>' : ''}${S.me.role === 'admin' ? '<button class="btn small" id="niftyupd">Update prices</button>' : ''}<button class="btn small danger" data-drop="${line.id}">Drop</button>`)}
      <div class="row" style="align-items:center;margin-bottom:10px">
        ${whole ? `<p class="note" style="flex:1 1 300px;margin:0"><b>${due.filter((r) => r.qty).length} stocks due in ${esc(monthLabel(month))}</b>, about <b>${inr(cost)}</b> at current prices (the schedule was set for ${inr(np.amount || line.amount)} a month, starting ${esc(monthLabel(np.startMonth))}).${before ? ' <span class="warn">This month is before the schedule starts.</span>' : ''}</p>`
    : `<div style="flex:0 0 200px"><label class="f">Amount this month (₹)</label><input class="input num amt" data-line="${line.id}" type="number" min="0" step="100" value="${line.amount}"></div>
        <p class="note" style="flex:1 1 300px;margin:0"><b>Plan:</b> ${esc(NIFTY_MODES[np.mode])}.</p>`}</div>
      <div class="tablewrap" style="max-height:60vh"><table class="t" id="ntable"><thead><tr><th>Stock</th>${whole ? '<th>How often</th>' : '<th class="r">Weight</th>'}<th class="r">Price</th><th class="r">${whole ? 'Shares due' : 'Qty this month'}</th>${np.mode === 'weekly' ? '<th class="r">Qty per week</th>' : ''}${whole ? '<th class="r">Cost</th>' : ''}<th class="r">Bought</th><th class="r">Qty bought</th><th class="r">Price paid</th></tr></thead>
      <tbody>${due.map((r) => { const b = boughtOf(r.symbol); return `<tr>
        <td><b>${esc(r.symbol)}</b>${r.name ? `<span class="a" style="display:block">${esc(r.name)}</span>` : ''}</td>${whole ? `<td>${esc(cadence(r.sch))}</td>` : `<td class="r">${pct(r.weight)}</td>`}<td class="r">${num(r.ltp, 2)}</td>
        <td class="r"><b>${whole ? r.qty : num(r.qty, 4)}</b></td>${np.mode === 'weekly' ? `<td class="r">${num(r.perWeek, 4)}</td>` : ''}${whole ? `<td class="r">${inr(r.cost)}</td>` : ''}
        <td class="r">${b.length ? num(sum(b, 'units'), 4) : '–'}</td>
        <td class="r"><input class="input num nq" data-sym="${esc(r.symbol)}" type="number" min="0" step="any" placeholder="${whole ? r.qty : +r.qty.toFixed(4)}" style="width:90px;padding:3px 6px"></td>
        <td class="r"><input class="input num np" data-sym="${esc(r.symbol)}" type="number" min="0" step="any" value="${r.ltp ?? ''}" style="width:90px;padding:3px 6px"></td></tr>`; }).join('') || `<tr><td colspan="9" class="muted">Nothing due this month.</td></tr>`}</tbody></table></div>
      <div class="row tight" style="margin-top:10px;align-items:flex-end;flex-wrap:wrap"><div><label class="f">Date bought</label><input class="input" id="ndate" type="date" value="${today()}"></div>
        <button class="btn" id="nfill">Fill in due quantities</button><button class="btn primary" id="nrec">Record quantities entered</button></div>
      ${notDue.length ? `<details style="margin-top:12px"><summary style="cursor:pointer"><b>Not due this month (${notDue.length})</b></summary>
        <div class="tablewrap" style="margin-top:8px"><table class="t"><thead><tr><th>Stock</th><th>How often</th><th>Next due</th></tr></thead>
        <tbody>${notDue.sort((a, b) => (a.next || '9').localeCompare(b.next || '9')).map((r) => `<tr><td><b>${esc(r.symbol)}</b></td><td>${esc(cadence(r.sch))}</td><td>${r.next ? esc(monthLabel(r.next)) : '–'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <p class="note">Prices last updated ${esc((S.nifty[0]?.updated_at || '').slice(0, 10) || '–')}.</p></div>`;
  }

  // ---- wiring
  const go = (m) => { month = m; rerender(); };
  document.getElementById('pm').onchange = (e) => go(e.target.value || thisMonth());
  document.getElementById('mprev').onclick = () => go(addMonths(month, -1));
  document.getElementById('mnext').onclick = () => go(addMonths(month, 1));
  document.getElementById('keepdraft')?.addEventListener('click', () => save('Plan saved'));
  document.getElementById('draftalloc')?.addEventListener('click', async () => { lines.splice(0, lines.length, ...fromAllocation(ctx)); await save('Plan built from your allocation'); });
  document.getElementById('copyprev')?.addEventListener('click', async () => {
    if (!confirm(`Replace this month's plan with ${monthLabel(previous.month)}'s? Purchases you've recorded stay as they are.`)) return;
    lines.splice(0, lines.length, ...previous.lines.map((l) => ({ ...l, id: uid() }))); await save('Copied last month\'s plan');
  });
  document.getElementById('rebuild')?.addEventListener('click', async () => {
    if (!confirm('Rebuild this month\'s plan from your Setup allocation? Your changes to this month\'s plan will be replaced (recorded purchases stay).')) return;
    lines.splice(0, lines.length, ...fromAllocation(ctx)); await save('Plan rebuilt from your allocation');
  });
  document.getElementById('delplan')?.addEventListener('click', async () => {
    if (!confirm(`Delete the plan for ${monthLabel(month)}? Recorded purchases are kept.`)) return;
    await api('DELETE', `/api/plans/${month}`); toast('Plan deleted'); rerender();
  });
  main.querySelectorAll('.amt').forEach((inp) => (inp.onchange = async () => {
    const l = lines.find((x) => x.id === inp.dataset.line); l.amount = Math.max(0, Number(inp.value) || 0); await save('Plan updated');
  }));
  main.querySelectorAll('[data-drop]').forEach((b) => (b.onclick = async () => {
    const l = lines.find((x) => x.id === b.dataset.drop);
    if (!confirm(`Drop ${l.assetName} from ${monthLabel(month)}'s plan? Past purchases stay in your portfolio.`)) return;
    lines.splice(lines.indexOf(l), 1); await save(`${l.assetName} dropped from this month`);
  }));
  main.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => addFundModal(b.dataset.add, ctx, async (f, amount) => {
    if (lines.some((l) => l.assetId === f.code)) return toast('That fund is already in this month\'s plan.');
    lines.push({ id: uid(), slot: b.dataset.add, assetId: f.code, assetName: f.name, amount }); await save(`${f.name} added`);
  })));
  main.querySelectorAll('[data-addbasket]').forEach((b) => (b.onclick = async () => {
    const slot = b.dataset.addbasket;
    lines.push({ id: uid(), slot, assetId: slot === 'nifty50' ? NIFTY_ID : US_ID, assetName: SLOTS[slot].label, amount: Math.round(s.monthlyTotal * (s.alloc[slot] || 0) / 100) || 1000 });
    await save(`${SLOTS[slot].label} added`);
  }));
  main.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = async () => {
    const l = lines.find((x) => x.id === b.dataset.rec); const f = fundOf(l.assetId);
    await ensureSaved();
    recordModal({ slot: l.slot, assetId: l.assetId, assetName: l.assetName, price: f?.nav ?? '', units: f?.nav ? +(l.amount / f.nav).toFixed(3) : '' }, rerender);
  }));
  main.querySelectorAll('[data-recus]').forEach((b) => (b.onclick = async () => {
    const x = (s.usBasket || [])[+b.dataset.recus];
    await ensureSaved();
    recordModal({ slot: 'usstocks', assetId: x.key, assetName: x.name, price: b.dataset.p, units: b.dataset.q ? +(+b.dataset.q).toFixed(4) : '', priceLabel: 'Price paid per share (₹ = $ price × rate)' }, rerender);
  }));
  main.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => {
    const t = transactions.find((x) => x.id === b.dataset.edit);
    recordModal({ ...t, priceLabel: t.slot === 'usstocks' ? 'Price paid per share (₹)' : null }, rerender, t.id);
  }));
  main.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const t = transactions.find((x) => x.id === b.dataset.del);
    if (!confirm(`Delete the purchase of ${num(t.units, 4)} ${t.assetName} on ${t.tradeDate}? This can't be undone.`)) return;
    try { await api('DELETE', `/api/transactions/${t.id}`); toast('Purchase deleted'); rerender(); } catch (e) { toast(e.message); }
  }));
  const nLine = lines.find((l) => l.slot === 'nifty50');
  document.getElementById('niftyplan')?.addEventListener('click', () => niftyPlanModal(ctx, nLine?.amount || 0, async (amt) => {
    if (nLine && amt && amt !== nLine.amount) { nLine.amount = amt; await persist(); }
    rerender();
  }));
  document.getElementById('niftysched')?.addEventListener('click', () => scheduleModal(S, month));
  document.getElementById('niftyupd')?.addEventListener('click', () => niftyPricesModal(ctx, rerender));
  document.getElementById('nfill')?.addEventListener('click', () => main.querySelectorAll('.nq').forEach((i) => { if (+i.placeholder) i.value = i.placeholder; }));
  document.getElementById('nrec')?.addEventListener('click', async () => {
    const date = document.getElementById('ndate').value || today();
    const entries = [...main.querySelectorAll('.nq')].map((i) => ({ sym: i.dataset.sym, units: Number(i.value), price: Number(main.querySelector(`.np[data-sym="${CSS.escape(i.dataset.sym)}"]`).value) })).filter((e) => e.units > 0);
    if (!entries.length) return toast('Enter the quantities you bought first (or use "Fill in due quantities").');
    if (entries.some((e) => !(e.price > 0))) return toast('Every row with a quantity needs the price you paid.');
    if (!confirm(`Record ${entries.length} Nifty 50 purchase${entries.length > 1 ? 's' : ''} dated ${date}?`)) return;
    try {
      await ensureSaved();
      for (const e of entries) await api('POST', '/api/transactions', { slot: 'nifty50', assetId: e.sym, assetName: e.sym, tradeDate: date, month, units: e.units, price: e.price });
      toast(`${entries.length} Nifty 50 purchases recorded`); rerender();
    } catch (err) { toast(err.message); }
  });
}

// One line per allocated section, using your pinned / top-ranked fund
function fromAllocation(ctx) {
  const { S, chosenFund } = ctx;
  const s = S.settings;
  const out = [];
  for (const slot of ORDER) {
    const pctv = s.alloc[slot] || 0;
    if (!pctv || (slot === 'usstocks' && !s.usSlot)) continue;
    const amount = Math.round(s.monthlyTotal * pctv / 100);
    if (FUND_SECTIONS.includes(slot)) {
      const { fund } = chosenFund(slot);
      if (fund) out.push({ id: uid(), slot, assetId: fund.code, assetName: fund.name, amount });
    } else out.push({ id: uid(), slot, assetId: slot === 'nifty50' ? NIFTY_ID : US_ID, assetName: SLOTS[slot].label, amount });
  }
  return out;
}

// ---------------------------------------------------------------- modals
function addFundModal(slot, ctx, onPick) {
  const { S, rankedFor, isExcluded } = ctx;
  const ranked = rankedFor(slot);
  const rankOf = new Map(ranked.map((f) => [f.code, f.rank]));
  const all = S.funds.filter((f) => f.slot === slot).sort((a, b) => (rankOf.get(a.code) ?? 1e9) - (rankOf.get(b.code) ?? 1e9) || a.name.localeCompare(b.name));
  openModal(`<h3>Add a ${SLOTS[slot].label.toLowerCase()} ${slot === 'gold' ? 'fund or ETF' : 'fund'}</h3>
    <p class="note">Sorted by your ranking on the Fund dashboard. Funds from excluded fund houses are marked.</p>
    <input class="input" id="afq" placeholder="Search…" style="margin-bottom:8px">
    <div class="tablewrap" style="max-height:45vh"><table class="t"><tbody id="afl"></tbody></table></div>
    <div class="row" style="margin-top:12px;align-items:flex-end"><div><label class="f">Amount this month (₹)</label><input class="input num" id="afa" type="number" min="0" step="100" value="${Math.round(S.settings.monthlyTotal * (S.settings.alloc[slot] || 0) / 100) || 1000}"></div>
      <button class="btn" data-close style="flex:0 0 auto">Cancel</button><button class="btn primary" id="afok" style="flex:0 0 auto" disabled>Add</button></div>`, (root, close) => {
    let pick = null;
    const draw = (q = '') => {
      root.querySelector('#afl').innerHTML = all.filter((f) => !q || (f.name + f.amc).toLowerCase().includes(q.toLowerCase())).slice(0, 200).map((f) => `<tr data-c="${f.code}" style="cursor:pointer" class="${pick === f.code ? 'chosen' : ''}">
        <td class="r rank">${rankOf.get(f.code) ?? '–'}</td><td class="nm">${esc(f.name)}${isExcluded(f) ? ' <span class="badge bad">excluded AMC</span>' : ''}<span class="a">${esc(f.amc)}</span></td>
        <td class="r">${pct(f.cagr3)}</td><td class="r">${f.expenseRatio === null ? '–' : pct(f.expenseRatio)}</td></tr>`).join('') || '<tr><td class="muted">No match.</td></tr>';
      root.querySelectorAll('#afl tr[data-c]').forEach((tr) => (tr.onclick = () => { pick = tr.dataset.c; root.querySelector('#afok').disabled = false; draw(root.querySelector('#afq').value); }));
    };
    draw();
    root.querySelector('#afq').oninput = (e) => draw(e.target.value);
    root.querySelector('#afok').onclick = () => { const f = all.find((x) => x.code === pick); close(); onPick(f, Math.max(0, Number(root.querySelector('#afa').value) || 0)); };
  });
}

export function recordModal(pre, done, editId) {
  openModal(`<h3>${editId ? 'Edit purchase' : 'Record purchase'}</h3><p class="note">${esc(pre.assetName)}</p>
    <form id="rf" style="display:grid;gap:12px">
      <div class="row"><div><label class="f">Date bought</label><input class="input" name="tradeDate" type="date" value="${esc(pre.tradeDate || today())}" required></div>
      <div><label class="f">Counts towards month</label><input class="input" name="month" type="month" value="${esc(pre.month || month)}"></div></div>
      <div class="row"><div><label class="f">Units / quantity</label><input class="input num" name="units" type="number" step="any" min="0" value="${pre.units ?? ''}" required></div>
      <div><label class="f">${esc(pre.priceLabel || (pre.slot === 'nifty50' ? 'Price paid' : 'NAV paid'))}</label><input class="input num" name="price" type="number" step="any" min="0" value="${pre.price ?? ''}" required></div></div>
      <div class="row"><div><label class="f">Total amount (₹)</label><input class="input num" name="amount" type="number" step="any" min="0" value="${editId ? pre.amount : ''}"></div>
      <div><label class="f">Note (optional)</label><input class="input" name="note" value="${esc(pre.note || '')}"></div></div>
      <p class="note">Leave the amount blank to use units × price. Check the actual units on your Coin / Kite contract note.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">${editId ? 'Save changes' : 'Save'}</button></div>
    </form>`, (root, close) => {
    const f = root.querySelector('#rf');
    const auto = editId && Math.abs(pre.amount - pre.units * pre.price) < 0.02; // amount was units × price
    const upd = () => { const u = +f.units.value, p = +f.price.value; f.amount.placeholder = u && p ? (u * p).toFixed(2) : ''; };
    f.units.oninput = f.price.oninput = () => { if (auto) f.amount.value = ''; upd(); }; upd();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      if (editId && d.amount === '') d.amount = null;
      const payload = { ...d, slot: pre.slot, assetId: pre.assetId, assetName: pre.assetName };
      try {
        if (editId) await api('PUT', `/api/transactions/${editId}`, payload); else await api('POST', '/api/transactions', payload);
        close(); toast(editId ? 'Purchase updated' : 'Purchase recorded'); done();
      } catch (err) { toast(err.message); }
    };
  });
}

// 12-month grid like the Excel "Monthly Schedule" sheet
function scheduleGrid(S, plan, from, n = 12) {
  const months = Array.from({ length: n }, (_, i) => addMonths(from, i));
  const per = months.map((m) => niftyLinesFor(S, m, plan.amount, plan));
  const stocks = per[0].filter((r) => r.sch?.qty);
  const totals = per.map((rows) => rows.reduce((a, r) => a + r.cost, 0));
  return `<div class="tablewrap" style="max-height:55vh"><table class="t sched"><thead><tr><th>Stock</th><th>How often</th>${months.map((m) => `<th class="r">${esc(shortMonth(m))}</th>`).join('')}</tr></thead>
    <tbody>${stocks.map((r, i) => `<tr><td><b>${esc(r.symbol)}</b></td><td style="white-space:nowrap">${esc(cadence(r.sch))}</td>${per.map((rows) => { const q = rows[i].qty; return `<td class="r">${q ? `<b>${q}</b>` : '<span class="muted">·</span>'}</td>`; }).join('')}</tr>`).join('')}
    <tr><td colspan="2"><b>Cost at today's prices</b></td>${totals.map((t) => `<td class="r"><b>${inr(t)}</b></td>`).join('')}</tr></tbody></table></div>`;
}

function scheduleModal(S, from) {
  const plan = S.settings.niftyPlan;
  openModal(`<h3>Nifty 50 schedule</h3><p class="note">Shares due each month for the next 12 months from ${esc(monthLabel(from))}. Budget ${inr(plan.amount)} a month. Change it with "Edit Nifty 50 plan".</p>
    ${scheduleGrid(S, plan, from)}
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="schxl" style="flex:0 0 auto">Download as Excel</button><button class="btn primary" data-close style="flex:0 0 auto">Close</button></div>`, (root) => {
    root.querySelector('#modal-card').classList.add('wide');
    root.querySelector('#schxl').onclick = async () => {
      const XLSX = await waitForXLSX();
      const months = Array.from({ length: 24 }, (_, i) => addMonths(from, i));
      const per = months.map((m) => niftyLinesFor(S, m, plan.amount, plan));
      const rows = per[0].filter((r) => r.sch?.qty).map((r, i) => ({ Stock: r.symbol, 'How often': cadence(r.sch), Price: r.ltp, ...Object.fromEntries(months.map((m, j) => [shortMonth(m), per[j][per[0].indexOf(r)].qty || ''])) })); // eslint-disable-line no-unused-vars
      rows.push({ Stock: 'Cost at today\'s prices', ...Object.fromEntries(months.map((m, j) => [shortMonth(m), Math.round(per[j].reduce((a, r) => a + r.cost, 0))])) });
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Monthly Schedule');
      XLSX.writeFile(wb, `vithai-nifty50-schedule-${from}.xlsx`);
    };
  });
}

function niftyPlanModal(ctx, amount, done) {
  const { S, saveSettings } = ctx;
  const cur = S.settings.niftyPlan || {};
  const draft = {
    mode: cur.mode || 'whole', startMonth: cur.startMonth || month, amount: cur.amount || amount,
    excluded: [...(cur.excluded || [])], schedule: JSON.parse(JSON.stringify(cur.schedule || {})),
  };
  if (!Object.keys(draft.schedule).length) draft.schedule = buildSchedule(niftyStocks(S, draft.excluded), draft.amount);
  openModal(`<h3>Nifty 50 plan</h3>
    <p class="note">How your Nifty 50 money turns into shares. You can change it any time; every month's plan follows it.</p>
    <div>${Object.entries(NIFTY_MODES).map(([k, l]) => `<label class="toggle" style="display:flex;margin:6px 0"><input type="radio" name="nmode" value="${k}" ${draft.mode === k ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <div id="wholebox" style="${draft.mode === 'whole' ? '' : 'display:none'}">
      <div class="row" style="margin-top:8px;align-items:flex-end">
        <div style="flex:0 0 170px"><label class="f">Monthly budget (₹)</label><input class="input num" id="namt" type="number" min="0" step="500" value="${draft.amount}"></div>
        <div style="flex:0 0 180px"><label class="f">Schedule starts</label><input class="input" type="month" id="nstart" value="${draft.startMonth}"></div>
        <button class="btn" id="nauto" style="flex:0 0 auto">Work out shares from budget</button>
        <button class="btn" id="nstag" style="flex:0 0 auto">Re-balance months</button></div>
      <p class="note">"Work out shares" sets each stock's shares and frequency from its index weight and today's price, e.g. 3 every month, or 1 every 4 months. Edit any row below. "Re-balance months" moves the first month of occasional buys so each month costs about the same.</p>
      <div class="tablewrap" style="max-height:34vh"><table class="t"><thead><tr><th>Stock</th><th class="r">Price</th><th class="r">Shares</th><th class="r">Every … months</th><th>First buy</th><th class="r">≈ ₹ a month</th></tr></thead><tbody id="nsch"></tbody></table></div>
      <h4 style="margin:14px 0 6px">Next 12 months</h4><div id="ngrid"></div></div>
    <div id="fracbox" class="note" style="${draft.mode === 'whole' ? 'display:none' : ''};margin-top:10px">Quantities are worked out each month from that month's Nifty 50 amount, index weights and latest prices.</div>
    <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Exclude stocks (<span id="nexc">${draft.excluded.length}</span>)</summary>
      <div style="columns:4;font-size:12.5px;margin-top:8px">${S.nifty.map((x) => `<label class="toggle" style="display:flex"><input type="checkbox" class="nex" value="${esc(x.symbol)}" ${draft.excluded.includes(x.symbol) ? 'checked' : ''}> ${esc(x.symbol)}</label>`).join('')}</div>
      <p class="note">Excluded stocks' weight is shared out across the rest (use "Work out shares" again afterwards).</p></details>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close style="flex:0 0 auto">Cancel</button><button class="btn primary" id="nsave" style="flex:0 0 auto">Save Nifty 50 plan</button></div>`, (root, close) => {
    root.querySelector('#modal-card').classList.add('wide');
    const stocks = () => niftyStocks(S, draft.excluded);
    const draw = () => {
      if (draft.mode !== 'whole') return;
      const months = Array.from({ length: 24 }, (_, i) => addMonths(draft.startMonth, i));
      root.querySelector('#nsch').innerHTML = stocks().map((x) => {
        const sc = draft.schedule[x.symbol] || (draft.schedule[x.symbol] = { qty: 0, every: 1, offset: 0 });
        return `<tr><td><b>${esc(x.symbol)}</b></td><td class="r">${num(x.ltp, 2)}</td>
          <td class="r"><input class="input num sq" data-s="${esc(x.symbol)}" type="number" min="0" step="1" value="${sc.qty}" style="width:64px;padding:3px 6px"></td>
          <td class="r"><input class="input num se" data-s="${esc(x.symbol)}" type="number" min="1" max="36" step="1" value="${sc.every}" style="width:64px;padding:3px 6px"></td>
          <td><select class="input so" data-s="${esc(x.symbol)}" style="padding:3px 6px" ${sc.every === 1 ? 'disabled' : ''}>${months.slice(0, sc.every).map((m, i) => `<option value="${i}" ${i === sc.offset ? 'selected' : ''}>${esc(shortMonth(m))}</option>`).join('')}</select></td>
          <td class="r">${inr(sc.qty * (x.ltp || 0) / sc.every)}</td></tr>`;
      }).join('');
      root.querySelector('#ngrid').innerHTML = scheduleGrid(S, draft, draft.startMonth);
      const field = (cls, key) => root.querySelectorAll(cls).forEach((i) => (i.onchange = () => {
        const sc = draft.schedule[i.dataset.s];
        sc[key] = Math.max(key === 'every' ? 1 : 0, Math.round(Number(i.value) || 0));
        if (sc.offset >= sc.every) sc.offset = 0;
        draw();
      }));
      field('.sq', 'qty'); field('.se', 'every'); field('.so', 'offset');
    };
    root.querySelectorAll('input[name=nmode]').forEach((r) => (r.onchange = () => {
      draft.mode = r.value;
      root.querySelector('#wholebox').style.display = draft.mode === 'whole' ? '' : 'none';
      root.querySelector('#fracbox').style.display = draft.mode === 'whole' ? 'none' : '';
      draw();
    }));
    root.querySelector('#nstart').onchange = (e) => { draft.startMonth = e.target.value || month; draw(); };
    root.querySelector('#namt').onchange = (e) => { draft.amount = Math.max(0, Number(e.target.value) || 0); };
    root.querySelector('#nauto').onclick = () => {
      if (!confirm('Replace every stock\'s shares and frequency with ones worked out from the budget?')) return;
      draft.amount = Math.max(0, Number(root.querySelector('#namt').value) || 0);
      draft.schedule = buildSchedule(stocks(), draft.amount); draw();
    };
    root.querySelector('#nstag').onclick = () => { staggerSchedule(stocks(), draft.schedule); draw(); toast('Months re-balanced'); };
    root.querySelectorAll('.nex').forEach((c) => (c.onchange = () => {
      draft.excluded = [...root.querySelectorAll('.nex:checked')].map((x) => x.value);
      root.querySelector('#nexc').textContent = draft.excluded.length; draw();
    }));
    root.querySelector('#nsave').onclick = async () => {
      draft.amount = Math.max(0, Number(root.querySelector('#namt').value) || 0);
      await saveSettings({ niftyPlan: draft }, 'Nifty 50 plan saved'); close(); done(draft.mode === 'whole' ? draft.amount : null);
    };
    draw();
  });
}

function niftyPricesModal(ctx, done) {
  const { S } = ctx;
  openModal(`<h3>Update Nifty 50 prices and weights</h3>
    <p class="note">Loading your Indian stocks export on the Data page updates prices automatically. Or paste a table with Symbol and LTP (and optionally Weight) columns, or choose a CSV / Excel file. Tick the box to replace the whole constituent list (needs a Weight column).</p>
    <textarea class="input" id="npaste" rows="7" placeholder="Symbol&#9;LTP&#10;HDFCBANK&#9;700"></textarea>
    <div class="row" style="margin-top:10px"><label class="btn" style="flex:0 0 auto"><input type="file" id="nfile" accept=".csv,.xlsx,.xls" hidden>Choose file…</label>
      <label class="toggle"><input type="checkbox" id="nreplace">Replace constituents</label></div>
    <div id="nmsg" class="note" style="margin-top:8px"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close style="flex:0 0 auto">Cancel</button><button class="btn primary" id="nsave" disabled style="flex:0 0 auto">Save</button></div>`, (root, close) => {
    let rows = [];
    const parse = (table) => {
      const h = table[0].map((x) => String(x ?? '').trim().toLowerCase());
      const ci = (re) => h.findIndex((x) => re.test(x));
      const iS = ci(/^symbol|^ticker/), iL = ci(/^ltp|last|price|close/), iW = ci(/weight/);
      if (iS < 0) throw new Error('No "Symbol" column found.');
      const n = (v) => { const x = parseFloat(String(v ?? '').replace(/[,%₹\s]/g, '')); return isFinite(x) ? x : null; };
      return table.slice(1).filter((r) => r[iS]).map((r) => ({ symbol: String(r[iS]).trim().toUpperCase(), ltp: iL >= 0 ? n(r[iL]) : null, weight: iW >= 0 ? n(r[iW]) : null })).filter((r) => r.symbol !== 'NIFTY 50');
    };
    const show = () => { root.querySelector('#nmsg').textContent = rows.length ? `${rows.length} rows · ${rows.filter((r) => r.ltp !== null).length} prices · ${rows.filter((r) => r.weight !== null).length} weights` : ''; root.querySelector('#nsave').disabled = !rows.length; };
    root.querySelector('#npaste').oninput = (e) => { try { const t = e.target.value.trim().split(/\r?\n/).map((l) => l.split(/\t|,/)); rows = t.length > 1 ? parse(t) : []; show(); } catch (err) { rows = []; root.querySelector('#nmsg').textContent = err.message; } };
    root.querySelector('#nfile').onchange = async (e) => { try { const XLSX = await waitForXLSX(); const wb = XLSX.read(new Uint8Array(await e.target.files[0].arrayBuffer()), { type: 'array' }); rows = parse(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })); show(); } catch (err) { root.querySelector('#nmsg').textContent = err.message; } };
    root.querySelector('#nsave').onclick = async () => {
      const replace = root.querySelector('#nreplace').checked;
      if (replace && !confirm('Replace the whole Nifty 50 list for your household with this one?')) return;
      try { const r = await api('PUT', '/api/nifty', { rows, replaceWeights: replace }); S.nifty = r.stocks; close(); toast('Nifty 50 data updated'); done(); } catch (err) { toast(err.message); }
    };
  });
}
