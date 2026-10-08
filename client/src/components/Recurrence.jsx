import { useEffect, useState } from 'react';
import { Repeat, Pause, Play, Pencil, Trash2, CalendarClock } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { fmtDate, todayStr, plural } from '../lib/format';
import { Button, Card, Empty, Spinner, Field, Select, Modal, UserPicker, Avatar, ConfirmButton, cx, userOptions, nameOptions } from './ui';

export const FREQ = { daily: 'Каждый день', weekly: 'Каждую неделю', monthly: 'Каждый месяц', yearly: 'Каждый год' };
const UNIT = { daily: ['день', 'дня', 'дней'], weekly: ['неделю', 'недели', 'недель'], monthly: ['месяц', 'месяца', 'месяцев'], yearly: ['год', 'года', 'лет'] };
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Человеческое описание правила: «каждые 2 недели по пн, чт»
export function ruleText(r) {
  const n = Number(r.every) || 1;
  let s = n === 1 ? FREQ[r.freq].toLowerCase() : `каждые ${n} ${plural(n, ...UNIT[r.freq])}`;
  if (r.freq === 'weekly' && r.weekdays) s += ` по ${String(r.weekdays).split(',').map((d) => DOW[d - 1]?.toLowerCase()).join(', ')}`;
  if (r.freq === 'monthly' && r.monthday) s += `, ${r.monthday}-го числа`;
  return s;
}

// Поля правила повторения — используются в форме задачи и в редактировании расписания
export function RecurrenceFields({ r, set }) {
  const days = String(r.weekdays || '').split(',').filter(Boolean).map(Number);
  const toggleDay = (d) => set('weekdays')((days.includes(d) ? days.filter((x) => x !== d) : [...days, d]).sort().join(','));
  return (
    <div className="grid grid-cols-2 gap-3.5">
      <Field label="Повторять"><Select value={r.freq} onChange={set('freq')} options={Object.entries(FREQ).map(([value, label]) => ({ value, label }))} /></Field>
      <Field label={`Каждые N (${UNIT[r.freq]?.[2] || ''})`}><input type="number" min="1" max="365" className="input" value={r.every ?? 1} onChange={set('every')} /></Field>
      {r.freq === 'weekly' && (
        <Field label="Дни недели" className="col-span-2">
          <div className="flex gap-1.5">
            {DOW.map((l, i) => (
              <button type="button" key={l} onClick={() => toggleDay(i + 1)}
                className={cx('h-9 w-11 rounded-lg border text-[13px] font-medium transition-colors', days.includes(i + 1) ? 'bg-brand text-white border-brand' : 'border-line text-ink-2 hover:bg-canvas')}>{l}</button>
            ))}
          </div>
        </Field>
      )}
      {r.freq === 'monthly' && <Field label="Число месяца" hint="Если в месяце меньше дней — в последний день"><input type="number" min="1" max="31" className="input" value={r.monthday ?? ''} onChange={set('monthday')} placeholder="1–31" /></Field>}
      <Field label="Начать с"><input type="date" className="input" value={r.next_date || ''} onChange={set('next_date')} /></Field>
      <Field label="Срок на выполнение, дней" hint="0 — сделать в день создания"><input type="number" min="0" max="365" className="input" value={r.due_days ?? 0} onChange={set('due_days')} /></Field>
      <Field label="Закончить" hint="Пусто — без окончания"><input type="date" className="input" value={r.end_date || ''} onChange={set('end_date')} /></Field>
    </div>
  );
}

export const recurrenceBody = (r) => ({
  freq: r.freq, every: +r.every || 1, weekdays: r.freq === 'weekly' ? r.weekdays || null : null,
  monthday: r.freq === 'monthly' && r.monthday ? +r.monthday : null, next_date: r.next_date || todayStr(),
  due_days: +r.due_days || 0, end_date: r.end_date || null,
});

