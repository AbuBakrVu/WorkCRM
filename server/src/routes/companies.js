import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, tx, UPLOAD_DIR } from '../db.js';
import { requireRole } from '../auth.js';
import { api, bad, notFound, wrap, pick, insert, update, idParam, required } from './shared.js';
import { removeStored } from './tasks.js';

/* ---------- мои компании (от чьего имени выставляем документы) ---------- */
const COMPANY_FIELDS = ['name', 'full_name', 'inn', 'kpp', 'ogrn', 'address', 'phone', 'email', 'site', 'bank_name', 'bik', 'account',
  'corr_account', 'director_name', 'director_title', 'accountant_name', 'vat_rate', 'is_default', 'edo_id'];
const COMPANY_IMAGES = { logo: 'logo_file_id', sign: 'sign_file_id', stamp: 'stamp_file_id' };
export const VAT_RATES = ['none', '0', '5', '7', '10', '20', '22'];
export const checkVat = (v) => { if (v != null && !VAT_RATES.includes(String(v))) throw bad('Неверная ставка НДС'); return v == null ? null : String(v); };
function saveCompany(id, body) {
  const data = pick(body, COMPANY_FIELDS);
  if ('vat_rate' in data) data.vat_rate = checkVat(data.vat_rate);
  return tx(() => {
    if (data.is_default) run('UPDATE companies SET is_default = 0');
    if (id) { update('companies', id, data); return id; }
    required(data, 'name');
    if (!get('SELECT 1 FROM companies LIMIT 1')) data.is_default = 1; // первая — по умолчанию
    return insert('companies', data);
  });
}
api.get('/companies', wrap(() => all('SELECT * FROM companies ORDER BY is_default DESC, name')));
api.post('/companies', requireRole('admin', 'manager'), wrap((req) => get('SELECT * FROM companies WHERE id = ?', saveCompany(null, req.body))));
api.put('/companies/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  if (!get('SELECT 1 FROM companies WHERE id = ?', id)) throw notFound();
  return get('SELECT * FROM companies WHERE id = ?', saveCompany(id, req.body));
}));
api.delete('/companies/:id', requireRole('admin', 'manager'), wrap((req) => { run('DELETE FROM companies WHERE id = ?', idParam(req)); return { ok: true }; }));
// Логотип, подпись, печать — картинки (PNG с прозрачным фоном лучше всего)
api.post('/companies/:id/image/:kind', requireRole('admin', 'manager'), express.raw({ type: 'application/octet-stream', limit: 5 * 1024 * 1024 }), wrap((req) => {
  const id = idParam(req);
  const col = COMPANY_IMAGES[req.params.kind];
  if (!col) throw bad('Неверный тип картинки');
  const c = get('SELECT * FROM companies WHERE id = ?', id);
  if (!c) throw notFound();
  const mime = String(req.get('X-File-Type') || '');
  if (!/^image\/(png|jpe?g)$/.test(mime)) throw bad('Нужна картинка PNG или JPG');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Пустой файл');
  const ext = mime === 'image/png' ? '.png' : '.jpg';
  const stored = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), req.body);
  const fid = insert('files', { user_id: req.user.id, name: `${req.params.kind}${ext}`, size: req.body.length, mime, stored });
  const old = c[col] && get('SELECT stored FROM files WHERE id = ?', c[col]);
  update('companies', id, { [col]: fid });
  if (old) { run('DELETE FROM files WHERE id = ?', c[col]); removeStored(old.stored); }
  return get('SELECT * FROM companies WHERE id = ?', id);
}));
api.delete('/companies/:id/image/:kind', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const col = COMPANY_IMAGES[req.params.kind];
  if (!col) throw bad('Неверный тип картинки');
  const c = get('SELECT * FROM companies WHERE id = ?', id);
  if (!c) throw notFound();
  const old = c[col] && get('SELECT stored FROM files WHERE id = ?', c[col]);
  update('companies', id, { [col]: null });
  if (old) { run('DELETE FROM files WHERE id = ?', c[col]); removeStored(old.stored); }
  return get('SELECT * FROM companies WHERE id = ?', id);
}));

