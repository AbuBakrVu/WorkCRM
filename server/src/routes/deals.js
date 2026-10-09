import { all, get, run, tx, logActivity } from '../db.js';
import { todayMsk } from '../recurrence.js';
import { trashDelete } from '../audit.js';
import { requireRole } from '../auth.js';
import { api, bad, notFound, wrap, pick, insert, update, idParam, required } from './shared.js';
import { checkVat } from './companies.js';

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
export function getDeal(id) {
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
