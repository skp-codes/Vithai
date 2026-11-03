// Vithai front-end: a small single-page app with hash routes.
import { api, esc, inr, num, pct, signCls, today, thisMonth, monthLabel, toast, openModal, xirr, waitForXLSX } from './util.js'; // eslint-disable-line no-unused-vars
import { METRICS, SLOTS, DEFAULT_CRITERIA, rankFunds } from './ranking.js';
import { renderStocks, usPriceLookup } from './stocks.js'; // eslint-disable-line no-unused-vars
import { renderPlan } from './plan.js';
import { nameKey, cleanName } from './names.js';
import { guessDir } from './stocks.js';
import { KINDS, readExport, mergeParts, toDataset, uploadDataset, loadDataset, clearDatasetCache, mfFactsRows, niftyPricesFrom, saveMfFacts, autoMap, keyFieldsFor, defaultLabel, getColumnMap, saveColumnMap } from './tickertape.js';

const S = { me: null, settings: null, funds: [], meta: {}, nifty: [], route: 'setup', fundsTab: 'largecap', loaded: false };
const app = document.getElementById('app');
const FUND_SLOTS = ['largecap', 'midsmall', 'debt', 'international', 'gold'];
const SUB_OPTIONS = { midsmall: ['Mid Cap', 'Small Cap'], debt: ['Corporate Bond', 'Banking and PSU'] };
const FACT_KEYS = ['expenseRatio', 'aum', 'exitLoad', 'alpha', 'peRatio', 'ytm'];

// Ready-made allocation mixes for the Setup page (percent of the monthly total)
const PRESETS = {
  steadier: { label: 'Steadier', note: 'Steadier: 65% equity, 25% debt, 10% gold. Smaller falls; suits a goal within about 5–7 years.',
    alloc: { largecap: 30, nifty50: 10, midsmall: 15, international: 10, debt: 25, gold: 10 } },
  balanced: { label: 'Balanced', note: 'Balanced: 70% equity with a large-cap core (large cap fund + Nifty 50 = 40%), 20% debt, 10% gold.',
    alloc: { largecap: 25, nifty50: 15, midsmall: 20, international: 10, debt: 20, gold: 10 } },
  growth: { label: 'Growth', note: 'Growth: 80% equity, more mid/small cap and international, 10% debt, 10% gold. Bigger swings; suits 10+ years.',
    alloc: { largecap: 25, nifty50: 15, midsmall: 25, international: 15, debt: 10, gold: 10 } },
};
function presetAlloc(key, usSlot) {
  const a = { ...PRESETS[key].alloc, usstocks: 0 };
  if (usSlot) { const half = Math.round(a.international / 2); a.usstocks = a.international - half; a.international = half; }
  return a;
}

const ICONS = {
  setup: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  funds: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  plan: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  portfolio: '<path d="M21 12a9 9 0 11-9-9v9h9z"/><path d="M21 12A9 9 0 0012 3"/>',
  'stocks-in': '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  'stocks-us': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  household: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  site: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/>',
};
const routes = () => (S.me?.siteAdmin ? [...ROUTES, ['site', 'Site admin']] : ROUTES);
const ROUTES = [['setup', 'Setup'], ['funds', 'Fund dashboard'], ['stocks-in', 'Indian stocks'], ['stocks-us', 'US stocks'], ['plan', 'Monthly plan'], ['portfolio', 'Portfolio'], ['data', 'Data'], ['household', 'Household']];

// ---------------------------------------------------------------- boot & routing
async function boot() {
  try {
    const { user } = await api('GET', '/api/me');
    S.me = user;
  } catch { S.me = null; }
  if (!S.me) return renderAuth();
  if (S.me.householdStatus !== 'active' || S.me.status !== 'active') return renderPending();
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
  await attachTickertape();
  S.loaded = true;
}

