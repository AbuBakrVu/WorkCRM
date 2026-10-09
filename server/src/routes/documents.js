import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, tx, logActivity, UPLOAD_DIR } from '../db.js';
import { todayMsk } from '../recurrence.js';
import { renderDocx, docxToPdf, templateTags, buildUpd, paymentQr } from '../docgen.js';
import { requireRole } from '../auth.js';
import { api, bad, notFound, wrap, pick, insert, update, idParam } from './shared.js';
import { wrapAsync } from './companies.js';
import { calcItems } from './deals.js';
import { commitDocNumber, isDate, peekDocNumber } from './invoices.js';

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
