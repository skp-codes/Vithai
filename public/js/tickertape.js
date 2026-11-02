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

// ---------------------------------------------------------------- key fields
// The fields Vithai relies on, per export type. Each is matched to a column in your file by the
// aliases below (first alias that matches wins), and you can override the match at import time.
// "ranking" fields feed the default ranking criteria: [weight, direction].
const ALIAS = (...a) => a.map((x) => new RegExp(x, 'i'));
export const KEY_FIELDS = {
  mf: [
    { id: 'name', label: 'Fund name', required: true, use: 'Matching funds to AMFI', aliases: ALIAS('^name$', '^(scheme|fund) name$') },
    { id: 'subCategory', label: 'Sub-category', use: 'Telling apart funds with the same name', aliases: ALIAS('^sub ?category$', '^category$') },
    { id: 'expenseRatio', label: 'Expense ratio', use: 'Fund ranking (cost)', aliases: ALIAS('^total exp\\.? ratio$', '^expense ratio$', '^total expense ratio$', '^ter$') },
    { id: 'aum', label: 'AUM', use: 'Fund ranking (size)', aliases: ALIAS('^aum', '^assets under management', '^fund size') },
    { id: 'exitLoad', label: 'Exit load', use: 'Fund details', aliases: ALIAS('^exit load') },
    { id: 'alpha', label: 'Alpha', use: 'Optional fund ranking metric', aliases: ALIAS('^alpha$') },
    { id: 'peRatio', label: 'PE ratio', use: 'Optional fund ranking metric', aliases: ALIAS('^pe ratio$', '^p/?e$') },
    { id: 'ytm', label: 'Yield to maturity', use: 'Optional debt fund ranking metric', aliases: ALIAS('^average ytm$', '^ytm$', 'yield to maturity') },
    { id: 'risk', label: 'SEBI risk category', use: 'Fund details', aliases: ALIAS('sebi risk', '^riskometer', '^risk$') },
    { id: 'benchmark', label: 'Benchmark', use: 'Fund details', aliases: ALIAS('^benchmark') },
    { id: 'fundManager', label: 'Fund manager', use: 'Fund details', aliases: ALIAS('^fund manager') },
    { id: 'minSip', label: 'Minimum SIP', use: 'Fund details', aliases: ALIAS('^min(imum)? sip') },
    { id: 'largecapPct', label: '% large cap holding', use: 'Fund details', aliases: ALIAS('large ?cap holding') },
    { id: 'midcapPct', label: '% mid cap holding', use: 'Fund details', aliases: ALIAS('mid ?cap holding') },
    { id: 'smallcapPct', label: '% small cap holding', use: 'Fund details', aliases: ALIAS('small ?cap holding') },
    { id: 'top10Pct', label: '% in top 10 holdings', use: 'Fund details', aliases: ALIAS('top 10 holdings') },
    { id: 'cashPct', label: '% cash', use: 'Fund details', aliases: ALIAS('cash holding') },
  ],
  stock: [
    { id: 'name', label: 'Company name', required: true, use: 'Identifying each stock', aliases: ALIAS('^name$', '^company( name)?$', '^stock( name)?$') },
    { id: 'ticker', label: 'Ticker', use: 'Matching Nifty 50 / US basket prices', aliases: ALIAS('^ticker$', '^symbol$', '^(nse )?(symbol|code)$') },
    { id: 'sector', label: 'Sector', use: 'Sector filter', aliases: ALIAS('^sub-?sector$', '^industry$', '^sector$') },
    { id: 'marketCap', label: 'Market cap', use: '"Top N by market cap" universe', aliases: ALIAS('^market cap', '^mkt\.? ?cap', 'capitali[sz]ation') },
    { id: 'price', label: 'Price', use: 'Nifty 50 / US basket quantities and values', aliases: ALIAS('^close price', '^ltp$', '^last (traded )?price', '^current price', '^price( \\(.*\\))?$') },
    { id: 'roe', label: 'Return on equity', use: 'Default ranking', rank: [1.5, 'desc'], aliases: ALIAS('^5y avg return on equity', '^return on equity', '^roe') },
    { id: 'roce', label: 'ROCE', use: 'Default ranking', rank: [1, 'desc'], aliases: ALIAS('^roce', '^return on capital') },
    { id: 'revGrowth', label: 'Revenue growth', use: 'Default ranking', rank: [1, 'desc'], aliases: ALIAS('^5y historical revenue growth', 'revenue growth', 'sales growth') },
    { id: 'epsGrowth', label: 'EPS growth', use: 'Default ranking', rank: [1, 'desc'], aliases: ALIAS('^5y historical eps growth', 'eps growth', 'earnings growth') },
    { id: 'netMargin', label: 'Net profit margin', use: 'Default ranking', rank: [0.5, 'desc'], aliases: ALIAS('^5y avg net profit margin', '^net profit margin', 'net margin') },
    { id: 'debtEquity', label: 'Debt to equity', use: 'Default ranking', rank: [1, 'asc'], aliases: ALIAS('^debt to equity', 'debt.{0,4}equity') },
    { id: 'pe', label: 'PE ratio', use: 'Default ranking', rank: [0.5, 'asc'], aliases: ALIAS('^pe ratio', '^p/?e( ratio)?$', '^ttm pe') },
    { id: 'ret1y', label: '1-year return', use: 'Default ranking', rank: [0.5, 'desc'], aliases: ALIAS('^1y return( %)?$', '1y return') },
  ],
};
export const keyFieldsFor = (kind) => KEY_FIELDS[kind === 'mf' ? 'mf' : 'stock'];

