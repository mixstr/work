'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'antiyoy.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---- password hashing (scrypt) -------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(password), salt, 64);
  return salt.toString('hex') + ':' + dk.toString('hex');
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const dk = crypto.scryptSync(String(password), salt, 64);
  return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
}

// ---- user API ------------------------------------------------------------
const stmtGetUser = db.prepare('SELECT * FROM users WHERE username = ?');
const stmtInsertUser = db.prepare(
  'INSERT INTO users (username, password, created_at) VALUES (?, ?, ?)',
);
const stmtUpdatePassword = db.prepare('UPDATE users SET password = ? WHERE username = ?');

function getUser(username) {
  if (!username) return null;
  return stmtGetUser.get(String(username).toLowerCase()) || null;
}

function addUser(username, password) {
  const uname = String(username).trim().toLowerCase();
  if (!uname) throw new Error('Пустой логин');
  if (!password) throw new Error('Пустой пароль');
  const hash = hashPassword(password);
  const existing = getUser(uname);
  if (existing) {
    stmtUpdatePassword.run(hash, uname);
    return { username: uname, updated: true };
  }
  stmtInsertUser.run(uname, hash, Date.now());
  return { username: uname, updated: false };
}

function authenticate(username, password) {
  const user = getUser(username);
  if (!user) return null;
  if (!verifyPassword(password, user.password)) return null;
  return { username: user.username };
}

// ---- settings (used for the session secret) ------------------------------
const stmtGetSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const stmtSetSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);

function getSetting(key) {
  const row = stmtGetSetting.get(key);
  return row ? row.value : null;
}
function setSetting(key, value) { stmtSetSetting.run(key, value); }

function getSessionSecret() {
  let secret = getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', secret);
  }
  return secret;
}

module.exports = {
  db,
  DB_PATH,
  getUser,
  addUser,
  authenticate,
  getSessionSecret,
};
