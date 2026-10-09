import { all, get, run } from '../db.js';
import { trashRestore, trashPurge } from '../audit.js';
import { requireRole } from '../auth.js';
import { api, HttpError, bad, notFound, wrap, insert, idParam } from './shared.js';

/* ---------- история изменений ---------- */
// Имена вместо id для полей-ссылок
const REF_NAMES = { asset_id: 'assets', assignee_id: 'users', owner_id: 'users', created_by: 'users', client_id: 'clients', project_id: 'projects', company_id: 'companies', deal_id: 'deals', parent_id: 'tasks' };
function refName(field, v) {
  const t = REF_NAMES[field];
  if (!t || v == null) return v;
  const col = t === 'deals' || t === 'tasks' ? 'title' : 'name';
  return get(`SELECT ${col} n FROM ${t} WHERE id = ?`, Number(v))?.n ?? `#${v}`;
}
api.get('/history', wrap((req) => {
  const entity = String(req.query.entity || ''); const id = Number(req.query.id);
  if (!entity || !id) throw bad('Не указан объект');
  if (['invoice', 'contract', 'transaction', 'company'].includes(entity) && !['admin', 'manager'].includes(req.user.role)) throw new HttpError(403, 'Недостаточно прав');
  return all(`SELECT h.*, u.name user_name, u.color user_color FROM entity_history h LEFT JOIN users u ON u.id = h.user_id
    WHERE h.entity = ? AND h.entity_id = ? ORDER BY h.id DESC LIMIT 200`, entity, id)
    .map((h) => ({ ...h, old_value: refName(h.field, h.old_value), new_value: refName(h.field, h.new_value) }));
}));

/* ---------- корзина ---------- */
api.get('/trash', requireRole('admin', 'manager'), wrap(() => all(`SELECT t.id, t.entity, t.entity_id, t.title, t.deleted_at, u.name deleted_by_name
  FROM trash t LEFT JOIN users u ON u.id = t.deleted_by ORDER BY t.id DESC LIMIT 500`)));
api.post('/trash/:id/restore', requireRole('admin', 'manager'), wrap((req) => {
  try { const t = trashRestore(idParam(req)); if (!t) throw notFound(); return { ok: true, entity: t.entity, entity_id: t.entity_id }; }
  catch (e) { if (e instanceof HttpError) throw e; throw bad(`Не удалось восстановить: ${e.message}`); }
}));
api.delete('/trash/:id', requireRole('admin'), wrap((req) => { trashPurge(idParam(req)); return { ok: true }; }));

/* ---------- журнал входов ---------- */
api.get('/auth-log', requireRole('admin'), wrap((req) => {
  const where = []; const args = [];
  if (req.query.user_id) { where.push('l.user_id = ?'); args.push(Number(req.query.user_id)); }
  if (req.query.failed) where.push('l.ok = 0');
  return all(`SELECT l.*, u.name user_name, u.color user_color FROM auth_log l LEFT JOIN users u ON u.id = l.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.id DESC LIMIT 300`, ...args);
}));
api.get('/auth/logins', wrap((req) => all('SELECT id, ok, ip, user_agent, created_at FROM auth_log WHERE user_id = ? ORDER BY id DESC LIMIT 10', req.user.id)));

/* ---------- сохранённые фильтры ---------- */
api.get('/views', wrap((req) => all(`SELECT v.*, u.name user_name FROM saved_views v JOIN users u ON u.id = v.user_id
  WHERE v.page = ? AND (v.user_id = ? OR v.shared = 1) ORDER BY v.user_id != ?, v.name`, String(req.query.page || ''), req.user.id, req.user.id)
  .map((v) => ({ ...v, state: JSON.parse(v.state), mine: v.user_id === req.user.id }))));
api.post('/views', wrap((req) => {
  const page = String(req.body?.page || '').slice(0, 40);
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (!page || !name) throw bad('Укажите название');
  const state = JSON.stringify(req.body?.state ?? {});
  if (state.length > 5000) throw bad('Слишком большой фильтр');
  const id = insert('saved_views', { user_id: req.user.id, page, name, state, shared: req.body?.shared ? 1 : 0 });
  return { ...get('SELECT * FROM saved_views WHERE id = ?', id), state: JSON.parse(state), mine: true };
}));
api.delete('/views/:id', wrap((req) => {
  const v = get('SELECT * FROM saved_views WHERE id = ?', idParam(req));
  if (!v) throw notFound();
  if (v.user_id !== req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Удалить можно только свой фильтр');
  run('DELETE FROM saved_views WHERE id = ?', v.id);
  return { ok: true };
}));
