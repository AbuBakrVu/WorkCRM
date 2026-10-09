import { all, get, run, tx, logActivity } from '../db.js';
import { todayMsk } from '../recurrence.js';
import { trashDelete } from '../audit.js';
import { requireRole } from '../auth.js';
import { api, notFound, wrap, pick, insert, update, idParam, required } from './shared.js';
import { INVOICE_SELECT, shapeInvoice } from './invoices.js';

/* ---------- clients ---------- */
const CLIENT_FIELDS = ['name', 'type', 'contact_name', 'phone', 'email', 'inn', 'address', 'notes',
  'full_name', 'kpp', 'ogrn', 'bank_name', 'bik', 'account', 'corr_account', 'director_name', 'director_title', 'edo_id'];

api.get('/clients', wrap(() => all(`
  SELECT c.*,
    (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) projects_count,
    (SELECT COUNT(*) FROM tickets t WHERE t.client_id = c.id AND t.status NOT IN ('resolved','closed')) open_tickets,
    (SELECT COALESCE(SUM(amount),0) FROM deals d WHERE d.client_id = c.id AND d.stage = 'won') won_amount,
    (SELECT COALESCE(SUM(amount),0) FROM transactions x WHERE x.client_id = c.id AND x.type = 'income') revenue
  FROM clients c ORDER BY c.name`)));

api.get('/clients/:id', wrap((req) => {
  const id = idParam(req);
  const c = get('SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw notFound();
  c.projects = all('SELECT id, name, status, due_date FROM projects WHERE client_id = ? ORDER BY created_at DESC', id);
  c.deals = all('SELECT id, title, amount, stage FROM deals WHERE client_id = ? ORDER BY created_at DESC', id);
  c.tickets = all('SELECT id, title, status, priority, created_at FROM tickets WHERE client_id = ? ORDER BY created_at DESC LIMIT 20', id);
  // оплаты по счетам уже видны в списке счетов — здесь только прочие операции
  c.transactions = all(`SELECT id, type, amount, date, description FROM transactions WHERE client_id = ?
    AND id NOT IN (SELECT transaction_id FROM invoice_payments WHERE transaction_id IS NOT NULL) ORDER BY date DESC LIMIT 20`, id);
  if (['admin', 'manager'].includes(req.user.role)) {
    const today = todayMsk();
    c.invoices = all(`${INVOICE_SELECT} WHERE i.client_id = ? ORDER BY i.date DESC, i.id DESC LIMIT 30`, id).map((i) => shapeInvoice(i, today));
    c.debt = c.invoices.reduce((a, i) => a + i.debt, 0);
  }
  return c;
}));

api.post('/clients', wrap((req) => {
  const data = pick(req.body, CLIENT_FIELDS);
  required(data, 'name');
  const id = insert('clients', data);
  logActivity(req.user.id, 'client', id, 'create', `добавил клиента «${data.name}»`);
  return get('SELECT * FROM clients WHERE id = ?', id);
}));
api.put('/clients/:id', wrap((req) => {
  const id = idParam(req);
  update('clients', id, pick(req.body, CLIENT_FIELDS));
  return get('SELECT * FROM clients WHERE id = ?', id);
}));
api.delete('/clients/:id', requireRole('admin', 'manager'), wrap((req) => { const id = idParam(req); trashDelete('client', 'clients', id, get('SELECT name FROM clients WHERE id = ?', id)?.name); return { ok: true }; }));

/* ---------- projects ---------- */
const PROJECT_FIELDS = ['name', 'description', 'status', 'client_id', 'owner_id', 'start_date', 'due_date', 'budget', 'manual_progress', 'visible'];

const PROJECT_SELECT = `
  SELECT p.*, c.name client_name, o.name owner_name,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) tasks_total,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') tasks_done,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'in_progress') tasks_in_progress,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < date('now')) tasks_overdue,
    (SELECT MAX(created_at) FROM tasks t WHERE t.project_id = p.id) last_task_at,
    (SELECT COALESCE(SUM(duration_sec),0) FROM time_entries e WHERE e.project_id = p.id AND e.started_at >= date('now','-6 days')) week_sec,
    (SELECT COALESCE(SUM(CASE WHEN e.ended_at IS NULL
        THEN CAST((julianday('now') - julianday(e.started_at)) * 86400 AS INTEGER)
        ELSE e.duration_sec END),0) FROM time_entries e WHERE e.project_id = p.id) tracked_sec,
    (SELECT GROUP_CONCAT(user_id) FROM project_members m WHERE m.project_id = p.id) member_ids
  FROM projects p
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN users o ON o.id = p.owner_id`;

function shapeProject(p) {
  if (!p) return p;
  p.member_ids = p.member_ids ? String(p.member_ids).split(',').map(Number) : [];
  p.progress = p.manual_progress != null ? p.manual_progress
    : p.tasks_total ? Math.round((p.tasks_done / p.tasks_total) * 100)
    : p.status === 'done' ? 100 : 0;
  return p;
}
function setMembers(projectId, ids) {
  if (!Array.isArray(ids)) return;
  run('DELETE FROM project_members WHERE project_id = ?', projectId);
  for (const uid of new Set(ids.map(Number).filter(Boolean))) run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?,?)', projectId, uid);
}

api.get('/projects', wrap(() => all(`${PROJECT_SELECT} ORDER BY COALESCE(p.due_date, '9999') , p.id`).map(shapeProject)));

api.get('/projects/:id', wrap((req) => {
  const id = idParam(req);
  const p = shapeProject(get(`${PROJECT_SELECT} WHERE p.id = ?`, id));
  if (!p) throw notFound();
  p.tasks = all(`SELECT t.*, u.name assignee_name, u.color assignee_color FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
                 WHERE t.project_id = ? ORDER BY t.status = 'done', t.position, t.id`, id);
  p.time_by_user = all(`SELECT u.id, u.name, u.color, SUM(e.duration_sec) sec FROM time_entries e JOIN users u ON u.id = e.user_id
                        WHERE e.project_id = ? GROUP BY u.id ORDER BY sec DESC`, id);
  p.finance = get(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
                          COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense
                   FROM transactions WHERE project_id = ?`, id);
  return p;
}));

api.post('/projects', wrap((req) => {
  const data = pick(req.body, PROJECT_FIELDS);
  required(data, 'name');
  data.owner_id ??= req.user.id;
  const id = tx(() => {
    const id = insert('projects', data);
    setMembers(id, req.body.member_ids || [req.user.id]);
    return id;
  });
  logActivity(req.user.id, 'project', id, 'create', `создал проект «${data.name}»`);
  return shapeProject(get(`${PROJECT_SELECT} WHERE p.id = ?`, id));
}));

api.put('/projects/:id', wrap((req) => {
  const id = idParam(req);
  const before = get('SELECT * FROM projects WHERE id = ?', id);
  if (!before) throw notFound();
  const data = pick(req.body, PROJECT_FIELDS);
  tx(() => { update('projects', id, data); setMembers(id, req.body.member_ids); });
  if (data.status && data.status !== before.status)
    logActivity(req.user.id, 'project', id, 'status', `перевёл «${before.name}» в статус ${data.status}`);
  return shapeProject(get(`${PROJECT_SELECT} WHERE p.id = ?`, id));
}));

api.delete('/projects/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const p = get('SELECT name FROM projects WHERE id = ?', id);
  trashDelete('project', 'projects', id, p?.name);
  if (p) logActivity(req.user.id, 'project', id, 'delete', `удалил проект «${p.name}»`);
  return { ok: true };
}));
