import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, X, Receipt, Wallet, AlertTriangle, CheckCircle2, Repeat, Pencil, Ban, RotateCcw, Trash2, Banknote, Users, Pause, Play } from 'lucide-react';
import { useApp, useLoad, useStored } from '../lib/store';
import { api } from '../lib/api';
import { INVOICE_STATUS, VAT_MODE, VAT_RATES } from '../lib/constants';
import { fmtRub, fmtMoneyShort, fmtDate, todayStr, toDateStr, plural } from '../lib/format';
import { Button, Card, Empty, Spinner, Drawer, Modal, Field, Select, ConfirmButton, PageHeader, Stat, Tabs, StatusDot, cx, nameOptions } from '../components/ui';
import { ItemsEditor, badItem, itemsBody, itemsFromServer } from '../components/ItemsEditor';
import { HistoryPanel } from '../components/History';
import { DocumentsPanel } from '../components/Documents';

const addDays = (s, n) => { const d = new Date(s); d.setDate(d.getDate() + n); return toDateStr(d); };
const TABS = { all: 'Все', unpaid: 'Ждут оплаты', overdue: 'Просроченные', paid: 'Оплаченные', cancelled: 'Отменённые' };
const inTab = (i, tab) => tab === 'all' ? true : tab === 'unpaid' ? ['issued', 'partial', 'overdue'].includes(i.status) : i.status === tab;

export default function Invoices() {
  const { data, reload } = useLoad('/invoices');
  const { isManager } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab0, setTab] = useStored('crm.invoices.tab', 'unpaid');
  const tab = tab0 === 'schedules' ? 'unpaid' : tab0;
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null);
  useEffect(() => {
    const o = Number(params.get('open'));
    if (o) { setOpenId(o); setParams({}, { replace: true }); }
  }, [params, setParams]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data || []).filter((i) => inTab(i, tab) && (!ql || `${i.number} ${i.client_name || ''} ${i.title || ''} ${i.deal_title || ''}`.toLowerCase().includes(ql)));
  }, [data, tab, q]);
  if (!data) return <Spinner />;

  const month = todayStr().slice(0, 7);
  const debt = data.reduce((a, i) => a + i.debt, 0);
  const overdue = data.filter((i) => i.status === 'overdue');
  const paidMonth = data.filter((i) => i.paid_at && i.paid_at.startsWith(month)).reduce((a, i) => a + i.paid, 0);
  const issuedMonth = data.filter((i) => !i.cancelled && i.date.startsWith(month));
  const counts = Object.fromEntries(Object.keys(TABS).map((k) => [k, data.filter((i) => inTab(i, k)).length]));

  return (
    <div>
      <PageHeader title="Счета" subtitle="Выставленные счета, оплаты и задолженность клиентов"
        actions={isManager && <Button variant="primary" icon={Plus} onClick={() => setForm({})}>Новый счёт</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Ждём оплату" value={fmtMoneyShort(debt)} sub={`${data.filter((i) => i.debt > 0).length} ${plural(data.filter((i) => i.debt > 0).length, 'счёт', 'счёта', 'счетов')}`} icon={Wallet} featured />
        <Stat label="Просрочено" value={fmtMoneyShort(overdue.reduce((a, i) => a + i.debt, 0))} sub={`${overdue.length} ${plural(overdue.length, 'счёт', 'счёта', 'счетов')}`} icon={AlertTriangle} tone={overdue.length ? 'red' : undefined} />
        <Stat label="Оплачено в этом месяце" value={fmtMoneyShort(paidMonth)} icon={CheckCircle2} />
        <Stat label="Выставлено в этом месяце" value={fmtMoneyShort(issuedMonth.reduce((a, i) => a + i.total, 0))} sub={`${issuedMonth.length} ${plural(issuedMonth.length, 'счёт', 'счёта', 'счетов')}`} icon={Receipt} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[...Object.entries(TABS).map(([value, label]) => ({ value, label, count: counts[value] })),
        { value: 'debtors', label: 'Должники', icon: Users }]} />
      <div className="mt-4">
        {tab === 'debtors' ? <Debtors /> : (<>
          <div className={cx('flex items-center gap-1.5 h-9 px-3 rounded-full border bg-panel w-fit mb-3', q ? 'border-violet/40' : 'border-line')}>
            <Search size={15} className="text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Номер, клиент, сделка" className="outline-none text-[13px] w-52 bg-transparent" />
            {q && <button onClick={() => setQ('')}><X size={14} className="text-ink-3" /></button>}
          </div>
          {list.length === 0 ? <Card><Empty icon={Receipt} title="Счетов нет" text={data.length ? 'В этой вкладке пусто' : 'Выставьте первый счёт — вручную или из сделки'} /></Card> : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="bg-canvas/60 border-b border-line">
                    <th className="th">№</th><th className="th">Дата</th><th className="th">Клиент</th><th className="th">Назначение</th>
                    <th className="th text-right">Сумма</th><th className="th text-right">Оплачено</th><th className="th">Оплатить до</th><th className="th">Статус</th>
                  </tr></thead>
                  <tbody>
                    {list.map((i) => (
                      <tr key={i.id} onClick={() => setOpenId(i.id)} className={cx('border-b border-line last:border-0 hover:bg-canvas/50 cursor-pointer', i.cancelled && 'opacity-50')}>
                        <td className="td font-semibold text-ink tabular">{i.number}</td>
                        <td className="td tabular">{fmtDate(i.date, true)}</td>
                        <td className="td"><div className="text-ink">{i.client_name || '—'}</div><div className="text-[11.5px] text-ink-3">{i.company_name}</div></td>
                        <td className="td whitespace-normal max-w-[280px]"><span className="line-clamp-1">{i.title || i.deal_title || '—'}</span>{i.schedule_id && <span className="inline-flex items-center gap-1 text-[11px] text-ink-3"><Repeat size={11} />по расписанию</span>}</td>
                        <td className="td text-right tabular font-medium text-ink">{fmtRub(i.total)}</td>
                        <td className="td text-right tabular">{i.paid ? fmtRub(i.paid) : '—'}</td>
                        <td className={cx('td tabular', i.status === 'overdue' && 'text-red-600 font-medium')}>{i.due_date ? fmtDate(i.due_date, true) : '—'}</td>
                        <td className="td"><StatusDot color={INVOICE_STATUS[i.status].color} label={INVOICE_STATUS[i.status].label} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t border-line bg-canvas/40">
                    <td className="td font-semibold" colSpan={4}>Итого: {list.length}</td>
                    <td className="td text-right tabular font-semibold text-ink">{fmtRub(list.reduce((a, i) => a + (i.cancelled ? 0 : i.total), 0))}</td>
                    <td className="td text-right tabular font-semibold">{fmtRub(list.reduce((a, i) => a + i.paid, 0))}</td><td className="td" colSpan={2} />
                  </tr></tfoot>
                </table>
              </div>
            </Card>
          )}
        </>)}
      </div>
      <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} onEdit={setForm} onChanged={reload} />
      {form && <InvoiceModal invoice={form} onClose={() => setForm(null)} onSaved={(inv) => { reload(); setOpenId(inv.id); }} />}
    </div>
  );
}

