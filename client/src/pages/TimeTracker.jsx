import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Trash2, Download, Timer } from 'lucide-react';
import { useApp, useLoad, useNow } from '../lib/store';
import { api } from '../lib/api';
import { fmtHM, fmtTime, fmtDate, toDateStr, parseDate, fmtHours } from '../lib/format';
import { Button, Card, Modal, Field, Select, Avatar, Popover, Empty, PageHeader, Stat, cx, userOptions, nameOptions, SearchList } from '../components/ui';
import { TimerStartModal } from '../components/TimerStart';
import { TimerCard } from '../components/TimerCard';

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

export default function TimeTracker({ embedded = false, openAdd = false, onAddOpened }) {
  const { user, users, isManager, toast, bump } = useApp();
  const [params, setParams] = useSearchParams();
  const [week, setWeek] = useState(() => monday(new Date()));
  const [who, setWho] = useState(isManager ? null : user.id);
  const [addOpen, setAddOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const now = useNow();

  useEffect(() => { if (!embedded && params.get('new')) { setAddOpen(true); setParams({}, { replace: true }); } }, [params, setParams, embedded]);
  useEffect(() => { if (openAdd) { setAddOpen(true); onAddOpened?.(); } }, [openAdd, onAddOpened]);

  const from = toDateStr(week);
  const { data } = useLoad(`/time?from=${encodeURIComponent(week.toISOString())}&to=${encodeURIComponent(new Date(week.getTime() + 7 * 864e5).toISOString())}${who ? `&user_id=${who}` : ''}`);
  const entries = data || [];
  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * 864e5));

  // Табель: строки — проект/заявка, колонки — дни недели
  const sheet = useMemo(() => {
    const rows = {};
    for (const e of entries) {
      const key = e.project_id ? `p${e.project_id}` : e.ticket_id ? `t${e.ticket_id}` : 'none';
      const label = e.project_name || (e.ticket_id ? `#${e.ticket_id} ${e.ticket_title}` : 'Без проекта');
      rows[key] ??= { key, label, kind: e.project_id ? 'Проект' : e.ticket_id ? 'Заявка' : '', days: Array(7).fill(0), total: 0 };
      const di = Math.floor((parseDate(e.started_at) - week) / 864e5);
      if (di >= 0 && di < 7) { rows[key].days[di] += e.live_sec; rows[key].total += e.live_sec; }
    }
    return Object.values(rows).sort((a, b) => b.total - a.total);
  }, [entries, week]);
  const dayTotals = days.map((_, i) => sheet.reduce((a, r) => a + r.days[i], 0));
  const total = dayTotals.reduce((a, b) => a + b, 0);

  const byDay = useMemo(() => {
    const m = {};
    for (const e of entries) { const k = toDateStr(parseDate(e.started_at)); (m[k] ??= []).push(e); }
    return Object.entries(m).sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  const del = async (id) => { try { await api.del(`/time/${id}`); bump(); } catch (e) { toast(e.message, 'error'); } };

  const exportCsv = () => {
    const rows = [['Дата', 'Сотрудник', 'Проект', 'Задача/заявка', 'Описание', 'Начало', 'Часы']];
    entries.forEach((e) => rows.push([toDateStr(parseDate(e.started_at)), e.user_name, e.project_name || '', e.task_title || (e.ticket_id ? `#${e.ticket_id} ${e.ticket_title}` : ''),
      e.description || '', fmtTime(e.started_at), (e.live_sec / 3600).toFixed(2).replace('.', ',')]));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `time-${from}.csv`; a.click();
  };

  const isThisWeek = +week === +monday(new Date());
  const whoUser = users.find((u) => u.id === who);

  return (
    <div>
      {embedded ? (
        <div className="flex justify-end gap-2 mb-3">
          <Button icon={Download} onClick={exportCsv}>CSV</Button>
          <Button icon={Plus} onClick={() => setAddOpen(true)}>Добавить время вручную</Button>
        </div>
      ) : (
        <PageHeader title="Учёт времени" subtitle="Таймер, табель по неделям и ручное добавление часов"
          actions={<>
            <Button icon={Download} onClick={exportCsv}>CSV</Button>
            <Button icon={Plus} onClick={() => setAddOpen(true)}>Добавить вручную</Button>
          </>} />
      )}

      {/* Блок таймера */}
      <div className="grid lg:grid-cols-3 gap-3 mb-5 stagger">
        <TimerCard />
        <div className="lg:col-span-2 grid grid-cols-2 gap-3">
          <Stat featured label="За эту неделю" value={fmtHours(total)} sub={`${sheet.length} ${sheet.length === 1 ? 'проект/заявка' : 'проектов и заявок'}`} />
          <Stat label="Сегодня" value={fmtHours(dayTotals[(new Date().getDay() + 6) % 7] || 0)} sub={isThisWeek ? 'по табелю текущей недели' : 'выбрана другая неделя'} />
        </div>
      </div>

      {/* Навигация */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex items-center gap-1">
          <button className="chip !px-2.5" onClick={() => setWeek(new Date(week.getTime() - 7 * 864e5))}><ChevronLeft size={16} /></button>
          <div className="px-3 text-[13.5px] font-medium min-w-[170px] text-center">{fmtDate(days[0])} — {fmtDate(days[6])}</div>
          <button className="chip !px-2.5" onClick={() => setWeek(new Date(week.getTime() + 7 * 864e5))}><ChevronRight size={16} /></button>
        </div>
        {!isThisWeek && <button className="chip" onClick={() => setWeek(monday(new Date()))}>Текущая неделя</button>}
        {isManager && (
          <Popover width={240} trigger={({ toggle }) => (
            <button className={cx('chip', who && 'chip-active')} onClick={toggle}>{whoUser ? <><Avatar user={whoUser} size={18} ring={false} />{whoUser.name}</> : 'Вся команда'}</button>
          )}>
            {({ close }) => (<>
              <SearchList value={who} placeholder="Поиск сотрудника…" onEscape={close}
                items={[{ value: null, label: 'Вся команда', muted: true }, ...userOptions(users, { all: true })]} onPick={(v) => { setWho(v); close(); }} />
            </>)}
          </Popover>
        )}
        <div className="ml-auto text-[13px] text-ink-2">Итого за неделю: <b className="text-ink tabular">{fmtHM(total)} ч</b></div>
      </div>

      {/* Табель */}
      <Card className="overflow-x-auto mb-5">
        <table className="w-full">
          <thead><tr className="border-b border-line bg-canvas/60">
            <th className="th min-w-[240px]">Проект / заявка</th>
            {days.map((d, i) => (
              <th key={i} className={cx('th text-right w-[84px]', toDateStr(d) === toDateStr(new Date()) && 'text-violet')}>
                {WD[i]} <span className="font-normal text-ink-3">{d.getDate()}</span>
              </th>
            ))}
            <th className="th text-right w-[90px]">Итого</th>
          </tr></thead>
          <tbody>
            {sheet.map((r) => (
              <tr key={r.key} className="border-b border-line hover:bg-canvas/40">
                <td className="td"><span className="text-ink">{r.label}</span>{r.kind && <span className="text-[11px] text-ink-3 ml-2">{r.kind}</span>}</td>
                {r.days.map((s, i) => <td key={i} className={cx('td text-right tabular', i > 4 && 'bg-canvas/50')}>{s ? fmtHM(s) : <span className="text-line-strong">·</span>}</td>)}
                <td className="td text-right tabular font-semibold text-ink">{fmtHM(r.total)}</td>
              </tr>
            ))}
            {!sheet.length && <tr><td colSpan={9} className="td text-center py-10 text-ink-3">За эту неделю записей нет</td></tr>}
          </tbody>
          {sheet.length > 0 && (
            <tfoot><tr className="bg-canvas/60">
              <td className="td font-medium text-ink">Всего</td>
              {dayTotals.map((s, i) => <td key={i} className="td text-right tabular font-medium text-ink">{s ? fmtHM(s) : '—'}</td>)}
              <td className="td text-right tabular font-semibold text-ink">{fmtHM(total)}</td>
            </tr></tfoot>
          )}
        </table>
      </Card>

      {/* Записи */}
      <h2 className="text-[15px] font-semibold mb-2.5">Записи</h2>
      {byDay.length === 0 ? <Card><Empty icon={Timer} title="Записей нет" text="Запустите таймер или добавьте время вручную" /></Card> : (
        <div className="space-y-3">
          {byDay.map(([day, list]) => (
            <Card key={day}>
              <div className="flex justify-between px-4 py-2.5 border-b border-line text-[12.5px]">
                <span className="font-medium">{WD[(parseDate(day).getDay() + 6) % 7]}, {fmtDate(day)}</span>
                <span className="text-ink-2 tabular">{fmtHours(list.reduce((a, e) => a + e.live_sec, 0))}</span>
              </div>
              {list.map((e) => (
                <div key={e.id} className="group flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-0">
                  {!who && <Avatar user={{ name: e.user_name, color: e.user_color }} size={24} ring={false} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] truncate">{e.description || <span className="text-ink-3">Без описания</span>}</div>
                    <div className="text-[11.5px] text-ink-3 truncate">{e.project_name || (e.ticket_id ? `Заявка #${e.ticket_id} ${e.ticket_title}` : 'Без проекта')}{e.task_title ? ` · ${e.task_title}` : ''}{!who ? ` · ${e.user_name}` : ''}</div>
                  </div>
                  <span className="text-[12px] text-ink-3 tabular hidden sm:block">{fmtTime(e.started_at)}–{e.ended_at ? fmtTime(e.ended_at) : 'сейчас'}</span>
                  <span className={cx('w-14 text-right tabular text-[13px] font-medium', !e.ended_at && 'text-violet')}>{fmtHM(e.ended_at ? e.live_sec : (now - new Date(e.started_at)) / 1000)}</span>
                  {(e.user_id === user.id || isManager) && e.ended_at && (
                    <button onClick={() => del(e.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-ink-3 hover:text-red-600" title="Удалить"><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}

      <ManualTimeModal open={addOpen} onClose={() => setAddOpen(false)} />
      <TimerStartModal open={startOpen} onClose={() => setStartOpen(false)} />
    </div>
  );
}

function ManualTimeModal({ open, onClose }) {
  const { user, users, projects, isManager, toast, bump } = useApp();
  const [f, setF] = useState({});
  const [tasks, setTasks] = useState([]);
  useEffect(() => { if (open) setF({ date: toDateStr(new Date()), start: '09:00', hours: '1', minutes: '0', user_id: user.id }); }, [open, user.id]);
  useEffect(() => { if (f.project_id) api.get(`/tasks?project_id=${f.project_id}`).then(setTasks); else setTasks([]); }, [f.project_id]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    const dur = (+f.hours || 0) * 3600 + (+f.minutes || 0) * 60;
    if (dur <= 0) return toast('Укажите длительность', 'error');
    try {
      await api.post('/time', { user_id: +f.user_id, project_id: f.project_id ? +f.project_id : null, task_id: f.task_id ? +f.task_id : null,
        description: f.description, started_at: new Date(`${f.date}T${f.start}:00`).toISOString(), duration_sec: dur });
      toast('Время добавлено'); bump(); onClose();
    } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Добавить время" width={520}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit}>Добавить</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        {isManager && <Field label="Сотрудник" className="col-span-2"><Select value={f.user_id} onChange={set('user_id')} search options={userOptions(users)} /></Field>}
        <Field label="Проект"><Select value={f.project_id} onChange={(v) => setF((x) => ({ ...x, project_id: v, task_id: null }))} placeholder="Без проекта" search options={nameOptions(projects)} /></Field>
        <Field label="Задача"><Select value={f.task_id} onChange={set('task_id')} placeholder="—" disabled={!f.project_id} search options={tasks.map((t) => ({ value: t.id, label: t.title }))} /></Field>
        <Field label="Дата"><input type="date" className="input" value={f.date || ''} onChange={(e) => set('date')(e.target.value)} /></Field>
        <Field label="Начало"><input type="time" className="input" value={f.start || ''} onChange={(e) => set('start')(e.target.value)} /></Field>
        <Field label="Часы"><input type="number" min="0" max="24" className="input" value={f.hours} onChange={(e) => set('hours')(e.target.value)} /></Field>
        <Field label="Минуты"><input type="number" min="0" max="59" step="5" className="input" value={f.minutes} onChange={(e) => set('minutes')(e.target.value)} /></Field>
        <Field label="Описание" className="col-span-2"><input className="input" value={f.description || ''} onChange={(e) => set('description')(e.target.value)} placeholder="Что было сделано" /></Field>
      </form>
    </Modal>
  );
}
