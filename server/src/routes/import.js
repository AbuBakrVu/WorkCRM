import { get, run, tx, logActivity } from '../db.js';
import { requireRole } from '../auth.js';
import { api, HttpError, bad, wrap, insert, update, nowIso } from './shared.js';
import { VAT_RATES } from './companies.js';

/* ---------- импорт из Excel / CSV ---------- */
// rows — уже сопоставленные с полями объекты; дубликаты пропускаем
export const str = (v, n = 500) => (v == null ? null : String(v).trim().slice(0, n) || null);
export const num = (v) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : null; };
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
