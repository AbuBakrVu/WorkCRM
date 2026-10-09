import { all, get, run, tx } from '../db.js';
import { api, HttpError, bad, notFound, wrap, pick, insert, update, idParam, required, nowIso } from './shared.js';

/* ---------- time tracking ---------- */
const TIME_SELECT = `SELECT e.*, u.name user_name, u.color user_color, p.name project_name, t.title task_title, k.title ticket_title,
    CASE WHEN e.ended_at IS NULL THEN CAST((julianday('now') - julianday(e.started_at)) * 86400 AS INTEGER) ELSE e.duration_sec END live_sec
  FROM time_entries e JOIN users u ON u.id = e.user_id LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN tasks t ON t.id = e.task_id LEFT JOIN tickets k ON k.id = e.ticket_id`;

export function stopRunning(userId) {
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
export function timerState(userId) {
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
