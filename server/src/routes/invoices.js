import { all, get, run, tx, logActivity } from '../db.js';
import { nextDate, addDays, todayMsk } from '../recurrence.js';
import { trashDelete } from '../audit.js';
import { requireRole } from '../auth.js';
import { api, bad, notFound, wrap, pick, insert, update, idParam } from './shared.js';
import { checkVat } from './companies.js';
import { calcItems } from '../calc.js';
import { getDeal } from './deals.js';

/* ---------- нумерация документов: по компании, виду и году ---------- */
export function nextDocNumber(companyId, kind, date) {
  const year = Number(String(date || todayMsk()).slice(0, 4));
  run(`INSERT INTO doc_counters (company_id, kind, year, last) VALUES (?, ?, ?, 1)
    ON CONFLICT(company_id, kind, year) DO UPDATE SET last = last + 1`, companyId || 0, kind, year);
  return get('SELECT last FROM doc_counters WHERE company_id = ? AND kind = ? AND year = ?', companyId || 0, kind, year).last;
}

// Номер «на просмотр» (без резервирования) и фиксация после успешного формирования документа
export function peekDocNumber(companyId, kind, date) {
  const year = Number(String(date || todayMsk()).slice(0, 4));
  return (get('SELECT last FROM doc_counters WHERE company_id = ? AND kind = ? AND year = ?', companyId || 0, kind, year)?.last || 0) + 1;
}
export function commitDocNumber(companyId, kind, date, number) {
  const n = Number(number); if (!Number.isInteger(n)) return;
  const year = Number(String(date || todayMsk()).slice(0, 4));
  run(`INSERT INTO doc_counters (company_id, kind, year, last) VALUES (?, ?, ?, ?)
    ON CONFLICT(company_id, kind, year) DO UPDATE SET last = MAX(last, excluded.last)`, companyId || 0, kind, year, n);
}

/* ---------- счета ---------- */
export const INVOICE_SELECT = `SELECT i.*, c.name client_name, co.name company_name, d.title deal_title
  FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN companies co ON co.id = i.company_id LEFT JOIN deals d ON d.id = i.deal_id`;
function invoiceStatus(i, today = todayMsk()) {
  if (i.cancelled) return 'cancelled';
  if (i.paid >= i.total - 0.005 && i.total > 0) return 'paid';
  if (i.due_date && i.due_date < today) return 'overdue';
  if (i.paid > 0) return 'partial';
  return 'issued';
}
export const shapeInvoice = (i, today) => i && ({ ...i, status: invoiceStatus(i, today), debt: i.cancelled ? 0 : Math.max(0, Math.round((i.total - i.paid) * 100) / 100) });
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
export const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
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
export const CONTRACT_SELECT = `SELECT k.*, c.name client_name, p.name project_name FROM support_contracts k
  LEFT JOIN clients c ON c.id = k.client_id LEFT JOIN projects p ON p.id = k.project_id`;
// Время по договору за месяц (YYYY-MM, по МСК): проекты клиента/договора + заявки клиента
const CONTRACT_ENTRIES = `FROM time_entries e
  LEFT JOIN projects p ON p.id = e.project_id LEFT JOIN tickets t ON t.id = e.ticket_id
  WHERE e.ended_at IS NOT NULL AND strftime('%Y-%m', datetime(e.started_at, '+3 hours')) = ?
    AND ((? IS NOT NULL AND (e.project_id = ? OR t.project_id = ?)) OR (? IS NOT NULL AND (p.client_id = ? OR t.client_id = ?)))`;
const contractArgs = (k, month) => [month, k.project_id, k.project_id, k.project_id, k.client_id, k.client_id, k.client_id];
export function contractUsage(k, month) {
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
