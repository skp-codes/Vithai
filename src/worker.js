// Vithai API — Cloudflare Worker. Static files in /public are served by Workers Assets;
// everything under /api/* is handled here.

import {
  hashPassword, verifyPassword, sha256, randomId, safeEqual, inviteCode,
  sessionCookie, readCookie, SESSION_COOKIE, SESSION_DAYS,
} from './auth.js';
import { nameKey, cleanName } from './names.js';

const SLOTS = ['largecap', 'midsmall', 'debt', 'international', 'gold', 'nifty50', 'usstocks'];
const MARKETS = ['in', 'us', 'mf']; // Tickertape datasets kept in KV
export const DEFAULT_SETTINGS = {
  monthlyTotal: 50000,
  alloc: { largecap: 25, midsmall: 20, debt: 20, international: 10, gold: 10, nifty50: 15 }, // the 'Balanced' preset
  excludedAmcs: [],
  criteria: {},     // per-slot overrides of the default ranking criteria
  picks: {},        // per-slot pinned scheme code (otherwise the top-ranked fund is used)
  riskFree: 6.5,
  usSlot: false,     // show a US stocks allocation slot
  usdInr: null,      // rupees per US dollar, entered in Setup
  usBasket: [],      // [{ key, name, weight }] US stocks bought in the US slot
  stockCriteria: {}, // per-market overrides of the stock ranking criteria
  niftyPlan: null,   // { mode: 'monthly'|'weekly'|'whole', startMonth, excluded: [], phases: {} }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

async function body(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      // Basic CSRF protection: state-changing browser requests must come from our own origin
      if (request.method !== 'GET' && !url.pathname.startsWith('/api/admin/ingest')) {
        const origin = request.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Cross-origin request blocked');
      }
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },
};

// ---------------------------------------------------------------- routing
async function route(request, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  // public
  if (p === '/api/auth/register' && m === 'POST') return register(request, env);
  if (p === '/api/auth/login' && m === 'POST') return login(request, env);
  if (p === '/api/auth/logout' && m === 'POST') return logout(request, env);
  if (p === '/api/admin/ingest' && m === 'POST') return ingest(request, env);

  // signed in
  const me = await currentUser(request, env);
  if (!me) throw new HttpError(401, 'Please sign in.');
  if (p === '/api/me' && m === 'GET') return json({ user: publicUser(me, env) });
  if (p === '/api/me/password' && m === 'POST') return changePassword(request, env, me);
  if (p === '/api/me/account' && m === 'PUT') return updateAccount(request, env, me);
  if (me.household_status !== 'active') throw new HttpError(403, me.household_status === 'pending' ? 'Your household is waiting for the site admin to approve it.' : 'This household is not active. Contact the site admin.');
  if (me.status !== 'active') throw new HttpError(403, 'Your account is waiting for the household admin to approve it.');
  if (p === '/api/badges' && m === 'GET') return badges(env, me);
  if (p.startsWith('/api/site/')) return siteAdminRoute(request, env, me, p.slice(10), m);

  if (p === '/api/me/sharing' && m === 'PUT') return setSharing(request, env, me);
  if (p === '/api/settings' && m === 'GET') return json({ settings: await getSettings(env, me.id) });
  if (p === '/api/settings' && m === 'PUT') return putSettings(request, env, me);
  if (p === '/api/funds' && m === 'GET') return getFunds(env, me);
  if (p.startsWith('/api/facts/') && m === 'PUT') return putFacts(request, env, me, decodeURIComponent(p.slice(11)));
  if (p === '/api/tickertape' && m === 'POST') return uploadTickertape(request, env, me);
  if (p.startsWith('/api/colmaps/') && m === 'GET') return getColmap(env, me, p.slice(13));
  if (p.startsWith('/api/colmaps/') && m === 'PUT') return putColmap(request, env, me, p.slice(13));
  if (p === '/api/datasets' && m === 'GET') return listDatasets(env, me);
  if (p.startsWith('/api/datasets/') && m === 'GET') return getDataset(env, me, p.slice(14));
  if (p.startsWith('/api/datasets/') && m === 'PUT') return putDataset(request, env, me, p.slice(14));
  if (p === '/api/nifty' && m === 'GET') return getNifty(env, me);
  if (p === '/api/nifty' && m === 'PUT') return putNifty(request, env, me);
  if (p === '/api/transactions' && m === 'GET') return json({ transactions: await listTx(env, me.id, url.searchParams.get('month')) });
  if (p === '/api/transactions' && m === 'POST') return addTx(request, env, me);
  if (p.startsWith('/api/transactions/') && m === 'DELETE') return delTx(env, me, p.slice(18));
  if (p.startsWith('/api/transactions/') && m === 'PUT') return editTx(request, env, me, p.slice(18));
  if (p.startsWith('/api/plans/') && m === 'GET') return getPlan(env, me, p.slice(11));
  if (p.startsWith('/api/plans/') && m === 'PUT') return putPlan(request, env, me, p.slice(11));
  if (p.startsWith('/api/plans/') && m === 'DELETE') return delPlan(env, me, p.slice(11));
  if (p === '/api/backup' && m === 'GET') return json(await buildBackup(env, me, url.searchParams.get('scope') === 'household' ? 'household' : 'me'));
  if (p === '/api/delete-data' && m === 'POST') return deleteData(request, env, me);
  if (p === '/api/backup/email' && m === 'POST') return emailBackupNow(request, env, me);
  if (p === '/api/household' && m === 'GET') return getHousehold(env, me);
  if (p.startsWith('/api/household/members/')) return memberAction(request, env, me, p.slice(23), m);
  if (p.startsWith('/api/members/') && p.endsWith('/portfolio') && m === 'GET') return memberPortfolio(env, me, p.slice(13, -10));
  throw new HttpError(404, 'Not found');
}

// ---------------------------------------------------------------- auth
// Accounts without an email store 'nomail:<id>' in the (NOT NULL, UNIQUE) email column
const realEmail = (e) => (e && !e.startsWith('nomail:') ? e : null);
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const lc = (v) => String(v || '').trim().toLowerCase();

