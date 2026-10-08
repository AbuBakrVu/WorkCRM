import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Field, cx } from './ui';

// Блок реквизитов организации — общий для «Моих компаний» и клиентов
export function RequisitesFields({ f, set, open: initOpen = true, title = 'Реквизиты', extra }) {
  const [open, setOpen] = useState(initOpen);
  const inp = (k, props = {}) => <input className="input" value={f[k] || ''} onChange={set(k)} {...props} />;
  return (
    <div className="col-span-2 rounded-2xl border border-line">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 h-11 text-[13.5px] font-semibold">
        {title}<ChevronDown size={16} className={cx('text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-3.5 px-4 pb-4">
          <Field label="Полное наименование" className="col-span-2">{inp('full_name', { placeholder: 'Общество с ограниченной ответственностью «…»' })}</Field>
          <Field label="ИНН">{inp('inn', { inputMode: 'numeric', maxLength: 12 })}</Field>
          <Field label="КПП">{inp('kpp', { inputMode: 'numeric', maxLength: 9 })}</Field>
          <Field label="ОГРН / ОГРНИП">{inp('ogrn', { inputMode: 'numeric', maxLength: 15 })}</Field>
          <Field label="Руководитель (ФИО)">{inp('director_name')}</Field>
          <Field label="Должность руководителя">{inp('director_title', { placeholder: 'Генеральный директор' })}</Field>
          {extra}
          <Field label="Юридический адрес" className="col-span-2">{inp('address')}</Field>
          <Field label="Банк" className="col-span-2">{inp('bank_name', { placeholder: 'ПАО Сбербанк' })}</Field>
          <Field label="БИК">{inp('bik', { inputMode: 'numeric', maxLength: 9 })}</Field>
          <Field label="Корр. счёт">{inp('corr_account', { inputMode: 'numeric', maxLength: 20 })}</Field>
          <Field label="Расчётный счёт" className="col-span-2">{inp('account', { inputMode: 'numeric', maxLength: 20 })}</Field>
        </div>
      )}
    </div>
  );
}
