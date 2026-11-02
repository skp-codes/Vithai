// Vithai front-end: a small single-page app with hash routes.
import { api, esc, inr, num, pct, signCls, today, thisMonth, monthLabel, toast, openModal, xirr, waitForXLSX } from './util.js'; // eslint-disable-line no-unused-vars
import { METRICS, SLOTS, DEFAULT_CRITERIA, rankFunds } from './ranking.js';
import { renderStocks, usPriceLookup } from './stocks.js';
import { KINDS, readExport, mergeParts, toDataset, uploadDataset, loadDataset, clearDatasetCache, mfFactsRows, niftyPricesFrom, saveMfFacts } from './tickertape.js';

const S = { me: null, settings: null, funds: [], meta: {}, nifty: [], route: 'setup', fundsTab: 'largecap', loaded: false };
const app = document.getElementById('app');
const FUND_SLOTS = ['largecap', 'midsmall', 'debt', 'international', 'gold'];
const SUB_OPTIONS = { midsmall: ['Mid Cap', 'Small Cap'], debt: ['Corporate Bond', 'Banking and PSU'] };
const FACT_KEYS = ['expenseRatio', 'aum', 'exitLoad', 'alpha', 'peRatio', 'ytm'];

const ICONS = {
  setup: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  funds: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  plan: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  portfolio: '<path d="M21 12a9 9 0 11-9-9v9h9z"/><path d="M21 12A9 9 0 0012 3"/>',
  'stocks-in': '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  'stocks-us': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  household: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
};
const ROUTES = [['setup', 'Setup'], ['funds', 'Fund dashboard'], ['stocks-in', 'Indian stocks'], ['stocks-us', 'US stocks'], ['plan', 'Monthly plan'], ['portfolio', 'Portfolio'], ['data', 'Data'], ['household', 'Household']];

// ---------------------------------------------------------------- boot & routing
async function boot() {
  try {
    const { user } = await api('GET', '/api/me');
    S.me = user;
  } catch { S.me = null; }
  if (!S.me) return renderAuth();
  if (S.me.status !== 'active') return renderPending();
  await loadData();
  window.addEventListener('hashchange', route);
  route();
}

async function loadData() {
  const [s, f, n] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/funds'), api('GET', '/api/nifty')]);
  S.settings = s.settings;
  S.funds = f.funds.map(flattenFacts);
  S.meta = f.meta || {};
  S.nifty = n.stocks;
  S.loaded = true;
}

function flattenFacts(f) {
  const out = { ...f };
  for (const k of FACT_KEYS) out[k] = typeof f.facts?.[k] === 'number' ? f.facts[k] : null;
  return out;
}

function route() {
  const r = (location.hash.replace('#/', '') || 'setup').split('/')[0];
  S.route = ROUTES.some(([k]) => k === r) ? r : 'setup';
  renderShell();
}

function renderShell() {
  const nav = ROUTES.map(([k, label]) => `<a href="#/${k}" class="${S.route === k ? 'on' : ''}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg><span>${label}</span></a>`).join('');
  app.innerHTML = `<div class="shell">
    <aside class="rail">
      <div class="brand"><h1>VITHAI</h1><p>Plant monthly, grow steadily</p></div>
      <nav class="nav">${nav}</nav>
      <div class="rail-foot"><div class="who">${esc(S.me.name)}</div><div>${esc(S.me.householdName)}</div><button id="logout">Sign out</button></div>
    </aside>
    <main id="main"></main></div>`;
  document.getElementById('logout').onclick = async () => { await api('POST', '/api/auth/logout'); location.hash = ''; location.reload(); };
  const main = document.getElementById('main');
  const ctx = { S, saveSettings };
  ({ setup: renderSetup, funds: renderFunds, 'stocks-in': (m) => renderStocks(m, 'in', ctx), 'stocks-us': (m) => renderStocks(m, 'us', ctx), plan: renderPlan, portfolio: renderPortfolio, data: renderData, household: renderHousehold })[S.route](main);
  if (S.me.mustChangePassword) promptPasswordChange(true);
}

// ---------------------------------------------------------------- ranking helpers
function slotConfig(slot) {
  const d = DEFAULT_CRITERIA[slot];
  const o = S.settings.criteria?.[slot] || {};
  return { minAge: o.minAge ?? d.minAge, sub: o.sub ?? d.sub, criteria: o.criteria ?? d.criteria, hideClosed: o.hideClosed ?? true };
}
const isExcluded = (f) => (S.settings.excludedAmcs || []).some((a) => f.amc.toLowerCase() === a.toLowerCase());

function eligibleFunds(slot, cfg = slotConfig(slot)) {
  return S.funds.filter((f) => f.slot === slot
    && !isExcluded(f)
    && (f.ageYears ?? 0) >= cfg.minAge
    && (!cfg.sub.length || cfg.sub.some((s) => f.category.toLowerCase().includes(s.toLowerCase())))
    && !(cfg.hideClosed && /closed|paused|suspend/i.test(f.facts?.status || '')));
}

function rankedFor(slot) { const cfg = slotConfig(slot); return rankFunds(eligibleFunds(slot, cfg), cfg.criteria); }

function chosenFund(slot) {
  const pin = S.settings.picks?.[slot];
  if (pin) { const f = S.funds.find((x) => x.code === pin); if (f) return { fund: f, pinned: true }; }
  const top = rankedFor(slot)[0];
  return top ? { fund: top, pinned: false } : { fund: null, pinned: false };
}

async function saveSettings(patch, msg = 'Saved') {
  const { settings } = await api('PUT', '/api/settings', patch);
  S.settings = settings;
  if (msg) toast(msg);
}

