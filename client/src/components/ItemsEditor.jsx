import { useRef, useState } from 'react';
import { Plus, Trash2, GripVertical, Package } from 'lucide-react';
import { VAT_RATES, VAT_MODE, UNITS } from '../lib/constants';
import { fmtRub } from '../lib/format';
import { Button, Select, Segmented, Popover, SearchList, FloatingPanel, cx } from './ui';

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

// Проверка позиций перед сохранением: текст ошибки или null
export function badItem(items) {
  const i = items.findIndex((it) => !it.name?.trim() || !(Number(it.qty) > 0) || !(Number(it.price) >= 0) || it.price === '');
  return i >= 0 ? `Позиция ${i + 1}: заполните наименование, количество и цену` : null;
}
export const itemsBody = (items) => items.map(({ name, unit, qty, price, vat_rate }) => ({ name: name.trim(), unit, qty: +qty, price: +price, vat_rate }));
export const itemsFromServer = (list = []) => list.map(({ id, name, unit, qty, price, vat_rate }) => ({ key: id ?? Math.random(), name, unit, qty, price, vat_rate }));

// Таблица товаров и услуг с НДС — в сделках и счетах
export function ItemsEditor({ items, setItems, vatMode, setVatMode, defVat = '22', catalog = [], title = 'Товары и услуги' }) {
  const [drag, setDrag] = useState(null);
  const calc = calcItems(items, vatMode);
  const hasItems = items.length > 0;
  const setItem = (i, k) => (v) => setItems((list) => list.map((it, j) => (j === i ? { ...it, [k]: v?.target ? v.target.value : v } : it)));
  const addItem = () => setItems((list) => [...list, { key: Math.random(), name: '', unit: 'шт', qty: 1, price: '', vat_rate: defVat }]);
  const fromCatalog = (c) => ({ key: Math.random(), name: c.name, unit: c.unit, qty: 1, price: c.price, vat_rate: c.vat_rate || defVat });
  const pickInto = (i, c) => setItems((list) => list.map((it, j) => (j === i ? { ...fromCatalog(c), key: it.key, qty: it.qty || 1 } : it)));
  const delItem = (i) => setItems((list) => list.filter((_, j) => j !== i));
  const moveItem = (from, to) => setItems((list) => { const l = [...list]; const [x] = l.splice(from, 1); l.splice(to, 0, x); return l; });
  return (
    <>
          {/* Позиции */}
          <div className="rounded-2xl border border-line">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
              <h3 className="text-[14px] font-semibold flex-1">{title} {hasItems && <span className="text-ink-3 font-normal">{items.length}</span>}</h3>
              <Segmented size="sm" value={vatMode} onChange={setVatMode} items={Object.entries(VAT_MODE).map(([value, label]) => ({ value, label }))} />
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
                        <td className="px-2 py-2"><NameCell value={it.name} onChange={setItem(i, 'name')} catalog={catalog} onPick={(c) => pickInto(i, c)} /></td>
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
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={Plus} onClick={addItem}>Добавить позицию</Button>
                {catalog.length > 0 && (
                  <Popover width={380} trigger={({ toggle }) => <Button size="sm" icon={Package} onClick={toggle}>Из каталога</Button>}>
                    {({ close }) => <SearchList placeholder="Найти товар или услугу…" onEscape={close}
                      items={catalog.map((c) => ({ value: c.id, label: c.name, hint: `${c.price.toLocaleString('ru-RU')} ₽/${c.unit}` }))}
                      onPick={(id) => { const c = catalog.find((x) => x.id === id); if (c) setItems((l) => [...l, fromCatalog(c)]); }} />}
                  </Popover>
                )}
              </div>
              {hasItems && (
                <div className="text-[13px] tabular grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-right">
                  <span className="text-ink-3">Без НДС</span><span>{fmtRub(calc.net)}</span>
                  <span className="text-ink-3">{vatMode === 'included' ? 'В т.ч. НДС' : 'НДС'}</span><span>{calc.vat ? fmtRub(calc.vat) : 'Без НДС'}</span>
                  <span className="font-semibold text-ink">Итого</span><span className="font-semibold text-[15px] text-ink">{fmtRub(calc.total)}</span>
                </div>
              )}
            </div>
          </div>
    </>
  );
}

// Наименование позиции: при вводе подсказывает совпадения из каталога
function NameCell({ value, onChange, catalog, onPick }) {
  const ref = useRef(null);
  const [focus, setFocus] = useState(false);
  const q = (value || '').trim().toLowerCase();
  const hits = q.length >= 2 ? catalog.filter((c) => c.name.toLowerCase().includes(q) && c.name.toLowerCase() !== q).slice(0, 6) : [];
  return (
    <>
      <textarea ref={ref} rows={1} className="input !min-h-9 resize-none [field-sizing:content]" value={value} onChange={onChange} placeholder="Товар или услуга"
        onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
      <FloatingPanel open={focus && hits.length > 0} anchorRef={ref} onClose={() => setFocus(false)} minWidth={320}>
        <div className="px-2 pb-1 text-[11px] text-ink-3">Из каталога</div>
        {hits.map((c) => (
          <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(c); setFocus(false); }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-canvas text-left text-[13px]">
            <span className="flex-1 truncate">{c.name}</span><span className="text-ink-3 tabular text-[12px]">{c.price.toLocaleString('ru-RU')} ₽/{c.unit}</span>
          </button>
        ))}
      </FloatingPanel>
    </>
  );
}
