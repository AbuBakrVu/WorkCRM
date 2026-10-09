import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, tx, logActivity, UPLOAD_DIR } from './db.js';
import { nextDate, addDays, todayMsk } from './recurrence.js';
import { requestUser, recordChanges, recordEvent, trashDelete, trashRestore, trashPurge } from './audit.js';
import { renderDocx, docxToPdf, templateTags, buildUpd, paymentQr } from './docgen.js';
import {
  requireAuth, requireRole, issueToken, clearToken, hashPassword, checkPassword, encryptSecret, decryptSecret,
  publicUser, loginRateLimit,
} from './auth.js';

export const api = Router();

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const notFound = () => new HttpError(404, 'Не найдено');

const wrap = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) { next(e); }
};

// Берём из тела только разрешённые поля; '' → null, boolean → 0/1
function pick(body, fields) {
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

function insert(table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return Number(run(sql, ...keys.map((k) => data[k])).lastInsertRowid);
}
function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  recordChanges(table, id, data); // история изменений
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), id);
}
const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw bad('Неверный id');
  return id;
};
const required = (data, ...fields) => {
  for (const f of fields) if (data[f] === null || data[f] === undefined || String(data[f]).trim() === '') throw bad(`Поле «${f}» обязательно`);
};
const nowIso = () => new Date().toISOString();

/* ---------- auth ---------- */
api.get('/health', (req, res) => res.json({ ok: true }));

// Веб-форма первого запуска. На сервере отключена (ALLOW_WEB_SETUP=false) — администратор создаётся через install.sh
const WEB_SETUP = process.env.ALLOW_WEB_SETUP !== 'false';
api.get('/auth/setup', wrap(() => ({ needsSetup: WEB_SETUP && get('SELECT COUNT(*) c FROM users').c === 0 })));

// Первый запуск: создание администратора (работает только при пустой таблице users)
api.post('/auth/setup', wrap((req, res) => {
  if (!WEB_SETUP || get('SELECT COUNT(*) c FROM users').c > 0) throw new HttpError(403, 'Система уже настроена');
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 8) throw bad('Укажите имя, email и пароль от 8 символов');
  const id = insert('users', { name, email, password_hash: hashPassword(password), role: 'admin', color: '#4f46e5', position: 'Администратор' });
  const user = get('SELECT * FROM users WHERE id = ?', id);
  issueToken(res, user);
  return publicUser(user);
}));

api.post('/auth/login', loginRateLimit, wrap((req, res) => {
  const { email, password } = req.body || {};
  const user = email && get('SELECT * FROM users WHERE email = ? AND active = 1', String(email).trim());
  if (!user && email) { // вход клиента в личный кабинет
    const p = get('SELECT * FROM portal_users WHERE email = ? AND active = 1', String(email).trim());
    if (p && checkPassword(String(password || ''), p.password_hash)) {
      issueToken(res, p, true);
      run("UPDATE portal_users SET last_login_at = datetime('now') WHERE id = ?", p.id);
      return { portal: true, id: p.id, name: p.name, email: p.email, client_id: p.client_id };
    }
  }
  const ok = !!user && checkPassword(String(password || ''), user.password_hash);
  const ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64);
  run('INSERT INTO auth_log (user_id, email, ok, ip, user_agent) VALUES (?,?,?,?,?)', user?.id ?? null, String(email || '').slice(0, 120), ok ? 1 : 0, ip, String(req.get('user-agent') || '').slice(0, 300));
  if (!ok) throw new HttpError(401, 'Неверный email или пароль');
  issueToken(res, user);
  return publicUser(user);
}));

api.post('/auth/logout', wrap((req, res) => { clearToken(res); return { ok: true }; }));

api.use(requireAuth);
// Клиент из личного кабинета видит только /portal/*, /auth/me и выход
api.use((req, res, next) => {
  if (!req.portal) return requestUser.run({ userId: req.user.id }, next);
  if (req.path === '/auth/me') return res.json({ portal: true, ...req.portal });
  if (req.path.startsWith('/portal/')) return next();
  // Из файлов клиенту доступен только логотип нашей компании (для шапки кабинета и отчётов)
  const f = req.method === 'GET' && req.path.match(/^\/files\/(\d+)$/);
  if (f && get('SELECT 1 FROM companies WHERE logo_file_id = ?', Number(f[1]))) return next();
  return res.status(403).json({ error: 'Недостаточно прав' });
});

api.get('/auth/me', wrap((req) => req.user));

api.put('/auth/me', wrap((req) => {
  const data = pick(req.body, ['name', 'phone', 'position', 'color']);
  if (req.body?.new_password) {
    const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!checkPassword(String(req.body.current_password || ''), u.password_hash)) throw bad('Текущий пароль неверен');
    if (String(req.body.new_password).length < 8) throw bad('Пароль должен быть не короче 8 символов');
    data.password_hash = hashPassword(String(req.body.new_password));
  }
  update('users', req.user.id, data);
  return publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id));
}));

/* ---------- users ---------- */
const USER_FIELDS = ['name', 'email', 'role', 'position', 'phone', 'color', 'hourly_rate', 'active'];

api.get('/users', wrap(() => all(`
  SELECT u.id, u.name, u.email, u.role, u.position, u.phone, u.color, u.hourly_rate, u.active, u.created_at,
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status != 'done') open_tasks,
    (SELECT COUNT(*) FROM tickets k WHERE k.assignee_id = u.id AND k.status IN ('new','in_progress','waiting')) open_tickets,
    (SELECT COALESCE(SUM(duration_sec),0) FROM time_entries e WHERE e.user_id = u.id AND e.started_at >= date('now','-6 days')) week_sec
  FROM users u ORDER BY u.active DESC, u.name`)));

api.post('/users', requireRole('admin'), wrap((req) => {
  const data = pick(req.body, USER_FIELDS);
  required(data, 'name', 'email');
  const pwd = String(req.body?.password || '');
  if (pwd.length < 8) throw bad('Пароль должен быть не короче 8 символов');
  if (get('SELECT id FROM users WHERE email = ?', data.email)) throw bad('Пользователь с таким email уже есть');
  data.password_hash = hashPassword(pwd);
  const id = insert('users', data);
  logActivity(req.user.id, 'user', id, 'create', `добавил сотрудника «${data.name}»`);
  return publicUser(get('SELECT * FROM users WHERE id = ?', id));
}));

api.put('/users/:id', requireRole('admin'), wrap((req) => {
  const id = idParam(req);
  const data = pick(req.body, USER_FIELDS);
  if (req.body?.password) {
    if (String(req.body.password).length < 8) throw bad('Пароль должен быть не короче 8 символов');
    data.password_hash = hashPassword(String(req.body.password));
  }
  if (id === req.user.id && (data.role && data.role !== 'admin' || data.active === 0)) throw bad('Нельзя понизить или отключить самого себя');
  update('users', id, data);
  return publicUser(get('SELECT * FROM users WHERE id = ?', id));
}));

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
  c.transactions = all('SELECT id, type, amount, date, description FROM transactions WHERE client_id = ? ORDER BY date DESC LIMIT 20', id);
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

/* ---------- tasks ---------- */
const TASK_FIELDS = ['project_id', 'title', 'description', 'status', 'assignee_id', 'start_date', 'due_date', 'position', 'parent_id'];
const TASK_SELECT = `SELECT t.*, u.name assignee_name, u.color assignee_color, p.name project_name, cb.name creator_name, cb.color creator_color,
    (SELECT COALESCE(SUM(duration_sec),0) FROM time_entries e WHERE e.task_id = t.id) tracked_sec,
    (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.kind = 'text') comments_count,
    (SELECT MAX(id) FROM task_comments c WHERE c.task_id = t.id AND c.kind = 'text') last_comment_id,
    (SELECT COUNT(*) FROM files f WHERE f.task_id = t.id) files_count,
    (SELECT GROUP_CONCAT(user_id) FROM task_members m WHERE m.task_id = t.id AND m.role = 'coassignee') coassignee_ids,
    (SELECT GROUP_CONCAT(user_id) FROM task_members m WHERE m.task_id = t.id AND m.role = 'observer') observer_ids,
    (SELECT COUNT(*) FROM task_checklist k WHERE k.task_id = t.id) check_total,
    (SELECT COUNT(*) FROM task_checklist k WHERE k.task_id = t.id AND k.done = 1) check_done,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) sub_total,
    (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') sub_done,
    (SELECT COUNT(*) FROM task_deps dd JOIN tasks b ON b.id = dd.blocked_by_id WHERE dd.task_id = t.id AND b.status != 'done') blocked_count,
    (SELECT title FROM tasks pt WHERE pt.id = t.parent_id) parent_title
  FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id JOIN projects p ON p.id = t.project_id
  LEFT JOIN users cb ON cb.id = t.created_by`;

const ids = (v) => (v ? String(v).split(',').map(Number) : []);
const shapeTask = (t) => t && ({ ...t, coassignee_ids: ids(t.coassignee_ids), observer_ids: ids(t.observer_ids) });
const getTask = (id) => shapeTask(get(`${TASK_SELECT} WHERE t.id = ?`, id));

// Права на задачу:
//  edit   — менять поля (название, описание, сроки, людей) и удалять: администратор или постановщик
//           (у старых задач без постановщика — администратор и менеджер). Закрытую задачу менять нельзя.
//  status — начать / завершить / возобновить: те, кто может edit, + исполнитель и соисполнители
function taskPerms(user, t) {
  const admin = user.role === 'admin';
  const owner = t.created_by ? t.created_by === user.id : user.role === 'manager';
  const doer = t.assignee_id === user.id || (t.coassignee_ids || []).includes(user.id);
  return { edit: admin || owner, status: admin || owner || doer };
}

const userName = (uid) => get('SELECT name FROM users WHERE id = ?', uid)?.name || 'сотрудник';
// Синхронизация соисполнителей/наблюдателей + системные сообщения в чат
function setTaskMembers(taskId, role, list, actorId) {
  if (!Array.isArray(list)) return;
  const next = new Set(list.map(Number).filter(Boolean));
  const cur = new Set(all('SELECT user_id FROM task_members WHERE task_id = ? AND role = ?', taskId, role).map((r) => r.user_id));
  const label = role === 'observer' ? 'наблюдателя' : 'соисполнителя';
  for (const uid of next) if (!cur.has(uid)) {
    run('INSERT OR IGNORE INTO task_members (task_id, user_id, role) VALUES (?,?,?)', taskId, uid, role);
    systemComment(taskId, actorId, `добавил ${label}: ${userName(uid)}`);
  }
  for (const uid of cur) if (!next.has(uid)) {
    run('DELETE FROM task_members WHERE task_id = ? AND user_id = ? AND role = ?', taskId, uid, role);
    systemComment(taskId, actorId, `убрал ${label}: ${userName(uid)}`);
  }
}

