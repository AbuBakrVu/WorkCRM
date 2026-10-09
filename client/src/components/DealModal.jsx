import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { DEAL_STAGE, INVOICE_STATUS, LOST_REASONS } from '../lib/constants';
import { fmtRub, fmtDate } from '../lib/format';
import { ItemsEditor, badItem, itemsBody } from './ItemsEditor';
export { calcItems } from './ItemsEditor';
import { Button, Modal, Field, Select, ConfirmButton, Spinner, StatusDot, userOptions, nameOptions } from './ui';
import { HistoryPanel } from './History';
import { DocumentsPanel } from './Documents';

export function DealModal({ deal, onClose }) {
  const { users, clients, toast, bump, isManager } = useApp();
  const [companies, setCompanies] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [f, setF] = useState(null);
  const [items, setItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    if (!deal) { setF(null); return; }
    api.get('/companies').then(setCompanies).catch(() => {});
    api.get('/catalog').then((c) => setCatalog(c.filter((x) => x.active))).catch(() => {});
    if (deal.id) {
      setF(null);
      if (isManager) api.get(`/invoices?deal_id=${deal.id}`).then(setInvoices).catch(() => {});
      api.get(`/deals/${deal.id}`).then((d) => { setF(d); setItems(d.items.map(({ id, name, unit, qty, price, vat_rate }) => ({ key: id, name, unit, qty, price, vat_rate }))); })
        .catch((e) => toast(e.message, 'error'));
    } else { setF({ stage: 'lead', vat_mode: 'above', ...deal }); setItems([]); }
  }, [deal, toast, isManager]);
  // Новая сделка — компания по умолчанию
  useEffect(() => { if (f && !f.id && !f.company_id && companies.length) setF((x) => ({ ...x, company_id: String(companies[0].id) })); }, [companies, f]);

  if (!deal) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const company = companies.find((c) => String(c.id) === String(f?.company_id));
  const defVat = company?.vat_rate || '22';
  const hasItems = items.length > 0;


  const submit = async () => {
    if (!f.title?.trim()) return toast('Укажите название сделки', 'error');
    if (f.stage === 'lost' && !f.lost_reason) return toast('Укажите причину проигрыша', 'error');
    const bad = badItem(items);
    if (bad) return toast(bad, 'error');
    const body = {
      title: f.title, client_id: f.client_id ? +f.client_id : null, stage: f.stage, owner_id: f.owner_id ? +f.owner_id : null,
      expected_close: f.expected_close || null, notes: f.notes || null, company_id: f.company_id ? +f.company_id : null,
      vat_mode: f.vat_mode, contract_no: f.contract_no || null, contract_date: f.contract_date || null,
      probability: f.probability === '' || f.probability == null ? null : +f.probability,
      ...(f.stage === 'lost' ? { lost_reason: f.lost_reason || null, lost_comment: f.lost_comment || null } : {}),
      items: itemsBody(items),
      ...(hasItems ? {} : { amount: +f.amount || 0 }),
    };
    try { f.id ? await api.put(`/deals/${f.id}`, body) : await api.post('/deals', body); toast('Сделка сохранена'); bump(); onClose(); return true; }
    catch (err) { toast(err.message, 'error'); return false; }
  };
  // Счёт по сделке: сначала сохраняем сделку, потом выставляем счёт с её позициями
  const makeInvoice = async () => {
    if (!items.length) return toast('Добавьте в сделку товары или услуги', 'error');
    if (!f.client_id) return toast('Укажите клиента', 'error');
    if (!(await submit())) return;
    try { const inv = await api.post('/invoices', { deal_id: f.id }); toast(`Счёт № ${inv.number} выставлен`); navigate(`/finance/invoices?open=${inv.id}`); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => { await api.del(`/deals/${f.id}`); toast('Сделка удалена'); bump(); onClose(); };

  return (
    <Modal open onClose={onClose} title={f?.id ? 'Сделка' : 'Новая сделка'} width={980}
      footer={f && <>{f.id && isManager && <div className="mr-auto"><ConfirmButton onConfirm={remove} /></div>}{f.id && isManager && <Button icon={Receipt} onClick={makeInvoice}>Выставить счёт</Button>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Сохранить</Button></>}>
      {!f ? <Spinner /> : (
        <div className="space-y-5" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <Field label="Название" className="col-span-2 md:col-span-4"><input className="input" value={f.title || ''} onChange={set('title')} autoFocus placeholder="Например: Поставка коммутаторов для ЧГУ" /></Field>
            <Field label="Клиент" className="col-span-2"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" search options={nameOptions(clients)} /></Field>
            <Field label="Наша компания" className="col-span-2" hint={!companies.length ? 'Добавьте в Настройки → Мои компании' : undefined}>
              <Select value={f.company_id} onChange={set('company_id')} placeholder="—" search options={companies.map((c) => ({ value: c.id, label: c.name, hint: c.inn ? `ИНН ${c.inn}` : undefined }))} />
            </Field>
            <Field label="Этап"><Select value={f.stage} onChange={set('stage')} options={Object.entries(DEAL_STAGE).map(([value, s]) => ({ value, label: s.label, color: s.color }))} /></Field>
            <Field label="Ответственный"><Select value={f.owner_id} onChange={set('owner_id')} placeholder="—" search options={userOptions(users)} /></Field>
            <Field label="Договор №"><input className="input" value={f.contract_no || ''} onChange={set('contract_no')} /></Field>
            <Field label="от"><input type="date" className="input" value={f.contract_date || ''} onChange={set('contract_date')} /></Field>
            <Field label="Ожидаемое закрытие"><input type="date" className="input" value={f.expected_close || ''} onChange={set('expected_close')} /></Field>
            {!['won', 'lost'].includes(f.stage) && <Field label="Вероятность, %" hint={`По этапу — ${DEAL_STAGE[f.stage]?.prob ?? 0}%`}><input type="number" min="0" max="100" className="input" value={f.probability ?? ''} onChange={set('probability')} placeholder={String(DEAL_STAGE[f.stage]?.prob ?? '')} /></Field>}
            {f.stage === 'lost' && (<>
              <Field label="Причина проигрыша"><Select value={f.lost_reason} onChange={set('lost_reason')} placeholder="Выберите" options={LOST_REASONS.map((r) => ({ value: r, label: r }))} /></Field>
              <Field label="Комментарий" className="col-span-2"><input className="input" value={f.lost_comment || ''} onChange={set('lost_comment')} /></Field>
            </>)}
            {!hasItems && <Field label="Сумма, ₽" hint="Или добавьте позиции — сумма посчитается сама"><input type="number" min="0" className="input" value={f.amount || ''} onChange={set('amount')} /></Field>}
          </div>

          <ItemsEditor items={items} setItems={setItems} vatMode={f.vat_mode} setVatMode={set('vat_mode')} defVat={defVat} catalog={catalog} />

          {invoices.length > 0 && (
            <div>
              <h3 className="text-[14px] font-semibold mb-2">Счета по сделке</h3>
              <div className="border border-line rounded-xl divide-y divide-line">
                {invoices.map((i) => (
                  <button key={i.id} onClick={() => navigate(`/finance/invoices?open=${i.id}`)} className="w-full flex items-center gap-3 px-3 h-10 text-[13px] hover:bg-canvas text-left">
                    <span className="font-semibold w-16">№ {i.number}</span><span className="text-ink-3 w-24">{fmtDate(i.date, true)}</span>
                    <span className="flex-1 tabular">{fmtRub(i.total)}</span><StatusDot color={INVOICE_STATUS[i.status].color} label={INVOICE_STATUS[i.status].label} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <Field label="Заметки"><textarea className="input" rows={3} value={f.notes || ''} onChange={set('notes')} /></Field>
          {f.id && isManager && <DocumentsPanel source={{ deal_id: f.id }} kinds={['offer']} companyId={f.company_id} title="Коммерческие предложения" />}
          {f.id && <HistoryPanel entity="deal" id={f.id} />}
        </div>
      )}
    </Modal>
  );
}