// ---------------------------------------------------------------- SETUP
function renderSetup(main) {
  const s = S.settings;
  const amcs = [...new Set(S.funds.map((f) => f.amc))].sort();
  const rows = Object.keys(SLOTS).filter((k) => k !== 'usstocks' || s.usSlot).map((k) => {
    const c = k === 'nifty50' || k === 'usstocks' ? null : chosenFund(k);
    const pick = k === 'nifty50'
      ? `<span class="muted">${S.nifty.length} stocks by index weight</span>`
      : k === 'usstocks' ? `<span class="muted">${(s.usBasket || []).length} stocks in your US basket</span> <a href="#/stocks-us">edit</a>`
      : c.fund ? `${esc(c.fund.name)} ${c.pinned ? '<span class="badge">pinned</span>' : '<span class="badge good">top ranked</span>'}` : '<span class="warn">No data yet</span>';
    return `<tr><td><b>${SLOTS[k].label}</b></td>
      <td class="r"><input class="input num alloc" data-slot="${k}" type="number" min="0" max="100" step="1" value="${s.alloc[k] ?? 0}" style="width:80px"></td>
      <td class="r amt" data-slot="${k}"></td><td class="nm">${pick}</td></tr>`;
  }).join('');
  main.innerHTML = `
    <div class="page-head"><div><h2>Setup</h2><p>Your monthly amount, how it's split, and which fund houses to leave out.</p></div></div>
    <div class="card">
      <h3>Monthly investment</h3><p class="sub">The total you invest each month across all slots.</p>
      <div class="row" style="max-width:420px"><div><label class="f" for="total">Monthly total (₹)</label>
      <input class="input num" id="total" type="number" min="0" step="500" value="${s.monthlyTotal}"></div></div>
    </div>
    <div class="card">
      <h3>Allocation</h3><p class="sub">Percentages must add up to 100. The fund shown is the top-ranked one on the Fund dashboard, unless you've pinned a different one there.</p>
      <div class="tablewrap"><table class="t"><thead><tr><th>Slot</th><th class="r">%</th><th class="r">Per month</th><th>Fund</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td>Total</td><td class="r" id="pctsum"></td><td class="r" id="amtsum"></td><td id="sumnote"></td></tr></tfoot></table></div>
    </div>
    <div class="card">
      <h3>Fund houses to exclude</h3><p class="sub">Funds from these AMCs never appear in your rankings or plan.</p>
      <div id="exl"></div>
      <div class="row" style="max-width:520px;margin-top:8px"><div><select class="input" id="amcsel"><option value="">Add a fund house…</option>${amcs.map((a) => `<option>${esc(a)}</option>`).join('')}</select></div></div>
    </div>
    <div class="card">
      <h3>US stocks slot</h3><p class="sub">Optional. When on, a US stocks line joins the allocation above, invested across the basket you build on the US stocks dashboard.</p>
      <label class="toggle"><input type="checkbox" id="usslot" ${s.usSlot ? 'checked' : ''}>Include a US stocks slot in my allocation</label>
      <div class="row" style="max-width:420px;margin-top:12px"><div><label class="f" for="usdinr">Rupees per US dollar (₹)</label><input class="input num" id="usdinr" type="number" min="0" step="0.01" value="${s.usdInr ?? ''}" placeholder="e.g. today's rate"></div></div>
      <p class="note">Used to convert the slot's rupee amount into dollars and to value your US holdings. Update it when the rate moves.</p>
    </div>
    <div class="row" style="max-width:420px"><button class="btn primary" id="savesetup">Save setup</button></div>`;

  let excluded = [...(s.excludedAmcs || [])];
  const drawExcl = () => {
    document.getElementById('exl').innerHTML = excluded.length
      ? excluded.map((a, i) => `<span class="chip">${esc(a)}<button data-i="${i}" aria-label="Remove ${esc(a)}">×</button></span>`).join('')
      : '<span class="note">None excluded.</span>';
    document.querySelectorAll('#exl button').forEach((b) => (b.onclick = () => { excluded.splice(+b.dataset.i, 1); drawExcl(); }));
  };
  drawExcl();
  document.getElementById('amcsel').onchange = (e) => { if (e.target.value && !excluded.includes(e.target.value)) excluded.push(e.target.value); e.target.value = ''; drawExcl(); };

  const recalc = () => {
    const total = Number(document.getElementById('total').value) || 0;
    let sum = 0;
    document.querySelectorAll('.alloc').forEach((i) => {
      const p = Number(i.value) || 0; sum += p;
      main.querySelector(`.amt[data-slot="${i.dataset.slot}"]`).textContent = inr(total * p / 100);
    });
    document.getElementById('pctsum').textContent = `${sum}%`;
    document.getElementById('amtsum').textContent = inr(total * sum / 100);
    document.getElementById('sumnote').innerHTML = sum === 100 ? '<span class="pos">Adds up to 100%</span>' : `<span class="warn">${sum < 100 ? 100 - sum + '% unallocated' : sum - 100 + '% over'}</span>`;
    return sum;
  };
  main.querySelectorAll('input').forEach((i) => (i.oninput = recalc));
  recalc();
  document.getElementById('usslot').onchange = async (e) => {
    try { await saveSettings({ usSlot: e.target.checked, usdInr: Number(document.getElementById('usdinr').value) || null }, e.target.checked ? 'US stocks slot added. Give it a percentage below.' : 'US stocks slot removed'); renderSetup(main); } catch (err) { toast(err.message); }
  };
  document.getElementById('savesetup').onclick = async () => {
    if (recalc() !== 100) return toast('Make the percentages add up to 100 first.');
    const alloc = {};
    document.querySelectorAll('.alloc').forEach((i) => (alloc[i.dataset.slot] = Number(i.value) || 0));
    try {
      await saveSettings({ monthlyTotal: Number(document.getElementById('total').value) || 0, alloc, excludedAmcs: excluded, usdInr: Number(document.getElementById('usdinr').value) || null }, 'Setup saved');
      renderSetup(main);
    } catch (e) { toast(e.message); }
  };
}