/* ---------- Список расписаний (вкладка в «Проектах») ---------- */
export function RecurrenceList({ projectFilter }) {
  const { data, reload } = useLoad('/recurrences');
  const { toast, bump } = useApp();
  const [edit, setEdit] = useState(null);
  if (!data) return <Spinner />;
  const list = data.filter((r) => !projectFilter || r.project_id === projectFilter);
  const toggle = async (r) => { try { await api.put(`/recurrences/${r.id}`, { active: !r.active }); reload(); toast(r.active ? 'Расписание на паузе' : 'Расписание включено'); } catch (e) { toast(e.message, 'error'); } };
  const remove = async (r) => { try { await api.del(`/recurrences/${r.id}`); reload(); bump(); toast('Расписание удалено. Созданные задачи остались'); } catch (e) { toast(e.message, 'error'); } };
  if (!list.length) return <Card><Empty icon={Repeat} title="Повторяющихся задач нет" text="При создании задачи включите «Повторять» — например, ежемесячная проверка бэкапов или ИБП" /></Card>;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-canvas/60 border-b border-line">
            <th className="th">Задача</th><th className="th">Проект</th><th className="th">Как часто</th><th className="th">Исполнитель</th><th className="th">Следующая</th><th className="th text-right">Создано</th><th className="th w-28" />
          </tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className={cx('border-b border-line last:border-0', !r.active && 'opacity-55')}>
                <td className="td whitespace-normal"><div className="flex items-center gap-2 text-ink font-[450]"><Repeat size={14} className="text-brand shrink-0" />{r.title}</div></td>
                <td className="td">{r.project_name}</td>
                <td className="td">{ruleText(r)}</td>
                <td className="td"><span className="flex items-center gap-2">{r.assignee_name ? <><Avatar user={{ name: r.assignee_name, color: r.assignee_color }} size={22} ring={false} />{r.assignee_name.split(' ')[0]}</> : '—'}</span></td>
                <td className="td">{r.active ? <span className="inline-flex items-center gap-1.5"><CalendarClock size={13} className="text-ink-3" />{fmtDate(r.next_date)}</span> : 'на паузе'}</td>
                <td className="td text-right tabular">{r.tasks_count}</td>
                <td className="td">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => toggle(r)} title={r.active ? 'Поставить на паузу' : 'Включить'} className="size-8 grid place-items-center rounded-full hover:bg-canvas text-ink-2">{r.active ? <Pause size={15} /> : <Play size={15} />}</button>
                    <button onClick={() => setEdit(r)} title="Изменить" className="size-8 grid place-items-center rounded-full hover:bg-canvas text-ink-2"><Pencil size={15} /></button>
                    <ConfirmButton size="sm" variant="ghost" onConfirm={() => remove(r)}><Trash2 size={14} /></ConfirmButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RecurrenceModal rec={edit} onClose={() => setEdit(null)} onSaved={() => { reload(); bump(); }} />
    </Card>
  );
}

function RecurrenceModal({ rec, onClose, onSaved }) {
  const { users, projects, toast } = useApp();
  const [f, setF] = useState(null);
  useEffect(() => { setF(rec ? { ...rec } : null); }, [rec]);
  if (!f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const save = async () => {
    if (!f.title?.trim()) return toast('Укажите название', 'error');
    try {
      await api.put(`/recurrences/${f.id}`, { title: f.title.trim(), description: f.description, project_id: +f.project_id, assignee_id: f.assignee_id ? +f.assignee_id : null,
        coassignee_ids: f.coassignee_ids, observer_ids: f.observer_ids, checklist: f.checklist, ...recurrenceBody(f) });
      toast('Расписание сохранено'); onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="Повторяющаяся задача" width={620}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save}>Сохранить</Button></>}>
      <div className="space-y-3.5">
        <Field label="Проект"><Select value={f.project_id} onChange={set('project_id')} search options={nameOptions(projects)} /></Field>
        <Field label="Название"><input className="input" value={f.title || ''} onChange={set('title')} /></Field>
        <Field label="Описание"><textarea className="input" rows={3} value={f.description || ''} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Исполнитель"><Select value={f.assignee_id} onChange={set('assignee_id')} placeholder="Не назначен" search options={userOptions(users)} /></Field>
          <Field label="Соисполнители"><UserPicker users={users} value={f.coassignee_ids || []} onChange={set('coassignee_ids')} /></Field>
        </div>
        <Field label="Чек-лист" hint="Каждая строка — пункт, он появится в каждой новой задаче">
          <textarea className="input" rows={3} value={(f.checklist || []).join('\n')} onChange={(e) => set('checklist')(e.target.value.split('\n'))} />
        </Field>
        <div className="rounded-2xl bg-canvas/60 border border-line p-4"><RecurrenceFields r={f} set={set} /></div>
      </div>
    </Modal>
  );
}
