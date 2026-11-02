// Vithai metrics engine — pure functions, shared by the daily refresh script (Node) and the browser.
// NAV history format from mfapi.in: [{date:"dd-mm-yyyy", nav:"123.45"}, ...] newest first.

export const DAY = 86400000;
export const YEAR = 365.25 * DAY;

export function parseHistory(data) {
  const out = [];
  for (const d of data || []) {
    const [dd, mm, yy] = String(d.date).split('-').map(Number);
    const nav = parseFloat(d.nav);
    if (!yy || !(nav > 0)) continue;
    out.push([Date.UTC(yy, mm - 1, dd), nav]);
  }
  out.sort((a, b) => a[0] - b[0]);
  // drop duplicate dates
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0]);
}

// last NAV on or before time t (binary search); null if t is before history starts
export function navAt(series, t) {
  let lo = 0, hi = series.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans < 0 ? null : series[ans][1];
}

const round = (v, d = 4) => (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 10 ** d) / 10 ** d;

function cagr(series, years, end) {
  const start = end[0] - years * YEAR;
  if (series[0][0] > start + 7 * DAY) return null; // not enough history
  const s = navAt(series, start);
  return s ? (Math.pow(end[1] / s, 1 / years) - 1) * 100 : null;
}

function absRet(series, days, end) {
  const start = end[0] - days * DAY;
  if (series[0][0] > start + 3 * DAY) return null;
  const s = navAt(series, start);
  return s ? (end[1] / s - 1) * 100 : null;
}

export function dailyReturns(series, fromT) {
  const r = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i][0] < fromT) continue;
    r.push([series[i][0], series[i][1] / series[i - 1][1] - 1]);
  }
  return r;
}

function std(a) {
  if (a.length < 2) return null;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

function maxDrawdown(series, fromT) {
  let peak = 0, mdd = 0;
  for (const [t, v] of series) {
    if (t < fromT) continue;
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd * 100;
}

// Average and worst 3-year rolling CAGR, sampled every ~30 days over the last `lookbackYears`.
function rolling3y(series, end, lookbackYears = 7) {
  const first = Math.max(series[0][0] + 3 * YEAR, end[0] - lookbackYears * YEAR);
  if (first > end[0]) return { avg: null, min: null, n: 0 };
  const vals = [];
  for (let t = first; t <= end[0]; t += 30 * DAY) {
    const a = navAt(series, t - 3 * YEAR), b = navAt(series, t);
    if (a && b) vals.push((Math.pow(b / a, 1 / 3) - 1) * 100);
  }
  if (vals.length < 6) return { avg: null, min: null, n: vals.length };
  return { avg: vals.reduce((s, x) => s + x, 0) / vals.length, min: Math.min(...vals), n: vals.length };
}

/**
 * Compute every NAV-derived metric for one scheme.
 * @param {Array} series parsed history (ascending)
 * @param {number} rf risk-free rate in % (annual), used for Sharpe/Sortino
 */
export function computeMetrics(series, rf = 6.5) {
  if (!series || series.length < 30) return null;
  const end = series[series.length - 1];
  const ageYears = (end[0] - series[0][0]) / YEAR;
  const m = {
    nav: end[1], navDate: new Date(end[0]).toISOString().slice(0, 10),
    inception: new Date(series[0][0]).toISOString().slice(0, 10),
    ageYears: round(ageYears, 2),
    ret3m: round(absRet(series, 91, end), 2),
    ret6m: round(absRet(series, 182, end), 2),
    ret1y: round(absRet(series, 365, end), 2),
    cagr3: round(cagr(series, 3, end), 2),
    cagr5: round(cagr(series, 5, end), 2),
    cagr10: round(cagr(series, 10, end), 2),
    cagrInception: round((Math.pow(end[1] / series[0][1], 1 / Math.max(ageYears, 1 / 12)) - 1) * 100, 2),
  };
  // Risk over the last 3 years (or since inception if shorter, needs >= 1 year)
  const riskYears = Math.min(3, ageYears);
  if (riskYears >= 1) {
    const from = end[0] - riskYears * YEAR;
    const rets = dailyReturns(series, from).map(x => x[1]);
    const perYear = rets.length / riskYears; // observations per year (~245 trading days)
    const sd = std(rets);
    const vol = sd * Math.sqrt(perYear) * 100;
    const annRet = (Math.pow(end[1] / navAt(series, from), 1 / riskYears) - 1) * 100;
    const rfD = Math.pow(1 + rf / 100, 1 / perYear) - 1;
    const downside = Math.sqrt(rets.reduce((s, x) => s + Math.min(0, x - rfD) ** 2, 0) / rets.length) * Math.sqrt(perYear) * 100;
    m.volatility = round(vol, 2);
    m.sharpe = vol > 0 ? round((annRet - rf) / vol, 3) : null;
    m.sortino = downside > 0 ? round((annRet - rf) / downside, 3) : null;
    m.riskWindowYears = round(riskYears, 2);
  }
  m.maxDrawdown = round(maxDrawdown(series, end[0] - Math.min(5, ageYears) * YEAR), 2); // 5Y window
  m.maxDrawdownAll = round(maxDrawdown(series, 0), 2);
  const roll = rolling3y(series, end);
  m.rolling3Avg = round(roll.avg, 2);
  m.rolling3Min = round(roll.min, 2);
  const ath = Math.max(...series.map(p => p[1]));
  m.fromAth = round((1 - end[1] / ath) * 100, 2);
  return m;
}

/**
 * Tracking difference vs a peer benchmark (e.g. median of all gold ETFs): annualised
 * standard deviation of daily return differences over the last year.
 */
export function trackingError(series, benchDaily, years = 1) {
  const end = series[series.length - 1][0];
  const mine = new Map(dailyReturns(series, end - years * YEAR));
  const diffs = [];
  for (const [t, b] of benchDaily) if (mine.has(t)) diffs.push(mine.get(t) - b);
  const sd = std(diffs);
  return sd === null || diffs.length < 100 ? null : round(sd * Math.sqrt(diffs.length / years) * 100, 3);
}

// Median daily-return series across many schemes (aligned on date)
export function medianDaily(seriesList, years = 1) {
  const byDate = new Map();
  for (const s of seriesList) {
    if (!s || s.length < 2) continue;
    const end = s[s.length - 1][0];
    for (const [t, r] of dailyReturns(s, end - years * YEAR)) {
      if (!byDate.has(t)) byDate.set(t, []);
      byDate.get(t).push(r);
    }
  }
  const out = [];
  for (const [t, arr] of [...byDate.entries()].sort((a, b) => a[0] - b[0])) {
    if (arr.length < 3) continue;
    arr.sort((a, b) => a - b);
    out.push([t, arr[Math.floor(arr.length / 2)]]);
  }
  return out;
}
