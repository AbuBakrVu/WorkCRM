import { useEffect, useState } from 'react';
import { History as HistoryIcon, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { TASK_STATUS, DEAL_STAGE, TICKET_STATUS, TICKET_PRIORITY, PROJECT_STATUS, VAT_RATES, VAT_MODE } from '../lib/constants';
import { Avatar, cx } from './ui';

const FIELDS = {
  title: 'Название', name: 'Название', description: 'Описание', status: 'Статус', stage: 'Этап', assignee_id: 'Исполнитель', owner_id: 'Ответственный',
  due_date: 'Срок', start_date: 'Начало', client_id: 'Клиент', project_id: 'Проект', company_id: 'Компания', deal_id: 'Сделка', parent_id: 'Родительская задача',
  priority: 'Приоритет', category: 'Категория', location: 'Место', requester: 'Заявитель', resolution: 'Решение', expected_close: 'Ожидаемое закрытие',
  notes: 'Заметки', probability: 'Вероятность', lost_reason: 'Причина проигрыша', lost_comment: 'Комментарий к проигрышу', vat_mode: 'НДС',
  contract_no: 'Номер договора', contract_date: 'Дата договора', number: 'Номер', date: 'Дата', cancelled: 'Отменён',
  phone: 'Телефон', email: 'Email', inn: 'ИНН', kpp: 'КПП', ogrn: 'ОГРН', address: 'Адрес', contact_name: 'Контакт', full_name: 'Полное наименование',
  bank_name: 'Банк', bik: 'БИК', account: 'Р/с', corr_account: 'К/с', director_name: 'Руководитель', director_title: 'Должность руководителя', type: 'Тип',
  hours_limit: 'Лимит часов', monthly_fee: 'Абонплата', overage_rate: 'Ставка перерасхода', active: 'Активен', budget: 'Бюджет', price: 'Цена', unit: 'Ед.',
  vat_rate: 'Ставка НДС', role: 'Роль', position: 'Должность', hourly_rate: 'Ставка в час', due_at: 'Срок реакции', manual_progress: 'Прогресс', visible: 'Видимость',
};
const VALUES = {
  status: { ...Object.fromEntries(Object.entries(TASK_STATUS).map(([k, v]) => [k, v.label])), ...Object.fromEntries(Object.entries(TICKET_STATUS).map(([k, v]) => [k, v.label])), ...Object.fromEntries(Object.entries(PROJECT_STATUS).map(([k, v]) => [k, v.label])) },
  stage: Object.fromEntries(Object.entries(DEAL_STAGE).map(([k, v]) => [k, v.label])),
  priority: Object.fromEntries(Object.entries(TICKET_PRIORITY).map(([k, v]) => [k, v.label])),
  vat_mode: VAT_MODE, vat_rate: Object.fromEntries(VAT_RATES.map((v) => [v.value, v.label])),
  cancelled: { 0: 'нет', 1: 'да' }, active: { 0: 'нет', 1: 'да' },
};
const val = (f, v) => {
  if (v == null || v === '') return '—';
  const s = VALUES[f]?.[v] ?? v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('.');
  return String(s).length > 120 ? `${String(s).slice(0, 120)}…` : s;
};

// История изменений объекта (сделка, клиент, счёт, заявка, задача…)
export function HistoryPanel({ entity, id, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [rows, setRows] = useState(null);
  useEffect(() => { if (open && id) api.get(`/history?entity=${entity}&id=${id}`).then(setRows).catch(() => setRows([])); }, [open, entity, id]);
  return (
    <div className="rounded-2xl border border-line">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-4 h-11 text-[13px] font-semibold">
        <HistoryIcon size={15} className="text-ink-3" />История изменений
        <ChevronDown size={15} className={cx('ml-auto text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-3 max-h-80 overflow-y-auto">
          {!rows ? <div className="text-[12.5px] text-ink-3 py-2">Загрузка…</div> : !rows.length ? <div className="text-[12.5px] text-ink-3 py-2">Изменений пока нет</div> : rows.map((h) => (
            <div key={h.id} className="flex gap-2.5 py-2 border-t border-line first:border-0 text-[12.5px]">
              <Avatar user={h.user_name ? { name: h.user_name, color: h.user_color } : null} size={22} ring={false} />
              <div className="min-w-0 flex-1">
                <div className="text-ink-3"><span className="text-ink font-medium">{h.user_name || 'Система'}</span> · {fmtDateTime(h.created_at)}</div>
                {h.field === '_deleted' ? <div className="text-red-600">Удалено в корзину</div> : h.field === '_restored' ? <div className="text-emerald-600">Восстановлено из корзины</div> : (
                  <div className="text-ink-2 break-words"><span className="text-ink">{FIELDS[h.field] || h.field}:</span> <span className="line-through text-ink-3">{val(h.field, h.old_value)}</span> → <span className="text-ink">{val(h.field, h.new_value)}</span></div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
