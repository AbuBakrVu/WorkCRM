import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle2, Handshake, Repeat, User, Users } from 'lucide-react';
import { useApp, useLoad, useStored } from '../lib/store';
import { api } from '../lib/api';
import { TASK_STATUS} from '../lib/constants';
import { todayStr, toDateStr, fmtDate } from '../lib/format';
import { taskPerms } from '../lib/perms';
import { PageHeader, Segmented, Spinner, Card, cx } from '../components/ui';
import { TaskDrawer } from '../components/Tasks';
import { DealModal } from '../components/DealModal';
import { nextDate } from '../lib/recurrence';

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export default function Calendar({ embedded = false }) {
  const { user, toast, bump } = useApp();
  const { data: tasks, setData: setTasks } = useLoad('/tasks');
  const { data: deals } = useLoad('/deals');
  const { data: recs } = useLoad('/recurrences');
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [who, setWho] = useStored('crm.cal.who', 'me');
  const [kinds, setKinds] = useStored('crm.cal.kinds', ['task', 'deal', 'rec']);
  const [taskId, setTaskId] = useState(null);
  const [deal, setDeal] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const today = todayStr();

  // Сетка: с понедельника недели, где 1-е число, 6 недель
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const from = toDateStr(days[0]), to = toDateStr(days[41]);

  const events = useMemo(() => {
    const m = {};
    const push = (date, e) => { if (date >= from && date <= to) (m[date] ??= []).push(e); };
    const mine = (t) => who === 'all' || t.assignee_id === user.id || (t.coassignee_ids || []).includes(user.id) || t.created_by === user.id;
    if (kinds.includes('task')) for (const t of tasks || []) if (t.due_date && mine(t)) push(t.due_date, { kind: 'task', id: t.id, title: t.title, t, late: t.status !== 'done' && t.due_date < today });
    if (kinds.includes('deal')) for (const d of deals || []) if (d.expected_close && !['won', 'lost'].includes(d.stage) && (who === 'all' || d.owner_id === user.id)) push(d.expected_close, { kind: 'deal', id: d.id, title: d.title, d });
    // Будущие запуски повторяющихся задач (до конца видимого периода)
    if (kinds.includes('rec')) for (const r of recs || []) {
      if (!r.active || (who !== 'all' && r.assignee_id !== user.id && r.created_by !== user.id)) continue;
      let dt = r.next_date;
      for (let n = 0; dt <= to && n < 60; n++) {
        if (r.end_date && dt > r.end_date) break;
        push(dt, { kind: 'rec', id: `${r.id}-${dt}`, title: r.title, r });
        dt = nextDate(r, dt, false, r.created_at.slice(0, 10));
      }
    }
    return m;
  }, [tasks, deals, recs, kinds, who, user.id, from, to, today]);

  if (!tasks || !deals || !recs) return <Spinner />;
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const toggleKind = (k) => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));

  const moveTask = async (id, date) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.due_date === date) return;
    if (!taskPerms(user, t).edit) return toast('Срок меняет постановщик или администратор', 'error');
    setTasks((list) => list.map((x) => (x.id === id ? { ...x, due_date: date } : x)));
    try { await api.put(`/tasks/${id}`, { due_date: date }); toast(`Срок перенесён на ${fmtDate(date, true)}`); bump(); }
    catch (e) { toast(e.message, 'error'); bump(); }
  };

  return (
    <div>
      {!embedded && <PageHeader title="Календарь" subtitle="Сроки задач, плановые даты сделок и будущие повторяющиеся задачи" />}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1">
          <button className="chip !px-2.5" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
          <div className="min-w-40 text-center text-[16px] font-semibold">{MONTHS_NOM[month.getMonth()]} {month.getFullYear()}</div>
          <button className="chip !px-2.5" onClick={() => shift(1)}><ChevronRight size={16} /></button>
        </div>
        <button className="chip" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Сегодня</button>
        <Segmented value={who} onChange={setWho} items={[{ value: 'me', label: <span className="inline-flex items-center gap-1.5"><User size={13} />Мои</span> }, { value: 'all', label: <span className="inline-flex items-center gap-1.5"><Users size={13} />Все</span> }]} />
        <div className="ml-auto flex items-center gap-1.5">
          {[['task', 'Задачи', CheckCircle2], ['deal', 'Сделки', Handshake], ['rec', 'Повторяющиеся', Repeat]].map(([k, l, I]) => (
            <button key={k} onClick={() => toggleKind(k)} className={cx('chip', kinds.includes(k) && 'chip-active')}><I size={14} />{l}</button>
          ))}
        </div>
      </div>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-canvas/60">
          {DOW.map((d, i) => <div key={d} className={cx('px-3 py-2 text-[12px] font-medium', i > 4 ? 'text-ink-3' : 'text-ink-2')}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const ds = toDateStr(d);
            const list = events[ds] || [];
            const other = d.getMonth() !== month.getMonth();
            return (
              <div key={ds} onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(ds); } }} onDragLeave={() => setOver(null)}
                onDrop={() => { if (drag) moveTask(drag, ds); setDrag(null); setOver(null); }}
                className={cx('min-h-[118px] p-1.5 border-line', i % 7 !== 6 && 'border-r', i < 35 && 'border-b', other && 'bg-canvas/40', over === ds && 'bg-brand/5')}>
                <div className="flex justify-end px-1 mb-1">
                  <span className={cx('text-[12px] tabular size-6 grid place-items-center rounded-full', ds === today ? 'bg-brand text-white font-semibold' : other ? 'text-ink-3' : 'text-ink-2')}>{d.getDate()}</span>
                </div>
                <div className="space-y-1">
                  {list.slice(0, 4).map((e) => <EventChip key={`${e.kind}${e.id}`} e={e} onOpen={() => (e.kind === 'task' ? setTaskId(e.id) : e.kind === 'deal' ? setDeal(e.d) : null)}
                    onDragStart={() => e.kind === 'task' && setDrag(e.id)} onDragEnd={() => { setDrag(null); setOver(null); }} />)}
                  {list.length > 4 && <div className="text-[11px] text-ink-3 px-1.5">ещё {list.length - 4}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="flex flex-wrap gap-4 mt-3 text-[12px] text-ink-3">
        <span>Перетащите задачу на другой день, чтобы перенести срок.</span>
      </div>
      <TaskDrawer id={taskId} onClose={() => setTaskId(null)} />
      {deal && <DealModal deal={deal} onClose={() => setDeal(null)} />}
    </div>
  );
}