// The site admin approves new households. SITE_ADMIN_USERNAME is set in wrangler.toml;
// SITE_ADMIN_EMAIL is a secret so it isn't published in the repo.
function isSiteAdmin(env, u) {
  return !!u && ((env.SITE_ADMIN_USERNAME && u.username === lc(env.SITE_ADMIN_USERNAME))
    || (env.SITE_ADMIN_EMAIL && realEmail(u.email) === lc(env.SITE_ADMIN_EMAIL)));
}
const isReserved = (env, username, email) => (env.SITE_ADMIN_USERNAME && username === lc(env.SITE_ADMIN_USERNAME))
  || (env.SITE_ADMIN_EMAIL && email && email === lc(env.SITE_ADMIN_EMAIL));

const publicUser = (u, env) => ({
  id: u.id, username: u.username, email: realEmail(u.email), name: u.name, role: u.role, status: u.status,
  householdId: u.household_id, householdName: u.household_name, householdStatus: u.household_status,
  siteAdmin: isSiteAdmin(env, u),
  shareDashboard: !!u.share_dashboard, mustChangePassword: !!u.must_change_password,
});

async function currentUser(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.*, h.name AS household_name, h.status AS household_status, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id JOIN households h ON h.id = u.household_id
     WHERE s.token_hash = ?`).bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  row.email = realEmail(row.email);
  return row;
}

async function startSession(env, userId) {
  const token = randomId(32);
  const expires = Date.now() + SESSION_DAYS * 86400000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, expires),
  ]);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function checkIdentity(env, username, email, selfId = '') {
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Choose a username of 3–30 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.');
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'That email address doesn\'t look right. Leave it blank if you don\'t want to add one.');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').bind(username, selfId).first()) throw new HttpError(409, 'That username is taken. Try another.');
  if (email && await env.DB.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').bind(email, selfId).first()) throw new HttpError(409, 'That email already has an account. Sign in instead.');
}

async function register(request, env) {
  const b = await body(request);
  const username = lc(str(b.username, 30));
  const email = lc(str(b.email, 120)) || null;
  const name = str(b.name, 60);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!name) throw new HttpError(400, 'Enter your name.');
  await checkIdentity(env, username, email);
  // The site admin may register once, with the site admin email (a secret), while no site admin account exists
  let siteAdminSignup = false;
  if (isReserved(env, username, email)) {
    const taken = await env.DB.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').bind(lc(env.SITE_ADMIN_USERNAME), lc(env.SITE_ADMIN_EMAIL) || '-').first();
    if (taken || !env.SITE_ADMIN_EMAIL || email !== lc(env.SITE_ADMIN_EMAIL) || str(b.join) || str(b.inviteCode)) throw new HttpError(409, 'That username or email is reserved. Choose another.');
    siteAdminSignup = true;
  }
  if (password.length < 8) throw new HttpError(400, 'Use a password of at least 8 characters.');

  const { hash, salt } = await hashPassword(password, Number(env.PBKDF2_ITERATIONS) || undefined);
  const id = randomId();
  let householdId, role, status, hname = null, joinedName = null;
  const join = str(b.join, 60) || str(b.inviteCode, 60); // household name or invite code
  if (join) {
    // An invite code first, then a household name (names are unique, ignoring case)
    const h = await env.DB.prepare("SELECT id, name FROM households WHERE invite_code = ? AND status = 'active'").bind(join.toUpperCase()).first()
      || await env.DB.prepare("SELECT id, name FROM households WHERE lower(name) = ? AND status = 'active'").bind(join.toLowerCase()).first();
    if (!h) throw new HttpError(404, 'No household with that name or invite code. Check the spelling with your household admin.');
    householdId = h.id; role = 'member'; status = 'pending';
    joinedName = h.name;
  } else {
    hname = str(b.householdName, 60) || `${name}'s household`;
    if (await env.DB.prepare("SELECT 1 FROM households WHERE lower(name) = ? AND status != 'rejected'").bind(hname.toLowerCase()).first()) throw new HttpError(409, `There's already a household called "${hname}". Choose a different name, or join it instead.`);
    householdId = randomId();
    // New households wait for the site admin
    await env.DB.prepare('INSERT INTO households (id, name, invite_code, status) VALUES (?, ?, ?, ?)').bind(householdId, hname, inviteCode(), siteAdminSignup ? 'active' : 'pending').run();
    role = 'admin'; status = 'active';
  }
  await env.DB.prepare(
    'INSERT INTO users (id, username, email, name, pass_hash, pass_salt, household_id, role, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, username, email || `nomail:${id}`, name, hash, salt, householdId, role, status).run();
  if (joinedName) {
    const { results: admins } = await env.DB.prepare("SELECT email FROM users WHERE household_id = ? AND role = 'admin' AND status = 'active'").bind(householdId).all();
    for (const a of admins) await notify(env, realEmail(a.email), `Vithai: ${name} wants to join "${joinedName}"`, `${name} (username ${username}) asked to join your household "${joinedName}".\n\nSign in to Vithai and open Household to approve or reject the request.`);
  }
  if (hname && !siteAdminSignup) await notify(env, env.SITE_ADMIN_EMAIL, `Vithai: new household "${hname}" waiting for approval`,
    `${name} (username ${username}${email ? `, ${email}` : ''}) started the household "${hname}".\n\nSign in to Vithai and open Site admin to approve or reject it.`);
  const cookie = await startSession(env, id);
  return json({ ok: true, status: siteAdminSignup ? 'active' : hname ? 'household-pending' : status }, 200, { 'set-cookie': cookie });
}

