import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, Circle, CircleDot, Play, Pencil, Calendar, Clock, FolderOpen, Send, Trash2, MessageSquare, Paperclip, FileText,
  Download, Square, MoreHorizontal, Plus, X, Users, RotateCcw, Pause, PauseCircle, Lock, Timer, ChevronDown, Repeat,
} from 'lucide-react';
import { useApp, useNow, timerSeconds } from '../lib/store';
import { taskPerms } from '../lib/perms';
import { api, fileUrl, fmtSize } from '../lib/api';
import { TASK_STATUS } from '../lib/constants';
import { fmtDate, fmtDateTime, fmtHM, fmtHMS, fmtTime, todayStr, toDateStr, parseDate, plural } from '../lib/format';
import { ChecklistBlock, SubtasksBlock, DepsBlock } from './TaskExtras';
import { RecurrenceFields, recurrenceBody, ruleText } from './Recurrence';
import { Modal, Drawer, Field, Select, Button, IconButton, ConfirmButton, Spinner, Avatar, AvatarStack, UserPicker, Popover, MenuItem, Pill, Odometer, cx, userOptions, nameOptions, SearchList } from './ui';

export const isOverdue = (t) => t.status !== 'done' && t.due_date && t.due_date < todayStr();

// Иконка статуса задачи: клик переключает «открыта → в работе → закрыта → открыта»
const NEXT = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
export function TaskStatusButton({ task, onChange, size = 18 }) {
  const { user } = useApp();
  const Icon = task.status === 'done' ? CheckCircle2 : task.status === 'in_progress' ? CircleDot : Circle;
  if (!taskPerms(user, task).status) {
    return <span className="shrink-0" title={`${TASK_STATUS[task.status].label} — менять статус могут исполнитель, постановщик или администратор`}>
      <Icon size={size} className={task.status === 'done' ? 'text-emerald-500/60' : task.status === 'in_progress' ? 'text-amber-500/60' : 'text-ink-3/50'} /></span>;
  }
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onChange(NEXT[task.status]); }}
      title={`${TASK_STATUS[task.status].label} → ${TASK_STATUS[NEXT[task.status]].label}`} className="shrink-0">
      <Icon size={size} className={task.status === 'done' ? 'text-emerald-500' : task.status === 'in_progress' ? 'text-amber-500' : 'text-ink-3 hover:text-ink-2'} />
    </button>
  );
}

export function TaskStatusPill({ status }) {
  const s = TASK_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[12px] font-medium bg-canvas border border-line text-ink-2 whitespace-nowrap">
      <span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}
    </span>
  );
}

export function TaskStatusIcon({ status, size = 18 }) {
  const Icon = status === 'done' ? CheckCircle2 : status === 'in_progress' ? CircleDot : Circle;
  return <Icon size={size} className={cx('shrink-0', status === 'done' ? 'text-emerald-500' : status === 'in_progress' ? 'text-amber-500' : 'text-ink-3')} />;
}

function WorkClockChip({ timer }) {
  const now = useNow();
  return (
    <span className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full forest-pattern text-white text-[12px] font-semibold" title={timer.paused ? 'Таймер на паузе' : 'Идёт учёт времени'}>
      <span className={cx('size-1.5 rounded-full', timer.paused ? 'bg-amber-300' : 'bg-red-400 animate-pulse')} />
      <Odometer value={fmtHMS(timerSeconds(timer, now))} />
    </span>
  );
}

