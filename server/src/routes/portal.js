import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, logActivity } from '../db.js';
import { todayMsk } from '../recurrence.js';
import { requireRole, hashPassword } from '../auth.js';
import { api, bad, notFound, wrap, insert, idParam } from './shared.js';
import { str } from './import.js';
import { INVOICE_SELECT, contractUsage, shapeInvoice } from './invoices.js';
import { buildClientReport } from './reports.js';
import { SLA_HOURS, ticketComments } from './tickets.js';

/* ---------- личный кабинет клиента ---------- */
// Сотрудники управляют доступами клиента
api.get('/clients/:id/portal-users', requireRole('admin', 'manager'), wrap((req) => all('SELECT id, name, email, phone, active, last_login_at, created_at FROM portal_users WHERE client_id = ? ORDER BY name', idParam(req))));
const genPassword = () => crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
api.post('/clients/:id/portal-users', requireRole('admin', 'manager'), wrap((req) => {
  const clientId = idParam(req);
  const name = str(req.body?.name, 120); const email = str(req.body?.email, 120);
  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) throw bad('Укажите имя и корректный email');
  if (get('SELECT 1 FROM users WHERE email = ?', email) || get('SELECT 1 FROM portal_users WHERE email = ?', email)) throw bad('Такой email уже используется');
  const password = genPassword();
  const id = insert('portal_users', { client_id: clientId, name, email, phone: str(req.body?.phone, 60), password_hash: hashPassword(password) });
  logActivity(req.user.id, 'client', clientId, 'portal', `открыл доступ в личный кабинет: ${name}`);
  return { ...get('SELECT id, name, email, phone, active FROM portal_users WHERE id = ?', id), password };
}));
api.put('/portal-users/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const p = get('SELECT * FROM portal_users WHERE id = ?', id);
  if (!p) throw notFound();
  const data = {};
  if ('active' in (req.body || {})) data.active = req.body.active ? 1 : 0;
  let password;
  if (req.body?.reset_password) { password = genPassword(); data.password_hash = hashPassword(password); }
  if (Object.keys(data).length) run(`UPDATE portal_users SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(data), id);
  return { ...get('SELECT id, name, email, phone, active FROM portal_users WHERE id = ?', id), ...(password ? { password } : {}) };
}));
api.delete('/portal-users/:id', requireRole('admin', 'manager'), wrap((req) => { run('DELETE FROM portal_users WHERE id = ?', idParam(req)); return { ok: true }; }));

// API самого кабинета: всё строго в рамках клиента пользователя
export const portal = Router();
api.use('/portal', portal);
portal.use((req, res, next) => (req.portal ? next() : res.status(403).json({ error: 'Только для клиентов' })));
export const cid = (req) => req.portal.client_id;
portal.get('/summary', wrap((req) => {
  const today = todayMsk();
  const c = get('SELECT id, name FROM clients WHERE id = ?', cid(req));
  const company = get('SELECT name, full_name, phone, email, logo_file_id FROM companies ORDER BY is_default DESC, id LIMIT 1');
  const tickets = get(`SELECT SUM(status IN ('new','in_progress','waiting')) open, COUNT(*) total FROM tickets WHERE client_id = ?`, cid(req));
  const inv = all('SELECT * FROM invoices WHERE client_id = ? AND cancelled = 0', cid(req)).map((i) => shapeInvoice(i, today));
  const k = get('SELECT * FROM support_contracts WHERE client_id = ? AND active = 1 ORDER BY id LIMIT 1', cid(req));
  return { client: c, company, tickets, debt: inv.reduce((a, i) => a + i.debt, 0), overdue: inv.filter((i) => i.status === 'overdue').length,
    contract: k ? { title: k.title, hours_limit: k.hours_limit, usage: contractUsage(k, today.slice(0, 7)) } : null };
}));
const PORTAL_TICKET = `SELECT k.id, k.title, k.description, k.status, k.priority, k.category, k.location, k.requester, k.created_at, k.resolved_at, k.resolution,
    k.due_at, u.name assignee_name, a.name asset_name,
    (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = k.id AND m.internal = 0) comments_count
  FROM tickets k LEFT JOIN users u ON u.id = k.assignee_id LEFT JOIN assets a ON a.id = k.asset_id`;
portal.get('/tickets', wrap((req) => all(`${PORTAL_TICKET} WHERE k.client_id = ? ORDER BY k.status IN ('resolved','closed'), k.id DESC`, cid(req))));
const portalTicket = (req) => {
  const t = get(`${PORTAL_TICKET} WHERE k.id = ? AND k.client_id = ?`, idParam(req), cid(req));
  if (!t) throw notFound();
  return t;
};
portal.get('/tickets/:id', wrap((req) => ({ ...portalTicket(req), comments: ticketComments(Number(req.params.id), true) })));
portal.post('/tickets', wrap((req) => {
  const title = str(req.body?.title, 200);
  if (!title) throw bad('Опишите проблему кратко');
  const priority = ['low', 'normal', 'high', 'critical'].includes(req.body?.priority) ? req.body.priority : 'normal';
  let asset = req.body?.asset_id ? get('SELECT id FROM assets WHERE id = ? AND client_id = ?', Number(req.body.asset_id), cid(req)) : null;
  const project = get('SELECT id FROM projects WHERE client_id = ? ORDER BY id LIMIT 1', cid(req));
  const id = insert('tickets', { title, description: str(req.body?.description, 5000), priority, category: 'other', status: 'new', location: str(req.body?.location, 200),
    requester: req.portal.name, requester_contact: req.portal.phone || req.portal.email, client_id: cid(req), project_id: project?.id ?? null,
    asset_id: asset?.id ?? null, portal_user_id: req.portal.id, due_at: new Date(Date.now() + SLA_HOURS[priority] * 3600e3).toISOString() });
  logActivity(null, 'ticket', id, 'create', `новая заявка из личного кабинета #${id} «${title}» — ${req.portal.client_name}`);
  return get(`${PORTAL_TICKET} WHERE k.id = ?`, id);
}));
portal.post('/tickets/:id/comments', wrap((req) => {
  const t = portalTicket(req);
  const body = str(req.body?.body, 5000);
  if (!body) throw bad('Пустое сообщение');
  insert('ticket_comments', { ticket_id: t.id, portal_user_id: req.portal.id, body });
  // Ответ клиента в заявке «Ожидание» возвращает её в работу
  if (t.status === 'waiting') run("UPDATE tickets SET status = 'in_progress' WHERE id = ?", t.id);
  logActivity(null, 'ticket', t.id, 'comment', `${req.portal.name} (${req.portal.client_name}) ответил в заявке #${t.id}`);
  return ticketComments(t.id, true);
}));
portal.get('/invoices', wrap((req) => {
  const today = todayMsk();
  return all(`${INVOICE_SELECT} WHERE i.client_id = ? AND i.cancelled = 0 ORDER BY i.date DESC, i.id DESC`, cid(req))
    .map((i) => { const x = shapeInvoice(i, today); return { id: x.id, number: x.number, date: x.date, due_date: x.due_date, title: x.title || x.deal_title, total: x.total, paid: x.paid, debt: x.debt, status: x.status, company_name: x.company_name }; });
}));
portal.get('/report', wrap((req) => {
  const r = buildClientReport({ client_id: cid(req), from: req.query.from, to: req.query.to }, true);
  if (r.client) r.client = { name: r.client.name, full_name: r.client.full_name, director_name: r.client.director_name };
  if (r.company) r.company = { name: r.company.name, full_name: r.company.full_name, inn: r.company.inn, kpp: r.company.kpp, phone: r.company.phone, email: r.company.email, logo_file_id: r.company.logo_file_id, director_name: r.company.director_name };
  return r;
}));
portal.get('/assets', wrap((req) => all('SELECT id, type, name, model, serial, inventory_no, location, owner, warranty_until, status FROM assets WHERE client_id = ? ORDER BY type, name', cid(req))));
