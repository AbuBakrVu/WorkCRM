import { useMemo, useRef, useState } from 'react';
import { ListChecks, GitBranch, Link2, Plus, X, Check, GripVertical, Trash2, Lock } from 'lucide-react';
import { useApp } from '../lib/store';
import { api } from '../lib/api';
import { TASK_STATUS } from '../lib/constants';
import { fmtDate } from '../lib/format';
import { Avatar, Popover, SearchList, cx } from './ui';
import { TaskStatusIcon } from './Tasks';

// Обёртка секции — та же, что в карточке задачи
export function Block({ title, icon: Icon, action, children, extra }) {
  return (
    <section className="rounded-2xl border border-line bg-panel">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
        {Icon && <Icon size={15} className="text-ink-3" />}
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {extra}
        <div className="ml-auto">{action}</div>
      </div>
      <div className="px-4 pb-3.5 pt-2">{children}</div>
    </section>
  );
}

function ProgressLine({ done, total }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <span className="flex items-center gap-2 text-[12px] text-ink-3 tabular">
      <span className="w-16 h-1.5 rounded-full bg-line overflow-hidden"><span className="block h-full rounded-full bg-st-done transition-all duration-500" style={{ width: `${pct}%` }} /></span>
      {done}/{total}
    </span>
  );
}

/* ---------- Чек-лист ---------- */
export function ChecklistBlock({ task, canWork, onChange }) {
  const { toast } = useApp();
  const items = task.checklist || [];
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const [drag, setDrag] = useState(null);
  const inputRef = useRef(null);
  const done = items.filter((i) => i.done).length;
  const call = async (p) => { try { onChange(await p); } catch (e) { toast(e.message, 'error'); } };
  const add = async () => {
    const v = text;
    if (!v.trim()) return;
    setText('');
    await call(api.post(`/tasks/${task.id}/checklist`, { text: v }));
    inputRef.current?.focus();
  };
  const reorder = (from, to) => {
    const ids = items.map((i) => i.id); const [x] = ids.splice(from, 1); ids.splice(to, 0, x);
    onChange(ids.map((id) => items.find((i) => i.id === id)));
    return ids;
  };
  const editable = canWork && task.status !== 'done';
  if (!items.length && !editable) return null;
  return (
    <Block title="Чек-лист" icon={ListChecks} extra={<ProgressLine done={done} total={items.length} />}
      action={editable && !adding && <button onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus()); }} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-violet hover:underline"><Plus size={13} />Пункт</button>}>
      <div className="space-y-0.5">
        {items.map((it, i) => (
          <div key={it.id} className={cx('group flex items-start gap-2 -mx-1.5 px-1.5 py-1 rounded-lg hover:bg-canvas', drag === i && 'opacity-40')}
            draggable={editable && editId !== it.id} onDragStart={() => setDrag(i)} onDragEnd={() => {
              if (drag !== null) call(api.post(`/tasks/${task.id}/checklist/order`, { ids: items.map((x) => x.id) }));
              setDrag(null);
            }}
            onDragOver={(e) => { e.preventDefault(); if (drag !== null && drag !== i) { reorder(drag, i); setDrag(i); } }}>
            {editable && <GripVertical size={13} className="mt-1 text-ink-3 opacity-0 group-hover:opacity-100 cursor-grab shrink-0" />}
            <button disabled={!editable} onClick={() => call(api.put(`/checklist/${it.id}`, { done: !it.done }))}
              className={cx('mt-0.5 size-[18px] rounded-md border-2 grid place-items-center shrink-0 transition-colors',
                it.done ? 'bg-st-done border-st-done text-white' : 'border-line-strong hover:border-st-done', !editable && 'cursor-default')}
              title={it.done && it.done_by_name ? `Отметил ${it.done_by_name}` : undefined}>
              {!!it.done && <Check size={12} strokeWidth={3} />}
            </button>
            {editId === it.id ? (
              <input autoFocus defaultValue={it.text} className="input !h-7 flex-1"
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.stopPropagation(); setEditId(null); } }}
                onBlur={(e) => { const v = e.target.value.trim(); setEditId(null); if (v && v !== it.text) call(api.put(`/checklist/${it.id}`, { text: v })); }} />
            ) : (
              <span onDoubleClick={() => editable && setEditId(it.id)} className={cx('flex-1 text-[13.5px] leading-snug break-words pt-px', it.done ? 'line-through text-ink-3' : 'text-ink')}>{it.text}</span>
            )}
            {editable && editId !== it.id && <button onClick={() => call(api.del(`/checklist/${it.id}`))} className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-red-600 mt-0.5" title="Удалить пункт"><X size={14} /></button>}
          </div>
        ))}
        {!items.length && !adding && <div className="text-[12.5px] text-ink-3">Разбейте задачу на шаги — их можно отмечать по ходу работы</div>}
      </div>
      {adding && editable && (
        <div className="flex items-center gap-2 mt-2">
          <input ref={inputRef} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Новый пункт · Enter — добавить"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setText(''); } }}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t.includes('\n')) { e.preventDefault(); setText(t); } }}
            className="input !h-8 flex-1" />
          <button onClick={() => { setAdding(false); setText(''); }} className="text-ink-3 hover:text-ink"><X size={16} /></button>
        </div>
      )}
      {adding && <div className="text-[11px] text-ink-3 mt-1">Можно вставить список — каждая строка станет пунктом. Двойной клик по пункту — редактировать.</div>}
    </Block>
  );
}

