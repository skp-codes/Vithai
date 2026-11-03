// Vithai ranking — composite score from percentile ranks of the chosen metrics.
// Missing values are skipped (never treated as "best"), and each fund's score is the
// weighted average over the metrics it actually has.

export const METRICS = {
  ret3m: { label: 'Return 3M %', dir: 'desc', group: 'Returns' },
  ret6m: { label: 'Return 6M %', dir: 'desc', group: 'Returns' },
  ret1y: { label: 'Return 1Y %', dir: 'desc', group: 'Returns' },
  cagr3: { label: 'CAGR 3Y %', dir: 'desc', group: 'Returns' },
  cagr5: { label: 'CAGR 5Y %', dir: 'desc', group: 'Returns' },
  cagr10: { label: 'CAGR 10Y %', dir: 'desc', group: 'Returns' },
  rolling3Avg: { label: '3Y rolling avg %', dir: 'desc', group: 'Returns' },
  rolling3Min: { label: '3Y rolling worst %', dir: 'desc', group: 'Returns' },
  sharpe: { label: 'Sharpe (3Y)', dir: 'desc', group: 'Risk-adjusted' },
  sortino: { label: 'Sortino (3Y)', dir: 'desc', group: 'Risk-adjusted' },
  volatility: { label: 'Volatility (3Y) %', dir: 'asc', group: 'Risk' },
  maxDrawdown: { label: 'Max drawdown (5Y) %', dir: 'asc', group: 'Risk' },
  trackingError: { label: 'Tracking error %', dir: 'asc', group: 'Risk' },
  fromAth: { label: '% below all-time high', dir: 'asc', group: 'Risk' },
  expenseRatio: { label: 'Expense ratio %', dir: 'asc', group: 'Cost & size' },
  exitLoad: { label: 'Exit load %', dir: 'asc', group: 'Cost & size' },
  aum: { label: 'AUM (₹ Cr)', dir: 'desc', group: 'Cost & size' },
  ageYears: { label: 'Age (years)', dir: 'desc', group: 'Cost & size' },
  alpha: { label: 'Alpha (Tickertape)', dir: 'desc', group: 'Tickertape' },
  peRatio: { label: 'PE ratio (Tickertape)', dir: 'asc', group: 'Tickertape' },
  ytm: { label: 'YTM % (Tickertape)', dir: 'desc', group: 'Tickertape' },
};

export const SLOTS = {
  largecap: { label: 'Large cap', short: 'Large cap', kind: 'mf' },
  midsmall: { label: 'Mid / small cap', short: 'Mid/small', kind: 'mf' },
  debt: { label: 'Debt', short: 'Debt', kind: 'mf' },
  international: { label: 'International', short: 'International', kind: 'mf' },
  gold: { label: 'Gold', short: 'Gold', kind: 'etf' },
  nifty50: { label: 'Nifty 50 stocks', short: 'Nifty 50', kind: 'stocks' },
  usstocks: { label: 'US stocks', short: 'US stocks', kind: 'us' },
};

// Default criteria — the same factors used for the October/November recommendations:
// long-term returns, risk-adjusted returns, drawdown and cost.
export const DEFAULT_CRITERIA = {
  largecap: { minAge: 5, sub: [], criteria: [
    ['cagr5', 1.5], ['cagr10', 1], ['cagr3', 1], ['rolling3Avg', 1],
    ['sharpe', 1.5], ['sortino', 1], ['maxDrawdown', 1], ['expenseRatio', 1]] },
  midsmall: { minAge: 5, sub: ['Mid Cap'], criteria: [
    ['cagr5', 1.5], ['cagr10', 1], ['cagr3', 1], ['rolling3Avg', 1],
    ['sharpe', 1.5], ['sortino', 1], ['maxDrawdown', 1], ['expenseRatio', 1]] },
  debt: { minAge: 5, sub: ['Corporate Bond'], criteria: [
    ['cagr3', 1.5], ['cagr5', 1], ['ret1y', 0.5], ['sharpe', 1.5],
    ['maxDrawdown', 1], ['volatility', 0.5], ['expenseRatio', 1.5]] },
  international: { minAge: 3, sub: [], criteria: [
    ['cagr3', 1.5], ['cagr5', 1], ['sharpe', 1.5], ['sortino', 1],
    ['maxDrawdown', 1], ['expenseRatio', 1]] },
  gold: { minAge: 3, sub: [], criteria: [
    ['expenseRatio', 2], ['trackingError', 2], ['aum', 1], ['cagr3', 0.5]] },
};

function percentiles(values, dir) {
  // returns Map index -> percentile in [0,1], 1 = best; ties share the average position
  const present = values.map((v, i) => [v, i]).filter(([v]) => typeof v === 'number' && isFinite(v));
  const out = new Map();
  if (!present.length) return out;
  present.sort((a, b) => dir === 'asc' ? a[0] - b[0] : b[0] - a[0]);
  const n = present.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && present[j + 1][0] === present[i][0]) j++;
    const pos = (i + j) / 2; // 0 = best
    const pct = n === 1 ? 1 : 1 - pos / (n - 1);
    for (let k = i; k <= j; k++) out.set(present[k][1], pct);
    i = j + 1;
  }
  return out;
}

/**
 * Generic ranking. criteria = [[key, weight, dir]] where dir is 'asc' (lower is better) or 'desc'.
 * Returns new row objects with score (0-100), coverage (share of criteria weight with data) and rank.
 */
export function rankRows(rows, criteria) {
  const active = criteria.filter(([, w]) => w > 0);
  const pcts = active.map(([k, , dir]) => percentiles(rows.map((f) => f[k]), dir || 'desc'));
  const totalW = active.reduce((s, [, w]) => s + w, 0);
  const out = rows.map((f, i) => {
    let s = 0, w = 0;
    active.forEach(([, wt], j) => { const p = pcts[j].get(i); if (p !== undefined) { s += p * wt; w += wt; } });
    return { ...f, score: w ? Math.round((s / w) * 1000) / 10 : null, coverage: totalW ? w / totalW : 0 };
  });
  // Rows missing more than half the criteria weight rank below those with fuller data
  out.sort((a, b) => (b.coverage >= 0.5) - (a.coverage >= 0.5) || (b.score ?? -1) - (a.score ?? -1));
  out.forEach((r, i) => { r.rank = i + 1; });
  return out;
}

/**
 * @param {Array<object>} funds rows with metric fields
 * @param {Array<[string, number]>} criteria [[metricKey, weight], ...]
 */
export function rankFunds(funds, criteria, extra = {}) {
  const all = { ...METRICS, ...extra };
  // A criterion is [key, weight] or [key, weight, direction]; the direction overrides the metric's default
  return rankRows(funds, criteria.filter(([k]) => all[k]).map(([k, w, d]) => [k, w, d || all[k].dir]));
}
