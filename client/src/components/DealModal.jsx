import { useEffect, useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { DEAL_STAGE, VAT_RATES, VAT_MODE, UNITS } from '../lib/constants';
import { fmtRub } from '../lib/format';
import { Button, Modal, Field, Select, ConfirmButton, Segmented, Spinner, cx, userOptions, nameOptions } from './ui';

// Расчёт как на сервере: НДС сверху (above) или в т.ч. (included), округление построчно
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export function calcItems(items, mode = 'above') {
  let net = 0, vat = 0, total = 0;
  const rows = items.map((it) => {
    const rate = it.vat_rate && it.vat_rate !== 'none' ? Number(it.vat_rate) : 0;
    const base = r2((Number(it.qty) || 0) * (Number(it.price) || 0));
    let v, t, n;
    if (mode === 'included') { t = base; v = r2((base * rate) / (100 + rate)); n = r2(base - v); }
    else { n = base; v = r2((base * rate) / 100); t = r2(base + v); }
    net += n; vat += v; total += t;
    return { ...it, net: n, vat: v, total: t };
  });
  return { rows, net: r2(net), vat: r2(vat), total: r2(total) };
}

export function DealModal({ deal, onClose }) {
  const { users, clients, toast, bump, isManager } = useApp();
  const [companies, setCompanies] = useState([]);
  const [f, setF] = useState(null);
  const [items, setItems] = useState([]);
  const [drag, setDrag] = useState(null);

  useEffect(() => {
    if (!deal) { setF(null); return; }
    api.get('/companies').then(setCompanies).catch(() => {});
    if (deal.id) {
      setF(null);
      api.get(`/deals/${deal.id}`).then((d) => { setF(d); setItems(d.items.map(({ id, name, unit, qty, price, vat_rate }) => ({ key: id, name, unit, qty, price, vat_rate }))); })
        .catch((e) => toast(e.message, 'error'));
    } else { setF({ stage: 'lead', vat_mode: 'above', ...deal }); setItems([]); }
  }, [deal, toast]);
  // Новая сделка — компания по умолчанию
  useEffect(() => { if (f && !f.id && !f.company_id && companies.length) setF((x) => ({ ...x, company_id: String(companies[0].id) })); }, [companies, f]);

  if (!deal) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const company = companies.find((c) => String(c.id) === String(f?.company_id));
  const defVat = company?.vat_rate || '22';
  const calc = calcItems(items, f?.vat_mode);
  const hasItems = items.length > 0;

  const setItem = (i, k) => (v) => setItems((list) => list.map((it, j) => (j === i ? { ...it, [k]: v?.target ? v.target.value : v } : it)));
  const addItem = () => setItems((list) => [...list, { key: Math.random(), name: '', unit: 'шт', qty: 1, price: '', vat_rate: defVat }]);
  const delItem = (i) => setItems((list) => list.filter((_, j) => j !== i));
  const moveItem = (from, to) => setItems((list) => { const l = [...list]; const [x] = l.splice(from, 1); l.splice(to, 0, x); return l; });

  const submit = async () => {
    if (!f.title?.trim()) return toast('Укажите название сделки', 'error');
    const bad = items.findIndex((it) => !it.name?.trim() || !(Number(it.qty) > 0) || !(Number(it.price) >= 0) || it.price === '');
    if (bad >= 0) return toast(`Позиция ${bad + 1}: заполните наименование, количество и цену`, 'error');
    const body = {
      title: f.title, client_id: f.client_id ? +f.client_id : null, stage: f.stage, owner_id: f.owner_id ? +f.owner_id : null,
      expected_close: f.expected_close || null, notes: f.notes || null, company_id: f.company_id ? +f.company_id : null,
      vat_mode: f.vat_mode, contract_no: f.contract_no || null, contract_date: f.contract_date || null,
      items: items.map(({ name, unit, qty, price, vat_rate }) => ({ name: name.trim(), unit, qty: +qty, price: +price, vat_rate })),
      ...(hasItems ? {} : { amount: +f.amount || 0 }),
    };
    try { f.id ? await api.put(`/deals/${f.id}`, body) : await api.post('/deals', body); toast('Сделка сохранена'); bump(); onClose(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const remove = async () => { await api.del(`/deals/${f.id}`); toast('Сделка удалена'); bump(); onClose(); };

  return (
    <Modal open onClose={onClose} title={f?.id ? 'Сделка' : 'Новая сделка'} width={980}
      footer={f && <>{f.id && isManager && <div className="mr-auto"><ConfirmButton onConfirm={remove} /></div>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Сохранить</Button></>}>
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
            {!hasItems && <Field label="Сумма, ₽" hint="Или добавьте позиции — сумма посчитается сама"><input type="number" min="0" className="input" value={f.amount || ''} onChange={set('amount')} /></Field>}
          </div>

          {/* Позиции */}
          <div className="rounded-2xl border border-line">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
              <h3 className="text-[14px] font-semibold flex-1">Товары и услуги {hasItems && <span className="text-ink-3 font-normal">{items.length}</span>}</h3>
              <Segmented size="sm" value={f.vat_mode} onChange={set('vat_mode')} items={Object.entries(VAT_MODE).map(([value, label]) => ({ value, label }))} />
            </div>
            {hasItems && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead><tr className="text-[12px] text-ink-3">
                    <th className="w-8" /><th className="text-left font-medium px-2 py-2">Наименование</th>
                    <th className="text-right font-medium px-2 w-20">Кол-во</th><th className="text-left font-medium px-2 w-24">Ед.</th>
                    <th className="text-right font-medium px-2 w-32">Цена, ₽</th><th className="text-left font-medium px-2 w-28">НДС</th>
                    <th className="text-right font-medium px-2 w-32">Сумма</th><th className="w-9" />
                  </tr></thead>
                  <tbody>
                    {calc.rows.map((it, i) => (
                      <tr key={it.key} className={cx('border-t border-line align-top', drag === i && 'opacity-40')}
                        onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { moveItem(drag, i); setDrag(i); } }}>
                        <td className="pl-2 pt-3.5 text-ink-3 cursor-grab" draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} title="Перетащите, чтобы изменить порядок">
                          <span className="flex items-center text-[11px] tabular"><GripVertical size={13} />{i + 1}</span>
                        </td>
                        <td className="px-2 py-2"><textarea rows={1} className="input !min-h-9 resize-y" value={it.name} onChange={setItem(i, 'name')} placeholder="Товар или услуга" /></td>
                        <td className="px-2 py-2"><input type="number" min="0" step="any" className="input text-right tabular" value={it.qty} onChange={setItem(i, 'qty')} /></td>
                        <td className="px-2 py-2"><input className="input" list="crm-units" value={it.unit} onChange={setItem(i, 'unit')} /></td>
                        <td className="px-2 py-2"><input type="number" min="0" step="0.01" className="input text-right tabular" value={it.price} onChange={setItem(i, 'price')} placeholder="0,00" /></td>
                        <td className="px-2 py-2"><Select value={it.vat_rate} onChange={setItem(i, 'vat_rate')} options={VAT_RATES} search={false} /></td>
                        <td className="px-2 pt-4 text-right text-[13px] font-medium tabular whitespace-nowrap">{fmtRub(it.total)}</td>
                        <td className="pr-2 pt-2"><button type="button" onClick={() => delItem(i)} className="size-9 grid place-items-center rounded-lg text-ink-3 hover:text-red-600 hover:bg-red-50" title="Удалить позицию"><Trash2 size={15} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="crm-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
              </div>
            )}
            <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-3 border-t border-line first:border-t-0">
              <Button size="sm" icon={Plus} onClick={addItem}>Добавить позицию</Button>
              {hasItems && (
                <div className="text-[13px] tabular grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-right">
                  <span className="text-ink-3">Без НДС</span><span>{fmtRub(calc.net)}</span>
                  <span className="text-ink-3">{f.vat_mode === 'included' ? 'В т.ч. НДС' : 'НДС'}</span><span>{calc.vat ? fmtRub(calc.vat) : 'Без НДС'}</span>
                  <span className="font-semibold text-ink">Итого</span><span className="font-semibold text-[15px] text-ink">{fmtRub(calc.total)}</span>
                </div>
              )}
            </div>
          </div>

          <Field label="Заметки"><textarea className="input" rows={3} value={f.notes || ''} onChange={set('notes')} /></Field>
        </div>
      )}
    </Modal>
  );
}
