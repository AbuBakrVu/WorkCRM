import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, Circle, CircleDot, Play, Pencil, Calendar, Clock, FolderOpen, Send, Trash2, MessageSquare, Paperclip, FileText,
  Download, Check, Square, MoreHorizontal, Plus, X, Hourglass, Loader, CheckCheck, Eye, Users, UserRound, RotateCcw, Pause, Lock,
} from 'lucide-react';
import { useApp, useNow } from '../lib/store';
import { taskPerms } from '../lib/perms';
import { api, fileUrl, fmtSize } from '../lib/api';
import { TASK_STATUS } from '../lib/constants';
import { fmtDate, fmtDateTime, fmtHM, fmtHMS, fmtTime, todayStr, toDateStr, parseDate, plural } from '../lib/format';
import { Modal, Drawer, Field, Select, Button, ConfirmButton, Spinner, Avatar, AvatarStack, UserPicker, Popover, MenuItem, cx } from './ui';

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

/* ---------- Создание / редактирование задачи ---------- */
export function TaskFormModal({ open, onClose, task, projectId, onSaved }) {
  const { users, projects, toast, bump } = useApp();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(task ? { ...task } : { project_id: projectId || null, title: '', description: '', status: 'todo', assignee_id: null, due_date: null, coassignee_ids: [], observer_ids: [] });
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
      const saved = task ? await api.put(`/tasks/${task.id}`, body) : await api.post('/tasks', body);
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
          <Select value={f.project_id} onChange={set('project_id')} placeholder="Выберите проект" options={projects.map((p) => ({ value: p.id, label: p.name }))} />
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
            <Select value={f.assignee_id} onChange={set('assignee_id')} placeholder="Не назначен" options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }))} />
          </Field>
          <Field label="Крайний срок"><input type="date" className="input" value={f.due_date || ''} onChange={set('due_date')} /></Field>
          <Field label="Соисполнители"><UserPicker users={users} value={f.coassignee_ids || []} onChange={set('coassignee_ids')} /></Field>
          <Field label="Наблюдатели"><UserPicker users={users} value={f.observer_ids || []} onChange={set('observer_ids')} /></Field>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Карточка задачи (как в Битрикс24): слева информация, справа чат ---------- */
