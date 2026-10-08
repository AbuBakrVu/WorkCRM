import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { get } from './db.js';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Генерируем и сохраняем секрет рядом с БД, чтобы сессии переживали перезапуск
  const dir = process.env.DATA_DIR || path.resolve('data');
  const f = path.join(dir, '.jwt_secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

// Шифрование секретов (пароли в базе знаний): AES-256-GCM, ключ выводится из секрета приложения
const ENC_KEY = crypto.createHash('sha256').update(`crm-secrets:${SECRET}`).digest();
export function encryptSecret(text) {
  if (text == null || text === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}
export function decryptSecret(blob) {
  if (!blob) return null;
  const [v, iv, tag, data] = String(blob).split(':');
  if (v !== 'v1') return null;
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
const COOKIE = 'crm_token';
const TTL_DAYS = 14;

export const hashPassword = (p) => bcrypt.hashSync(p, 10);
export const checkPassword = (p, h) => bcrypt.compareSync(p, h);

export function issueToken(res, user, portal = false) {
  const token = jwt.sign(portal ? { pid: user.id } : { uid: user.id }, SECRET, { expiresIn: `${TTL_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: TTL_DAYS * 864e5,
  });
}
export const clearToken = (res) => res.clearCookie(COOKIE);

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: 'Требуется вход' });
  try {
    const { uid, pid } = jwt.verify(token, SECRET);
    if (pid) { // сотрудник клиента — только личный кабинет
      const p = get(`SELECT p.*, c.name client_name FROM portal_users p JOIN clients c ON c.id = p.client_id WHERE p.id = ? AND p.active = 1`, pid);
      if (!p) return res.status(401).json({ error: 'Пользователь не найден' });
      req.portal = publicUser(p);
      return next();
    }
    const user = get('SELECT * FROM users WHERE id = ? AND active = 1', uid);
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    req.user = publicUser(user);
    next();
  } catch {
    return res.status(401).json({ error: 'Сессия истекла' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Недостаточно прав' });

// Простая защита от перебора паролей: 10 попыток за 15 минут на IP
const attempts = new Map();
export function loginRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const rec = attempts.get(key) || { n: 0, t: now };
  if (now - rec.t > 15 * 60e3) { rec.n = 0; rec.t = now; }
  rec.n++;
  attempts.set(key, rec);
  if (rec.n > 10) return res.status(429).json({ error: 'Слишком много попыток, попробуйте через 15 минут' });
  next();
}