/* ---------- настройки приложения (интеграции) ---------- */
export const getSetting = (k) => get('SELECT value FROM app_settings WHERE key = ?', k)?.value ?? null;
const setSetting = (k, v) => run('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
const SECRET_KEYS = ['dadata_key'];
api.get('/app-settings', requireRole('admin'), wrap(() => {
  const out = {};
  for (const r of all('SELECT key, value FROM app_settings')) out[r.key] = SECRET_KEYS.includes(r.key) && r.value ? `••••${r.value.slice(-4)}` : r.value;
  return out;
}));
api.put('/app-settings', requireRole('admin'), wrap((req) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!['dadata_key'].includes(k)) continue;
    if (typeof v === 'string' && v.startsWith('••••')) continue; // не меняли
    setSetting(k, v ? String(v).trim().slice(0, 200) : null);
  }
  return { ok: true };
}));

/* ---------- автозаполнение реквизитов (DaData) ---------- */
async function dadata(method, query) {
  const key = getSetting('dadata_key');
  if (!key) throw bad('Автозаполнение не настроено: укажите ключ DaData в Настройки → Интеграции');
  const r = await fetch(`https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${key}` },
    body: JSON.stringify({ query, count: 1 }), signal: AbortSignal.timeout(8000),
  }).catch(() => { throw bad('DaData не отвечает, попробуйте позже'); });
  if (r.status === 401 || r.status === 403) throw bad('DaData отклонила ключ — проверьте его в настройках');
  if (!r.ok) throw bad(`Ошибка DaData (${r.status})`);
  return (await r.json()).suggestions?.[0]?.data || null;
}
export const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((d) => res.json(d)).catch(next);
api.get('/lookup/party', wrapAsync(async (req) => {
  const inn = String(req.query.inn || '').replace(/\D/g, '');
  if (![10, 12].includes(inn.length)) throw bad('ИНН — 10 цифр для организации или 12 для ИП');
  const d = await dadata('party', inn);
  if (!d) throw bad('Организация с таким ИНН не найдена');
  const ip = d.type === 'INDIVIDUAL';
  return {
    name: d.name?.short_with_opf || d.name?.full_with_opf, full_name: d.name?.full_with_opf, inn: d.inn, kpp: d.kpp || null,
    ogrn: d.ogrn, address: d.address?.unrestricted_value || d.address?.value,
    director_name: ip ? d.name?.full : d.management?.name || null, director_title: ip ? 'Индивидуальный предприниматель' : d.management?.post || null,
    status: d.state?.status,
  };
}));
api.get('/lookup/bank', wrapAsync(async (req) => {
  const bik = String(req.query.bik || '').replace(/\D/g, '');
  if (bik.length !== 9) throw bad('БИК — 9 цифр');
  const d = await dadata('bank', bik);
  if (!d) throw bad('Банк с таким БИК не найден');
  return { bank_name: d.name?.payment || d.name?.short, bik: d.bic, corr_account: d.correspondent_account || null };
}));

/* ---------- каталог товаров и услуг ---------- */
const CATALOG_FIELDS = ['kind', 'name', 'sku', 'unit', 'price', 'vat_rate', 'description', 'active'];
api.get('/catalog', wrap(() => all('SELECT * FROM catalog_items ORDER BY active DESC, name')));
api.post('/catalog', requireRole('admin', 'manager'), wrap((req) => {
  const data = pick(req.body, CATALOG_FIELDS);
  required(data, 'name');
  if ('vat_rate' in data) data.vat_rate = checkVat(data.vat_rate);
  return get('SELECT * FROM catalog_items WHERE id = ?', insert('catalog_items', data));
}));
api.put('/catalog/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const data = pick(req.body, CATALOG_FIELDS);
  if ('vat_rate' in data) data.vat_rate = checkVat(data.vat_rate);
  update('catalog_items', id, data);
  return get('SELECT * FROM catalog_items WHERE id = ?', id);
}));
api.delete('/catalog/:id', requireRole('admin', 'manager'), wrap((req) => { run('DELETE FROM catalog_items WHERE id = ?', idParam(req)); return { ok: true }; }));
