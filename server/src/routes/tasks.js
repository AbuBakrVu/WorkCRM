import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, tx, logActivity, UPLOAD_DIR } from '../db.js';
import { nextDate, addDays, todayMsk } from '../recurrence.js';
import { trashDelete } from '../audit.js';
import { api, HttpError, bad, notFound, wrap, pick, insert, update, idParam, required, nowIso } from './shared.js';
import { stopRunning, timerState } from './time.js';

/* ---------- tasks ---------- */
const TASK_FIELDS = ['project_id', 'title', 'description', 'status', 'assignee_id', 'start_date', 'due_date', 'position', 'parent_id'];
export const TASK_SELECT = `SELECT t.*, u.name assignee_name, u.color assignee_color, p.name project_name, cb.name creator_name, cb.color creator_color,
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

export const ids = (v) => (v ? String(v).split(',').map(Number) : []);
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
    // подзадачи сразу при создании (например, из шаблона)
    if (Array.isArray(req.body.subtasks) && !data.parent_id) req.body.subtasks.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 50).forEach((title) => {
      insert('tasks', { project_id: data.project_id, parent_id: id, title: title.slice(0, 300), assignee_id: data.assignee_id ?? null, created_by: req.user.id });
      systemComment(id, req.user.id, `добавил подзадачу «${title.slice(0, 300)}»`);
    });
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

/* ---------- шаблоны задач ---------- */
const TTPL_FIELDS = ['name', 'title', 'description', 'assignee_id', 'due_days'];
const TTPL_SELECT = 'SELECT t.*, u.name assignee_name FROM task_templates t LEFT JOIN users u ON u.id = t.assignee_id';
const parseList = (v) => { try { return v ? JSON.parse(v) : []; } catch { return []; } };
const shapeTtpl = (t) => t && ({ ...t, coassignee_ids: ids(t.coassignee_ids), observer_ids: ids(t.observer_ids), checklist: parseList(t.checklist), subtasks: parseList(t.subtasks) });
function ttplData(req) {
  const data = pick(req.body, TTPL_FIELDS);
  if (data.due_days != null) data.due_days = Math.min(365, Math.max(0, Math.round(Number(data.due_days)) || 0));
  for (const k of ['coassignee_ids', 'observer_ids']) if (Array.isArray(req.body[k])) data[k] = req.body[k].map(Number).filter(Boolean).join(',') || null;
  for (const k of ['checklist', 'subtasks']) if (Array.isArray(req.body[k])) data[k] = JSON.stringify(req.body[k].map((x) => String(x || '').trim().slice(0, 500)).filter(Boolean).slice(0, 100));
  return data;
}
const ttplPerm = (user, t) => user.role === 'admin' || user.role === 'manager' || t.created_by === user.id;
api.get('/task-templates', wrap(() => all(`${TTPL_SELECT} ORDER BY t.name COLLATE NOCASE`).map(shapeTtpl)));
api.post('/task-templates', wrap((req) => {
  const data = ttplData(req);
  required(data, 'title');
  data.name = String(data.name || data.title).trim().slice(0, 120);
  data.created_by = req.user.id;
  return shapeTtpl(get(`${TTPL_SELECT} WHERE t.id = ?`, insert('task_templates', data)));
}));
api.put('/task-templates/:id', wrap((req) => {
  const id = idParam(req);
  const t = get('SELECT * FROM task_templates WHERE id = ?', id);
  if (!t) throw notFound();
  if (!ttplPerm(req.user, t)) throw new HttpError(403, 'Шаблон меняет его автор, менеджер или администратор');
  const data = ttplData(req);
  if ('title' in data) required(data, 'title');
  if ('name' in data) { data.name = String(data.name || '').trim().slice(0, 120); required(data, 'name'); }
  update('task_templates', id, data);
  return shapeTtpl(get(`${TTPL_SELECT} WHERE t.id = ?`, id));
}));
api.delete('/task-templates/:id', wrap((req) => {
  const id = idParam(req);
  const t = get('SELECT * FROM task_templates WHERE id = ?', id);
  if (!t) throw notFound();
  if (!ttplPerm(req.user, t)) throw new HttpError(403, 'Шаблон удаляет его автор, менеджер или администратор');
  run('DELETE FROM task_templates WHERE id = ?', id);
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

/* ---------- упоминания (@имя) и уведомления ---------- */
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Сотрудники, упомянутые в тексте как «@Имя Фамилия». Длинные имена проверяются первыми,
// чтобы «@Иса Хасанов» не засчитался ещё и как «@Иса»
export function mentionedUsers(text) {
  const users = all('SELECT id, name FROM users WHERE active = 1').sort((a, b) => b.name.length - a.name.length);
  let rest = String(text || ''); const found = [];
  for (const u of users) {
    const re = new RegExp(`@${escRe(u.name)}(?![\\p{L}\\p{N}])`, 'giu');
    if (re.test(rest)) { found.push(u); rest = rest.replace(re, ' '); }
  }
  return found;
}
export function notifyMentions({ text, entity, entityId, authorId }) {
  for (const u of mentionedUsers(text)) {
    if (u.id === authorId) continue;
    insert('notifications', { user_id: u.id, kind: 'mention', entity, entity_id: entityId, from_user_id: authorId, text: String(text).slice(0, 200) });
  }
}

api.get('/notifications', wrap((req) => ({
  unread: get('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).c,
  items: all(`SELECT n.*, u.name from_name, u.color from_color,
      CASE n.entity WHEN 'task' THEN (SELECT title FROM tasks WHERE id = n.entity_id) ELSE (SELECT title FROM tickets WHERE id = n.entity_id) END entity_title,
      CASE n.entity WHEN 'task' THEN (SELECT project_id FROM tasks WHERE id = n.entity_id) END project_id
    FROM notifications n LEFT JOIN users u ON u.id = n.from_user_id WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 30`, req.user.id),
})));
// { ids: [..] } — отметить прочитанными выбранные; без ids — все
api.post('/notifications/read', wrap((req) => {
  const list = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
  if (list) for (const id of list) run("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ? AND read_at IS NULL", id, req.user.id);
  else run("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND read_at IS NULL", req.user.id);
  return { ok: true };
}));
export const purgeNotifications = () => run("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 days')");

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
  notifyMentions({ text: body, entity: 'task', entityId: id, authorId: req.user.id });
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
      notifyMentions({ text: note, entity: 'task', entityId: id, authorId: req.user.id });
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
export function removeStored(stored) {
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