api.get('/tasks', wrap((req) => {
  const where = []; const params = [];
  if (req.query.project_id) { where.push('t.project_id = ?'); params.push(Number(req.query.project_id)); }
  if (req.query.assignee_id) { where.push('t.assignee_id = ?'); params.push(Number(req.query.assignee_id)); }
  if (req.query.open) where.push("t.status != 'done'");
  return all(`${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.id DESC`, ...params).map(shapeTask);
}));
api.get('/tasks/:id', wrap((req) => {
  const t = getTask(idParam(req));
  if (!t) throw notFound();
  return taskDetails(t);
}));
// Полная карточка: чек-лист, подзадачи, зависимости
function taskDetails(t) {
  return {
    ...t,
    checklist: all('SELECT k.*, u.name done_by_name FROM task_checklist k LEFT JOIN users u ON u.id = k.done_by WHERE k.task_id = ? ORDER BY k.position, k.id', t.id),
    subtasks: all(`SELECT s.id, s.title, s.status, s.due_date, s.assignee_id, u.name assignee_name, u.color assignee_color
      FROM tasks s LEFT JOIN users u ON u.id = s.assignee_id WHERE s.parent_id = ? ORDER BY s.status = 'done', s.id`, t.id),
    blocked_by: all(`SELECT b.id, b.title, b.status, p.name project_name FROM task_deps d JOIN tasks b ON b.id = d.blocked_by_id
      JOIN projects p ON p.id = b.project_id WHERE d.task_id = ? ORDER BY b.status = 'done', b.id`, t.id),
    blocks: all(`SELECT b.id, b.title, b.status FROM task_deps d JOIN tasks b ON b.id = d.task_id WHERE d.blocked_by_id = ? ORDER BY b.id`, t.id),
  };
}
// Родитель подзадачи: из того же проекта, не сама задача и без циклов
function checkParent(taskId, parentId, projectId) {
  if (!parentId) return;
  const p = get('SELECT id, project_id, parent_id FROM tasks WHERE id = ?', parentId);
  if (!p) throw bad('Родительская задача не найдена');
  if (Number(p.project_id) !== Number(projectId)) throw bad('Подзадача должна быть в том же проекте');
  for (let cur = p, n = 0; cur && n < 50; cur = cur.parent_id && get('SELECT id, parent_id FROM tasks WHERE id = ?', cur.parent_id), n++)
    if (taskId && cur.id === taskId) throw bad('Нельзя сделать задачу подзадачей самой себя');
}
api.post('/tasks', wrap((req) => {
  const data = pick(req.body, TASK_FIELDS);
  required(data, 'project_id', 'title');
  checkParent(null, data.parent_id, data.project_id);
  data.created_by = req.user.id;
  if (data.status === 'done') data.completed_at = nowIso();
  const id = tx(() => {
    const id = insert('tasks', data);
    systemComment(id, req.user.id, 'создал задачу');
    setTaskMembers(id, 'coassignee', req.body.coassignee_ids, req.user.id);
    setTaskMembers(id, 'observer', req.body.observer_ids, req.user.id);
    if (Array.isArray(req.body.checklist)) req.body.checklist.map((x) => String(x || '').trim()).filter(Boolean)
      .forEach((text, i) => insert('task_checklist', { task_id: id, position: i, text: text.slice(0, 500) }));
    if (data.parent_id) systemComment(data.parent_id, req.user.id, `добавил подзадачу «${data.title}»`);
    return id;
  });
  const pname = get('SELECT name FROM projects WHERE id = ?', data.project_id)?.name;
  logActivity(req.user.id, 'task', id, 'create', `добавил задачу «${data.title}»${pname ? ` в ${pname}` : ''}`);
  return getTask(id);
}));
api.put('/tasks/:id', wrap((req) => {
  const id = idParam(req);
  const before = getTask(id);
  if (!before) throw notFound();
  const data = pick(req.body, TASK_FIELDS);
  const perms = taskPerms(req.user, before);
  if ('parent_id' in data) checkParent(id, data.parent_id, data.project_id ?? before.project_id);
  const statusChange = data.status && data.status !== before.status;
  delete data.status;
  // Изменились ли «содержательные» поля (всё, кроме статуса)?
  const changed = Object.keys(data).filter((k) => (data[k] ?? null) !== (before[k] ?? null));
  const membersChange = Array.isArray(req.body.coassignee_ids) || Array.isArray(req.body.observer_ids);
  if (changed.length || membersChange) {
    if (!perms.edit) throw new HttpError(403, 'Менять задачу может только постановщик или администратор');
    if (before.status === 'done') throw new HttpError(403, 'Задача закрыта. Чтобы изменить её, сначала возобновите');
  }
  if (statusChange && !perms.status) throw new HttpError(403, 'Менять статус могут исполнитель, соисполнители, постановщик или администратор');

  const STATUS_TEXT = { todo: before.status === 'done' ? 'возобновил задачу' : 'приостановил задачу', in_progress: 'начал выполнение задачи', done: 'завершил задачу' };
  tx(() => {
    if (statusChange) {
      data.status = req.body.status;
      data.completed_at = data.status === 'done' ? nowIso() : null;
      systemComment(id, req.user.id, STATUS_TEXT[data.status] || `сменил статус на ${data.status}`);
      if (data.status === 'done') logActivity(req.user.id, 'task', id, 'done', `закрыл задачу «${before.title}»`);
      else if (before.status === 'done') logActivity(req.user.id, 'task', id, 'reopen', `возобновил задачу «${before.title}»`);
    }
    if (changed.includes('assignee_id')) {
      systemComment(id, req.user.id, data.assignee_id ? `назначил исполнителя: ${userName(data.assignee_id)}` : 'снял исполнителя');
    }
    if (changed.includes('due_date')) {
      systemComment(id, req.user.id, data.due_date ? `изменил крайний срок: ${data.due_date.split('-').reverse().join('.')}` : 'убрал крайний срок');
    }
    if (changed.includes('title') || changed.includes('description')) systemComment(id, req.user.id, 'изменил описание задачи');
    update('tasks', id, data);
    setTaskMembers(id, 'coassignee', req.body.coassignee_ids, req.user.id);
    setTaskMembers(id, 'observer', req.body.observer_ids, req.user.id);
  });
  return taskDetails(getTask(id));
}));
api.delete('/tasks/:id', wrap((req) => {
  const id = idParam(req);
  const t = getTask(id);
  if (!t) throw notFound();
  if (!taskPerms(req.user, t).edit) throw new HttpError(403, 'Удалить задачу может только постановщик или администратор');
  trashDelete('task', 'tasks', id, t.title); // файлы остаются на диске, пока задача в корзине
  logActivity(req.user.id, 'task', id, 'delete', `удалил задачу «${t.title}»`);
  return { ok: true };
}));

/* ---------- повторяющиеся задачи ---------- */
const REC_FIELDS = ['project_id', 'title', 'description', 'assignee_id', 'freq', 'every', 'weekdays', 'monthday', 'due_days', 'next_date', 'end_date', 'active'];
const REC_SELECT = `SELECT r.*, p.name project_name, u.name assignee_name, u.color assignee_color,
    (SELECT COUNT(*) FROM tasks t WHERE t.recurrence_id = r.id) tasks_count
  FROM task_recurrences r JOIN projects p ON p.id = r.project_id LEFT JOIN users u ON u.id = r.assignee_id`;
const shapeRec = (r) => r && ({ ...r, coassignee_ids: ids(r.coassignee_ids), observer_ids: ids(r.observer_ids), checklist: r.checklist ? JSON.parse(r.checklist) : [] });
function recData(req, before = {}) {
  const data = pick(req.body, REC_FIELDS);
  const m = { ...before, ...data };
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(m.freq)) throw bad('Неверная периодичность');
  if (data.every != null) data.every = Math.min(365, Math.max(1, Math.round(Number(data.every)) || 1));
  if (data.due_days != null) data.due_days = Math.min(365, Math.max(0, Math.round(Number(data.due_days)) || 0));
  if (data.monthday != null) data.monthday = Math.min(31, Math.max(1, Math.round(Number(data.monthday)) || 1));
  for (const k of ['next_date', 'end_date']) if (data[k] && !/^\d{4}-\d{2}-\d{2}$/.test(data[k])) throw bad('Неверная дата');
  if (Array.isArray(req.body.coassignee_ids)) data.coassignee_ids = req.body.coassignee_ids.map(Number).filter(Boolean).join(',') || null;
  if (Array.isArray(req.body.observer_ids)) data.observer_ids = req.body.observer_ids.map(Number).filter(Boolean).join(',') || null;
  if (Array.isArray(req.body.checklist)) data.checklist = JSON.stringify(req.body.checklist.map((x) => String(x || '').trim().slice(0, 500)).filter(Boolean).slice(0, 100));
  return data;
}
const recPerm = (user, r) => user.role === 'admin' || user.role === 'manager' || r.created_by === user.id;

// Создаёт задачи по расписанию: всё, у чего дата запуска наступила (по МСК). Пропущенные дни не «догоняет» — одна задача.
export function runRecurrences() {
  const today = todayMsk();
  const due = all('SELECT * FROM task_recurrences WHERE active = 1 AND next_date <= ?', today);
  for (const r of due) {
    try {
      tx(() => {
        let runDate = r.next_date;
        // если сервер был выключен — берём последнюю наступившую дату, а не плодим копии
        for (let n = nextDate(r, runDate, false, r.created_at.slice(0, 10)); n <= today; n = nextDate(r, n, false, r.created_at.slice(0, 10))) runDate = n;
        const id = insert('tasks', { project_id: r.project_id, title: r.title, description: r.description, assignee_id: r.assignee_id,
          status: 'todo', due_date: addDays(runDate, r.due_days || 0), created_by: r.created_by, recurrence_id: r.id });
        run("INSERT INTO task_comments (task_id, user_id, kind, body) VALUES (?, ?, 'system', ?)", id, r.created_by, 'создал задачу по расписанию');
        for (const uid of ids(r.coassignee_ids)) run("INSERT OR IGNORE INTO task_members (task_id, user_id, role) VALUES (?, ?, 'coassignee')", id, uid);
        for (const uid of ids(r.observer_ids)) run("INSERT OR IGNORE INTO task_members (task_id, user_id, role) VALUES (?, ?, 'observer')", id, uid);
        (r.checklist ? JSON.parse(r.checklist) : []).forEach((text, i) => insert('task_checklist', { task_id: id, position: i, text }));
        const next = nextDate(r, runDate, false, r.created_at.slice(0, 10));
        const ended = r.end_date && next > r.end_date;
        run('UPDATE task_recurrences SET next_date = ?, active = ? WHERE id = ?', next, ended ? 0 : 1, r.id);
      });
    } catch (e) { console.error('Повторяющаяся задача', r.id, e.message); }
  }
}

