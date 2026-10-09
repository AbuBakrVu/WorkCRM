import { all, get } from '../db.js';
import { recordEvent, trashDelete } from '../audit.js';
import { requireRole, encryptSecret, decryptSecret } from '../auth.js';
import { api, notFound, wrap, pick, insert, update, idParam, required } from './shared.js';

/* ---------- оборудование ---------- */
const ASSET_FIELDS = ['client_id', 'project_id', 'type', 'name', 'model', 'serial', 'inventory_no', 'ip', 'mac', 'location', 'owner', 'purchase_date', 'warranty_until', 'status', 'notes'];
const ASSET_SELECT = `SELECT a.*, c.name client_name, p.name project_name,
    (SELECT COUNT(*) FROM tickets t WHERE t.asset_id = a.id) tickets_count,
    (SELECT COUNT(*) FROM tickets t WHERE t.asset_id = a.id AND t.status IN ('new','in_progress','waiting')) open_tickets
  FROM assets a LEFT JOIN clients c ON c.id = a.client_id LEFT JOIN projects p ON p.id = a.project_id`;
api.get('/assets', wrap((req) => {
  const where = []; const args = [];
  if (req.query.client_id) { where.push('a.client_id = ?'); args.push(Number(req.query.client_id)); }
  return all(`${ASSET_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name, a.type, a.name`, ...args);
}));
api.get('/assets/:id', wrap((req) => {
  const a = get(`${ASSET_SELECT} WHERE a.id = ?`, idParam(req));
  if (!a) throw notFound();
  a.tickets = all(`SELECT k.id, k.title, k.status, k.priority, k.created_at, k.resolved_at, k.resolution, u.name assignee_name FROM tickets k
    LEFT JOIN users u ON u.id = k.assignee_id WHERE k.asset_id = ? ORDER BY k.id DESC`, a.id);
  a.articles = all('SELECT id, title, category FROM kb_articles WHERE asset_id = ? ORDER BY title', a.id);
  return a;
}));
api.post('/assets', wrap((req) => {
  const data = pick(req.body, ASSET_FIELDS);
  required(data, 'name');
  return get(`${ASSET_SELECT} WHERE a.id = ?`, insert('assets', data));
}));
api.put('/assets/:id', wrap((req) => {
  const id = idParam(req);
  update('assets', id, pick(req.body, ASSET_FIELDS));
  return get(`${ASSET_SELECT} WHERE a.id = ?`, id);
}));
api.delete('/assets/:id', requireRole('admin', 'manager'), wrap((req) => { const id = idParam(req); trashDelete('asset', 'assets', id, get('SELECT name FROM assets WHERE id = ?', id)?.name); return { ok: true }; }));

/* ---------- база знаний ---------- */
const KB_FIELDS = ['title', 'category', 'body', 'client_id', 'project_id', 'asset_id', 'pinned'];
const KB_SELECT = `SELECT k.id, k.title, k.category, k.body, k.client_id, k.project_id, k.asset_id, k.pinned, k.created_at, k.updated_at,
    k.secret IS NOT NULL has_secret, c.name client_name, p.name project_name, a.name asset_name, u.name updated_by_name
  FROM kb_articles k LEFT JOIN clients c ON c.id = k.client_id LEFT JOIN projects p ON p.id = k.project_id
  LEFT JOIN assets a ON a.id = k.asset_id LEFT JOIN users u ON u.id = COALESCE(k.updated_by, k.created_by)`;
api.get('/kb', wrap(() => all(`${KB_SELECT} ORDER BY k.pinned DESC, k.updated_at DESC`)));
api.get('/kb/:id', wrap((req) => get(`${KB_SELECT} WHERE k.id = ?`, idParam(req)) || (() => { throw notFound(); })()));
// Секрет (пароли, ключи) хранится зашифрованным; показ — отдельным запросом и попадает в историю
api.get('/kb/:id/secret', wrap((req) => {
  const k = get('SELECT id, secret FROM kb_articles WHERE id = ?', idParam(req));
  if (!k) throw notFound();
  recordEvent('kb', k.id, '_secret_viewed', null);
  return { secret: decryptSecret(k.secret) };
}));
function kbData(req) {
  const data = pick(req.body, KB_FIELDS);
  if ('secret' in (req.body || {})) data.secret = encryptSecret(String(req.body.secret || '').slice(0, 10000));
  if (data.body) data.body = String(data.body).slice(0, 100000);
  return data;
}
api.post('/kb', wrap((req) => {
  const data = kbData(req);
  required(data, 'title');
  data.created_by = req.user.id;
  return get(`${KB_SELECT} WHERE k.id = ?`, insert('kb_articles', data));
}));
api.put('/kb/:id', wrap((req) => {
  const id = idParam(req);
  if (!get('SELECT 1 FROM kb_articles WHERE id = ?', id)) throw notFound();
  const data = kbData(req);
  if ('secret' in data) recordEvent('kb', id, '_secret_changed', null);
  update('kb_articles', id, { ...data, updated_by: req.user.id, updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) });
  return get(`${KB_SELECT} WHERE k.id = ?`, id);
}));
api.delete('/kb/:id', wrap((req) => { const id = idParam(req); trashDelete('kb', 'kb_articles', id, get('SELECT title FROM kb_articles WHERE id = ?', id)?.title); return { ok: true }; }));
