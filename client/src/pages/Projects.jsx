import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Info, Star, MoreHorizontal, List, ChartGantt, Kanban, Clock, Plus, Search, User, X, ChevronDown, ChevronRight,
  Download, FolderKanban, Settings2, Play, ChevronsDownUp, ChevronsUpDown, Calendar, ListTodo, MessageSquare, ListChecks, GitBranch, Lock, CornerDownRight, Repeat, Upload,
} from 'lucide-react';
import { useApp, useLoad, useStored } from '../lib/store';
import { api } from '../lib/api';
import { TASK_STATUS, TASK_FILTERS } from '../lib/constants';
import { fmtDate, fmtHM, todayStr, timeAgo } from '../lib/format';
import { Button, IconButton, Tabs, Popover, MenuItem, AvatarStack, Card, Empty, Spinner, cx, Avatar, Segmented, SearchList, userOptions, nameOptions } from '../components/ui';
import { ProjectFormModal } from '../components/ProjectForm';
import { TaskFormModal, TaskDrawer, TaskStatusIcon, TaskStatusPill, TaskWorkActions, isOverdue } from '../components/Tasks';
import { RecurrenceList } from '../components/Recurrence';
import { SavedViews } from '../components/SavedViews';
import { ImportModal } from '../components/Import';
import { TaskKanban, ProjectGantt, ProjectTimeView } from '../components/ProjectViews';