// ---------------------------------------------------------------- FUND DASHBOARD
let fundSort = { key: 'rank', dir: 1 };
let fundSearch = '';
function renderFunds(main) {
  const slot = S.fundsTab;
  const cfg = slotConfig(slot);
  const ranked = rankedFor(slot);
  const chosen = chosenFund(slot);
  const lastRefresh = S.meta.lastRefresh ? new Date(S.meta.lastRefresh).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  const ttInfo = S.meta.tickertapeUploadedAt ? `Tickertape upload: ${new Date(S.meta.tickertapeUploadedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })} (${S.meta.tickertapeMatched || 0} funds matched)` : 'No Tickertape upload yet';
  const isAdmin = S.me.role === 'admin';

  main.innerHTML = `
    <div class="page-head"><div><h2>Fund dashboard</h2><p>NAV data refreshed ${esc(lastRefresh)} · ${esc(ttInfo)}</p></div><div class="grow"></div>
      ${isAdmin ? '<a class="btn" href="#/data">Load Tickertape data</a>' : ''}</div>
    <div class="seg" id="slottabs" style="margin-bottom:16px">${FUND_SLOTS.map((k) => `<button data-k="${k}" class="${k === slot ? 'on' : ''}">${SLOTS[k].label}</button>`).join('')}</div>
    ${!S.funds.length ? `<div class="card"><h3>No fund data yet</h3><p class="sub">Run the "Refresh fund data" GitHub Action once (see the README). Data then refreshes twice a day on its own.</p></div>` : ''}
    <div class="funds-layout">
      <div class="card criteria" id="critpanel"></div>
      <div>
        <div class="pick-box">${chosen.fund
          ? `<div>Your ${SLOTS[slot].label.toLowerCase()} fund: <b>${esc(chosen.fund.name)}</b> ${chosen.pinned ? '<span class="badge">pinned</span>' : '<span class="badge good">top ranked</span>'}</div>${chosen.pinned ? '<button class="btn small" id="unpin">Use top-ranked instead</button>' : ''}`
          : '<div>No eligible funds with the current filters.</div>'}</div>
        <div class="toolbar"><input class="input search" id="fsearch" placeholder="Search fund or AMC…" value="${esc(fundSearch)}">
          <span class="note">${ranked.length} funds ranked${S.settings.excludedAmcs?.length ? ` · ${S.funds.filter((f) => f.slot === slot && isExcluded(f)).length} hidden by your exclusions` : ''}</span></div>
        <div class="tablewrap" style="max-height:70vh"><table class="t" id="ftable"></table></div>
        <p class="note">Returns, risk and ratios are computed from each fund's daily NAV history (Direct-Growth plans). Expense ratio, AUM and exit load come from researched values, your Tickertape upload, or edits made here (click a fund). Past performance does not guarantee future returns.</p>
      </div>
    </div>`;

  main.querySelectorAll('#slottabs button').forEach((b) => (b.onclick = () => { S.fundsTab = b.dataset.k; fundSort = { key: 'rank', dir: 1 }; renderFunds(main); }));
  document.getElementById('unpin')?.addEventListener('click', async () => { const picks = { ...S.settings.picks }; delete picks[slot]; await saveSettings({ picks }, 'Now using the top-ranked fund'); renderFunds(main); });
  document.getElementById('fsearch').oninput = (e) => { fundSearch = e.target.value; drawTable(); };
  drawCriteria();
  drawTable();

  function drawCriteria() {
    const panel = document.getElementById('critpanel');
    const active = new Map(cfg.criteria);
    const groups = {};
    for (const [k, m] of Object.entries(METRICS)) (groups[m.group] ||= []).push(k);
    const subs = SUB_OPTIONS[slot];
    panel.innerHTML = `<h3>Ranking criteria</h3><p class="sub">Tick the metrics to score on and set their weight. Each fund's score is the weighted average of its percentile on each metric.</p>
      <div class="row"><div><label class="f">Minimum age (years)</label><input class="input num" id="minage" type="number" min="0" step="1" value="${cfg.minAge}"></div></div>
      ${subs ? `<div class="crit-group">Include</div>${subs.map((s) => `<label class="toggle" style="margin-right:14px"><input type="checkbox" class="subchk" value="${s}" ${cfg.sub.includes(s) ? 'checked' : ''}>${s}</label>`).join('')}` : ''}
      <div style="margin-top:10px"><label class="toggle"><input type="checkbox" id="hideclosed" ${cfg.hideClosed ? 'checked' : ''}>Hide funds marked closed to new SIPs</label></div>
      ${Object.entries(groups).map(([g, keys]) => `<div class="crit-group">${g}</div>${keys.map((k) => `
        <div class="crit"><input type="checkbox" data-k="${k}" ${active.has(k) ? 'checked' : ''} id="c_${k}">
        <label for="c_${k}">${METRICS[k].label}<span class="dir">${METRICS[k].dir === 'asc' ? '↓ better' : '↑ better'}</span></label>
        <input class="w" type="number" min="0" step="0.5" data-w="${k}" value="${active.get(k) ?? 1}" aria-label="Weight for ${METRICS[k].label}"></div>`).join('')}`).join('')}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="savecrit">Save criteria</button><button class="btn" id="resetcrit">Reset to Vithai default</button></div>`;
    const collect = () => {
      const criteria = [];
      panel.querySelectorAll('input[type=checkbox][data-k]').forEach((c) => { if (c.checked) criteria.push([c.dataset.k, Number(panel.querySelector(`[data-w="${c.dataset.k}"]`).value) || 0]); });
      const sub = subs ? [...panel.querySelectorAll('.subchk:checked')].map((c) => c.value) : [];
      return { minAge: Number(document.getElementById('minage').value) || 0, sub, criteria, hideClosed: document.getElementById('hideclosed').checked };
    };
    panel.querySelectorAll('input').forEach((i) => (i.onchange = () => { Object.assign(cfg, collect()); drawTable(true); }));
    document.getElementById('savecrit').onclick = async () => { await saveSettings({ criteria: { ...S.settings.criteria, [slot]: collect() } }, 'Criteria saved'); renderFunds(main); };
    document.getElementById('resetcrit').onclick = async () => { const c = { ...S.settings.criteria }; delete c[slot]; await saveSettings({ criteria: c }, 'Back to the Vithai default'); renderFunds(main); };
  }

  function drawTable(fromCriteria) {
    const rows = fromCriteria ? rankFunds(eligibleFunds(slot, cfg), cfg.criteria) : ranked;
    const q = fundSearch.toLowerCase();
    let list = rows.filter((f) => !q || f.name.toLowerCase().includes(q) || f.amc.toLowerCase().includes(q));
    if (fundSort.key !== 'rank') list = [...list].sort((a, b) => ((a[fundSort.key] ?? -Infinity) > (b[fundSort.key] ?? -Infinity) ? 1 : -1) * fundSort.dir);
    else if (fundSort.dir < 0) list = [...list].reverse();
    const cols = [
      ['rank', '#', 'r'], ['name', 'Fund', ''], ['score', 'Score', 'r'],
      ...(slot === 'gold' ? [['trackingError', 'Track. err %', 'r']] : []),
      ['ret1y', '1Y %', 'r'], ['cagr3', '3Y %', 'r'], ['cagr5', '5Y %', 'r'], ['cagr10', '10Y %', 'r'], ['rolling3Avg', '3Y roll %', 'r'],
      ['sharpe', 'Sharpe', 'r'], ['sortino', 'Sortino', 'r'], ['maxDrawdown', 'Max DD %', 'r'], ['volatility', 'Vol %', 'r'],
      ['expenseRatio', 'Exp %', 'r'], ['aum', 'AUM ₹Cr', 'r'], ['ageYears', 'Age', 'r'], ['nav', 'NAV', 'r'],
    ];
    const cell = (f, k) => {
      if (k === 'rank') return `<span class="rank">${f.rank}</span>`;
      if (k === 'name') return `${esc(f.name)}${f.code === chosen.fund?.code ? ' <span class="badge good">your pick</span>' : ''}${/closed|paused|suspend/i.test(f.facts?.status || '') ? ' <span class="badge bad">closed</span>' : ''}<span class="a">${esc(f.amc)}</span>`;
      if (k === 'score') return f.score === null ? '–' : `${num(f.score, 1)}<span class="score-bar"><i style="width:${f.score}%"></i></span>${f.coverage < 0.75 ? ` <span class="badge" title="Has ${Math.round(f.coverage * 100)}% of the criteria data">${Math.round(f.coverage * 100)}%</span>` : ''}`;
      if (k === 'aum') return f[k] === null ? '–' : num(f[k], 0);
      if (k === 'ageYears') return num(f[k], 1);
      if (k === 'nav') return num(f[k], 2);
      return num(f[k], k === 'sharpe' || k === 'sortino' ? 2 : 2);
    };
    const t = document.getElementById('ftable');
    t.innerHTML = `<thead><tr>${cols.map(([k, l, c]) => `<th class="sortable ${c}" data-k="${k}">${l}${fundSort.key === k ? (fundSort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead>
      <tbody>${list.map((f) => `<tr class="${f.rank === 1 ? 'top' : ''} ${f.code === chosen.fund?.code ? 'chosen' : ''}" data-code="${f.code}">
        ${cols.map(([k, , c]) => `<td class="${c} ${k === 'name' ? 'nm' : ''}">${cell(f, k)}</td>`).join('')}
        <td><button class="btn small" data-pick="${f.code}">${f.code === S.settings.picks?.[slot] ? 'Pinned' : 'Use'}</button></td></tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="muted">No funds match.</td></tr>`}</tbody>`;
    t.querySelectorAll('th.sortable').forEach((th) => (th.onclick = () => {
      const k = th.dataset.k;
      fundSort = fundSort.key === k ? { key: k, dir: -fundSort.dir } : { key: k, dir: k === 'rank' || k === 'name' || METRICS[k]?.dir === 'asc' ? 1 : -1 };
      drawTable(fromCriteria);
    }));
    t.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      await saveSettings({ picks: { ...S.settings.picks, [slot]: b.dataset.pick } }, 'Pinned as your fund for this slot');
      renderFunds(main);
    }));
    t.querySelectorAll('tbody tr[data-code]').forEach((tr) => (tr.onclick = () => fundDetail(tr.dataset.code, main)));
  }
}

function fundDetail(code, main) {
  const f = S.funds.find((x) => x.code === code);
  if (!f) return;
  const SRC = { seed: 'researched', tickertape: 'Tickertape', manual: 'edited' };
  const src = (k) => f.facts?.sources?.[k] ? ` <span class="badge">${SRC[f.facts.sources[k]] || f.facts.sources[k]}</span>` : '';
  const m = (label, v) => `<div>${label}</div><div>${v}</div>`;
  const extra = Object.entries(f.facts || {}).filter(([k]) => !['sources', ...FACT_KEYS, 'exitLoadText', 'status', 'notes', 'asOf', 'src'].includes(k));
  openModal(`
    <h3>${esc(f.name)}</h3><p class="note">${esc(f.amc)} · ${esc(f.category)} · AMFI code ${esc(f.code)}</p>
    <div class="grid2">
      <div class="kv">
        ${m('NAV', `${num(f.nav, 4)} <span class="muted">(${esc(f.navDate)})</span>`)}
        ${m('Since inception', `${esc(f.inception || '')} (${num(f.ageYears, 1)} y)`)}
        ${m('Return 3M / 6M / 1Y', `${pct(f.ret3m)} / ${pct(f.ret6m)} / ${pct(f.ret1y)}`)}
        ${m('CAGR 3Y / 5Y / 10Y', `${pct(f.cagr3)} / ${pct(f.cagr5)} / ${pct(f.cagr10)}`)}
        ${m('3Y rolling avg / worst', `${pct(f.rolling3Avg)} / ${pct(f.rolling3Min)}`)}
        ${m('Sharpe / Sortino (3Y)', `${num(f.sharpe, 2)} / ${num(f.sortino, 2)}`)}
        ${m('Volatility (3Y)', pct(f.volatility))}
        ${m('Max drawdown 5Y / all', `${pct(f.maxDrawdown)} / ${pct(f.maxDrawdownAll)}`)}
        ${m('Below all-time high', pct(f.fromAth))}
        ${f.trackingError !== undefined ? m('Tracking error (1Y)', pct(f.trackingError, 3)) : ''}
      </div>
      <div class="kv">
        ${m('Expense ratio' + src('expenseRatio'), pct(f.expenseRatio))}
        ${m('AUM' + src('aum'), f.aum ? `₹${num(f.aum, 0)} Cr` : '–')}
        ${m('Exit load' + src('exitLoad'), f.facts?.exitLoadText ? esc(f.facts.exitLoadText) : pct(f.exitLoad))}
        ${m('Subscription', esc(f.facts?.status || 'not recorded'))}
        ${m('Facts as of', esc(f.facts?.asOf || '–'))}
        ${extra.map(([k, v]) => m(esc(k), esc(typeof v === 'number' ? num(v, 2) : v))).join('')}
      </div>
    </div>
    ${S.me.role === 'admin' ? `<h3 style="margin-top:20px">Edit fund facts</h3><p class="note">Your values override the researched and Tickertape values.</p>
    <form id="factform" class="grid2" style="gap:10px">
      <div><label class="f">Expense ratio %</label><input class="input num" name="expenseRatio" type="number" step="0.01" value="${f.facts?.sources?.expenseRatio === 'manual' ? f.expenseRatio : ''}"></div>
      <div><label class="f">AUM (₹ Cr)</label><input class="input num" name="aum" type="number" step="1" value="${f.facts?.sources?.aum === 'manual' ? f.aum : ''}"></div>
      <div><label class="f">Exit load %</label><input class="input num" name="exitLoad" type="number" step="0.01" value="${f.facts?.sources?.exitLoad === 'manual' ? f.exitLoad : ''}"></div>
      <div><label class="f">Exit load details</label><input class="input" name="exitLoadText" value="${f.facts?.sources?.exitLoadText === 'manual' ? esc(f.facts.exitLoadText) : ''}"></div>
      <div><label class="f">Subscription status</label><select class="input" name="status"><option value="">Not recorded</option>${['open', 'capped', 'closed'].map((o) => `<option ${f.facts?.status === o && f.facts.sources.status === 'manual' ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
      <div><label class="f">Notes</label><input class="input" name="notes" value="${f.facts?.sources?.notes === 'manual' ? esc(f.facts.notes) : ''}"></div>
    </form>` : ''}
    <div class="row" style="margin-top:18px;justify-content:flex-end">${S.me.role === 'admin' ? '<button class="btn primary" id="savefacts">Save facts</button>' : ''}<button class="btn" data-close>Close</button></div>`,
  (root, close) => {
    root.querySelector('#savefacts')?.addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData(root.querySelector('#factform')).entries());
      try {
        await api('PUT', `/api/facts/${encodeURIComponent(code)}`, data);
        const f2 = await api('GET', '/api/funds');
        S.funds = f2.funds.map(flattenFacts);
        close(); toast('Fund facts saved'); renderFunds(main);
      } catch (e) { toast(e.message); }
    });
  });
}

// ---------------------------------------------------------------- MONTHLY PLAN
let planMonth = thisMonth();
async function renderPlan(main) {
  main.innerHTML = '<div class="boot" style="height:200px">Loading plan…</div>';
  const { transactions } = await api('GET', `/api/transactions?month=${planMonth}`);
  const s = S.settings;
  const bought = (slot, id) => transactions.filter((t) => t.slot === slot && (!id || t.assetId === id));
  const sum = (arr, k) => arr.reduce((a, t) => a + t[k], 0);
  const lines = FUND_SLOTS.filter((k) => (s.alloc[k] || 0) > 0).map((k) => {
    const amt = s.monthlyTotal * s.alloc[k] / 100;
    const { fund } = chosenFund(k);
    const done = bought(k);
    return { slot: k, amt, fund, done };
  });
  const niftyAmt = s.monthlyTotal * (s.alloc.nifty50 || 0) / 100;
  const wSum = S.nifty.reduce((a, x) => a + x.weight, 0) || 1;
  const totalDone = sum(transactions, 'amount');
  const usAmt = s.usSlot ? s.monthlyTotal * (s.alloc.usstocks || 0) / 100 : 0;
  let usLines = [];
  if (usAmt > 0) {
    let usDs = null;
    try { usDs = await loadDataset('us'); } catch { /* no US data yet */ }
    const priceOf = usPriceLookup(usDs);
    const basket = s.usBasket || [];
    const wTot = basket.reduce((a, x) => a + (x.weight || 0), 0) || 1;
    usLines = basket.map((x) => {
      const inrAmt = usAmt * (x.weight || 0) / wTot;
      const usd = priceOf(x.key);
      return { ...x, inrAmt, usd, qty: usd && s.usdInr ? inrAmt / s.usdInr / usd : null, done: bought('usstocks', x.key) };
    });
  }

  main.innerHTML = `
    <div class="page-head"><div><h2>Monthly plan</h2><p>What to buy this month, and a record of what you actually bought.</p></div><div class="grow"></div>
      <div><label class="f" for="pm">Month</label><input class="input" type="month" id="pm" value="${planMonth}"></div></div>
    <div class="stats">
      <div class="stat"><div class="k">Planned for ${esc(monthLabel(planMonth))}</div><div class="v">${inr(s.monthlyTotal)}</div></div>
      <div class="stat"><div class="k">Recorded so far</div><div class="v">${inr(totalDone)}</div><div class="d">${s.monthlyTotal ? Math.round(totalDone / s.monthlyTotal * 100) : 0}% of plan</div></div>
      <div class="stat"><div class="k">Still to invest</div><div class="v">${inr(Math.max(0, s.monthlyTotal - totalDone))}</div></div>
    </div>
    <div class="card"><h3>Funds</h3><p class="sub">Units are estimates at the latest NAV; your actual units depend on the NAV on the day you buy.</p>
      <div class="tablewrap"><table class="t"><thead><tr><th>Slot</th><th>Fund</th><th class="r">Plan</th><th class="r">Latest NAV</th><th class="r">Est. units</th><th class="r">Recorded</th><th class="r">Left</th><th></th></tr></thead>
      <tbody>${lines.map((l) => `<tr><td>${SLOTS[l.slot].label} <span class="muted">${s.alloc[l.slot]}%</span></td>
        <td class="nm">${l.fund ? esc(l.fund.name) + `<span class="a">${esc(l.fund.amc)}${l.slot === 'gold' ? ' · buy on Kite as an ETF' : ' · Coin SIP'}</span>` : '<span class="warn">No fund chosen</span>'}</td>
        <td class="r">${inr(l.amt)}</td><td class="r">${l.fund ? num(l.fund.nav, 4) : '–'}</td><td class="r">${l.fund ? num(l.amt / l.fund.nav, 3) : '–'}</td>
        <td class="r">${inr(sum(l.done, 'amount'))}</td><td class="r">${inr(Math.max(0, l.amt - sum(l.done, 'amount')))}</td>
        <td>${l.fund ? `<button class="btn small" data-rec="${l.slot}">Record purchase</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No fund slots allocated in Setup.</td></tr>'}</tbody></table></div></div>
    ${niftyAmt > 0 ? `<div class="card"><div class="row" style="align-items:center"><div><h3>Nifty 50 stocks · ${inr(niftyAmt)}</h3><p class="sub" style="margin:0">Split by index weight, in fractional quantities. Update prices before you buy.</p></div>
        <div style="flex:0 0 auto" class="row">${S.me.role === 'admin' ? '<button class="btn" id="niftyupd">Update prices / weights</button>' : ''}<button class="btn" id="niftyall">Record whole basket as planned</button></div></div>
      <div class="tablewrap" style="margin-top:12px;max-height:60vh"><table class="t"><thead><tr><th>Symbol</th><th class="r">Weight</th><th class="r">Amount</th><th class="r">Price</th><th class="r">Qty</th><th class="r">Recorded</th><th></th></tr></thead>
      <tbody>${S.nifty.map((x) => { const a = niftyAmt * x.weight / wSum; const d = bought('nifty50', x.symbol); return `<tr><td><b>${esc(x.symbol)}</b></td><td class="r">${pct(x.weight)}</td><td class="r">${inr(a, 2)}</td><td class="r">${num(x.ltp, 2)}</td><td class="r">${x.ltp ? num(a / x.ltp, 4) : '–'}</td><td class="r">${d.length ? num(sum(d, 'units'), 4) : '–'}</td><td><button class="btn small" data-recn="${esc(x.symbol)}">Record</button></td></tr>`; }).join('')}</tbody></table></div>
      <p class="note">Prices last updated ${esc((S.nifty[0]?.updated_at || '').slice(0, 10) || '–')}.</p></div>` : ''}
    ${usAmt > 0 ? `<div class="card"><h3>US stocks · ${inr(usAmt)}${s.usdInr ? ` <span class="muted">(about $${num(usAmt / s.usdInr, 2)} at ₹${num(s.usdInr, 2)})</span>` : ''}</h3>
      <p class="sub">Split across your US basket by weight. ${s.usdInr ? '' : '<span class="warn">Enter the rupee–dollar rate in Setup to see quantities.</span>'} Edit the basket on the <a href="#/stocks-us">US stocks</a> page.</p>
      <div class="tablewrap"><table class="t"><thead><tr><th>Stock</th><th class="r">Weight</th><th class="r">Amount (₹)</th><th class="r">Price ($)</th><th class="r">Qty</th><th class="r">Recorded</th><th></th></tr></thead>
      <tbody>${usLines.map((x, i) => `<tr><td class="nm">${esc(x.name)}</td><td class="r"><input class="w input num" data-usw="${i}" type="number" min="0" step="1" value="${x.weight}" style="width:70px;padding:3px 6px"></td><td class="r">${inr(x.inrAmt, 2)}</td><td class="r">${num(x.usd, 2)}</td><td class="r">${x.qty ? num(x.qty, 4) : '–'}</td><td class="r">${x.done.length ? num(sum(x.done, 'units'), 4) : '–'}</td><td><button class="btn small" data-recu="${i}">Record</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Your US basket is empty. Add stocks on the US stocks page.</td></tr>'}</tbody></table></div></div>` : ''}
    <div class="card"><h3>Recorded in ${esc(monthLabel(planMonth))}</h3>
      <div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Slot</th><th>Asset</th><th class="r">Units</th><th class="r">Price</th><th class="r">Amount</th><th></th></tr></thead>
      <tbody>${transactions.map((t) => `<tr><td>${esc(t.tradeDate)}</td><td>${SLOTS[t.slot]?.short || t.slot}</td><td class="nm">${esc(t.assetName)}</td><td class="r">${num(t.units, 4)}</td><td class="r">${num(t.price, 4)}</td><td class="r">${inr(t.amount, 2)}</td><td><button class="btn small danger" data-del="${t.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing recorded yet this month.</td></tr>'}</tbody></table></div></div>`;

  document.getElementById('pm').onchange = (e) => { planMonth = e.target.value || thisMonth(); renderPlan(main); };
  main.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => {
    const l = lines.find((x) => x.slot === b.dataset.rec);
    recordModal({ slot: l.slot, assetId: l.fund.code, assetName: l.fund.name, price: l.fund.nav, units: +(l.amt / l.fund.nav).toFixed(3) }, () => renderPlan(main));
  }));
  main.querySelectorAll('[data-recn]').forEach((b) => (b.onclick = () => {
    const x = S.nifty.find((n) => n.symbol === b.dataset.recn);
    const a = niftyAmt * x.weight / wSum;
    recordModal({ slot: 'nifty50', assetId: x.symbol, assetName: x.symbol, price: x.ltp, units: x.ltp ? +(a / x.ltp).toFixed(4) : '' }, () => renderPlan(main));
  }));
  main.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this purchase record?')) return;
    try { await api('DELETE', `/api/transactions/${b.dataset.del}`); toast('Deleted'); renderPlan(main); } catch (e) { toast(e.message); }
  }));
  document.getElementById('niftyall')?.addEventListener('click', async () => {
    if (!confirm(`Record all ${S.nifty.length} Nifty 50 purchases at the planned quantities and current prices?`)) return;
    try {
      for (const x of S.nifty) {
        if (!x.ltp) continue;
        const a = niftyAmt * x.weight / wSum;
        await api('POST', '/api/transactions', { slot: 'nifty50', assetId: x.symbol, assetName: x.symbol, tradeDate: today(), month: planMonth, units: +(a / x.ltp).toFixed(4), price: x.ltp });
      }
      toast('Nifty 50 basket recorded'); renderPlan(main);
    } catch (e) { toast(e.message); }
  });
  document.getElementById('niftyupd')?.addEventListener('click', () => niftyModal(() => renderPlan(main)));
  main.querySelectorAll('[data-usw]').forEach((inp) => (inp.onchange = async () => {
    const basket = (S.settings.usBasket || []).map((x, i) => (i === +inp.dataset.usw ? { ...x, weight: Number(inp.value) || 0 } : x));
    await saveSettings({ usBasket: basket }, 'Basket weights saved'); renderPlan(main);
  }));
  main.querySelectorAll('[data-recu]').forEach((b) => (b.onclick = () => {
    const x = usLines[+b.dataset.recu];
    recordModal({ slot: 'usstocks', assetId: x.key, assetName: x.name, price: x.usd && s.usdInr ? +(x.usd * s.usdInr).toFixed(2) : '', units: x.qty ? +x.qty.toFixed(4) : '', priceLabel: 'Price paid per share (₹, i.e. $ price × rate)' }, () => renderPlan(main));
  }));
}

function recordModal(pre, done) {
  openModal(`<h3>Record purchase</h3><p class="note">${esc(pre.assetName)}</p>
    <form id="rf" style="display:grid;gap:12px">
      <div class="row"><div><label class="f">Date bought</label><input class="input" name="tradeDate" type="date" value="${today()}" required></div>
      <div><label class="f">Counts towards month</label><input class="input" name="month" type="month" value="${planMonth}"></div></div>
      <div class="row"><div><label class="f">Units / quantity</label><input class="input num" name="units" type="number" step="any" min="0" value="${pre.units}" required></div>
      <div><label class="f">${pre.priceLabel || (pre.slot === 'nifty50' ? 'Price' : 'NAV') + ' paid'}</label><input class="input num" name="price" type="number" step="any" min="0" value="${pre.price ?? ''}" required></div></div>
      <div class="row"><div><label class="f">Total amount (₹)</label><input class="input num" name="amount" type="number" step="any" min="0"></div>
      <div><label class="f">Note (optional)</label><input class="input" name="note"></div></div>
      <p class="note">Leave the amount blank to use units × price. Check the actual units on your Coin / Kite contract note.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary">Save</button></div>
    </form>`, (root, close) => {
    const f = root.querySelector('#rf');
    const upd = () => { const u = +f.units.value, p = +f.price.value; f.amount.placeholder = u && p ? (u * p).toFixed(2) : ''; };
    f.units.oninput = f.price.oninput = upd; upd();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      try { await api('POST', '/api/transactions', { ...d, slot: pre.slot, assetId: pre.assetId, assetName: pre.assetName }); close(); toast('Purchase recorded'); done(); } catch (err) { toast(err.message); }
    };
  });
}

