import { all, get } from '../db.js';
import { todayMsk } from '../recurrence.js';
import { requireRole } from '../auth.js';
import { api, bad, notFound, wrap } from './shared.js';
import { CONTRACT_SELECT, isDate } from './invoices.js';

/* ---------- отчёты ---------- */
// Период по МСК: from/to — YYYY-MM-DD включительно (по умолчанию текущий месяц)
export function period(q) {
  const today = todayMsk();
  const from = isDate(q.from) ? q.from : `${today.slice(0, 7)}-01`;
  const to = isDate(q.to) ? q.to : today;
  return { from, to };
}
const MSK = (col) => `date(${col}, '+3 hours')`;

// Работа сотрудников за период
api.get('/reports/team', requireRole('admin', 'manager'), wrap((req) => {
  const { from, to } = period(req.query);
  const today = todayMsk();
  const users = all('SELECT id, name, color, position, hourly_rate, active FROM users ORDER BY active DESC, name');
  return { from, to, rows: users.map((u) => {
    const time = get(`SELECT COALESCE(SUM(duration_sec),0) sec, COUNT(DISTINCT ${MSK('started_at')}) days FROM time_entries
      WHERE user_id = ? AND ended_at IS NOT NULL AND ${MSK('started_at')} BETWEEN ? AND ?`, u.id, from, to);
    const closed = get(`SELECT COUNT(*) n, AVG(julianday(completed_at) - julianday(created_at)) avg_days,
        SUM(due_date IS NOT NULL AND ${MSK('completed_at')} > due_date) late
      FROM tasks WHERE assignee_id = ? AND status = 'done' AND ${MSK('completed_at')} BETWEEN ? AND ?`, u.id, from, to);
    const open = get(`SELECT COUNT(*) n, SUM(due_date IS NOT NULL AND due_date < ?) overdue FROM tasks WHERE assignee_id = ? AND status != 'done'`, today, u.id);
    const tickets = get(`SELECT COUNT(*) n, SUM(due_at IS NOT NULL AND resolved_at > due_at) late FROM tickets
      WHERE assignee_id = ? AND resolved_at IS NOT NULL AND ${MSK('resolved_at')} BETWEEN ? AND ?`, u.id, from, to);
    return { ...u, hours: Math.round((time.sec / 3600) * 100) / 100, days: time.days, tasks_closed: closed.n, tasks_closed_late: closed.late || 0,
      avg_close_days: closed.avg_days != null ? Math.round(closed.avg_days * 10) / 10 : null, tasks_open: open.n, tasks_overdue: open.overdue || 0,
      tickets_resolved: tickets.n, tickets_late: tickets.late || 0 };
  }) };
}));

// Рентабельность клиентов: выручка (доходы с привязкой к клиенту) против себестоимости часов (часы × ставка сотрудника)
api.get('/reports/profit', requireRole('admin', 'manager'), wrap((req) => {
  const { from, to } = period(req.query);
  const rows = all(`SELECT c.id, c.name,
      (SELECT COALESCE(SUM(amount),0) FROM transactions x WHERE x.client_id = c.id AND x.type = 'income' AND x.date BETWEEN ? AND ?) revenue,
      (SELECT COALESCE(SUM(amount),0) FROM transactions x WHERE x.client_id = c.id AND x.type = 'expense' AND x.date BETWEEN ? AND ?) expenses
    FROM clients c ORDER BY c.name`, from, to, from, to);
  const time = all(`SELECT COALESCE(p.client_id, t.client_id) client_id, SUM(e.duration_sec) sec, SUM(e.duration_sec / 3600.0 * COALESCE(u.hourly_rate,0)) cost
    FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN tickets t ON t.id = e.ticket_id
    WHERE e.ended_at IS NOT NULL AND ${MSK('e.started_at')} BETWEEN ? AND ? AND COALESCE(p.client_id, t.client_id) IS NOT NULL
    GROUP BY COALESCE(p.client_id, t.client_id)`, from, to);
  const tm = Object.fromEntries(time.map((r) => [r.client_id, r]));
  const out = rows.map((c) => {
    const t = tm[c.id] || { sec: 0, cost: 0 };
    const hours = t.sec / 3600;
    const cost = Math.round(t.cost + c.expenses);
    const profit = Math.round(c.revenue - cost);
    return { ...c, hours: Math.round(hours * 100) / 100, labor_cost: Math.round(t.cost), cost, profit,
      margin: c.revenue ? Math.round((profit / c.revenue) * 100) : null, rate: hours ? Math.round(c.revenue / hours) : null };
  }).filter((c) => c.revenue || c.hours || c.expenses);
  const noRate = get('SELECT COUNT(*) n FROM users WHERE active = 1 AND COALESCE(hourly_rate,0) = 0').n;
  return { from, to, rows: out.sort((a, b) => b.revenue - a.revenue), users_without_rate: noRate };
}));

