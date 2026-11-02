import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory, computeMetrics, navAt, YEAR } from '../public/js/metrics.js';
import { rankFunds } from '../public/js/ranking.js';
import { nameKey, cleanName } from '../src/names.js';

// Build an mfapi-style history (newest first) growing at a constant annual rate
function history(years, annual, startNav = 10, end = Date.UTC(2026, 9, 30)) {
  const out = [];
  const daily = Math.pow(1 + annual, 1 / 365.25) - 1;
  const days = Math.round(years * 365.25);
  for (let i = days; i >= 0; i--) {
    const t = end - i * 86400000;
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue; // weekdays only, like real NAVs
    const nav = startNav * Math.pow(1 + daily, days - i);
    out.push({ date: `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`, nav: nav.toFixed(5) });
  }
  return out.reverse();
}

test('parseHistory sorts ascending and drops bad rows', () => {
  const s = parseHistory([{ date: '02-01-2024', nav: '11' }, { date: '01-01-2024', nav: '10' }, { date: 'x', nav: 'y' }]);
  assert.equal(s.length, 2);
  assert.ok(s[0][0] < s[1][0]);
  assert.equal(navAt(s, s[1][0] + 1), 11);
});

test('CAGR matches a constant-growth series', () => {
  const m = computeMetrics(parseHistory(history(11, 0.12)));
  for (const k of ['cagr3', 'cagr5', 'cagr10']) assert.ok(Math.abs(m[k] - 12) < 0.15, `${k}=${m[k]}`);
  assert.ok(Math.abs(m.rolling3Avg - 12) < 0.2);
  assert.equal(m.maxDrawdown, 0);
  assert.ok(m.volatility < 0.5, 'smooth series has ~no volatility');
});

test('short history leaves long-term metrics empty', () => {
  const m = computeMetrics(parseHistory(history(2, 0.08)));
  assert.equal(m.cagr3, null);
  assert.equal(m.cagr5, null);
  assert.ok(m.ret1y > 7.5 && m.ret1y < 8.5);
});

test('drawdown is measured from the peak', () => {
  const h = history(4, 0.1);
  // knock 20% off the last 30 points
  for (let i = 0; i < 30; i++) h[i].nav = (parseFloat(h[i].nav) * 0.8).toFixed(5);
  const m = computeMetrics(parseHistory(h));
  assert.ok(Math.abs(m.maxDrawdown - 20) < 0.6, `dd=${m.maxDrawdown}`);
});

test('ranking uses percentiles, skips missing values and respects direction', () => {
  const funds = [
    { code: 'a', cagr5: 15, expenseRatio: 1.0 },
    { code: 'b', cagr5: 12, expenseRatio: 0.3 },
    { code: 'c', cagr5: 10, expenseRatio: null },
  ];
  const r = rankFunds(funds, [['cagr5', 1], ['expenseRatio', 1]]);
  assert.equal(r[0].code, 'b'); // middle return + cheapest beats best return + priciest
  const c = r.find((x) => x.code === 'c');
  assert.equal(c.coverage, 0.5); // missing expense ratio is skipped, not counted as best
});

test('Tickertape and AMFI names normalise to the same key', () => {
  assert.equal(nameKey('Invesco India Midcap Fund'), nameKey(cleanName('Invesco India Mid Cap Fund - Direct Plan - Growth')));
  assert.equal(nameKey('Kotak US Specific Equity Passive FOF'), nameKey(cleanName('Kotak US Specific Equity Passive FoF - Direct Plan - Growth')));
  assert.equal(nameKey('Nippon India Large Cap Fund'), nameKey(cleanName('Nippon India Large Cap Fund - Direct Plan - Growth Option')));
  assert.notEqual(nameKey('Nippon India Large Cap Fund'), nameKey('Nippon India Vision Large & Mid Cap Fund'));
});
