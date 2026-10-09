import { Router } from 'express';
import { all, get, logActivity } from '../db.js';
import { todayMsk } from '../recurrence.js';
import { trashDelete } from '../audit.js';
import { requireRole } from '../auth.js';
import { api, wrap, pick, insert, update, idParam, required } from './shared.js';
import { TASK_SELECT } from './tasks.js';
import { TICKET_SELECT } from './tickets.js';

/* ---------- finance ---------- */
const TX_FIELDS = ['type', 'amount', 'category', 'date', 'description', 'project_id', 'client_id'];
const TX_SELECT = `SELECT x.*, p.name project_name, c.name client_name FROM transactions x
  LEFT JOIN projects p ON p.id = x.project_id LEFT JOIN clients c ON c.id = x.client_id`;
const finance = Router();
finance.use(requireRole('admin', 'manager'));

finance.get('/', wrap((req) => {
  const where = []; const params = [];
  if (req.query.from) { where.push('x.date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('x.date <= ?'); params.push(req.query.to); }
  return all(`${TX_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY x.date DESC, x.id DESC`, ...params);
}));
finance.get('/summary', wrap(() => ({
  months: all(`SELECT strftime('%Y-%m', date) month,
      SUM(CASE WHEN type='income' THEN amount ELSE 0 END) income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) expense
    FROM transactions WHERE date >= date('now','start of month','-11 months') GROUP BY month ORDER BY month`),
  categories: all(`SELECT type, COALESCE(category,'Без категории') category, SUM(amount) total FROM transactions
    WHERE date >= date('now','start of month','-2 months') GROUP BY type, category ORDER BY total DESC`),
})));
finance.post('/', wrap((req) => {
  const data = pick(req.body, TX_FIELDS);
  required(data, 'type', 'amount', 'date');
  data.created_by = req.user.id;
  const id = insert('transactions', data);
  logActivity(req.user.id, 'transaction', id, 'create', `${data.type === 'income' ? 'добавил доход' : 'добавил расход'} ${data.amount} ₽`);
  return get(`${TX_SELECT} WHERE x.id = ?`, id);
}));
finance.put('/:id', wrap((req) => {
  const id = idParam(req);
  update('transactions', id, pick(req.body, TX_FIELDS));
  return get(`${TX_SELECT} WHERE x.id = ?`, id);
}));
finance.delete('/:id', wrap((req) => { const id = idParam(req); const x = get('SELECT * FROM transactions WHERE id = ?', id); trashDelete('transaction', 'transactions', id, x && `${x.type === 'income' ? 'Доход' : 'Расход'} ${Math.round(x.amount).toLocaleString('ru-RU')} ₽ · ${x.description || x.category || ''}`); return { ok: true }; }));
api.use('/transactions', finance);

/* ---------- dashboard ---------- */
api.get('/dashboard', wrap((req) => {
  const canFinance = ['admin', 'manager'].includes(req.user.role);
  return {
    tickets: get(`SELECT SUM(status IN ('new','in_progress','waiting')) open,
        SUM(status = 'new') new,
        SUM(status IN ('new','in_progress','waiting') AND due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) overdue FROM tickets`),
    tasks: get(`SELECT
        SUM(status != 'done') open,
        SUM(status = 'in_progress') in_progress,
        SUM(status != 'done' AND due_date < date('now')) overdue,
        SUM(status != 'done' AND due_date BETWEEN date('now') AND date('now','+3 days')) due_soon,
        SUM(status != 'done' AND assignee_id IS NULL) unassigned
      FROM tasks`),
    projects_overview: all(`SELECT p.id, p.name, p.status,
        SUM(t.status = 'todo') todo, SUM(t.status = 'in_progress') in_progress,
        SUM(t.status != 'done' AND t.due_date < date('now')) overdue,
        SUM(t.status = 'done') done, COUNT(t.id) total,
        (SELECT COALESCE(SUM(duration_sec),0) FROM time_entries e WHERE e.project_id = p.id AND e.started_at >= date('now','-6 days')) week_sec
      FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.status != 'done' OR t.status != 'done'
      GROUP BY p.id ORDER BY overdue DESC, (todo + in_progress) DESC, p.name`),
    attention_tasks: all(`${TASK_SELECT} WHERE t.status != 'done' AND (t.due_date <= date('now','+3 days') OR t.assignee_id IS NULL)
        ORDER BY t.due_date IS NULL, t.due_date, t.id LIMIT 10`),
    my_week_sec: get(`SELECT COALESCE(SUM(duration_sec),0) sec FROM time_entries WHERE user_id = ? AND started_at >= date('now','-6 days')`, req.user.id).sec,
    invoices: canFinance ? get(`SELECT COUNT(*) unpaid, COALESCE(SUM(total - paid),0) unpaid_sum,
        COALESCE(SUM(due_date IS NOT NULL AND due_date < @d),0) overdue,
        COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < @d THEN total - paid END),0) overdue_sum
      FROM invoices WHERE cancelled = 0 AND paid < total - 0.005`, { d: todayMsk() }) : null,
    my_tasks: all(`${TASK_SELECT} WHERE t.status != 'done' AND (t.assignee_id = ? OR EXISTS (SELECT 1 FROM task_members m WHERE m.task_id = t.id AND m.user_id = ? AND m.role = 'coassignee'))
      ORDER BY t.due_date IS NULL, t.due_date LIMIT 8`, req.user.id, req.user.id),
    urgent_tickets: all(`${TICKET_SELECT} WHERE k.status IN ('new','in_progress','waiting')
        ORDER BY CASE k.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, k.due_at LIMIT 6`),
    activity: all(`SELECT a.*, u.name user_name, u.color user_color FROM activity a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT 12`),
  };
}));

/* ---------- global search ---------- */
api.get('/search', wrap((req) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return [];
  const like = `%${q.toLowerCase()}%`;
  const num = Number(q.replace('#', ''));
  return [
    ...all(`SELECT 'project' kind, id, name title, status sub FROM projects WHERE ulower(name) LIKE ? OR ulower(description) LIKE ? LIMIT 6`, like, like),
    ...all(`SELECT 'ticket' kind, id, title, status sub FROM tickets WHERE ulower(title) LIKE ? OR ulower(location) LIKE ? OR ulower(requester) LIKE ? OR id = ? LIMIT 6`, like, like, like, Number.isInteger(num) ? num : -1),
    ...all(`SELECT 'client' kind, id, name title, contact_name sub FROM clients WHERE ulower(name) LIKE ? OR ulower(contact_name) LIKE ? OR ulower(phone) LIKE ? OR ulower(email) LIKE ? LIMIT 6`, like, like, like, like),
    ...all(`SELECT 'deal' kind, id, title, stage sub FROM deals WHERE ulower(title) LIKE ? LIMIT 4`, like),
    ...all(`SELECT 'task' kind, t.id, t.title, p.name sub, t.project_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE ulower(t.title) LIKE ? LIMIT 6`, like),
    ...all(`SELECT 'asset' kind, a.id, a.name title, COALESCE(c.name, '') || CASE WHEN a.ip IS NOT NULL THEN ' · ' || a.ip ELSE '' END sub FROM assets a LEFT JOIN clients c ON c.id = a.client_id
      WHERE ulower(a.name) LIKE ? OR ulower(a.model) LIKE ? OR ulower(a.serial) LIKE ? OR ulower(a.inventory_no) LIKE ? OR a.ip LIKE ? OR ulower(a.mac) LIKE ? LIMIT 5`, like, like, like, like, like, like),
    ...all(`SELECT 'kb' kind, id, title, category sub FROM kb_articles WHERE ulower(title) LIKE ? OR ulower(body) LIKE ? LIMIT 5`, like, like),
  ];
}));
