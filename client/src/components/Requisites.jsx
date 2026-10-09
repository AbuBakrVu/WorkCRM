import { useState } from 'react';
import { ChevronDown, Wand2, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Field, cx } from './ui';

// Заполнить реквизиты по ИНН (DaData). fill(obj) — записать сразу несколько полей
export function useInnLookup(fill) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (inn) => {
    setBusy(true);
    try {
      const d = await api.get(`/lookup/party?inn=${encodeURIComponent(inn || '')}`);
      fill(d);
      toast(d.status && d.status !== 'ACTIVE' ? `Заполнено. Внимание: статус организации — ${d.status}` : 'Реквизиты заполнены', d.status && d.status !== 'ACTIVE' ? 'error' : 'ok');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return [run, busy];
}
export function InnButton({ inn, fill }) {
  const [run, busy] = useInnLookup(fill);
  return (
    <button type="button" onClick={() => run(inn)} disabled={busy} title="Найти организацию по ИНН и заполнить реквизиты"
      className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-brand/30 text-brand text-[12.5px] font-semibold hover:bg-brand/5 disabled:opacity-60">
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}Заполнить
    </button>
  );
}

// Блок реквизитов организации — общий для «Моих компаний» и клиентов
export function RequisitesFields({ f, set, open: initOpen = true, title = 'Реквизиты', extra, withInn = true }) {
  const [open, setOpen] = useState(initOpen);
  const { toast } = useApp();
  const fill = (obj) => Object.entries(obj).forEach(([k, v]) => { if (v != null && k !== 'status' && !(k === 'name' && f.name)) set(k)(v); });
  // БИК → банк и корр. счёт
  const bankLookup = async (bik) => {
    if (String(bik || '').replace(/\D/g, '').length !== 9 || (f.bank_name && f.corr_account)) return;
    try { fill(await api.get(`/lookup/bank?bik=${bik}`)); } catch (e) { if (!/не настроено/.test(e.message)) toast(e.message, 'error'); }
  };
  const inp = (k, props = {}) => <input className="input" value={f[k] || ''} onChange={set(k)} {...props} />;
  return (
    <div className="col-span-2 rounded-2xl border border-line">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 h-11 text-[13.5px] font-semibold">
        {title}<ChevronDown size={16} className={cx('text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-3.5 px-4 pb-4">
          <Field label="Полное наименование" className="col-span-2">{inp('full_name', { placeholder: 'Общество с ограниченной ответственностью «…»' })}</Field>
          {withInn && <Field label="ИНН"><div className="flex gap-2">{inp('inn', { inputMode: 'numeric', maxLength: 12 })}<InnButton inn={f.inn} fill={fill} /></div></Field>}
          <Field label="КПП">{inp('kpp', { inputMode: 'numeric', maxLength: 9 })}</Field>
          <Field label="ОГРН / ОГРНИП">{inp('ogrn', { inputMode: 'numeric', maxLength: 15 })}</Field>
          <Field label="Руководитель (ФИО)">{inp('director_name')}</Field>
          <Field label="Должность руководителя">{inp('director_title', { placeholder: 'Генеральный директор' })}</Field>
          {extra}
          <Field label="Юридический адрес" className="col-span-2">{inp('address')}</Field>
          <Field label="Банк" className="col-span-2">{inp('bank_name', { placeholder: 'ПАО Сбербанк' })}</Field>
          <Field label="БИК" hint="Банк и корр. счёт подставятся сами">{inp('bik', { inputMode: 'numeric', maxLength: 9, onBlur: (e) => bankLookup(e.target.value) })}</Field>
          <Field label="Корр. счёт">{inp('corr_account', { inputMode: 'numeric', maxLength: 20 })}</Field>
          <Field label="Расчётный счёт">{inp('account', { inputMode: 'numeric', maxLength: 20 })}</Field>
          <Field label="ID участника ЭДО" hint="Для УПД: 2BM-…, 2AE-… — есть в Диадоке/СБИС">{inp('edo_id', { placeholder: '2BM-…' })}</Field>
        </div>
      )}
    </div>
  );
}
