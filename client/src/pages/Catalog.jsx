import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, Package, Wrench, Pencil, Upload } from 'lucide-react';
import { ImportModal } from '../components/Import';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { VAT_RATES, UNITS } from '../lib/constants';
import { fmtRub } from '../lib/format';
import { Button, Card, Empty, Spinner, Modal, Field, Select, ConfirmButton, PageHeader, Segmented, Pill, cx } from '../components/ui';

export const KIND = { service: 'Услуга', goods: 'Товар' };

export default function Catalog() {
  const { data, reload } = useLoad('/catalog');
  const { isManager } = useApp();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [form, setForm] = useState(null);
  const [importing, setImporting] = useState(false);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data || []).filter((x) => (kind === 'all' || x.kind === kind) && (!ql || `${x.name} ${x.sku || ''}`.toLowerCase().includes(ql)));
  }, [data, q, kind]);
  if (!data) return <Spinner />;
  return (
    <div>
      <PageHeader title="Каталог" subtitle="Товары и услуги с ценами — подставляются в позиции сделки и счета"
        actions={isManager && <><Button icon={Upload} onClick={() => setImporting(true)}>Импорт</Button><Button variant="primary" icon={Plus} onClick={() => setForm({})}>Добавить</Button></>} />
      {importing && <ImportModal kind="catalog" onClose={() => setImporting(false)} onDone={reload} />}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Segmented value={kind} onChange={setKind} items={[{ value: 'all', label: 'Все', count: data.length }, { value: 'service', label: 'Услуги', count: data.filter((x) => x.kind === 'service').length }, { value: 'goods', label: 'Товары', count: data.filter((x) => x.kind === 'goods').length }]} />
        <div className={cx('flex items-center gap-1.5 h-9 px-3 rounded-full border bg-panel', q ? 'border-violet/40' : 'border-line')}>
          <Search size={15} className="text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название или артикул" className="outline-none text-[13px] w-52 bg-transparent" />
          {q && <button onClick={() => setQ('')}><X size={14} className="text-ink-3" /></button>}
        </div>
      </div>
      {list.length === 0 ? (
        <Card><Empty icon={Package} title={data.length ? 'Ничего не найдено' : 'Каталог пуст'} text={data.length ? 'Измените поиск' : 'Добавьте услуги (монтаж, настройка, абонентка) и товары с ценами'}
          action={isManager && !data.length && <Button variant="primary" icon={Plus} onClick={() => setForm({})}>Добавить позицию</Button>} /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-canvas/60 border-b border-line">
                <th className="th">Наименование</th><th className="th">Тип</th><th className="th">Артикул</th><th className="th">Ед.</th><th className="th">НДС</th><th className="th text-right">Цена</th>{isManager && <th className="th w-10" />}
              </tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id} onClick={() => isManager && setForm(x)} className={cx('border-b border-line last:border-0', isManager && 'hover:bg-canvas/50 cursor-pointer', !x.active && 'opacity-50')}>
                    <td className="td whitespace-normal"><div className="text-ink font-[450]">{x.name}</div>{x.description && <div className="text-[12px] text-ink-3 line-clamp-1">{x.description}</div>}</td>
                    <td className="td"><span className="inline-flex items-center gap-1.5">{x.kind === 'goods' ? <Package size={14} className="text-ink-3" /> : <Wrench size={14} className="text-ink-3" />}{KIND[x.kind]}</span></td>
                    <td className="td tabular">{x.sku || '—'}</td>
                    <td className="td">{x.unit}</td>
                    <td className="td">{VAT_RATES.find((v) => v.value === x.vat_rate)?.label || '—'}</td>
                    <td className="td text-right tabular font-medium text-ink">{fmtRub(x.price)}</td>
                    {isManager && <td className="td"><Pencil size={14} className="text-ink-3" /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <CatalogModal item={form} onClose={() => setForm(null)} onSaved={reload} />
    </div>
  );
}

function CatalogModal({ item, onClose, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (item) setF({ kind: 'service', unit: 'усл', vat_rate: '22', active: 1, ...item }); }, [item]);
  if (!item) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const save = async () => {
    if (!f.name?.trim()) return toast('Укажите наименование', 'error');
    const body = { kind: f.kind, name: f.name.trim(), sku: f.sku || null, unit: f.unit || 'шт', price: +f.price || 0, vat_rate: f.vat_rate, description: f.description || null, active: !!f.active };
    try { f.id ? await api.put(`/catalog/${f.id}`, body) : await api.post('/catalog', body); toast('Сохранено'); onSaved(); onClose(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => { await api.del(`/catalog/${f.id}`); toast('Удалено'); onSaved(); onClose(); };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Позиция каталога' : 'Новая позиция'} width={560}
      footer={<>{f.id && <div className="mr-auto"><ConfirmButton onConfirm={remove} /></div>}<Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="grid grid-cols-2 gap-3.5" onKeyDown={(e) => e.key === 'Enter' && e.target.tagName === 'INPUT' && save()}>
        <Field label="Тип" className="col-span-2"><Segmented value={f.kind} onChange={(v) => setF((x) => ({ ...x, kind: v, unit: v === 'goods' ? 'шт' : x.unit === 'шт' ? 'усл' : x.unit }))} items={Object.entries(KIND).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Наименование" className="col-span-2" hint="Так строка будет выглядеть в КП и счёте"><input className="input" value={f.name || ''} onChange={set('name')} autoFocus /></Field>
        <Field label="Цена, ₽"><input type="number" min="0" step="0.01" className="input" value={f.price ?? ''} onChange={set('price')} /></Field>
        <Field label="НДС"><Select value={f.vat_rate} onChange={set('vat_rate')} options={VAT_RATES} /></Field>
        <Field label="Ед. изм."><input className="input" list="crm-units-c" value={f.unit || ''} onChange={set('unit')} /><datalist id="crm-units-c">{UNITS.map((u) => <option key={u} value={u} />)}</datalist></Field>
        <Field label="Артикул"><input className="input" value={f.sku || ''} onChange={set('sku')} /></Field>
        <Field label="Описание" className="col-span-2"><textarea className="input" rows={2} value={f.description || ''} onChange={set('description')} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={!!f.active} onChange={set('active')} className="accent-[var(--color-brand)] size-4" />Показывать при выборе в сделке</label>
      </div>
    </Modal>
  );
}