api.get('/recurrences', wrap(() => all(`${REC_SELECT} ORDER BY r.active DESC, r.next_date`).map(shapeRec)));
api.post('/recurrences', wrap((req) => {
  const data = recData(req);
  required(data, 'project_id', 'title', 'freq');
  data.next_date = data.next_date || todayMsk();
  data.created_by = req.user.id;
  // первая дата — ближайшая подходящая под правило, начиная с указанной
  data.next_date = nextDate(data, data.next_date, true, todayMsk());
  const id = insert('task_recurrences', data);
  logActivity(req.user.id, 'project', data.project_id, 'recurrence', `настроил повторяющуюся задачу «${data.title}»`);
  runRecurrences();
  return shapeRec(get(`${REC_SELECT} WHERE r.id = ?`, id));
}));
api.put('/recurrences/:id', wrap((req) => {
  const id = idParam(req);
  const before = get('SELECT * FROM task_recurrences WHERE id = ?', id);
  if (!before) throw notFound();
  if (!recPerm(req.user, before)) throw new HttpError(403, 'Менять расписание может автор, менеджер или администратор');
  const data = recData(req, before);
  const m = { ...before, ...data };
  if (data.next_date || data.freq || data.weekdays !== undefined || data.monthday !== undefined) data.next_date = nextDate(m, m.next_date, true, before.created_at.slice(0, 10));
  update('task_recurrences', id, data);
  runRecurrences();
  return shapeRec(get(`${REC_SELECT} WHERE r.id = ?`, id));
}));
api.delete('/recurrences/:id', wrap((req) => {
  const id = idParam(req);
  const r = get('SELECT * FROM task_recurrences WHERE id = ?', id);
  if (!r) throw notFound();
  if (!recPerm(req.user, r)) throw new HttpError(403, 'Удалить расписание может автор, менеджер или администратор');
  run('DELETE FROM task_recurrences WHERE id = ?', id);
  return { ok: true };
}));

/* ---------- чек-лист задачи ---------- */
// Пункты отмечают и добавляют все, кто может работать с задачей (исполнитель, соисполнители, постановщик, админ)
function checklistTask(req, taskId) {
  const t = getTask(taskId);
  if (!t) throw notFound();
  if (!taskPerms(req.user, t).status) throw new HttpError(403, 'Чек-лист меняют исполнитель, соисполнители, постановщик или администратор');
  return t;
}
const checkItem = (cid) => get('SELECT * FROM task_checklist WHERE id = ?', cid) || (() => { throw notFound(); })();
api.post('/tasks/:id/checklist', wrap((req) => {
  const id = idParam(req);
  checklistTask(req, id);
  const lines = String(req.body?.text || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 100);
  if (!lines.length) throw bad('Пустой пункт');
  let pos = (get('SELECT MAX(position) m FROM task_checklist WHERE task_id = ?', id)?.m ?? -1) + 1;
  tx(() => lines.forEach((text) => insert('task_checklist', { task_id: id, position: pos++, text: text.slice(0, 500) })));
  return taskDetails(getTask(id)).checklist;
}));
api.put('/checklist/:id', wrap((req) => {
  const item = checkItem(idParam(req));
  checklistTask(req, item.task_id);
  const data = {};
  if (req.body.text !== undefined) { data.text = String(req.body.text).trim().slice(0, 500); if (!data.text) throw bad('Пустой пункт'); }
  if (req.body.done !== undefined) {
    data.done = req.body.done ? 1 : 0;
    data.done_by = data.done ? req.user.id : null;
    data.done_at = data.done ? nowIso() : null;
  }
  update('task_checklist', item.id, data);
  return taskDetails(getTask(item.task_id)).checklist;
}));
api.delete('/checklist/:id', wrap((req) => {
  const item = checkItem(idParam(req));
  checklistTask(req, item.task_id);
  run('DELETE FROM task_checklist WHERE id = ?', item.id);
  return taskDetails(getTask(item.task_id)).checklist;
}));
api.post('/tasks/:id/checklist/order', wrap((req) => {
  const id = idParam(req);
  checklistTask(req, id);
  const order = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  tx(() => order.forEach((cid, i) => run('UPDATE task_checklist SET position = ? WHERE id = ? AND task_id = ?', i, cid, id)));
  return taskDetails(getTask(id)).checklist;
}));

/* ---------- зависимости: «задачу можно начать после …» ---------- */
api.put('/tasks/:id/deps', wrap((req) => {
  const id = idParam(req);
  const t = getTask(id);
  if (!t) throw notFound();
  if (!taskPerms(req.user, t).edit) throw new HttpError(403, 'Зависимости меняет постановщик или администратор');
  const list = [...new Set((Array.isArray(req.body?.blocked_by) ? req.body.blocked_by : []).map(Number).filter((x) => x && x !== id))];
  // Нет циклов: ни одна из блокирующих задач не должна (через цепочку) ждать эту
  const waitsFor = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return all('SELECT blocked_by_id b FROM task_deps WHERE task_id = ?', from).some((r) => waitsFor(r.b, target, seen));
  };
  for (const b of list) {
    if (!get('SELECT 1 FROM tasks WHERE id = ?', b)) throw bad('Задача не найдена');
    if (waitsFor(b, id)) throw bad('Получается замкнутый круг зависимостей');
  }
  tx(() => {
    run('DELETE FROM task_deps WHERE task_id = ?', id);
    list.forEach((b) => run('INSERT INTO task_deps (task_id, blocked_by_id) VALUES (?, ?)', id, b));
  });
  return taskDetails(getTask(id));
}));

/* ---------- комментарии к задачам (чат) ---------- */
const COMMENT_SELECT = `SELECT c.*, u.name user_name, u.color user_color, f.name file_name, f.size file_size, f.mime file_mime
  FROM task_comments c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN files f ON f.id = c.file_id`;
function systemComment(taskId, userId, body) {
  run("INSERT INTO task_comments (task_id, user_id, kind, body) VALUES (?, ?, 'system', ?)", taskId, userId, body);
}

// ?after=<id> — только новые сообщения (для автообновления чата)
api.get('/tasks/:id/comments', wrap((req) => {
  const after = Number(req.query.after) || 0;
  return all(`${COMMENT_SELECT} WHERE c.task_id = ? AND c.id > ? ORDER BY c.id`, idParam(req), after);
}));

api.post('/tasks/:id/comments', wrap((req) => {
  const id = idParam(req);
  const task = get('SELECT id, title FROM tasks WHERE id = ?', id);
  if (!task) throw notFound();
  const body = String(req.body?.body || '').trim();
  if (!body) throw bad('Пустое сообщение');
  if (body.length > 5000) throw bad('Сообщение слишком длинное (максимум 5000 символов)');
  const cid = insert('task_comments', { task_id: id, user_id: req.user.id, kind: 'text', body });
  logActivity(req.user.id, 'task', id, 'comment', `прокомментировал задачу «${task.title}»`);
  return get(`${COMMENT_SELECT} WHERE c.id = ?`, cid);
}));

// Удалить своё сообщение (админ/менеджер — любое)
// Рабочий цикл задачи одной кнопкой:
//  start — «Взять в работу» / «Продолжить»: статус «В работе» + таймер на задачу
//  pause — «Приостановить»: таймер стоп (время в табель) + статус «Открыта» + отчёт в чат
//  close — «Закрыть задачу»: таймер стоп + статус «Закрыта» + итог в чат
api.post('/tasks/:id/work', wrap((req) => {
  const id = idParam(req);
  const t = getTask(id);
  if (!t) throw notFound();
  if (!taskPerms(req.user, t).status) throw new HttpError(403, 'Работать с задачей могут исполнитель, соисполнители, постановщик или администратор');
  const action = req.body?.action;
  const note = String(req.body?.note || '').trim().slice(0, 5000);

  if (action === 'start') {
    if (t.status === 'done') throw bad('Задача закрыта. Сначала возобновите её');
    const blockers = all(`SELECT b.title FROM task_deps d JOIN tasks b ON b.id = d.blocked_by_id WHERE d.task_id = ? AND b.status != 'done'`, id);
    if (blockers.length) throw bad(`Сначала нужно закрыть: ${blockers.map((b) => `«${b.title}»`).join(', ')}`);
    tx(() => {
      if (t.status !== 'in_progress') {
        update('tasks', id, { status: 'in_progress', completed_at: null });
        systemComment(id, req.user.id, 'взял задачу в работу');
      }
      stopRunning(req.user.id);
      run('DELETE FROM timer_sessions WHERE user_id = ?', req.user.id);
      const params = { project_id: t.project_id, task_id: id, description: t.title };
      insert('time_entries', { ...params, user_id: req.user.id, started_at: nowIso() });
      insert('timer_sessions', { ...params, user_id: req.user.id, accumulated_sec: 0, paused: 0 });
    });
    logActivity(req.user.id, 'task', id, 'start', `взял в работу задачу «${t.title}»`);
    return { task: taskDetails(getTask(id)), timer: timerState(req.user.id) };
  }

  if (action === 'pause' || action === 'close') {
    if (!note) throw bad(action === 'close' ? 'Опишите, с каким итогом закрыта задача' : 'Опишите, что сделано за это время');
    let worked = 0;
    tx(() => {
      // Если таймер пользователя шёл по этой задаче — останавливаем и считаем время сессии
      const s = get('SELECT * FROM timer_sessions WHERE user_id = ?', req.user.id);
      const running = get('SELECT * FROM time_entries WHERE user_id = ? AND ended_at IS NULL', req.user.id);
      const mine = (s && s.task_id === id) || (running && running.task_id === id);
      if (mine) {
        const stopped = stopRunning(req.user.id);
        worked = (s && s.task_id === id ? s.accumulated_sec : 0) + (stopped?.dur || 0);
        run('DELETE FROM timer_sessions WHERE user_id = ?', req.user.id);
        if (stopped) run('UPDATE time_entries SET description = ? WHERE id = ?', note.slice(0, 300), stopped.id);
      }
      const status = action === 'close' ? 'done' : 'todo';
      if (t.status !== status) update('tasks', id, { status, completed_at: status === 'done' ? nowIso() : null });
      insert('task_comments', { task_id: id, user_id: req.user.id, kind: 'text', body: note, report: action, report_sec: worked });
    });
    logActivity(req.user.id, 'task', id, action === 'close' ? 'done' : 'pause',
      `${action === 'close' ? 'закрыл' : 'приостановил'} задачу «${t.title}»`);
    return { task: taskDetails(getTask(id)), timer: timerState(req.user.id), worked_sec: worked };
  }
  throw bad('Неизвестное действие');
}));

api.delete('/task-comments/:id', wrap((req) => {
  const c = get('SELECT * FROM task_comments WHERE id = ?', idParam(req));
  if (!c) throw notFound();
  if (c.kind !== 'text') throw bad('Системные события удалить нельзя');
  if (c.user_id !== req.user.id && !['admin', 'manager'].includes(req.user.role)) throw new HttpError(403, 'Можно удалить только своё сообщение');
  run('DELETE FROM task_comments WHERE id = ?', c.id);
  if (c.file_id) {
    const f = get('SELECT stored FROM files WHERE id = ?', c.file_id);
    run('DELETE FROM files WHERE id = ?', c.file_id);
    if (f) removeStored(f.stored);
  }
  return { ok: true };
}));

/* ---------- файлы задач ---------- */
const MAX_FILE = 25 * 1024 * 1024;
function removeStored(stored) {
  try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(stored))); } catch { /* уже удалён */ }
}

