import { useEffect, useState } from 'react';
import { Plus, Play, Trash2, Calendar, Building2, Wallet, Clock, CheckCircle2, Circle, CircleDot, Pencil } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { PROJECT_STATUS, TASK_STATUS } from '../lib/constants';
import { fmtDate, fmtHours, fmtMoney, parseDate, todayStr } from '../lib/format';
import {
  Drawer, Modal, Field, Select, Button, UserPicker, StatusDot, Progress, Avatar, AvatarStack, Popover, MenuItem, ConfirmButton, Spinner, cx,
} from './ui';

const STATUS_OPTS = Object.entries(PROJECT_STATUS).map(([value, s]) => ({ value, label: s.label }));

export function ProjectFormModal({ open, onClose, onSaved, project }) {
  const { users, clients, user, toast } = useApp();
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(project ? { ...project } : { name: '', status: 'planned', member_ids: [user.id], owner_id: user.id, start_date: todayStr() });
  }, [open, project, user.id]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    if (!f.name?.trim()) return toast('Укажите название', 'error');
    setBusy(true);
    try {
      const body = { name: f.name, description: f.description, status: f.status, client_id: f.client_id ? +f.client_id : null, owner_id: f.owner_id ? +f.owner_id : null,
        start_date: f.start_date, due_date: f.due_date, budget: f.budget ? +f.budget : 0, member_ids: f.member_ids };
      const p = project ? await api.put(`/projects/${project.id}`, body) : await api.post('/projects', body);
      toast(project ? 'Проект сохранён' : 'Проект создан');
      onSaved?.(p); onClose();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={project ? 'Редактировать проект' : 'Новый проект'} width={600}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit} disabled={busy}>{project ? 'Сохранить' : 'Создать проект'}</Button></>}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3.5">
        <Field label="Название" className="col-span-2"><input className="input" value={f.name || ''} onChange={(e) => set('name')(e.target.value)} autoFocus /></Field>
        <Field label="Статус"><Select value={f.status} onChange={set('status')} options={STATUS_OPTS} /></Field>
        <Field label="Клиент"><Select value={f.client_id} onChange={set('client_id')} placeholder="—" options={clients.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Начало"><input type="date" className="input" value={f.start_date || ''} onChange={(e) => set('start_date')(e.target.value)} /></Field>
        <Field label="Срок сдачи"><input type="date" className="input" value={f.due_date || ''} onChange={(e) => set('due_date')(e.target.value)} /></Field>
        <Field label="Ответственный"><Select value={f.owner_id} onChange={set('owner_id')} placeholder="—" options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }))} /></Field>
        <Field label="Бюджет, ₽"><input type="number" min="0" className="input" value={f.budget || ''} onChange={(e) => set('budget')(e.target.value)} /></Field>
        <Field label="Участники" className="col-span-2"><UserPicker users={users} value={f.member_ids || []} onChange={set('member_ids')} /></Field>
        <Field label="Описание" className="col-span-2"><textarea className="input" rows={3} value={f.description || ''} onChange={(e) => set('description')(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

export function ProjectDrawer({ id, onClose }) {
  const { users, bump, toast, startTimer, isManager, version } = useApp();
  const [p, setP] = useState(null);
  const [edit, setEdit] = useState(false);
  const [newTask, setNewTask] = useState('');

  const load = () => api.get(`/projects/${id}`).then(setP).catch((e) => { toast(e.message, 'error'); onClose(); });
  useEffect(() => { if (id) { setP(null); load(); } /* eslint-disable-next-line */ }, [id, version]);

  if (!id) return null;
  const members = p ? users.filter((u) => p.member_ids.includes(u.id)) : [];

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    await api.post('/tasks', { project_id: id, title: newTask.trim(), position: p.tasks.length });
    setNewTask(''); bump();
  };
  const patchTask = async (tid, body) => {
    setP((x) => ({ ...x, tasks: x.tasks.map((t) => (t.id === tid ? { ...t, ...body } : t)) }));
    try { await api.put(`/tasks/${tid}`, body); bump(); } catch (e) { toast(e.message, 'error'); }
  };
  const delTask = async (tid) => { await api.del(`/tasks/${tid}`); bump(); };
  const remove = async () => { await api.del(`/projects/${id}`); toast('Проект удалён'); bump(); onClose(); };

  const st = p && PROJECT_STATUS[p.status];
  return (
    <Drawer open={!!id} onClose={onClose} width={720} title={p?.name || 'Проект'}
      actions={p && <>
        <Button size="sm" icon={Play} onClick={() => startTimer({ project_id: id })}>Таймер</Button>
        <Button size="sm" icon={Pencil} onClick={() => setEdit(true)}>Изменить</Button>
      </>}>
      {!p ? <Spinner /> : (
        <div className="p-6 space-y-6">
          {/* Сводка */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Meta label="Статус"><StatusDot color={st.color} label={st.label} /></Meta>
            <Meta label="Прогресс"><Progress value={p.progress} /></Meta>
            <Meta label="Сроки"><span className="text-[13px]">{fmtDate(p.start_date)} — {fmtDate(p.due_date)}</span></Meta>
            <Meta label="Учтено"><span className="text-[13px] tabular">{fmtHours(p.tracked_sec)}</span></Meta>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-1.5"><Building2 size={15} className="text-ink-3" />{p.client_name || 'Без клиента'}</span>
            <span className="inline-flex items-center gap-1.5"><Calendar size={15} className="text-ink-3" />Ответственный: {p.owner_name || '—'}</span>
            {isManager && <span className="inline-flex items-center gap-1.5"><Wallet size={15} className="text-ink-3" />Бюджет {fmtMoney(p.budget)} · получено {fmtMoney(p.finance?.income)} · расходы {fmtMoney(p.finance?.expense)}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-ink-3">Участники</span>
            <AvatarStack users={members} max={8} size={28} />
          </div>
          {p.description && <p className="text-[13.5px] text-ink-2 leading-relaxed whitespace-pre-wrap">{p.description}</p>}

          {/* Задачи */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[15px] font-semibold">Задачи <span className="text-ink-3 font-normal text-[13px]">{p.tasks_done}/{p.tasks_total}</span></h3>
            </div>
            <div className="border border-line rounded-xl divide-y divide-line">
              {p.tasks.map((t) => (
                <TaskRow key={t.id} t={t} users={users} onPatch={(b) => patchTask(t.id, b)} onDelete={() => delTask(t.id)}
                  onTimer={() => startTimer({ project_id: id, task_id: t.id, description: t.title })} />
              ))}
              <form onSubmit={addTask} className="flex items-center gap-2 px-3 h-11">
                <Plus size={16} className="text-ink-3" />
                <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Добавить задачу и нажать Enter"
                  className="flex-1 outline-none text-[13px] bg-transparent placeholder:text-ink-3" />
              </form>
            </div>
          </div>

          {/* Время по сотрудникам */}
          {p.time_by_user.length > 0 && (
            <div>
              <h3 className="text-[15px] font-semibold mb-2">Время по сотрудникам</h3>
              <div className="space-y-2">
                {p.time_by_user.map((u) => {
                  const max = p.time_by_user[0].sec || 1;
                  return (
                    <div key={u.id} className="flex items-center gap-3">
                      <Avatar user={u} size={24} ring={false} />
                      <span className="w-40 text-[13px] truncate">{u.name}</span>
                      <div className="flex-1 h-2 bg-line rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(u.sec / max) * 100}%`, background: u.color }} /></div>
                      <span className="w-14 text-right text-[12.5px] text-ink-2 tabular">{fmtHours(u.sec)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isManager && <div className="pt-2 border-t border-line"><ConfirmButton onConfirm={remove}>Удалить проект</ConfirmButton></div>}
        </div>
      )}
      <ProjectFormModal open={edit} project={p} onClose={() => setEdit(false)} onSaved={() => bump()} />
    </Drawer>
  );
}

function Meta({ label, children }) {
  return <div className="rounded-xl border border-line p-3"><div className="text-[11.5px] text-ink-3 mb-1.5">{label}</div>{children}</div>;
}

const NEXT = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
function TaskRow({ t, users, onPatch, onDelete, onTimer }) {
  const Icon = t.status === 'done' ? CheckCircle2 : t.status === 'in_progress' ? CircleDot : Circle;
  const overdue = t.status !== 'done' && t.due_date && parseDate(t.due_date) < new Date(new Date().toDateString());
  const assignee = users.find((u) => u.id === t.assignee_id);
  return (
    <div className="group flex items-center gap-2.5 px-3 h-11">
      <button onClick={() => onPatch({ status: NEXT[t.status] })} title={`${TASK_STATUS[t.status].label} → ${TASK_STATUS[NEXT[t.status]].label}`}>
        <Icon size={18} className={t.status === 'done' ? 'text-emerald-500' : t.status === 'in_progress' ? 'text-amber-500' : 'text-ink-3'} />
      </button>
      <span className={cx('flex-1 min-w-0 truncate text-[13px]', t.status === 'done' && 'line-through text-ink-3')}>{t.title}</span>
      <button onClick={onTimer} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-canvas text-ink-3" title="Запустить таймер"><Clock size={14} /></button>
      <input type="date" value={t.due_date || ''} onChange={(e) => onPatch({ due_date: e.target.value || null })}
        className={cx('text-[12px] bg-transparent outline-none w-[112px]', overdue ? 'text-red-600' : 'text-ink-3')} />
      <Popover align="right" width={220} trigger={({ toggle }) => (
        <button onClick={toggle} title={assignee?.name || 'Назначить'}><Avatar user={assignee} size={24} ring={false} /></button>
      )}>
        {({ close }) => (<>
          <MenuItem checked={!t.assignee_id} onClick={() => { onPatch({ assignee_id: null }); close(); }}>Не назначена</MenuItem>
          {users.filter((u) => u.active).map((u) => <MenuItem key={u.id} checked={u.id === t.assignee_id} onClick={() => { onPatch({ assignee_id: u.id }); close(); }}>{u.name}</MenuItem>)}
        </>)}
      </Popover>
      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-ink-3 hover:text-red-600" title="Удалить"><Trash2 size={14} /></button>
    </div>
  );
}