function niftyModal(done) {
  openModal(`<h3>Update Nifty 50 prices and weights</h3>
    <p class="note">Paste the table from the NSE Nifty 50 page (Symbol and LTP columns), or a table with Symbol and Weight columns. You can also upload a CSV or Excel file with the same columns. Only symbols already in the list get price updates; tick the box to replace the whole constituent list.</p>
    <textarea class="input" id="npaste" rows="8" placeholder="Symbol&#9;LTP&#9;…&#10;HDFCBANK&#9;700&#9;…"></textarea>
    <div class="row" style="margin-top:10px"><label class="btn"><input type="file" id="nfile" accept=".csv,.xlsx,.xls" hidden>Choose file…</label>
      <label class="toggle"><input type="checkbox" id="nreplace">Replace constituents (needs a Weight column)</label></div>
    <div id="nprev" class="note" style="margin-top:8px"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="nsave" disabled>Save</button></div>`,
  (root, close) => {
    let rows = [];
    const parseTable = (table) => {
      const header = table[0].map((h) => String(h ?? '').trim().toLowerCase());
      const ci = (re) => header.findIndex((h) => re.test(h));
      const iS = ci(/^symbol/), iL = ci(/^ltp|last|price|close/), iW = ci(/weight/);
      if (iS < 0) throw new Error('No "Symbol" column found.');
      const n = (v) => { const x = parseFloat(String(v ?? '').replace(/[,%₹\s]/g, '')); return isFinite(x) ? x : null; };
      return table.slice(1).filter((r) => r[iS]).map((r) => ({ symbol: String(r[iS]).trim().toUpperCase(), ltp: iL >= 0 ? n(r[iL]) : null, weight: iW >= 0 ? n(r[iW]) : null }))
        .filter((r) => r.symbol && r.symbol !== 'NIFTY 50');
    };
    const show = () => {
      root.querySelector('#nprev').textContent = rows.length ? `${rows.length} rows read · ${rows.filter((r) => r.ltp !== null).length} prices · ${rows.filter((r) => r.weight !== null).length} weights` : '';
      root.querySelector('#nsave').disabled = !rows.length;
    };
    root.querySelector('#npaste').oninput = (e) => {
      try { const lines = e.target.value.trim().split(/\r?\n/).map((l) => l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, ''))); rows = lines.length > 1 ? parseTable(lines) : []; }
      catch (err) { rows = []; root.querySelector('#nprev').textContent = err.message; return; }
      show();
    };
    root.querySelector('#nfile').onchange = async (e) => {
      try { const XLSX = await waitForXLSX(); const wb = XLSX.read(new Uint8Array(await e.target.files[0].arrayBuffer()), { type: 'array' }); rows = parseTable(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })); show(); }
      catch (err) { root.querySelector('#nprev').textContent = err.message; }
    };
    root.querySelector('#nsave').onclick = async () => {
      try { const r = await api('PUT', '/api/nifty', { rows, replaceWeights: root.querySelector('#nreplace').checked }); S.nifty = r.stocks; close(); toast('Nifty 50 data updated'); done(); }
      catch (err) { toast(err.message); }
    };
  });
}