// Загрузка: тело запроса — сам файл (application/octet-stream), имя — в заголовке X-File-Name (encodeURIComponent)
api.post('/tasks/:id/files', express.raw({ type: 'application/octet-stream', limit: MAX_FILE }), wrap((req) => {
  const id = idParam(req);
  const task = get('SELECT id, title FROM tasks WHERE id = ?', id);
  if (!task) throw notFound();
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('Пустой файл');
  let name = 'файл';
  try { name = decodeURIComponent(String(req.get('X-File-Name') || 'файл')); } catch { /* оставляем по умолчанию */ }
  name = path.basename(name).replace(/[\x00-\x1f]/g, '').slice(0, 200) || 'файл';
  const mime = String(req.get('X-File-Type') || '').slice(0, 100) || null;
  const stored = `${crypto.randomUUID()}${path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), req.body);
  const caption = String(req.get('X-Caption') ? decodeURIComponent(req.get('X-Caption')) : '').trim().slice(0, 5000);
  const cid = tx(() => {
    const fid = insert('files', { task_id: id, user_id: req.user.id, name, size: req.body.length, mime, stored });
    return insert('task_comments', { task_id: id, user_id: req.user.id, kind: 'text', body: caption, file_id: fid });
  });
  logActivity(req.user.id, 'task', id, 'file', `прикрепил файл «${name}» к задаче «${task.title}»`);
  return get(`${COMMENT_SELECT} WHERE c.id = ?`, cid);
}));

api.get('/tasks/:id/files', wrap((req) => all(`SELECT f.id, f.name, f.size, f.mime, f.created_at, u.name user_name
  FROM files f LEFT JOIN users u ON u.id = f.user_id WHERE f.task_id = ? ORDER BY f.id DESC`, idParam(req))));

// Скачивание / просмотр (?inline=1 — открыть в браузере, для картинок)
api.get('/files/:id', (req, res, next) => {
  try {
    const f = get('SELECT * FROM files WHERE id = ?', idParam(req));
    if (!f) throw notFound();
    const file = path.join(UPLOAD_DIR, path.basename(f.stored));
    if (!fs.existsSync(file)) throw notFound();
    const safeInline = req.query.inline && /^image\/(png|jpe?g|gif|webp)$/.test(f.mime || '');
    res.setHeader('Content-Type', safeInline ? f.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(file);
  } catch (e) { next(e); }
});

/* ---------- tickets (заявки) ---------- */
const TICKET_FIELDS = ['title', 'description', 'category', 'priority', 'status', 'location', 'requester', 'requester_contact',
  'client_id', 'project_id', 'assignee_id', 'due_at', 'resolution', 'asset_id'];
const TICKET_SELECT = `SELECT k.*, u.name assignee_name, u.color assignee_color, c.name client_name, p.name project_name,
    (SELECT name FROM assets a WHERE a.id = k.asset_id) asset_name,
    (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = k.id) comments_count,
    (SELECT COALESCE(SUM(duration_sec),0) FROM time_entries e WHERE e.ticket_id = k.id) tracked_sec
  FROM tickets k LEFT JOIN users u ON u.id = k.assignee_id LEFT JOIN clients c ON c.id = k.client_id LEFT JOIN projects p ON p.id = k.project_id`;
const SLA_HOURS = { critical: 4, high: 8, normal: 24, low: 72 };

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
function ticketComments(id, forPortal = false) {
  return all(`SELECT m.id, m.ticket_id, m.body, m.created_at, m.internal, m.user_id, m.portal_user_id,
      COALESCE(u.name, pu.name) user_name, u.color user_color, m.portal_user_id IS NOT NULL from_client
    FROM ticket_comments m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN portal_users pu ON pu.id = m.portal_user_id
    WHERE m.ticket_id = ? ${forPortal ? 'AND m.internal = 0' : ''} ORDER BY m.created_at, m.id`, id);
}
api.post('/tickets/:id/comments', wrap((req) => {
  const id = idParam(req);
  const body = String(req.body?.body || '').trim();
  if (!body) throw bad('Пустой комментарий');
  insert('ticket_comments', { ticket_id: id, user_id: req.user.id, body: body.slice(0, 5000), internal: req.body?.internal ? 1 : 0 });
  return ticketComments(id);
}));
api.delete('/tickets/:id', requireRole('admin', 'manager'), wrap((req) => { const id = idParam(req); const t = get('SELECT title FROM tickets WHERE id = ?', id); trashDelete('ticket', 'tickets', id, t && `#${id} ${t.title}`); return { ok: true }; }));

/* ---------- мои компании (от чьего имени выставляем документы) ---------- */
const COMPANY_FIELDS = ['name', 'full_name', 'inn', 'kpp', 'ogrn', 'address', 'phone', 'email', 'site', 'bank_name', 'bik', 'account',
  'corr_account', 'director_name', 'director_title', 'accountant_name', 'vat_rate', 'is_default', 'edo_id'];
const COMPANY_IMAGES = { logo: 'logo_file_id', sign: 'sign_file_id', stamp: 'stamp_file_id' };
const VAT_RATES = ['none', '0', '5', '7', '10', '20', '22'];
const checkVat = (v) => { if (v != null && !VAT_RATES.includes(String(v))) throw bad('Неверная ставка НДС'); return v == null ? null : String(v); };
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
const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((d) => res.json(d)).catch(next);
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

/* ---------- deals (воронка) ---------- */
const DEAL_FIELDS = ['title', 'client_id', 'amount', 'stage', 'owner_id', 'expected_close', 'notes', 'position',
  'company_id', 'vat_mode', 'contract_no', 'contract_date', 'lost_reason', 'lost_comment', 'probability'];
const DEAL_SELECT = `SELECT d.*, c.name client_name, u.name owner_name, u.color owner_color, co.name company_name,
    (SELECT COUNT(*) FROM deal_items i WHERE i.deal_id = d.id) items_count
  FROM deals d LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN users u ON u.id = d.owner_id LEFT JOIN companies co ON co.id = d.company_id`;

// Суммы по позициям: НДС сверху (above) или в т.ч. (included). Округляем до копеек построчно.
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function calcItems(items, mode = 'above') {
  let net = 0, vat = 0, total = 0;
  const rows = items.map((it) => {
    const rate = it.vat_rate && it.vat_rate !== 'none' ? Number(it.vat_rate) : 0;
    const base = r2(it.qty * it.price);
    let lineVat, lineTotal, lineNet;
    if (mode === 'included') { lineTotal = base; lineVat = r2((base * rate) / (100 + rate)); lineNet = r2(base - lineVat); }
    else { lineNet = base; lineVat = r2((base * rate) / 100); lineTotal = r2(base + lineVat); }
    net += lineNet; vat += lineVat; total += lineTotal;
    return { ...it, net: lineNet, vat: lineVat, total: lineTotal };
  });
  return { rows, net: r2(net), vat: r2(vat), total: r2(total) };
}
const dealItems = (id) => all('SELECT * FROM deal_items WHERE deal_id = ? ORDER BY position, id', id);
function getDeal(id) {
  const d = get(`${DEAL_SELECT} WHERE d.id = ?`, id);
  if (!d) return null;
  const calc = calcItems(dealItems(id), d.vat_mode);
  return { ...d, items: calc.rows, totals: { net: calc.net, vat: calc.vat, total: calc.total } };
}
// Позиции сохраняются целиком списком; сумма сделки = итог по позициям
function saveItems(dealId, items, mode) {
  if (!Array.isArray(items)) return;
  const clean = items.map((it, i) => {
    const name = String(it?.name || '').trim().slice(0, 500);
    if (!name) throw bad(`Позиция ${i + 1}: укажите наименование`);
    const qty = Number(it.qty), price = Number(it.price);
    if (!Number.isFinite(qty) || qty <= 0) throw bad(`Позиция ${i + 1}: неверное количество`);
    if (!Number.isFinite(price) || price < 0) throw bad(`Позиция ${i + 1}: неверная цена`);
    return { name, unit: String(it.unit || 'шт').trim().slice(0, 20) || 'шт', qty, price, vat_rate: checkVat(it.vat_rate ?? null) };
  });
  run('DELETE FROM deal_items WHERE deal_id = ?', dealId);
  clean.forEach((it, i) => insert('deal_items', { deal_id: dealId, position: i, ...it }));
  if (clean.length) update('deals', dealId, { amount: calcItems(clean, mode).total });
}
const checkDeal = (data) => {
  if (data.vat_mode && !['above', 'included'].includes(data.vat_mode)) throw bad('Неверный режим НДС');
  if (data.probability != null) data.probability = Math.min(100, Math.max(0, Math.round(Number(data.probability)) || 0));
};
// При переходе в «Выиграна/Проиграна» — дата закрытия; при проигрыше нужна причина
function dealStageSide(data, before = {}) {
  if (!data.stage || data.stage === before.stage) return;
  if (['won', 'lost'].includes(data.stage)) data.closed_at = todayMsk();
  else { data.closed_at = null; data.lost_reason = null; data.lost_comment = null; }
  if (data.stage === 'lost' && !(data.lost_reason || before.lost_reason)) throw bad('Укажите причину проигрыша');
}

api.get('/deals', wrap(() => all(`${DEAL_SELECT} ORDER BY d.position, d.created_at DESC`)));
api.get('/deals/:id', wrap((req) => getDeal(idParam(req)) || (() => { throw notFound(); })()));
api.post('/deals', wrap((req) => {
  const data = pick(req.body, DEAL_FIELDS);
  required(data, 'title');
  checkDeal(data);
  dealStageSide(data);
  data.owner_id ??= req.user.id;
  data.company_id ??= get('SELECT id FROM companies ORDER BY is_default DESC, id LIMIT 1')?.id ?? null;
  const id = tx(() => {
    const nid = insert('deals', data);
    saveItems(nid, req.body.items, data.vat_mode || 'above');
    return nid;
  });
  logActivity(req.user.id, 'deal', id, 'create', `создал сделку «${data.title}»`);
  return getDeal(id);
}));
api.put('/deals/:id', wrap((req) => {
  const id = idParam(req);
  const before = get('SELECT * FROM deals WHERE id = ?', id);
  if (!before) throw notFound();
  const data = pick(req.body, DEAL_FIELDS);
  checkDeal(data);
  dealStageSide(data, before);
  tx(() => {
    update('deals', id, data);
    saveItems(id, req.body.items, data.vat_mode || before.vat_mode);
    if (!Array.isArray(req.body.items) && data.vat_mode && data.vat_mode !== before.vat_mode) {
      const items = dealItems(id);
      if (items.length) update('deals', id, { amount: calcItems(items, data.vat_mode).total });
    }
  });
  if (data.stage && data.stage !== before.stage) logActivity(req.user.id, 'deal', id, 'stage', `перевёл сделку «${before.title}» на этап ${data.stage}`);
  return getDeal(id);
}));
api.delete('/deals/:id', requireRole('admin', 'manager'), wrap((req) => { const id = idParam(req); trashDelete('deal', 'deals', id, get('SELECT title FROM deals WHERE id = ?', id)?.title); return { ok: true }; }));

/* ---------- нумерация документов: по компании, виду и году ---------- */
export function nextDocNumber(companyId, kind, date) {
  const year = Number(String(date || todayMsk()).slice(0, 4));
  run(`INSERT INTO doc_counters (company_id, kind, year, last) VALUES (?, ?, ?, 1)
    ON CONFLICT(company_id, kind, year) DO UPDATE SET last = last + 1`, companyId || 0, kind, year);
  return get('SELECT last FROM doc_counters WHERE company_id = ? AND kind = ? AND year = ?', companyId || 0, kind, year).last;
}

// Номер «на просмотр» (без резервирования) и фиксация после успешного формирования документа
function peekDocNumber(companyId, kind, date) {
  const year = Number(String(date || todayMsk()).slice(0, 4));
  return (get('SELECT last FROM doc_counters WHERE company_id = ? AND kind = ? AND year = ?', companyId || 0, kind, year)?.last || 0) + 1;
}
function commitDocNumber(companyId, kind, date, number) {
  const n = Number(number); if (!Number.isInteger(n)) return;
  const year = Number(String(date || todayMsk()).slice(0, 4));
  run(`INSERT INTO doc_counters (company_id, kind, year, last) VALUES (?, ?, ?, ?)
    ON CONFLICT(company_id, kind, year) DO UPDATE SET last = MAX(last, excluded.last)`, companyId || 0, kind, year, n);
}

/* ---------- счета ---------- */
const INVOICE_SELECT = `SELECT i.*, c.name client_name, co.name company_name, d.title deal_title
  FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN companies co ON co.id = i.company_id LEFT JOIN deals d ON d.id = i.deal_id`;
function invoiceStatus(i, today = todayMsk()) {
  if (i.cancelled) return 'cancelled';
  if (i.paid >= i.total - 0.005 && i.total > 0) return 'paid';
  if (i.due_date && i.due_date < today) return 'overdue';
  if (i.paid > 0) return 'partial';
  return 'issued';
}
const shapeInvoice = (i, today) => i && ({ ...i, status: invoiceStatus(i, today), debt: i.cancelled ? 0 : Math.max(0, Math.round((i.total - i.paid) * 100) / 100) });
function getInvoice(id) {
  const i = shapeInvoice(get(`${INVOICE_SELECT} WHERE i.id = ?`, id));
  if (!i) return null;
  const items = all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id', id);
  return { ...i, items: calcItems(items, i.vat_mode).rows,
    payments: all('SELECT p.*, u.name user_name FROM invoice_payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.invoice_id = ? ORDER BY p.date, p.id', id) };
}
function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) throw bad('Добавьте хотя бы одну позицию');
  return items.map((it, i) => {
    const name = String(it?.name || '').trim().slice(0, 500);
    if (!name) throw bad(`Позиция ${i + 1}: укажите наименование`);
    const qty = Number(it.qty), price = Number(it.price);
    if (!Number.isFinite(qty) || qty <= 0) throw bad(`Позиция ${i + 1}: неверное количество`);
    if (!Number.isFinite(price) || price < 0) throw bad(`Позиция ${i + 1}: неверная цена`);
    return { name, unit: String(it.unit || 'шт').trim().slice(0, 20) || 'шт', qty, price, vat_rate: checkVat(it.vat_rate ?? null) };
  });
}
function writeInvoiceItems(id, items, mode) {
  run('DELETE FROM invoice_items WHERE invoice_id = ?', id);
  items.forEach((it, i) => insert('invoice_items', { invoice_id: id, position: i, ...it }));
  const c = calcItems(items, mode);
  update('invoices', id, { net: c.net, vat: c.vat, total: c.total });
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
// Создать счёт (из формы, из сделки или по расписанию)
function createInvoice(src, userId) {
  const date = isDate(src.date) ? src.date : todayMsk();
  const vat_mode = src.vat_mode === 'included' ? 'included' : 'above';
  const items = cleanItems(src.items);
  return tx(() => {
    const number = String(src.number || '').trim().slice(0, 40) || String(nextDocNumber(src.company_id, 'invoice', date));
    const id = insert('invoices', { number, company_id: src.company_id || null, client_id: src.client_id || null, deal_id: src.deal_id || null,
      schedule_id: src.schedule_id || null, date, due_date: isDate(src.due_date) ? src.due_date : src.due_date === null ? null : addDays(date, 5), vat_mode,
      title: src.title || null, notes: src.notes || null, period: src.period || null, created_by: userId });
    writeInvoiceItems(id, items, vat_mode);
    return id;
  });
}
function recalcPaid(id) {
  const sum = get('SELECT COALESCE(SUM(amount),0) s, MAX(date) d FROM invoice_payments WHERE invoice_id = ?', id);
  const inv = get('SELECT total FROM invoices WHERE id = ?', id);
  update('invoices', id, { paid: Math.round(sum.s * 100) / 100, paid_at: sum.s >= inv.total - 0.005 && sum.s > 0 ? sum.d : null });
}

api.get('/invoices', wrap((req) => {
  const where = []; const params = [];
  if (req.query.client_id) { where.push('i.client_id = ?'); params.push(Number(req.query.client_id)); }
  if (req.query.deal_id) { where.push('i.deal_id = ?'); params.push(Number(req.query.deal_id)); }
  const today = todayMsk();
  return all(`${INVOICE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.date DESC, i.id DESC`, ...params).map((i) => shapeInvoice(i, today));
}));
api.get('/invoices/:id', wrap((req) => getInvoice(idParam(req)) || (() => { throw notFound(); })()));
api.post('/invoices', requireRole('admin', 'manager'), wrap((req) => {
  const b = req.body || {};
  let src = { ...b };
  if (b.deal_id && !Array.isArray(b.items)) { // из сделки — берём её позиции
    const d = getDeal(Number(b.deal_id));
    if (!d) throw notFound();
    if (!d.items.length) throw bad('В сделке нет позиций — добавьте товары или услуги');
    src = { company_id: d.company_id, client_id: d.client_id, vat_mode: d.vat_mode, items: d.items, title: d.title, ...b };
  }
  const id = createInvoice(src, req.user.id);
  const inv = getInvoice(id);
  logActivity(req.user.id, 'invoice', id, 'create', `выставил счёт № ${inv.number}${inv.client_name ? ` для ${inv.client_name}` : ''} на ${Math.round(inv.total).toLocaleString('ru-RU')} ₽`);
  return inv;
}));
api.put('/invoices/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const before = get('SELECT * FROM invoices WHERE id = ?', id);
  if (!before) throw notFound();
  const b = req.body || {};
  const data = pick(b, ['number', 'company_id', 'client_id', 'deal_id', 'date', 'due_date', 'vat_mode', 'title', 'notes', 'cancelled', 'period']);
  if (data.vat_mode && !['above', 'included'].includes(data.vat_mode)) throw bad('Неверный режим НДС');
  if ('number' in data && !String(data.number || '').trim()) throw bad('Укажите номер счёта');
  tx(() => {
    update('invoices', id, data);
    if (Array.isArray(b.items)) writeInvoiceItems(id, cleanItems(b.items), data.vat_mode || before.vat_mode);
    else if (data.vat_mode && data.vat_mode !== before.vat_mode) writeInvoiceItems(id, all('SELECT name, unit, qty, price, vat_rate FROM invoice_items WHERE invoice_id = ? ORDER BY position', id), data.vat_mode);
    recalcPaid(id);
  });
  return getInvoice(id);
}));
api.delete('/invoices/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  if (get('SELECT 1 FROM invoice_payments WHERE invoice_id = ? LIMIT 1', id)) throw bad('По счёту есть оплаты — его можно только отменить');
  const inv = get('SELECT number, date FROM invoices WHERE id = ?', id);
  trashDelete('invoice', 'invoices', id, inv && `Счёт № ${inv.number} от ${inv.date.split('-').reverse().join('.')}`);
  return { ok: true };
}));
// Оплата: записывается в счёт и как доход в «Финансы»
api.post('/invoices/:id/payments', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const inv = getInvoice(id);
  if (!inv) throw notFound();
  if (inv.cancelled) throw bad('Счёт отменён');
  const amount = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!(amount > 0)) throw bad('Укажите сумму оплаты');
  const date = isDate(req.body?.date) ? req.body.date : todayMsk();
  tx(() => {
    let txId = null;
    if (req.body?.to_finance !== false) {
      txId = insert('transactions', { type: 'income', amount, category: 'Оплата по счёту', date, client_id: inv.client_id,
        description: `Оплата по счёту № ${inv.number} от ${inv.date.split('-').reverse().join('.')}`, created_by: req.user.id });
    }
    insert('invoice_payments', { invoice_id: id, date, amount, note: String(req.body?.note || '').slice(0, 500) || null, transaction_id: txId, created_by: req.user.id });
    recalcPaid(id);
  });
  logActivity(req.user.id, 'invoice', id, 'payment', `отметил оплату ${amount.toLocaleString('ru-RU')} ₽ по счёту № ${inv.number}`);
  return getInvoice(id);
}));
api.delete('/invoice-payments/:id', requireRole('admin', 'manager'), wrap((req) => {
  const p = get('SELECT * FROM invoice_payments WHERE id = ?', idParam(req));
  if (!p) throw notFound();
  tx(() => {
    run('DELETE FROM invoice_payments WHERE id = ?', p.id);
    if (p.transaction_id) run('DELETE FROM transactions WHERE id = ?', p.transaction_id);
    recalcPaid(p.invoice_id);
  });
  return getInvoice(p.invoice_id);
}));