// Default display label for a raw column (US exports use raw field names)
export const defaultLabel = (kind, raw) => (kind === 'us' && US_LABELS[raw.trim()]) || raw.trim();

/**
 * Work out the column mapping for an import.
 * saved = { keys: {id: rawColumn|null}, renames: {raw: label}, excluded: [raw] } from the last import.
 * Returns { keys, renames, excluded, notes } where keys point at RAW column names.
 */
export function autoMap(kind, columns, saved = {}) {
  const renames = {};
  for (const c of columns) renames[c] = saved.renames?.[c] || defaultLabel(kind, c);
  const excluded = (saved.excluded || []).filter((c) => columns.includes(c));
  const keys = {}, notes = [];
  const used = new Set();
  for (const f of keyFieldsFor(kind)) {
    const prev = saved.keys?.[f.id];
    if (prev === null && saved.keys && f.id in saved.keys) { keys[f.id] = null; continue; } // you marked it "not in file"
    if (prev && columns.includes(prev)) { keys[f.id] = prev; used.add(prev); continue; }
    let hit = null;
    for (const re of f.aliases) {
      hit = columns.find((c) => !used.has(c) && (re.test(renames[c]) || re.test(c.trim())));
      if (hit) break;
    }
    if (prev && !hit) notes.push(`"${prev}" (used for ${f.label}) is no longer in the file.`);
    else if (prev && hit !== prev) notes.push(`${f.label} was "${prev}" last time; now matched to "${hit}".`);
    keys[f.id] = hit || null;
    if (hit) used.add(hit);
  }
  return { keys, renames, excluded, notes };
}