/* ---------- Подзадачи ---------- */
export function SubtasksBlock({ task, canEdit, onOpen, onChanged }) {
  const { toast, bump, userById } = useApp();
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const subs = task.subtasks || [];
  const done = subs.filter((s) => s.status === 'done').length;
  const add = async () => {
    const v = title.trim();
    if (!v) return;
    setTitle('');
    try {
      await api.post('/tasks', { project_id: task.project_id, parent_id: task.id, title: v, assignee_id: task.assignee_id });
      bump(); onChanged();
    } catch (e) { toast(e.message, 'error'); }
  };
  if (!subs.length && !canEdit) return null;
  return (
    <Block title="Подзадачи" icon={GitBranch} extra={<ProgressLine done={done} total={subs.length} />}
      action={canEdit && !adding && <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-violet hover:underline"><Plus size={13} />Подзадача</button>}>
      <div className="space-y-0.5">
        {subs.map((s) => (
          <button key={s.id} onClick={() => onOpen(s.id)} className="w-full flex items-center gap-2 -mx-1.5 px-1.5 py-1.5 rounded-lg hover:bg-canvas text-left">
            <TaskStatusIcon status={s.status} size={16} />
            <span className={cx('flex-1 text-[13.5px] truncate', s.status === 'done' ? 'line-through text-ink-3' : 'text-ink')}>{s.title}</span>
            {s.due_date && <span className="text-[11.5px] text-ink-3">{fmtDate(s.due_date)}</span>}
            <Avatar user={userById(s.assignee_id)} size={20} ring={false} />
          </button>
        ))}
        {!subs.length && !adding && <div className="text-[12.5px] text-ink-3">Большую задачу можно разделить на подзадачи со своими исполнителями</div>}
      </div>
      {adding && (
        <div className="flex items-center gap-2 mt-2">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название подзадачи · Enter — добавить"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }} className="input !h-8 flex-1" />
          <button onClick={() => setAdding(false)} className="text-ink-3 hover:text-ink"><X size={16} /></button>
        </div>
      )}
    </Block>
  );
}

/* ---------- Зависимости ---------- */
export function DepsBlock({ task, canEdit, onOpen, onChange }) {
  const { toast } = useApp();
  const [all, setAll] = useState(null);
  const by = task.blocked_by || [];
  const blocks = task.blocks || [];
  const save = async (ids) => { try { onChange(await api.put(`/tasks/${task.id}/deps`, { blocked_by: ids })); } catch (e) { toast(e.message, 'error'); } };
  const options = useMemo(() => (all || []).filter((x) => x.id !== task.id && !by.some((b) => b.id === x.id))
    .map((x) => ({ value: x.id, label: x.title, hint: x.project_name })), [all, task.id, by]);
  if (!by.length && !blocks.length && !canEdit) return null;
  const open = by.filter((b) => b.status !== 'done').length;
  return (
    <Block title="Зависимости" icon={Link2}
      extra={open > 0 && <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-600"><Lock size={12} />ждёт {open}</span>}
      action={canEdit && (
        <Popover align="right" width={320} trigger={({ toggle }) => (
          <button onClick={() => { if (!all) api.get('/tasks?open=1').then(setAll).catch(() => setAll([])); toggle(); }} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-violet hover:underline"><Plus size={13} />Добавить</button>
        )}>
          {({ close }) => all ? <SearchList items={options} placeholder="Найти задачу…" empty="Нет подходящих задач" onEscape={close}
            onPick={(id) => { save([...by.map((b) => b.id), id]); close(); }} /> : <div className="p-3 text-[12.5px] text-ink-3">Загрузка…</div>}
        </Popover>
      )}>
      {by.length > 0 && <div className="text-[11.5px] text-ink-3 mb-1">Можно начать после:</div>}
      {by.map((b) => (
        <div key={b.id} className="group flex items-center gap-2 -mx-1.5 px-1.5 py-1 rounded-lg hover:bg-canvas">
          <TaskStatusIcon status={b.status} size={16} />
          <button onClick={() => onOpen(b.id)} className={cx('flex-1 text-left text-[13px] truncate', b.status === 'done' ? 'text-ink-3 line-through' : 'text-ink')}>{b.title}</button>
          <span className="text-[11px] text-ink-3 truncate max-w-28">{b.project_name}</span>
          {canEdit && <button onClick={() => save(by.filter((x) => x.id !== b.id).map((x) => x.id))} className="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-red-600"><X size={14} /></button>}
        </div>
      ))}
      {blocks.length > 0 && <div className="text-[11.5px] text-ink-3 mt-2 mb-1">Этой задачи ждут:</div>}
      {blocks.map((b) => (
        <button key={b.id} onClick={() => onOpen(b.id)} className="w-full flex items-center gap-2 -mx-1.5 px-1.5 py-1 rounded-lg hover:bg-canvas text-left">
          <TaskStatusIcon status={b.status} size={16} /><span className="flex-1 text-[13px] truncate">{b.title}</span>
          <span className="text-[11px] text-ink-3">{TASK_STATUS[b.status].label}</span>
        </button>
      ))}
      {!by.length && !blocks.length && <div className="text-[12.5px] text-ink-3">Например: «Монтаж» можно начать только после «Закупки оборудования»</div>}
    </Block>
  );
}