export default function Projects() {
  const { users, bump, toast, startTimer, startWork, askWork, isManager } = useApp();
  const { data: projectsData, loading } = useLoad('/projects');
  const { data: tasksData, setData: setTasks } = useLoad('/tasks');
  const [params, setParams] = useSearchParams();
  const [view, setView] = useStored('crm.projects.view2', 'list');
  const [filter, setFilter] = useStored('crm.tasks.filter', 'open');
  const [expanded, setExpanded] = useStored('crm.projects.expanded', []);
  const [starred, setStarred] = useStored('crm.starred', []);
  const [q, setQ] = useState('');
  const [emp, setEmp] = useState(null);
  const [kProject, setKProject] = useStored('crm.kanban.project', null); // фильтр канбана по проекту
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [taskId, setTaskId] = useState(null);
  const [taskForm, setTaskForm] = useState(null);      // { projectId } | null
  const [projectForm, setProjectForm] = useState(null); // {} — новый, project — редактирование
  const [importing, setImporting] = useState(false);

  // Переходы из поиска, дашборда, избранного: ?open=<проект>&task=<задача>&new=1
  useEffect(() => {
    const o = Number(params.get('open')); const t = Number(params.get('task'));
    if (o) {
      setExpanded((e) => (e.includes(o) ? e : [...e, o]));
      setTimeout(() => document.getElementById(`project-${o}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
    if (t) setTaskId(t);
    if (params.get('new')) setProjectForm({});
    if (params.get('newtask')) setTaskForm({ projectId: o || null });
    if (o || t || params.get('new') || params.get('newtask')) setParams({}, { replace: true });
  }, [params, setParams, setExpanded]);

  const today = todayStr();
  const userMap = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const projects = projectsData || [];
  const tasks = tasksData || [];

  // Задачи после фильтров (статус, сотрудник, поиск)
  const ql = q.trim().toLowerCase();
  const visibleTasks = useMemo(() => tasks.filter((t) =>
    TASK_FILTERS[filter].test(t, today)
    && (!emp || t.assignee_id === emp)
    && (!ql || `${t.title} ${t.description || ''}`.toLowerCase().includes(ql))), [tasks, filter, emp, ql, today]);

  const byProject = useMemo(() => {
    const m = {};
    for (const t of visibleTasks) (m[t.project_id] ??= []).push(t);
    return m;
  }, [visibleTasks]);
  const counts = useMemo(() => {
    const m = {};
    for (const t of tasks) {
      const c = (m[t.project_id] ??= { open: 0, in_progress: 0, overdue: 0, done: 0, total: 0 });
      c.total++;
      if (t.status === 'done') c.done++; else c.open++;
      if (t.status === 'in_progress') c.in_progress++;
      if (isOverdue(t)) c.overdue++;
    }
    return m;
  }, [tasks]);

  const list = useMemo(() => projects.filter((p) => {
    if (onlyStarred && !starred.includes(p.id)) return false;
    if (ql || emp) return p.name.toLowerCase().includes(ql) && !emp ? true : !!byProject[p.id]?.length;
    return true;
  }).sort((a, b) => (b.status !== 'done') - (a.status !== 'done') || (counts[b.id]?.overdue || 0) - (counts[a.id]?.overdue || 0) || a.name.localeCompare(b.name, 'ru')),
  [projects, onlyStarred, starred, ql, emp, byProject, counts]);

  const filterCounts = useMemo(() => Object.fromEntries(Object.keys(TASK_FILTERS).map((k) =>
    [k, tasks.filter((t) => TASK_FILTERS[k].test(t, today) && (!emp || t.assignee_id === emp)).length])), [tasks, today, emp]);

  const toggle = (id) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));
  const searching = !!(ql || emp);

  const patchTask = async (id, body) => {
    setTasks((d) => d.map((t) => (t.id === id ? { ...t, ...body } : t)));
    try { await api.put(`/tasks/${id}`, body); bump(); } catch (e) { toast(e.message, 'error'); bump(); }
  };

  // Перемещение в канбане — через рабочий цикл: «В работу» запускает время, выход из работы — с отчётом
  const moveTask = (id, status) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    if (status === 'in_progress') return startWork(t);
    if (status === 'done') return askWork(t, 'close');
    if (t.status === 'in_progress') return askWork(t, 'pause');
    return patchTask(id, { status });
  };

  const exportCsv = () => {
    const rows = [['Проект', 'Задача', 'Описание', 'Статус', 'Исполнитель', 'Срок', 'Создана', 'Закрыта']];
    visibleTasks.forEach((t) => rows.push([t.project_name, t.title, t.description || '', TASK_STATUS[t.status].label,
      userMap[t.assignee_id]?.name || '', t.due_date || '', (t.created_at || '').slice(0, 10), (t.completed_at || '').slice(0, 10)]));
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `tasks-${today}.csv`; a.click();
  };

  return (
    <div>
      {/* Заголовок */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em]"><span className="reveal"><span>Проекты</span></span></h1>
            <span title="Проект — это организация, которую вы обслуживаете. Нажмите на проект, чтобы увидеть его задачи." className="text-ink-2"><Info size={19} /></span>
            <button onClick={() => setOnlyStarred((v) => !v)} title={onlyStarred ? 'Показать все проекты' : 'Только избранные'}>
              <Star size={19} className={cx('text-ink-2', onlyStarred && 'fill-amber-400 text-amber-400')} />
            </button>
          </div>
          <p className="text-ink-2 text-[14px] mt-1 reveal-sub">Организации, которые вы обслуживаете, и задачи по каждой из них.</p>
        </div>
        <div className="flex items-center gap-2">
          {isManager && <Button icon={Upload} onClick={() => setImporting(true)}>Импорт задач</Button>}
          <Button icon={Download} onClick={exportCsv}>Экспорт задач</Button>
          <Button variant="primary" icon={Plus} onClick={() => setProjectForm({})}>Новый проект</Button>
        </div>
      </div>

      <div className="mt-5">
        <Tabs value={view} onChange={setView} tabs={[
          { value: 'list', label: 'Проекты и задачи', icon: List },
          { value: 'kanban', label: 'Канбан задач', icon: Kanban },
          { value: 'gantt', label: 'Диаграмма Ганта', icon: ChartGantt },
          { value: 'time', label: 'Учёт времени', icon: Clock },
          { value: 'recurring', label: 'Повторяющиеся', icon: Repeat },
        ]} />
      </div>

      {/* Панель фильтров */}
      {view !== 'time' && view !== 'gantt' && view !== 'recurring' && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {view === 'list' && (
            <Segmented value={filter} onChange={setFilter}
              items={Object.entries(TASK_FILTERS).map(([k, f]) => ({ value: k, label: f.label, count: filterCounts[k], tone: k === 'overdue' ? 'red' : undefined }))} />
          )}
          <div className={cx('flex items-center gap-1.5 h-9 px-3 rounded-full border bg-panel', q ? 'border-violet/40' : 'border-line')}>
            <Search size={15} className="text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по задачам" className="outline-none text-[13px] w-40 bg-transparent" />
            {q && <button onClick={() => setQ('')}><X size={14} className="text-ink-3" /></button>}
          </div>
          <Popover width={240} trigger={({ toggle: t }) => (
            <button className={cx('chip', emp && 'chip-active')} onClick={t}>
              {emp ? <Avatar user={userMap[emp]} size={18} ring={false} /> : <User size={15} />}
              {emp ? userMap[emp]?.name.split(' ')[0] : 'Исполнитель'}
            </button>
          )}>
            {({ close }) => (<>
              <SearchList value={emp} placeholder="Поиск сотрудника…" onEscape={close}
                items={[{ value: null, label: 'Все', muted: true }, ...userOptions(users)]} onPick={(v) => { setEmp(v); close(); }} />
            </>)}
          </Popover>
          {view === 'kanban' && (
            <Popover width={260} trigger={({ toggle: t }) => {
              const kp = projects.find((p) => p.id === kProject);
              return (
                <button className={cx('chip', kp && 'chip-active')} onClick={t}>
                  <FolderKanban size={15} />{kp ? kp.name : 'Проект'}
                  {kp && <X size={13} className="text-ink-3 -mr-1" onClick={(e) => { e.stopPropagation(); setKProject(null); }} />}
                </button>
              );
            }}>
              {({ close }) => (<>
                <SearchList value={kProject} placeholder="Поиск проекта…" onEscape={close}
                  items={[{ value: null, label: 'Все проекты', muted: true }, ...nameOptions(projects)]} onPick={(v) => { setKProject(v); close(); }} />
              </>)}
            </Popover>
          )}
          <SavedViews page="projects" state={{ filter, q, emp, kProject }}
            apply={(v) => { if (v.filter) setFilter(v.filter); setQ(v.q || ''); setEmp(v.emp ?? null); setKProject(v.kProject ?? null); }} />
          {view === 'list' && (
            <div className="ml-auto flex items-center gap-1">
              <button className="chip" onClick={() => setExpanded(list.map((p) => p.id))} title="Развернуть все"><ChevronsUpDown size={15} />Развернуть</button>
              <button className="chip" onClick={() => setExpanded([])} title="Свернуть все"><ChevronsDownUp size={15} />Свернуть</button>
            </div>
          )}
        </div>
      )}

      {/* Контент */}
      <div className="mt-4">
        {loading && !projectsData ? <Spinner /> : projects.length === 0 ? (
          <Card><Empty icon={FolderKanban} title="Проектов пока нет" text="Создайте проект для каждой организации, которую обслуживаете, и добавляйте в него задачи"
            action={<Button variant="primary" icon={Plus} onClick={() => setProjectForm({})}>Новый проект</Button>} /></Card>
        ) : view === 'list' ? (
          list.length === 0 ? <Card><Empty icon={Search} title="Ничего не найдено" text="Измените поиск или фильтр" /></Card> : (
            <div className="space-y-2.5 stagger">
              {list.map((p) => (
                <ProjectBlock key={p.id} p={p} c={counts[p.id] || { open: 0, in_progress: 0, overdue: 0, done: 0, total: 0 }}
                  tasks={byProject[p.id] || []} filter={filter} userMap={userMap}
                  open={searching ? !!byProject[p.id]?.length || expanded.includes(p.id) : expanded.includes(p.id)}
                  onToggle={() => toggle(p.id)} starred={starred.includes(p.id)}
                  onStar={() => setStarred((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                  onAddTask={() => setTaskForm({ projectId: p.id })} onEdit={() => setProjectForm(p)}
                  onTimer={() => startTimer({ project_id: p.id })}
                  onOpenTask={setTaskId} onPatchTask={patchTask} />
              ))}
            </div>
          )
        ) : view === 'kanban' ? (
          <TaskKanban onMove={moveTask} tasks={tasks.filter((t) => (!emp || t.assignee_id === emp) && (!kProject || t.project_id === kProject) && (!ql || `${t.title} ${t.description || ''} ${t.project_name}`.toLowerCase().includes(ql)))}
            userMap={userMap} onOpen={setTaskId} onPatch={patchTask} />
        ) : view === 'gantt' ? (
          <ProjectGantt projects={projects} onOpen={(id) => { setView('list'); setExpanded((e) => [...new Set([...e, id])]); }} />
        ) : view === 'recurring' ? (
          <RecurrenceList />
        ) : (
          <ProjectTimeView projects={projects} />
        )}
      </div>

      <TaskDrawer id={taskId} onClose={() => setTaskId(null)} />
      {importing && <ImportModal kind="tasks" onClose={() => setImporting(false)} />}
      <TaskFormModal open={!!taskForm} projectId={taskForm?.projectId} onClose={() => setTaskForm(null)}
        onSaved={(t) => setExpanded((e) => (e.includes(t.project_id) ? e : [...e, t.project_id]))} />
      <ProjectFormModal open={!!projectForm} project={projectForm?.id ? projectForm : null} onClose={() => setProjectForm(null)}
        onSaved={(p) => setExpanded((e) => (e.includes(p.id) ? e : [...e, p.id]))} />
    </div>
  );
}

function ProjectBlock({ p, c, tasks, filter, userMap, open, onToggle, starred, onStar, onAddTask, onEdit, onTimer, onOpenTask, onPatchTask }) {
  const members = p.member_ids.map((id) => userMap[id]).filter(Boolean);
  const progress = c.total ? Math.round((c.done / c.total) * 100) : 0;
  const initial = p.name.replace(/[«»"]/g, '').replace(/^(ООО|АО|ИП|ПАО|ГБУ|ГУП|ФГБОУ)\s+/i, '').trim()[0] || '?';
  return (
    <section id={`project-${p.id}`} className={cx('bg-panel rounded-[20px] border transition-all duration-300 scroll-mt-4 hover:shadow-[0_14px_30px_-20px_rgba(14,47,32,.35)]', open ? 'border-line-strong shadow-[0_2px_10px_-4px_rgba(16,24,40,.08)]' : 'border-line')}>
      {/* Шапка проекта */}
      <div onClick={onToggle} className="group flex flex-wrap xl:flex-nowrap items-center gap-x-4 gap-y-2 px-4 py-3.5 cursor-pointer select-none">
        <div className="flex items-center gap-3 min-w-0 flex-1 basis-[260px] xl:basis-0">
          <span className="text-ink-3">{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
          <span className="size-9 rounded-xl bg-brand/10 text-brand font-bold flex items-center justify-center shrink-0">{initial.toUpperCase()}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold truncate">{p.name}</span>
              <button onClick={(e) => { e.stopPropagation(); onStar(); }} className={cx('transition-opacity', starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')} title="В избранное">
                <Star size={14} className={starred ? 'fill-amber-400 text-amber-400' : 'text-ink-3'} />
              </button>
            </div>
            {p.description && <div className="text-[12.5px] text-ink-3 truncate">{p.description}</div>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[12px] xl:flex-nowrap xl:shrink-0">
          <Counter label="Открыто" n={c.open} />
          <Counter label="В работе" n={c.in_progress} dot="var(--color-st-progress)" />
          {c.overdue > 0 && <Counter label="Просрочено" n={c.overdue} tone="red" />}
          <Counter label="Закрыто" n={c.done} dot="var(--color-st-done)" />
        </div>

        <div className="hidden md:flex items-center gap-2 w-[110px] shrink-0" title={`Закрыто ${c.done} из ${c.total}`}>
          <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full rounded-full bg-st-done" style={{ width: `${progress}%` }} /></div>
          <span className="text-[11.5px] text-ink-3 tabular w-8 text-right">{progress}%</span>
        </div>
        <span className="hidden 2xl:inline-flex items-center gap-1.5 text-[12px] text-ink-3 tabular w-[78px] shrink-0" title="Учтено времени всего"><Clock size={13} />{fmtHM(p.tracked_sec)} ч</span>
        <div className="hidden sm:block shrink-0"><AvatarStack users={members} max={3} size={24} /></div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto xl:ml-0" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" icon={Plus} onClick={onAddTask}>Задача</Button>
          <Popover align="right" width={200} trigger={({ toggle }) => <IconButton icon={MoreHorizontal} size={32} title="Ещё" onClick={toggle} />}>
            {({ close }) => (<>
              <MenuItem icon={Settings2} onClick={() => { close(); onEdit(); }}>Настройки проекта</MenuItem>
              <MenuItem icon={Play} onClick={() => { close(); onTimer(); }}>Таймер на проект</MenuItem>
              <MenuItem icon={Star} onClick={() => { close(); onStar(); }}>{starred ? 'Убрать из избранного' : 'В избранное'}</MenuItem>
            </>)}
          </Popover>
        </div>
      </div>

      {/* Задачи */}
      {open && (
        <div className="border-t border-line anim-fade">
          {tasks.length === 0 ? (
            <div className="flex items-center justify-between gap-3 px-5 py-5 text-[13px] text-ink-3">
              <span className="flex items-center gap-2"><ListTodo size={16} />{c.total ? `Нет задач с фильтром «${TASK_FILTERS[filter].label}»` : 'Задач пока нет'}</span>
              <Button size="sm" variant="primary" icon={Plus} onClick={onAddTask}>Добавить задачу</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-canvas/60 border-b border-line">
                    <th className="th w-10" />
                    <th className="th min-w-[300px]">Задача</th>
                    <th className="th">Статус</th>
                    <th className="th">Исполнитель</th>
                    <th className="th">Срок</th>
                    <th className="th">Создана</th>
                    <th className="th text-right">Работа</th>
                  </tr>
                </thead>
                <tbody className="stagger">
                  {nestTasks(tasks).map((t) => {
                    const late = isOverdue(t);
                    const a = userMap[t.assignee_id];
                    return (
                      <tr key={t.id} onClick={() => onOpenTask(t.id)} className="border-b border-line last:border-0 hover:bg-canvas/50 cursor-pointer">
                        <td className="td pr-0"><TaskStatusIcon status={t.status} /></td>
                        <td className="td whitespace-normal">
                          <div className={cx(t._child && 'pl-5 relative before:absolute before:left-1.5 before:top-0 before:h-3 before:w-2.5 before:border-l-2 before:border-b-2 before:border-line-strong before:rounded-bl-md')}>
                          <div className={cx('text-[13.5px] font-[450]', t.status === 'done' ? 'text-ink-3 line-through' : 'text-ink')}>{t.title}</div>
                          {t.description && <div className="text-[12px] text-ink-3 line-clamp-1 max-w-[560px]">{t.description}</div>}
                          <TaskMeta t={t} />
                          </div>
                        </td>
                        <td className="td"><TaskStatusPill status={t.status} /></td>
                        <td className="td">
                          <span className="flex items-center gap-2">{a ? <><Avatar user={a} size={22} ring={false} />{a.name.split(' ')[0]}</> : <span className="text-ink-3">—</span>}</span>
                        </td>
                        <td className={cx('td', late && 'text-red-600 font-medium')}>
                          {t.due_date ? <span className="inline-flex items-center gap-1.5"><Calendar size={13} className={late ? '' : 'text-ink-3'} />{fmtDate(t.due_date)}</span> : <span className="text-ink-3">—</span>}
                        </td>
                        <td className="td text-ink-3 text-[12px]">{timeAgo(t.created_at)}</td>
                        <td className="td text-right"><TaskWorkActions task={t} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button onClick={onAddTask} className="w-full flex items-center gap-2 px-5 h-11 text-[13px] text-ink-3 hover:text-ink hover:bg-canvas/50 border-t border-line rounded-b-2xl">
                <Plus size={15} />Новая задача
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Подзадачи — сразу под родителем (если родитель тоже в списке)
function nestTasks(list) {
  const ids = new Set(list.map((t) => t.id));
  const kids = {};
  for (const t of list) if (t.parent_id && ids.has(t.parent_id)) (kids[t.parent_id] ??= []).push(t);
  const out = [];
  const walk = (t, depth) => { out.push(depth ? { ...t, _child: true } : t); (kids[t.id] || []).forEach((k) => walk(k, depth + 1)); };
  list.filter((t) => !(t.parent_id && ids.has(t.parent_id))).forEach((t) => walk(t, 0));
  return out;
}

// Значки под названием: обсуждение, чек-лист, подзадачи, ожидание других задач
function TaskMeta({ t }) {
  const items = [];
  if (t.comments_count > 0) items.push(<span key="c" className="text-violet font-medium inline-flex items-center gap-1"><MessageSquare size={12} />{t.comments_count}</span>);
  if (t.check_total > 0) items.push(<span key="k" className={cx('inline-flex items-center gap-1', t.check_done === t.check_total && 'text-emerald-600')}><ListChecks size={12} />{t.check_done}/{t.check_total}</span>);
  if (t.sub_total > 0) items.push(<span key="s" className="inline-flex items-center gap-1"><GitBranch size={12} />{t.sub_done}/{t.sub_total}</span>);
  if (t.blocked_count > 0 && t.status !== 'done') items.push(<span key="b" className="inline-flex items-center gap-1 text-amber-600 font-medium" title="Ждёт закрытия других задач"><Lock size={12} />ждёт {t.blocked_count}</span>);
  if (t.parent_id && !t._child && t.parent_title) items.push(<span key="p" className="inline-flex items-center gap-1 truncate max-w-56"><CornerDownRight size={12} />{t.parent_title}</span>);
  if (t.recurrence_id) items.push(<span key="r" className="inline-flex items-center gap-1" title="Повторяющаяся задача"><Repeat size={12} /></span>);
  return items.length ? <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[11.5px] text-ink-3">{items}</div> : null;
}

function Counter({ label, n, dot, tone }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border whitespace-nowrap',
      tone === 'red' ? 'border-red-200 bg-red-50 text-red-700' : 'border-line bg-canvas/60 text-ink-2', !n && tone !== 'red' && 'opacity-50')}>
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
      {label} <b className="font-semibold tabular">{n}</b>
    </span>
  );
}
