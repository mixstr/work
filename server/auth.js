'use strict';

const crypto = require('crypto');
const { getSessionSecret } = require('./db');

const SECRET = getSessionSecret();
const COOKIE_NAME = 'sid';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hmac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

/** Create a signed session token for a username. */
function signSession(username) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_MS }),
  ).toString('base64url');
  return payload + '.' + hmac(payload);
}

/** Verify a token, returning the username or null. */
function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data.u;
  } catch {
    return null;
  }
}

/** Parse a Cookie header into a key/value map. */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res, username) {
  const token = signSession(username);
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** Extract the authenticated username from a request (cookie based). */
function userFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySession(cookies[COOKIE_NAME]);
}

module.exports = {
  COOKIE_NAME,
  signSession,
  verifySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  userFromRequest,
};