// Дебиторка: сколько должны клиенты
api.get('/receivables', wrap(() => {
  const today = todayMsk();
  const list = all(`${INVOICE_SELECT} WHERE i.cancelled = 0 AND i.paid < i.total - 0.005`).map((i) => shapeInvoice(i, today));
  const by = {};
  for (const i of list) {
    const k = i.client_id || 0;
    const r = (by[k] ??= { client_id: i.client_id, client_name: i.client_name || 'Без клиента', debt: 0, overdue: 0, count: 0, oldest_due: null });
    r.debt += i.debt; r.count++;
    if (i.status === 'overdue') { r.overdue += i.debt; if (!r.oldest_due || i.due_date < r.oldest_due) r.oldest_due = i.due_date; }
  }
  return Object.values(by).sort((a, b) => b.overdue - a.overdue || b.debt - a.debt);
}));

/* ---------- повторяющиеся счета (абонентка) ---------- */
const SCHED_SELECT = `SELECT s.*, c.name client_name, co.name company_name,
    (SELECT COUNT(*) FROM invoices i WHERE i.schedule_id = s.id) invoices_count
  FROM invoice_schedules s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN companies co ON co.id = s.company_id`;
const shapeSched = (x) => x && ({ ...x, items: JSON.parse(x.items || '[]'), total: calcItems(JSON.parse(x.items || '[]'), x.vat_mode).total });
function schedData(b) {
  const data = pick(b, ['company_id', 'client_id', 'deal_id', 'title', 'vat_mode', 'every', 'monthday', 'due_days', 'next_date', 'end_date', 'active']);
  if (Array.isArray(b.items)) data.items = JSON.stringify(cleanItems(b.items));
  if (data.every != null) data.every = Math.min(12, Math.max(1, Math.round(Number(data.every)) || 1));
  if (data.monthday != null) data.monthday = Math.min(31, Math.max(1, Math.round(Number(data.monthday)) || 1));
  if (data.due_days != null) data.due_days = Math.min(90, Math.max(0, Math.round(Number(data.due_days)) || 0));
  if (data.vat_mode && !['above', 'included'].includes(data.vat_mode)) throw bad('Неверный режим НДС');
  for (const k of ['next_date', 'end_date']) if (data[k] && !isDate(data[k])) throw bad('Неверная дата');
  return data;
}
export function runInvoiceSchedules() {
  const today = todayMsk();
  for (const s of all('SELECT * FROM invoice_schedules WHERE active = 1 AND next_date <= ?', today)) {
    try {
      tx(() => {
        const rule = { freq: 'monthly', every: s.every, monthday: s.monthday };
        const id = createInvoice({ company_id: s.company_id, client_id: s.client_id, deal_id: s.deal_id, schedule_id: s.id, date: s.next_date,
          due_date: addDays(s.next_date, s.due_days || 0), vat_mode: s.vat_mode, items: JSON.parse(s.items), title: s.title }, s.created_by);
        logActivity(s.created_by, 'invoice', id, 'create', `автоматически выставлен счёт «${s.title || 'по расписанию'}»`);
        let next = nextDate(rule, s.next_date, false, s.created_at.slice(0, 10));
        while (next <= today) next = nextDate(rule, next, false, s.created_at.slice(0, 10)); // не «догоняем» пропущенные месяцы
        run('UPDATE invoice_schedules SET next_date = ?, active = ? WHERE id = ?', next, s.end_date && next > s.end_date ? 0 : 1, s.id);
      });
    } catch (e) { console.error('Повторяющийся счёт', s.id, e.message); }
  }
}
api.get('/invoice-schedules', wrap(() => all(`${SCHED_SELECT} ORDER BY s.active DESC, s.next_date`).map(shapeSched)));
api.post('/invoice-schedules', requireRole('admin', 'manager'), wrap((req) => {
  const data = schedData(req.body || {});
  if (!data.items) throw bad('Добавьте позиции');
  data.next_date = nextDate({ freq: 'monthly', every: 1, monthday: data.monthday || 1 }, data.next_date || todayMsk(), true, todayMsk());
  data.created_by = req.user.id;
  const id = insert('invoice_schedules', data);
  runInvoiceSchedules();
  return shapeSched(get(`${SCHED_SELECT} WHERE s.id = ?`, id));
}));
api.put('/invoice-schedules/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const before = get('SELECT * FROM invoice_schedules WHERE id = ?', id);
  if (!before) throw notFound();
  const data = schedData(req.body || {});
  if (data.next_date || data.monthday) data.next_date = nextDate({ freq: 'monthly', every: 1, monthday: data.monthday || before.monthday }, data.next_date || before.next_date, true, before.created_at.slice(0, 10));
  update('invoice_schedules', id, data);
  runInvoiceSchedules();
  return shapeSched(get(`${SCHED_SELECT} WHERE s.id = ?`, id));
}));
api.delete('/invoice-schedules/:id', requireRole('admin', 'manager'), wrap((req) => { run('DELETE FROM invoice_schedules WHERE id = ?', idParam(req)); return { ok: true }; }));

