// Password hashing (PBKDF2-SHA256) and session helpers, using Web Crypto in Workers.

const enc = new TextEncoder();
export const DEFAULT_ITERATIONS = 100000; // Cloudflare Workers' maximum for PBKDF2

export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const randomId = (bytes = 16) => {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
};

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

// Stored as "iterations$hash" in pass_hash and the salt separately, so the cost can change later
export async function hashPassword(password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: `${iterations}$${await pbkdf2(password, salt, iterations)}`, salt: b64(salt) };
}

export async function verifyPassword(password, stored, saltB64) {
  const [iterStr, expected] = String(stored).split('$');
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const got = await pbkdf2(password, salt, Number(iterStr));
  return safeEqual(got, expected);
}

// Constant-time comparison of two strings
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256(text) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export const SESSION_COOKIE = 'vithai_session';
export const SESSION_DAYS = 30;

export function sessionCookie(token, maxAgeSec) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Invite codes: short, unambiguous characters
export function inviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint8Array(8));
  return [...a].map((x) => chars[x % chars.length]).join('');
}