// Every numeric column of the household's Tickertape mutual fund export becomes a metric you can rank on.
// Keys look like "tt:<column name>"; rows are matched to funds by name, as on the server.
let TT_METRICS = {};
async function attachTickertape(force = false) {
  TT_METRICS = {};
  let ds;
  try { ds = await loadDataset('mf', force); } catch { return; } // nothing loaded yet
  const nameCol = ds.keys?.name;
  if (!nameCol) return;
  const skip = new Set(Object.values(ds.keys || {}).filter((l) => l === nameCol));
  const numCols = ds.columns.filter((c) => c.type === 'num' && !skip.has(c.label)).map((c) => c.label);
  for (const c of numCols) TT_METRICS[`tt:${c}`] = { label: c, dir: guessDir(c), group: 'Tickertape', tt: true };
  const byName = new Map();
  for (const o of ds.objects) {
    const n = o[nameCol];
    if (!n || /\(/.test(String(n))) continue; // IDCW / payout variants
    byName.set(nameKey(n), o);
  }
  let matched = 0;
  for (const f of S.funds) {
    const o = byName.get(nameKey(cleanName(f.name)));
    f.tt = o || null;
    if (o) matched++;
    for (const c of numCols) {
      let v = o ? o[c] : null;
      v = typeof v === 'number' && isFinite(v) ? v : null;
      // Tickertape writes 0 for "no data"; where lower is better, a 0 would wrongly win, so treat it as missing
      if (v === 0 && TT_METRICS[`tt:${c}`].dir === 'asc') v = null;
      f[`tt:${c}`] = v;
    }
  }
  S.ttMatched = matched;
}
const metricOf = (k) => METRICS[k] || TT_METRICS[k];

function flattenFacts(f) {
  const out = { ...f };
  for (const k of FACT_KEYS) out[k] = typeof f.facts?.[k] === 'number' ? f.facts[k] : null;
  return out;
}

function route() {
  const r = (location.hash.replace('#/', '') || 'setup').split('/')[0];
  S.route = routes().some(([k]) => k === r) ? r : 'setup';
  renderShell();
}

function renderShell() {
  const nav = routes().map(([k, label]) => `<a href="#/${k}" class="${S.route === k ? 'on' : ''}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg><span>${label}</span>${k === 'site' || k === 'household' ? `<b class="nbadge" data-badge="${k}" hidden></b>` : ''}</a>`).join('');
  app.innerHTML = `<div class="shell">
    <aside class="rail">
      <div class="brand"><h1>VITHAI</h1><p>Plant monthly, grow steadily</p></div>
      <nav class="nav">${nav}</nav>
      <div class="rail-foot"><div class="who">${esc(S.me.name)} <span class="muted">@${esc(S.me.username)}</span></div><div>${esc(S.me.householdName)}</div><button id="logout">Sign out</button></div>
    </aside>
    <main id="main"></main></div>`;
  document.getElementById('logout').onclick = async () => { await api('POST', '/api/auth/logout'); location.hash = ''; location.reload(); };
  refreshBadges();
  const main = document.getElementById('main');
  const ctx = { S, saveSettings, chosenFund, rankedFor, isExcluded };
  ({ setup: renderSetup, funds: renderFunds, 'stocks-in': (m) => renderStocks(m, 'in', ctx), 'stocks-us': (m) => renderStocks(m, 'us', ctx), plan: (m) => renderPlan(m, ctx), portfolio: renderPortfolio, data: renderData, household: renderHousehold, site: renderSiteAdmin })[S.route](main);
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

function rankedFor(slot) { const cfg = slotConfig(slot); return rankFunds(eligibleFunds(slot, cfg), cfg.criteria, TT_METRICS); }

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
      <h3>Allocation</h3><p class="sub">Pick a ready-made mix or set your own. Percentages must add up to 100. The fund shown is the top-ranked one on the Fund dashboard, unless you've pinned a different one there.</p>
      <div class="seg" id="presets" style="margin-bottom:6px">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-p="${k}">${p.label}</button>`).join('')}<button type="button" data-p="custom">Custom</button></div>
      <p class="note" id="presetnote" style="margin:0 0 12px"></p>
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
  const currentAlloc = () => Object.fromEntries([...document.querySelectorAll('.alloc')].map((i) => [i.dataset.slot, Number(i.value) || 0]));
  const markPreset = () => {
    const a = currentAlloc();
    const match = Object.keys(PRESETS).find((k) => { const t = presetAlloc(k, s.usSlot); return Object.keys(a).every((slot) => (t[slot] || 0) === a[slot]); });
    const key = match || 'custom';
    document.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === key));
    document.getElementById('presetnote').textContent = key === 'custom' ? 'Custom: your own split. Edit the percentages below.' : PRESETS[key].note + (s.usSlot ? ' With the US stocks slot on, the international share is split equally between international funds and US stocks.' : '');
  };
  document.querySelectorAll('#presets button').forEach((b) => (b.onclick = () => {
    if (b.dataset.p !== 'custom') {
      const t = presetAlloc(b.dataset.p, s.usSlot);
      document.querySelectorAll('.alloc').forEach((i) => { i.value = t[i.dataset.slot] || 0; });
      recalc();
    }
    markPreset();
    if (b.dataset.p === 'custom') document.querySelector('.alloc')?.focus();
  }));
  main.querySelectorAll('input').forEach((i) => (i.oninput = () => { recalc(); markPreset(); }));
  recalc();
  markPreset();
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
let ttQuery = '';
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
    const active = new Map(cfg.criteria.map(([k, w]) => [k, w]));
    const dirOf = new Map(cfg.criteria.map(([k, , d]) => [k, d || metricOf(k)?.dir || 'desc']));
    const groups = {};
    for (const [k, m] of Object.entries(METRICS)) (groups[m.group] ||= []).push(k);
    const ttKeys = Object.keys(TT_METRICS);
    const subs = SUB_OPTIONS[slot];
    const pool = eligibleFunds(slot, cfg);
    const cover = (k) => pool.length ? pool.filter((f) => typeof f[k] === 'number').length / pool.length : 0;
    const coverNote = (k) => `<div class="note" style="margin:-2px 0 4px 26px">${cover(k) === 0 ? '<span class="warn">no data for these funds: not scoring</span>' : `${Math.round(cover(k) * 100)}% of funds have it`}</div>`;
    const noData = [...active.keys()].filter((k) => metricOf(k) && cover(k) === 0);
    const gone = [...active.keys()].filter((k) => !metricOf(k));
    const line = (k) => { const m = metricOf(k); const d = dirOf.get(k) || m.dir; return `
        <div class="crit" data-row="${esc(k)}"><input type="checkbox" data-k="${esc(k)}" ${active.has(k) ? 'checked' : ''} id="c_${esc(k)}">
        <label for="c_${esc(k)}">${esc(m.label)}</label><button type="button" class="dirbtn" data-dir="${esc(k)}" data-d="${d}" title="Click to flip: is a higher or lower value better?">${d === 'asc' ? '↓ better' : '↑ better'}</button>
        <input class="w" type="number" min="0" step="0.5" data-w="${esc(k)}" value="${active.get(k) ?? 1}" aria-label="Weight for ${esc(m.label)}"></div>${active.has(k) ? coverNote(k) : ''}`; };
    const ttSorted = [...ttKeys.filter((k) => active.has(k)), ...ttKeys.filter((k) => !active.has(k))];
    panel.innerHTML = `<h3>Ranking criteria</h3><p class="sub">Tick the metrics to score on, set their weight, and click ↑/↓ to say whether higher or lower is better. Each fund's score is the weighted average of its percentile on each metric; funds missing a metric are scored on the rest.</p>
      <div class="row"><div><label class="f">Minimum age (years)</label><input class="input num" id="minage" type="number" min="0" step="1" value="${cfg.minAge}"></div></div>
      ${subs ? `<div class="crit-group">Include</div>${subs.map((s) => `<label class="toggle" style="margin-right:14px"><input type="checkbox" class="subchk" value="${s}" ${cfg.sub.includes(s) ? 'checked' : ''}>${s}</label>`).join('')}` : ''}
      <div style="margin-top:10px"><label class="toggle"><input type="checkbox" id="hideclosed" ${cfg.hideClosed ? 'checked' : ''}>Hide funds marked closed to new SIPs</label></div>
      ${Object.entries(groups).map(([g, keys]) => `<div class="crit-group">${g}</div>${keys.map(line).join('')}`).join('')}
      <div class="crit-group">From your Tickertape data (${ttKeys.length} column${ttKeys.length === 1 ? '' : 's'}${ttKeys.length ? `, ${S.ttMatched || 0} funds matched` : ''})</div>
      ${ttKeys.length ? `<input class="input" id="ttq" placeholder="Search ${ttKeys.length} columns…" style="margin:4px 0 6px;padding:5px 8px;font-size:13px" value="${esc(ttQuery)}">
        <div id="ttlist" style="max-height:340px;overflow:auto">${ttSorted.map(line).join('')}</div>
        <p class="note">Every number column in the mutual fund export. Where lower is better, a 0 is treated as "no data" because Tickertape writes 0 for missing values.</p>`
        : `<p class="note">Load your Tickertape mutual fund export on the <a href="#/data">Data</a> page to rank on any of its columns too.</p>`}
      ${gone.length ? `<p class="note warn" style="margin-top:10px">${gone.length} saved metric${gone.length > 1 ? 's are' : ' is'} not in your current data (${gone.map((k) => esc(k.replace(/^tt:/, ''))).join(', ')}) and left out. <button class="btn small" id="dropgone">Remove</button></p>` : ''}
      ${noData.length ? `<p class="note warn" style="margin-top:10px">${noData.length} ticked metric${noData.length > 1 ? 's have' : ' has'} no data for these funds (${noData.map((k) => esc(metricOf(k).label)).join(', ')}) and ${noData.length > 1 ? 'are' : 'is'} not scoring. <button class="btn small" id="dropempty">Untick them</button></p>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn primary" id="savecrit">Save criteria</button><button class="btn" id="resetcrit">Reset to Vithai default</button></div>`;
    const filterTT = () => {
      const q = (document.getElementById('ttq')?.value || '').toLowerCase();
      panel.querySelectorAll('#ttlist .crit').forEach((r) => { const k = r.dataset.row; const show = !q || active.has(k) || TT_METRICS[k].label.toLowerCase().includes(q); r.style.display = show ? '' : 'none'; if (r.nextElementSibling?.classList.contains('note')) r.nextElementSibling.style.display = show ? '' : 'none'; });
    };
    filterTT();
    const collect = () => {
      const criteria = [];
      panel.querySelectorAll('input[type=checkbox][data-k]').forEach((c) => {
        if (!c.checked) return;
        const k = c.dataset.k, d = panel.querySelector(`[data-dir="${CSS.escape(k)}"]`).dataset.d;
        const w = Number(panel.querySelector(`[data-w="${CSS.escape(k)}"]`).value) || 0;
        criteria.push(d !== metricOf(k).dir ? [k, w, d] : [k, w]);
      });
      for (const k of gone) criteria.push(cfg.criteria.find(([x]) => x === k)); // keep until removed
      const sub = subs ? [...panel.querySelectorAll('.subchk:checked')].map((c) => c.value) : [];
      return { minAge: Number(document.getElementById('minage').value) || 0, sub, criteria, hideClosed: document.getElementById('hideclosed').checked };
    };
    const refresh = () => { Object.assign(cfg, collect()); drawCriteria(); drawTable(true); };
    panel.querySelectorAll('input:not(#ttq)').forEach((i) => (i.onchange = refresh));
    panel.querySelectorAll('.dirbtn').forEach((b) => (b.onclick = () => { b.dataset.d = b.dataset.d === 'asc' ? 'desc' : 'asc'; refresh(); }));
    const tq = document.getElementById('ttq');
    if (tq) tq.oninput = () => { ttQuery = tq.value; filterTT(); };
    document.getElementById('dropempty')?.addEventListener('click', () => { cfg.criteria = cfg.criteria.filter(([k]) => !noData.includes(k)); drawCriteria(); drawTable(true); });
    document.getElementById('dropgone')?.addEventListener('click', () => { cfg.criteria = cfg.criteria.filter(([k]) => !gone.includes(k)); drawCriteria(); drawTable(true); });
    document.getElementById('savecrit').onclick = async () => { await saveSettings({ criteria: { ...S.settings.criteria, [slot]: collect() } }, 'Criteria saved'); renderFunds(main); };
    document.getElementById('resetcrit').onclick = async () => { const c = { ...S.settings.criteria }; delete c[slot]; await saveSettings({ criteria: c }, 'Back to the Vithai default'); renderFunds(main); };
  }

  function drawTable(fromCriteria) {
    const rows = fromCriteria ? rankFunds(eligibleFunds(slot, cfg), cfg.criteria, TT_METRICS) : ranked;
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
      ...cfg.criteria.filter(([k]) => TT_METRICS[k]).map(([k]) => [k, TT_METRICS[k].label, 'r']),
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
      fundSort = fundSort.key === k ? { key: k, dir: -fundSort.dir } : { key: k, dir: k === 'rank' || k === 'name' || metricOf(k)?.dir === 'asc' ? 1 : -1 };
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
    ${f.tt ? `<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:600">All Tickertape data for this fund (${Object.keys(f.tt).filter((k) => k !== '__key').length} fields)</summary>
      <div class="kv" style="margin-top:8px;max-height:300px;overflow:auto">${Object.entries(f.tt).filter(([k]) => k !== '__key').map(([k, v]) => m(esc(k), v === null || v === undefined || v === '' ? '–' : esc(typeof v === 'number' ? num(v, 2) : v))).join('')}</div></details>` : ''}
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
        await attachTickertape();
        close(); toast('Fund facts saved'); renderFunds(main);
      } catch (e) { toast(e.message); }
    });
  });
}

