// Indian and US stock dashboards, built from the Tickertape stock screener exports.
import { esc, num, toast, openModal } from './util.js';
import { rankRows } from './ranking.js';
import { loadDataset, companyKey } from './tickertape.js';

const LABEL = { in: 'Indian stocks', us: 'US stocks' };

// Lower-is-better guess for a metric from its name; you can flip it in the criteria panel
export function guessDir(label) {
  return /\b(pe|pb|ps|peg|ev|debt|volatility|beta|premium|pledge|days|away from|price ?\/|payout|cost of goods|drawdown)\b/i.test(label) ? 'asc' : 'desc';
}

// Default criteria (quality, growth, balance sheet and value). Each entry: [label patterns, weight, dir].
const DEFAULTS = [
  [[/^5Y Avg Return on Equity$/i, /^Return on Equity( %)?$/i], 1.5, 'desc'],
  [[/^ROCE( %)?$/i, /^Return on (Capital|Investment)/i], 1, 'desc'],
  [[/^5Y Historical Revenue Growth$/i, /Revenue Growth/i], 1, 'desc'],
  [[/^5Y Historical EPS Growth$/i, /EPS Growth/i, /Earnings Growth/i], 1, 'desc'],
  [[/^5Y Avg Net Profit Margin$/i, /^Net Profit Margin( %)?$/i], 0.5, 'desc'],
  [[/^Debt to Equity$/i, /Debt.{0,4}Equity/i], 1, 'asc'],
  [[/^PE Ratio$/i, /^PE Ratio/i], 0.5, 'asc'],
  [[/^1Y Return( %)?$/i, /1Y Return/i], 0.5, 'desc'],
];

function defaultCriteria(numCols) {
  const out = [];
  for (const [pats, w, dir] of DEFAULTS) {
    for (const re of pats) {
      const c = numCols.find((x) => re.test(x));
      if (c) { if (!out.some(([l]) => l === c)) out.push([c, w, dir]); break; }
    }
  }
  return out;
}

