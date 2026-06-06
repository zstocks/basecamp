import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.APP_SECRET;
const PASSWORD = process.env.APP_PASSWORD;
const COOKIE_NAME = 'basecamp_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';

// Fail fast at startup rather than silently accepting empty values at runtime.
if (!SECRET || SECRET.length < 32) {
  throw new Error('APP_SECRET env var is required (at least 32 chars)');
}
if (!PASSWORD || PASSWORD.length < 1) {
  throw new Error('APP_PASSWORD env var is required');
}

function hmac(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

export function signCookieValue(issueTime = Date.now()) {
  const payload = String(issueTime);
  return `${payload}.${hmac(payload)}`;
}

export function verifyCookieValue(value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;

  const payload = value.slice(0, dot);
  const providedSig = value.slice(dot + 1);
  const expectedSig = hmac(payload);

  // timingSafeEqual requires equal-length buffers
  if (providedSig.length !== expectedSig.length) return null;
  const a = Buffer.from(providedSig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  const issueTime = Number(payload);
  if (!Number.isFinite(issueTime)) return null;
  if (Date.now() - issueTime > MAX_AGE_MS) return null;

  return { issueTime };
}

export function verifyPassword(provided) {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(PASSWORD);
  if (a.length !== b.length) return false; // length leak is unavoidable; not the secret
  return timingSafeEqual(a, b);
}

export function buildSetCookieHeader({ value, clear = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=${clear ? '' : value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function isAuthenticated(req) {
  const cookie = readCookie(req);
  return cookie ? !!verifyCookieValue(cookie) : false;
}