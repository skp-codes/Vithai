// Personal ranking filters: named sets of filters + metrics, kept per page ("scope"):
// each fund section (fund:largecap …), Indian stocks (stock:in) and US stocks (stock:us).
// A filter made for one page is only offered on that page. Each page has a default (Vithai's own,
// or one of yours), set on Setup or with "Make default"; the default is what your plan uses.
import { esc, openModal } from './util.js';

export const fundScope = (slot) => `fund:${slot}`;
export const stockScope = (mkt) => `stock:${mkt}`;
export const newFilterId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const filtersFor = (S, scope) => S.settings.myFilters?.[scope] || [];
export const filterById = (S, scope, id) => filtersFor(S, scope).find((f) => f.id === id) || null;
export const defaultIdFor = (S, scope) => {
  const id = S.settings.defaultFilter?.[scope] || 'vithai';
  return id !== 'vithai' && !filterById(S, scope, id) ? 'vithai' : id;
};
export const filterName = (S, scope, id) => (id === 'vithai' ? 'Vithai default' : filterById(S, scope, id)?.name || 'Vithai default');

// Which filter a dashboard is showing this session (doesn't change your default)
const viewing = {};
export const viewIdFor = (S, scope) => { const v = viewing[scope]; return v && (v === 'vithai' || filterById(S, scope, v)) ? v : defaultIdFor(S, scope); };
export const setViewing = (scope, id) => { viewing[scope] = id; };

export function nameModal(title, initial, onOk, hint = '') {
  openModal(`<h3>${esc(title)}</h3>${hint ? `<p class="note">${esc(hint)}</p>` : ''}
    <form id="nmf" style="display:grid;gap:12px"><div><label class="f">Name</label><input class="input" name="n" maxlength="60" required value="${esc(initial || '')}" placeholder="e.g. Low-cost steady funds"></div>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close style="flex:0 0 auto">Cancel</button><button class="btn primary" style="flex:0 0 auto">Save</button></div></form>`, (root, close) => {
    const i = root.querySelector('input'); i.focus(); i.select();
    root.querySelector('#nmf').onsubmit = (e) => { e.preventDefault(); const n = i.value.trim(); if (!n) return; close(); onOk(n); };
  });
}

// Settings patch helpers (always send the whole map for the scope's page)
export const patchFilters = (S, scope, list) => ({ myFilters: { ...(S.settings.myFilters || {}), [scope]: list } });
export const patchDefault = (S, scope, id) => ({ defaultFilter: { ...(S.settings.defaultFilter || {}), [scope]: id } });

// Older versions kept one unnamed "saved criteria" per page; turn those into a filter called "My criteria"
export async function migrateLegacy(S, saveSettings) {
  const s = S.settings;
  const old = [...Object.entries(s.criteria || {}).map(([k, v]) => [fundScope(k), v]), ...Object.entries(s.stockCriteria || {}).map(([k, v]) => [stockScope(k), v])].filter(([, v]) => v && typeof v === 'object');
  if (!old.length) return;
  const myFilters = { ...(s.myFilters || {}) }, defaultFilter = { ...(s.defaultFilter || {}) };
  for (const [scope, cfg] of old) {
    if ((myFilters[scope] || []).length) continue;
    const id = newFilterId();
    myFilters[scope] = [{ id, name: 'My criteria', cfg }];
    defaultFilter[scope] = id;
  }
  try { await saveSettings({ myFilters, defaultFilter, criteria: {}, stockCriteria: {} }, null); } catch { /* try again next time */ }
}

/**
 * The filter picker shown at the top of a ranking panel, and its actions.
 * opts: { scope, cfg(), base(), dirty(), rerender(), saveSettings, pageLabel }
 */