export async function renderStocks(main, mkt, ctx) {
  const { S, saveSettings } = ctx;
  main.innerHTML = `<div class="boot" style="height:200px">Loading ${LABEL[mkt]}…</div>`;
  let ds;
  try { ds = await loadDataset(mkt); } catch (e) {
    main.innerHTML = `<div class="page-head"><div><h2>${LABEL[mkt]}</h2></div></div>
      <div class="card"><h3>No ${LABEL[mkt]} data yet</h3><p class="sub">${esc(e.message)}</p>
      <a class="btn primary" href="#/data">Go to Data</a></div>`;
    return;
  }
  const cols = ds.columns.map((c) => c.label);
  const numCols = ds.columns.filter((c) => c.type === 'num').map((c) => c.label);
  const nameCol = cols[0];
  const sectorCol = cols.find((c) => /^(sub-?sector|sector|industry)$/i.test(c)) || cols[1];
  const tickerCol = cols.find((c) => /^(ticker|symbol)$/i.test(c));
  const mcapCol = numCols.find((c) => /^market cap/i.test(c));
  const priceCol = numCols.find((c) => /^(close price|ltp|last price|price)( \(.*\))?$/i.test(c));
  const niftyKeys = new Set((S.nifty || []).map((n) => companyKey(n.name)));
  const niftySymbols = new Set((S.nifty || []).map((n) => n.symbol));

  const saved = S.settings.stockCriteria?.[mkt] || {};
  const cfg = {
    criteria: (saved.criteria || defaultCriteria(numCols)).filter(([l]) => numCols.includes(l)),
    topN: saved.topN ?? 500,
    sectors: saved.sectors || [],
  };
  const sectors = [...new Set(ds.objects.map((o) => o[sectorCol]).filter(Boolean))].sort();
  let search = '', showAll = false, sort = { key: 'rank', dir: 1 }, critFilter = '';

  const universe = () => {
    let rows = ds.objects;
    if (cfg.sectors.length) rows = rows.filter((o) => cfg.sectors.includes(o[sectorCol]));
    if (mcapCol && cfg.topN > 0) rows = [...rows].sort((a, b) => (b[mcapCol] ?? -1) - (a[mcapCol] ?? -1)).slice(0, cfg.topN);
    return rows;
  };

  main.innerHTML = `
    <div class="page-head"><div><h2>${LABEL[mkt]}</h2><p>${num(ds.rows.length, 0)} stocks · ${ds.columns.length} columns · Tickertape data loaded ${esc(new Date(ds.meta.uploadedAt || ds.builtAt).toLocaleDateString('en-GB', { dateStyle: 'medium' }))}</p></div>
      <div class="grow"></div><a class="btn" href="#/data">Load newer data</a></div>
    ${mkt === 'us' ? basketBox() : ''}
    <div class="funds-layout">
      <div class="card criteria" id="scrit"></div>
      <div>
        <div class="toolbar"><input class="input search" id="ssearch" placeholder="Search company…">
          <label class="toggle"><input type="checkbox" id="sall">Show all rows</label><span class="note" id="scount"></span></div>
        <div class="tablewrap" style="max-height:72vh"><table class="t" id="stable"></table></div>
        <p class="note">Data from your Tickertape export. Scores compare each stock's percentile on the ticked metrics within the universe you set. Not investment advice.</p>
      </div>
    </div>`;

  function basketBox() {
    const b = S.settings.usBasket || [];
    return `<div class="pick-box" id="basketbox"><div><b>Your US basket</b> ${b.length ? b.map((x) => `<span class="chip">${esc(x.name)}<button data-rm="${esc(x.key)}" aria-label="Remove">×</button></span>`).join('') : '<span>Empty. Use "Add" on a stock to include it in your monthly US stocks slot.</span>'}</div>
      ${S.settings.usSlot ? '' : '<span class="note">Turn on the US stocks slot in Setup to invest in this basket each month.</span>'}</div>`;
  }
  function wireBasket() {
    document.querySelectorAll('#basketbox [data-rm]').forEach((b) => (b.onclick = async () => {
      await saveSettings({ usBasket: (S.settings.usBasket || []).filter((x) => x.key !== b.dataset.rm) }, 'Removed from basket');
      document.getElementById('basketbox').outerHTML = basketBox(); wireBasket(); drawTable();
    }));
  }
  if (mkt === 'us') wireBasket();

  function drawCriteria() {
    const panel = document.getElementById('scrit');
    const active = new Map(cfg.criteria.map(([l, w, d]) => [l, { w, d }]));
    const listed = [...cfg.criteria.map(([l]) => l), ...numCols.filter((c) => !active.has(c))]
      .filter((c) => !critFilter || c.toLowerCase().includes(critFilter.toLowerCase()));
    panel.innerHTML = `<h3>Ranking criteria</h3><p class="sub">Tick metrics, set weights, and flip ↑/↓ if the direction is wrong for a metric.</p>
      <div class="row">${mcapCol ? `<div><label class="f">Universe: top N by market cap</label><input class="input num" id="topn" type="number" min="0" step="50" value="${cfg.topN}"><span class="note">0 = all stocks</span></div>` : ''}</div>
      <div style="margin-top:10px"><label class="f">Sectors (${cfg.sectors.length || 'all'})</label><select class="input" id="secsel"><option value="">Add a sector filter…</option>${sectors.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
        <div style="margin-top:6px">${cfg.sectors.map((s, i) => `<span class="chip">${esc(s)}<button data-sec="${i}">×</button></span>`).join('')}</div></div>
      <div class="crit-group">Metrics (${cfg.criteria.length} selected of ${numCols.length})</div>
      <input class="input" id="critq" placeholder="Find a metric…" value="${esc(critFilter)}" style="margin-bottom:6px">
      <div id="critlist">${listed.map((c) => { const a = active.get(c); const d = a?.d || guessDir(c); return `
        <div class="crit"><input type="checkbox" data-k="${esc(c)}" ${a ? 'checked' : ''}>
          <label title="${esc(c)}">${esc(c)} <button class="btn small ghost" data-dir="${esc(c)}" style="padding:0 5px" title="Flip direction">${d === 'asc' ? '↓ better' : '↑ better'}</button></label>
          <input class="w" type="number" min="0" step="0.5" data-w="${esc(c)}" value="${a?.w ?? 1}"></div>`; }).join('')}</div>
      <div class="row" style="margin-top:14px"><button class="btn primary" id="ssave">Save criteria</button><button class="btn" id="sreset">Reset to default</button></div>`;
    const dirs = new Map(listed.map((c) => [c, active.get(c)?.d || guessDir(c)]));
    const collect = () => {
      const criteria = [];
      panel.querySelectorAll('#critlist input[type=checkbox]').forEach((c) => {
        const k = c.dataset.k;
        if (c.checked) criteria.push([k, Number(panel.querySelector(`[data-w="${CSS.escape(k)}"]`).value) || 0, dirs.get(k)]);
      });
      // keep selected metrics hidden by the metric search
      for (const [l, w, d] of cfg.criteria) if (!listed.includes(l)) criteria.push([l, w, d]);
      cfg.criteria = criteria;
      const t = document.getElementById('topn'); if (t) cfg.topN = Number(t.value) || 0;
    };
    panel.querySelectorAll('#critlist input, #topn').forEach((i) => (i.onchange = () => { collect(); drawTable(); }));
    panel.querySelectorAll('[data-dir]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.dir; dirs.set(k, dirs.get(k) === 'asc' ? 'desc' : 'asc');
      b.textContent = dirs.get(k) === 'asc' ? '↓ better' : '↑ better'; collect(); drawTable();
    }));
    document.getElementById('critq').oninput = (e) => { collect(); critFilter = e.target.value; drawCriteria(); document.getElementById('critq').focus(); };
    document.getElementById('secsel').onchange = (e) => { if (e.target.value && !cfg.sectors.includes(e.target.value)) cfg.sectors.push(e.target.value); drawCriteria(); drawTable(); };
    panel.querySelectorAll('[data-sec]').forEach((b) => (b.onclick = () => { cfg.sectors.splice(+b.dataset.sec, 1); drawCriteria(); drawTable(); }));
    document.getElementById('ssave').onclick = async () => { collect(); await saveSettings({ stockCriteria: { ...S.settings.stockCriteria, [mkt]: { criteria: cfg.criteria, topN: cfg.topN, sectors: cfg.sectors } } }, 'Criteria saved'); };
    document.getElementById('sreset').onclick = async () => {
      const sc = { ...S.settings.stockCriteria }; delete sc[mkt];
      await saveSettings({ stockCriteria: sc }, 'Back to the default criteria');
      cfg.criteria = defaultCriteria(numCols); cfg.topN = 500; cfg.sectors = []; drawCriteria(); drawTable();
    };
  }

  function drawTable() {
    const ranked = rankRows(universe(), cfg.criteria);
    const q = search.toLowerCase();
    let list = ranked.filter((o) => !q || String(o[nameCol]).toLowerCase().includes(q) || String(o[sectorCol] || '').toLowerCase().includes(q) || (tickerCol && String(o[tickerCol] || '').toLowerCase().includes(q)));
    if (sort.key !== 'rank') list = [...list].sort((a, b) => ((a[sort.key] ?? -Infinity) > (b[sort.key] ?? -Infinity) ? 1 : -1) * sort.dir);
    else if (sort.dir < 0) list = [...list].reverse();
    document.getElementById('scount').textContent = `${num(ranked.length, 0)} stocks ranked`;
    const shown = showAll ? list : list.slice(0, 200);
    const extra = [mcapCol, priceCol, ...cfg.criteria.map(([l]) => l)].filter((c, i, a) => c && a.indexOf(c) === i).slice(0, 12);
    const basketKeys = new Set((S.settings.usBasket || []).map((x) => x.key));
    const t = document.getElementById('stable');
    t.innerHTML = `<thead><tr><th class="sortable r" data-k="rank">#</th><th class="sortable" data-k="${esc(nameCol)}">${esc(nameCol)}</th><th class="sortable r" data-k="score">Score</th>
      ${extra.map((c) => `<th class="sortable r" data-k="${esc(c)}" title="${esc(c)}">${esc(c.length > 18 ? c.slice(0, 17) + '…' : c)}${sort.key === c ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}${mkt === 'us' ? '<th></th>' : ''}</tr></thead>
      <tbody>${shown.map((o) => `<tr class="${o.rank === 1 ? 'top' : ''}" data-key="${esc(o.__key)}">
        <td class="r"><span class="rank">${o.rank}</span></td>
        <td class="nm">${esc(o[nameCol])}${mkt === 'in' && ((tickerCol && niftySymbols.has(String(o[tickerCol]))) || niftyKeys.has(companyKey(o[nameCol]))) ? ' <span class="badge good">Nifty 50</span>' : ''}${basketKeys.has(o.__key) ? ' <span class="badge good">in basket</span>' : ''}<span class="a">${tickerCol ? esc(o[tickerCol] || '') + ' · ' : ''}${esc(o[sectorCol] || '')}</span></td>
        <td class="r">${o.score === null ? '–' : num(o.score, 1)}<span class="score-bar"><i style="width:${o.score || 0}%"></i></span></td>
        ${extra.map((c) => `<td class="r">${num(o[c], Math.abs(o[c]) >= 1000 ? 0 : 2)}</td>`).join('')}
        ${mkt === 'us' ? `<td>${basketKeys.has(o.__key) ? '' : `<button class="btn small" data-add="${esc(o.__key)}">Add</button>`}</td>` : ''}</tr>`).join('') || '<tr><td colspan="20" class="muted">No stocks match.</td></tr>'}</tbody>`;
    t.querySelectorAll('th.sortable').forEach((th) => (th.onclick = () => {
      const k = th.dataset.k;
      sort = sort.key === k ? { key: k, dir: -sort.dir } : { key: k, dir: k === 'rank' || k === nameCol || guessDir(k) === 'asc' ? 1 : -1 };
      drawTable();
    }));
    t.querySelectorAll('tbody tr[data-key]').forEach((tr) => (tr.onclick = () => detail(ranked.find((o) => o.__key === tr.dataset.key))));
    t.querySelectorAll('[data-add]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const o = ds.objects.find((x) => x.__key === b.dataset.add);
      await saveSettings({ usBasket: [...(S.settings.usBasket || []), { key: o.__key, name: String(o[nameCol]), weight: 1 }] }, `${o[nameCol]} added to your US basket`);
      document.getElementById('basketbox').outerHTML = basketBox(); wireBasket(); drawTable();
    }));
  }

  function detail(o) {
    if (!o) return;
    openModal(`<h3>${esc(o[nameCol])}</h3><p class="note">${esc(o[sectorCol] || '')}${o.score !== undefined ? ` · score ${num(o.score, 1)} · rank ${o.rank}` : ''}</p>
      <input class="input" id="dq" placeholder="Filter fields…" style="margin-bottom:10px">
      <div class="kv" id="dkv">${cols.slice(2).map((c) => `<div data-f="${esc(c.toLowerCase())}">${esc(c)}</div><div data-f="${esc(c.toLowerCase())}">${typeof o[c] === 'number' ? num(o[c], 2) : esc(o[c] ?? '–')}</div>`).join('')}</div>
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn" data-close>Close</button></div>`, (root) => {
      root.querySelector('#dq').oninput = (e) => { const q = e.target.value.toLowerCase(); root.querySelectorAll('#dkv [data-f]').forEach((d) => { d.style.display = !q || d.dataset.f.includes(q) ? '' : 'none'; }); };
    });
  }

  document.getElementById('ssearch').oninput = (e) => { search = e.target.value; drawTable(); };
  document.getElementById('sall').onchange = (e) => { showAll = e.target.checked; drawTable(); };
  drawCriteria();
  drawTable();
}

// Latest US price for a basket key (used by the plan and portfolio)
export function usPriceLookup(ds) {
  if (!ds) return () => null;
  const priceCol = ds.columns.find((c) => c.type === 'num' && /^(close price|ltp|last price|price)( \(.*\))?$/i.test(c.label))?.label;
  const map = new Map(ds.objects.map((o) => [o.__key, priceCol ? o[priceCol] : null]));
  return (key) => map.get(key) ?? null;
}
