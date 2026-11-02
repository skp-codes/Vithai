// Small helpers shared by the Vithai front-end.

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const inrFmt0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrFmt2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inr = (n, dp = 0) => (n === null || n === undefined || !isFinite(n)) ? '–' : '₹' + (dp ? inrFmt2 : inrFmt0).format(n);
export const num = (n, dp = 2) => (n === null || n === undefined || !isFinite(n)) ? '–' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const pct = (n, dp = 2) => (n === null || n === undefined || !isFinite(n)) ? '–' : `${Number(n).toFixed(dp)}%`;
export const signCls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

export const today = () => new Date().toISOString().slice(0, 10);
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export function openModal(html, onMount) {
  const m = document.getElementById('modal');
  const card = document.getElementById('modal-card');
  card.innerHTML = html; card.classList.remove('wide');
  m.hidden = false;
  const close = () => { m.hidden = true; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  onMount?.(m, close);
  return close;
}

// XIRR via bisection on NPV; flows = [{date: 'YYYY-MM-DD', amount}] (outflows negative)
export function xirr(flows) {
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;
  const t0 = new Date(flows[0].date).getTime();
  const span = new Date(flows[flows.length - 1].date).getTime() - t0;
  if (span < 30 * 864e5) return null; // too early to annualise meaningfully
  const npv = (r) => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (new Date(f.date).getTime() - t0) / (365.25 * 864e5)), 0);
  let lo = -0.99, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return ((lo + hi) / 2) * 100;
}

export function waitForXLSX() {
  return new Promise((resolve, reject) => {
    let n = 0;
    const t = setInterval(() => {
      if (window.XLSX) { clearInterval(t); resolve(window.XLSX); }
      else if (++n > 100) { clearInterval(t); reject(new Error('The spreadsheet reader did not load. Check your connection and try again.')); }
    }, 100);
  });
}