// Кнопки работы с задачей прямо в списке: «Взять в работу» → время → «Приостановить» / «Закрыть»
export function TaskWorkActions({ task: t, onStarted }) {
  const { user, timer, startWork, askWork } = useApp();
  if (!taskPerms(user, t).status || t.status === 'done') return null;
  const timerHere = timer && timer.task_id === t.id;
  const stop = (e) => e.stopPropagation();
  const start = async (e) => { stop(e); const nt = await startWork(t); if (nt) onStarted?.(nt); };
  if (t.status === 'todo' && t.blocked_count > 0) {
    return <span onClick={stop} title="Сначала нужно закрыть задачи, от которых зависит эта" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-amber-300 bg-amber-50 text-amber-700 text-[12px] font-medium whitespace-nowrap"><Lock size={12} />Ждёт задач</span>;
  }
  if (t.status === 'todo') {
    return (
      <button onClick={start} className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full bg-brand text-white text-[12.5px] font-semibold hover:bg-brand-strong transition-colors whitespace-nowrap">
        <Play size={12} fill="currentColor" />Взять в работу
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1.5" onClick={stop}>
      {timerHere ? <WorkClockChip timer={timer} />
        : <button onClick={start} title="Продолжить работу (запустить время)" className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-brand/40 text-brand text-[12px] font-semibold hover:bg-brand/5"><Play size={11} fill="currentColor" />Продолжить</button>}
      <button onClick={() => askWork(t, 'pause')} title="Приостановить (с отчётом)" className="size-8 rounded-full border border-line hover:bg-amber-50 hover:border-amber-300 text-amber-600 flex items-center justify-center"><PauseCircle size={16} /></button>
      <button onClick={() => askWork(t, 'close')} title="Закрыть задачу (с итогом)" className="size-8 rounded-full border border-line hover:bg-brand/5 hover:border-brand/40 text-brand flex items-center justify-center"><CheckCircle2 size={16} /></button>
    </div>
  );
}

/* ---------- Создание / редактирование задачи ---------- */
export function TaskFormModal({ open, onClose, task, projectId, onSaved }) {
  const { users, projects, toast, bump } = useApp();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(task ? { ...task } : { project_id: projectId || null, title: '', description: '', status: 'todo', assignee_id: null, due_date: null, coassignee_ids: [], observer_ids: [],
      repeat: false, freq: 'monthly', every: 1, next_date: todayStr(), due_days: 3, checklistText: '' });
  }, [open, task, projectId]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const submit = async (e) => {
    e?.preventDefault();
    const err = {};
    if (!f.project_id) err.project_id = 'Выберите проект';
    if (!f.title?.trim()) err.title = 'Укажите название задачи';
    if (!f.description?.trim()) err.description = 'Опишите, что нужно сделать';
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      const body = { project_id: +f.project_id, title: f.title.trim(), description: f.description.trim(),
        assignee_id: f.assignee_id ? +f.assignee_id : null, due_date: f.due_date || null,
        coassignee_ids: f.coassignee_ids || [], observer_ids: f.observer_ids || [] };
      const checklist = (f.checklistText || '').split('\n').map((x) => x.trim()).filter(Boolean);
      if (!task && f.repeat) {
        const r = await api.post('/recurrences', { ...body, checklist, ...recurrenceBody(f) });
        toast(`Повторяющаяся задача: ${ruleText(r)}. Следующая — ${fmtDate(r.next_date)}`);
        bump(); onClose(); return;
      }
      const saved = task ? await api.put(`/tasks/${task.id}`, body) : await api.post('/tasks', { ...body, checklist });
      toast(task ? 'Задача сохранена' : 'Задача создана');
      bump(); onSaved?.(saved); onClose();
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };

  const err = (k) => errors[k] && <span className="block text-[11.5px] text-red-600 mt-1">{errors[k]}</span>;
  return (
    <Modal open={open} onClose={onClose} title={task ? 'Редактировать задачу' : 'Новая задача'} width={600}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit} disabled={busy}>{task ? 'Сохранить' : 'Создать задачу'}</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Проект (организация)">
          <Select value={f.project_id} onChange={set('project_id')} placeholder="Выберите проект" search options={nameOptions(projects)} />
          {err('project_id')}
        </Field>
        <Field label="Название задачи">
          <input className={cx('input', errors.title && 'border-red-400')} value={f.title || ''} onChange={set('title')} autoFocus placeholder="Кратко: что сделать" />
          {err('title')}
        </Field>
        <Field label="Описание">
          <textarea className={cx('input', errors.description && 'border-red-400')} rows={5} value={f.description || ''} onChange={set('description')}
            placeholder="Подробности: где, что случилось, что ожидается в результате" />
          {err('description')}
        </Field>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Исполнитель">
            <Select value={f.assignee_id} onChange={set('assignee_id')} placeholder="Не назначен" search options={userOptions(users)} />
          </Field>
          {f.repeat ? <div /> : <Field label="Крайний срок"><input type="date" className="input" value={f.due_date || ''} onChange={set('due_date')} /></Field>}
          <Field label="Соисполнители"><UserPicker users={users} value={f.coassignee_ids || []} onChange={set('coassignee_ids')} /></Field>
          <Field label="Наблюдатели"><UserPicker users={users} value={f.observer_ids || []} onChange={set('observer_ids')} /></Field>
        </div>
        {!task && (<>
          <Field label="Чек-лист" hint="Необязательно. Каждая строка — отдельный пункт">
            <textarea className="input" rows={2} value={f.checklistText || ''} onChange={set('checklistText')} placeholder={'Купить кабель\nПротянуть линию\nПротестировать'} />
          </Field>
          <div className={cx('rounded-2xl border transition-colors', f.repeat ? 'border-brand/40 bg-brand/[.04]' : 'border-line')}>
            <label className="flex items-center gap-2.5 px-4 h-11 cursor-pointer text-[13.5px] font-medium">
              <input type="checkbox" checked={!!f.repeat} onChange={(e) => set('repeat')(e.target.checked)} className="accent-[var(--color-brand)] size-4" />
              <Repeat size={15} className="text-brand" />Повторять задачу
              {f.repeat && <span className="ml-auto text-[12px] text-ink-3 font-normal">{ruleText(f)}</span>}
            </label>
            {f.repeat && <div className="px-4 pb-4"><RecurrenceFields r={f} set={set} /></div>}
          </div>
        </>)}
      </form>
    </Modal>
  );
}

