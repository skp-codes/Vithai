// Metric picker: the metrics you score on are shown as compact rows (direction, weight, remove);
// everything else lives in a searchable, grouped pop-up opened with "+ Add metrics".
import { esc } from './util.js';

// Rough grouping for long, flat column lists (Tickertape exports), by keywords in the name
const GROUPS = [
  ['Returns', /return|cagr|\bchg\b|change|perf|\b1y\b|\b3y\b|\b5y\b|\b1m\b|\b6m\b|ytd|alpha/i],
  ['Valuation', /\bp\/?e\b|\bpe\b|p\/?b\b|\bpb\b|ev\b|ev\/|price to|valuation|peg|earnings yield|p\/s|\bps\b|fcf yield|graham|intrinsic/i],
  ['Profitability', /roe|roce|roa|roic|margin|profit|ebitda|ebit\b|\beps\b|net income/i],
  ['Growth', /growth|cagr.*(revenue|sales|profit|eps)/i],
  ['Financial health', /debt|leverage|current ratio|quick ratio|interest cov|solvency|cash|liquid|piotroski|altman|working capital/i],
  ['Ownership', /holding|promoter|\bfii\b|\bdii\b|\bmf\b|institution|pledge|shareholding/i],
  ['Dividends', /dividend|payout|yield/i],
  ['Risk & technicals', /beta|volatil|sharpe|sortino|drawdown|rsi|sma|ema|macd|52w|52 w|high|low|momentum|std|tracking/i],
  ['Size & trading', /market cap|mcap|volume|turnover|aum|size|shares outstanding|float|price|nav/i],
  ['Costs', /expense|exit load|ter\b/i],
];
let expanded = false; // remembered for the session, across pages
export const guessGroup = (label) => (GROUPS.find(([, re]) => re.test(label)) || ['Other'])[0];

/**
 * @param {HTMLElement} host
 * @param {object} o
 *   items: [{ key, label, group }]
 *   selected: [{ key, w, d }]        d = 'asc' (lower is better) | 'desc' (higher is better)
 *   dirOf(key)                        default direction for a newly added metric
 *   cover(key)                        share of rows (0..1) that have the metric, or null to hide
 *   onChange(selected)
 */