// Constant-time comparison for the optional SITE_ADMIN_PASSWORD recovery key
function sameString(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

async function login(request, env) {
  const b = await body(request);
  const id = lc(str(b.login ?? b.email ?? b.username, 120));
  const password = String(b.password || '');
  if (!id) throw new HttpError(400, 'Enter your username or email.');
  let u = await env.DB.prepare(id.includes('@') ? 'SELECT * FROM users WHERE email = ?' : 'SELECT * FROM users WHERE username = ?').bind(id).first();
  let ok = u && (await verifyPassword(password, u.pass_hash, u.pass_salt));

  // Site admin recovery key (like MealPilot's ADMIN_PASSWORD): always works, and creates the account the first time
  const adminId = id === lc(env.SITE_ADMIN_USERNAME) || (env.SITE_ADMIN_EMAIL && id === lc(env.SITE_ADMIN_EMAIL));
  if (!ok && adminId && env.SITE_ADMIN_PASSWORD && sameString(password, env.SITE_ADMIN_PASSWORD)) {
    if (!u && env.SITE_ADMIN_EMAIL) u = await env.DB.prepare('SELECT * FROM users WHERE email = ? OR username = ?').bind(lc(env.SITE_ADMIN_EMAIL), lc(env.SITE_ADMIN_USERNAME)).first();
    if (!u) u = await createSiteAdmin(env);
    ok = true;
  }
  if (!ok) throw new HttpError(401, 'Username/email or password is incorrect.');
  if (u.status === 'rejected') throw new HttpError(403, 'This account was not approved by the household admin.');
  const h = await env.DB.prepare('SELECT status FROM households WHERE id = ?').bind(u.household_id).first();
  if (h?.status === 'rejected') throw new HttpError(403, 'This household was not approved by the site admin.');

  // The site admin's account takes the SITE_ADMIN_USERNAME if it's free
  if (isSiteAdmin(env, u) && env.SITE_ADMIN_USERNAME && u.username !== lc(env.SITE_ADMIN_USERNAME)
    && !(await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(lc(env.SITE_ADMIN_USERNAME)).first())) {
    await env.DB.prepare('UPDATE users SET username = ? WHERE id = ?').bind(lc(env.SITE_ADMIN_USERNAME), u.id).run();
  }
  if (isSiteAdmin(env, u) && h?.status !== 'active') await env.DB.prepare("UPDATE households SET status = 'active' WHERE id = ?").bind(u.household_id).run();
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, u.id) });
}

async function createSiteAdmin(env) {
  const uname = lc(env.SITE_ADMIN_USERNAME) || 'siteadmin';
  const id = randomId(), hid = randomId();
  const { hash, salt } = await hashPassword(randomId(16), Number(env.PBKDF2_ITERATIONS) || undefined);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO households (id, name, invite_code, status) VALUES (?, ?, ?, 'active')").bind(hid, `${uname}'s household`, inviteCode()),
    env.DB.prepare("INSERT INTO users (id, username, email, name, pass_hash, pass_salt, household_id, role, status, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 'admin', 'active', 1)")
      .bind(id, uname, lc(env.SITE_ADMIN_EMAIL) || `nomail:${id}`, uname, hash, salt, hid),
  ]);
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

// Change your own username, email or display name
async function updateAccount(request, env, me) {
  const b = await body(request);
  const username = b.username !== undefined ? lc(str(b.username, 30)) : me.username;
  const email = b.email !== undefined ? (lc(str(b.email, 120)) || null) : me.email;
  const name = b.name !== undefined ? str(b.name, 60) : me.name;
  if (!name) throw new HttpError(400, 'Enter your name.');
  await checkIdentity(env, username, email, me.id);
  if (!isSiteAdmin(env, me) && isReserved(env, username, email)) throw new HttpError(409, 'That username or email is reserved. Choose another.');
  if (isSiteAdmin(env, me) && env.SITE_ADMIN_USERNAME && username !== lc(env.SITE_ADMIN_USERNAME) && !(env.SITE_ADMIN_EMAIL && email === lc(env.SITE_ADMIN_EMAIL))) throw new HttpError(400, 'The site admin keeps the site admin username or email.');
  await env.DB.prepare('UPDATE users SET username = ?, email = ?, name = ? WHERE id = ?').bind(username, email || `nomail:${me.id}`, name, me.id).run();
  return json({ ok: true, user: { ...publicUser({ ...me, username, email, name }, env) } });
}

// Plain email notification via Resend (skipped when email isn't set up or there's no address)
async function notify(env, to, subject, text) {
  if (!env.RESEND_API_KEY || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM || 'Vithai <onboarding@resend.dev>', to: [to], subject, text }),
    });
    return r.ok;
  } catch { return false; }
}

// Counts shown as red badges in the menu: households waiting for the site admin, members waiting for a household admin
async function badges(env, me) {
  const [h, u] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM households WHERE status = 'pending'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE household_id = ? AND status = 'pending'").bind(me.household_id),
  ]);
  return json({ site: isSiteAdmin(env, me) ? h.results[0].n : 0, household: me.role === 'admin' ? u.results[0].n : 0 });
}