const STATUS_VIEW = {
  todo: { icon: Hourglass, text: 'Ждёт выполнения', cls: 'text-[#2f6fd1]' },
  in_progress: { icon: Loader, text: 'Выполняется', cls: 'text-amber-600' },
  done: { icon: CheckCircle2, text: 'Завершена', cls: 'text-emerald-600' },
};
function overdueText(due) {
  const days = Math.round((new Date(todayStr()) - new Date(due)) / 864e5);
  if (days < 1) return null;
  if (days < 31) return `Просрочена на ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  const m = Math.floor(days / 30);
  return `Просрочена на ${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}`;
}

function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 items-start py-2.5">
      <div className="text-[13.5px] text-ink-3 pt-1">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
function Person({ u, muted }) {
  if (!u) return <span className="text-[14px] text-ink-3">{muted || 'Не назначен'}</span>;
  return (
    <span className="inline-flex items-center gap-2 text-[14px] text-ink">
      <Avatar user={u} size={26} ring={false} />{u.name}
    </span>
  );
}

// Выбор одного человека (исполнитель)
function PersonPicker({ users, value, onChange, children }) {
  return (
    <Popover width={260} trigger={({ toggle }) => <button type="button" onClick={toggle} className="text-left rounded-lg hover:bg-canvas -mx-1.5 px-1.5 py-0.5">{children}</button>}>
      {({ close }) => (<div className="max-h-72 overflow-y-auto">
        <MenuItem checked={!value} onClick={() => { onChange(null); close(); }}>Не назначен</MenuItem>
        {users.filter((u) => u.active).map((u) => (
          <MenuItem key={u.id} checked={u.id === value} onClick={() => { onChange(u.id); close(); }}>{u.name}</MenuItem>
        ))}
      </div>)}
    </Popover>
  );
}
// Список людей (соисполнители / наблюдатели) с добавлением и удалением
function PeopleList({ users, ids, editable, onChange, empty }) {
  const list = ids.map((id) => users.find((u) => u.id === id)).filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {list.map((u) => (
        <span key={u.id} className="group inline-flex items-center gap-2 text-[14px] text-ink">
          <Avatar user={u} size={26} ring={false} />{u.name}
          {editable && <button onClick={() => onChange(ids.filter((x) => x !== u.id))} title="Убрать" className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-red-600"><X size={14} /></button>}
        </span>
      ))}
      {!list.length && !editable && <span className="text-[14px] text-ink-3">{empty}</span>}
      {editable && (
        <Popover width={260} trigger={({ toggle }) => (
          <button type="button" onClick={toggle} className="inline-flex items-center gap-1 text-[13px] text-[#2f6fd1] hover:underline"><Plus size={14} />Добавить</button>
        )}>
          {({ close }) => (<div className="max-h-72 overflow-y-auto">
            {users.filter((u) => u.active && !ids.includes(u.id)).map((u) => (
              <MenuItem key={u.id} onClick={() => { onChange([...ids, u.id]); close(); }}>{u.name}</MenuItem>
            ))}
          </div>)}
        </Popover>
      )}
    </div>
  );
}

export function TaskDrawer({ id, onClose }) {
  const { user, users, toast, bump, startTimer, stopTimer, timer, version } = useApp();
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
    for (const f of [...(files || [])]) {
      try { await api.upload(`/tasks/${id}/files`, f); } catch (e) { toast(e.message, 'error'); }
    }
    bump();
  };

  const timerHere = timer && t && timer.task_id === t.id;
  const sv = t && STATUS_VIEW[t.status];
  const late = t && isOverdue(t) && overdueText(t.due_date);
  const participants = t ? new Set([t.created_by, t.assignee_id, ...t.coassignee_ids, ...t.observer_ids].filter(Boolean)) : new Set();

  return (
    <Drawer open={!!id} onClose={onClose} width={1280} title={t ? <span className="flex items-center gap-2">{t.title}{!perms.edit && t.status !== 'done' && <Lock size={14} className="text-ink-3" title="Только просмотр" />}</span> : 'Задача'}>
      {!t ? <Spinner /> : (
        <div className="lg:h-full lg:grid lg:grid-cols-[minmax(380px,560px)_1fr]">
          {/* ---------- Левая колонка ---------- */}
          <div className="lg:h-full flex flex-col bg-[#eef2f6] lg:border-r border-line min-h-0">
            <div className="flex-1 lg:overflow-y-auto p-4 space-y-3">
              {/* Описание */}
              <section className="bg-panel rounded-2xl p-5">
                <div className={cx('text-[14.5px] text-ink leading-relaxed whitespace-pre-wrap break-words', !descOpen && 'line-clamp-6')}>
                  {t.description || <span className="text-ink-3">Без описания</span>}
                </div>
                <div className="flex items-center justify-between mt-4 text-[14px]">
                  {perms.edit ? <button onClick={() => setEdit(true)} className="inline-flex items-center gap-1.5 text-[#2f6fd1] hover:underline"><Pencil size={15} />Изменить</button> : <span />}
                  <div className="flex items-center gap-4">
                    {t.files_count > 0 && <span className="inline-flex items-center gap-1 text-[#2f6fd1]"><Paperclip size={15} />{t.files_count}</span>}
                    {(t.description || '').length > 300 && (
                      <button onClick={() => setDescOpen((v) => !v)} className="text-[#2f6fd1] hover:underline">{descOpen ? 'Свернуть' : 'Развернуть'}</button>
                    )}
                  </div>
                </div>
              </section>

              {/* Люди, сроки, статус */}
              <section className="bg-panel rounded-2xl px-5 py-2 divide-y divide-line">
                <div>
                  <InfoRow label="Постановщик"><Person u={userBy(t.created_by) || (t.creator_name && { name: t.creator_name, color: t.creator_color })} muted="—" /></InfoRow>
                  <InfoRow label="Исполнитель">
                    {perms.edit
                      ? <PersonPicker users={users} value={t.assignee_id} onChange={(v) => patch({ assignee_id: v })}><Person u={userBy(t.assignee_id)} /></PersonPicker>
                      : <Person u={userBy(t.assignee_id)} />}
                  </InfoRow>
                  <InfoRow label="Соисполнители">
                    <PeopleList users={users} ids={t.coassignee_ids} editable={perms.edit} empty="—" onChange={(v) => patch({ coassignee_ids: v })} />
                  </InfoRow>
                  <InfoRow label="Наблюдатели">
                    <PeopleList users={users} ids={t.observer_ids} editable={perms.edit} empty="—" onChange={(v) => patch({ observer_ids: v })} />
                  </InfoRow>
                  <InfoRow label="Крайний срок">
                    <div className="flex flex-wrap items-center gap-2">
                      {perms.edit ? (
                        <input type="date" value={t.due_date || ''} onChange={(e) => patch({ due_date: e.target.value || null })}
                          className={cx('h-9 px-3 rounded-full text-[14px] outline-none border', late ? 'bg-red-50 border-red-200 text-red-600' : 'bg-canvas border-line text-ink')} />
                      ) : (
                        <span className={cx('inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[14px]', late ? 'bg-red-50 text-red-600' : 'bg-canvas text-ink')}>
                          <Calendar size={15} />{t.due_date ? fmtDate(t.due_date, true) : 'Не указан'}
                        </span>
                      )}
                      {late && <span className="inline-flex items-center h-7 px-2.5 rounded-full border border-red-300 text-red-600 text-[12.5px]">{late}</span>}
                    </div>
                  </InfoRow>
                </div>
                <div>
                  <InfoRow label="Статус">
                    <span className={cx('inline-flex items-center gap-2 text-[14px]', sv.cls)}><sv.icon size={17} /><span className="text-ink">{sv.text}</span></span>
                  </InfoRow>
                  <InfoRow label="Дата создания">
                    <span className="inline-flex items-center gap-2 text-[14px] text-ink"><Calendar size={16} className="text-[#2f6fd1]" />{fmtDateTime(t.created_at)}<span className="text-ink-3">/ ID: {t.id}</span></span>
                  </InfoRow>
                  {t.completed_at && <InfoRow label="Завершена"><span className="text-[14px] text-ink">{fmtDateTime(t.completed_at)}</span></InfoRow>}
                  <InfoRow label="Затрачено"><span className="text-[14px] text-ink tabular">{fmtHM(t.tracked_sec)} ч</span></InfoRow>
                </div>
              </section>

              {/* Файлы */}
              <section className="bg-panel rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Paperclip size={17} className="text-[#2f6fd1]" />
                  <span className="text-[15px] font-semibold">Файлы: {t.files_count}</span>
                  <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
                  {t.status !== 'done' && <button onClick={() => fileInput.current?.click()} className="ml-auto p-1 rounded hover:bg-canvas text-ink-3" title="Добавить файл"><Plus size={18} /></button>}
                </div>
                <TaskFiles taskId={t.id} />
              </section>

              {/* Проект */}
              <section className="bg-panel rounded-2xl px-5 py-2">
                <InfoRow label="Проект"><span className="inline-flex items-center gap-2 text-[14px] text-ink"><FolderOpen size={17} className="text-emerald-600" />{t.project_name}</span></InfoRow>
              </section>
            </div>

            {/* Нижняя панель действий */}
            <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-3 bg-panel border-t border-line">
              {perms.status && t.status === 'todo' && <button onClick={() => patch({ status: 'in_progress' })} className="h-10 px-5 rounded-xl bg-[#2f6fd1] hover:bg-[#2a63bc] text-white text-[14px] font-semibold">Начать</button>}
              {perms.status && t.status === 'in_progress' && <button onClick={() => patch({ status: 'todo' })} className="h-10 px-4 rounded-xl border border-line-strong hover:bg-canvas text-[14px] font-medium inline-flex items-center gap-1.5"><Pause size={15} />Пауза</button>}
              {perms.status && t.status !== 'done' && <button onClick={() => patch({ status: 'done' })} className={cx('h-10 px-5 rounded-xl text-[14px] font-semibold', t.status === 'in_progress' ? 'bg-[#2f6fd1] hover:bg-[#2a63bc] text-white' : 'border border-line-strong hover:bg-canvas')}>Завершить</button>}
              {perms.status && t.status === 'done' && <button onClick={() => patch({ status: 'todo' })} className="h-10 px-5 rounded-xl border border-line-strong hover:bg-canvas text-[14px] font-medium inline-flex items-center gap-1.5"><RotateCcw size={15} />Возобновить</button>}
              {!perms.status && <span className="text-[12.5px] text-ink-3 inline-flex items-center gap-1.5"><Lock size={13} />Статус меняют исполнитель, постановщик или администратор</span>}

              {t.status !== 'done' && (timerHere ? (
                <button onClick={stopTimer} className="h-10 pl-2 pr-3.5 rounded-xl bg-violet text-white text-[14px] font-semibold inline-flex items-center gap-2" title="Остановить таймер">
                  <span className="size-6 rounded-full bg-white/20 flex items-center justify-center"><Square size={11} fill="currentColor" /></span>
                  <span className="tabular">{fmtHMS((now - new Date(timer.started_at)) / 1000)}</span>
                </button>
              ) : (
                <button onClick={() => startTimer({ project_id: t.project_id, task_id: t.id, description: t.title })}
                  className="h-10 px-3.5 rounded-xl border border-line-strong hover:bg-canvas text-[14px] font-medium inline-flex items-center gap-1.5" title={timer ? 'Сейчас идёт таймер по другой работе — он будет остановлен' : 'Запустить учёт времени'}>
                  <Play size={15} />Таймер
                </button>
              ))}

              {(perms.edit || perms.del) && (
                <Popover align="left" width={220} trigger={({ toggle }) => (
                  <button onClick={toggle} className="h-10 w-10 rounded-xl hover:bg-canvas text-ink-2 inline-flex items-center justify-center"><MoreHorizontal size={20} /></button>
                )}>
                  {({ close }) => (<>
                    {perms.edit && <MenuItem icon={Pencil} onClick={() => { close(); setEdit(true); }}>Редактировать</MenuItem>}
                    {perms.del && <div className="px-1 pt-1"><ConfirmButton onConfirm={() => { close(); remove(); }}>Удалить задачу</ConfirmButton></div>}
                  </>)}
                </Popover>
              )}
              <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-ink-3" title="Участники задачи"><Eye size={16} />{participants.size}</span>
            </div>
          </div>

          {/* ---------- Чат ---------- */}
          <div className="h-[80vh] lg:h-full min-h-0">
            <TaskChat taskId={t.id} participants={[...participants].map(userBy).filter(Boolean)} />
          </div>
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
  if (!files.length) return <div className="text-[13px] text-ink-3">Файлов нет. Их можно прикрепить здесь или прямо в чате.</div>;
  return (
    <div className="flex flex-wrap gap-3">
      {files.map((f) => {
        const ext = (f.name.split('.').pop() || '').slice(0, 4).toUpperCase();
        const img = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime || '');
        return (
          <a key={f.id} href={fileUrl(f.id)} title={`${f.name} · ${fmtSize(f.size)}`}
            className="w-[128px] rounded-xl border border-line hover:border-[#2f6fd1]/50 hover:shadow-sm p-2.5 flex flex-col items-center text-center">
            {img ? <img src={fileUrl(f.id, true)} alt="" className="h-14 w-full object-cover rounded-md" />
              : <div className="h-14 flex items-center justify-center relative"><FileText size={40} strokeWidth={1.2} className="text-ink-3" />
                  {ext && <span className="absolute bottom-2 text-[8.5px] font-bold px-1 rounded bg-emerald-600 text-white">{ext}</span>}</div>}
            <div className="text-[11.5px] text-ink-2 mt-1.5 line-clamp-2 break-all">{f.name}</div>
          </a>
        );
      })}
    </div>
  );
}

/* ---------- Чат задачи ---------- */
const POLL_MS = 8000;
const CHAT_BG = {
  backgroundColor: '#8aa4d6',
  backgroundImage: "radial-gradient(rgba(255,255,255,.18) 1.4px, transparent 1.5px), radial-gradient(rgba(255,255,255,.10) 1px, transparent 1.1px), linear-gradient(160deg, #9ab5e0 0%, #8399d6 55%, #7d8fd3 100%)",
  backgroundSize: '26px 26px, 40px 40px, 100% 100%',
  backgroundPosition: '0 0, 13px 20px, 0 0',
};
function dayLabel(d) {
  const key = toDateStr(d);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (key === toDateStr(today)) return 'Сегодня';
  if (key === toDateStr(yest)) return 'Вчера';
  const wd = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][d.getDay()];
  return `${wd}, ${fmtDate(d)}`;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LINK = 'text-[#2f6fd1] border-b border-dotted border-[#2f6fd1]/60';

function MessageText({ text, users }) {
  const re = useMemo(() => {
    const names = users.map((u) => u.name).filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe);
    return names.length ? new RegExp(`@(${names.join('|')})`, 'g') : null;
  }, [users]);
  if (!re || !text) return text;
  const out = []; let last = 0; let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className={LINK}>{m[1]}</span>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function FileCard({ c, onLoad }) {
  const isImg = /^image\/(png|jpe?g|gif|webp)$/.test(c.file_mime || '');
  if (isImg) {
    return (
      <a href={fileUrl(c.file_id)} title={`${c.file_name} — скачать`} className="block">
        <img src={fileUrl(c.file_id, true)} alt={c.file_name} className="max-w-[300px] max-h-[300px] rounded-xl object-cover" onLoad={onLoad} />
      </a>
    );
  }
  return (
    <a href={fileUrl(c.file_id)} className="group/file flex items-center gap-3 pl-3 pr-1 py-1 border-l-[3px] border-[#3aa0e8]">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-ink">Файлы</div>
        <div className="text-[14px] text-ink truncate max-w-[300px]">{c.file_name}</div>
        <div className="text-[11.5px] text-ink-3">{fmtSize(c.file_size || 0)}</div>
      </div>
      <Download size={16} className="text-ink-3 group-hover/file:text-ink shrink-0" />
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

  let prevDay = null; let prev = null;
  return (
    <div className="h-full flex flex-col relative"
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); }}>
      {/* Шапка чата */}
      <div className="flex items-center gap-3 px-5 h-[60px] bg-panel border-b border-line shrink-0">
        <span className="size-10 rounded-full bg-[#e8f0fc] text-[#2f6fd1] flex items-center justify-center"><MessageSquare size={19} /></span>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold">Чат задачи</div>
          <div className="text-[12.5px] text-ink-3">{participants.length} {plural(participants.length, 'участник', 'участника', 'участников')}</div>
        </div>
        <div className="ml-auto"><AvatarStack users={participants} max={5} size={28} /></div>
      </div>

      {/* Лента */}
      <div ref={listRef} style={CHAT_BG}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-4">
        {items === null ? <Spinner /> : items.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="bg-white/80 rounded-2xl px-5 py-4 text-center text-[13.5px] text-ink-2 max-w-xs">Сообщений пока нет.<br />Напишите первым — участники задачи увидят его здесь.</div>
          </div>
        ) : items.map((c) => {
          const d = parseDate(c.created_at);
          const day = toDateStr(d);
          const showDay = day !== prevDay;
          const grouped = !showDay && prev && prev.kind === 'text' && c.kind === 'text' && prev.user_id === c.user_id && d - parseDate(prev.created_at) < 5 * 60e3;
          const nextSame = false;
          prevDay = day; prev = c;
          const mine = c.user_id === user.id;
          return (
            <div key={c.id}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="text-[13px] font-medium text-white bg-[#5d74a8]/55 rounded-full px-3.5 py-1">{dayLabel(d)}</span>
                </div>
              )}
              {c.kind === 'system' ? (
                <div className="my-1.5 ml-12 w-fit max-w-[85%] bg-white/45 rounded-2xl px-3.5 pt-2 pb-1.5 text-[14px] text-ink">
                  <span className={LINK}>{c.user_name || 'Система'}</span> {c.body}
                  <div className="text-right text-[11px] text-ink-2/70 -mt-0.5">{fmtTime(d)}</div>
                </div>
              ) : (
                <div className={cx('group flex items-end gap-2.5', mine ? 'justify-end' : '', grouped ? 'mt-1' : 'mt-2.5')}>
                  {!mine && <div className="w-10 shrink-0">{!grouped && !nextSame ? <Avatar user={{ name: c.user_name || '?', color: c.user_color }} size={40} ring={false} /> : null}</div>}
                  {mine && <button onClick={() => del(c.id)} title="Удалить сообщение" className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/20 self-center"><Trash2 size={14} /></button>}
                  <div title={fmtDateTime(c.created_at)}
                    className={cx('relative max-w-[78%] px-3.5 pt-2 pb-1.5 shadow-[0_1px_1px_rgba(0,0,0,.10)]',
                      mine ? 'bg-[#eefcd9] rounded-2xl rounded-br-md' : 'bg-white rounded-2xl rounded-bl-md')}>
                    {!mine && !grouped && <div className="text-[14px] font-medium mb-0.5" style={{ color: c.user_color || '#2f6fd1' }}>{c.user_name}</div>}
                    {c.file_id && <div className="my-1"><FileCard c={c} onLoad={toBottom} /></div>}
                    {c.body && (
                      <div className="text-[15px] leading-snug text-ink whitespace-pre-wrap break-words">
                        <MessageText text={c.body} users={users} /><span className="inline-block w-[60px]" />
                      </div>
                    )}
                    <div className={cx('flex items-center gap-1 text-[11px]', c.body ? 'absolute right-3 bottom-1.5' : 'justify-end', mine ? 'text-[#6aa84f]' : 'text-ink-3')}>
                      {fmtTime(d)}{mine && <CheckCheck size={14} />}
                    </div>
                  </div>
                  {!mine && isManager && <button onClick={() => del(c.id)} title="Удалить сообщение" className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/20 self-center"><Trash2 size={14} /></button>}
                </div>
              )}
            </div>
          );
        })}
        {uploading > 0 && <div className="flex justify-end mt-2"><span className="text-[12px] bg-white/80 rounded-full px-3 py-1 text-ink-2">Загрузка файла…</span></div>}
      </div>

      {/* Поле ввода */}
      <div className="relative shrink-0 px-4 sm:px-8 pb-4 pt-2" style={{ background: '#7d8fd3' }}>
        {mention && candidates.length > 0 && (
          <div className="absolute bottom-full left-8 mb-1 w-80 bg-panel border border-line rounded-xl shadow-xl p-1 anim-pop z-10">
            <div className="px-2 py-1 text-[11px] text-ink-3">Упомянуть</div>
            {candidates.map((u, i) => (
              <button key={u.id} onMouseDown={(e) => { e.preventDefault(); pickMention(u); }}
                className={cx('w-full flex items-center gap-2 px-2 h-9 rounded-lg text-[13px] text-left', i === mention.index ? 'bg-canvas' : '')}>
                <Avatar user={u} size={22} ring={false} /><span className="whitespace-nowrap">{u.name}</span>
                <span className="ml-auto text-[11px] text-ink-3 truncate min-w-0">{u.position}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 bg-panel rounded-2xl shadow-sm px-3 py-2">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} title="Прикрепить файл (до 25 МБ)"
            className="size-9 shrink-0 rounded-full text-ink-3 hover:text-ink flex items-center justify-center"><Paperclip size={19} /></button>
          <textarea ref={inputRef} value={text} rows={2} onChange={onChange} onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            placeholder="Нажмите @, чтобы упомянуть человека" title="Enter — отправить, Shift+Enter — новая строка"
            className="flex-1 resize-none outline-none text-[15px] bg-transparent py-1.5 max-h-40 placeholder:text-ink-3" style={{ minHeight: 52 }} />
          <button onClick={send} disabled={!text.trim() || sending} title="Отправить (Enter)"
            className="size-10 shrink-0 rounded-full bg-[#2f6fd1] text-white flex items-center justify-center disabled:bg-ink-3/40 hover:bg-[#2a63bc]"><Send size={17} /></button>
        </div>
      </div>

      {drag && (
        <div className="absolute inset-0 z-20 bg-[#2f6fd1]/15 border-2 border-dashed border-[#2f6fd1] flex items-center justify-center pointer-events-none">
          <div className="bg-panel rounded-2xl px-5 py-3 text-[14px] font-medium shadow-lg flex items-center gap-2"><Paperclip size={18} className="text-[#2f6fd1]" />Отпустите, чтобы прикрепить</div>
        </div>
      )}
    </div>
  );
}
