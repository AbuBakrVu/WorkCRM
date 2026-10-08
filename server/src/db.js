import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'crm.db'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// Регистронезависимый поиск по кириллице (встроенный LIKE понимает только ASCII)
db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','manager','member')),
  position TEXT,
  phone TEXT,
  color TEXT,
  hourly_rate REAL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'company' CHECK (type IN ('company','person','internal')),
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  inn TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','in_review','stuck','done')),
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date TEXT,
  due_date TEXT,
  budget REAL DEFAULT 0,
  manual_progress INTEGER,
  visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date TEXT,
  due_date TEXT,
  position INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','waiting','resolved','closed')),
  location TEXT,
  requester TEXT,
  requester_contact TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_at TEXT,
  resolved_at TEXT,
  resolution TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  amount REAL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','qualified','proposal','negotiation','won','lost')),
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expected_close TEXT,
  notes TEXT,
  position INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  description TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount REAL NOT NULL,
  category TEXT,
  date TEXT NOT NULL,
  description TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_time_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_activity_date ON activity(created_at);
`);

// Миграции схемы. Выполняются и на старых, и на новых базах (CREATE TABLE выше — базовая схема v0,
// её НЕ меняем: все новые колонки/таблицы/индексы — только миграцией).
// Только ДОБАВЛЯЙТЕ элементы в конец массива; существующие не меняйте и не удаляйте.
// Номер миграции = индекс + 1 (хранится в PRAGMA user_version).
const addColumn = (d, table, col, def) => {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
const MIGRATIONS = [
  // 1. Задачи: когда закрыта и кто создал
  (d) => {
    addColumn(d, 'tasks', 'completed_at', 'TEXT');
    addColumn(d, 'tasks', 'created_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
    d.exec("UPDATE tasks SET completed_at = created_at WHERE status = 'done' AND completed_at IS NULL");
    d.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, due_date)');
  },
  // 2. Комментарии к задачам (чат). kind: 'text' — сообщение, 'system' — событие (смена статуса, исполнителя)
  (d) => d.exec(`CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system')),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, id);`),
  // 3. Файлы в задачах (вложения в чате). Сами файлы лежат в DATA_DIR/uploads
  (d) => {
    d.exec(`CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      mime TEXT,
      stored TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_files_task ON files(task_id);`);
    addColumn(d, 'task_comments', 'file_id', 'INTEGER REFERENCES files(id) ON DELETE SET NULL');
  },
  // 4. Участники задачи: соисполнители и наблюдатели
  (d) => d.exec(`CREATE TABLE IF NOT EXISTS task_members (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('coassignee','observer')),
      PRIMARY KEY (task_id, user_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_task_members_user ON task_members(user_id);`),
  // 5. Сессия таймера (для паузы): что учитываем и сколько уже накоплено до паузы
  (d) => d.exec(`CREATE TABLE IF NOT EXISTS timer_sessions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      description TEXT,
      accumulated_sec INTEGER NOT NULL DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );`),
  // 6. Отчёт о работе в чате задачи: report = 'pause' | 'close', report_sec — сколько времени проработано
  (d) => {
    addColumn(d, 'task_comments', 'report', 'TEXT');
    addColumn(d, 'task_comments', 'report_sec', 'INTEGER');
  },
  // 7. Документы по сделкам: мои компании (реквизиты), реквизиты клиента, позиции сделки
  (d) => {
    d.exec(`CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      full_name TEXT,
      inn TEXT, kpp TEXT, ogrn TEXT,
      address TEXT, phone TEXT, email TEXT, site TEXT,
      bank_name TEXT, bik TEXT, account TEXT, corr_account TEXT,
      director_name TEXT, director_title TEXT, accountant_name TEXT,
      vat_rate TEXT,
      logo_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      sign_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      stamp_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт',
      qty REAL NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      vat_rate TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_deal_items_deal ON deal_items(deal_id, position);`);
    for (const c of ['full_name', 'kpp', 'ogrn', 'bank_name', 'bik', 'account', 'corr_account', 'director_name', 'director_title'])
      addColumn(d, 'clients', c, 'TEXT');
    addColumn(d, 'deals', 'company_id', 'INTEGER REFERENCES companies(id) ON DELETE SET NULL');
    addColumn(d, 'deals', 'vat_mode', "TEXT NOT NULL DEFAULT 'above'"); // above — НДС сверху цены, included — в т.ч. НДС
    addColumn(d, 'deals', 'contract_no', 'TEXT');
    addColumn(d, 'deals', 'contract_date', 'TEXT');
  },
  // 8. Задачи: чек-листы, подзадачи, зависимости, повторения
  (d) => {
    d.exec(`CREATE TABLE IF NOT EXISTS task_checklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      done_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_checklist_task ON task_checklist(task_id, position);
    CREATE TABLE IF NOT EXISTS task_deps (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      blocked_by_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, blocked_by_id)
    );
    CREATE INDEX IF NOT EXISTS idx_deps_blocker ON task_deps(blocked_by_id);
    CREATE TABLE IF NOT EXISTS task_recurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      coassignee_ids TEXT,
      observer_ids TEXT,
      checklist TEXT,
      freq TEXT NOT NULL CHECK (freq IN ('daily','weekly','monthly','yearly')),
      every INTEGER NOT NULL DEFAULT 1,
      weekdays TEXT,
      monthday INTEGER,
      due_days INTEGER NOT NULL DEFAULT 0,
      next_date TEXT NOT NULL,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
    addColumn(d, 'tasks', 'parent_id', 'INTEGER REFERENCES tasks(id) ON DELETE CASCADE');
    addColumn(d, 'tasks', 'recurrence_id', 'INTEGER REFERENCES task_recurrences(id) ON DELETE SET NULL');
    d.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)');
  },
  // 9. Настройки приложения (ключи интеграций) и каталог товаров/услуг
  (d) => d.exec(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS catalog_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'service' CHECK (kind IN ('goods','service')),
      name TEXT NOT NULL,
      sku TEXT,
      unit TEXT NOT NULL DEFAULT 'шт',
      price REAL NOT NULL DEFAULT 0,
      vat_rate TEXT,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`),
  // 10. Счета: позиции, оплаты, повторяющиеся счета, нумерация документов по компаниям
  (d) => d.exec(`CREATE TABLE IF NOT EXISTS doc_counters (
      company_id INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      year INTEGER NOT NULL,
      last INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (company_id, kind, year)
    );
    CREATE TABLE IF NOT EXISTS invoice_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
      title TEXT,
      items TEXT NOT NULL,
      vat_mode TEXT NOT NULL DEFAULT 'above',
      every INTEGER NOT NULL DEFAULT 1,
      monthday INTEGER NOT NULL DEFAULT 1,
      due_days INTEGER NOT NULL DEFAULT 5,
      next_date TEXT NOT NULL,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL,
      company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
      schedule_id INTEGER REFERENCES invoice_schedules(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      due_date TEXT,
      vat_mode TEXT NOT NULL DEFAULT 'above',
      net REAL NOT NULL DEFAULT 0,
      vat REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      paid_at TEXT,
      cancelled INTEGER NOT NULL DEFAULT 0,
      title TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_deal ON invoices(deal_id);
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт',
      qty REAL NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      vat_rate TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invoice_items ON invoice_items(invoice_id, position);
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invoice_payments ON invoice_payments(invoice_id);`),
  // 11. Сделки: причина проигрыша, вероятность, дата закрытия
  (d) => {
    addColumn(d, 'deals', 'lost_reason', 'TEXT');
    addColumn(d, 'deals', 'lost_comment', 'TEXT');
    addColumn(d, 'deals', 'probability', 'INTEGER');
    addColumn(d, 'deals', 'closed_at', 'TEXT');
  },
];

{
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[i](db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
      console.log(`Миграция ${i + 1} применена`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Миграция ${i + 1} не применилась: ${e.message}`);
    }
  }
}

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

// Транзакция; вложенные вызовы выполняются как точки сохранения (SAVEPOINT)
let txDepth = 0;
export function tx(fn) {
  const sp = txDepth ? `sp${txDepth}` : null;
  db.exec(sp ? `SAVEPOINT ${sp}` : 'BEGIN');
  txDepth++;
  try {
    const r = fn();
    txDepth--;
    db.exec(sp ? `RELEASE ${sp}` : 'COMMIT');
    return r;
  } catch (e) {
    txDepth--;
    db.exec(sp ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    throw e;
  }
}

export function logActivity(userId, entity, entityId, action, text) {
  run('INSERT INTO activity (user_id, entity, entity_id, action, text) VALUES (?,?,?,?,?)',
    userId ?? null, entity, entityId ?? null, action, text ?? null);
}