/* ---------- абонентское обслуживание ---------- */
const CONTRACT_FIELDS = ['client_id', 'project_id', 'title', 'hours_limit', 'monthly_fee', 'overage_rate', 'start_date', 'end_date', 'active', 'notes'];
const CONTRACT_SELECT = `SELECT k.*, c.name client_name, p.name project_name FROM support_contracts k
  LEFT JOIN clients c ON c.id = k.client_id LEFT JOIN projects p ON p.id = k.project_id`;
// Время по договору за месяц (YYYY-MM, по МСК): проекты клиента/договора + заявки клиента
const CONTRACT_ENTRIES = `FROM time_entries e
  LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN tickets t ON t.id = e.ticket_id
  WHERE e.ended_at IS NOT NULL AND strftime('%Y-%m', datetime(e.started_at, '+3 hours')) = ?
    AND ((? IS NOT NULL AND (e.project_id = ? OR t.project_id = ?)) OR (? IS NOT NULL AND (p.client_id = ? OR t.client_id = ?)))`;
const contractArgs = (k, month) => [month, k.project_id, k.project_id, k.project_id, k.client_id, k.client_id, k.client_id];
function contractUsage(k, month) {
  const used = get(`SELECT COALESCE(SUM(e.duration_sec),0) s ${CONTRACT_ENTRIES}`, ...contractArgs(k, month)).s;
  const usedH = used / 3600;
  const over = Math.max(0, usedH - k.hours_limit);
  return { month, used_sec: used, used_hours: Math.round(usedH * 100) / 100, over_hours: Math.round(over * 100) / 100,
    over_amount: Math.round(over * k.overage_rate * 100) / 100, pct: k.hours_limit ? Math.round((usedH / k.hours_limit) * 100) : null };
}
const monthOf = (q) => (/^\d{4}-\d{2}$/.test(String(q || '')) ? q : todayMsk().slice(0, 7));
api.get('/contracts', wrap((req) => {
  const month = monthOf(req.query.month);
  return all(`${CONTRACT_SELECT} ORDER BY k.active DESC, c.name`).map((k) => ({ ...k, usage: contractUsage(k, month) }));
}));
api.get('/contracts/:id', wrap((req) => {
  const k = get(`${CONTRACT_SELECT} WHERE k.id = ?`, idParam(req));
  if (!k) throw notFound();
  const month = monthOf(req.query.month);
  const history = [];
  const [y, m] = month.split('-').map(Number);
  for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); history.push(contractUsage(k, d.toISOString().slice(0, 7))); }
  // Детализация за месяц: на что ушло время
  const entries = all(`SELECT e.id, e.started_at, e.duration_sec, e.description, u.name user_name, tk.title task_title, t.title ticket_title, t.id ticket_id, p.name project_name
    ${CONTRACT_ENTRIES.replace('LEFT JOIN tickets t', 'LEFT JOIN users u ON u.id = e.user_id LEFT JOIN tasks tk ON tk.id = e.task_id LEFT JOIN tickets t')} ORDER BY e.started_at DESC`, ...contractArgs(k, month));
  return { ...k, usage: contractUsage(k, month), history, entries };
}));
api.post('/contracts', requireRole('admin', 'manager'), wrap((req) => {
  const data = pick(req.body, CONTRACT_FIELDS);
  if (!data.client_id && !data.project_id) throw bad('Выберите клиента или проект');
  return get(`${CONTRACT_SELECT} WHERE k.id = ?`, insert('support_contracts', data));
}));
api.put('/contracts/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  update('support_contracts', id, pick(req.body, CONTRACT_FIELDS));
  return get(`${CONTRACT_SELECT} WHERE k.id = ?`, id);
}));
api.delete('/contracts/:id', requireRole('admin', 'manager'), wrap((req) => { const id = idParam(req); const k = get(`${CONTRACT_SELECT} WHERE k.id = ?`, id); trashDelete('contract', 'support_contracts', id, k && `Абонентка: ${k.client_name || k.project_name}`); return { ok: true }; }));

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