export function metricPicker(host, o) {
  let sel = o.selected.map((x) => ({ ...x }));
  const byKey = new Map(o.items.map((i) => [i.key, i]));
  const order = [];
  for (const i of o.items) if (!order.includes(i.group)) order.push(i.group);
  let open = false, query = '';

  host.classList.add('mpick');
  host.innerHTML = `<div class="mp-head"><span><b>${sel.length}</b> of ${o.items.length} metrics in the score</span>
      <span class="mp-acts"><button type="button" class="btn small" data-mp="toggle" aria-expanded="false"></button><button type="button" class="btn small primary" data-mp="open">+ Add</button></span></div>
    <button type="button" class="mp-summary" data-mp="sum" title="Show and edit the metrics"></button>
    <div class="mp-pop" hidden>
      <div class="mp-popbar"><input class="input" placeholder="Search ${o.items.length} metrics…" data-mp="q"><button type="button" class="btn small" data-mp="close">Done</button></div>
      <div class="mp-list"></div></div>
    <div class="mp-rows"></div>
    <div class="mp-foot"><button type="button" class="btn small ghost danger" data-mp="clear" title="Remove every metric from the score">Clear all metrics</button></div>`;
  const rowsEl = host.querySelector('.mp-rows'), pop = host.querySelector('.mp-pop'), listEl = host.querySelector('.mp-list'), qEl = host.querySelector('[data-mp=q]');
  const clearBtn = host.querySelector('[data-mp=clear]');
  const emit = () => { host.querySelector('.mp-head b').textContent = sel.length; clearBtn.hidden = !sel.length; o.onChange(sel.map((x) => ({ ...x }))); };

  const toggleBtn = host.querySelector('[data-mp=toggle]'), sumEl = host.querySelector('[data-mp=sum]');
  const label = (k) => byKey.get(k)?.label || k;
  const drawState = () => {
    host.classList.toggle('collapsed', !expanded);
    toggleBtn.textContent = expanded ? 'Hide ▴' : 'Edit ▾';
    toggleBtn.setAttribute('aria-expanded', String(expanded));
    const names = sel.map((x) => label(x.key));
    sumEl.innerHTML = names.length ? `${names.slice(0, 4).map((n) => `<span>${esc(n)}</span>`).join('')}${names.length > 4 ? `<span class="more">+${names.length - 4} more</span>` : ''}` : '<span class="more">None yet. Use + Add to choose metrics.</span>';
  };
  toggleBtn.onclick = () => { expanded = !expanded; drawState(); };
  sumEl.onclick = () => { expanded = true; drawState(); };
  const drawRows = () => {
    drawState();
    rowsEl.innerHTML = sel.length ? sel.map((x, i) => {
      const it = byKey.get(x.key); const c = o.cover?.(x.key);
      return `<div class="mp-row" data-i="${i}">
        <div class="mp-name" title="${esc(it?.label || x.key)}">${esc(it?.label || x.key)}
          ${c === null || c === undefined ? '' : c === 0 ? '<small class="warn">no data here, not scoring</small>' : `<small>${Math.round(c * 100)}% have it</small>`}</div>
        <button type="button" class="dirchip ${x.d === 'asc' ? 'low' : 'high'}" data-dir="${i}" title="Click to flip: is a higher or lower value better?">${x.d === 'asc' ? '↓ lower' : '↑ higher'}</button>
        <label class="mp-w" title="Weight">×<input type="number" min="0" step="0.5" value="${x.w}" data-w="${i}" aria-label="Weight"></label>
        <button type="button" class="mp-x" data-rm="${i}" title="Remove from the score" aria-label="Remove">×</button></div>`;
    }).join('') : '<div class="mp-empty">No metrics yet. Use <b>+ Add metrics</b> to choose what the ranking scores on.</div>';
    rowsEl.querySelectorAll('[data-dir]').forEach((b) => (b.onclick = () => { const x = sel[+b.dataset.dir]; x.d = x.d === 'asc' ? 'desc' : 'asc'; drawRows(); emit(); }));
    rowsEl.querySelectorAll('[data-w]').forEach((i) => (i.onchange = () => { sel[+i.dataset.w].w = Math.max(0, Number(i.value) || 0); emit(); }));
    rowsEl.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { sel.splice(+b.dataset.rm, 1); drawRows(); if (open) drawList(); emit(); }));
  };

  const drawList = () => {
    const q = query.trim().toLowerCase();
    const on = new Set(sel.map((x) => x.key));
    const groups = order.map((g) => [g, o.items.filter((i) => i.group === g && (!q || i.label.toLowerCase().includes(q)))]).filter(([, l]) => l.length);
    listEl.innerHTML = groups.length ? groups.map(([g, l]) => `<div class="mp-g">${esc(g)} <span>${l.length}</span></div>${l.map((i) => `
      <button type="button" class="mp-item ${on.has(i.key) ? 'on' : ''}" data-k="${esc(i.key)}"><span class="mp-box">${on.has(i.key) ? '✓' : '+'}</span><span>${esc(i.label)}</span></button>`).join('')}`).join('')
      : `<div class="mp-empty">No metric matches "${esc(query)}".</div>`;
    listEl.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.k, at = sel.findIndex((x) => x.key === k);
      if (at >= 0) sel.splice(at, 1); else sel.push({ key: k, w: 1, d: o.dirOf(k) });
      b.classList.toggle('on', at < 0); b.querySelector('.mp-box').textContent = at < 0 ? '✓' : '+';
      drawRows(); emit();
    }));
  };

  const outside = (e) => { if (open && !host.contains(e.target)) setOpen(false); };
  const esc_ = (e) => { if (e.key === 'Escape' && open) setOpen(false); };
  const setOpen = (v) => {
    open = v; pop.hidden = !v;
    if (v) { drawList(); qEl.focus(); document.addEventListener('mousedown', outside); document.addEventListener('keydown', esc_); }
    else { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc_); }
  };
  host.querySelector('[data-mp=open]').onclick = () => { if (!open) { expanded = true; drawState(); } setOpen(!open); };
  host.querySelector('[data-mp=close]').onclick = () => setOpen(false);
  clearBtn.hidden = !sel.length;
  clearBtn.onclick = () => { if (!confirm(`Remove all ${sel.length} metrics from the score? You can add them back, or switch the Filter back to one you've saved.`)) return; sel = []; drawRows(); if (open) drawList(); emit(); };
  qEl.oninput = () => { query = qEl.value; drawList(); };
  drawRows();
  return { refresh: drawRows };
}
