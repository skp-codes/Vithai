#!/usr/bin/env node
// Daily data refresh for Vithai.
//  1. Pulls the latest NAV for every scheme from mfapi.in (which mirrors AMFI).
//  2. Picks the Direct-Growth schemes in Vithai's five fund slots (plus all gold ETFs).
//  3. Downloads each scheme's full NAV history and computes returns, risk and ratio metrics.
//  4. Sends the results to the Vithai API (or writes them to a file with --out).
//
// Usage:
//   VITHAI_URL=https://your-site INGEST_TOKEN=... node scripts/refresh.mjs
//   node scripts/refresh.mjs --out data/snapshot.json      (no upload; for local dev)
//   node scripts/refresh.mjs --limit 5                      (quick test: 5 schemes per slot)

import { readFile, writeFile } from 'node:fs/promises';
import { parseHistory, computeMetrics, medianDaily, trackingError } from '../public/js/metrics.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = opt('--out');
const LIMIT = opt('--limit') ? Number(opt('--limit')) : Infinity;
const API = 'https://api.mfapi.in/mf';

// Which AMFI categories feed each slot (mfapi uses two naming styles, so match both)
export const SLOT_RULES = {
  largecap: /- Large Cap Fund$/i,
  midsmall: /- (Mid|Small) Cap Fund$/i,
  debt: /(Corporate Bond Fund|Banking and PSU( Debt)? Fund)$/i,
  international: /(FoF Overseas|Fund of Funds investing overseas|ETFs investing overseas)$/i,
  gold: /Gold ETF$/i,
};
const isDirectGrowth = (name) => /direct/i.test(name) && /growth/i.test(name) && !/idcw|dividend|bonus|payout/i.test(name);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'vithai-refresh/1.0' } });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (e) {
      if (i === tries - 1) throw e;
    }
    await sleep(1500 * 2 ** i); // back off: 1.5s, 3s, 6s, 12s
  }
  throw new Error(`Gave up on ${url}`);
}

// Run tasks with limited concurrency and a small gap between requests (mfapi rate-limits bursts)
async function pool(items, worker, concurrency = 3, gapMs = 250) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await worker(items[i], i); } catch (e) { out[i] = { error: e.message }; }
      await sleep(gapMs);
    }
  }));
  return out;
}

const parseDMY = (s) => { const [d, m, y] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); };

async function main() {
  console.log('Fetching latest NAV list…');
  const latest = await getJSON(`${API}/latest`);
  const cutoff = Date.now() - 10 * 86400000; // active = NAV published in the last 10 days
  const universe = [];
  for (const [slot, re] of Object.entries(SLOT_RULES)) {
    let list = latest.filter((s) => s.date && parseDMY(s.date) >= cutoff && re.test(s.schemeCategory || ''));
    list = slot === 'gold' ? list.filter((s) => !/fof|fund of fund/i.test(s.schemeName)) : list.filter((s) => isDirectGrowth(s.schemeName));
    const seen = new Set();
    list = list.filter((s) => !seen.has(s.schemeCode) && seen.add(s.schemeCode)).slice(0, LIMIT);
    for (const s of list) universe.push({ slot, code: String(s.schemeCode), name: s.schemeName, amc: s.fundHouse || '', category: s.schemeCategory });
    console.log(`  ${slot}: ${list.length} schemes`);
  }

  console.log(`Downloading ${universe.length} NAV histories…`);
  const histories = new Map();
  let done = 0;
  await pool(universe, async (u) => {
    const j = await getJSON(`${API}/${u.code}`);
    histories.set(u.code, parseHistory(j.data));
    if (++done % 25 === 0) console.log(`  ${done}/${universe.length}`);
  });

  const rows = [];
  for (const u of universe) {
    const series = histories.get(u.code);
    const m = series ? computeMetrics(series) : null;
    if (!m) { console.warn(`  skipped ${u.name} (no usable history)`); continue; }
    rows.push({ ...u, nav: m.nav, navDate: m.navDate, metrics: m });
  }

  // Tracking error for gold ETFs: vs the median daily move of all gold ETFs (a clean proxy for gold)
  const goldRows = rows.filter((r) => r.slot === 'gold');
  const bench = medianDaily(goldRows.map((r) => histories.get(r.code)));
  for (const r of goldRows) r.metrics.trackingError = trackingError(histories.get(r.code), bench);

  // Seed facts (expense ratio, AUM, exit load) researched by hand; the app's own edits take priority
  const seed = JSON.parse(await readFile(new URL('../data/seed-facts.json', import.meta.url), 'utf8'));
  const facts = [];
  for (const r of rows) {
    const clean = r.name.replace(/\s*-?\s*(Direct|Regular).*$/i, '');
    const hit = seed.find(([re]) => new RegExp(re, 'i').test(clean) || new RegExp(re, 'i').test(r.name));
    if (hit) facts.push({ code: r.code, data: hit[1] });
  }

  const payload = { generatedAt: new Date().toISOString(), schemes: rows, seedFacts: facts };
  console.log(`Computed metrics for ${rows.length} schemes (${facts.length} with seed facts).`);

  if (OUT) {
    await writeFile(OUT, JSON.stringify(payload));
    console.log(`Wrote ${OUT}`);
    return;
  }
  const base = process.env.VITHAI_URL, token = process.env.INGEST_TOKEN;
  if (!base || !token) throw new Error('Set VITHAI_URL and INGEST_TOKEN (or use --out file.json).');
  // Send in chunks to keep each request small
  for (let i = 0; i < rows.length; i += 60) {
    const body = { generatedAt: payload.generatedAt, schemes: rows.slice(i, i + 60), seedFacts: i === 0 ? facts : [], final: i + 60 >= rows.length };
    const res = await fetch(`${base.replace(/\/$/, '')}/api/admin/ingest`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Ingest failed: HTTP ${res.status} ${await res.text()}`);
    console.log(`  uploaded ${Math.min(i + 60, rows.length)}/${rows.length}`);
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
