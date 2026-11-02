// Vithai · Tickertape exporter
// Runs on a Tickertape screener page (mutual funds, Indian stocks or US stocks) in your own
// logged-in browser. Tickertape exports at most 45 columns at a time, so this splits all
// available columns into parts and uses Tickertape's own Export button for each part.
// Upload all the CSV files to Vithai and it merges the parts back together by name.
(async () => {
  if (window.__vithaiExportRunning) return;
  window.__vithaiExportRunning = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MAX_COLS = 45;
  const SKIP_TABS = new Set(['Add Filters', 'Custom', 'Search', 'Your Filters', 'Done', 'Learn more about']);
  const path = location.pathname;
  const kind = path.includes('/screener/mutual-fund') ? 'mf' : path.includes('/screener/us-stocks') ? 'us' : path.includes('/screener/equity') ? 'in' : null;
  const label = { mf: 'mutual funds', in: 'Indian stocks', us: 'US stocks' }[kind];

  // --- status box ---
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#141a22;color:#eef3f7;font:13px/1.45 system-ui,sans-serif;padding:14px 16px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:340px;border-left:4px solid #0f8c72';
  document.body.appendChild(box);
  const say = (html) => { box.innerHTML = `<b>Vithai exporter</b><br>${html}`; };
  const done = (html, ok = true) => { say(html); box.style.borderLeftColor = ok ? '#0f8c72' : '#c0392b'; const x = document.createElement('div'); x.textContent = 'Close'; x.style.cssText = 'margin-top:8px;cursor:pointer;text-decoration:underline'; x.onclick = () => box.remove(); box.appendChild(x); window.__vithaiExportRunning = false; };

  if (!kind) return done('Open one of the Tickertape screeners first:<br>tickertape.in/screener/mutual-fund, /equity or /us-stocks.', false);

  const leafWithText = (root, text) => [...root.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === text);
  // only visible buttons (Tickertape keeps hidden mobile copies of some buttons)
  const button = (re) => [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && re.test(b.textContent.trim()));
  const panel = () => document.querySelector('.add-filters-modal-container');
  const headerCount = () => [...document.querySelectorAll('table thead th')].filter((t) => t.innerText.trim()).length;
  const isTicked = (row) => (row.querySelector('.checkbox i')?.className || '').includes('done');
  async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(200); } return null; }

  async function openPanel() {
    if (panel()) return panel();
    const b = button(/^\+?\s*Add Filters?$/i);
    if (!b) throw new Error('Could not find the "Add Filter" button.');
    b.click();
    const p = await waitFor(panel);
    if (!p) throw new Error('The Add Filter panel did not open.');
    await sleep(400);
    return p;
  }
  function categoryTabs(p) {
    const names = [];
    for (const e of p.querySelectorAll('*')) {
      if (e.children.length || e.closest('.filter-row')) continue;
      const t = e.textContent.trim();
      if (!t || SKIP_TABS.has(t) || /^Pick from|^Learn more/i.test(t) || names.includes(t)) continue;
      names.push(t);
    }
    return names;
  }
  async function clickTab(p, name) {
    const el = leafWithText(p, name);
    if (!el) return false;
    el.click();
    await sleep(500);
    return true;
  }
  async function closePanel() {
    const p = panel();
    if (!p) return;
    const d = [...p.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Done');
    d ? d.click() : document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await waitFor(() => !panel(), 5000);
    await sleep(1500);
  }

  try {
    say(`Reading the ${label} filter list…`);
    let p = await openPanel();
    const filters = []; // [{name, tab}]
    for (const tab of categoryTabs(p)) {
      if (!(await clickTab(p, tab))) continue;
      for (const row of p.querySelectorAll('.filter-row')) {
        const name = row.innerText.trim().split('\n')[0];
        if (name && !filters.some((f) => f.name === name)) filters.push({ name, tab });
      }
    }
    if (!filters.length) throw new Error('No filters found. Tickertape may have changed its page layout.');
    // Columns that are always shown (Name, sub-category, …) = headers minus ticked filters
    let ticked = 0;
    for (const tab of [...new Set(filters.map((f) => f.tab))]) { await clickTab(p, tab); ticked += [...p.querySelectorAll('.filter-row')].filter(isTicked).length; }
    await closePanel();
    const fixed = Math.max(1, headerCount() - ticked);
    const per = MAX_COLS - fixed;
    const parts = [];
    for (let i = 0; i < filters.length; i += per) parts.push(filters.slice(i, i + per));
    const stamp = new Date().toISOString().slice(0, 10);
    const skipped = [];

    for (let i = 0; i < parts.length; i++) {
      const want = new Set(parts[i].map((f) => f.name));
      say(`Part ${i + 1} of ${parts.length}: choosing ${want.size} columns…`);
      p = await openPanel();
      for (const tab of [...new Set(filters.map((f) => f.tab))]) {
        await clickTab(p, tab);
        for (const row of p.querySelectorAll('.filter-row')) {
          const name = row.innerText.trim().split('\n')[0];
          const should = want.has(name);
          if (isTicked(row) !== should) {
            row.querySelector('.checkbox')?.click();
            await sleep(120);
            if (should && !isTicked(row) && !skipped.includes(name)) skipped.push(name); // locked / unavailable
          }
        }
      }
      await closePanel();
      if (headerCount() > MAX_COLS) throw new Error(`Part ${i + 1} still has ${headerCount()} columns (limit ${MAX_COLS}).`);
      say(`Part ${i + 1} of ${parts.length}: exporting…`);
      const exp = button(/^Export$/);
      if (!exp) throw new Error('Could not find the Export button.');
      exp.click();
      const go = await waitFor(() => button(/^Export Results$/i));
      if (!go) throw new Error('The export dialog did not open.');
      const nameInput = [...document.querySelectorAll('input[type=text]')].find((x) => /Screener/i.test(x.value) || x.closest('[class*=overflowmenu]'));
      if (nameInput) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(nameInput, `vithai-${kind}-${stamp}-part${i + 1}of${parts.length}`);
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(200);
      }
      if (go.disabled) throw new Error('Tickertape disabled the export (column limit or login needed).');
      go.click();
      await sleep(4000); // give the download time to start
    }
    done(`Finished: ${parts.length} CSV file${parts.length > 1 ? 's' : ''} for ${label} should be in your Downloads folder${skipped.length ? `.<br><span style="color:#e3a64a">Skipped ${skipped.length} unavailable column(s): ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''}</span>` : '.'}<br>Upload them all to Vithai's "Load Tickertape data".`);
  } catch (e) {
    done(`Stopped: ${e.message}<br>If you're signed out, sign in to Tickertape and run it again.`, false);
  }
})();