/* ---------- Карточка задачи: слева информация, справа обсуждение (в стиле CRM) ---------- */
function overdueText(due) {
  const days = Math.round((new Date(todayStr()) - new Date(due)) / 864e5);
  if (days < 1) return null;
  if (days < 31) return `просрочена на ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  const m = Math.floor(days / 30);
  return `просрочена на ${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}`;
}

function Section({ title, icon: Icon, action, children, className }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-panel', className)}>
      {title && (
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
          {Icon && <Icon size={15} className="text-ink-3" />}
          <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
          <div className="ml-auto">{action}</div>
        </div>
      )}
      <div className="px-4 pb-3.5 pt-2">{children}</div>
    </section>
  );
}
function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[118px_1fr] gap-3 items-center min-h-10 py-1">
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
function Person({ u, empty = 'Не назначен' }) {
  if (!u) return <span className="text-[13px] text-ink-3">{empty}</span>;
  return <span className="inline-flex items-center gap-2 text-[13px] text-ink"><Avatar user={u} size={24} ring={false} />{u.name}</span>;
}
function PersonPicker({ users, value, onChange, children }) {
  return (
    <Popover width={250} trigger={({ toggle }) => (
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 rounded-full hover:bg-canvas -ml-1.5 pl-1.5 pr-2 py-1">{children}<ChevronDown size={14} className="text-ink-3" /></button>
    )}>
      {({ close }) => <SearchList value={value} placeholder="Поиск сотрудника…" onEscape={close}
        items={[{ value: null, label: 'Не назначен', muted: true }, ...userOptions(users)]} onPick={(v) => { onChange(v); close(); }} />}
    </Popover>
  );
}
function PeopleChips({ users, ids, editable, onChange }) {
  const list = ids.map((id) => users.find((u) => u.id === id)).filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {list.map((u) => (
        <span key={u.id} className="inline-flex items-center gap-1.5 h-7 pl-0.5 pr-2 rounded-full border border-line bg-canvas/60 text-[12.5px] text-ink">
          <Avatar user={u} size={22} ring={false} />{u.name.split(' ')[0]}
          {editable && <button onClick={() => onChange(ids.filter((x) => x !== u.id))} title={`Убрать ${u.name}`} className="text-ink-3 hover:text-red-600"><X size={13} /></button>}
        </span>
      ))}
      {!list.length && !editable && <span className="text-[13px] text-ink-3">—</span>}
      {editable && (
        <Popover width={250} trigger={({ toggle }) => (
          <button type="button" onClick={toggle} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-line-strong text-[12.5px] text-ink-2 hover:bg-canvas hover:text-ink"><Plus size={13} />Добавить</button>
        )}>
          {({ close }) => <SearchList placeholder="Поиск сотрудника…" onEscape={close} empty="Некого добавить"
            items={userOptions(users).filter((o) => !ids.includes(o.value))} onPick={(id) => { onChange([...ids, id]); close(); }} />}
        </Popover>
      )}
    </div>
  );
}

export function TaskDrawer({ id: rootId, onClose }) {
  // Внутри карточки можно перейти к подзадаче/зависимости — показываем её, «назад» — к исходной
  const [id, setId] = useState(rootId);
  useEffect(() => { setId(rootId); }, [rootId]);
  const { user, users, toast, bump, pauseTimer, resumeTimer, timer, version, startWork, askWork } = useApp();
  const [t, setT] = useState(null);
  const [edit, setEdit] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const now = useNow();
  const fileInput = useRef(null);
  useEffect(() => {
    if (!id) { setT(null); return; }
    api.get(`/tasks/${id}`).then(setT).catch((e) => { toast(e.message, 'error'); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);
  useEffect(() => { setDescOpen(false); }, [id]);
  if (!id) return null;

  const userBy = (uid) => users.find((u) => u.id === uid);
  const perms = taskPerms(user, t);
  const patch = async (body) => {
    try { setT(await api.put(`/tasks/${id}`, body)); bump(); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => {
    try { await api.del(`/tasks/${id}`); toast('Задача удалена'); bump(); onClose(); } catch (e) { toast(e.message, 'error'); }
  };
  const upload = async (files) => {
    for (const f of [...(files || [])]) { try { await api.upload(`/tasks/${id}/files`, f); } catch (e) { toast(e.message, 'error'); } }
    bump();
  };

  const timerHere = timer && t && timer.task_id === t.id;
  const startHere = async () => { const nt = await startWork(t); if (nt) setT(nt); };
  const late = t && isOverdue(t) && overdueText(t.due_date);
  const participants = t ? [...new Set([t.created_by, t.assignee_id, ...t.coassignee_ids, ...t.observer_ids].filter(Boolean))].map(userBy).filter(Boolean) : [];
  const creator = t && (userBy(t.created_by) || (t.creator_name && { name: t.creator_name, color: t.creator_color }));

  return (
    <Drawer open={!!id} onClose={onClose} width={1240}
      title={t ? (
        <span className="flex items-center gap-2.5 min-w-0">
          <TaskStatusPill status={t.status} />
          <span className="truncate">{t.title}</span>
          {!perms.edit && t.status !== 'done' && <span title="Только просмотр"><Lock size={14} className="text-ink-3 shrink-0" /></span>}
        </span>
      ) : 'Задача'}
      actions={t && (perms.edit || perms.del) && (
        <Popover align="right" width={210} trigger={({ toggle }) => <IconButton icon={MoreHorizontal} size={32} title="Ещё" onClick={toggle} />}>
          {({ close }) => (<>
            {perms.edit && <MenuItem icon={Pencil} onClick={() => { close(); setEdit(true); }}>Редактировать</MenuItem>}
            {perms.del && <div className="px-1 pt-1"><ConfirmButton onConfirm={() => { close(); remove(); }}>Удалить задачу</ConfirmButton></div>}
          </>)}
        </Popover>
      )}>
      {!t ? <Spinner /> : (
        <div className="lg:h-full lg:grid lg:grid-cols-[minmax(380px,500px)_1fr]">
          {/* ---------- Информация ---------- */}
          <div className="lg:h-full flex flex-col lg:border-r border-line min-h-0 bg-canvas/50">
            <div className="flex-1 lg:overflow-y-auto p-4 space-y-3">
              <div className="flex items-center gap-1.5 text-[12.5px] text-ink-3 px-1">
                {id !== rootId && <button onClick={() => setId(rootId)} className="inline-flex items-center gap-1 mr-1.5 text-violet font-medium hover:underline">← Назад</button>}
                <FolderOpen size={14} /><span className="truncate">{t.project_name}</span><span>·</span><span>№ {t.id}</span>
                {t.parent_id && <><span>·</span><button onClick={() => setId(t.parent_id)} className="truncate hover:text-violet hover:underline">подзадача «{t.parent_title}»</button></>}
              </div>

              <Section title="Описание" action={perms.edit && <button onClick={() => setEdit(true)} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-violet hover:underline"><Pencil size={13} />Изменить</button>}>
                <div className={cx('text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words', !descOpen && 'line-clamp-6')}>
                  {t.description || <span className="text-ink-3">Без описания</span>}
                </div>
                {(t.description || '').length > 300 && (
                  <button onClick={() => setDescOpen((v) => !v)} className="mt-2 text-[12.5px] font-medium text-violet hover:underline">{descOpen ? 'Свернуть' : 'Показать полностью'}</button>
                )}
              </Section>

              <Section title="Участники" icon={Users}>
                <Row label="Постановщик"><Person u={creator} empty="—" /></Row>
                <Row label="Исполнитель">
                  {perms.edit ? <PersonPicker users={users} value={t.assignee_id} onChange={(v) => patch({ assignee_id: v })}><Person u={userBy(t.assignee_id)} /></PersonPicker> : <Person u={userBy(t.assignee_id)} />}
                </Row>
                <Row label="Соисполнители"><PeopleChips users={users} ids={t.coassignee_ids} editable={perms.edit} onChange={(v) => patch({ coassignee_ids: v })} /></Row>
                <Row label="Наблюдатели"><PeopleChips users={users} ids={t.observer_ids} editable={perms.edit} onChange={(v) => patch({ observer_ids: v })} /></Row>
              </Section>

              <Section title="Сроки и время" icon={Calendar}>
                <Row label="Крайний срок">
                  <div className="flex flex-wrap items-center gap-2">
                    {perms.edit ? (
                      <input type="date" value={t.due_date || ''} onChange={(e) => patch({ due_date: e.target.value || null })}
                        className={cx('input !h-8 !w-auto !rounded-full', late && '!text-red-600 !border-red-300')} />
                    ) : <span className={cx('text-[13px]', late ? 'text-red-600 font-medium' : 'text-ink')}>{t.due_date ? fmtDate(t.due_date, true) : 'Не указан'}</span>}
                    {late && <Pill color="#b91c1c" bg="#fee2e2">{late}</Pill>}
                  </div>
                </Row>
                <Row label="Создана"><span className="text-[13px] text-ink">{fmtDateTime(t.created_at)}</span></Row>
                {t.completed_at && <Row label="Закрыта"><span className="text-[13px] text-ink">{fmtDateTime(t.completed_at)}</span></Row>}
                <Row label="Затрачено"><span className="inline-flex items-center gap-1.5 text-[13px] text-ink tabular"><Clock size={14} className="text-ink-3" />{fmtHM(t.tracked_sec)} ч</span></Row>
              </Section>

              <Section title={`Файлы${t.files_count ? ` · ${t.files_count}` : ''}`} icon={Paperclip}
                action={t.status !== 'done' && <>
                  <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
                  <button onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-violet hover:underline"><Plus size={13} />Добавить</button>
                </>}>
                <TaskFiles taskId={t.id} />
              </Section>

              <ChecklistBlock task={t} canWork={perms.status} onChange={(checklist) => setT((x) => ({ ...x, checklist }))} />
              <SubtasksBlock task={t} canEdit={perms.status && t.status !== 'done'} onOpen={setId} onChanged={() => api.get(`/tasks/${id}`).then(setT)} />
              <DepsBlock task={t} canEdit={perms.edit} onOpen={setId} onChange={setT} />
            </div>

            {/* Действия */}
            <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 bg-panel border-t border-line">
              {perms.status ? (<>
                {t.status === 'todo' && <>
                  <Button variant="primary" size="lg" icon={Play} onClick={startHere}>Взять в работу</Button>
                  <Button size="lg" icon={CheckCircle2} onClick={() => askWork(t, 'close')} title="Закрыть без работы (например, дубликат)">Закрыть</Button>
                </>}
                {t.status === 'in_progress' && <>
                  {timerHere ? (
                    <button onClick={timer.paused ? resumeTimer : pauseTimer} title={timer.paused ? 'Таймер на паузе — продолжить' : 'Короткий перерыв (пауза таймера)'}
                      className="flex items-center gap-2 h-10 pl-3 pr-4 rounded-full forest-pattern text-white font-semibold shadow-[0_10px_22px_-12px_rgba(14,47,32,.9)] hover:brightness-110">
                      <span className={cx('size-2 rounded-full', timer.paused ? 'bg-amber-300' : 'bg-red-400 animate-pulse')} />
                      <Odometer value={fmtHMS(timerSeconds(timer, now))} className={cx('text-[14px]', timer.paused && 'opacity-70')} />
                    </button>
                  ) : (
                    <Button variant="primary" size="lg" icon={Play} onClick={startHere} title="Время по задаче сейчас не идёт">Продолжить работу</Button>
                  )}
                  <Button size="lg" icon={PauseCircle} onClick={() => askWork(t, 'pause')}>Приостановить</Button>
                  <Button variant={timerHere ? 'primary' : 'default'} size="lg" icon={CheckCircle2} onClick={() => askWork(t, 'close')}>Закрыть задачу</Button>
                </>}
                {t.status === 'done' && <Button size="lg" icon={RotateCcw} onClick={() => patch({ status: 'todo' })}>Возобновить</Button>}
              </>) : (
                <span className="text-[12px] text-ink-3 inline-flex items-center gap-1.5"><Lock size={13} />Работать с задачей могут исполнитель, соисполнители, постановщик или администратор</span>
              )}
            </div>
          </div>

          {/* ---------- Обсуждение ---------- */}
          <div className="h-[80vh] lg:h-full min-h-0"><TaskChat taskId={t.id} participants={participants} /></div>
        </div>
      )}
      <TaskFormModal open={edit} task={t} onClose={() => setEdit(false)} onSaved={setT} />
    </Drawer>
  );
}

function TaskFiles({ taskId }) {
  const { version } = useApp();
  const [files, setFiles] = useState([]);
  useEffect(() => { api.get(`/tasks/${taskId}/files`).then(setFiles).catch(() => {}); }, [taskId, version]);
  if (!files.length) return <div className="text-[12.5px] text-ink-3">Файлов нет — прикрепите здесь или перетащите в обсуждение.</div>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {files.map((f) => {
        const ext = (f.name.includes('.') ? f.name.split('.').pop() : '').slice(0, 4).toUpperCase();
        const img = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime || '');
        return (
          <a key={f.id} href={fileUrl(f.id)} title={`${f.name} — скачать`}
            className="group flex items-center gap-2.5 p-2 rounded-xl border border-line hover:border-violet/40 hover:bg-canvas/60 min-w-0">
            {img ? <img src={fileUrl(f.id, true)} alt="" className="size-10 rounded-lg object-cover shrink-0" />
              : <span className="size-10 rounded-lg bg-violet/10 text-violet flex items-center justify-center text-[10px] font-bold shrink-0">{ext || <FileText size={18} />}</span>}
            <span className="min-w-0">
              <span className="block text-[12.5px] text-ink truncate">{f.name}</span>
              <span className="block text-[11px] text-ink-3">{fmtSize(f.size)}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

/* ---------- Обсуждение задачи ---------- */
const POLL_MS = 8000;
function dayLabel(d) {
  const key = toDateStr(d);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (key === toDateStr(today)) return 'Сегодня';
  if (key === toDateStr(yest)) return 'Вчера';
  return fmtDate(d);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function MessageText({ text, users, mine }) {
  const re = useMemo(() => {
    const names = users.map((u) => u.name).filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe);
    return names.length ? new RegExp(`@(${names.join('|')})`, 'g') : null;
  }, [users]);
  if (!re || !text) return text;
  const out = []; let last = 0; let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className={cx('font-semibold rounded px-0.5', mine ? 'bg-white/20' : 'text-violet bg-violet/10')}>@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function FileCard({ c, mine, onLoad }) {
  const isImg = /^image\/(png|jpe?g|gif|webp)$/.test(c.file_mime || '');
  if (isImg) {
    return (
      <a href={fileUrl(c.file_id)} title={`${c.file_name} — скачать`} className="block">
        <img src={fileUrl(c.file_id, true)} alt={c.file_name} className="max-w-[280px] max-h-[280px] rounded-xl object-cover" onLoad={onLoad} />
      </a>
    );
  }
  const ext = (c.file_name?.includes('.') ? c.file_name.split('.').pop() : '').slice(0, 4).toUpperCase();
  return (
    <a href={fileUrl(c.file_id)} className={cx('group/file flex items-center gap-2.5 p-2 pr-3 rounded-xl', mine ? 'bg-white/15 hover:bg-white/25' : 'bg-canvas hover:bg-line/60')}>
      <span className={cx('size-10 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0', mine ? 'bg-white/25 text-white' : 'bg-violet/10 text-violet')}>{ext || <FileText size={18} />}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium truncate max-w-[240px]">{c.file_name}</span>
        <span className={cx('block text-[11.5px]', mine ? 'text-white/70' : 'text-ink-3')}>{fmtSize(c.file_size || 0)}</span>
      </span>
      <Download size={15} className={cx('shrink-0 ml-1', mine ? 'text-white/70' : 'text-ink-3')} />
    </a>
  );
}

export function TaskChat({ taskId, participants = [] }) {
  const { user, users, isManager, toast, bump, version } = useApp();
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [mention, setMention] = useState(null);
  const [focused, setFocused] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const stick = useRef(true);
  const serverLast = useRef(0); // последний id, полученный с сервера (свои отправленные его не двигают)

  const load = useCallback(async (full = false) => {
    const after = full ? 0 : serverLast.current;
    const fresh = await api.get(`/tasks/${taskId}/comments${after ? `?after=${after}` : ''}`);
    if (fresh.length) serverLast.current = Math.max(serverLast.current, fresh[fresh.length - 1].id);
    setItems((cur) => {
      if (full || !cur) return fresh;
      if (!fresh.length) return cur;
      const have = new Set(cur.map((c) => c.id));
      return [...cur, ...fresh.filter((f) => !have.has(f.id))].sort((a, b) => a.id - b.id);
    });
  }, [taskId]);

  useEffect(() => { setItems(null); serverLast.current = 0; stick.current = true; load(true).catch(() => setItems([])); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (items) load().catch(() => {}); }, [version]);
  const toBottom = () => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight; };
  useLayoutEffect(toBottom, [items]);

  const append = (c) => { stick.current = true; setItems((cur) => (cur?.some((x) => x.id === c.id) ? cur : [...(cur || []), c].sort((a, b) => a.id - b.id))); };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      append(await api.post(`/tasks/${taskId}/comments`, { body }));
      setText(''); setMention(null);
      if (inputRef.current) inputRef.current.style.height = 'auto';
      inputRef.current?.focus();
      bump();
    } catch (e) { toast(e.message, 'error'); } finally { setSending(false); }
  };
  const uploadFiles = async (list) => {
    for (const f of [...(list || [])]) {
      if (f.size > 25 * 1024 * 1024) { toast(`«${f.name}» больше 25 МБ`, 'error'); continue; }
      setUploading((n) => n + 1);
      try { append(await api.upload(`/tasks/${taskId}/files`, f)); } catch (e) { toast(e.message, 'error'); } finally { setUploading((n) => n - 1); }
    }
    bump();
  };
  const del = async (cid) => {
    try { await api.del(`/task-comments/${cid}`); setItems((cur) => cur.filter((c) => c.id !== cid)); bump(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const candidates = mention ? users.filter((u) => u.active && u.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : [];
  const onChange = (e) => {
    const v = e.target.value; setText(v);
    const caret = e.target.selectionStart;
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(v.slice(0, caret));
    setMention(m ? { query: m[2], start: caret - m[2].length - 1, index: 0 } : null);
    e.target.style.height = 'auto'; e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
  };
  const pickMention = (u) => {
    const caret = inputRef.current.selectionStart;
    setText(`${text.slice(0, mention.start)}@${u.name} ${text.slice(caret)}`);
    const pos = mention.start + u.name.length + 2;
    setMention(null);
    requestAnimationFrame(() => { inputRef.current.focus(); inputRef.current.setSelectionRange(pos, pos); });
  };
  const onKeyDown = (e) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index + 1) % candidates.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMention((m) => ({ ...m, index: (m.index - 1 + candidates.length) % candidates.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(candidates[mention.index] || candidates[0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  const count = items ? items.filter((c) => c.kind === 'text').length : 0;
  let prevDay = null; let prev = null;
  return (
    <div className="h-full flex flex-col relative bg-panel"
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); }}>
      {/* Шапка */}
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-line shrink-0">
        <MessageSquare size={17} className="text-ink-2" />
        <h3 className="text-[14px] font-semibold">Обсуждение</h3>
        {count > 0 && <span className="text-[11px] text-ink-3 bg-canvas rounded-full px-1.5">{count}</span>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-ink-3 hidden sm:inline">{participants.length} {plural(participants.length, 'участник', 'участника', 'участников')}</span>
          <AvatarStack users={participants} max={5} size={26} />
        </div>
      </div>

      {/* Лента */}
      <div ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
        className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 py-4 bg-canvas/70">
        {items === null ? <Spinner /> : items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="size-12 rounded-2xl bg-panel border border-line flex items-center justify-center text-ink-3 mb-3"><MessageSquare size={22} /></div>
            <div className="font-semibold text-[14px]">Обсуждения пока нет</div>
            <div className="text-ink-3 text-[13px] mt-1 max-w-xs">Напишите сообщение — участники задачи увидят его здесь</div>
          </div>
        ) : items.map((c) => {
          const d = parseDate(c.created_at);
          const day = toDateStr(d);
          const showDay = day !== prevDay;
          const grouped = !showDay && prev && prev.kind === 'text' && c.kind === 'text' && prev.user_id === c.user_id && d - parseDate(prev.created_at) < 5 * 60e3;
          prevDay = day; prev = c;
          const mine = c.user_id === user.id;
          return (
            <div key={c.id}>
              {showDay && (
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-line" />
                  <span className="text-[11.5px] font-medium text-ink-3">{dayLabel(d)}</span>
                  <div className="flex-1 h-px bg-line" />
                </div>
              )}
              {c.report ? (
                <div className="my-3 flex justify-center">
                  <div className={cx('w-full max-w-[560px] rounded-2xl border bg-panel overflow-hidden', c.report === 'close' ? 'border-brand/30' : 'border-amber-300/60')}>
                    <div className={cx('flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold', c.report === 'close' ? 'bg-brand/[.07] text-brand' : 'bg-amber-50 text-amber-700')}>
                      {c.report === 'close' ? <CheckCircle2 size={16} /> : <PauseCircle size={16} />}
                      {c.report === 'close' ? 'Задача закрыта' : 'Работа приостановлена'}
                      {c.report_sec > 0 && <span className="ml-auto inline-flex items-center gap-1 font-medium tabular"><Clock size={13} />{fmtHMS(c.report_sec)}</span>}
                    </div>
                    <div className="px-4 py-3">
                      <div className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words"><MessageText text={c.body} users={users} /></div>
                      <div className="flex items-center gap-2 mt-2.5 text-[11.5px] text-ink-3">
                        <Avatar user={{ name: c.user_name || '?', color: c.user_color }} size={18} ring={false} />
                        <span className="font-medium text-ink-2">{mine ? 'Вы' : c.user_name}</span><span>· {fmtDateTime(c.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : c.kind === 'system' ? (
                <div className="flex items-center justify-center gap-1.5 my-2 text-[12px] text-ink-3">
                  <span className="size-1.5 rounded-full bg-line-strong" />
                  <span><b className="font-medium text-ink-2">{c.user_name || 'Система'}</b> {c.body}</span>
                  <span className="tabular">· {fmtTime(d)}</span>
                </div>
              ) : (
                <div className={cx('group flex items-end gap-2', mine && 'flex-row-reverse', grouped ? 'mt-1' : 'mt-3')}>
                  <div className="w-8 shrink-0">{!mine && !grouped && <Avatar user={{ name: c.user_name || '?', color: c.user_color }} size={32} ring={false} />}</div>
                  <div className={cx('max-w-[75%] flex flex-col', mine ? 'items-end' : 'items-start')}>
                    {!grouped && (
                      <div className={cx('flex items-center gap-1.5 mb-1 px-1 text-[11.5px]', mine && 'flex-row-reverse')}>
                        <span className="font-semibold text-ink-2">{mine ? 'Вы' : c.user_name}</span>
                        <span className="text-ink-3 tabular">{fmtTime(d)}</span>
                      </div>
                    )}
                    <div title={fmtDateTime(c.created_at)}
                      className={cx('text-[13.5px] leading-relaxed whitespace-pre-wrap break-words',
                        c.file_id && !c.body && /^image\//.test(c.file_mime || '') ? 'p-0'
                          : cx('px-3.5 py-2', mine ? 'bg-violet text-white rounded-2xl rounded-tr-md' : 'bg-panel border border-line text-ink rounded-2xl rounded-tl-md',
                            c.file_id && !c.body && 'p-1.5'))}>
                      {c.file_id && <FileCard c={c} mine={mine} onLoad={toBottom} />}
                      {c.body && <div className={c.file_id ? 'mt-1.5 px-2' : ''}><MessageText text={c.body} users={users} mine={mine} /></div>}
                    </div>
                  </div>
                  {(mine || isManager) && (
                    <button onClick={() => del(c.id)} title="Удалить сообщение" className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-ink-3 hover:text-red-600 hover:bg-red-50 self-center"><Trash2 size={13} /></button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {uploading > 0 && <div className="flex justify-end mt-2"><span className="text-[12px] bg-panel border border-line rounded-full px-3 py-1 text-ink-2">Загрузка файла…</span></div>}
      </div>

      {/* Ввод */}
      <div className="relative shrink-0 border-t border-line bg-panel px-4 py-3">
        {mention && candidates.length > 0 && (
          <div className="absolute bottom-full left-4 mb-2 w-80 bg-panel border border-line rounded-xl shadow-xl p-1.5 anim-pop z-10">
            <div className="px-2 py-1 text-[11px] font-medium text-ink-3">Упомянуть</div>
            {candidates.map((u, i) => (
              <button key={u.id} onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}
                className={cx('w-full flex items-center gap-2 px-2 h-9 rounded-lg text-[13px] text-left', i === mention.index ? 'bg-canvas' : 'hover:bg-canvas')}>
                <Avatar user={u} size={22} ring={false} /><span className="whitespace-nowrap">{u.name}</span>
                <span className="ml-auto text-[11px] text-ink-3 truncate min-w-0">{u.position}</span>
              </button>
            ))}
          </div>
        )}
        <div className={cx('flex items-end gap-1.5 rounded-2xl border bg-panel pl-1.5 pr-1.5 py-1.5 transition-shadow',
          focused ? 'border-violet/60 ring-3 ring-violet/10' : 'border-line-strong')}>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} title="Прикрепить файл (до 25 МБ)"
            className="size-9 shrink-0 rounded-full text-ink-3 hover:text-ink hover:bg-canvas flex items-center justify-center"><Paperclip size={17} /></button>
          <textarea ref={inputRef} value={text} rows={1} onChange={onChange} onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setTimeout(() => setMention(null), 150); }}
            placeholder="Сообщение… (@ — упомянуть коллегу)" title="Enter — отправить, Shift+Enter — новая строка"
            className="flex-1 resize-none outline-none text-[13.5px] bg-transparent py-2 max-h-40 placeholder:text-ink-3" style={{ minHeight: 36 }} />
          <button onClick={send} disabled={!text.trim() || sending} title="Отправить (Enter)"
            className="size-9 shrink-0 rounded-full bg-violet text-white flex items-center justify-center disabled:opacity-40 hover:bg-violet/90"><Send size={15} /></button>
        </div>
        <div className="mt-1.5 px-1 text-[11px] text-ink-3">Enter — отправить · Shift+Enter — новая строка · файлы можно перетащить сюда</div>
      </div>

      {drag && (
        <div className="absolute inset-0 z-20 bg-violet/5 border-2 border-dashed border-violet/60 rounded-none flex items-center justify-center pointer-events-none">
          <div className="bg-panel rounded-2xl px-5 py-3 text-[14px] font-medium shadow-lg flex items-center gap-2"><Paperclip size={18} className="text-violet" />Отпустите, чтобы прикрепить</div>
        </div>
      )}
    </div>
  );
}