// ---------------------------------------------------------------- PORTFOLIO
let portfolioMember = null;
async function renderPortfolio(main) {
  main.innerHTML = '<div class="boot" style="height:200px">Loading portfolio…</div>';
  const hh = await api('GET', '/api/household');
  const viewable = hh.members.filter((m) => m.status === 'active' && (m.id === S.me.id || m.shareDashboard));
  if (!portfolioMember || !viewable.some((m) => m.id === portfolioMember)) portfolioMember = S.me.id;
  let data;
  try { data = await api('GET', `/api/members/${portfolioMember}/portfolio`); } catch (e) { main.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  const tx = data.transactions, set = data.settings;
  let usPrice = () => null;
  if (tx.some((t) => t.slot === 'usstocks')) { try { usPrice = usPriceLookup(await loadDataset('us')); } catch { /* valued at cost */ } }
  const rate = set.usdInr || S.settings.usdInr;
  const priceOf = (h) => {
    const id = h.assetId ?? h.id;
    if (h.slot === 'nifty50') return S.nifty.find((n) => n.symbol === id)?.ltp ?? null;
    if (h.slot === 'usstocks') { const p = usPrice(id); return p && rate ? p * rate : null; }
    return S.funds.find((f) => f.code === id)?.nav ?? null;
  };
  const hold = new Map();
  for (const t of tx) {
    const h = hold.get(t.assetId) || { slot: t.slot, id: t.assetId, name: t.assetName, units: 0, invested: 0, first: t.tradeDate };
    h.units += t.units; h.invested += t.amount; hold.set(t.assetId, h);
  }
  const holdings = [...hold.values()].map((h) => { const p = priceOf(h); return { ...h, price: p, value: p !== null ? h.units * p : h.invested, priced: p !== null }; });
  const invested = holdings.reduce((a, h) => a + h.invested, 0);
  const value = holdings.reduce((a, h) => a + h.value, 0);
  const gain = value - invested;
  const flows = tx.map((t) => ({ date: t.tradeDate, amount: -t.amount })).sort((a, b) => a.date.localeCompare(b.date));
  if (flows.length) flows.push({ date: today(), amount: value });
  const irr = xirr(flows);
  const bySlot = Object.keys(SLOTS).filter((k) => k !== 'usstocks' || set.usSlot || holdings.some((h) => h.slot === k)).map((k) => {
    const v = holdings.filter((h) => h.slot === k).reduce((a, h) => a + h.value, 0);
    return { k, v, actual: value ? v / value * 100 : 0, target: set.alloc[k] || 0 };
  });
  const months = {};
  for (const t of tx) months[t.month] = (months[t.month] || 0) + t.amount;

  main.innerHTML = `
    <div class="page-head"><div><h2>Portfolio</h2><p>${portfolioMember === S.me.id ? 'Your' : esc(data.member.name) + "'s"} holdings, valued at the latest NAVs and prices.</p></div><div class="grow"></div>
      ${viewable.length > 1 ? `<div><label class="f">Showing</label><select class="input" id="pmem">${viewable.map((m) => `<option value="${m.id}" ${m.id === portfolioMember ? 'selected' : ''}>${m.id === S.me.id ? 'Me' : esc(m.name)}</option>`).join('')}</select></div>` : ''}</div>
    <div class="stats">
      <div class="stat"><div class="k">Invested</div><div class="v">${inr(invested)}</div><div class="d">${tx.length} purchases</div></div>
      <div class="stat"><div class="k">Current value</div><div class="v">${inr(value)}</div></div>
      <div class="stat"><div class="k">Gain</div><div class="v ${signCls(gain)}">${inr(gain)}</div><div class="d ${signCls(gain)}">${invested ? pct(gain / invested * 100) : '–'}</div></div>
      <div class="stat"><div class="k">XIRR</div><div class="v ${signCls(irr)}">${irr === null ? '–' : pct(irr, 1)}</div><div class="d">Annualised, money-weighted</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Allocation</h3><p class="sub">Bar = current share of value; black line = target from Setup.</p>
        ${bySlot.map((b) => `<div class="alloc-row"><div>${SLOTS[b.k].short}</div><div class="bars"><div class="actual" style="width:${Math.min(100, b.actual)}%"></div><div class="target" style="left:${b.target}%"></div></div><div class="r" style="font-family:var(--mono);text-align:right">${pct(b.actual, 1)} <span class="muted">/ ${b.target}%</span></div></div>`).join('')}
      </div>
      <div class="card"><h3>Invested by month</h3>
        <div class="tablewrap" style="max-height:300px"><table class="t"><thead><tr><th>Month</th><th class="r">Invested</th><th class="r">vs plan</th></tr></thead>
        <tbody>${Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([m, a]) => `<tr><td>${esc(monthLabel(m))}</td><td class="r">${inr(a)}</td><td class="r">${set.monthlyTotal ? pct(a / set.monthlyTotal * 100, 0) : '–'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No purchases yet.</td></tr>'}</tbody></table></div>
      </div>
    </div>
    <div class="card"><h3>Holdings</h3>
      <div class="tablewrap"><table class="t"><thead><tr><th>Slot</th><th>Holding</th><th class="r">Units</th><th class="r">Avg cost</th><th class="r">Invested</th><th class="r">Price now</th><th class="r">Value</th><th class="r">Gain</th><th class="r">Gain %</th></tr></thead>
      <tbody>${holdings.sort((a, b) => b.value - a.value).map((h) => `<tr><td>${SLOTS[h.slot]?.short || h.slot}</td><td class="nm">${esc(h.name)}</td><td class="r">${num(h.units, 4)}</td><td class="r">${num(h.invested / h.units, 2)}</td><td class="r">${inr(h.invested)}</td><td class="r">${h.priced ? num(h.price, 2) : '<span class="warn" title="No current price; valued at cost">–</span>'}</td><td class="r">${inr(h.value)}</td><td class="r ${signCls(h.value - h.invested)}">${inr(h.value - h.invested)}</td><td class="r ${signCls(h.value - h.invested)}">${pct((h.value - h.invested) / h.invested * 100)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Record purchases on the Monthly plan page to see them here.</td></tr>'}</tbody>
      ${holdings.length ? `<tfoot><tr><td colspan="4">Total</td><td class="r">${inr(invested)}</td><td></td><td class="r">${inr(value)}</td><td class="r ${signCls(gain)}">${inr(gain)}</td><td class="r ${signCls(gain)}">${invested ? pct(gain / invested * 100) : '–'}</td></tr></tfoot>` : ''}</table></div>
      <p class="note">Mutual funds and ETFs are valued at the latest NAV from AMFI; Nifty 50 stocks at the prices last updated; US stocks at the last Tickertape price × your rupee–dollar rate.</p></div>`;
  document.getElementById('pmem')?.addEventListener('change', (e) => { portfolioMember = e.target.value; renderPortfolio(main); });
}

// ---------------------------------------------------------------- DATA (Tickertape)
async function renderData(main) {
  const admin = S.me.role === 'admin';
  let ds = {};
  let dsError = '';
  try { ds = (await api('GET', '/api/datasets')).datasets; } catch (e) { dsError = e.message; }
  const when = (m) => (m?.uploadedAt ? new Date(m.uploadedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : null);
  const status = (k) => {
    const m = ds[k];
    return `<tr><td><b>${KINDS[k]}</b></td><td>${m ? esc(when(m)) : '<span class="warn">Not loaded</span>'}</td><td class="r">${m ? num(m.rows, 0) : '–'}</td><td class="r">${m ? num(m.cols, 0) : '–'}</td><td class="nm">${m ? esc(m.files || '') : ''}</td></tr>`;
  };
  main.innerHTML = `
    <div class="page-head"><div><h2>Data</h2><p>Load your Tickertape screener exports for mutual funds, Indian stocks and US stocks.</p></div></div>
    <div class="card"><h3>What's loaded</h3>${dsError ? `<p class="err">${esc(dsError)}</p>` : ''}
      <div class="tablewrap"><table class="t"><thead><tr><th>Dataset</th><th>Loaded</th><th class="r">Rows</th><th class="r">Columns</th><th>Files</th></tr></thead>
      <tbody>${['mf', 'in', 'us'].map(status).join('')}</tbody></table></div>
      <p class="note">Fund NAVs, returns and risk ratios refresh automatically twice a day. Tickertape data only changes when you load new exports.</p></div>
    <div class="card"><h3>1 · Export from Tickertape</h3>
      <p class="sub">Tickertape exports at most 45 columns at a time, so the <b>Vithai export</b> button splits every available column into parts and exports each one using Tickertape's own Export button, in your signed-in browser.</p>
      <ol style="padding-left:18px;margin:0 0 12px">
        <li>Show your bookmarks bar (<b>Ctrl+Shift+B</b>) and <b>drag this button onto it</b>: <a class="btn primary" id="bm" href="#" onclick="return false" title="Drag me to your bookmarks bar">⬇ Vithai export</a></li>
        <li>Sign in to Tickertape, then open a screener: <a href="https://www.tickertape.in/screener/mutual-fund" target="_blank" rel="noopener">Mutual funds</a> · <a href="https://www.tickertape.in/screener/equity" target="_blank" rel="noopener">Indian stocks</a> · <a href="https://www.tickertape.in/screener/us-stocks" target="_blank" rel="noopener">US stocks</a></li>
        <li>Click <b>Vithai export</b> in your bookmarks bar and leave the tab alone until the box in the bottom-right says it's finished (about 1–3 minutes).</li>
        <li>The first time, Chrome asks to allow <b>multiple downloads</b> from Tickertape. Choose <b>Allow</b>.</li>
      </ol>
      <p class="note">If you're signed out of Tickertape the export stops and tells you. If Tickertape changes its page, the button may need updating.</p></div>
    <div class="card"><h3>2 · Load the files into Vithai</h3>
      ${admin ? `<p class="sub">Select all the CSV files at once: every part, for any of the three screeners. Vithai works out which is which and joins the parts back together.</p>
      <label class="btn primary"><input type="file" id="ttfiles" accept=".csv,.xlsx,.xls" multiple hidden>Choose files…</label>
      <div id="ttprev" style="margin-top:14px"></div>` : '<p class="sub">Only a household admin can load data.</p>'}</div>`;

  // bookmarklet
  try {
    const code = await (await fetch('/tools/tickertape-export.js', { cache: 'no-store' })).text();
    document.getElementById('bm').href = 'javascript:' + encodeURIComponent(code);
  } catch { /* leave as # */ }

  let files = [];
  const drawPreview = () => {
    const box = document.getElementById('ttprev');
    if (!files.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="tablewrap"><table class="t"><thead><tr><th>File</th><th>Type</th><th class="r">Rows</th><th class="r">Columns</th></tr></thead>
      <tbody>${files.map((f, i) => `<tr><td class="nm">${esc(f.name)}</td><td><select class="input" data-i="${i}" style="width:auto;padding:4px 8px">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${f.guess === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td class="r">${num(f.rows.length, 0)}</td><td class="r">${f.header.length}</td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="ttload" style="flex:0 0 auto">Load into Vithai</button><span class="note" id="ttmsg"></span></div>`;
    box.querySelectorAll('select[data-i]').forEach((sel) => (sel.onchange = () => { files[+sel.dataset.i].guess = sel.value; }));
    document.getElementById('ttload').onclick = loadAll;
  };
  document.getElementById('ttfiles')?.addEventListener('change', async (e) => {
    const msg = document.getElementById('ttprev');
    msg.innerHTML = '<p class="note">Reading files…</p>';
    try { files = await Promise.all([...e.target.files].map(readExport)); drawPreview(); } catch (err) { msg.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  });

  async function loadAll() {
    const btn = document.getElementById('ttload'), msg = document.getElementById('ttmsg');
    btn.disabled = true;
    const done = [];
    try {
      for (const kind of ['mf', 'in', 'us']) {
        const group = files.filter((f) => f.guess === kind);
        if (!group.length) continue;
        msg.textContent = `Merging and uploading ${KINDS[kind]}…`;
        const merged = mergeParts(group);
        const dataset = toDataset(kind, merged, group.map((f) => f.name));
        await uploadDataset(dataset);
        clearDatasetCache(kind);
        let extra = '';
        if (kind === 'mf') {
          const r = await saveMfFacts(mfFactsRows(merged));
          extra = `, ${r.matched} matched to Vithai's funds`;
        }
        if (kind === 'in') {
          const prices = niftyPricesFrom(merged, S.nifty);
          if (prices.length) { const r = await api('PUT', '/api/nifty', { rows: prices }); S.nifty = r.stocks; }
          extra = `, Nifty 50 prices updated for ${prices.length} of ${S.nifty.length} stocks`;
        }
        done.push(`${KINDS[kind]}: ${num(merged.rows.length, 0)} rows × ${merged.columns.length} columns${extra}`);
      }
      const f = await api('GET', '/api/funds');
      S.funds = f.funds.map(flattenFacts); S.meta = f.meta || {};
      toast('Tickertape data loaded');
      renderData(main);
      setTimeout(() => openModal(`<h3>Data loaded</h3><ul>${done.map((d) => `<li>${esc(d)}</li>`).join('')}</ul><div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`), 50);
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  }
}

// ---------------------------------------------------------------- HOUSEHOLD
async function renderHousehold(main) {
  const { household, members } = await api('GET', '/api/household');
  const admin = S.me.role === 'admin';
  main.innerHTML = `
    <div class="page-head"><div><h2>Household</h2><p>${esc(household.name)}</p></div></div>
    <div class="grid2">
      <div class="card"><h3>Your dashboard sharing</h3><p class="sub">When on, other approved members of your household can see your portfolio. Your setup and purchases stay yours either way.</p>
        <label class="toggle"><input type="checkbox" id="share" ${S.me.shareDashboard ? 'checked' : ''}>Share my portfolio with my household</label></div>
      ${admin ? `<div class="card"><h3>Invite someone</h3><p class="sub">They choose "Join a household" when signing up and enter this code. You then approve them below.</p>
        <div class="row"><div><input class="input" readonly value="${esc(household.inviteCode)}" style="font-family:var(--mono);font-size:18px;letter-spacing:.15em"></div><button class="btn" id="copycode" style="flex:0 0 auto">Copy</button></div></div>` : ''}
    </div>
    <div class="card"><h3>Members</h3>
      <div class="tablewrap"><table class="t"><thead><tr><th>Name</th>${admin ? '<th>Email</th>' : ''}<th>Role</th><th>Status</th><th>Sharing</th>${admin ? '<th></th>' : ''}</tr></thead>
      <tbody>${members.map((m) => `<tr><td>${esc(m.name)}${m.id === S.me.id ? ' <span class="badge">you</span>' : ''}</td>${admin ? `<td>${esc(m.email || '')}</td>` : ''}
        <td>${m.role}</td><td>${m.status === 'pending' ? '<span class="badge gold">waiting for approval</span>' : 'active'}</td>
        <td>${m.shareDashboard ? '<span class="badge good">shared</span>' : '<span class="muted">private</span>'}</td>
        ${admin ? `<td>${m.id === S.me.id ? '' : m.status === 'pending'
          ? `<button class="btn small" data-act="approve" data-id="${m.id}">Approve</button> <button class="btn small danger" data-act="reject" data-id="${m.id}">Reject</button>`
          : `<button class="btn small" data-act="${m.role === 'admin' ? 'make-member' : 'make-admin'}" data-id="${m.id}">${m.role === 'admin' ? 'Make member' : 'Make admin'}</button> <button class="btn small" data-act="reset-password" data-id="${m.id}">Reset password</button> <button class="btn small danger" data-act="reject" data-id="${m.id}">Remove</button>`}</td>` : ''}</tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3>Your password</h3><button class="btn" id="chpw">Change password</button></div>`;
  document.getElementById('share').onchange = async (e) => {
    try { await api('PUT', '/api/me/sharing', { share: e.target.checked }); S.me.shareDashboard = e.target.checked; toast(e.target.checked ? 'Your portfolio is now visible to your household' : 'Your portfolio is now private'); renderHousehold(main); }
    catch (err) { toast(err.message); }
  };
  document.getElementById('copycode')?.addEventListener('click', () => { navigator.clipboard?.writeText(household.inviteCode); toast('Invite code copied'); });
  document.getElementById('chpw').onclick = () => promptPasswordChange(false);
  main.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    const act = b.dataset.act;
    if ((act === 'reject' || act === 'reset-password') && !confirm(act === 'reject' ? 'Remove this member from the household?' : 'Reset this member\'s password?')) return;
    try {
      const r = await api('POST', `/api/household/members/${b.dataset.id}/${act}`);
      if (r.tempPassword) openModal(`<h3>Temporary password</h3><p>Give this to the member. They'll be asked to change it when they sign in.</p><p style="font-family:var(--mono);font-size:22px;letter-spacing:.1em">${esc(r.tempPassword)}</p><div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`);
      else toast('Updated');
      renderHousehold(main);
    } catch (e) { toast(e.message); }
  }));
}

function promptPasswordChange(forced) {
  openModal(`<h3>${forced ? 'Choose a new password' : 'Change password'}</h3>${forced ? '<p class="note">Your password was reset by the household admin.</p>' : ''}
    <form id="pwf" style="display:grid;gap:12px">
      <div><label class="f">Current password</label><input class="input" type="password" name="current" autocomplete="current-password" required></div>
      <div><label class="f">New password (8+ characters)</label><input class="input" type="password" name="next" minlength="8" autocomplete="new-password" required></div>
      <div class="row" style="justify-content:flex-end">${forced ? '' : '<button class="btn" type="button" data-close>Cancel</button>'}<button class="btn primary">Save</button></div>
    </form>`, (root, close) => {
    root.querySelector('#pwf').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('POST', '/api/me/password', Object.fromEntries(new FormData(e.target).entries())); S.me.mustChangePassword = false; close(); toast('Password changed'); }
      catch (err) { toast(err.message); }
    };
  });
}

// ---------------------------------------------------------------- AUTH
function renderAuth() {
  let mode = 'login';
  const draw = () => {
    app.innerHTML = `<div class="auth">
      <div class="hero"><h1>VITHAI</h1><p>Plant a little every month. Vithai ranks India's mutual funds on the metrics you choose, turns your monthly amount into a buying plan, and tracks what it's worth today.</p>
        <ul><li>Fund rankings from daily NAV data</li><li>Monthly plan across funds, gold and Nifty 50</li><li>Portfolio value and XIRR, shared with your household if you choose</li></ul></div>
      <div class="panel"><form id="af">
        <div class="seg">${[['login', 'Sign in'], ['create', 'Start a household'], ['join', 'Join a household']].map(([k, l]) => `<button type="button" data-m="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${mode !== 'login' ? '<div><label class="f">Your name</label><input class="input" name="name" autocomplete="name" required></div>' : ''}
        <div><label class="f">Email</label><input class="input" name="email" type="email" autocomplete="email" required></div>
        <div><label class="f">Password${mode !== 'login' ? ' (8+ characters)' : ''}</label><input class="input" name="password" type="password" minlength="${mode === 'login' ? 1 : 8}" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></div>
        ${mode === 'create' ? '<div><label class="f">Household name</label><input class="input" name="householdName" placeholder="e.g. The Kumar family"></div>' : ''}
        ${mode === 'join' ? '<div><label class="f">Invite code</label><input class="input" name="inviteCode" required style="text-transform:uppercase;font-family:var(--mono);letter-spacing:.12em"></div>' : ''}
        <button class="btn primary">${mode === 'login' ? 'Sign in' : mode === 'create' ? 'Create household' : 'Request to join'}</button>
        <div id="aerr" class="err" role="alert"></div>
      </form></div></div>`;
    app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
    document.getElementById('af').onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      try { await api('POST', mode === 'login' ? '/api/auth/login' : '/api/auth/register', d); location.reload(); }
      catch (err) { document.getElementById('aerr').textContent = err.message; }
    };
  };
  draw();
}

function renderPending() {
  app.innerHTML = `<div class="auth"><div class="hero"><h1>VITHAI</h1></div><div class="panel"><div style="max-width:380px">
    <h2>Waiting for approval</h2><p>Your request to join <b>${esc(S.me.householdName)}</b> has been sent. The household admin needs to approve it before you can start.</p>
    <button class="btn" id="lo">Sign out</button></div></div></div>`;
  document.getElementById('lo').onclick = async () => { await api('POST', '/api/auth/logout'); location.reload(); };
}

boot().catch((e) => { app.innerHTML = `<div class="boot">Couldn't load Vithai: ${esc(e.message)}</div>`; });
