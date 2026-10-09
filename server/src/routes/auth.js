import { all, get, run, logActivity } from '../db.js';
import { requestUser } from '../audit.js';
import { requireAuth, requireRole, issueToken, clearToken, hashPassword, checkPassword, publicUser, loginRateLimit } from '../auth.js';
import { api, HttpError, bad, wrap, pick, insert, update, idParam, required } from './shared.js';

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