// ---------------------------------------------------------------- site admin
async function siteAdminRoute(request, env, me, rest, method) {
  if (!isSiteAdmin(env, me)) throw new HttpError(403, 'Only the site admin can do that.');
  if (rest === 'households' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT h.id, h.name, h.status, h.created_at,
         (SELECT COUNT(*) FROM users u WHERE u.household_id = h.id AND u.status = 'active') AS members,
         (SELECT name FROM users u WHERE u.household_id = h.id AND u.role = 'admin' ORDER BY created_at LIMIT 1) AS owner_name,
         (SELECT username FROM users u WHERE u.household_id = h.id AND u.role = 'admin' ORDER BY created_at LIMIT 1) AS owner_username,
         (SELECT email FROM users u WHERE u.household_id = h.id AND u.role = 'admin' ORDER BY created_at LIMIT 1) AS owner_email
       FROM households h ORDER BY CASE h.status WHEN 'pending' THEN 0 ELSE 1 END, h.created_at DESC`).all();
    return json({ households: results.map((r) => ({ ...r, owner_email: realEmail(r.owner_email), mine: r.id === me.household_id })) });
  }
  const [, hid, action] = rest.match(/^households\/([^/]+)\/(approve|reject|suspend|reactivate)$/) || [];
  if (!hid || method !== 'POST') throw new HttpError(404, 'Not found');
  if (hid === me.household_id) throw new HttpError(400, 'You can\'t change your own household\'s status.');
  const h = await env.DB.prepare('SELECT * FROM households WHERE id = ?').bind(hid).first();
  if (!h) throw new HttpError(404, 'Household not found.');
  const status = { approve: 'active', reactivate: 'active', reject: 'rejected', suspend: 'suspended' }[action];
  const stmts = [env.DB.prepare('UPDATE households SET status = ? WHERE id = ?').bind(status, hid)];
  if (status !== 'active') stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE household_id = ?)').bind(hid));
  await env.DB.batch(stmts);
  const owner = await env.DB.prepare("SELECT name, email FROM users WHERE household_id = ? AND role = 'admin' ORDER BY created_at LIMIT 1").bind(hid).first();
  const words = { approve: 'was approved. You can now sign in and start using Vithai.', reactivate: 'was reactivated.', reject: 'was not approved.', suspend: 'was suspended by the site admin.' }[action];
  const emailed = await notify(env, realEmail(owner?.email), `Vithai: your household "${h.name}" ${action === 'approve' ? 'is approved' : action === 'reject' ? 'was not approved' : action === 'suspend' ? 'is suspended' : 'is active again'}`, `Hi ${owner?.name || ''},\n\nYour Vithai household "${h.name}" ${words}`);
  return json({ ok: true, status, emailed });
}

async function logout(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

async function changePassword(request, env, me) {
  const b = await body(request);
  if (!(await verifyPassword(String(b.current || ''), me.pass_hash, me.pass_salt))) throw new HttpError(401, 'Your current password is incorrect.');
  if (typeof b.next !== 'string' || b.next.length < 8) throw new HttpError(400, 'Use a new password of at least 8 characters.');
  const { hash, salt } = await hashPassword(b.next, Number(env.PBKDF2_ITERATIONS) || undefined);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, must_change_password = 0 WHERE id = ?').bind(hash, salt, me.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(me.id),
  ]);
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, me.id) });
}

// ---------------------------------------------------------------- household
async function getHousehold(env, me) {
  const h = await env.DB.prepare('SELECT id, name, invite_code FROM households WHERE id = ?').bind(me.household_id).first();
  const { results } = await env.DB.prepare(
    'SELECT id, username, name, email, role, status, share_dashboard, created_at FROM users WHERE household_id = ? AND status != ? ORDER BY created_at',
  ).bind(me.household_id, 'rejected').all();
  return json({
    household: { id: h.id, name: h.name, inviteCode: me.role === 'admin' ? h.invite_code : null },
    members: results.map((r) => ({
      id: r.id, name: r.name, role: r.role, status: r.status, shareDashboard: !!r.share_dashboard,
      username: r.username, email: me.role === 'admin' || r.id === me.id ? realEmail(r.email) : null,
    })),
  });
}

async function setSharing(request, env, me) {
  const b = await body(request);
  await env.DB.prepare('UPDATE users SET share_dashboard = ? WHERE id = ?').bind(b.share ? 1 : 0, me.id).run();
  return json({ ok: true, shareDashboard: !!b.share });
}

async function memberAction(request, env, me, rest, method) {
  if (me.role !== 'admin') throw new HttpError(403, 'Only the household admin can do that.');
  const [id, action] = rest.split('/');
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND household_id = ?').bind(id, me.household_id).first();
  if (!target) throw new HttpError(404, 'Member not found.');
  if (method !== 'POST') throw new HttpError(405, 'Method not allowed');
  if (target.id === me.id && action !== 'reset-password') throw new HttpError(400, 'You cannot change your own role or approval.');
  if (action === 'approve') await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(id).run();
  else if (action === 'reject') await env.DB.batch([
    env.DB.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").bind(id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]);
  else if (action === 'make-admin') await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(id).run();
  else if (action === 'make-member') await env.DB.prepare("UPDATE users SET role = 'member' WHERE id = ?").bind(id).run();
  else if (action === 'reset-password') {
    const temp = randomId(5);
    const { hash, salt } = await hashPassword(temp, Number(env.PBKDF2_ITERATIONS) || undefined);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, must_change_password = 1 WHERE id = ?').bind(hash, salt, id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]);
    return json({ ok: true, tempPassword: temp });
  } else throw new HttpError(404, 'Unknown action');
  return json({ ok: true });
}

async function memberPortfolio(env, me, id) {
  const target = await env.DB.prepare('SELECT id, name, share_dashboard, household_id FROM users WHERE id = ?').bind(id).first();
  if (!target || target.household_id !== me.household_id) throw new HttpError(404, 'Member not found.');
  if (target.id !== me.id && !target.share_dashboard) throw new HttpError(403, `${target.name} hasn't shared their dashboard.`);
  return json({ member: { id: target.id, name: target.name }, settings: await getSettings(env, id), transactions: await listTx(env, id) });
}

// ---------------------------------------------------------------- settings
async function getSettings(env, userId) {
  const row = await env.DB.prepare('SELECT data FROM settings WHERE user_id = ?').bind(userId).first();
  const saved = row ? JSON.parse(row.data) : {};
  return { ...DEFAULT_SETTINGS, ...saved, alloc: { ...DEFAULT_SETTINGS.alloc, ...(saved.alloc || {}) } };
}

async function putSettings(request, env, me) {
  const b = await body(request);
  const s = await getSettings(env, me.id);
  if (b.monthlyTotal !== undefined) { const v = num(b.monthlyTotal); if (v === null || v < 0) throw new HttpError(400, 'Monthly total must be a positive number.'); s.monthlyTotal = v; }
  if (b.alloc) {
    const a = {};
    for (const k of SLOTS) { const v = num(b.alloc[k]); a[k] = v === null ? 0 : Math.max(0, Math.min(100, v)); }
    s.alloc = a;
  }
  if (Array.isArray(b.excludedAmcs)) s.excludedAmcs = b.excludedAmcs.map((x) => str(x, 120)).filter(Boolean).slice(0, 100);
  if (b.criteria && typeof b.criteria === 'object') s.criteria = b.criteria;
  if (b.picks && typeof b.picks === 'object') s.picks = Object.fromEntries(Object.entries(b.picks).filter(([k, v]) => SLOTS.includes(k) && v).map(([k, v]) => [k, String(v)]));
  if (b.riskFree !== undefined && num(b.riskFree) !== null) s.riskFree = num(b.riskFree);
  if (b.usSlot !== undefined) s.usSlot = !!b.usSlot;
  if (b.usdInr !== undefined) s.usdInr = num(b.usdInr) > 0 ? num(b.usdInr) : null;
  if (Array.isArray(b.usBasket)) s.usBasket = b.usBasket.slice(0, 100).map((x) => ({ key: str(x.key, 200), name: str(x.name, 200), weight: Math.max(0, num(x.weight) ?? 1) })).filter((x) => x.key);
  if (b.stockCriteria && typeof b.stockCriteria === 'object') s.stockCriteria = b.stockCriteria;
  if (b.niftyPlan && typeof b.niftyPlan === 'object') s.niftyPlan = b.niftyPlan;
  if (!s.usSlot) s.alloc.usstocks = 0;
  const data = JSON.stringify(s);
  if (data.length > 50000) throw new HttpError(400, 'Settings too large.');
  await env.DB.prepare(
    "INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  ).bind(me.id, data).run();
  return json({ settings: s });
}

// ---------------------------------------------------------------- funds & facts
async function getFunds(env, me) {
  const hid = me.household_id;
  const [schemes, facts, meta] = await env.DB.batch([
    env.DB.prepare('SELECT code, name, amc, category, slot, nav, nav_date, metrics FROM schemes'),
    env.DB.prepare('SELECT code, source, data, updated_at FROM fund_facts'),
    env.DB.prepare('SELECT key, value FROM meta WHERE key IN (?, ?, ?)').bind('lastRefresh', `tickertapeUploadedAt:${hid}`, `tickertape:${hid}`),
  ]);
  const raw = Object.fromEntries(meta.results.map((r) => [r.key, r.value]));
  const metaMap = { lastRefresh: raw.lastRefresh, tickertapeUploadedAt: raw[`tickertapeUploadedAt:${hid}`] };
  const tt = raw[`tickertape:${hid}`] ? JSON.parse(raw[`tickertape:${hid}`]) : {};
  // Priority: tickertape (monthly upload; fills gaps) < seed (researched Direct-plan figures) < manual (typed in the app)
  const layers = { seed: new Map(), manual: new Map() };
  for (const f of facts.results) {
    if (f.source === 'seed') layers.seed.set(f.code, JSON.parse(f.data));
    else if (f.source === `manual:${hid}`) layers.manual.set(f.code, JSON.parse(f.data)); // only my household's edits
  }
  const merge = (code, ttFacts) => {
    const out = { sources: {} };
    for (const [src, d] of [['tickertape', ttFacts], ['seed', layers.seed.get(code)], ['manual', layers.manual.get(code)]]) {
      if (!d) continue;
      for (const [k, v] of Object.entries(d)) {
        if (v === null || v === undefined || v === '') continue;
        out[k] = v; out.sources[k] = src;
      }
    }
    return out;
  };
  let matched = 0;
  const funds = schemes.results.map((s) => {
    const ttFacts = tt[nameKey(cleanName(s.name))];
    if (ttFacts) matched++;
    return {
      code: s.code, name: cleanName(s.name), fullName: s.name, amc: s.amc, category: s.category, slot: s.slot,
      nav: s.nav, navDate: s.nav_date, ...JSON.parse(s.metrics), facts: merge(s.code, ttFacts),
    };
  });
  metaMap.tickertapeMatched = matched;
  return json({ funds, meta: metaMap });
}

const FACT_FIELDS = ['expenseRatio', 'aum', 'exitLoad', 'exitLoadText', 'status', 'notes', 'asOf'];
async function putFacts(request, env, me, code) {
  if (me.role !== 'admin') throw new HttpError(403, 'Only household admins can edit fund facts.');
  if (!(await env.DB.prepare('SELECT 1 FROM schemes WHERE code = ?').bind(code).first())) throw new HttpError(404, 'Unknown fund.');
  const b = await body(request);
  const d = {};
  for (const k of FACT_FIELDS) {
    if (b[k] === undefined || b[k] === '' || b[k] === null) continue;
    d[k] = ['expenseRatio', 'aum', 'exitLoad'].includes(k) ? num(b[k]) : str(b[k], 300);
  }
  d.asOf = d.asOf || new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    "INSERT INTO fund_facts (code, source, data, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(code, source) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  ).bind(code, `manual:${me.household_id}`, JSON.stringify(d)).run();
  return json({ ok: true });
}

// Tickertape upload: the browser parses the Excel export and sends compact rows
// { name, sub, facts }. They're stored as one JSON blob (keyed by normalised name) and merged
// into each fund at read time, so an upload is a single database write.
async function uploadTickertape(request, env, me) {
  if (me.role !== 'admin') throw new HttpError(403, 'Only household admins can upload data.');
  const b = await body(request);
  if (!Array.isArray(b.rows) || !b.rows.length) throw new HttpError(400, 'No rows found in the upload.');
  const map = {};
  for (const r of b.rows.slice(0, 20000)) {
    const key = nameKey(r.name);
    if (key && r.facts && typeof r.facts === 'object') map[key] = r.facts;
  }
  const blob = JSON.stringify(map);
  if (blob.length > 1800000) throw new HttpError(413, 'The upload is too large. Export only Growth plans, or fewer columns.');
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(`tickertape:${me.household_id}`, blob),
    env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(`tickertapeUploadedAt:${me.household_id}`, now),
  ]);
  const { results } = await env.DB.prepare('SELECT name FROM schemes').all();
  const matched = results.filter((s) => map[nameKey(cleanName(s.name))]).length;
  return json({ ok: true, rows: Object.keys(map).length, matched, totalSchemes: results.length });
}