export function filterBarHTML(S, scope, dirty) {
  const view = viewIdFor(S, scope), def = defaultIdFor(S, scope), mine = filtersFor(S, scope);
  return `<div class="fbar">
    <label class="f" for="fsel">Filter</label>
    <div class="fbar-row"><select class="input" id="fsel">
      <option value="vithai" ${view === 'vithai' ? 'selected' : ''}>Vithai default${def === 'vithai' ? '  ★' : ''}</option>
      ${mine.length ? `<optgroup label="My filters">${mine.map((f) => `<option value="${esc(f.id)}" ${view === f.id ? 'selected' : ''}>${esc(f.name)}${def === f.id ? '  ★' : ''}</option>`).join('')}</optgroup>` : ''}
      <option value="__new">+ New filter…</option></select>
      ${view !== 'vithai' ? `<button type="button" class="btn small ghost" id="frename" title="Rename">Rename</button><button type="button" class="btn small ghost danger" id="fdelete" title="Delete this filter">Delete</button>` : ''}</div>
    <div class="fbar-status">${view === def ? '<span class="badge good">★ Your default here</span>' : `<span class="badge">Not your default</span> <button type="button" class="linkbtn" id="fmakedef">Make this my default</button>`}
      ${dirty ? '<span class="badge gold">Unsaved changes</span>' : ''}</div>
    ${view !== def ? `<p class="note" style="margin:6px 0 0">Your plan uses <b>${esc(filterName(S, scope, def))}</b>.</p>` : ''}
  </div>`;
}

export function filterActionsHTML(S, scope, dirty) {
  const view = viewIdFor(S, scope);
  return `<div class="row tight" style="margin-top:14px;flex-wrap:wrap">
    ${view !== 'vithai' ? `<button class="btn primary" id="fsave" ${dirty ? '' : 'disabled'}>Save changes</button>` : ''}
    <button class="btn ${view === 'vithai' && dirty ? 'primary' : ''}" id="fsaveas">Save as new filter…</button>
    ${dirty ? '<button class="btn ghost" id="fundo">Undo changes</button>' : ''}</div>`;
}

export function wireFilterBar(root, S, o) {
  const { scope, saveSettings } = o;
  const view = viewIdFor(S, scope);
  const create = (cfg, hint) => nameModal('Name your filter', '', async (name) => {
    const id = newFilterId();
    await saveSettings(patchFilters(S, scope, [...filtersFor(S, scope), { id, name, cfg }]), `Saved "${name}"`);
    setViewing(scope, id); o.rerender();
  }, hint);
  const sel = root.querySelector('#fsel');
  sel.onchange = () => {
    if (sel.value === '__new') { sel.value = view; return create(o.cfg(), `Starts from what's on screen now. Only offered on ${o.pageLabel}.`); }
    if (o.dirty() && !confirm('Switch filter? Your unsaved changes will be lost.')) { sel.value = view; return; }
    setViewing(scope, sel.value); o.rerender();
  };
  root.querySelector('#fmakedef')?.addEventListener('click', async () => { await saveSettings(patchDefault(S, scope, view), `${filterName(S, scope, view)} is now your default for ${o.pageLabel}`); o.rerender(); });
  root.querySelector('#frename')?.addEventListener('click', () => nameModal('Rename filter', filterById(S, scope, view)?.name, async (name) => {
    await saveSettings(patchFilters(S, scope, filtersFor(S, scope).map((f) => (f.id === view ? { ...f, name } : f))), 'Renamed'); o.rerender();
  }));
  root.querySelector('#fdelete')?.addEventListener('click', async () => {
    const f = filterById(S, scope, view);
    if (!confirm(`Delete the filter "${f.name}"?${defaultIdFor(S, scope) === view ? ' It is your default here, so Vithai default takes over.' : ''}`)) return;
    await saveSettings({ ...patchFilters(S, scope, filtersFor(S, scope).filter((x) => x.id !== view)), ...(defaultIdFor(S, scope) === view ? patchDefault(S, scope, 'vithai') : {}) }, `Deleted "${f.name}"`);
    setViewing(scope, null); o.rerender();
  });
  root.querySelector('#fsave')?.addEventListener('click', async () => {
    await saveSettings(patchFilters(S, scope, filtersFor(S, scope).map((f) => (f.id === view ? { ...f, cfg: o.cfg() } : f))), `Saved "${filterName(S, scope, view)}"`); o.rerender();
  });
  root.querySelector('#fsaveas')?.addEventListener('click', () => create(o.cfg(), `Saves what's on screen as a new filter for ${o.pageLabel}.`));
  root.querySelector('#fundo')?.addEventListener('click', () => o.rerender());
}