// Отчёт для клиента: что сделано за период (для печати / PDF)
api.get('/reports/client', requireRole('admin', 'manager'), wrap((req) => buildClientReport(req.query)));
export function buildClientReport(query, forPortal = false) {
  const { from, to } = period(query);
  let contract = null;
  let clientId = Number(query.client_id) || null;
  let projectId = forPortal ? null : Number(query.project_id) || null;
  if (query.contract_id && !forPortal) {
    contract = get(`${CONTRACT_SELECT} WHERE k.id = ?`, Number(query.contract_id));
    if (!contract) throw notFound();
    clientId = contract.client_id; projectId = contract.project_id;
  }
  if (forPortal) contract = get(`${CONTRACT_SELECT} WHERE k.client_id = ? AND k.active = 1 ORDER BY k.id LIMIT 1`, clientId) || null;
  if (!clientId && !projectId) throw bad('Выберите клиента');
  const client = clientId ? get('SELECT * FROM clients WHERE id = ?', clientId) : null;
  const project = projectId ? get('SELECT id, name FROM projects WHERE id = ?', projectId) : null;
  const company = (!forPortal && query.company_id && get('SELECT * FROM companies WHERE id = ?', Number(query.company_id)))
    || get('SELECT * FROM companies ORDER BY is_default DESC, id LIMIT 1') || null;
  const match = `((? IS NOT NULL AND (e.project_id = ? OR t.project_id = ?)) OR (? IS NOT NULL AND (p.client_id = ? OR t.client_id = ?)))`;
  const margs = [projectId, projectId, projectId, clientId, clientId, clientId];
  // Время, сгруппированное по задаче / заявке
  const work = all(`SELECT e.task_id, e.ticket_id, tk.title task_title, tk.status task_status, t.title ticket_title, t.status ticket_status,
      SUM(e.duration_sec) sec, MIN(${MSK('e.started_at')}) first_day, MAX(${MSK('e.started_at')}) last_day,
      GROUP_CONCAT(DISTINCT u.name) people, GROUP_CONCAT(e.description, '\u0001') notes
    FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN tickets t ON t.id = e.ticket_id
    LEFT JOIN tasks tk ON tk.id = e.task_id
    WHERE e.ended_at IS NOT NULL AND ${MSK('e.started_at')} BETWEEN ? AND ? AND ${match}
    GROUP BY e.task_id, e.ticket_id ORDER BY last_day DESC`, from, to, ...margs)
    .map((w) => ({ ...w, notes: [...new Set(String(w.notes || '').split('\u0001').map((x) => x.trim()).filter(Boolean))].slice(0, 8) }));
  // Итоги по закрытым задачам (отчёт «с каким итогом закрыта»)
  const closed = all(`SELECT tk.id, tk.title, tk.completed_at,
      (SELECT c.body FROM task_comments c WHERE c.task_id = tk.id AND c.report = 'close' ORDER BY c.id DESC LIMIT 1) result
    FROM tasks tk JOIN projects p ON p.id = tk.project_id
    WHERE tk.status = 'done' AND ${MSK('tk.completed_at')} BETWEEN ? AND ? AND ((? IS NOT NULL AND tk.project_id = ?) OR (? IS NOT NULL AND p.client_id = ?))
    ORDER BY tk.completed_at`, from, to, projectId, projectId, clientId, clientId);
  const tickets = all(`SELECT t.id, t.title, t.resolved_at, t.resolution FROM tickets t
    WHERE t.resolved_at IS NOT NULL AND ${MSK('t.resolved_at')} BETWEEN ? AND ? AND ((? IS NOT NULL AND t.project_id = ?) OR (? IS NOT NULL AND t.client_id = ?))
    ORDER BY t.resolved_at`, from, to, projectId, projectId, clientId, clientId);
  const total = work.reduce((a, w) => a + w.sec, 0);
  return { from, to, client, project, company, contract, work, closed, tickets, total_sec: total };
}
