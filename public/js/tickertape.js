// Reading Tickertape screener exports in the browser: detect what each file is, stitch the
// 45-column parts back together, and store/load the result as a compressed dataset.
import { api, waitForXLSX } from './util.js';

export const KINDS = { mf: 'Mutual funds', in: 'Indian stocks', us: 'US stocks' };

// Read one CSV/XLSX file into { name, header, rows (array of objects), guess }
export async function readExport(file) {
  const XLSX = await waitForXLSX();
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', raw: false });
  const sheet = wb.Sheets[wb.SheetNames.find((n) => /overall/i.test(n)) || wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const header = rows.length ? Object.keys(rows[0]) : [];
  return { name: file.name, header, rows, guess: guessKind(file.name, header) };
}

export function guessKind(fileName, header) {
  const f = fileName.toLowerCase();
  if (/vithai-mf|mutual_?fund/.test(f)) return 'mf';
  if (/vithai-us|us_stocks|us-stocks/.test(f)) return 'us';
  if (/vithai-in|stocks?_screener|equity/.test(f)) return 'in';
  const h = header.map((x) => x.trim().toLowerCase());
  if (h.includes('sub category') || h.includes('amc')) return 'mf';
  if (h.some((x) => /\(usd|\$/.test(x))) return 'us';
  return 'in';
}

const keyOf = (row, header) => `${String(row[header[0]] ?? '').trim()}|${String(row[header[1]] ?? '').trim()}`;

// Tickertape's US export uses raw field names and formulas; these are readable labels for them
export const US_LABELS = {
 "name": "Name",
 "ticker": "Ticker",
 "industry": "Industry",
 "marketCapitalizationMln": "Market Cap ($ mn)",
 "prevClosePrice": "Close Price ($)",
 "priceEarningsTtm": "PE Ratio (TTM)",
 "1MReturn,100,*": "1M Return %",
 "1DReturn,100,*": "1D Return %",
 "returnOnEquityTtm,100,*": "Return on Equity %",
 "priceBook": "PB Ratio",
 "week52Low": "52W Low ($)",
 "week52High": "52W High ($)",
 "week52High,prevClosePrice,-,week52High,/,100,*": "% Below 52W High",
 "prevClosePrice,week52Low,-,week52Low,/,100,*": "% Above 52W Low",
 "maxReturn,100,*": "Return Since Listing %",
 "1WReturn,100,*": "1W Return %",
 "3MReturn,100,*": "3M Return %",
 "1YReturn,100,*": "1Y Return %",
 "5YReturn,100,*": "5Y Return %",
 "5YCAGR,100,*": "5Y CAGR %",
 "6MReturn,100,*": "6M Return %",
 "totalRevenue,costOfRevenue,-,totalRevenue,/,100,*": "Gross Margin %",
 "ebitda,totalRevenue,/,100,*": "EBITDA Margin %",
 "profitMarginPercent,100,*": "Net Profit Margin %",
 "returnOnAssetsTtm,100,*": "Return on Assets %",
 "operatingMarginTtm,100,*": "Operating Margin %",
 "freeCashFlow,totalRevenue,/,100,*": "Free Cash Flow Margin %",
 "ebitda,totalStockholderEquity,totalLiabilities,+,totalCurrentLiabilities,-,/,100,*": "ROCE %",
 "totalCurrentAssets,totalCurrentLiabilities,/": "Current Ratio",
 "totalCurrentAssets,inventory,-,totalCurrentLiabilities,/": "Quick Ratio",
 "longTermDebt,totalStockholderEquity,/": "Long Term Debt to Equity",
 "totalDebt,totalStockholderEquity,/": "Debt to Equity",
 "epsEstimateNextYear,earningsPerShareTtm,-,earningsPerShareTtm,/,100,*": "1Y Forward EPS Growth %",
 "quarterlyRevenueGrowthYoy,100,*": "Quarterly Revenue Growth YoY %",
 "quarterlyEarningsGrowthYoy,100,*": "Quarterly Earnings Growth YoY %",
 "revenueEstimateAvg,totalRevenue,-,totalRevenue,/,100,*": "1Y Forward Revenue Growth %",
 "forecastEpsGrowthPercent": "Forecast EPS Growth %",
 "priceEarningsGrowth": "PEG Ratio",
 "priceEarnings": "PE Ratio",
 "forwardPriceEarnings": "Forward PE Ratio",
 "priceSales": "PS Ratio",
 "evEbitda": "EV/EBITDA",
 "evRevenue": "EV/Revenue",
 "enterpriseValue": "Enterprise Value ($)",
 "expenseRatio,100,*": "Expense Ratio % (ETFs)",
 "marketCapUsd,freeCashFlow,/": "Price / Free Cash Flow",
 "totalAssets": "Total Assets ($)",
 "totalAssets,1,*": "Total Assets ($)",
 "analystTrackingCount": "Analysts Covering",
 "analystBuyPercent": "Analyst Buy %",
 "analystSellPercent": "Analyst Sell %",
 "analystHoldPercent": "Analyst Hold %",
 "analystBuyCount": "Analyst Buy Count",
 "analystTargetPrice,prevClosePrice,-,prevClosePrice,/,100,*": "Analyst Target Upside %",
 "percentInsiders": "Insider Holding %",
 "percentInstitutions": "Institutional Holding %",
 "beta": "Beta",
 "movingAverage50Day": "50D Moving Average ($)",
 "movingAverage200Day": "200D Moving Average ($)",
 "revenuePerShare": "Revenue per Share ($)",
 "totalRevenue": "Total Revenue ($)",
 "costOfRevenue": "Cost of Revenue ($)",
 "grossProfit": "Gross Profit ($)",
 "ebitda": "EBITDA ($)",
 "incomeBeforeTax": "Income Before Tax ($)",
 "netIncome": "Net Income ($)",
 "earningsPerShareTtm": "EPS TTM ($)",
 "dilutedEpsTTM": "Diluted EPS TTM ($)",
 "freeCashFlow": "Free Cash Flow ($)",
 "totalLiabilities": "Total Liabilities ($)",
 "dividendPerShare": "Dividend per Share ($)",
 "dividendYieldPercent": "Dividend Yield %",
 "payoutRatio,100,*": "Payout Ratio %",
 "fwdDivRate": "Forward Dividend ($)",
 "fwdDivYieldPercent": "Forward Dividend Yield %"
};

// Merge part files of the same kind on Name + second column (sub-category / sub-sector)
export function mergeParts(files) {
  const columns = [];
  const byKey = new Map();
  for (const f of files) {
    for (const c of f.header) if (!columns.includes(c)) columns.push(c);
    for (const r of f.rows) {
      const k = keyOf(r, f.header);
      if (!k.replace('|', '')) continue;
      byKey.set(k, { ...(byKey.get(k) || {}), ...r });
    }
  }
  return { columns, rows: [...byKey.values()] };
}

const toNum = (v) => {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === '-' || s === '—') return null;
  const n = Number(s.replace(/[,₹$%\s]/g, ''));
  return isFinite(n) ? n : null;
};

// Columnar, compact form: numeric columns stored as numbers, the rest as text
export function toDataset(kind, merged, fileNames) {
  if (kind === 'us') {
    // rename raw US fields; drop exact duplicates that map to the same label
    const seen = new Set();
    merged = { ...merged, columns: merged.columns.filter((c) => { const l = US_LABELS[c.trim()] || c; if (seen.has(l)) return false; seen.add(l); return true; }) };
  }
  const cols = merged.columns.map((label) => {
    const vals = merged.rows.map((r) => r[label]).filter((v) => v !== null && v !== '' && v !== '-');
    const numeric = vals.length > 0 && vals.filter((v) => toNum(v) !== null).length / vals.length > 0.9;
    return { label: (kind === 'us' && US_LABELS[label.trim()]) || label.trim(), type: numeric ? 'num' : 'text' };
  });
  const rows = merged.rows.map((r) => merged.columns.map((c, i) => (cols[i].type === 'num' ? toNum(r[c]) : (r[c] === null || r[c] === '-' ? null : String(r[c]).trim()))));
  return { kind, columns: cols, rows, files: fileNames, builtAt: new Date().toISOString() };
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}
async function gunzip(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function uploadDataset(ds) {
  const body = await gzip(JSON.stringify(ds));
  const res = await fetch(`/api/datasets/${ds.kind}`, {
    method: 'PUT', body,
    headers: { 'content-type': 'application/octet-stream', 'x-rows': String(ds.rows.length), 'x-cols': String(ds.columns.length), 'x-files': encodeURIComponent(ds.files.join(', ').slice(0, 450)) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data.metadata;
}

const cache = {};
export async function loadDataset(kind, force = false) {
  if (cache[kind] && !force) return cache[kind];
  const res = await fetch(`/api/datasets/${kind}`);
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    const err = new Error(d.error || `Could not load data (${res.status})`); err.status = res.status; throw err;
  }
  const ds = JSON.parse(await gunzip(await res.arrayBuffer()));
  ds.meta = JSON.parse(decodeURIComponent(res.headers.get('x-dataset-meta') || '%7B%7D'));
  // Row objects keyed by column label, plus a stable key
  ds.objects = ds.rows.map((r) => {
    const o = {};
    ds.columns.forEach((c, i) => { o[c.label] = r[i]; });
    o.__key = `${r[0] ?? ''}|${r[1] ?? ''}`;
    return o;
  });
  cache[kind] = ds;
  return ds;
}
export const clearDatasetCache = (kind) => { delete cache[kind]; };

// ----- mutual fund export -> compact fund facts used by the Fund dashboard
export function mfFactsRows(merged) {
  const pick = (r, ...names) => {
    for (const n of names) {
      const k = Object.keys(r).find((x) => x.trim().toLowerCase() === n.toLowerCase());
      if (k && r[k] !== null && r[k] !== '' && r[k] !== '-') return r[k];
    }
    return null;
  };
  const pos = (v) => { const n = toNum(v); return n !== null && n > 0 ? n : null; }; // Tickertape uses 0 for "missing"
  const out = [];
  for (const r of merged.rows) {
    const name = pick(r, 'Name');
    if (!name || /\(/.test(String(name))) continue; // skip IDCW / payout variants
    out.push({
      name: String(name), sub: pick(r, 'Sub Category'),
      facts: {
        expenseRatio: pos(pick(r, 'Total Exp. Ratio', 'Expense Ratio', 'Total Expense Ratio')), aum: pos(pick(r, 'AUM')),
        exitLoad: toNum(pick(r, 'Exit Load')), alpha: toNum(pick(r, 'Alpha')), peRatio: pos(pick(r, 'PE Ratio')), ytm: pos(pick(r, 'Average YTM')),
        risk: pick(r, 'SEBI Risk Category'), benchmark: pick(r, 'Benchmark'), fundManager: pick(r, 'Fund Manager'),
        minSip: toNum(pick(r, 'Minimum SIP')), largecapPct: toNum(pick(r, '% Largecap Holding')), midcapPct: toNum(pick(r, '% Midcap Holding')),
        smallcapPct: toNum(pick(r, '% Smallcap Holding')), top10Pct: toNum(pick(r, '% Concentration - Top 10 Holdings')), cashPct: toNum(pick(r, '% Cash Holding')),
      },
    });
  }
  return out;
}

// ----- Indian stocks export -> Nifty 50 prices (matched on company name)
export const companyKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(limited|ltd|the|co|company|corporation|corp|inc)\b\.?/g, ' ').replace(/[^a-z0-9]/g, '');

export function niftyPricesFrom(merged, nifty) {
  const priceCol = merged.columns.find((c) => /^(close price|ltp|last price|price)$/i.test(c.trim()));
  const nameCol = merged.columns[0];
  const tickerCol = merged.columns.find((c) => /^(ticker|symbol|nse symbol)$/i.test(c.trim()));
  if (!priceCol) return [];
  const byName = new Map(), byTicker = new Map();
  for (const r of merged.rows) {
    byName.set(companyKey(r[nameCol]), r);
    if (tickerCol) byTicker.set(String(r[tickerCol]).toUpperCase(), r);
  }
  const out = [];
  for (const s of nifty) {
    const r = byTicker.get(s.symbol) || byName.get(companyKey(s.name));
    const p = r ? toNum(r[priceCol]) : null;
    if (p) out.push({ symbol: s.symbol, ltp: p });
  }
  return out;
}

export async function saveMfFacts(rows) {
  return api('POST', '/api/tickertape', { rows });
}
