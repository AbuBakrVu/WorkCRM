// Журнал изменений и корзина
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { db, all, get, run, tx, UPLOAD_DIR } from './db.js';

// Кто сейчас выполняет запрос — чтобы любое изменение в БД попадало в историю с автором
export const requestUser = new AsyncLocalStorage();
export const currentUserId = () => requestUser.getStore()?.userId ?? null;

// Какие таблицы и поля ведут историю (вычисляемые поля не пишем)
const TRACKED = {
  tasks: 'task', projects: 'project', clients: 'client', deals: 'deal', tickets: 'ticket', invoices: 'invoice',
  support_contracts: 'contract', companies: 'company', catalog_items: 'catalog', users: 'user', assets: 'asset', kb_articles: 'kb',
};
const SKIP = new Set(['position', 'completed_at', 'paid_at', 'closed_at', 'net', 'vat', 'total', 'paid', 'amount', 'password_hash', 'created_at', 'updated_at', 'secret', 'updated_by']);
const norm = (v) => (v === undefined || v === null || v === '' ? null : String(v));

// Вызывается перед UPDATE: сравнивает и пишет изменения
export function recordChanges(table, id, data) {
  const entity = TRACKED[table];
  if (!entity) return;
  const keys = Object.keys(data).filter((k) => !SKIP.has(k));
  if (!keys.length) return;
  const before = get(`SELECT ${keys.join(',')} FROM ${table} WHERE id = ?`, id);
  if (!before) return;
  const uid = currentUserId();
  for (const k of keys) {
    const a = norm(before[k]); const b = norm(typeof data[k] === 'boolean' ? (data[k] ? 1 : 0) : data[k]);
    if (a !== b) run('INSERT INTO entity_history (entity, entity_id, user_id, field, old_value, new_value) VALUES (?,?,?,?,?,?)', entity, id, uid, k, a, b);
  }
}
export function recordEvent(entity, id, field, value) {
  run('INSERT INTO entity_history (entity, entity_id, user_id, field, new_value) VALUES (?,?,?,?,?)', entity, id, currentUserId(), field, value ?? null);
}

/* ---------- корзина: снимок записи со всеми зависимыми строками ---------- */
// Карта внешних ключей: кто ссылается на таблицу и что происходит при удалении
let FK = null;
function fkMap() {
  if (FK) return FK;
  FK = {};
  for (const { name } of all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    for (const f of all(`PRAGMA foreign_key_list(${name})`)) (FK[f.table] ??= []).push({ table: name, col: f.from, onDelete: f.on_delete });
  }
  return FK;
}
const SKIP_TABLES = new Set(['entity_history', 'activity', 'trash', 'auth_log', 'saved_views']);
const pkCols = (table) => all(`PRAGMA table_info(${table})`).filter((c) => c.pk).map((c) => c.name);

function snapshotRows(table, where, args, seen) {
  const rows = all(`SELECT * FROM ${table} WHERE ${where}`, ...args);
  const node = { table, rows, children: [], relinks: [] };
  const hasId = pkCols(table).length === 1 && pkCols(table)[0] === 'id';
  if (!hasId || !rows.length) return node;
  const ids = rows.map((r) => r.id).filter((x) => !seen.has(`${table}:${x}`));
  ids.forEach((x) => seen.add(`${table}:${x}`));
  if (!ids.length) return node;
  const q = ids.map(() => '?').join(',');
  for (const ref of fkMap()[table] || []) {
    if (SKIP_TABLES.has(ref.table)) continue;
    if (ref.onDelete === 'CASCADE') node.children.push(snapshotRows(ref.table, `${ref.col} IN (${q})`, ids, seen));
    else if (ref.onDelete === 'SET NULL') {
      const hasRefId = pkCols(ref.table).includes('id');
      if (!hasRefId) continue;
      const linked = all(`SELECT id, ${ref.col} v FROM ${ref.table} WHERE ${ref.col} IN (${q})`, ...ids);
      if (linked.length) node.relinks.push({ table: ref.table, col: ref.col, links: linked.map((l) => [l.id, l.v]) });
    }
  }
  return node;
}
const filesOf = (node, out = []) => { if (node.table === 'files') out.push(...node.rows.map((r) => r.stored)); node.children.forEach((c) => filesOf(c, out)); return out; };

// Удалить запись в корзину (вместе с зависимыми строками)
export function trashDelete(entity, table, id, title) {
  return tx(() => {
    const snap = snapshotRows(table, 'id = ?', [id], new Set());
    if (!snap.rows.length) return false;
    run('INSERT INTO trash (entity, entity_id, title, snapshot, deleted_by) VALUES (?,?,?,?,?)', entity, id, title || null, JSON.stringify(snap), currentUserId());
    run(`DELETE FROM ${table} WHERE id = ?`, id);
    recordEvent(entity, id, '_deleted', title);
    return true;
  });
}

function restoreNode(node) {
  for (const r of node.rows) {
    const cols = Object.keys(r);
    run(`INSERT OR IGNORE INTO ${node.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => r[c]));
  }
  node.children.forEach(restoreNode);
  for (const rl of node.relinks) for (const [rid, v] of rl.links) run(`UPDATE ${rl.table} SET ${rl.col} = ? WHERE id = ? AND ${rl.col} IS NULL`, v, rid);
}
// Ссылки на удалённые потом записи (например, исполнитель уже удалён) — обнуляем, чтобы восстановление не падало
function sanitize(node) {
  for (const r of node.rows) {
    for (const f of all(`PRAGMA foreign_key_list(${node.table})`)) {
      if (r[f.from] == null) continue;
      const inSnap = (n) => n.table === f.table && n.rows.some((x) => x[f.to] === r[f.from]);
      if (!get(`SELECT 1 FROM ${f.table} WHERE ${f.to} = ?`, r[f.from]) && !walk(rootNode, inSnap)) {
        const col = all(`PRAGMA table_info(${node.table})`).find((c) => c.name === f.from);
        if (!col.notnull) r[f.from] = null;
      }
    }
  }
  node.children.forEach(sanitize);
}
let rootNode = null;
const walk = (n, fn) => fn(n) || n.children.some((c) => walk(c, fn));

export function trashRestore(trashId) {
  const t = get('SELECT * FROM trash WHERE id = ?', trashId);
  if (!t) return null;
  const snap = JSON.parse(t.snapshot);
  if (get(`SELECT 1 FROM ${snap.table} WHERE id = ?`, t.entity_id)) throw new Error('Запись с таким номером уже существует');
  tx(() => {
    rootNode = snap; sanitize(snap); rootNode = null;
    restoreNode(snap);
    run('DELETE FROM trash WHERE id = ?', trashId);
    recordEvent(t.entity, t.entity_id, '_restored', t.title);
  });
  return t;
}
export function trashPurge(trashId) {
  const t = get('SELECT * FROM trash WHERE id = ?', trashId);
  if (!t) return;
  for (const stored of filesOf(JSON.parse(t.snapshot))) {
    if (!get('SELECT 1 FROM files WHERE stored = ?', stored)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(stored))); } catch { /* уже нет */ } }
  }
  run('DELETE FROM trash WHERE id = ?', trashId);
}
// Старше 30 дней — удаляем навсегда
export function trashAutoPurge(days = 30) {
  for (const t of all(`SELECT id FROM trash WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`, `-${days} days`)) trashPurge(t.id);
}
export { db };
