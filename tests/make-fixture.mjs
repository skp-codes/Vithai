// Builds a synthetic snapshot in the same shape the refresh script uploads, for local testing.
import { writeFile, readFile } from 'node:fs/promises';
import { parseHistory, computeMetrics, medianDaily, trackingError } from '../public/js/metrics.js';
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function hist(years, drift, vol) {
  const out = []; let nav = 10; const end = Date.UTC(2026, 9, 30);
  for (let i = Math.round(years * 365); i >= 0; i--) {
    const t = end - i * 864e5; const d = new Date(t); if (d.getUTCDay() % 6 === 0) continue;
    nav *= 1 + drift / 252 + vol / Math.sqrt(252) * (rnd() * 2 - 1) * 1.7;
    out.push({ date: `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`, nav: nav.toFixed(4) });
  }
  return out.reverse();
}
const F = [
  ['largecap', 'Equity Scheme - Large Cap Fund', [['Nippon India Large Cap Fund', 'Nippon India Mutual Fund', 13, .13, .13], ['ICICI Prudential Large Cap Fund', 'ICICI Prudential Mutual Fund', 15, .125, .13], ['Invesco India Large Cap Fund', 'Invesco Mutual Fund', 15, .12, .14], ['HDFC Large Cap Fund', 'HDFC Mutual Fund', 13, .11, .14], ['WhiteOak Capital Large Cap Fund', 'WhiteOak Capital Mutual Fund', 3, .14, .14]]],
  ['midsmall', 'Equity Scheme - Mid Cap Fund', [['Invesco India Mid Cap Fund', 'Invesco Mutual Fund', 13, .19, .17], ['HDFC Mid Cap Fund', 'HDFC Mutual Fund', 13, .17, .16], ['Edelweiss Mid Cap Fund', 'Edelweiss Mutual Fund', 9, .17, .17]]],
  ['midsmall', 'Equity Scheme - Small Cap Fund', [['Bandhan Small Cap Fund', 'Bandhan Mutual Fund', 6, .2, .2]]],
  ['debt', 'Debt Scheme - Corporate Bond Fund', [['Franklin India Corporate Bond Fund', 'Franklin Templeton Mutual Fund', 13, .075, .012], ['Axis Corporate Bond Fund', 'Axis Mutual Fund', 9, .072, .011], ['SBI Corporate Bond Fund', 'SBI Mutual Fund', 7, .07, .011]]],
  ['debt', 'Debt Scheme - Banking and PSU Fund', [['Kotak Banking and PSU Debt Fund', 'Kotak Mahindra Mutual Fund', 12, .071, .012]]],
  ['international', 'Other Scheme - FoF Overseas', [['Kotak US Specific Equity Passive FoF', 'Kotak Mahindra Mutual Fund', 5.5, .2, .19], ['Invesco India - Invesco Global Equity Income FoF', 'Invesco Mutual Fund', 12, .16, .14]]],
  ['gold', 'Other Scheme - Gold ETF', [['Kotak Gold ETF', 'Kotak Mahindra Mutual Fund', 19, .14, .13], ['Nippon India ETF Gold BeES', 'Nippon India Mutual Fund', 10, .14, .13], ['HDFC Gold ETF', 'HDFC Mutual Fund', 15, .14, .13]]],
];
const histories = new Map(); const schemes = []; let code = 900000;
for (const [slot, category, list] of F) for (const [name, amc, years, drift, vol] of list) {
  const c = String(code++); const s = parseHistory(hist(years, drift, vol)); histories.set(c, s);
  const m = computeMetrics(s);
  schemes.push({ slot, code: c, name: slot === 'gold' ? name : `${name} - Direct Plan - Growth`, amc, category, nav: m.nav, navDate: m.navDate, metrics: m });
}
const gold = schemes.filter((s) => s.slot === 'gold'); const bench = medianDaily(gold.map((g) => histories.get(g.code)));
for (const g of gold) g.metrics.trackingError = trackingError(histories.get(g.code), bench);
const seedFacts = JSON.parse(await readFile(new URL('../data/seed-facts.json', import.meta.url)));
const facts = schemes.map((s) => { const h = seedFacts.find(([re]) => new RegExp(re, 'i').test(s.name)); return h && { code: s.code, data: h[1] }; }).filter(Boolean);
await writeFile(process.argv[2] || 'data/snapshot.fixture.json', JSON.stringify({ generatedAt: new Date().toISOString(), schemes, seedFacts: facts, final: true }));
console.log(schemes.length, 'schemes,', facts.length, 'facts');