// ---------------------------------------------------------------- PORTFOLIO
let portfolioMember = null;
async function renderPortfolio(main) {
  main.innerHTML = '<div class="boot" style="height:200px">Loading portfolio…</div>';
  const hh = await api('GET', '/api/household');
  const viewable = hh.members.filter((m) => m.status === 'active' && (m.id === S.me.id || m.shareDashboard));
  const combined = portfolioMember === 'household' && viewable.length > 1;
  const hidden = hh.members.filter((m) => m.status === 'active' && !viewable.includes(m));
  if (!combined && (!portfolioMember || !viewable.some((m) => m.id === portfolioMember))) portfolioMember = S.me.id;
  let data, people = [];
  try {
    if (combined) {
      people = await Promise.all(viewable.map((m) => api('GET', `/api/members/${m.id}/portfolio`)));
      // Household targets: each member's allocation weighted by their monthly amount
      const total = people.reduce((a, p) => a + (p.settings.monthlyTotal || 0), 0);
      const alloc = {};
      for (const k of Object.keys(SLOTS)) alloc[k] = total ? Math.round(people.reduce((a, p) => a + (p.settings.monthlyTotal || 0) * (p.settings.alloc[k] || 0), 0) / total * 10) / 10 : 0;
      data = {
        member: { name: 'Household' },
        settings: { monthlyTotal: total, alloc, usSlot: people.some((p) => p.settings.usSlot), usdInr: people.find((p) => p.settings.usdInr)?.settings.usdInr },
        transactions: people.flatMap((p) => p.transactions.map((t) => ({ ...t, who: p.member.name }))),
      };
    } else data = await api('GET', `/api/members/${portfolioMember}/portfolio`);
  } catch (e) { main.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
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
    <div class="page-head"><div><h2>Portfolio</h2><p>${combined ? `Household total for ${viewable.map((m) => (m.id === S.me.id ? 'you' : esc(m.name))).join(', ')}` : portfolioMember === S.me.id ? 'Your holdings' : esc(data.member.name) + "'s holdings"}, valued at the latest NAVs and prices.</p></div><div class="grow"></div>
      ${viewable.length > 1 ? `<div><label class="f">Showing</label><select class="input" id="pmem">${viewable.map((m) => `<option value="${m.id}" ${m.id === portfolioMember ? 'selected' : ''}>${m.id === S.me.id ? 'Me' : esc(m.name)}</option>`).join('')}<option value="household" ${combined ? 'selected' : ''}>Household (everyone shown here)</option></select></div>` : ''}</div>
    ${combined && hidden.length ? `<p class="note">Not included because they keep their portfolio private: ${hidden.map((m) => esc(m.name)).join(', ')}.</p>` : ''}
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
    ${combined ? `<div class="card"><h3>By member</h3><div class="tablewrap"><table class="t"><thead><tr><th>Member</th><th class="r">Monthly plan</th><th class="r">Invested</th><th class="r">Value</th><th class="r">Gain</th><th class="r">Share of household</th></tr></thead>
      <tbody>${people.map((p) => { const hs = holdings.map((h) => { const mine = p.transactions.filter((t) => t.assetId === h.id); const u = mine.reduce((a, t) => a + t.units, 0), inv = mine.reduce((a, t) => a + t.amount, 0); return { inv, val: h.priced ? u * h.price : inv }; }); const inv = hs.reduce((a, x) => a + x.inv, 0), val = hs.reduce((a, x) => a + x.val, 0); return `<tr><td>${p.member.id === S.me.id ? 'Me' : esc(p.member.name)}</td><td class="r">${inr(p.settings.monthlyTotal)}</td><td class="r">${inr(inv)}</td><td class="r">${inr(val)}</td><td class="r ${signCls(val - inv)}">${inr(val - inv)}</td><td class="r">${value ? pct(val / value * 100, 1) : '–'}</td></tr>`; }).join('')}</tbody></table></div>
      <p class="note">Pick a member under "Showing" to see their own allocation and holdings.</p></div>` : ''}
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
    const miss = m?.missing ? m.missing.split(',').filter(Boolean).map((id) => keyFieldsFor(k).find((f) => f.id === id)?.label || id) : [];
    return `<tr><td><b>${KINDS[k]}</b></td><td>${m ? esc(when(m)) + (m.by ? ` <span class="muted">by ${esc(m.by)}</span>` : '') : '<span class="warn">Not loaded</span>'}</td><td class="r">${m ? num(m.rows, 0) : '–'}</td><td class="r">${m ? num(m.cols, 0) : '–'}</td><td class="nm">${m ? esc(m.files || '') : ''}${miss.length ? `<span class="a warn">Missing key fields: ${esc(miss.join(', '))}</span>` : ''}</td></tr>`;
  };
  main.innerHTML = `
    <div class="page-head"><div><h2>Data</h2><p>Load your Tickertape screener exports for mutual funds, Indian stocks and US stocks.</p></div></div>
    <div class="card"><h3>What's loaded</h3>${dsError ? `<p class="err">${esc(dsError)}</p>` : ''}
      <div class="tablewrap"><table class="t"><thead><tr><th>Dataset</th><th>Loaded</th><th class="r">Rows</th><th class="r">Columns</th><th>Files</th></tr></thead>
      <tbody>${['mf', 'in', 'us'].map(status).join('')}</tbody></table></div>
      <p class="note">This is your household's own data: other households can't see it, and everyone in your household sees the latest import. Fund NAVs, returns and risk ratios refresh automatically twice a day; Tickertape data only changes when you load new exports.</p></div>
    <div class="card"><h3>1 · Export from Tickertape</h3>
      <p class="sub">Tickertape exports at most 45 columns at a time, so the <b>Vithai export</b> button splits every available column into parts and exports each one using Tickertape's own Export button, in your signed-in browser.</p>
      <ol style="padding-left:18px;margin:0 0 12px">
        <li>Show your bookmarks bar (<b>Ctrl+Shift+B</b>, or <b>Cmd+Shift+B</b> on a Mac) and <b>drag this button onto it</b>: <a class="btn primary" id="bm" href="#" onclick="return false" title="Drag me to your bookmarks bar">⬇ Vithai export</a>
          <span class="note" style="display:block;margin-top:4px">The shortcut and dragging work in desktop Chrome or Edge only, not on a phone or tablet. Can't drag it? Use <b>Copy script</b> below.</span></li>
        <li>Sign in to Tickertape, then open a screener: <a href="https://www.tickertape.in/screener/mutual-fund" target="_blank" rel="noopener">Mutual funds</a> · <a href="https://www.tickertape.in/screener/equity" target="_blank" rel="noopener">Indian stocks</a> · <a href="https://www.tickertape.in/screener/us-stocks" target="_blank" rel="noopener">US stocks</a></li>
        <li>Click <b>Vithai export</b> in your bookmarks bar and leave the tab alone until the box in the bottom-right says it's finished (about 1–3 minutes).</li>
        <li>The first time, Chrome asks to allow <b>multiple downloads</b> from Tickertape. Choose <b>Allow</b>.</li>
      </ol>
      <p class="note">If you're signed out of Tickertape the export stops and tells you. If Tickertape changes its page, the button may need updating.</p>
      <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">Can't drag the button? Add it by hand with Copy script</summary>
        <div class="row tight" style="margin:10px 0;flex-wrap:wrap;align-items:center"><button class="btn" id="bmcopy">Copy script</button><span class="note" id="bmcopied"></span></div>
        <textarea class="input" id="bmcode" rows="3" readonly style="font-family:var(--mono);font-size:11px" placeholder="Loading script…"></textarea>
        <p style="margin:12px 0 4px"><b>Desktop Chrome or Edge</b></p>
        <ol style="padding-left:18px;margin:0">
          <li>Click <b>Copy script</b>.</li>
          <li>Right-click the bookmarks bar → <b>Add page…</b> (Edge: <b>Add favourite</b>). Name it <b>Vithai export</b>.</li>
          <li>Paste the script into the <b>URL</b> box and save. Then use it as in steps 2–4 above.</li></ol>
        <p style="margin:12px 0 4px"><b>Android (Chrome)</b></p>
        <ol style="padding-left:18px;margin:0">
          <li>Click <b>Copy script</b>. Bookmark any page (⋮ → ☆), then ⋮ → <b>Bookmarks</b>, find that bookmark, ⋮ → <b>Edit</b>.</li>
          <li>Change the name to <b>Vithai export</b>, replace the URL with the copied script, and save.</li>
          <li>On a Tickertape screener, tap the address bar, type <b>Vithai export</b> and tap the bookmark in the suggestions (opening it from the Bookmarks list doesn't run it).</li></ol>
        <p style="margin:12px 0 4px"><b>iPhone / iPad (Safari)</b></p>
        <ol style="padding-left:18px;margin:0">
          <li>Click <b>Copy script</b>. Bookmark any page (Share → <b>Add Bookmark</b>).</li>
          <li>Open Bookmarks, tap <b>Edit</b>, tap the new bookmark, rename it <b>Vithai export</b> and replace the address with the copied script.</li>
          <li>On a Tickertape screener, open Bookmarks and tap <b>Vithai export</b>.</li></ol>
        <p class="note" style="margin-top:10px"><b>On phones it's best-effort:</b> the script was built for Tickertape's desktop page. Tickertape's mobile layout is different, and phones often block or rename multiple downloads. If it doesn't work, export from a computer about once a month. Everyone in your household can still use Vithai on their phones, because the loaded data is stored for the household.</p>
      </details></div>
    <div class="card"><h3>2 · Load the files into Vithai</h3>
      ${admin ? `<p class="sub">Select all the CSV files at once: every part, for any of the three screeners. Vithai works out which is which and joins the parts back together.</p>
      <label class="btn primary"><input type="file" id="ttfiles" accept=".csv,.xlsx,.xls" multiple hidden>Choose files…</label>
      <div id="ttprev" style="margin-top:14px"></div>` : '<p class="sub">Only a household admin can load data.</p>'}</div>`;

  // bookmarklet
  try {
    const code = await (await fetch('/tools/tickertape-export.js', { cache: 'no-store' })).text();
    const bmUrl = 'javascript:' + encodeURIComponent(code);
    document.getElementById('bm').href = bmUrl;
    const ta = document.getElementById('bmcode');
    ta.value = bmUrl;
    document.getElementById('bmcopy').onclick = async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(bmUrl); ok = true; } catch { /* fall back below */ }
      if (!ok) { ta.focus(); ta.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } }
      document.getElementById('bmcopied').textContent = ok ? '✓ Copied. Now paste it as a bookmark\'s URL.' : 'Couldn\'t copy automatically: select all the text in the box and copy it.';
    };
  } catch { /* leave as # */ }

  let files = [];
  let plans = {}; // kind -> { group, merged, mapping, saved }
  const drawPreview = () => {
    const box = document.getElementById('ttprev');
    if (!files.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="tablewrap"><table class="t"><thead><tr><th>File</th><th>Type</th><th class="r">Rows</th><th class="r">Columns</th></tr></thead>
      <tbody>${files.map((f, i) => `<tr><td class="nm">${esc(f.name)}</td><td><select class="input" data-i="${i}" style="width:auto;padding:4px 8px">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${f.guess === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td class="r">${num(f.rows.length, 0)}</td><td class="r">${f.header.length}</td></tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="ttnext" style="flex:0 0 auto">Next: check columns</button></div>
      <div id="ttmap"></div>`;
    box.querySelectorAll('select[data-i]').forEach((sel) => (sel.onchange = () => { files[+sel.dataset.i].guess = sel.value; document.getElementById('ttmap').innerHTML = ''; }));
    document.getElementById('ttnext').onclick = buildMapping;
  };
  document.getElementById('ttfiles')?.addEventListener('change', async (e) => {
    const msg = document.getElementById('ttprev');
    msg.innerHTML = '<p class="note">Reading files…</p>';
    try { files = await Promise.all([...e.target.files].map(readExport)); drawPreview(); } catch (err) { msg.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  });

  // Step 2: match key fields, rename or exclude columns, per export type
  async function buildMapping() {
    const box = document.getElementById('ttmap');
    box.innerHTML = '<p class="note">Checking columns…</p>';
    plans = {};
    for (const kind of ['mf', 'in', 'us']) {
      const group = files.filter((f) => f.guess === kind);
      if (!group.length) continue;
      const merged = mergeParts(group);
      let saved = {};
      try { saved = await getColumnMap(kind); } catch { /* first import */ }
      plans[kind] = { group, merged, mapping: autoMap(kind, merged.columns, saved || {}) };
    }
    box.innerHTML = Object.entries(plans).map(([kind, pl]) => mappingSection(kind, pl)).join('') +
      `<div class="row" style="margin-top:14px"><button class="btn primary" id="ttload" style="flex:0 0 auto">Load into Vithai</button><span class="note" id="ttmsg"></span></div>`;
    for (const kind of Object.keys(plans)) wireSection(kind);
    document.getElementById('ttload').onclick = loadAll;
  }

  function mappingSection(kind, pl) {
    const { merged, mapping } = pl;
    const fields = keyFieldsFor(kind);
    const sample = (c) => { const r = merged.rows.find((x) => x[c] !== null && x[c] !== '' && x[c] !== '-'); return r ? String(r[c]).slice(0, 40) : ''; };
    const opts = (sel) => `<option value="">— not in my file —</option>${merged.columns.map((c) => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(mapping.renames[c] || c)}${mapping.renames[c] && mapping.renames[c] !== c ? ` (${esc(c)})` : ''}</option>`).join('')}`;
    return `<div class="card" style="margin-top:16px" data-kind="${kind}"><h3>${KINDS[kind]}: ${num(merged.rows.length, 0)} rows · ${merged.columns.length} columns</h3>
      ${mapping.notes.length ? `<p class="warn" style="font-size:13px">Changed since last import: ${mapping.notes.map(esc).join(' ')}</p>` : ''}
      <p class="sub">Key fields Vithai uses. Each is matched to a column automatically; change the match if a column was renamed, or choose "not in my file". Missing fields are simply skipped.</p>
      <div class="tablewrap"><table class="t"><thead><tr><th>Field</th><th>Used for</th><th>Column in your file</th><th>Status</th></tr></thead>
      <tbody>${fields.map((f) => `<tr><td><b>${esc(f.label)}</b>${f.required ? ' <span class="badge">required</span>' : ''}</td><td class="muted" style="white-space:normal">${esc(f.use)}</td>
        <td><select class="input keysel" data-id="${f.id}" style="width:auto;max-width:320px;padding:4px 8px">${opts(mapping.keys[f.id])}</select></td>
        <td class="st" data-id="${f.id}"></td></tr>`).join('')}</tbody></table></div>
      <p class="note missing-note" style="margin-top:8px"></p>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">All ${merged.columns.length} columns: rename or leave out</summary>
        <input class="input colq" placeholder="Find a column…" style="margin:10px 0;max-width:320px">
        <div class="tablewrap" style="max-height:50vh"><table class="t"><thead><tr><th>Include</th><th>Column in file</th><th>Name in Vithai</th><th>Example</th></tr></thead>
        <tbody>${merged.columns.map((c) => `<tr data-col="${esc(c.toLowerCase())}"><td><input type="checkbox" class="inc" data-c="${esc(c)}" ${mapping.excluded.includes(c) ? '' : 'checked'}></td>
          <td class="nm">${esc(c)}</td><td><input class="input ren" data-c="${esc(c)}" value="${esc(mapping.renames[c] || c)}" style="padding:4px 8px;min-width:220px"></td><td class="muted">${esc(sample(c))}</td></tr>`).join('')}</tbody></table></div>
      </details></div>`;
  }

  function wireSection(kind) {
    const card = document.querySelector(`[data-kind="${kind}"]`);
    const pl = plans[kind];
    const fields = keyFieldsFor(kind);
    const refresh = () => {
      const missing = [];
      for (const f of fields) {
        const sel = card.querySelector(`.keysel[data-id="${f.id}"]`).value;
        const excluded = sel && !card.querySelector(`.inc[data-c="${CSS.escape(sel)}"]`).checked;
        const cell = card.querySelector(`.st[data-id="${f.id}"]`);
        if (sel && !excluded) cell.innerHTML = '<span class="badge good">found</span>';
        else { cell.innerHTML = f.required ? '<span class="badge bad">needed</span>' : '<span class="badge gold">missing</span>'; missing.push(f); }
      }
      const ranking = missing.filter((f) => f.rank);
      card.querySelector('.missing-note').innerHTML = missing.length
        ? `<span class="warn">${missing.length} key field${missing.length > 1 ? 's' : ''} missing: ${missing.map((f) => esc(f.label)).join(', ')}.</span> ${ranking.length ? 'They will be left out of the default ranking; you can choose other metrics on the dashboard.' : 'Vithai will work without them.'}`
        : '<span class="pos">All key fields found.</span>';
    };
    card.querySelectorAll('.keysel, .inc').forEach((x) => (x.onchange = refresh));
    card.querySelectorAll('.ren').forEach((x) => (x.oninput = () => {
      const c = x.dataset.c;
      card.querySelectorAll(`.keysel option[value="${CSS.escape(c)}"]`).forEach((o) => { o.textContent = x.value + (x.value !== c ? ` (${c})` : ''); });
    }));
    card.querySelector('.colq').oninput = (e) => { const q = e.target.value.toLowerCase(); card.querySelectorAll('tr[data-col]').forEach((tr) => { tr.style.display = !q || tr.dataset.col.includes(q) ? '' : 'none'; }); };
    refresh();
    pl.read = () => {
      const keys = {}, renames = {}, excluded = [];
      card.querySelectorAll('.keysel').forEach((x) => { keys[x.dataset.id] = x.value || null; });
      card.querySelectorAll('.ren').forEach((x) => { if (x.value.trim() && x.value.trim() !== x.dataset.c) renames[x.dataset.c] = x.value.trim(); });
      card.querySelectorAll('.inc').forEach((x) => { if (!x.checked) excluded.push(x.dataset.c); });
      for (const [id, c] of Object.entries(keys)) if (c && excluded.includes(c)) keys[id] = null;
      return { keys, renames, excluded };
    };
  }

  async function loadAll() {
    const btn = document.getElementById('ttload'), msg = document.getElementById('ttmsg');
    btn.disabled = true;
    const done = [];
    try {
      for (const [kind, pl] of Object.entries(plans)) {
        const mapping = pl.read();
        if (!mapping.keys.name) throw new Error(`${KINDS[kind]}: choose which column holds the name.`);
        mapping.renames = Object.fromEntries(pl.merged.columns.map((c) => [c, mapping.renames[c] || defaultLabel(kind, c)]));
        msg.textContent = `Merging and uploading ${KINDS[kind]}…`;
        // re-merge on the chosen identity columns in case they aren't the first two
        const merged = mergeParts(pl.group, [mapping.keys.name, mapping.keys.ticker || mapping.keys.subCategory]);
        const dataset = toDataset(kind, merged, pl.group.map((f) => f.name), mapping);
        await uploadDataset(dataset);
        await saveColumnMap(kind, { keys: mapping.keys, renames: Object.fromEntries(Object.entries(mapping.renames).filter(([c, l]) => l !== defaultLabel(kind, c))), excluded: mapping.excluded });
        clearDatasetCache(kind);
        const missing = keyFieldsFor(kind).filter((f) => !mapping.keys[f.id]).map((f) => f.label);
        let extra = '';
        if (kind === 'mf') {
          const r = await saveMfFacts(mfFactsRows(merged, mapping));
          extra = `, ${r.matched} matched to Vithai's funds`;
        }
        if (kind === 'in') {
          const prices = niftyPricesFrom(merged, S.nifty, mapping);
          if (prices.length) { const r = await api('PUT', '/api/nifty', { rows: prices }); S.nifty = r.stocks; }
          extra = mapping.keys.price ? `, Nifty 50 prices updated for ${prices.length} of ${S.nifty.length} stocks` : ', no price column so Nifty 50 prices were not updated';
        }
        done.push(`${KINDS[kind]}: ${num(merged.rows.length, 0)} rows × ${dataset.columns.length} columns${extra}.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}`);
      }
      const f = await api('GET', '/api/funds');
      S.funds = f.funds.map(flattenFacts); S.meta = f.meta || {};
      await attachTickertape(true);
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
      ${admin ? `<div class="card"><h3>Invite someone</h3><p class="sub">They choose "Join a household" when signing up and enter this code or the household name, <b>${esc(household.name)}</b>. You then approve them below.</p>
        <div class="row"><div><input class="input" readonly value="${esc(household.inviteCode)}" style="font-family:var(--mono);font-size:18px;letter-spacing:.15em"></div><button class="btn" id="copycode" style="flex:0 0 auto">Copy</button></div></div>` : ''}
    </div>
    <div class="card"><h3>Members</h3>
      <div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Username</th>${admin ? '<th>Email</th>' : ''}<th>Role</th><th>Status</th><th>Sharing</th>${admin ? '<th></th>' : ''}</tr></thead>
      <tbody>${members.map((m) => `<tr><td>${esc(m.name)}${m.id === S.me.id ? ' <span class="badge">you</span>' : ''}</td><td>${esc(m.username || '')}</td>${admin ? `<td>${esc(m.email || '–')}</td>` : ''}
        <td>${m.role}</td><td>${m.status === 'pending' ? '<span class="badge gold">waiting for approval</span>' : 'active'}</td>
        <td>${m.shareDashboard ? '<span class="badge good">shared</span>' : '<span class="muted">private</span>'}</td>
        ${admin ? `<td>${m.id === S.me.id ? '' : m.status === 'pending'
          ? `<button class="btn small" data-act="approve" data-id="${m.id}">Approve</button> <button class="btn small danger" data-act="reject" data-id="${m.id}">Reject</button>`
          : `<button class="btn small" data-act="${m.role === 'admin' ? 'make-member' : 'make-admin'}" data-id="${m.id}">${m.role === 'admin' ? 'Make member' : 'Make admin'}</button> <button class="btn small" data-act="reset-password" data-id="${m.id}">Reset password</button> <button class="btn small danger" data-act="reject" data-id="${m.id}">Remove</button>`}</td>` : ''}</tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3>Your account</h3><p class="sub">Sign in with your username or your email. Email is optional; it's used for backups${S.me.siteAdmin ? ' and new-household alerts' : ''}.</p>
      <form id="accf" class="row" style="align-items:flex-end">
        <div><label class="f">Name</label><input class="input" name="name" value="${esc(S.me.name)}" required></div>
        <div><label class="f">Username</label><input class="input" name="username" value="${esc(S.me.username)}" autocapitalize="none" spellcheck="false" required></div>
        <div><label class="f">Email <span class="muted">(optional)</span></label><input class="input" name="email" type="email" value="${esc(S.me.email || '')}"></div>
        <button class="btn primary" style="flex:0 0 auto">Save</button><button class="btn" type="button" id="chpw" style="flex:0 0 auto">Change password</button></form></div>
    <div class="card"><h3>Back up your data</h3><p class="sub">Download everything Vithai holds for you: setup, monthly plans and every purchase. The Excel file has your purchases and plans as tables; the backup file (.json) is the complete copy.</p>
      <div class="row"><button class="btn" id="bkme" style="flex:0 0 auto">Download my backup (.json)</button><button class="btn" id="bkxl" style="flex:0 0 auto">Download my purchases and plans (Excel)</button>
      ${admin ? '<button class="btn" id="bkhh" style="flex:0 0 auto">Download whole household backup (.json)</button>' : ''}</div>
      <div class="row" style="margin-top:10px">${S.me.email ? `<button class="btn" id="emme" style="flex:0 0 auto">Email my backup to ${esc(S.me.email)}</button>
      ${admin ? `<button class="btn" id="emhh" style="flex:0 0 auto">Email household backup to ${esc(S.me.email)}</button>` : ''}` : '<span class="note">Add an email under "Your account" to get backups by email.</span>'}</div>
      <p class="note">Your own backup always goes to your email. A household backup can only be requested by a household admin and goes to that admin's email.</p></div>
    <div class="card"><h3>Delete data</h3><p class="sub">Deleting can't be undone. Before anything is deleted, a backup is downloaded to this device and emailed to you (when email is set up for this site): your own data's backup when you delete your data, the whole household's backup to the admin when an admin deletes household data.</p>
      <div class="row"><button class="btn danger" id="delme" style="flex:0 0 auto">Delete all my data</button>${admin ? '<button class="btn danger" id="delhh" style="flex:0 0 auto">Delete all household data</button>' : ''}</div>
      <p class="note">"All my data" removes your setup, plans and purchases; your sign-in stays. "All household data" does that for every member and also removes the household's Tickertape imports, column choices, fund edits and Nifty 50 prices.</p></div>`;
  document.getElementById('share').onchange = async (e) => {
    try { await api('PUT', '/api/me/sharing', { share: e.target.checked }); S.me.shareDashboard = e.target.checked; toast(e.target.checked ? 'Your portfolio is now visible to your household' : 'Your portfolio is now private'); renderHousehold(main); }
    catch (err) { toast(err.message); }
  };
  document.getElementById('copycode')?.addEventListener('click', () => { navigator.clipboard?.writeText(household.inviteCode); toast('Invite code copied'); });
  document.getElementById('chpw').onclick = () => promptPasswordChange(false);
  document.getElementById('accf').onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target).entries());
    try { const r = await api('PUT', '/api/me/account', d); Object.assign(S.me, r.user); toast('Account updated'); renderShell(); } catch (err) { toast(err.message); }
  };
  document.getElementById('bkme').onclick = () => downloadBackup('me').catch((e) => toast(e.message));
  document.getElementById('bkhh')?.addEventListener('click', () => downloadBackup('household').catch((e) => toast(e.message)));
  const emailBk = async (scope, btn) => { btn.disabled = true; try { const r = await api('POST', '/api/backup/email', { scope }); toast(`Backup emailed to ${r.to}`); } catch (e) { toast(e.message); } btn.disabled = false; };
  document.getElementById('emme')?.addEventListener('click', (e) => emailBk('me', e.target));
  document.getElementById('emhh')?.addEventListener('click', (e) => emailBk('household', e.target));
  document.getElementById('bkxl').onclick = () => downloadExcel().catch((e) => toast(e.message));
  document.getElementById('delme').onclick = () => deleteDataModal('me');
  document.getElementById('delhh')?.addEventListener('click', () => deleteDataModal('household'));
  main.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
    const act = b.dataset.act;
    if ((act === 'reject' || act === 'reset-password') && !confirm(act === 'reject' ? 'Remove this member from the household?' : 'Reset this member\'s password?')) return;
    try {
      const r = await api('POST', `/api/household/members/${b.dataset.id}/${act}`);
      if (r.tempPassword) openModal(`<h3>Temporary password</h3><p>Give this to the member. They'll be asked to change it when they sign in.</p><p style="font-family:var(--mono);font-size:22px;letter-spacing:.1em">${esc(r.tempPassword)}</p><div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>Done</button></div>`);
      else toast('Updated');
      renderHousehold(main); refreshBadges();
    } catch (e) { toast(e.message); }
  }));
}

