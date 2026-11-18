import { useEffect, useState } from 'react';
import { Clock, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { fmtHM, fmtDate, todayStr } from '../lib/format';
import { Modal, Field, Select, Button, Avatar, userOptions } from './ui';

// Затраченное время по задаче/заявке: итог, ручное добавление и список записей
// target — { task_id, project_id } или { ticket_id, project_id }
export function TimeLog({ total, target, canAdd = true }) {
  const { user, users, isManager, toast, bump, version } = useApp();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const key = target.task_id ? `task_id=${target.task_id}` : `ticket_id=${target.ticket_id}`;
  useEffect(() => { if (open) api.get(`/time?${key}`).then(setItems).catch(() => setItems([])); }, [open, key, version]);
  const remove = async (e) => {
    try { await api.del(`/time/${e.id}`); toast('Запись удалена'); bump(); } catch (err) { toast(err.message, 'error'); }
  };
  const canDel = (e) => e.user_id === user.id || isManager;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} disabled={!total}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink tabular disabled:cursor-default">
          <Clock size={14} className="text-ink-3" />{fmtHM(total)} ч
          {!!total && (open ? <ChevronDown size={14} className="text-ink-3" /> : <ChevronRight size={14} className="text-ink-3" />)}
        </button>
        {canAdd && (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-violet hover:underline">
            <Plus size={13} />Добавить время
          </button>
        )}
      </div>
      {open && !!total && (
        <div className="mt-2 space-y-1">
          {(items || []).filter((e) => e.ended_at).map((e) => (
            <div key={e.id} className="group flex items-center gap-2 text-[12.5px]">
              <Avatar user={{ name: e.user_name, color: e.user_color }} size={18} />
              <span className="text-ink-3 w-[56px] shrink-0">{fmtDate(e.started_at)}</span>
              <b className="tabular w-[44px] shrink-0">{fmtHM(e.duration_sec)}</b>
              <span className="text-ink-2 truncate flex-1">{e.description || <span className="text-ink-3">{e.user_name}</span>}</span>
              {canDel(e) && <button onClick={() => remove(e)} title="Удалить запись" className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-red-600"><Trash2 size={13} /></button>}
            </div>
          ))}
          {items && !items.length && <div className="text-[12.5px] text-ink-3">Записей нет</div>}
        </div>
      )}
      <AddTimeModal open={adding} onClose={() => setAdding(false)} target={target}
        onSaved={() => { setAdding(false); bump(); }} users={users} user={user} isManager={isManager} toast={toast} />
    </div>
  );
}

function AddTimeModal({ open, onClose, onSaved, target, users, user, isManager, toast }) {
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ date: todayStr(), hours: '', minutes: '', description: '', user_id: user.id }); }, [open, user.id]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const submit = async (e) => {
    e?.preventDefault(); e?.stopPropagation();
    const dur = Math.round((parseFloat(String(f.hours).replace(',', '.')) || 0) * 3600 + (+f.minutes || 0) * 60);
    if (dur <= 0) return toast('Укажите, сколько времени затрачено', 'error');
    // Сегодня — запись заканчивается сейчас; другой день — с 9:00 по местному времени
    const start = f.date === todayStr() ? new Date(Date.now() - dur * 1000) : new Date(`${f.date}T09:00:00`);
    setBusy(true);
    try {
      await api.post('/time', { ...target, user_id: +f.user_id, description: f.description || null, started_at: start.toISOString(), duration_sec: dur });
      toast('Время добавлено'); onSaved();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Добавить затраченное время" width={440}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit} disabled={busy}>Добавить</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        <Field label="Часы"><input type="text" inputMode="decimal" className="input" value={f.hours ?? ''} onChange={set('hours')} placeholder="0" autoFocus /></Field>
        <Field label="Минуты"><input type="number" min="0" max="59" step="5" className="input" value={f.minutes ?? ''} onChange={set('minutes')} placeholder="0" /></Field>
        <Field label="Дата"><input type="date" className="input" value={f.date || ''} max={todayStr()} onChange={set('date')} /></Field>
        {isManager
          ? <Field label="Сотрудник"><Select value={f.user_id} onChange={set('user_id')} search options={userOptions(users)} /></Field>
          : <div />}
        <Field label="Что сделано" className="col-span-2"><input className="input" value={f.description || ''} onChange={set('description')} placeholder="Необязательно" /></Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
