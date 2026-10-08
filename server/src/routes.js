import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, tx, logActivity, UPLOAD_DIR } from './db.js';
import {
  requireAuth, requireRole, issueToken, clearToken, hashPassword, checkPassword,
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
  if (!user || !checkPassword(String(password || ''), user.password_hash)) throw new HttpError(401, 'Неверный email или пароль');
  issueToken(res, user);
  return publicUser(user);
}));

api.post('/auth/logout', wrap((req, res) => { clearToken(res); return { ok: true }; }));

api.use(requireAuth);

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
  'full_name', 'kpp', 'ogrn', 'bank_name', 'bik', 'account', 'corr_account', 'director_name', 'director_title'];

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
api.delete('/clients/:id', requireRole('admin', 'manager'), wrap((req) => { run('DELETE FROM clients WHERE id = ?', idParam(req)); return { ok: true }; }));

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
  run('DELETE FROM projects WHERE id = ?', id);
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
  const files = all('SELECT stored FROM files WHERE task_id = ?', id);
  run('DELETE FROM tasks WHERE id = ?', id);
  files.forEach((f) => removeStored(f.stored));
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
  'client_id', 'project_id', 'assignee_id', 'due_at', 'resolution'];
const TICKET_SELECT = `SELECT k.*, u.name assignee_name, u.color assignee_color, c.name client_name, p.name project_name,
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
  t.comments = all(`SELECT m.*, u.name user_name, u.color user_color FROM ticket_comments m LEFT JOIN users u ON u.id = m.user_id
                    WHERE m.ticket_id = ? ORDER BY m.created_at`, id);
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

api.post('/tickets/:id/comments', wrap((req) => {
  const id = idParam(req);
  const body = String(req.body?.body || '').trim();
  if (!body) throw bad('Пустой комментарий');
  insert('ticket_comments', { ticket_id: id, user_id: req.user.id, body });
  return all(`SELECT m.*, u.name user_name, u.color user_color FROM ticket_comments m LEFT JOIN users u ON u.id = m.user_id
              WHERE m.ticket_id = ? ORDER BY m.created_at`, id);
}));
api.delete('/tickets/:id', requireRole('admin', 'manager'), wrap((req) => { run('DELETE FROM tickets WHERE id = ?', idParam(req)); return { ok: true }; }));

/* ---------- мои компании (от чьего имени выставляем документы) ---------- */
const COMPANY_FIELDS = ['name', 'full_name', 'inn', 'kpp', 'ogrn', 'address', 'phone', 'email', 'site', 'bank_name', 'bik', 'account',
  'corr_account', 'director_name', 'director_title', 'accountant_name', 'vat_rate', 'is_default'];
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

/* ---------- deals (воронка) ---------- */
const DEAL_FIELDS = ['title', 'client_id', 'amount', 'stage', 'owner_id', 'expected_close', 'notes', 'position',
  'company_id', 'vat_mode', 'contract_no', 'contract_date'];
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
const checkDeal = (data) => { if (data.vat_mode && !['above', 'included'].includes(data.vat_mode)) throw bad('Неверный режим НДС'); };

api.get('/deals', wrap(() => all(`${DEAL_SELECT} ORDER BY d.position, d.created_at DESC`)));
api.get('/deals/:id', wrap((req) => getDeal(idParam(req)) || (() => { throw notFound(); })()));
api.post('/deals', wrap((req) => {
  const data = pick(req.body, DEAL_FIELDS);
  required(data, 'title');
  checkDeal(data);
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
api.delete('/deals/:id', requireRole('admin', 'manager'), wrap((req) => { run('DELETE FROM deals WHERE id = ?', idParam(req)); return { ok: true }; }));

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
finance.delete('/:id', wrap((req) => { run('DELETE FROM transactions WHERE id = ?', idParam(req)); return { ok: true }; }));
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
