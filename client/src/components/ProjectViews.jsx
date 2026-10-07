import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Calendar, Flag, MessageSquare } from 'lucide-react';
import { useApp, useLoad } from '../lib/store';
import { api } from '../lib/api';
import { PROJECT_STATUS, TASK_STATUS } from '../lib/constants';
import { fmtDate, fmtHM, fmtHours, parseDate, MONTHS, toDateStr } from '../lib/format';
import { AvatarStack, Progress, StatusDot, Card, Avatar, cx } from './ui';

/* ---------------- Канбан задач ---------------- */
// Цвет метки проекта — стабильный по названию
const TAG_COLORS = [['#1e6a45', '#e3f2e8'], ['#2f5fb3', '#e4ecfa'], ['#b4561b', '#fbeadd'], ['#8a3fb0', '#f2e6f8'], ['#0f7d84', '#dff3f3'], ['#a63a4f', '#f8e4e8']];
const tagColor = (name = '') => TAG_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length];
function dueLabel(d, today) {
  if (!d) return null;
  const days = Math.round((new Date(d) - new Date(today)) / 864e5);
  if (days < 0) return { text: `просрочено ${-days} дн`, late: true };
  if (days === 0) return { text: 'сегодня', soon: true };
  if (days === 1) return { text: 'завтра', soon: true };
  return { text: `через ${days} дн`, soon: days <= 3 };
}