// Red counts in the menu for things waiting on you (checked on every page change and every minute)
async function refreshBadges() {
  if (!S.me?.siteAdmin && S.me?.role !== 'admin') return;
  try {
    const b = await api('GET', '/api/badges');
    document.querySelectorAll('[data-badge]').forEach((el) => {
      const n = b[el.dataset.badge] || 0;
      el.hidden = !n; el.textContent = n > 99 ? '99+' : n;
      el.title = el.dataset.badge === 'site' ? `${n} household${n === 1 ? '' : 's'} waiting for approval` : `${n} member${n === 1 ? '' : 's'} waiting to join`;
    });
  } catch { /* ignore */ }
}
setInterval(() => { if (document.visibilityState === 'visible') refreshBadges(); }, 60000);

// ---------------------------------------------------------------- SITE ADMIN
async function renderSiteAdmin(main) {
  const { households } = await api('GET', '/api/site/households');
  const pending = households.filter((h) => h.status === 'pending');
  const row = (h) => `<tr><td><b>${esc(h.name)}</b>${h.mine ? ' <span class="badge">yours</span>' : ''}</td><td>${esc(h.owner_name || '–')} <span class="muted">@${esc(h.owner_username || '')}</span></td><td>${esc(h.owner_email || '–')}</td>
    <td class="r">${h.members}</td><td>${esc((h.created_at || '').slice(0, 10))}</td>
    <td>${{ pending: '<span class="badge gold">waiting</span>', active: '<span class="badge good">active</span>', rejected: '<span class="badge bad">rejected</span>', suspended: '<span class="badge bad">suspended</span>' }[h.status] || esc(h.status)}</td>
    <td style="white-space:nowrap">${h.mine ? '' : h.status === 'pending' ? `<button class="btn small primary" data-h="${h.id}" data-a="approve">Approve</button> <button class="btn small danger" data-h="${h.id}" data-a="reject">Reject</button>`
      : h.status === 'active' ? `<button class="btn small danger" data-h="${h.id}" data-a="suspend">Suspend</button>` : `<button class="btn small" data-h="${h.id}" data-a="reactivate">Reactivate</button>`}</td></tr>`;
  const head = '<thead><tr><th>Household</th><th>Started by</th><th>Email</th><th class="r">Members</th><th>Created</th><th>Status</th><th></th></tr></thead>';
  main.innerHTML = `
    <div class="page-head"><div><h2>Site admin</h2><p>Every new household waits here for your approval.</p></div></div>
    <div class="card"><h3>Waiting for approval (${pending.length})</h3>
      ${pending.length ? `<div class="tablewrap"><table class="t">${head}<tbody>${pending.map(row).join('')}</tbody></table></div>` : '<p class="note">Nothing waiting.</p>'}</div>
    <div class="card"><h3>All households (${households.length})</h3><div class="tablewrap"><table class="t">${head}<tbody>${households.filter((h) => h.status !== 'pending').map(row).join('')}</tbody></table></div>
      <p class="note">Suspending signs everyone in that household out and blocks them until you reactivate it. Their data is kept. Owners are emailed when email is set up and they have an email address.</p></div>`;
  main.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
    const h = households.find((x) => x.id === b.dataset.h);
    const verb = { approve: 'Approve', reject: 'Reject', suspend: 'Suspend', reactivate: 'Reactivate' }[b.dataset.a];
    if (b.dataset.a !== 'approve' && !confirm(`${verb} the household "${h.name}"?`)) return;
    try { const r = await api('POST', `/api/site/households/${h.id}/${b.dataset.a}`); toast(`${h.name}: ${r.status}${r.emailed ? ' · owner emailed' : ''}`); renderSiteAdmin(main); refreshBadges(); } catch (e) { toast(e.message); }
  }));
}

