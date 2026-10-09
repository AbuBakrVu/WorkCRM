import { Router } from 'express';
import { run } from '../db.js';
import { recordChanges } from '../audit.js';

export const api = Router();

/* ---------- helpers ---------- */
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export const bad = (msg) => new HttpError(400, msg);
export const notFound = () => new HttpError(404, 'Не найдено');

export const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) { next(e); }
};

// Берём из тела только разрешённые поля; '' → null, boolean → 0/1
export function pick(body, fields) {
  const out = {};
  for (const f of fields) {
    if (!(f in (body || {}))) continue;
    let v = body[f];
    if (v === '' || v === undefined) v = null;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v !== null && typeof v === 'object') throw bad(`Неверное значение поля ${f}`);
    out[f] = v;
  }
  return out;
}

export function insert(table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return Number(run(sql, ...keys.map((k) => data[k])).lastInsertRowid);
}
export function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  recordChanges(table, id, data); // история изменений
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), id);
}
export const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw bad('Неверный id');
  return id;
};
export const required = (data, ...fields) => {
  for (const f of fields) if (data[f] === null || data[f] === undefined || String(data[f]).trim() === '') throw bad(`Поле «${f}» обязательно`);
};
export const nowIso = () => new Date().toISOString();