/* ---------- Карточка счёта ---------- */
export function InvoiceDrawer({ id, onClose, onEdit, onChanged }) {
  const { toast, bump, isManager, version } = useApp();
  const [inv, setInv] = useState(null);
  const [pay, setPay] = useState(null);
  useEffect(() => { if (id) api.get(`/invoices/${id}`).then(setInv).catch((e) => toast(e.message, 'error')); else { setInv(null); setPay(null); } }, [id, version, toast]);
  if (!id) return null;
  const changed = (x) => { setInv(x); onChanged?.(); bump(); };
  const call = async (p, msg) => { try { const r = await p; if (r?.id) changed(r); if (msg) toast(msg); return r; } catch (e) { toast(e.message, 'error'); } };
  const addPayment = async () => {
    const r = await call(api.post(`/invoices/${id}/payments`, { amount: +pay.amount, date: pay.date, note: pay.note, to_finance: pay.to_finance }), 'Оплата записана');
    if (r) setPay(null);
  };
  const remove = async () => { try { await api.del(`/invoices/${id}`); toast('Счёт удалён'); onChanged?.(); bump(); onClose(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Drawer open onClose={onClose} width={760} title={inv ? <span className="flex items-center gap-3">Счёт № {inv.number} <span className="text-ink-3 font-normal text-[13px]">от {fmtDate(inv.date, true)}</span></span> : 'Счёт'}
      actions={inv && isManager && !inv.cancelled && <Button size="sm" icon={Pencil} onClick={() => onEdit({ ...inv })}>Изменить</Button>}>
      {!inv ? <Spinner /> : (
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusDot color={INVOICE_STATUS[inv.status].color} label={<span className="text-[14px] font-semibold text-ink">{INVOICE_STATUS[inv.status].label}</span>} />
            {inv.debt > 0 && !inv.cancelled && <span className="text-[13px] text-ink-2">осталось оплатить <b className="text-ink tabular">{fmtRub(inv.debt)}</b></span>}
            {inv.paid > inv.total + 0.005 && <span className="text-[12.5px] text-amber-600">переплата {fmtRub(inv.paid - inv.total)}</span>}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] bg-canvas/60 rounded-2xl p-4">
            {[['Клиент', inv.client_name], ['От компании', inv.company_name], ['Сделка', inv.deal_title], ['Назначение', inv.title],
              ['Оплатить до', inv.due_date && fmtDate(inv.due_date, true)], ['НДС', VAT_MODE[inv.vat_mode]]].map(([k, v]) => (
              <div key={k} className="min-w-0"><div className="text-[11.5px] text-ink-3">{k}</div><div className="text-ink truncate">{v || '—'}</div></div>
            ))}
          </div>
          <div className="rounded-2xl border border-line overflow-hidden">
            <table className="w-full text-[13px]">
              <thead><tr className="bg-canvas/60 text-[12px] text-ink-3"><th className="text-left font-medium px-3 py-2 w-8">№</th><th className="text-left font-medium px-2">Наименование</th><th className="text-right font-medium px-2">Кол-во</th><th className="text-right font-medium px-2">Цена</th><th className="text-left font-medium px-2">НДС</th><th className="text-right font-medium px-3">Сумма</th></tr></thead>
              <tbody>
                {inv.items.map((it, i) => (
                  <tr key={it.id} className="border-t border-line align-top">
                    <td className="px-3 py-2 text-ink-3 tabular">{i + 1}</td><td className="px-2 py-2 text-ink">{it.name}</td>
                    <td className="px-2 py-2 text-right tabular whitespace-nowrap">{it.qty} {it.unit}</td><td className="px-2 py-2 text-right tabular whitespace-nowrap">{fmtRub(it.price)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{VAT_RATES.find((v) => v.value === it.vat_rate)?.label || '—'}</td><td className="px-3 py-2 text-right tabular font-medium whitespace-nowrap">{fmtRub(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-line px-3 py-2.5 text-[13px] tabular grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-right">
              <span className="text-ink-3">Без НДС</span><span>{fmtRub(inv.net)}</span>
              <span className="text-ink-3">{inv.vat_mode === 'included' ? 'В т.ч. НДС' : 'НДС'}</span><span>{inv.vat ? fmtRub(inv.vat) : 'Без НДС'}</span>
              <span className="font-semibold">Итого</span><span className="font-semibold text-[15px]">{fmtRub(inv.total)}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[14px] font-semibold">Оплаты {inv.payments.length > 0 && <span className="text-ink-3 font-normal">{inv.payments.length}</span>}</h3>
              {isManager && !inv.cancelled && !pay && inv.debt > 0 && <Button size="sm" variant="primary" icon={Banknote} onClick={() => setPay({ amount: inv.debt, date: todayStr(), note: '', to_finance: true })}>Внести оплату</Button>}
            </div>
            {pay && (
              <div className="rounded-2xl border border-brand/40 bg-brand/[.04] p-4 mb-3 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                <Field label="Сумма, ₽"><input autoFocus type="number" step="0.01" className="input" value={pay.amount} onChange={(e) => setPay((x) => ({ ...x, amount: e.target.value }))} /></Field>
                <Field label="Дата"><input type="date" className="input" value={pay.date} onChange={(e) => setPay((x) => ({ ...x, date: e.target.value }))} /></Field>
                <Field label="Комментарий" className="col-span-2"><input className="input" value={pay.note} onChange={(e) => setPay((x) => ({ ...x, note: e.target.value }))} placeholder="Например: п/п № 512" /></Field>
                <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-ink-2"><input type="checkbox" checked={pay.to_finance} onChange={(e) => setPay((x) => ({ ...x, to_finance: e.target.checked }))} className="accent-[var(--color-brand)]" />Записать доход в «Финансы»</label>
                <div className="col-span-2 flex justify-end gap-2"><Button size="sm" onClick={() => setPay(null)}>Отмена</Button><Button size="sm" variant="primary" onClick={addPayment}>Сохранить оплату</Button></div>
              </div>
            )}
            {inv.payments.length === 0 ? <div className="text-[13px] text-ink-3">Оплат пока нет</div> : (
              <div className="border border-line rounded-xl divide-y divide-line">
                {inv.payments.map((p) => (
                  <div key={p.id} className="group flex items-center gap-3 px-3 h-11 text-[13px]">
                    <span className="text-ink-3 w-24 tabular">{fmtDate(p.date, true)}</span>
                    <span className="flex-1 truncate text-ink-2">{p.note || (p.transaction_id ? 'учтено в финансах' : '')}</span>
                    <span className="tabular font-medium text-emerald-600">+{fmtRub(p.amount)}</span>
                    {isManager && <button onClick={() => call(api.del(`/invoice-payments/${p.id}`), 'Оплата удалена')} className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-red-600" title="Удалить оплату"><Trash2 size={14} /></button>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {isManager && !inv.cancelled && <DocumentsPanel source={{ invoice_id: inv.id }} kinds={['invoice', 'act', 'upd']} companyId={inv.company_id} period={inv.period} />}
          {inv.notes && <p className="text-[13px] text-ink-2 bg-canvas rounded-xl p-3 whitespace-pre-wrap">{inv.notes}</p>}
          <HistoryPanel entity="invoice" id={inv.id} />
          {isManager && (
            <div className="flex flex-wrap gap-2 pt-3 border-t border-line">
              {inv.cancelled ? <Button size="sm" icon={RotateCcw} onClick={() => call(api.put(`/invoices/${id}`, { cancelled: false }), 'Счёт восстановлен')}>Восстановить</Button>
                : <Button size="sm" icon={Ban} onClick={() => call(api.put(`/invoices/${id}`, { cancelled: true }), 'Счёт отменён')}>Отменить счёт</Button>}
              {!inv.payments.length && <ConfirmButton onConfirm={remove}>Удалить</ConfirmButton>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

/* ---------- Новый / редактирование счёта ---------- */
export function InvoiceModal({ invoice, onClose, onSaved }) {
  const { clients, toast, bump } = useApp();
  const [companies, setCompanies] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [deals, setDeals] = useState([]);
  const [f, setF] = useState(null);
  const [items, setItems] = useState([]);
  useEffect(() => {
    Promise.all([api.get('/companies'), api.get('/catalog'), api.get('/deals')]).then(([co, ca, de]) => {
      setCompanies(co); setCatalog(ca.filter((x) => x.active)); setDeals(de);
      const date = invoice.date || todayStr();
      setF({ vat_mode: 'above', company_id: co[0]?.id, ...invoice, date, due_date: invoice.due_date ?? (invoice.id ? null : addDays(date, 5)) });
      setItems(itemsFromServer(invoice.items));
    }).catch((e) => toast(e.message, 'error'));
  }, [invoice, toast]);
  if (!f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const company = companies.find((c) => String(c.id) === String(f.company_id));
  const pickDeal = async (v) => {
    set('deal_id')(v);
    if (!v) return;
    const d = await api.get(`/deals/${v}`);
    setF((x) => ({ ...x, client_id: x.client_id || d.client_id, company_id: d.company_id || x.company_id, vat_mode: d.vat_mode, title: x.title || d.title }));
    if (!items.length && d.items.length) setItems(itemsFromServer(d.items));
  };
  const save = async () => {
    if (!f.client_id) return toast('Выберите клиента', 'error');
    if (!items.length) return toast('Добавьте позиции', 'error');
    const bad = badItem(items); if (bad) return toast(bad, 'error');
    const body = { number: f.number || null, company_id: f.company_id ? +f.company_id : null, client_id: +f.client_id, deal_id: f.deal_id ? +f.deal_id : null,
      date: f.date, due_date: f.due_date || null, vat_mode: f.vat_mode, title: f.title || null, notes: f.notes || null, period: f.period || null, items: itemsBody(items) };
    try {
      const inv = f.id ? await api.put(`/invoices/${f.id}`, body) : await api.post('/invoices', body);
      toast(f.id ? 'Счёт сохранён' : `Счёт № ${inv.number} выставлен`); bump(); onSaved?.(inv); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title={f.id ? `Счёт № ${f.number}` : 'Новый счёт'} width={980}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>{f.id ? 'Сохранить' : 'Выставить счёт'}</Button></>}>
      <div className="space-y-5" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); }}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <Field label="Клиент" className="col-span-2"><Select value={f.client_id} onChange={set('client_id')} placeholder="Выберите клиента" search options={nameOptions(clients)} /></Field>
          <Field label="От компании" className="col-span-2"><Select value={f.company_id} onChange={set('company_id')} placeholder="—" search options={companies.map((c) => ({ value: c.id, label: c.name, hint: c.inn ? `ИНН ${c.inn}` : undefined }))} /></Field>
          <Field label="Номер" hint={f.id ? undefined : 'Пусто — следующий по порядку'}><input className="input" value={f.number || ''} onChange={set('number')} placeholder="авто" /></Field>
          <Field label="Дата"><input type="date" className="input" value={f.date || ''} onChange={set('date')} /></Field>
          <Field label="Оплатить до"><input type="date" className="input" value={f.due_date || ''} onChange={set('due_date')} /></Field>
          <Field label="Сделка"><Select value={f.deal_id} onChange={pickDeal} placeholder="—" search options={deals.filter((d) => !f.client_id || !d.client_id || String(d.client_id) === String(f.client_id)).map((d) => ({ value: d.id, label: d.title, hint: d.client_name }))} /></Field>
          <Field label="Период (для шаблонов «за период»)" className="col-span-2"><input className="input" value={f.period || ''} onChange={set('period')} placeholder="октябрь 2026" /></Field>
          <Field label="Назначение (необязательно)" className="col-span-2"><input className="input" value={f.title || ''} onChange={set('title')} placeholder="Например: Оплата за монтаж СКС по договору № 12" /></Field>
        </div>
        <ItemsEditor items={items} setItems={setItems} vatMode={f.vat_mode} setVatMode={set('vat_mode')} defVat={company?.vat_rate || '22'} catalog={catalog} />
        <Field label="Комментарий (виден только в CRM)"><textarea className="input" rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

/* ---------- Должники ---------- */
function Debtors() {
  const { data } = useLoad('/receivables');
  if (!data) return <Spinner />;
  if (!data.length) return <Card><Empty icon={CheckCircle2} title="Никто не должен" text="Все выставленные счета оплачены" /></Card>;
  return (
    <Card className="overflow-hidden">
      <table className="w-full">
        <thead><tr className="bg-canvas/60 border-b border-line"><th className="th">Клиент</th><th className="th text-right">Счетов</th><th className="th text-right">Долг</th><th className="th text-right">Из них просрочено</th><th className="th">Самый старый срок</th></tr></thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.client_id || 0} className="border-b border-line last:border-0">
              <td className="td text-ink font-medium">{r.client_name}</td><td className="td text-right tabular">{r.count}</td>
              <td className="td text-right tabular font-semibold text-ink">{fmtRub(r.debt)}</td>
              <td className={cx('td text-right tabular', r.overdue > 0 && 'text-red-600 font-semibold')}>{r.overdue ? fmtRub(r.overdue) : '—'}</td>
              <td className={cx('td', r.oldest_due && 'text-red-600')}>{r.oldest_due ? fmtDate(r.oldest_due, true) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-line bg-canvas/40"><td className="td font-semibold">Итого</td><td /><td className="td text-right tabular font-semibold text-ink">{fmtRub(data.reduce((a, r) => a + r.debt, 0))}</td><td className="td text-right tabular font-semibold text-red-600">{fmtRub(data.reduce((a, r) => a + r.overdue, 0))}</td><td /></tr></tfoot>
      </table>
    </Card>
  );
}

/* ---------- Повторяющиеся счета ---------- */
export function Schedules() {
  const { data, reload } = useLoad('/invoice-schedules');
  const { isManager, toast, bump } = useApp();
  const [form, setForm] = useState(null);
  if (!data) return <Spinner />;
  const toggle = async (s) => { try { await api.put(`/invoice-schedules/${s.id}`, { active: !s.active }); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-[13px] text-ink-2">Счета, которые выставляются сами каждый месяц — например, абонентское обслуживание.</p>
        {isManager && <Button variant="primary" icon={Plus} onClick={() => setForm({})}>Настроить</Button>}
      </div>
      {!data.length ? <Card><Empty icon={Repeat} title="Повторяющихся счетов нет" text="Настройте ежемесячный счёт клиенту на абонентское обслуживание" /></Card> : (
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead><tr className="bg-canvas/60 border-b border-line"><th className="th">Клиент</th><th className="th">Назначение</th><th className="th">Как часто</th><th className="th text-right">Сумма</th><th className="th">Следующий</th><th className="th text-right">Выставлено</th><th className="th w-20" /></tr></thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className={cx('border-b border-line last:border-0', !s.active && 'opacity-55')}>
                  <td className="td text-ink font-medium">{s.client_name || '—'}<div className="text-[11.5px] text-ink-3 font-normal">{s.company_name}</div></td>
                  <td className="td">{s.title || '—'}</td>
                  <td className="td">{s.every > 1 ? `раз в ${s.every} ${plural(s.every, 'месяц', 'месяца', 'месяцев')}` : 'каждый месяц'}, {s.monthday}-го</td>
                  <td className="td text-right tabular font-medium text-ink">{fmtRub(s.total)}</td>
                  <td className="td">{s.active ? fmtDate(s.next_date, true) : 'на паузе'}</td>
                  <td className="td text-right tabular">{s.invoices_count}</td>
                  <td className="td">{isManager && <div className="flex justify-end gap-1">
                    <button onClick={() => toggle(s)} className="size-8 grid place-items-center rounded-full hover:bg-canvas text-ink-2" title={s.active ? 'Пауза' : 'Включить'}>{s.active ? <Pause size={15} /> : <Play size={15} />}</button>
                    <button onClick={() => setForm(s)} className="size-8 grid place-items-center rounded-full hover:bg-canvas text-ink-2" title="Изменить"><Pencil size={15} /></button>
                  </div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {form && <ScheduleModal s={form} onClose={() => setForm(null)} onSaved={() => { reload(); bump(); }} />}
    </div>
  );
}

function ScheduleModal({ s, onClose, onSaved }) {
  const { clients, toast } = useApp();
  const [companies, setCompanies] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [f, setF] = useState(null);
  const [items, setItems] = useState([]);
  useEffect(() => {
    Promise.all([api.get('/companies'), api.get('/catalog')]).then(([co, ca]) => {
      setCompanies(co); setCatalog(ca.filter((x) => x.active));
      setF({ vat_mode: 'above', every: 1, monthday: 1, due_days: 5, next_date: todayStr(), company_id: co[0]?.id, active: 1, ...s });
      setItems(itemsFromServer(s.items));
    });
  }, [s]);
  if (!f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    if (!f.client_id) return toast('Выберите клиента', 'error');
    if (!items.length) return toast('Добавьте позиции', 'error');
    const bad = badItem(items); if (bad) return toast(bad, 'error');
    const body = { company_id: f.company_id ? +f.company_id : null, client_id: +f.client_id, title: f.title || null, vat_mode: f.vat_mode, every: +f.every || 1,
      monthday: +f.monthday || 1, due_days: +f.due_days || 0, next_date: f.next_date, end_date: f.end_date || null, items: itemsBody(items) };
    try { f.id ? await api.put(`/invoice-schedules/${f.id}`, body) : await api.post('/invoice-schedules', body); toast('Расписание сохранено'); onSaved(); onClose(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => { await api.del(`/invoice-schedules/${f.id}`); toast('Удалено. Выставленные счета остались'); onSaved(); onClose(); };
  return (
    <Modal open onClose={onClose} title="Повторяющийся счёт" width={980}
      footer={<>{f.id && <div className="mr-auto"><ConfirmButton onConfirm={remove} /></div>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <Field label="Клиент" className="col-span-2"><Select value={f.client_id} onChange={set('client_id')} placeholder="Выберите клиента" search options={nameOptions(clients)} /></Field>
          <Field label="От компании" className="col-span-2"><Select value={f.company_id} onChange={set('company_id')} placeholder="—" options={companies.map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Назначение" className="col-span-2"><input className="input" value={f.title || ''} onChange={set('title')} placeholder="Абонентское обслуживание" /></Field>
          <Field label="Число месяца"><input type="number" min="1" max="31" className="input" value={f.monthday} onChange={set('monthday')} /></Field>
          <Field label="Раз в N месяцев"><input type="number" min="1" max="12" className="input" value={f.every} onChange={set('every')} /></Field>
          <Field label="Начать с"><input type="date" className="input" value={f.next_date || ''} onChange={set('next_date')} /></Field>
          <Field label="Срок оплаты, дней"><input type="number" min="0" className="input" value={f.due_days} onChange={set('due_days')} /></Field>
          <Field label="Закончить" hint="Пусто — бессрочно"><input type="date" className="input" value={f.end_date || ''} onChange={set('end_date')} /></Field>
        </div>
        <ItemsEditor items={items} setItems={setItems} vatMode={f.vat_mode} setVatMode={set('vat_mode')} defVat={companies.find((c) => String(c.id) === String(f.company_id))?.vat_rate || '22'} catalog={catalog} />
      </div>
    </Modal>
  );
}
