import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, CircleDot, Play, Pencil, Calendar, User, Clock, FolderOpen } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { TASK_STATUS } from '../lib/constants';
import { fmtDate, fmtDateTime, fmtHM, todayStr } from '../lib/format';
import { Modal, Drawer, Field, Select, Button, ConfirmButton, Spinner, cx } from './ui';

export const isOverdue = (t) => t.status !== 'done' && t.due_date && t.due_date < todayStr();

// Иконка статуса задачи: клик переключает «открыта → в работе → закрыта → открыта»
const NEXT = { todo: 'in_progress', in_progress: 'done', done: 'todo' };
export function TaskStatusButton({ task, onChange, size = 18 }) {
  const Icon = task.status === 'done' ? CheckCircle2 : task.status === 'in_progress' ? CircleDot : Circle;
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
    setF(task ? { ...task } : { project_id: projectId || null, title: '', description: '', status: 'todo', assignee_id: null, due_date: null });
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
      const body = { project_id: +f.project_id, title: f.title.trim(), description: f.description.trim(), status: f.status,
        assignee_id: f.assignee_id ? +f.assignee_id : null, due_date: f.due_date || null };
      const saved = task ? await api.put(`/tasks/${task.id}`, body) : await api.post('/tasks', body);
      toast(task ? 'Задача сохранена' : 'Задача создана');
      bump(); onSaved?.(saved); onClose();
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };

  const err = (k) => errors[k] && <span className="block text-[11.5px] text-red-600 mt-1">{errors[k]}</span>;
  return (
    <Modal open={open} onClose={onClose} title={task ? 'Редактировать задачу' : 'Новая задача'} width={560}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={submit} disabled={busy}>{task ? 'Сохранить' : 'Создать задачу'}</Button></>}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Проект (организация)">
          <Select value={f.project_id} onChange={set('project_id')} placeholder="Выберите проект"
            options={projects.map((p) => ({ value: p.id, label: p.name }))} />
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
          <Field label="Срок">
            <input type="date" className="input" value={f.due_date || ''} onChange={set('due_date')} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Карточка задачи ---------- */
export function TaskDrawer({ id, onClose }) {
  const { users, toast, bump, startTimer, version } = useApp();
  const [t, setT] = useState(null);
  const [edit, setEdit] = useState(false);
  useEffect(() => {
    if (!id) { setT(null); return; }
    api.get(`/tasks/${id}`).then(setT).catch((e) => { toast(e.message, 'error'); onClose(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version]);
  if (!id) return null;

  const patch = async (body) => {
    setT((x) => ({ ...x, ...body }));
    try { setT(await api.put(`/tasks/${id}`, body)); bump(); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => { await api.del(`/tasks/${id}`); toast('Задача удалена'); bump(); onClose(); };

  return (
    <Drawer open={!!id} onClose={onClose} width={620} title={t ? t.title : 'Задача'}
      actions={t && <>
        <Button size="sm" icon={Play} onClick={() => startTimer({ project_id: t.project_id, task_id: t.id, description: t.title })}>Таймер</Button>
        <Button size="sm" icon={Pencil} onClick={() => setEdit(true)}>Изменить</Button>
      </>}>
      {!t ? <Spinner /> : (
        <div className="p-6 space-y-6">
          <div className="flex items-center gap-2 text-[13px] text-ink-2"><FolderOpen size={15} className="text-ink-3" />{t.project_name}</div>

          {/* Статус */}
          <div className="flex p-1 bg-canvas rounded-full border border-line w-fit">
            {Object.entries(TASK_STATUS).map(([k, s]) => (
              <button key={k} onClick={() => k !== t.status && patch({ status: k })}
                className={cx('flex items-center gap-1.5 px-3.5 h-8 rounded-full text-[13px] font-medium transition-colors', t.status === k ? 'bg-panel shadow-sm text-ink' : 'text-ink-3 hover:text-ink-2')}>
                <span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}
              </button>
            ))}
          </div>

          <div>
            <div className="text-[12px] font-medium text-ink-3 mb-1.5">Описание</div>
            <div className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap bg-canvas/60 border border-line rounded-xl p-4">
              {t.description || <span className="text-ink-3">Без описания</span>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Исполнитель">
              <Select value={t.assignee_id} onChange={(v) => patch({ assignee_id: v ? +v : null })} placeholder="Не назначен"
                options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }))} />
            </Field>
            <Field label="Срок">
              <input type="date" className={cx('input', isOverdue(t) && 'text-red-600 border-red-300')} value={t.due_date || ''} onChange={(e) => patch({ due_date: e.target.value || null })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] text-ink-2">
            <span className="flex items-center gap-2"><User size={14} className="text-ink-3" />Создал: {t.creator_name || '—'}</span>
            <span className="flex items-center gap-2"><Calendar size={14} className="text-ink-3" />Создана: {fmtDateTime(t.created_at)}</span>
            <span className="flex items-center gap-2"><Clock size={14} className="text-ink-3" />Затрачено: {fmtHM(t.tracked_sec)} ч</span>
            {t.completed_at && <span className="flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-500" />Закрыта: {fmtDate(t.completed_at)}</span>}
          </div>

          <div className="pt-2 border-t border-line"><ConfirmButton onConfirm={remove}>Удалить задачу</ConfirmButton></div>
        </div>
      )}
      <TaskFormModal open={edit} task={t} onClose={() => setEdit(false)} onSaved={setT} />
    </Drawer>
  );
}