/* ---------- шаблоны документов и формирование документов ---------- */
const DOC_KINDS = { offer: 'Коммерческое предложение', invoice: 'Счёт', act: 'Акт', upd: 'УПД' };
const storeFile = (buf, name, mime, userId) => {
  const stored = `${crypto.randomUUID()}${path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
  return insert('files', { user_id: userId, name: name.slice(0, 200), size: buf.length, mime, stored });
};
const readFileRow = (id) => { const f = id && get('SELECT * FROM files WHERE id = ?', id); return f ? fs.readFileSync(path.join(UPLOAD_DIR, path.basename(f.stored))) : null; };
const TPL_SELECT = `SELECT t.*, c.name company_name, f.name file_name, f.size file_size FROM doc_templates t
  LEFT JOIN companies c ON c.id = t.company_id LEFT JOIN files f ON f.id = t.file_id`;
const shapeTpl = (t) => t && ({ ...t, tags: t.tags ? JSON.parse(t.tags) : null });
api.get('/doc-templates', wrap(() => all(`${TPL_SELECT} ORDER BY t.kind, t.is_default DESC, t.name`).map(shapeTpl)));
api.post('/doc-templates', requireRole('admin', 'manager'), express.raw({ type: 'application/octet-stream', limit: 10 * 1024 * 1024 }), wrapAsync(async (req) => {
  const kind = String(req.get('X-Kind') || '');
  if (!['offer', 'invoice', 'act'].includes(kind)) throw bad('Выберите вид документа');
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw bad('Пустой файл');
  let name = 'шаблон.docx';
  try { name = decodeURIComponent(String(req.get('X-File-Name') || name)); } catch { /* имя по умолчанию */ }
  if (!/\.docx$/i.test(name)) throw bad('Нужен файл Word в формате .docx');
  let tags;
  try { tags = await templateTags(req.body); } catch { throw bad('Не удалось прочитать файл — это точно .docx?'); }
  const title = (() => { try { return decodeURIComponent(String(req.get('X-Name') || '')); } catch { return ''; } })().trim() || name.replace(/\.docx$/i, '');
  const companyId = Number(req.get('X-Company')) || null;
  const id = tx(() => {
    const fid = storeFile(req.body, name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', req.user.id);
    const first = !get('SELECT 1 FROM doc_templates WHERE kind = ?', kind);
    return insert('doc_templates', { kind, name: title.slice(0, 120), company_id: companyId, file_id: fid, is_default: first ? 1 : 0, tags: JSON.stringify(tags), created_by: req.user.id });
  });
  return shapeTpl(get(`${TPL_SELECT} WHERE t.id = ?`, id));
}));
api.put('/doc-templates/:id', requireRole('admin', 'manager'), wrap((req) => {
  const id = idParam(req);
  const t = get('SELECT * FROM doc_templates WHERE id = ?', id);
  if (!t) throw notFound();
  const data = pick(req.body, ['name', 'company_id', 'is_default']);
  tx(() => {
    if (data.is_default) run('UPDATE doc_templates SET is_default = 0 WHERE kind = ?', t.kind);
    update('doc_templates', id, data);
  });
  return shapeTpl(get(`${TPL_SELECT} WHERE t.id = ?`, id));
}));
api.delete('/doc-templates/:id', requireRole('admin', 'manager'), wrap((req) => { run('DELETE FROM doc_templates WHERE id = ?', idParam(req)); return { ok: true }; }));

// Данные для документа: из счёта (счёт, акт, УПД) или из сделки (КП)
function docContext(kind, b, user) {
  let src, items, vatMode, companyId, clientId, deal = null, number, date;
  if (b.invoice_id) {
    src = get('SELECT * FROM invoices WHERE id = ?', Number(b.invoice_id));
    if (!src) throw notFound();
    items = all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id', src.id);
    vatMode = src.vat_mode; companyId = src.company_id; clientId = src.client_id;
    deal = src.deal_id ? get('SELECT * FROM deals WHERE id = ?', src.deal_id) : null;
  } else if (b.deal_id) {
    deal = get('SELECT * FROM deals WHERE id = ?', Number(b.deal_id));
    if (!deal) throw notFound();
    src = deal;
    items = all('SELECT * FROM deal_items WHERE deal_id = ? ORDER BY position, id', deal.id);
    vatMode = deal.vat_mode; companyId = deal.company_id; clientId = deal.client_id;
  } else throw bad('Не указан счёт или сделка');
  if (!items.length) throw bad('Нет позиций — добавьте товары или услуги');
  const company = (companyId && get('SELECT * FROM companies WHERE id = ?', companyId)) || get('SELECT * FROM companies ORDER BY is_default DESC, id LIMIT 1');
  if (!company) throw bad('Добавьте свою компанию с реквизитами: Настройки → Мои компании');
  const client = clientId ? get('SELECT * FROM clients WHERE id = ?', clientId) : null;
  if (!client) throw bad('Укажите клиента');
  const calc = calcItems(items, vatMode);
  const owner = get('SELECT name, position, phone, email FROM users WHERE id = ?', deal?.owner_id || user.id) || {};
  // Номер: счёт — номер счёта; акт/УПД — следующий по своему счётчику, при повторном формировании тот же
  date = isDate(b.date) ? b.date : kind === 'invoice' ? src.date : todayMsk();
  const prev = get(`SELECT number, date FROM documents WHERE kind = ? AND ${b.invoice_id ? 'invoice_id' : 'deal_id'} = ? ORDER BY id DESC LIMIT 1`, kind, src.id);
  if (kind === 'invoice' || kind === 'upd') number = src.number ?? prev?.number;
  let fresh = false;
  if (!number) { number = String(b.number || '').trim() || prev?.number; if (!number) { number = String(peekDocNumber(company.id, kind, date)); fresh = true; } }
  return {
    company, client, owner, items: calc.rows, vatMode, totals: { net: calc.net, vat: calc.vat, total: calc.total },
    doc: { number, date, period: b.period ?? src.period ?? null, contract_no: deal?.contract_no, contract_date: deal?.contract_date, title: src.title },
    refs: { invoice_id: b.invoice_id ? src.id : null, deal_id: deal?.id ?? null, client_id: client.id, company_id: company.id }, fresh,
  };
}
const DOC_SELECT = `SELECT d.*, u.name created_by_name, t.name template_name, c.name client_name FROM documents d
  LEFT JOIN users u ON u.id = d.created_by LEFT JOIN doc_templates t ON t.id = d.template_id LEFT JOIN clients c ON c.id = d.client_id`;
api.get('/documents', requireRole('admin', 'manager'), wrap((req) => {
  const where = []; const args = [];
  for (const k of ['invoice_id', 'deal_id', 'client_id']) if (req.query[k]) { where.push(`d.${k} = ?`); args.push(Number(req.query[k])); }
  return all(`${DOC_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.id DESC LIMIT 100`, ...args);
}));
api.post('/documents', requireRole('admin', 'manager'), wrapAsync(async (req) => {
  const b = req.body || {};
  const kind = String(b.kind || '');
  if (!DOC_KINDS[kind]) throw bad('Неизвестный вид документа');
  const ctx = docContext(kind, b, req.user);
  const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_');
  const base = `${DOC_KINDS[kind]} № ${safe(ctx.doc.number)} от ${ctx.doc.date.split('-').reverse().join('.')}${ctx.client ? ` — ${safe(ctx.client.name)}` : ''}`;
  let docxId = null, pdfId = null, xmlId = null, tplId = null;
  if (kind === 'upd') {
    if (!/^\d{10}(\d{2})?$/.test(String(ctx.company.inn || ''))) throw bad('Для УПД заполните ИНН своей компании');
    if (!/^\d{10}(\d{2})?$/.test(String(ctx.client.inn || ''))) throw bad('Для УПД заполните ИНН клиента (карточка клиента → реквизиты)');
    const u = buildUpd({ ...ctx, doc: { ...ctx.doc, content: b.content } });
    xmlId = storeFile(u.buffer, u.name, 'application/xml', req.user.id);
  } else {
    const tpl = (b.template_id && get('SELECT * FROM doc_templates WHERE id = ? AND kind = ?', Number(b.template_id), kind))
      || get('SELECT * FROM doc_templates WHERE kind = ? AND (company_id = ? OR company_id IS NULL) ORDER BY company_id IS NULL, is_default DESC, id LIMIT 1', kind, ctx.company.id);
    if (!tpl) throw bad(`Нет шаблона «${DOC_KINDS[kind]}» — загрузите его: Настройки → Шаблоны документов`);
    tplId = tpl.id;
    const images = {};
    if (b.with_stamp) {
      const sign = readFileRow(ctx.company.sign_file_id); const stamp = readFileRow(ctx.company.stamp_file_id);
      if (sign) images.MyCompanyUfDirectorSign = sign;
      if (stamp) images.MyCompanyUfStamp = stamp;
    }
    if (kind === 'invoice') {
      const qr = await paymentQr(ctx.company, ctx.totals.total, `Оплата по счёту № ${ctx.doc.number} от ${ctx.doc.date.split('-').reverse().join('.')}${ctx.totals.vat > 0 ? `, в т.ч. НДС ${ctx.totals.vat.toFixed(2)}` : ', без НДС'}`);
      if (qr) images.PaymentQrCode = qr;
    }
    const docx = await renderDocx(readFileRow(tpl.file_id), ctx, images);
    docxId = storeFile(docx, `${base}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', req.user.id);
    if (b.pdf !== false) {
      try { pdfId = storeFile(await docxToPdf(docx), `${base}.pdf`, 'application/pdf', req.user.id); }
      catch (e) { if (b.format === 'pdf') throw bad(e.message); }
    }
  }
  if (ctx.fresh) commitDocNumber(ctx.company.id, kind, ctx.doc.date, ctx.doc.number);
  const id = insert('documents', { kind, number: String(ctx.doc.number), date: ctx.doc.date, ...ctx.refs, template_id: tplId, docx_file_id: docxId, pdf_file_id: pdfId,
    xml_file_id: xmlId, with_stamp: b.with_stamp ? 1 : 0, total: ctx.totals.total, created_by: req.user.id });
  if (b.period !== undefined && ctx.refs.invoice_id) run('UPDATE invoices SET period = ? WHERE id = ?', b.period || null, ctx.refs.invoice_id);
  logActivity(req.user.id, 'document', id, 'create', `сформировал документ: ${base}`);
  return get(`${DOC_SELECT} WHERE d.id = ?`, id);
}));

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
const portal = Router();
api.use('/portal', portal);
portal.use((req, res, next) => (req.portal ? next() : res.status(403).json({ error: 'Только для клиентов' })));
const cid = (req) => req.portal.client_id;
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

/* ---------- импорт из Excel / CSV ---------- */
// rows — уже сопоставленные с полями объекты; дубликаты пропускаем
const str = (v, n = 500) => (v == null ? null : String(v).trim().slice(0, n) || null);
const num = (v) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : null; };
function parseDay(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const vatFrom = (v) => { const s = String(v ?? '').toLowerCase().replace('%', '').trim(); if (!s) return null; if (/без|нет|none/.test(s)) return 'none'; return VAT_RATES.includes(s) ? s : null; };
api.post('/import/:kind', requireRole('admin', 'manager'), wrap((req) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
  if (!rows.length) throw bad('Нет строк для импорта');
  const res = { created: 0, updated: 0, skipped: 0, errors: [] };
  const kind = req.params.kind;
  tx(() => rows.forEach((r, i) => {
    const line = i + 2; // +1 заголовок, +1 нумерация с единицы
    try {
      if (kind === 'clients') {
        const name = str(r.name, 200); if (!name) throw new Error('нет названия');
        const inn = str(r.inn, 12)?.replace(/\D/g, '') || null;
        const exists = (inn && get('SELECT id FROM clients WHERE inn = ?', inn)) || get('SELECT id FROM clients WHERE ulower(name) = ulower(?)', name);
        const data = Object.fromEntries(Object.entries({ name, inn, type: /частн|физ/i.test(r.type || '') ? 'person' : 'company', kpp: str(r.kpp, 9), ogrn: str(r.ogrn, 15),
          contact_name: str(r.contact_name), phone: str(r.phone, 60), email: str(r.email, 120), address: str(r.address), full_name: str(r.full_name),
          bank_name: str(r.bank_name), bik: str(r.bik, 9), account: str(r.account, 20), corr_account: str(r.corr_account, 20), director_name: str(r.director_name), notes: str(r.notes, 2000) }).filter(([, v]) => v != null));
        if (exists) { if (req.body.update) { delete data.name; update('clients', exists.id, data); res.updated++; } else res.skipped++; return; }
        insert('clients', data); res.created++;
      } else if (kind === 'catalog') {
        const name = str(r.name); if (!name) throw new Error('нет наименования');
        const sku = str(r.sku, 60);
        const exists = (sku && get('SELECT id FROM catalog_items WHERE sku = ?', sku)) || get('SELECT id FROM catalog_items WHERE ulower(name) = ulower(?)', name);
        const data = Object.fromEntries(Object.entries({ name, sku, kind: /товар|goods/i.test(r.kind || '') ? 'goods' : r.kind ? 'service' : null, unit: str(r.unit, 20),
          price: num(r.price), vat_rate: vatFrom(r.vat_rate), description: str(r.description, 2000) }).filter(([, v]) => v != null));
        if (exists) { if (req.body.update) { update('catalog_items', exists.id, data); res.updated++; } else res.skipped++; return; }
        insert('catalog_items', { kind: 'service', unit: 'шт', price: 0, vat_rate: '22', ...data }); res.created++;
      } else if (kind === 'tasks') {
        const projectId = Number(req.body.project_id);
        if (!projectId || !get('SELECT 1 FROM projects WHERE id = ?', projectId)) throw new Error('не выбран проект');
        const title = str(r.title, 300); if (!title) throw new Error('нет названия');
        let assignee = null;
        if (r.assignee) {
          const a = String(r.assignee).trim();
          assignee = get('SELECT id FROM users WHERE ulower(email) = ulower(?) OR ulower(name) = ulower(?) OR ulower(name) LIKE ulower(?)', a, a, `${a}%`)?.id ?? null;
        }
        const status = /закр|done|готов|выполн/i.test(r.status || '') ? 'done' : /работ|progress/i.test(r.status || '') ? 'in_progress' : 'todo';
        const id = insert('tasks', { project_id: projectId, title, description: str(r.description, 5000), assignee_id: assignee, due_date: parseDay(r.due_date),
          status, created_by: req.user.id, completed_at: status === 'done' ? nowIso() : null });
        run("INSERT INTO task_comments (task_id, user_id, kind, body) VALUES (?, ?, 'system', 'создал задачу (импорт из файла)')", id, req.user.id);
        res.created++;
      } else throw bad('Неизвестный тип импорта');
    } catch (e) {
      if (e instanceof HttpError) throw e;
      res.skipped++; if (res.errors.length < 50) res.errors.push(`Строка ${line}: ${e.message}`);
    }
  }));
  logActivity(req.user.id, kind, null, 'import', `импортировал из файла: ${res.created} новых записей (${kind === 'clients' ? 'клиенты' : kind === 'catalog' ? 'каталог' : 'задачи'})`);
  return res;
}));

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