// ---------------------------------------------------------------- data ingest (GitHub Action)
// One SQL statement per request (json_each), to stay well inside D1's per-request query limits.
async function ingest(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!env.INGEST_TOKEN || !safeEqual(auth, `Bearer ${env.INGEST_TOKEN}`)) throw new HttpError(401, 'Bad ingest token');
  const b = await body(request);
  const schemes = (Array.isArray(b.schemes) ? b.schemes : []).filter((s) => SLOTS.includes(s.slot) && s.code).map((s) => ({
    code: String(s.code), name: str(s.name, 300), amc: str(s.amc, 200), category: str(s.category, 200), slot: s.slot,
    nav: num(s.nav), navDate: str(s.navDate, 10), metrics: JSON.stringify(s.metrics || {}),
  }));
  const stmts = [];
  if (schemes.length) stmts.push(env.DB.prepare(
    `INSERT INTO schemes (code, name, amc, category, slot, nav, nav_date, metrics, updated_at)
     SELECT json_extract(value, '$.code'), json_extract(value, '$.name'), json_extract(value, '$.amc'),
            json_extract(value, '$.category'), json_extract(value, '$.slot'), json_extract(value, '$.nav'),
            json_extract(value, '$.navDate'), json_extract(value, '$.metrics'), datetime('now')
     FROM json_each(?) WHERE true
     ON CONFLICT(code) DO UPDATE SET name=excluded.name, amc=excluded.amc, category=excluded.category, slot=excluded.slot,
       nav=excluded.nav, nav_date=excluded.nav_date, metrics=excluded.metrics, updated_at=excluded.updated_at`,
  ).bind(JSON.stringify(schemes)));
  const seed = (Array.isArray(b.seedFacts) ? b.seedFacts : []).map((f) => ({ code: String(f.code), data: JSON.stringify(f.data || {}) }));
  if (seed.length) stmts.push(env.DB.prepare(
    `INSERT INTO fund_facts (code, source, data, updated_at)
     SELECT json_extract(value, '$.code'), 'seed', json_extract(value, '$.data'), datetime('now') FROM json_each(?) WHERE true
     ON CONFLICT(code, source) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).bind(JSON.stringify(seed)));
  if (b.final) {
    stmts.push(env.DB.prepare("DELETE FROM schemes WHERE updated_at < datetime('now', '-7 days')"));
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastRefresh', ?)").bind(str(b.generatedAt, 40) || new Date().toISOString()));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, upserted: schemes.length, seedFacts: seed.length });
}

// ---------------------------------------------------------------- Tickertape datasets (KV)
// Each dataset is a gzipped JSON table built in the browser from the Tickertape CSV exports.
// The Worker only streams bytes in and out, so it stays within the free plan's CPU limit.
function needKV(env) {
  if (!env.DATA) throw new HttpError(501, 'Data storage is not set up yet. Create the KV namespace (see the README) and redeploy.');
}

async function listDatasets(env, me) {
  needKV(env);
  const prefix = `hh:${me.household_id}:dataset:`;
  const { keys } = await env.DATA.list({ prefix });
  const out = Object.fromEntries(MARKETS.map((m) => [m, null]));
  for (const k of keys) out[k.name.slice(prefix.length)] = k.metadata || {};
  return json({ datasets: out });
}

async function getDataset(env, me, mkt) {
  needKV(env);
  if (!MARKETS.includes(mkt)) throw new HttpError(404, 'Unknown dataset.');
  const { value, metadata } = await env.DATA.getWithMetadata(`hh:${me.household_id}:dataset:${mkt}`, { type: 'stream' });
  if (!value) throw new HttpError(404, 'No data loaded yet. Load your Tickertape exports on the Data page.');
  return new Response(value, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-dataset-meta': encodeURIComponent(JSON.stringify(metadata || {})) } });
}

async function putDataset(request, env, me, mkt) {
  needKV(env);
  if (me.role !== 'admin') throw new HttpError(403, 'Only household admins can load data.');
  if (!MARKETS.includes(mkt)) throw new HttpError(404, 'Unknown dataset.');
  const size = Number(request.headers.get('content-length') || 0);
  if (size > 24 * 1024 * 1024) throw new HttpError(413, 'Dataset too large (max 24 MB compressed).');
  const metadata = {
    rows: num(request.headers.get('x-rows')), cols: num(request.headers.get('x-cols')),
    files: str(decodeURIComponent(request.headers.get('x-files') || ''), 500), missing: str(decodeURIComponent(request.headers.get('x-missing') || ''), 500), uploadedAt: new Date().toISOString(), by: me.name, bytes: size,
  };
  await env.DATA.put(`hh:${me.household_id}:dataset:${mkt}`, request.body, { metadata });
  return json({ ok: true, metadata });
}

// Column mapping chosen at import (key fields, renames, excluded columns), reused next time
async function getColmap(env, me, kind) {
  if (!MARKETS.includes(kind)) throw new HttpError(404, 'Unknown dataset.');
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(`colmap:${me.household_id}:${kind}`).first();
  return json({ map: row ? JSON.parse(row.value) : null });
}
async function putColmap(request, env, me, kind) {
  if (me.role !== 'admin') throw new HttpError(403, 'Only household admins can change the column mapping.');
  if (!MARKETS.includes(kind)) throw new HttpError(404, 'Unknown dataset.');
  const b = await body(request);
  const clean = {
    keys: Object.fromEntries(Object.entries(b.keys || {}).map(([k, v]) => [str(k, 40), v ? str(v, 300) : null])),
    renames: Object.fromEntries(Object.entries(b.renames || {}).slice(0, 1000).map(([k, v]) => [str(k, 300), str(v, 120)])),
    excluded: (Array.isArray(b.excluded) ? b.excluded : []).slice(0, 1000).map((x) => str(x, 300)),
    savedAt: new Date().toISOString(),
  };
  const v = JSON.stringify(clean);
  if (v.length > 400000) throw new HttpError(413, 'Mapping too large.');
  await env.DB.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(`colmap:${me.household_id}:${kind}`, v).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------- Nifty 50
// Each household keeps its own Nifty 50 list (weights and prices), seeded from the defaults
async function getNifty(env, me) {
  const hid = me.household_id;
  const q = () => env.DB.prepare('SELECT symbol, name, weight, ltp, updated_at FROM household_nifty50 WHERE household_id = ? ORDER BY weight DESC').bind(hid).all();
  let { results } = await q();
  if (!results.length) {
    await env.DB.prepare('INSERT OR IGNORE INTO household_nifty50 (household_id, symbol, name, weight, ltp) SELECT ?, symbol, name, weight, ltp FROM nifty50').bind(hid).run();
    ({ results } = await q());
  }
  return json({ stocks: results });
}

async function putNifty(request, env, me) {
  if (me.role !== 'admin') throw new HttpError(403, 'Only household admins can update Nifty 50 data.');
  const hid = me.household_id;
  const b = await body(request);
  if (!Array.isArray(b.rows) || !b.rows.length) throw new HttpError(400, 'No rows.');
  const rows = b.rows.slice(0, 100).map((r) => ({ symbol: str(r.symbol, 30).toUpperCase(), weight: num(r.weight), ltp: num(r.ltp), name: str(r.name, 120) || null })).filter((r) => r.symbol);
  const stmts = [];
  if (b.replaceWeights) {
    if (rows.some((r) => r.weight === null)) throw new HttpError(400, 'Every row needs a weight when replacing the constituents.');
    stmts.push(env.DB.prepare('DELETE FROM household_nifty50 WHERE household_id = ?').bind(hid));
  }
  const payload = JSON.stringify(rows);
  // New symbols (need a weight), then weight, price and name updates where supplied
  stmts.push(env.DB.prepare(
    `INSERT OR IGNORE INTO household_nifty50 (household_id, symbol, name, weight, ltp)
     SELECT ?1, json_extract(value, '$.symbol'), json_extract(value, '$.name'), json_extract(value, '$.weight'), json_extract(value, '$.ltp')
     FROM json_each(?2) WHERE json_extract(value, '$.weight') IS NOT NULL`).bind(hid, payload));
  stmts.push(env.DB.prepare(
    `UPDATE household_nifty50 SET updated_at = datetime('now'),
       weight = COALESCE((SELECT json_extract(value, '$.weight') FROM json_each(?2) WHERE json_extract(value, '$.symbol') = household_nifty50.symbol), weight),
       ltp = COALESCE((SELECT json_extract(value, '$.ltp') FROM json_each(?2) WHERE json_extract(value, '$.symbol') = household_nifty50.symbol), ltp),
       name = COALESCE((SELECT json_extract(value, '$.name') FROM json_each(?2) WHERE json_extract(value, '$.symbol') = household_nifty50.symbol), name)
     WHERE household_id = ?1 AND symbol IN (SELECT json_extract(value, '$.symbol') FROM json_each(?2))`).bind(hid, payload));
  await env.DB.batch(stmts);
  return getNifty(env, me);
}

// ---------------------------------------------------------------- monthly plans
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
async function getPlan(env, me, month) {
  if (!MONTH_RE.test(month)) throw new HttpError(400, 'Month must look like 2026-11.');
  const [cur, prev] = await env.DB.batch([
    env.DB.prepare('SELECT month, data, updated_at FROM plans WHERE user_id = ? AND month = ?').bind(me.id, month),
    env.DB.prepare('SELECT month, data FROM plans WHERE user_id = ? AND month < ? ORDER BY month DESC LIMIT 1').bind(me.id, month),
  ]);
  const c = cur.results[0], pr = prev.results[0];
  return json({ plan: c ? { month: c.month, updatedAt: c.updated_at, ...JSON.parse(c.data) } : null, previous: pr ? { month: pr.month, ...JSON.parse(pr.data) } : null });
}
async function putPlan(request, env, me, month) {
  if (!MONTH_RE.test(month)) throw new HttpError(400, 'Month must look like 2026-11.');
  const b = await body(request);
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200).map((l) => ({
    id: str(l.id, 40) || randomId(6), slot: SLOTS.includes(l.slot) ? l.slot : null,
    assetId: str(l.assetId, 300), assetName: str(l.assetName, 200), amount: Math.max(0, num(l.amount) ?? 0),
  })).filter((l) => l.slot && l.assetId);
  const data = JSON.stringify({ lines, note: str(b.note, 1000) });
  await env.DB.prepare(
    "INSERT INTO plans (user_id, month, data, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id, month) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
  ).bind(me.id, month, data).run();
  return json({ ok: true, plan: { month, lines } });
}
async function delPlan(env, me, month) {
  await env.DB.prepare('DELETE FROM plans WHERE user_id = ? AND month = ?').bind(me.id, month).run();
  return json({ ok: true });
}

// ---------------------------------------------------------------- backup & delete
async function buildBackup(env, me, scope) {
  if (scope === 'household' && me.role !== 'admin') throw new HttpError(403, 'Only the household admin can back up the whole household.');
  const users = scope === 'household'
    ? (await env.DB.prepare('SELECT id, username, name, email, role, status, share_dashboard, created_at FROM users WHERE household_id = ?').bind(me.household_id).all()).results.map((u) => ({ ...u, email: realEmail(u.email) }))
    : [{ id: me.id, username: me.username, name: me.name, email: me.email, role: me.role, status: me.status, share_dashboard: me.share_dashboard, created_at: me.created_at }];
  const people = [];
  for (const u of users) {
    const [st, pl, tx] = await env.DB.batch([
      env.DB.prepare('SELECT data FROM settings WHERE user_id = ?').bind(u.id),
      env.DB.prepare('SELECT month, data, updated_at FROM plans WHERE user_id = ? ORDER BY month').bind(u.id),
      env.DB.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY trade_date').bind(u.id),
    ]);
    people.push({
      user: u, settings: st.results[0] ? JSON.parse(st.results[0].data) : null,
      plans: pl.results.map((r) => ({ month: r.month, updatedAt: r.updated_at, ...JSON.parse(r.data) })),
      transactions: tx.results.map(({ user_id, ...t }) => t), // eslint-disable-line no-unused-vars
    });
  }
  const out = { app: 'Vithai', version: 1, scope, exportedAt: new Date().toISOString(), exportedBy: me.username, people };
  if (scope === 'household') {
    const hid = me.household_id;
    const [hh, nifty, metaRows, facts] = await env.DB.batch([
      env.DB.prepare('SELECT id, name, created_at FROM households WHERE id = ?').bind(hid),
      env.DB.prepare('SELECT symbol, name, weight, ltp, updated_at FROM household_nifty50 WHERE household_id = ?').bind(hid),
      env.DB.prepare("SELECT key, value FROM meta WHERE key LIKE 'colmap:' || ? || ':%' OR key = 'tickertapeUploadedAt:' || ?").bind(hid, hid),
      env.DB.prepare('SELECT code, data, updated_at FROM fund_facts WHERE source = ?').bind(`manual:${hid}`),
    ]);
    out.household = { ...hh.results[0], nifty50: nifty.results, columnMaps: metaRows.results, fundFactEdits: facts.results };
    if (env.DATA) {
      const { keys } = await env.DATA.list({ prefix: `hh:${hid}:dataset:` });
      out.household.tickertapeImports = keys.map((k) => ({ dataset: k.name.split(':').pop(), ...k.metadata }));
    }
  }
  return out;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function emailBackup(env, to, backup, label, beforeDelete = true) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'Email is not set up for this site (see README).' };
  if (!to) return { sent: false, reason: 'Your account has no email address. Add one on the Household page to receive backups by email.' };
  const name = `vithai-backup-${backup.scope}-${backup.exportedAt.slice(0, 10)}.json`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Vithai <onboarding@resend.dev>', to: [to],
      subject: beforeDelete ? `Vithai backup before deleting ${label}` : `Vithai backup of ${label}`,
      text: beforeDelete ? `Attached is a full backup of ${label}, taken ${backup.exportedAt} just before it was deleted.\n\nKeep this file: it is the only copy.` : `Attached is a full backup of ${label}, taken ${backup.exportedAt}.`,
      attachments: [{ filename: name, content: toBase64(JSON.stringify(backup, null, 1)) }],
    }),
  });
  return res.ok ? { sent: true } : { sent: false, reason: `Email failed (${res.status}): ${(await res.text()).slice(0, 200)}` };
}

// Your own backup goes to your email; a household backup can only be requested by an admin and goes to that admin
async function emailBackupNow(request, env, me) {
  const b = await body(request);
  const scope = b.scope === 'household' ? 'household' : 'me';
  const backup = await buildBackup(env, me, scope);
  const label = scope === 'household' ? `all data for the household "${me.household_name}"` : `all of ${me.name}'s Vithai data`;
  const mail = await emailBackup(env, me.email, backup, label, false);
  if (!mail.sent) throw new HttpError(503, mail.reason);
  return json({ ok: true, to: me.email });
}

async function deleteData(request, env, me) {
  const b = await body(request);
  const scope = b.scope === 'household' ? 'household' : 'me';
  if (str(b.confirm, 20) !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
  const backup = await buildBackup(env, me, scope);
  const label = scope === 'household' ? `all data for the household "${me.household_name}"` : `all of ${me.name}'s Vithai data`;
  const mail = await emailBackup(env, me.email, backup, label);
  // Without email, only delete once the browser confirms it saved the backup file
  if (!mail.sent && !b.backupDownloaded) throw new HttpError(409, `${mail.reason} Download the backup first, then confirm again.`);
  const ids = scope === 'household' ? backup.people.map((p) => p.user.id) : [me.id];
  const stmts = [];
  for (const id of ids) {
    stmts.push(env.DB.prepare('DELETE FROM transactions WHERE user_id = ?').bind(id));
    stmts.push(env.DB.prepare('DELETE FROM plans WHERE user_id = ?').bind(id));
    stmts.push(env.DB.prepare('DELETE FROM settings WHERE user_id = ?').bind(id));
  }
  if (scope === 'household') {
    const hid = me.household_id;
    stmts.push(env.DB.prepare('DELETE FROM household_nifty50 WHERE household_id = ?').bind(hid));
    stmts.push(env.DB.prepare("DELETE FROM meta WHERE key LIKE 'colmap:' || ? || ':%' OR key IN ('tickertape:' || ?, 'tickertapeUploadedAt:' || ?)").bind(hid, hid, hid));
    stmts.push(env.DB.prepare('DELETE FROM fund_facts WHERE source = ?').bind(`manual:${hid}`));
  }
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  if (scope === 'household' && env.DATA) {
    const { keys } = await env.DATA.list({ prefix: `hh:${me.household_id}:dataset:` });
    for (const k of keys) await env.DATA.delete(k.name);
  }
  return json({ ok: true, emailed: mail.sent, emailNote: mail.sent ? `A backup was emailed to ${me.email}.` : mail.reason });
}

// ---------------------------------------------------------------- transactions
async function listTx(env, userId, month) {
  const q = month
    ? env.DB.prepare('SELECT * FROM transactions WHERE user_id = ? AND month = ? ORDER BY trade_date, created_at').bind(userId, month)
    : env.DB.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY trade_date, created_at').bind(userId);
  const { results } = await q.all();
  return results.map((t) => ({
    id: t.id, tradeDate: t.trade_date, month: t.month, slot: t.slot, assetId: t.asset_id, assetName: t.asset_name,
    units: t.units, price: t.price, amount: t.amount, note: t.note,
  }));
}

function readTx(b) {
  const slot = str(b.slot, 20);
  if (!SLOTS.includes(slot)) throw new HttpError(400, 'Unknown slot.');
  const tradeDate = str(b.tradeDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new HttpError(400, 'Enter the purchase date.');
  const month = /^\d{4}-\d{2}$/.test(str(b.month, 7)) ? str(b.month, 7) : tradeDate.slice(0, 7);
  const units = num(b.units), price = num(b.price);
  if (!(units > 0)) throw new HttpError(400, 'Units must be more than zero.');
  if (!(price > 0)) throw new HttpError(400, 'Enter the NAV or price you paid.');
  const amount = num(b.amount) > 0 ? num(b.amount) : Math.round(units * price * 100) / 100;
  return { slot, tradeDate, month, units, price, amount, assetId: str(b.assetId, 300), assetName: str(b.assetName, 200) || str(b.assetId, 300), note: str(b.note, 300) || null };
}

async function addTx(request, env, me) {
  const t = readTx(await body(request));
  const id = randomId();
  await env.DB.prepare(
    'INSERT INTO transactions (id, user_id, trade_date, month, slot, asset_id, asset_name, units, price, amount, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, me.id, t.tradeDate, t.month, t.slot, t.assetId, t.assetName, t.units, t.price, t.amount, t.note).run();
  return json({ ok: true, id });
}

async function editTx(request, env, me, id) {
  const t = readTx(await body(request));
  const r = await env.DB.prepare(
    'UPDATE transactions SET trade_date = ?, month = ?, slot = ?, asset_id = ?, asset_name = ?, units = ?, price = ?, amount = ?, note = ? WHERE id = ? AND user_id = ?',
  ).bind(t.tradeDate, t.month, t.slot, t.assetId, t.assetName, t.units, t.price, t.amount, t.note, id, me.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Purchase not found.');
  return json({ ok: true });
}

async function delTx(env, me, id) {
  const r = await env.DB.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(id, me.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Purchase not found.');
  return json({ ok: true });
}