// ---------------------------------------------------------------- merging parts
// Merge part files of the same kind on name + ticker/sub-category (the first two columns),
// or on the mapped key columns when given.
export function mergeParts(files, keyCols) {
  const columns = [];
  const byKey = new Map();
  for (const f of files) {
    for (const c of f.header) if (!columns.includes(c)) columns.push(c);
    const k1 = keyCols?.[0] && f.header.includes(keyCols[0]) ? keyCols[0] : f.header[0];
    const k2 = keyCols?.[1] && f.header.includes(keyCols[1]) ? keyCols[1] : f.header[1];
    for (const r of f.rows) {
      const k = `${String(r[k1] ?? '').trim()}|${String(r[k2] ?? '').trim()}`;
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
export const isNumericColumn = (rows, c) => {
  const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== '' && v !== '-');
  return vals.length > 0 && vals.filter((v) => toNum(v) !== null).length / vals.length > 0.9;
};

/**
 * Build the stored dataset using the mapping: excluded columns dropped, renamed labels applied,
 * and `keys` recorded as { fieldId: label } so the dashboards don't depend on column names.
 */
export function toDataset(kind, merged, fileNames, mapping) {
  const cols = merged.columns.filter((c) => !mapping.excluded.includes(c));
  const seen = new Set();
  const kept = [];
  for (const c of cols) {
    let label = (mapping.renames[c] || c).trim() || c;
    while (seen.has(label)) label += ' ·';      // keep labels unique
    seen.add(label);
    kept.push({ raw: c, label, type: isNumericColumn(merged.rows, c) ? 'num' : 'text' });
  }
  const labelOf = Object.fromEntries(kept.map((c) => [c.raw, c.label]));
  const keys = {};
  for (const [id, raw] of Object.entries(mapping.keys)) keys[id] = raw && labelOf[raw] ? labelOf[raw] : null;
  const rows = merged.rows.map((r) => kept.map((c) => (c.type === 'num' ? toNum(r[c.raw]) : (r[c.raw] === null || r[c.raw] === '-' ? null : String(r[c.raw]).trim()))));
  return { kind, columns: kept.map(({ label, type, raw }) => ({ label, type, raw })), keys, rows, files: fileNames, builtAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- storage
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
  const missing = Object.entries(ds.keys).filter(([, v]) => !v).map(([k]) => k);
  const res = await fetch(`/api/datasets/${ds.kind}`, {
    method: 'PUT', body,
    headers: {
      'content-type': 'application/octet-stream', 'x-rows': String(ds.rows.length), 'x-cols': String(ds.columns.length),
      'x-files': encodeURIComponent(ds.files.join(', ').slice(0, 450)), 'x-missing': encodeURIComponent(missing.join(',')),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data.metadata;
}

export const getColumnMap = async (kind) => (await api('GET', `/api/colmaps/${kind}`)).map || {};
export const saveColumnMap = (kind, map) => api('PUT', `/api/colmaps/${kind}`, map);

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
  if (!ds.keys) ds.keys = legacyKeys(ds); // datasets loaded before key mapping existed
  const nameIdx = ds.columns.findIndex((c) => c.label === ds.keys.name);
  const tIdx = ds.columns.findIndex((c) => c.label === (ds.keys.ticker || ds.keys.subCategory));
  ds.objects = ds.rows.map((r) => {
    const o = {};
    ds.columns.forEach((c, i) => { o[c.label] = r[i]; });
    o.__key = `${r[nameIdx < 0 ? 0 : nameIdx] ?? ''}|${tIdx < 0 ? (r[1] ?? '') : (r[tIdx] ?? '')}`;
    return o;
  });
  cache[kind] = ds;
  return ds;
}
export const clearDatasetCache = (kind) => { delete cache[kind]; };

function legacyKeys(ds) {
  const m = autoMap(ds.kind, ds.columns.map((c) => c.label));
  return m.keys;
}

// ---------------------------------------------------------------- uses of the data
// Mutual fund export -> compact fund facts used by the Fund dashboard (via the key mapping)
export function mfFactsRows(merged, mapping) {
  const k = mapping.keys;
  const get = (r, id) => (k[id] ? r[k[id]] : null);
  const pos = (v) => { const n = toNum(v); return n !== null && n > 0 ? n : null; }; // Tickertape uses 0 for "missing"
  const out = [];
  for (const r of merged.rows) {
    const name = get(r, 'name');
    if (!name || /\(/.test(String(name))) continue; // skip IDCW / payout variants
    const t = (v) => (v === null || v === undefined || v === '-' ? null : String(v));
    out.push({
      name: String(name), sub: t(get(r, 'subCategory')),
      facts: {
        expenseRatio: pos(get(r, 'expenseRatio')), aum: pos(get(r, 'aum')), exitLoad: toNum(get(r, 'exitLoad')),
        alpha: toNum(get(r, 'alpha')), peRatio: pos(get(r, 'peRatio')), ytm: pos(get(r, 'ytm')),
        risk: t(get(r, 'risk')), benchmark: t(get(r, 'benchmark')), fundManager: t(get(r, 'fundManager')), minSip: toNum(get(r, 'minSip')),
        largecapPct: toNum(get(r, 'largecapPct')), midcapPct: toNum(get(r, 'midcapPct')), smallcapPct: toNum(get(r, 'smallcapPct')),
        top10Pct: toNum(get(r, 'top10Pct')), cashPct: toNum(get(r, 'cashPct')),
      },
    });
  }
  return out;
}

// Indian stocks export -> Nifty 50 prices (matched on ticker, else company name)
export const companyKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(limited|ltd|the|co|company|corporation|corp|inc)\b\.?/g, ' ').replace(/[^a-z0-9]/g, '');

export function niftyPricesFrom(merged, nifty, mapping) {
  const { price, name, ticker } = mapping.keys;
  if (!price) return [];
  const byName = new Map(), byTicker = new Map();
  for (const r of merged.rows) {
    if (name) byName.set(companyKey(r[name]), r);
    if (ticker) byTicker.set(String(r[ticker]).toUpperCase(), r);
  }
  const out = [];
  for (const s of nifty) {
    const r = byTicker.get(s.symbol) || byName.get(companyKey(s.name));
    const p = r ? toNum(r[price]) : null;
    if (p) out.push({ symbol: s.symbol, ltp: p });
  }
  return out;
}

export async function saveMfFacts(rows) {
  return api('POST', '/api/tickertape', { rows });
}
