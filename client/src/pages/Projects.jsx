import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Info, Star, Activity, UserPlus, MoreHorizontal, Home, ChartGantt, Kanban, Clock, Plus, Search, User, Filter,
  ArrowUpDown, EyeOff, Eye, ChevronDown, ChevronRight, Download, FolderKanban, X, Trash2,
} from 'lucide-react';
import { useApp, useLoad, useStored } from '../lib/store';
import { api } from '../lib/api';
import { PROJECT_STATUS } from '../lib/constants';
import { fmtDate, fmtHM, parseDate, plural, todayStr } from '../lib/format';
import {
  Button, IconButton, Tabs, Popover, MenuItem, StatusDot, Progress, AvatarStack, Card, Empty, Spinner, cx, Avatar,
} from '../components/ui';
import { ProjectDrawer, ProjectFormModal } from '../components/ProjectDrawer';
import { ProjectKanban, ProjectGantt, ProjectTimeView } from '../components/ProjectViews';

const COLUMNS = [
  { key: 'members', label: 'Участники' },
  { key: 'status', label: 'Статус', info: true },
  { key: 'progress', label: 'Прогресс' },
  { key: 'time', label: 'Учтено времени', info: true },
  { key: 'client', label: 'Клиент' },
  { key: 'due', label: 'Срок' },
  { key: 'visible', label: 'Задачи' },
];
const SORTS = {
  due: { label: 'По сроку', fn: (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') },
  name: { label: 'По названию', fn: (a, b) => a.name.localeCompare(b.name, 'ru') },
  progress: { label: 'По прогрессу', fn: (a, b) => b.progress - a.progress },
  time: { label: 'По времени', fn: (a, b) => b.tracked_sec - a.tracked_sec },
  created: { label: 'Сначала новые', fn: (a, b) => b.id - a.id },
};

// Группировка по сроку сдачи, как «This month / Next month» на макете
function groupKey(p) {
  const d = parseDate(p.due_date);
  if (!d) return 'none';
  const now = new Date();
  const m = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth();
  if (p.status !== 'done' && d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return 'overdue';
  if (m <= 0) return 'this';
  if (m === 1) return 'next';
  return 'later';
}
const GROUPS = [
  ['overdue', 'Просрочено'], ['this', 'Этот месяц'], ['next', 'Следующий месяц'], ['later', 'Позже'], ['none', 'Без срока'],
];

export default function Projects() {
  const { users, bump, toast, isManager } = useApp();
  const { data, loading, setData } = useLoad('/projects');
  const [params, setParams] = useSearchParams();
  const [view, setView] = useStored('crm.projects.view', 'main');
  const [q, setQ] = useState('');
  const [searchOn, setSearchOn] = useState(false);
  const [emp, setEmp] = useState(null);
  const [statuses, setStatuses] = useState([]);
  const [sort, setSort] = useStored('crm.projects.sort', 'due');
  const [hidden, setHidden] = useStored('crm.projects.hidden', ['client']);
  const [collapsed, setCollapsed] = useStored('crm.projects.collapsed', ['next', 'later']);
  const [starred, setStarred] = useStored('crm.starred', []);
  const [selected, setSelected] = useState([]);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    const o = params.get('open'); if (o) setOpenId(Number(o));
    if (params.get('new')) setFormOpen(true);
    if (o || params.get('new')) setParams({}, { replace: true });
  }, [params, setParams]);

  const userMap = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const list = useMemo(() => {
    let l = data || [];
    if (q) l = l.filter((p) => (p.name + ' ' + (p.client_name || '')).toLowerCase().includes(q.toLowerCase()));
    if (emp) l = l.filter((p) => p.member_ids.includes(emp) || p.owner_id === emp);
    if (statuses.length) l = l.filter((p) => statuses.includes(p.status));
    if (onlyStarred) l = l.filter((p) => starred.includes(p.id));
    return [...l].sort(SORTS[sort]?.fn || SORTS.due.fn);
  }, [data, q, emp, statuses, sort, onlyStarred, starred]);

  const patch = async (id, body) => {
    setData((d) => d.map((p) => (p.id === id ? { ...p, ...body } : p)));
    try {
      const upd = await api.put(`/projects/${id}`, body);
      setData((d) => d.map((p) => (p.id === id ? upd : p)));
    } catch (e) { toast(e.message, 'error'); bump(); }
  };
  const bulk = async (body) => {
    await Promise.all(selected.map((id) => api.put(`/projects/${id}`, body)));
    setSelected([]); bump(); toast('Готово');
  };
  const bulkDelete = async () => {
    await Promise.all(selected.map((id) => api.del(`/projects/${id}`)));
    setSelected([]); bump(); toast('Проекты удалены');
  };

  const exportCsv = () => {
    const rows = [['Проект', 'Статус', 'Прогресс', 'Часы', 'Клиент', 'Начало', 'Срок', 'Бюджет', 'Участники']];
    list.forEach((p) => rows.push([p.name, PROJECT_STATUS[p.status].label, p.progress + '%', (p.tracked_sec / 3600).toFixed(1).replace('.', ','),
      p.client_name || '', p.start_date || '', p.due_date || '', p.budget || 0, p.member_ids.map((i) => userMap[i]?.name).join(', ')]));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `projects-${todayStr()}.csv`;
    a.click();
  };

  const cols = COLUMNS.filter((c) => !hidden.includes(c.key));

  return (
    <div>
      {/* Заголовок */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[26px] font-semibold tracking-tight">Проекты</h1>
            <span title="Проекты группируются по сроку сдачи. Прогресс считается по выполненным задачам." className="text-ink-2"><Info size={19} /></span>
            <button onClick={() => setOnlyStarred((v) => !v)} title={onlyStarred ? 'Показать все проекты' : 'Только избранные'}>
              <Star size={19} className={cx('text-ink-2', onlyStarred && 'fill-amber-400 text-amber-400')} />
            </button>
          </div>
          <p className="text-ink-2 text-[14px] mt-1">Назначайте ответственных, задавайте сроки и следите за прогрессом проектов.</p>
        </div>
        <div className="flex items-center gap-2">
          <Popover align="right" width={360} trigger={({ toggle }) => <Button icon={Activity} onClick={toggle}>Активность</Button>}>
            <ActivityList />
          </Popover>
          <Popover align="right" width={280} trigger={({ toggle }) => <Button icon={UserPlus} onClick={toggle}>Участники</Button>}>
            <div className="px-2.5 pt-1 pb-2 text-[12px] font-medium text-ink-3">Команда · {users.filter((u) => u.active).length}</div>
            {users.filter((u) => u.active).map((u) => (
              <div key={u.id} className="flex items-center gap-2.5 px-2.5 py-1.5">
                <Avatar user={u} size={26} ring={false} />
                <div className="min-w-0 flex-1"><div className="text-[13px] truncate">{u.name}</div><div className="text-[11.5px] text-ink-3 truncate">{u.position}</div></div>
                <span className="text-[11.5px] text-ink-3">{u.open_tasks} зад.</span>
              </div>
            ))}
          </Popover>
          <Popover align="right" width={200} trigger={({ toggle }) => <IconButton icon={MoreHorizontal} onClick={toggle} title="Ещё" />}>
            {({ close }) => <MenuItem icon={Download} onClick={() => { exportCsv(); close(); }}>Экспорт в CSV</MenuItem>}
          </Popover>
        </div>
      </div>

      {/* Вкладки */}
      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Tabs value={view} onChange={setView} tabs={[
            { value: 'main', label: 'Основной вид', icon: Home },
            { value: 'gantt', label: 'Диаграмма Ганта', icon: ChartGantt },
            { value: 'kanban', label: 'Канбан', icon: Kanban },
            { value: 'time', label: 'Учёт времени', icon: Clock },
          ]} />
        </div>
        <div className="hidden xl:flex items-center gap-2 pb-1.5">
          <Button icon={Download} onClick={exportCsv}>Экспорт</Button>
        </div>
      </div>

      {/* Панель инструментов */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>Новый проект</Button>
        {searchOn || q ? (
          <div className="flex items-center gap-1.5 h-9 px-3 rounded-full border border-violet/40 bg-panel">
            <Search size={15} className="text-ink-3" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setSearchOn(false)} placeholder="Название или клиент"
              className="outline-none text-[13px] w-44 bg-transparent" />
            {q && <button onClick={() => setQ('')}><X size={14} className="text-ink-3" /></button>}
          </div>
        ) : <button className="chip" onClick={() => setSearchOn(true)}><Search size={15} />Поиск</button>}

        <Popover width={240} trigger={({ toggle }) => (
          <button className={cx('chip', emp && 'chip-active')} onClick={toggle}>
            {emp ? <Avatar user={userMap[emp]} size={18} ring={false} /> : <User size={15} />}
            {emp ? userMap[emp]?.name.split(' ')[0] : 'Сотрудник'}
          </button>
        )}>
          {({ close }) => (<>
            <MenuItem checked={!emp} onClick={() => { setEmp(null); close(); }}>Все сотрудники</MenuItem>
            {users.filter((u) => u.active).map((u) => <MenuItem key={u.id} checked={emp === u.id} onClick={() => { setEmp(u.id); close(); }}>{u.name}</MenuItem>)}
          </>)}
        </Popover>

        <Popover width={220} trigger={({ toggle }) => (
          <button className={cx('chip', statuses.length && 'chip-active')} onClick={toggle}>
            <Filter size={15} />Фильтр{statuses.length ? ` · ${statuses.length}` : ''}
          </button>
        )}>
          <div className="px-2.5 py-1 text-[11.5px] font-medium text-ink-3">Статус</div>
          {Object.entries(PROJECT_STATUS).map(([k, s]) => (
            <MenuItem key={k} checked={statuses.includes(k)} onClick={() => setStatuses((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}>
              <StatusDot color={s.color} label={s.label} />
            </MenuItem>
          ))}
          {statuses.length > 0 && <><div className="h-px bg-line my-1" /><MenuItem onClick={() => setStatuses([])}>Сбросить</MenuItem></>}
        </Popover>

        <Popover width={200} trigger={({ toggle }) => <button className="chip" onClick={toggle}><ArrowUpDown size={15} />Сортировка</button>}>
          {({ close }) => Object.entries(SORTS).map(([k, s]) => <MenuItem key={k} checked={sort === k} onClick={() => { setSort(k); close(); }}>{s.label}</MenuItem>)}
        </Popover>

        {view === 'main' && (
          <Popover width={220} trigger={({ toggle }) => <button className={cx('chip', hidden.length && 'chip-active')} onClick={toggle}><EyeOff size={15} />Скрыть{hidden.length ? ` · ${hidden.length}` : ''}</button>}>
            <div className="px-2.5 py-1 text-[11.5px] font-medium text-ink-3">Колонки</div>
            {COLUMNS.map((c) => (
              <MenuItem key={c.key} checked={!hidden.includes(c.key)} onClick={() => setHidden((h) => (h.includes(c.key) ? h.filter((x) => x !== c.key) : [...h, c.key]))}>{c.label}</MenuItem>
            ))}
          </Popover>
        )}

        {selected.length > 0 && (
          <div className="flex items-center gap-2 ml-auto pl-3 pr-1.5 h-9 rounded-full bg-ink text-white text-[13px] anim-pop">
            Выбрано: {selected.length}
            <Popover align="right" width={200} trigger={({ toggle }) => <button onClick={toggle} className="h-7 px-2.5 rounded-full bg-white/15 hover:bg-white/25">Статус</button>}>
              {({ close }) => Object.entries(PROJECT_STATUS).map(([k, s]) => <MenuItem key={k} onClick={() => { bulk({ status: k }); close(); }}><StatusDot color={s.color} label={s.label} /></MenuItem>)}
            </Popover>
            {isManager && <button onClick={bulkDelete} className="h-7 px-2.5 rounded-full bg-white/15 hover:bg-red-500 flex items-center gap-1"><Trash2 size={13} />Удалить</button>}
            <button onClick={() => setSelected([])} className="p-1 rounded-full hover:bg-white/15"><X size={14} /></button>
          </div>
        )}
      </div>

      {/* Контент */}
      <div className="mt-5">
        {loading && !data ? <Spinner /> : list.length === 0 ? (
          <Card><Empty icon={FolderKanban} title={data?.length ? 'Ничего не найдено' : 'Проектов пока нет'}
            text={data?.length ? 'Попробуйте изменить фильтры' : 'Создайте первый проект и добавьте в него задачи'}
            action={!data?.length && <Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>Новый проект</Button>} /></Card>
        ) : view === 'main' ? (
          <div className="rounded-2xl bg-canvas/60 border border-line p-2.5 space-y-2.5">
            {GROUPS.map(([key, label]) => {
              const items = list.filter((p) => groupKey(p) === key);
              if (!items.length) return null;
              const isCol = collapsed.includes(key);
              return (
                <section key={key} className="bg-panel rounded-xl border border-line">
                  <button onClick={() => setCollapsed((c) => (isCol ? c.filter((x) => x !== key) : [...c, key]))}
                    className="flex items-center gap-2 px-4 pt-3.5 pb-3 text-[13.5px] font-medium">
                    {isCol ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    <span className={key === 'overdue' ? 'text-red-600' : ''}>{label}</span>
                    <span className="text-ink-3 font-normal text-[12px]">{items.length}</span>
                  </button>
                  {isCol ? (
                    <div className="px-4 pb-4 -mt-1 text-[12.5px] text-ink-3">
                      {items.length} {plural(items.length, 'проект скрыт', 'проекта скрыты', 'проектов скрыто')} в этой группе
                    </div>
                  ) : (
                    <div className="px-2 pb-2 overflow-x-auto">
                      <table className="w-full border border-line rounded-lg border-separate border-spacing-0 overflow-hidden">
                        <thead>
                          <tr className="bg-canvas/70">
                            <th className="th w-10 border-b border-line">
                              <input type="checkbox" className="accent-violet size-4 align-middle"
                                checked={items.every((p) => selected.includes(p.id))}
                                onChange={(e) => setSelected((s) => (e.target.checked ? [...new Set([...s, ...items.map((p) => p.id)])] : s.filter((id) => !items.some((p) => p.id === id))))} />
                            </th>
                            {cols.find((c) => c.key === 'members') && <th className="th border-b border-l border-line">Участники</th>}
                            <th className="th border-b border-l border-line min-w-[220px]">Проект</th>
                            {cols.filter((c) => c.key !== 'members').map((c) => (
                              <th key={c.key} className={cx('th border-b border-l border-line', c.key === 'visible' && 'text-center')}>
                                <span className="inline-flex items-center gap-1.5">{c.label}{c.info && <Info size={13} className="text-ink-3" />}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((p) => (
                            <ProjectRow key={p.id} p={p} cols={cols} userMap={userMap} selected={selected.includes(p.id)}
                              onSelect={(v) => setSelected((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                              onOpen={() => setOpenId(p.id)} onPatch={(b) => patch(p.id, b)}
                              starred={starred.includes(p.id)} onStar={() => setStarred((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : view === 'kanban' ? (
          <ProjectKanban projects={list} userMap={userMap} onOpen={setOpenId} onPatch={patch} />
        ) : view === 'gantt' ? (
          <ProjectGantt projects={list} onOpen={setOpenId} />
        ) : (
          <ProjectTimeView projects={list} />
        )}
      </div>

      <ProjectDrawer id={openId} onClose={() => setOpenId(null)} />
      <ProjectFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={(p) => { bump(); setOpenId(p.id); }} />
    </div>
  );
}

function ProjectRow({ p, cols, userMap, selected, onSelect, onOpen, onPatch, starred, onStar }) {
  const has = (k) => cols.some((c) => c.key === k);
  const members = p.member_ids.map((id) => userMap[id]).filter(Boolean);
  const st = PROJECT_STATUS[p.status];
  const overdue = p.status !== 'done' && p.due_date && parseDate(p.due_date) < new Date(new Date().toDateString());
  return (
    <tr className={cx('group hover:bg-canvas/60', selected && 'bg-violet/[.04]')}>
      <td className="td border-b border-line"><input type="checkbox" className="accent-violet size-4 align-middle opacity-40 group-hover:opacity-100 checked:opacity-100" checked={selected} onChange={(e) => onSelect(e.target.checked)} /></td>
      {has('members') && <td className="td border-b border-l border-line"><AvatarStack users={members} /></td>}
      <td className="td border-b border-l border-line">
        <div className="flex items-center gap-2">
          <button onClick={onOpen} className="text-ink hover:text-violet font-[450] text-left truncate max-w-[320px]">{p.name}</button>
          <button onClick={onStar} className={cx('transition-opacity', starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')} title="В избранное">
            <Star size={14} className={starred ? 'fill-amber-400 text-amber-400' : 'text-ink-3'} />
          </button>
        </div>
      </td>
      {cols.filter((c) => c.key !== 'members').map((c) => {
        const cls = cx('td border-b border-l border-line', c.key === 'visible' && 'text-center');
        switch (c.key) {
          case 'status': return (
            <td key={c.key} className={cls}>
              <Popover width={190} trigger={({ toggle }) => <button onClick={toggle} className="hover:opacity-80"><StatusDot color={st.color} label={st.label} /></button>}>
                {({ close }) => Object.entries(PROJECT_STATUS).map(([k, s]) => (
                  <MenuItem key={k} checked={k === p.status} onClick={() => { onPatch({ status: k }); close(); }}><StatusDot color={s.color} label={s.label} /></MenuItem>
                ))}
              </Popover>
            </td>);
          case 'progress': return <td key={c.key} className={cls}><Progress value={p.progress} /></td>;
          case 'time': return <td key={c.key} className={cls}><span className="inline-flex items-center gap-2 text-ink-3 tabular"><Clock size={15} />{fmtHM(p.tracked_sec)} ч</span></td>;
          case 'client': return <td key={c.key} className={cx(cls, 'max-w-[180px] truncate')}>{p.client_name || <span className="text-ink-3">—</span>}</td>;
          case 'due': return <td key={c.key} className={cx(cls, overdue && 'text-red-600 font-medium')}>{fmtDate(p.due_date)}</td>;
          case 'visible': return (
            <td key={c.key} className={cls}>
              <button onClick={onOpen} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-line text-[12px] font-medium text-ink hover:bg-canvas">
                <Eye size={13} />Задачи · {p.tasks_done}/{p.tasks_total}
              </button>
            </td>);
          default: return null;
        }
      })}
    </tr>
  );
}

function ActivityList() {
  const { data } = useLoad('/activity');
  return (
    <div className="max-h-96 overflow-y-auto">
      <div className="px-2.5 pt-1 pb-2 text-[13px] font-semibold">Активность команды</div>
      {(data || []).slice(0, 30).map((a) => (
        <div key={a.id} className="flex gap-2.5 px-2.5 py-2 text-[12.5px]">
          <Avatar user={{ name: a.user_name || '?', color: a.user_color }} size={24} ring={false} />
          <div><span className="font-medium">{a.user_name}</span> <span className="text-ink-2">{a.text}</span>
            <div className="text-[11px] text-ink-3">{fmtDate(a.created_at)}</div></div>
        </div>
      ))}
    </div>
  );
}