export function TaskKanban({ tasks, userMap, onOpen, onPatch }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const today = toDateStr(new Date());
  return (
    <div className="flex gap-3 overflow-x-auto pb-3 stagger">
      {Object.entries(TASK_STATUS).map(([status, s]) => {
        const items = tasks.filter((t) => t.status === status);
        return (
          <div key={status}
            onDragOver={(e) => { e.preventDefault(); setOver(status); }}
            onDragLeave={() => setOver(null)}
            onDrop={() => { if (dragId) onPatch(dragId, { status }); setDragId(null); setOver(null); }}
            className={cx('w-[320px] shrink-0 rounded-[22px] border p-2.5 transition-colors duration-300', over === status ? 'bg-brand/[.06] border-brand/40' : 'bg-panel/60 border-line')}>
            <div className="flex items-center justify-between px-2 pt-1 pb-3">
              <span className="inline-flex items-center gap-2 text-[14px] font-semibold"><span className="size-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
              <span className="min-w-6 h-6 px-1.5 rounded-full border border-line text-[11.5px] text-ink-2 inline-flex items-center justify-center tabular">{items.length}</span>
            </div>
            <div className="space-y-2.5 min-h-24">
              {items.map((t) => {
                const due = dueLabel(t.status !== 'done' && t.due_date, today);
                const [fg, bg] = tagColor(t.project_name);
                const people = [t.assignee_id, ...(t.coassignee_ids || [])].map((id) => userMap[id]).filter(Boolean);
                return (
                  <div key={t.id} draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)} onClick={() => onOpen(t.id)}
                    className={cx('group bg-panel rounded-[18px] border border-line p-3.5 cursor-pointer lift', dragId === t.id && 'opacity-40 rotate-1')}>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center h-6 px-2 rounded-md text-[11.5px] font-semibold truncate max-w-[200px]" style={{ color: fg, background: bg }}>{t.project_name}</span>
                      {due?.late && <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-red-600"><Flag size={12} />срочно</span>}
                    </div>
                    <div className="text-[14px] font-semibold leading-snug mt-2.5">{t.title}</div>
                    {t.description && <div className="text-[12.5px] text-ink-3 mt-1 line-clamp-2">{t.description}</div>}
                    <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-line">
                      <div className="flex items-center gap-3 text-[12px] text-ink-3">
                        {due && <span className={cx('inline-flex items-center gap-1', due.late ? 'text-red-600 font-medium' : due.soon && 'text-amber-600')}><Clock size={13} />{due.text}</span>}
                        <span className="inline-flex items-center gap-1"><MessageSquare size={13} />{t.comments_count || 0}</span>
                      </div>
                      <AvatarStack users={people} size={24} max={3} />
                    </div>
                  </div>
                );
              })}
              {!items.length && <div className="h-20 rounded-[16px] border-2 border-dashed border-line flex items-center justify-center text-[12.5px] text-ink-3">Перетащите задачу сюда</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Диаграмма Ганта ---------------- */
const DAY = 864e5;
export function ProjectGantt({ projects, onOpen }) {
  const [zoom, setZoom] = useState(22); // px на день
  const [expanded, setExpanded] = useState([]);
  const [tasks, setTasks] = useState({});

  const range = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let min = new Date(today.getTime() - 14 * DAY), max = new Date(today.getTime() + 45 * DAY);
    for (const p of projects) {
      const s = parseDate(p.start_date || p.created_at), e = parseDate(p.due_date);
      if (s && s < min) min = s;
      if (e && e > max) max = e;
    }
    min = new Date(min.getFullYear(), min.getMonth(), 1);
    max = new Date(max.getFullYear(), max.getMonth() + 1, 0);
    const days = Math.round((max - min) / DAY) + 1;
    return { min, max, days, today };
  }, [projects]);

  const x = (d) => Math.round((parseDate(d) - range.min) / DAY) * zoom;
  const months = [];
  for (let d = new Date(range.min); d <= range.max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    months.push({ label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, left: x(d), width: (end.getDate()) * zoom });
  }

  const scroller = useRef(null);
  useEffect(() => {
    // прокручиваем к сегодняшнему дню
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, Math.round((range.today - range.min) / DAY) * zoom - 160);
  }, [zoom, range]);

  const toggle = async (id) => {
    if (expanded.includes(id)) return setExpanded((e) => e.filter((x) => x !== id));
    if (!tasks[id]) { const t = await api.get(`/tasks?project_id=${id}`); setTasks((m) => ({ ...m, [id]: t })); }
    setExpanded((e) => [...e, id]);
  };

  const width = range.days * zoom;
  const rows = [];
  projects.forEach((p) => {
    rows.push({ kind: 'p', p });
    if (expanded.includes(p.id)) (tasks[p.id] || []).forEach((t) => rows.push({ kind: 't', t, p }));
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 h-12 border-b border-line">
        <span className="text-[13px] text-ink-2">Нажмите на стрелку, чтобы раскрыть задачи проекта</span>
        <div className="flex items-center gap-1 p-0.5 rounded-full border border-line">
          {[[10, 'Месяцы'], [22, 'Недели'], [40, 'Дни']].map(([z, l]) => (
            <button key={z} onClick={() => setZoom(z)} className={cx('px-3 h-7 rounded-full text-[12px] font-medium', zoom === z ? 'bg-ink text-white' : 'text-ink-2')}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex">
        {/* Левая колонка */}
        <div className="w-[280px] shrink-0 border-r border-line">
          <div className="h-[52px] border-b border-line px-4 flex items-end pb-2 text-[12px] font-medium text-ink-2">Проект / задача</div>
          {rows.map((r) => r.kind === 'p' ? (
            <div key={'p' + r.p.id} className="h-11 flex items-center gap-1.5 px-2 border-b border-line">
              <button onClick={() => toggle(r.p.id)} className="p-1 rounded hover:bg-canvas text-ink-3">{expanded.includes(r.p.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
              <button onClick={() => onOpen(r.p.id)} className="text-[13px] truncate text-left hover:text-violet">{r.p.name}</button>
            </div>
          ) : (
            <div key={'t' + r.t.id} className="h-9 flex items-center pl-10 pr-2 border-b border-line text-[12.5px] text-ink-2 truncate bg-canvas/40">{r.t.title}</div>
          ))}
        </div>
        {/* Таймлайн */}
        <div className="flex-1 min-w-0 overflow-x-auto" ref={scroller}>
          <div style={{ width }} className="relative">
            <div className="h-[52px] border-b border-line relative">
              {months.map((m) => (
                <div key={m.label} className="absolute top-0 h-full border-l border-line" style={{ left: m.left, width: m.width }}>
                  <div className="px-2 pt-1.5 text-[12px] font-medium text-ink-2 whitespace-nowrap">{m.label}</div>
                </div>
              ))}
              {zoom >= 22 && Array.from({ length: range.days }).map((_, i) => {
                const d = new Date(range.min.getTime() + i * DAY);
                const show = zoom >= 40 || d.getDay() === 1;
                return show ? <div key={i} className="absolute bottom-1.5 text-[10.5px] text-ink-3 text-center" style={{ left: i * zoom, width: zoom }}>{d.getDate()}</div> : null;
              })}
            </div>
            {/* сетка выходных */}
            <div className="absolute inset-x-0 top-[52px] bottom-0 pointer-events-none">
              {zoom >= 22 && Array.from({ length: range.days }).map((_, i) => {
                const d = new Date(range.min.getTime() + i * DAY);
                return [0, 6].includes(d.getDay()) ? <div key={i} className="absolute top-0 bottom-0 bg-canvas/80" style={{ left: i * zoom, width: zoom }} /> : null;
              })}
              <div className="absolute top-0 bottom-0 w-0.5 bg-violet/70 z-10" style={{ left: x(range.today) + zoom / 2 }} />
            </div>
            {rows.map((r) => {
              if (r.kind === 'p') {
                const p = r.p; const s = p.start_date || toDateStr(parseDate(p.created_at)); const e = p.due_date || s;
                const left = x(s), w = Math.max(zoom, x(e) - left + zoom);
                return (
                  <div key={'p' + p.id} className="h-11 relative border-b border-line">
                    <button onClick={() => onOpen(p.id)} title={`${p.name}: ${fmtDate(s)} — ${fmtDate(e)}`}
                      className="absolute top-2.5 h-6 rounded-full overflow-hidden text-left shadow-sm hover:brightness-95"
                      style={{ left, width: w, background: `color-mix(in srgb, ${PROJECT_STATUS[p.status].color} 40%, white)` }}>
                      <div className="absolute inset-y-0 left-0" style={{ width: `${p.progress}%`, background: PROJECT_STATUS[p.status].color }} />
                      <span className="relative px-2.5 text-[11.5px] font-medium text-ink leading-6 whitespace-nowrap">{w > 90 ? `${p.name} · ${p.progress}%` : ''}</span>
                    </button>
                  </div>
                );
              }
              const t = r.t; const s = t.start_date || toDateStr(parseDate(t.created_at)); const e = t.due_date && t.due_date >= s ? t.due_date : s;
              return (
                <div key={'t' + t.id} className="h-9 relative border-b border-line bg-canvas/40">
                  {s && <div className="absolute top-2.5 h-4 rounded-full" title={t.title}
                    style={{ left: x(s), width: Math.max(zoom, x(e) - x(s) + zoom), background: t.status === 'done' ? 'var(--color-st-done)' : t.status === 'in_progress' ? 'var(--color-st-progress)' : 'var(--color-st-planned)' }} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Учёт времени по проектам ---------------- */
export function ProjectTimeView({ projects }) {
  const { users } = useApp();
  const [period, setPeriod] = useState(30);
  const from = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - period + 1); return toDateStr(d); }, [period]);
  const { data } = useLoad(`/time?from=${from}`);
  const ids = new Set(projects.map((p) => p.id));
  const matrix = {}; const byUser = {};
  (data || []).forEach((e) => {
    if (!e.project_id || !ids.has(e.project_id)) return;
    matrix[e.project_id] ??= {}; matrix[e.project_id][e.user_id] = (matrix[e.project_id][e.user_id] || 0) + e.live_sec;
    byUser[e.user_id] = (byUser[e.user_id] || 0) + e.live_sec;
  });
  const cols = users.filter((u) => byUser[u.id]);
  const rows = projects.filter((p) => matrix[p.id]).map((p) => ({ p, total: Object.values(matrix[p.id]).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total);
  const grand = rows.reduce((a, r) => a + r.total, 0);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-4 h-12 border-b border-line">
        <span className="text-[13px] text-ink-2">Всего за период: <b className="text-ink tabular">{fmtHours(grand)}</b></span>
        <div className="flex items-center gap-1 p-0.5 rounded-full border border-line">
          {[[7, '7 дней'], [30, '30 дней'], [90, '90 дней']].map(([d, l]) => (
            <button key={d} onClick={() => setPeriod(d)} className={cx('px-3 h-7 rounded-full text-[12px] font-medium', period === d ? 'bg-ink text-white' : 'text-ink-2')}>{l}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-canvas/70 border-b border-line">
            <th className="th min-w-[240px]">Проект</th>
            {cols.map((u) => <th key={u.id} className="th text-right"><span className="inline-flex items-center gap-1.5"><Avatar user={u} size={20} ring={false} />{u.name.split(' ')[0]}</span></th>)}
            <th className="th text-right">Итого</th>
          </tr></thead>
          <tbody>
            {rows.map(({ p, total }) => (
              <tr key={p.id} className="border-b border-line hover:bg-canvas/50">
                <td className="td text-ink">{p.name}</td>
                {cols.map((u) => <td key={u.id} className="td text-right tabular">{matrix[p.id][u.id] ? fmtHM(matrix[p.id][u.id]) : <span className="text-ink-3">—</span>}</td>)}
                <td className="td text-right tabular font-semibold text-ink">{fmtHM(total)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={cols.length + 2} className="td text-center text-ink-3 py-10">Нет записей времени за период</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