function EventChip({ e, onOpen, onDragStart, onDragEnd }) {
  const base = 'w-full flex items-center gap-1.5 h-6 px-1.5 rounded-md text-[11.5px] text-left truncate';
  if (e.kind === 'task') {
    const done = e.t.status === 'done';
    return (
      <button draggable={!done} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onOpen} title={e.title}
        className={cx(base, done ? 'text-ink-3 line-through bg-canvas' : e.late ? 'bg-red-50 text-red-700' : 'bg-canvas text-ink hover:bg-line/60', !done && 'cursor-grab')}>
        <span className="size-1.5 rounded-full shrink-0" style={{ background: e.late ? 'var(--color-st-stuck)' : TASK_STATUS[e.t.status].color }} />
        <span className="truncate">{e.title}</span>
      </button>
    );
  }
  if (e.kind === 'deal') return (
    <button onClick={onOpen} title={`Сделка: ${e.title}`} className={cx(base, 'bg-amber-50 text-amber-700 hover:brightness-95')}>
      <Handshake size={11} className="shrink-0" /><span className="truncate">{e.title}</span>
    </button>
  );
  return (
    <div title={`Будет создана автоматически: ${e.title}`} className={cx(base, 'border border-dashed border-line-strong text-ink-3')}>
      <Repeat size={11} className="shrink-0" /><span className="truncate">{e.title}</span>
    </div>
  );
}