// ---------------------------------------------------------------- BACKUP & DELETE
function saveFile(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function downloadBackup(scope) {
  const b = await api('GET', `/api/backup?scope=${scope}`);
  saveFile(`vithai-backup-${scope === 'household' ? 'household' : S.me.name.replace(/\W+/g, '-').toLowerCase()}-${today()}.json`, new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }));
  toast('Backup downloaded');
  return b;
}
async function downloadExcel() {
  const [XLSX, b] = await Promise.all([waitForXLSX(), api('GET', '/api/backup?scope=me')]);
  const p = b.people[0];
  const wb = XLSX.utils.book_new();
  const tx = p.transactions.map((t) => ({ Date: t.trade_date, Month: t.month, Section: SLOTS[t.slot]?.label || t.slot, Asset: t.asset_name, 'Asset ID': t.asset_id, Units: t.units, Price: t.price, Amount: t.amount, Note: t.note || '' }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tx.length ? tx : [{ Date: 'No purchases recorded' }]), 'Purchases');
  const pl = p.plans.flatMap((m) => (m.lines || []).map((l) => ({ Month: m.month, Section: SLOTS[l.slot]?.label || l.slot, Asset: l.assetName, 'Asset ID': l.assetId, 'Planned ₹': l.amount })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pl.length ? pl : [{ Month: 'No plans saved' }]), 'Monthly plans');
  const al = Object.entries(p.settings?.alloc || {}).map(([k, v]) => ({ Section: SLOTS[k]?.label || k, 'Percent': v, 'Monthly ₹': Math.round((p.settings.monthlyTotal || 0) * v / 100) }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(al.length ? al : [{ Section: 'No setup saved' }]), 'Allocation');
  XLSX.writeFile(wb, `vithai-${S.me.name.replace(/\W+/g, '-').toLowerCase()}-${today()}.xlsx`);
  toast('Excel file downloaded');
}
function deleteDataModal(scope) {
  const hh = scope === 'household';
  openModal(`<h3>${hh ? 'Delete all household data' : 'Delete all my data'}</h3>
    <p>${hh ? 'This deletes every member\'s setup, plans and purchases, plus the household\'s imported data, column choices, fund edits and Nifty 50 prices. Members keep their sign-ins.' : 'This deletes your setup, monthly plans and every purchase you have recorded. You stay signed in and in your household.'}</p>
    <p class="note">Step 1: download a backup${hh ? ' of the whole household' : ' of your data'} to this device. Vithai also emails it to <b>${esc(S.me.email || 'you')}</b>${hh ? ' (the admin deleting it)' : ''} if email is set up for this site.</p>
    <button class="btn" id="dlbk">Download backup</button> <span id="dlok" class="note"></span>
    <p class="note" style="margin-top:14px">Step 2: type <b>DELETE</b> to confirm.</p>
    <input class="input" id="dconf" autocomplete="off" placeholder="DELETE">
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>Cancel</button><button class="btn danger" id="dgo" disabled>Delete permanently</button></div>`, (root, close) => {
    let downloaded = false;
    const upd = () => { root.querySelector('#dgo').disabled = !(downloaded && root.querySelector('#dconf').value.trim() === 'DELETE'); };
    root.querySelector('#dlbk').onclick = async () => {
      try { await downloadBackup(scope); downloaded = true; root.querySelector('#dlok').textContent = '✓ Saved. Check your Downloads folder before going on.'; upd(); } catch (e) { toast(e.message); }
    };
    root.querySelector('#dconf').oninput = upd;
    root.querySelector('#dgo').onclick = async () => {
      if (!confirm(`Last check: permanently delete ${hh ? 'all household data' : 'all your data'}?`)) return;
      try {
        const r = await api('POST', '/api/delete-data', { scope, confirm: 'DELETE', backupDownloaded: downloaded });
        close();
        openModal(`<h3>Deleted</h3><p>${hh ? 'All household data' : 'All your data'} has been deleted.</p><p class="note">${esc(r.emailNote || '')}</p><div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>OK</button></div>`);
        await loadData(); if (location.hash === '#/setup') route(); else location.hash = '#/setup';
      } catch (e) { toast(e.message); }
    };
  });
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
        ${mode === 'login' ? '<div><label class="f">Username or email</label><input class="input" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required></div>' : `
        <div><label class="f">Your name</label><input class="input" name="name" autocomplete="name" required></div>
        <div><label class="f">Username</label><input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,29}" title="3–30 letters, numbers, dot, dash or underscore"></div>
        <div><label class="f">Email <span class="muted">(optional)</span></label><input class="input" name="email" type="email" autocomplete="email"><p class="note" style="margin:4px 0 0">You can sign in with it too, and it's where backups are emailed. You can add it later.</p></div>`}
        <div><label class="f">Password${mode !== 'login' ? ' (8+ characters)' : ''}</label><input class="input" name="password" type="password" minlength="${mode === 'login' ? 1 : 8}" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></div>
        ${mode === 'create' ? '<div><label class="f">Household name</label><input class="input" name="householdName" placeholder="e.g. The Kumar family"><p class="note" style="margin:4px 0 0">New households are approved by the site admin before you can start.</p></div>' : ''}
        ${mode === 'join' ? '<div><label class="f">Household name or invite code</label><input class="input" name="join" required autocapitalize="none" placeholder="e.g. SKP-Home or K7Q2XM"><p class="note" style="margin:4px 0 0">Ask your household admin for either. They approve your request before you can start.</p></div>' : ''}
        <button class="btn primary">${mode === 'login' ? 'Sign in' : mode === 'create' ? 'Request a new household' : 'Request to join'}</button>
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
    <h2>Waiting for approval</h2>${S.me.householdStatus === 'pending'
    ? `<p>Your new household <b>${esc(S.me.householdName)}</b> has been sent to the site admin. You can start as soon as it's approved${S.me.email ? `; we'll email ${esc(S.me.email)}` : ''}.</p>`
    : S.me.householdStatus !== 'active' ? `<p>The household <b>${esc(S.me.householdName)}</b> is ${esc(S.me.householdStatus)}. Contact the site admin.</p>`
    : `<p>Your request to join <b>${esc(S.me.householdName)}</b> has been sent. The household admin needs to approve it before you can start.</p>`}
    <p class="note">Signed in as <b>${esc(S.me.username)}</b>.</p>
    <button class="btn" id="lo">Sign out</button></div></div></div>`;
  document.getElementById('lo').onclick = async () => { await api('POST', '/api/auth/logout'); location.reload(); };
}

boot().catch((e) => { app.innerHTML = `<div class="boot">Couldn't load Vithai: ${esc(e.message)}</div>`; });
