import { all, get, logActivity } from '../db.js';
import { trashDelete } from '../audit.js';
import { requireRole } from '../auth.js';
import { api, bad, notFound, wrap, pick, insert, update, idParam, required, nowIso } from './shared.js';
import { notifyMentions } from './tasks.js';

/* ---------- tickets (заявки) ---------- */
const TICKET_FIELDS = ['title', 'description', 'category', 'priority', 'status', 'location', 'requester', 'requester_contact',
  'client_id', 'project_id', 'assignee_id', 'due_at', 'resolution', 'asset_id'];
export const TICKET_SELECT = `SELECT k.*, u.name assignee_name, u.color assignee_color, c.name client_name, p.name project_name,
    (SELECT name FROM assets a WHERE a.id = k.asset_id) asset_name,
    (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = k.id) comments_count,
    (SELECT COALESCE(SUM(duration_sec),0) FROM time_entries e WHERE e.ticket_id = k.id) tracked_sec
  FROM tickets k LEFT JOIN users u ON u.id = k.assignee_id LEFT JOIN clients c ON c.id = k.client_id LEFT JOIN projects p ON p.id = k.project_id`;
export const SLA_HOURS = { critical: 4, high: 8, normal: 24, low: 72 };

api.get('/tickets', wrap(() => all(`${TICKET_SELECT} ORDER BY
  CASE k.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END,
  CASE k.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, k.created_at DESC`)));

api.get('/tickets/:id', wrap((req) => {
  const id = idParam(req);
  const t = get(`${TICKET_SELECT} WHERE k.id = ?`, id);
  if (!t) throw notFound();
  t.comments = ticketComments(id);
  t.portal_user_name = t.portal_user_id ? get('SELECT name FROM portal_users WHERE id = ?', t.portal_user_id)?.name : null;
  return t;
}));

api.post('/tickets', wrap((req) => {
  const data = pick(req.body, TICKET_FIELDS);
  required(data, 'title');
  data.priority ||= 'normal';
  if (!data.due_at) data.due_at = new Date(Date.now() + (SLA_HOURS[data.priority] || 24) * 3600e3).toISOString();
  data.created_by = req.user.id;
  const id = insert('tickets', data);
  logActivity(req.user.id, 'ticket', id, 'create', `создал заявку #${id} «${data.title}»`);
  return get(`${TICKET_SELECT} WHERE k.id = ?`, id);
}));

api.put('/tickets/:id', wrap((req) => {
  const id = idParam(req);
  const before = get('SELECT * FROM tickets WHERE id = ?', id);
  if (!before) throw notFound();
  const data = pick(req.body, TICKET_FIELDS);
  if (data.status && data.status !== before.status) {
    if (['resolved', 'closed'].includes(data.status) && !before.resolved_at) data.resolved_at = nowIso();
    if (['new', 'in_progress', 'waiting'].includes(data.status)) data.resolved_at = null;
    logActivity(req.user.id, 'ticket', id, 'status', `изменил статус заявки #${id} → ${data.status}`);
  }
  update('tickets', id, data);
  return get(`${TICKET_SELECT} WHERE k.id = ?`, id);
}));

// Комментарии заявки: сотрудники и клиенты (из личного кабинета); internal — не видны клиенту
export function ticketComments(id, forPortal = false) {
  return all(`SELECT m.id, m.ticket_id, m.body, m.created_at, m.internal, m.user_id, m.portal_user_id,
      COALESCE(u.name, pu.name) user_name, u.color user_color, m.portal_user_id IS NOT NULL from_client
    FROM ticket_comments m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN portal_users pu ON pu.id = m.portal_user_id
    WHERE m.ticket_id = ? ${forPortal ? 'AND m.internal = 0' : ''} ORDER BY m.created_at, m.id`, id);
}
api.post('/tickets/:id/comments', wrap((req) => {
  const id = idParam(req);
  if (!get('SELECT 1 FROM tickets WHERE id = ?', id)) throw notFound();
  const body = String(req.body?.body || '').trim().slice(0, 5000);
  if (!body) throw bad('Пустой комментарий');
  insert('ticket_comments', { ticket_id: id, user_id: req.user.id, body, internal: req.body?.internal ? 1 : 0 });
  notifyMentions({ text: body, entity: 'ticket', entityId: id, authorId: req.user.id });
  return ticketComments(id);
}));
api.delete('/tickets/:id', requireRole('admin', 'manager'), wrap((req) => { const id = idParam(req); const t = get('SELECT title FROM tickets WHERE id = ?', id); trashDelete('ticket', 'tickets', id, t && `#${id} ${t.title}`); return { ok: true }; }));