/* ---------- отчёты ---------- */
// Период по МСК: from/to — YYYY-MM-DD включительно (по умолчанию текущий месяц)
function period(q) {
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
function buildClientReport(query, forPortal = false) {
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

/* ---------- time tracking ---------- */
const TIME_SELECT = `SELECT e.*, u.name user_name, u.color user_color, p.name project_name, t.title task_title, k.title ticket_title,
    CASE WHEN e.ended_at IS NULL THEN CAST((julianday('now') - julianday(e.started_at)) * 86400 AS INTEGER) ELSE e.duration_sec END live_sec
  FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN tasks t ON t.id = e.task_id LEFT JOIN tickets k ON k.id = e.ticket_id`;

function stopRunning(userId) {
  const r = get('SELECT * FROM time_entries WHERE user_id = ? AND ended_at IS NULL', userId);
  if (!r) return null;
  const end = new Date();
  const dur = Math.max(0, Math.round((end - new Date(r.started_at)) / 1000));
  run('UPDATE time_entries SET ended_at = ?, duration_sec = ? WHERE id = ?', end.toISOString(), dur, r.id);
  return { id: r.id, dur };
}

// Таймер с паузой. Каждый отрезок между стартом/продолжением и паузой/стопом — отдельная запись в табеле;
// timer_sessions хранит, что именно учитываем, сколько уже накоплено и стоит ли таймер на паузе.
const SESSION_SELECT = `SELECT s.*, p.name project_name, t.title task_title, k.title ticket_title
  FROM timer_sessions s LEFT JOIN projects p ON p.id = s.project_id LEFT JOIN tasks t ON t.id = s.task_id LEFT JOIN tickets k ON k.id = s.ticket_id`;
function timerState(userId) {
  const running = get(`${TIME_SELECT} WHERE e.user_id = ? AND e.ended_at IS NULL`, userId);
  const session = get(`${SESSION_SELECT} WHERE s.user_id = ?`, userId);
  if (running) return { ...running, paused: false, accumulated_sec: session && !session.paused ? session.accumulated_sec : 0 };
  if (session?.paused) return { ...session, id: null, started_at: null, paused: true };
  return null;
}
const sessionParams = (s) => ({ project_id: s.project_id, task_id: s.task_id, ticket_id: s.ticket_id, description: s.description });

api.get('/time', wrap((req) => {
  const where = []; const params = [];
  const from = req.query.from, to = req.query.to;
  if (from) { where.push('e.started_at >= ?'); params.push(from); }
  if (to) { where.push('e.started_at < ?'); params.push(to); }
  if (req.query.user_id) { where.push('e.user_id = ?'); params.push(Number(req.query.user_id)); }
  if (req.query.project_id) { where.push('e.project_id = ?'); params.push(Number(req.query.project_id)); }
  return all(`${TIME_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.started_at DESC LIMIT 1000`, ...params);
}));

api.get('/time/running', wrap((req) => timerState(req.user.id)));

api.post('/time/start', wrap((req) => {
  const data = pick(req.body, ['project_id', 'task_id', 'ticket_id', 'description']);
  if (data.task_id && !data.project_id) data.project_id = get('SELECT project_id FROM tasks WHERE id = ?', data.task_id)?.project_id ?? null;
  if (data.ticket_id && !data.project_id) data.project_id = get('SELECT project_id FROM tickets WHERE id = ?', data.ticket_id)?.project_id ?? null;
  tx(() => {
    stopRunning(req.user.id);
    run('DELETE FROM timer_sessions WHERE user_id = ?', req.user.id);
    insert('time_entries', { ...data, user_id: req.user.id, started_at: nowIso() });
    insert('timer_sessions', { ...data, user_id: req.user.id, accumulated_sec: 0, paused: 0 });
  });
  return timerState(req.user.id);
}));

api.post('/time/pause', wrap((req) => {
  const state = timerState(req.user.id);
  if (!state || state.paused) throw bad('Таймер не запущен');
  tx(() => {
    const stopped = stopRunning(req.user.id);
    const has = get('SELECT user_id FROM timer_sessions WHERE user_id = ?', req.user.id);
    if (has) run("UPDATE timer_sessions SET accumulated_sec = accumulated_sec + ?, paused = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?", stopped?.dur || 0, req.user.id);
    else insert('timer_sessions', { user_id: req.user.id, ...sessionParams(state), accumulated_sec: stopped?.dur || 0, paused: 1 });
  });
  return timerState(req.user.id);
}));

api.post('/time/resume', wrap((req) => {
  const s = get('SELECT * FROM timer_sessions WHERE user_id = ?', req.user.id);
  if (!s?.paused) throw bad('Таймер не на паузе');
  tx(() => {
    insert('time_entries', { ...sessionParams(s), user_id: req.user.id, started_at: nowIso() });
    run("UPDATE timer_sessions SET paused = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?", req.user.id);
  });
  return timerState(req.user.id);
}));

// Стоп: закрываем текущий отрезок и сессию. duration_sec — общее время сессии (с учётом пауз)
api.post('/time/stop', wrap((req) => {
  const res = tx(() => {
    const s = get('SELECT * FROM timer_sessions WHERE user_id = ?', req.user.id);
    const stopped = stopRunning(req.user.id);
    run('DELETE FROM timer_sessions WHERE user_id = ?', req.user.id);
    if (!stopped && !s) return null;
    return { id: stopped?.id ?? null, duration_sec: (s?.accumulated_sec || 0) + (stopped?.dur || 0) };
  });
  return res;
}));

// Ручное добавление записи
api.post('/time', wrap((req) => {
  const data = pick(req.body, ['project_id', 'task_id', 'ticket_id', 'description', 'started_at', 'duration_sec', 'user_id']);
  required(data, 'started_at', 'duration_sec');
  if (data.user_id && data.user_id !== req.user.id && req.user.role === 'member') throw new HttpError(403, 'Нельзя добавлять время за других');
  data.user_id ||= req.user.id;
  data.duration_sec = Math.max(0, Math.round(Number(data.duration_sec)));
  const start = new Date(data.started_at);
  if (isNaN(start)) throw bad('Неверная дата');
  data.started_at = start.toISOString();
  data.ended_at = new Date(start.getTime() + data.duration_sec * 1000).toISOString();
  const id = insert('time_entries', data);
  return get(`${TIME_SELECT} WHERE e.id = ?`, id);
}));

api.put('/time/:id', wrap((req) => {
  const id = idParam(req);
  const e = get('SELECT * FROM time_entries WHERE id = ?', id);
  if (!e) throw notFound();
  if (e.user_id !== req.user.id && req.user.role === 'member') throw new HttpError(403, 'Недостаточно прав');
  const data = pick(req.body, ['project_id', 'task_id', 'ticket_id', 'description', 'duration_sec']);
  if (data.duration_sec != null && e.ended_at) {
    data.duration_sec = Math.max(0, Math.round(Number(data.duration_sec)));
    data.ended_at = new Date(new Date(e.started_at).getTime() + data.duration_sec * 1000).toISOString();
  } else delete data.duration_sec;
  update('time_entries', id, data);
  return get(`${TIME_SELECT} WHERE e.id = ?`, id);
}));

api.delete('/time/:id', wrap((req) => {
  const id = idParam(req);
  const e = get('SELECT * FROM time_entries WHERE id = ?', id);
  if (e && e.user_id !== req.user.id && req.user.role === 'member') throw new HttpError(403, 'Недостаточно прав');
  run('DELETE FROM time_entries WHERE id = ?', id);
  return { ok: true };
}));

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
  const monthStart = new Date(); monthStart.setDate(1);
  return {
    projects: get(`SELECT COUNT(*) total,
        SUM(status IN ('planned','in_progress','in_review')) active,
        SUM(status = 'stuck') stuck,
        SUM(status != 'done' AND due_date < date('now')) overdue FROM projects`),
    tickets: get(`SELECT SUM(status IN ('new','in_progress','waiting')) open,
        SUM(status = 'new') new,
        SUM(status IN ('new','in_progress','waiting') AND due_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')) overdue,
        SUM(resolved_at >= date('now','-6 days')) resolved_week FROM tickets`),
    tasks: get(`SELECT
        SUM(status != 'done') open,
        SUM(status = 'in_progress') in_progress,
        SUM(status != 'done' AND due_date < date('now')) overdue,
        SUM(status != 'done' AND due_date BETWEEN date('now') AND date('now','+3 days')) due_soon,
        SUM(status != 'done' AND assignee_id IS NULL) unassigned,
        SUM(created_at >= date('now','-6 days')) created_week,
        SUM(status = 'done' AND completed_at >= date('now','-6 days')) done_week
      FROM tasks`),
    tasks_done_by_day: all(`SELECT date(completed_at) day, COUNT(*) n FROM tasks
        WHERE status = 'done' AND completed_at >= date('now','-13 days') GROUP BY day`),
    tasks_created_by_day: all(`SELECT date(created_at) day, COUNT(*) n FROM tasks
        WHERE created_at >= date('now','-13 days') GROUP BY day`),
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
    tickets_by_category: all(`SELECT category, COUNT(*) n FROM tickets WHERE created_at >= date('now','-29 days') GROUP BY category ORDER BY n DESC`),
    hours_week: all(`SELECT u.id, u.name, u.color, COALESCE(SUM(e.duration_sec),0) sec FROM users u
        LEFT JOIN time_entries e ON e.user_id = u.id AND e.started_at >= date('now','-6 days')
        WHERE u.active = 1 GROUP BY u.id ORDER BY sec DESC`),
    hours_by_day: all(`SELECT date(started_at) day, SUM(duration_sec) sec FROM time_entries
        WHERE started_at >= date('now','-13 days') GROUP BY day ORDER BY day`),
    pipeline: all(`SELECT stage, COUNT(*) n, COALESCE(SUM(amount),0) amount FROM deals GROUP BY stage`),
    invoices: canFinance ? get(`SELECT COUNT(*) overdue, COALESCE(SUM(total - paid),0) overdue_sum FROM invoices
      WHERE cancelled = 0 AND paid < total - 0.005 AND due_date IS NOT NULL AND due_date < ?`, todayMsk()) : null,
    finance: canFinance ? {
      month: get(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
                         COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense
                  FROM transactions WHERE date >= date('now','start of month')`),
      prev: get(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) income,
                        COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) expense
                 FROM transactions WHERE date >= date('now','start of month','-1 month') AND date < date('now','start of month')`),
      months: all(`SELECT strftime('%Y-%m', date) month,
          SUM(CASE WHEN type='income' THEN amount ELSE 0 END) income,
          SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) expense
        FROM transactions WHERE date >= date('now','start of month','-5 months') GROUP BY month ORDER BY month`),
    } : null,
    my_tasks: all(`${TASK_SELECT} WHERE t.status != 'done' AND (t.assignee_id = ? OR EXISTS (SELECT 1 FROM task_members m WHERE m.task_id = t.id AND m.user_id = ? AND m.role = 'coassignee'))
      ORDER BY t.due_date IS NULL, t.due_date LIMIT 8`, req.user.id, req.user.id),
    urgent_tickets: all(`${TICKET_SELECT} WHERE k.status IN ('new','in_progress','waiting')
        ORDER BY CASE k.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, k.due_at LIMIT 6`),
    activity: all(`SELECT a.*, u.name user_name, u.color user_color FROM activity a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC, a.id DESC LIMIT 12`),
  };
}));

api.get('/activity', wrap(() => all(`SELECT a.*, u.name user_name, u.color user_color FROM activity a LEFT JOIN users u ON u.id = a.user_id
  ORDER BY a.created_at DESC, a.id DESC LIMIT 100`)));

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

/* ---------- errors ---------- */
api.use((req, res) => res.status(404).json({ error: 'Маршрут не найден' }));
api.use((err, req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Файл слишком большой (максимум 25 МБ)' });
  const msg = String(err?.message || err);
  if (msg.includes('CHECK constraint')) return res.status(400).json({ error: 'Недопустимое значение поля' });
  if (msg.includes('FOREIGN KEY')) return res.status(400).json({ error: 'Связанная запись не найдена' });
  if (msg.includes('UNIQUE')) return res.status(400).json({ error: 'Такая запись уже существует' });
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});
